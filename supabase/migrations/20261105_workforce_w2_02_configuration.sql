-- W2/2. Configuration is RPC-only, store-serialized, revision checked and dated.
begin;
create function public.read_workforce_configuration(p_store uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.can_manage_store(p_store) then raise exception 'Δεν έχετε δικαίωμα ρύθμισης προγράμματος' using errcode='42501'; end if;
  return jsonb_build_object('templates',(select coalesce(jsonb_agg(to_jsonb(t) || jsonb_build_object(
    'last_assigned_date',(select max(s.date) from public.shifts s where s.template_id=t.id)) order by t.code,t.valid_from),'[]'::jsonb) from public.shift_templates t where store_id=p_store),
    'requirements',(select coalesce(jsonb_agg(to_jsonb(r) order by r.weekday,r.start_time),'[]'::jsonb) from public.staffing_requirements r where store_id=p_store));
end;
$$;
revoke all on function public.read_workforce_configuration(uuid) from public,anon;
grant execute on function public.read_workforce_configuration(uuid) to authenticated;
create function public.save_shift_template(p_store uuid, p_template jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_old public.shift_templates%rowtype;
  v_id uuid := nullif(p_template->>'id','')::uuid;
  v_from date := (p_template->>'valid_from')::date;
  v_to date := nullif(p_template->>'valid_to','')::date;
  v_today date := (statement_timestamp() at time zone 'Europe/Athens')::date;
  v_code text := p_template->>'code';
begin
  if not public.can_manage_store(p_store) then raise exception 'Δεν έχετε δικαίωμα ρύθμισης βαρδιών' using errcode = '42501'; end if;
  perform 1 from public.stores where id = p_store for update;
  if v_from is null or v_from < v_today or (v_to is not null and v_to < v_from) then
    raise exception 'Η νέα ρύθμιση πρέπει να αρχίζει σήμερα ή αργότερα' using errcode = '22023';
  end if;
  if v_id is not null then
    select * into v_old from public.shift_templates where id = v_id and store_id = p_store for update;
    if not found or (p_template->>'revision')::integer is distinct from v_old.revision then
      raise exception 'Ο τύπος άλλαξε. Ανανεώστε τις ρυθμίσεις' using errcode = '40001';
    end if;
    v_code := v_old.code;
    if v_old.valid_from < v_today or exists (select 1 from public.shifts where template_id = v_id) then
      if v_from <= v_old.valid_from or (v_old.valid_to is not null and v_from > v_old.valid_to)
        or exists (select 1 from public.shifts where template_id = v_id and date >= v_from) then
        raise exception 'Επιλέξτε νέα ημερομηνία μετά τις υπάρχουσες αναθέσεις και μέσα στην ισχύ της έκδοσης' using errcode = '23514';
      end if;
      update public.shift_templates set valid_to = v_from - 1, revision = revision + 1 where id = v_id;
      v_id := null;
    end if;
  end if;
  if exists (select 1 from public.shift_templates t where t.store_id = p_store and t.code = v_code
    and (v_id is null or t.id <> v_id) and t.valid_from <= coalesce(v_to,'infinity'::date)
    and coalesce(t.valid_to,'infinity'::date) >= v_from) then
    raise exception 'Οι ημερομηνίες εκδόσεων του ίδιου τύπου επικαλύπτονται' using errcode = '23514';
  end if;
  if v_id is null then
    insert into public.shift_templates(store_id,code,name,short_label,color,legacy_type,segments,valid_from,valid_to)
    values(p_store,v_code,trim(p_template->>'name'),trim(p_template->>'short_label'),p_template->>'color',
      p_template->>'legacy_type',p_template->'segments',v_from,v_to) returning id into v_id;
  else
    update public.shift_templates set name=trim(p_template->>'name'),short_label=trim(p_template->>'short_label'),
      color=p_template->>'color',legacy_type=p_template->>'legacy_type',segments=p_template->'segments',
      valid_from=v_from,valid_to=v_to,revision=revision+1 where id=v_id;
  end if;
  insert into public.activity_log(store_id,actor_id,action,detail) values(p_store,auth.uid(),'Ρύθμιση τύπου βάρδιας',v_code || ' · ' || v_from::text);
  return v_id;
end;
$$;

create function public.archive_shift_template(p_store uuid,p_id uuid,p_revision integer)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.can_manage_store(p_store) then raise exception 'Δεν έχετε δικαίωμα ρύθμισης' using errcode = '42501'; end if;
  perform 1 from public.stores where id = p_store for update;
  update public.shift_templates set active=false,revision=revision+1 where id=p_id and store_id=p_store and revision=p_revision;
  if not found then raise exception 'Ο τύπος άλλαξε. Ανανεώστε τις ρυθμίσεις' using errcode='40001'; end if;
  insert into public.activity_log(store_id,actor_id,action,detail) values(p_store,auth.uid(),'Αρχειοθέτηση τύπου βάρδιας',p_id::text);
end;
$$;

create function public.save_staffing_requirement(p_store uuid,p_requirement jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_old public.staffing_requirements%rowtype;
  v_id uuid := nullif(p_requirement->>'id','')::uuid;
  v_from date := (p_requirement->>'valid_from')::date;
  v_to date := nullif(p_requirement->>'valid_to','')::date;
  v_code text := nullif(p_requirement->>'template_code','');
  v_day integer := (p_requirement->>'weekday')::integer;
  v_start text := p_requirement->>'start_time'; v_end text := p_requirement->>'end_time';
  v_today date := (statement_timestamp() at time zone 'Europe/Athens')::date;
begin
  if not public.can_manage_store(p_store) then raise exception 'Δεν έχετε δικαίωμα ρύθμισης στελέχωσης' using errcode='42501'; end if;
  perform 1 from public.stores where id = p_store for update;
  if v_from is null or v_from < v_today or (v_to is not null and v_to < v_from) then
    raise exception 'Η νέα ανάγκη πρέπει να αρχίζει σήμερα ή αργότερα' using errcode='22023'; end if;
  if v_code is not null and not exists(select 1 from public.shift_templates where store_id=p_store and code=v_code
    and active and valid_from<=coalesce(v_to,'infinity'::date) and coalesce(valid_to,'infinity'::date)>=v_from) then
    raise exception 'Ο τύπος δεν είναι διαθέσιμος σε αυτό το κατάστημα/διάστημα' using errcode='22023'; end if;
  if v_id is not null then
    select * into v_old from public.staffing_requirements where id=v_id and store_id=p_store for update;
    if not found or (p_requirement->>'revision')::integer is distinct from v_old.revision then
      raise exception 'Η ανάγκη άλλαξε. Ανανεώστε τις ρυθμίσεις' using errcode='40001'; end if;
    if v_old.valid_from < v_today then
      raise exception 'Η παλιά ανάγκη διατηρείται στο ιστορικό. Ορίστε λήξη και δημιουργήστε νέα' using errcode='23514'; end if;
  end if;
  if exists(select 1 from public.staffing_requirements r where r.store_id=p_store and (v_id is null or r.id<>v_id)
    and r.template_code is not distinct from v_code and r.weekday=v_day
    and r.start_time<v_end and r.end_time>v_start and r.valid_from<=coalesce(v_to,'infinity'::date)
    and coalesce(r.valid_to,'infinity'::date)>=v_from) then
    raise exception 'Επικαλυπτόμενες ανάγκες ίδιου τύπου/ημέρας. Επεξεργαστείτε ή λήξτε την προηγούμενη' using errcode='23514'; end if;
  if v_id is null then
    insert into public.staffing_requirements(store_id,template_code,weekday,start_time,end_time,minimum,valid_from,valid_to)
    values(p_store,v_code,v_day,v_start,v_end,(p_requirement->>'minimum')::integer,v_from,v_to) returning id into v_id;
  else
    update public.staffing_requirements set template_code=v_code,weekday=v_day,start_time=v_start,end_time=v_end,
      minimum=(p_requirement->>'minimum')::integer,valid_from=v_from,valid_to=v_to,revision=revision+1 where id=v_id;
  end if;
  insert into public.activity_log(store_id,actor_id,action,detail) values(p_store,auth.uid(),'Ρύθμιση ανάγκης στελέχωσης',v_id::text);
  return v_id;
end;
$$;

create function public.end_staffing_requirement(p_store uuid,p_id uuid,p_revision integer,p_until date)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.can_manage_store(p_store) then raise exception 'Δεν έχετε δικαίωμα ρύθμισης' using errcode='42501'; end if;
  perform 1 from public.stores where id = p_store for update;
  if p_until is null or p_until<(statement_timestamp() at time zone 'Europe/Athens')::date then
    raise exception 'Η λήξη δεν μπορεί να αλλάξει το παρελθόν' using errcode='22023'; end if;
  update public.staffing_requirements set valid_to=p_until,revision=revision+1
    where id=p_id and store_id=p_store and revision=p_revision and valid_from<=p_until
      and (valid_to is null or p_until<=valid_to);
  if not found then raise exception 'Μη έγκυρη λήξη ή νεότερη αλλαγή ανάγκης' using errcode='40001'; end if;
  insert into public.activity_log(store_id,actor_id,action,detail) values(p_store,auth.uid(),'Λήξη ανάγκης στελέχωσης',p_id::text || ' · ' || p_until::text);
end;
$$;

revoke all on function public.save_shift_template(uuid,jsonb),public.archive_shift_template(uuid,uuid,integer),
  public.save_staffing_requirement(uuid,jsonb),public.end_staffing_requirement(uuid,uuid,integer,date) from public,anon;
grant execute on function public.save_shift_template(uuid,jsonb),public.archive_shift_template(uuid,uuid,integer),
  public.save_staffing_requirement(uuid,jsonb),public.end_staffing_requirement(uuid,uuid,integer,date) to authenticated;
commit;

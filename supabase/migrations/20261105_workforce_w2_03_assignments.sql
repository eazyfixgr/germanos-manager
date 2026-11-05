-- W2/3. Snapshot assignment intervals; retain legacy consumer columns.
begin;
create function public.save_shift_assignment(p_store uuid,p_assignment jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_old public.shifts%rowtype; v_template public.shift_templates%rowtype;
  v_user uuid := (p_assignment->>'user_id')::uuid;
  v_date date := (p_assignment->>'date')::date;
  v_id uuid := nullif(p_assignment->>'id','')::uuid;
  v_template_id uuid := nullif(p_assignment->>'template_id','')::uuid;
  v_segments jsonb := nullif(p_assignment->'segments','null'::jsonb);
  v_type text := p_assignment->>'shift_type';
begin
  if not public.can_manage_store(p_store) then raise exception 'Δεν έχετε δικαίωμα αλλαγής βάρδιας' using errcode='42501'; end if;
  perform 1 from public.stores where id=p_store for update;
  if v_date is null or not exists(select 1 from public.store_memberships m join public.profiles p on p.id=m.user_id
    where m.store_id=p_store and m.user_id=v_user and m.active and p.active and p.deleted_at is null and p.role<>'master') then
    raise exception 'Ο εργαζόμενος δεν είναι ενεργό μέλος του καταστήματος' using errcode='22023'; end if;
  select * into v_old from public.shifts where store_id=p_store and user_id=v_user and date=v_date for update;
  if (v_id is null and found) or (v_id is not null and (not found or v_old.id<>v_id
    or (p_assignment->>'revision')::integer is distinct from v_old.revision)) then
    raise exception 'Η βάρδια άλλαξε από άλλον χρήστη. Ανανεώστε την ημέρα' using errcode='40001'; end if;
  if v_template_id is not null then
    select * into v_template from public.shift_templates where id=v_template_id and store_id=p_store
      and (active or (v_old.id is not null and v_old.template_id=v_template_id))
      and valid_from<=v_date and (valid_to is null or valid_to>=v_date);
    if not found then raise exception 'Ο τύπος δεν ισχύει για αυτή την ημέρα' using errcode='22023'; end if;
    v_type:=v_template.legacy_type; v_segments:=v_template.segments;
  end if;
  if v_type not in ('repo','adeia') and not public.valid_work_segments(v_segments) then
    raise exception 'Συμπληρώστε τα πραγματικά διαστήματα εργασίας' using errcode='22023'; end if;
  if v_id is null then
    insert into public.shifts(store_id,user_id,date,shift_type,template_id,segments,note,revision)
    values(p_store,v_user,v_date,v_type,v_template_id,v_segments,nullif(trim(p_assignment->>'note'),''),1) returning id into v_id;
  else
    update public.shifts set shift_type=v_type,template_id=v_template_id,segments=v_segments,
      note=nullif(trim(p_assignment->>'note'),'') where id=v_id;
  end if;
  insert into public.activity_log(store_id,actor_id,action,detail) values(p_store,auth.uid(),'Ανάθεση διαστημάτων βάρδιας',v_date::text || ' · ' || v_id::text);
  return v_id;
end;
$$;
revoke all on function public.save_shift_assignment(uuid,jsonb) from public,anon;
grant execute on function public.save_shift_assignment(uuid,jsonb) to authenticated;

alter function public.read_schedule(uuid,date,date,text) set schema app_private;
revoke all on function app_private.read_schedule(uuid,date,date,text) from public,anon,authenticated;
create function public.read_schedule(p_store uuid,p_start date,p_end date,p_scope text default 'team')
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_data jsonb; v_shifts jsonb; v_templates jsonb; v_requirements jsonb;
begin
  v_data:=app_private.read_schedule(p_store,p_start,p_end,p_scope);
  select coalesce(jsonb_agg(x.value || jsonb_build_object('segments',s.segments,'revision',s.revision,
    'template_id',s.template_id,'template_code',t.code,'template_name',t.name,
    'template_short_label',t.short_label,'template_color',t.color) order by s.date,s.user_id),'[]'::jsonb)
    into v_shifts from jsonb_array_elements(v_data->'shifts') x
      join public.shifts s on s.id=(x.value->>'id')::uuid left join public.shift_templates t on t.id=s.template_id;
  select coalesce(jsonb_agg(to_jsonb(t) order by t.valid_from,t.name),'[]'::jsonb) into v_templates
    from public.shift_templates t where t.store_id=p_store and (t.valid_from<p_end and coalesce(t.valid_to,'infinity'::date)>=p_start
      or exists(select 1 from public.shifts s where s.template_id=t.id and s.store_id=p_store and s.date>=p_start and s.date<p_end));
  select coalesce(jsonb_agg(to_jsonb(r) order by r.weekday,r.start_time),'[]'::jsonb) into v_requirements
    from public.staffing_requirements r where r.store_id=p_store and r.valid_from<p_end and coalesce(r.valid_to,'infinity'::date)>=p_start;
  return v_data || jsonb_build_object('workforce_schema',2,'shifts',v_shifts,'templates',v_templates,'requirements',v_requirements);
end;
$$;
revoke all on function public.read_schedule(uuid,date,date,text) from public,anon;
grant execute on function public.read_schedule(uuid,date,date,text) to authenticated;

-- A legacy generation must not erase interval-aware assignments/configuration.
alter function public.replace_month_shifts(uuid,text,jsonb,jsonb) set schema app_private;
revoke all on function app_private.replace_month_shifts(uuid,text,jsonb,jsonb) from public,anon,authenticated;
create function public.replace_month_shifts(p_store uuid,p_month text,p_shifts jsonb,p_fairness jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.can_manage_store(p_store) then raise exception 'Δεν έχετε δικαίωμα αλλαγής προγράμματος' using errcode='42501'; end if;
  perform 1 from public.stores where id=p_store for update;
  if exists(select 1 from public.shift_templates where store_id=p_store)
    or exists(select 1 from public.staffing_requirements where store_id=p_store)
    or exists(select 1 from public.shifts where store_id=p_store and (template_id is not null or revision>0)) then
    raise exception 'Το κατάστημα χρησιμοποιεί πραγματικά διαστήματα. Η παλιά παραγωγή μήνα δεν μπορεί να τα αντικαταστήσει' using errcode='23514'; end if;
  perform app_private.replace_month_shifts(p_store,p_month,p_shifts,p_fairness);
end;
$$;
revoke all on function public.replace_month_shifts(uuid,text,jsonb,jsonb) from public,anon;
grant execute on function public.replace_month_shifts(uuid,text,jsonb,jsonb) to authenticated;
commit;

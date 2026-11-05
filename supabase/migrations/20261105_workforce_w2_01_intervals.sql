-- W2/1. Run after workforce_read_model. Historical split spans remain unresolved.
begin;

create function public.valid_work_segments(p_segments jsonb)
returns boolean language plpgsql immutable set search_path = public as $$
declare x jsonb; v_last text := ''; v_start text; v_end text;
begin
  if p_segments is null or jsonb_typeof(p_segments) <> 'array' then return false; end if;
  if jsonb_array_length(p_segments) not between 1 and 4 then return false; end if;
  for x in select value from jsonb_array_elements(p_segments) loop
    if jsonb_typeof(x) <> 'object' or jsonb_typeof(x->'start') <> 'string'
      or jsonb_typeof(x->'end') <> 'string' or x - 'start' - 'end' <> '{}'::jsonb then return false; end if;
    v_start := x->>'start'; v_end := x->>'end';
    if v_start is null or v_end is null or v_start !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
      or v_end !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
      or v_start >= v_end or v_start < v_last then return false; end if;
    v_last := v_end;
  end loop;
  return true;
end;
$$;

create table public.shift_templates (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id),
  code text not null check (code ~ '^[a-z0-9_-]{1,48}$'),
  name text not null check (length(trim(name)) between 1 and 100),
  short_label text not null check (length(trim(short_label)) between 1 and 4),
  color text not null check (color ~ '^#[0-9A-Fa-f]{6}$'),
  legacy_type text not null check (legacy_type in ('open','mid','close','custom','split','short','full')),
  segments jsonb not null check (public.valid_work_segments(segments)),
  valid_from date not null,
  valid_to date,
  active boolean not null default true,
  revision integer not null default 1,
  check (valid_to is null or valid_to >= valid_from),
  check (legacy_type <> 'split' or (jsonb_array_length(segments) = 2 and segments->1->>'start' > segments->0->>'end'))
);
create index shift_templates_store_dates on public.shift_templates(store_id, valid_from, valid_to);
create table public.staffing_requirements (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id),
  template_code text,
  weekday integer not null check (weekday between 1 and 7),
  start_time text not null check (start_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  end_time text not null check (end_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  minimum integer not null check (minimum between 0 and 500),
  valid_from date not null,
  valid_to date,
  revision integer not null default 1,
  check (start_time < end_time),
  check (valid_to is null or valid_to >= valid_from)
);
create index staffing_requirements_store_dates on public.staffing_requirements(store_id, valid_from, valid_to);
alter table public.shifts add column template_id uuid references public.shift_templates(id);
alter table public.shifts add column segments jsonb check (segments is null or public.valid_work_segments(segments));
alter table public.shifts add column revision integer not null default 0;

-- Only an unambiguous, valid single range can be backfilled. No IDs, types or
-- original start/end values change; split shifts are deliberately left null.
update public.shifts set segments = jsonb_build_array(jsonb_build_object(
  'start', left(start_time, 5), 'end', left(end_time, 5)))
where shift_type not in ('split','repo','adeia')
  and start_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9](:00)?$'
  and end_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9](:00)?$'
  and left(start_time, 5) < left(end_time, 5);

alter table public.shift_templates enable row level security;
alter table public.staffing_requirements enable row level security;
revoke all on public.shift_templates, public.staffing_requirements from anon, authenticated;
grant select on public.shift_templates, public.staffing_requirements to authenticated;
create policy templates_read on public.shift_templates for select to authenticated using (public.can_access_store(store_id));
create policy requirements_read on public.staffing_requirements for select to authenticated using (public.can_access_store(store_id));
create trigger trg_support_write_guard before insert or update or delete on public.shift_templates
  for each row execute function public.guard_support_write();
create trigger trg_support_write_audit after insert or update or delete on public.shift_templates
  for each row execute function public.audit_support_write();
create trigger trg_support_write_guard before insert or update or delete on public.staffing_requirements
  for each row execute function public.guard_support_write();
create trigger trg_support_write_audit after insert or update or delete on public.staffing_requirements
  for each row execute function public.audit_support_write();

-- Validate every authenticated shift write, including security-definer calls.
drop policy if exists shifts_insert_self on public.shifts;
create function public.protect_shift_intervals()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_template public.shift_templates%rowtype; v_absence text; v_closed boolean; v_open text; v_close text;
begin
  if tg_op = 'UPDATE' then
    if auth.uid() is not null and row(new.id,new.store_id,new.user_id,new.date) is distinct from row(old.id,old.store_id,old.user_id,old.date) then
      raise exception 'Η ταυτότητα ανάθεσης δεν μεταφέρεται' using errcode = '42501';
    end if;
    new.revision := old.revision + 1;
  end if;
  if auth.uid() is not null and not public.can_manage_store(new.store_id) then
    raise exception 'Δεν έχετε δικαίωμα αλλαγής βάρδιας' using errcode = '42501';
  end if;
  if auth.uid() is not null and not exists(select 1 from public.store_memberships m join public.profiles p on p.id=m.user_id
    where m.store_id=new.store_id and m.user_id=new.user_id and m.active and p.active and p.deleted_at is null and p.role<>'master') then
    if tg_op='INSERT' then raise exception 'Ο εργαζόμενος δεν ανήκει στο ενεργό προσωπικό' using errcode='23514'; end if;
    if row(new.shift_type,new.template_id,new.segments,new.start_time,new.end_time)
      is distinct from row(old.shift_type,old.template_id,old.segments,old.start_time,old.end_time) then
      raise exception 'Το ιστορικό μη ενεργού μέλους δεν ανατίθεται ξανά' using errcode='23514';
    end if;
  end if;
  if new.shift_type in ('repo','adeia') then
    new.segments := null; new.template_id := null; new.start_time := null; new.end_time := null;
  elsif new.template_id is not null then
    select * into v_template from public.shift_templates where id = new.template_id and store_id = new.store_id;
    if not found or new.date < v_template.valid_from or (v_template.valid_to is not null and new.date > v_template.valid_to) then
      raise exception 'Ο τύπος βάρδιας δεν ισχύει για αυτή την ημερομηνία' using errcode = '22023';
    end if;
    if not v_template.active and (tg_op = 'INSERT' or new.template_id is distinct from old.template_id) then
      raise exception 'Ο τύπος έχει αρχειοθετηθεί' using errcode = '22023';
    end if;
    if new.segments is distinct from v_template.segments or new.shift_type <> v_template.legacy_type then
      raise exception 'Τα διαστήματα δεν αντιστοιχούν στον τύπο βάρδιας' using errcode = '22023';
    end if;
  elsif new.segments is null and new.shift_type <> 'split'
    and public.valid_work_segments(jsonb_build_array(jsonb_build_object('start', left(new.start_time,5), 'end',left(new.end_time,5)))) then
    new.segments := jsonb_build_array(jsonb_build_object('start',left(new.start_time,5),'end',left(new.end_time,5)));
  end if;
  if new.segments is not null then
    if not public.valid_work_segments(new.segments) or (new.shift_type = 'split' and
      (jsonb_array_length(new.segments) <> 2 or new.segments->1->>'start' <= new.segments->0->>'end')) then
      raise exception 'Μη έγκυρα ή επικαλυπτόμενα διαστήματα' using errcode = '22023';
    end if;
    if tg_op = 'UPDATE' and new.segments is not distinct from old.segments
      and row(new.start_time,new.end_time) is distinct from row(old.start_time,old.end_time)
      and row(new.start_time,new.end_time) is distinct from row(new.segments->0->>'start',new.segments->(jsonb_array_length(new.segments)-1)->>'end') then
      raise exception 'Αλλάξτε τα πραγματικά διαστήματα, όχι μόνο το συνολικό εύρος' using errcode='22023';
    end if;
    new.start_time := new.segments->0->>'start';
    new.end_time := new.segments->(jsonb_array_length(new.segments)-1)->>'end';
  elsif auth.uid() is not null and new.shift_type not in ('repo','adeia') then
    if tg_op = 'INSERT' then raise exception 'Απαιτούνται πραγματικά διαστήματα βάρδιας' using errcode = '22023'; end if;
    if row(new.shift_type,new.start_time,new.end_time) is distinct from row(old.shift_type,old.start_time,old.end_time) then
      raise exception 'Συμπληρώστε τα πραγματικά διαστήματα πριν αλλάξετε τη βάρδια' using errcode = '22023';
    end if;
  end if;
  if auth.uid() is not null then
    select type into v_absence from public.leave_requests where store_id = new.store_id and user_id = new.user_id
      and status = 'approved' and start_date <= new.date and end_date >= new.date order by type limit 1;
    if found and new.shift_type <> v_absence then
      raise exception 'Υπάρχει δεσμευτική εγκεκριμένη απουσία' using errcode = '23514';
    end if;
    if new.segments is not null then
      select not c.is_working, c.open_time, c.close_time into v_closed,v_open,v_close
        from public.store_calendar c where c.store_id = new.store_id and c.date = new.date;
      if not found then select p.closed,p.start_time,p.end_time into v_closed,v_open,v_close
        from public.store_patterns p where p.store_id = new.store_id and p.weekday = extract(isodow from new.date); end if;
      if v_closed is true or (v_open is not null and new.start_time < left(v_open,5))
        or (v_close is not null and new.end_time > left(v_close,5)) then
        raise exception 'Η βάρδια είναι εκτός ωραρίου καταστήματος' using errcode = '23514';
      end if;
    end if;
  end if;
  return new;
end;
$$;
create trigger trg_shift_intervals before insert or update on public.shifts
  for each row execute function public.protect_shift_intervals();
commit;

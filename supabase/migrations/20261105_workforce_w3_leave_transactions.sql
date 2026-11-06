-- W3. Run after all W1/W2 migrations. Leave review, ledger and shifts are atomic.
begin;

alter table public.leave_requests drop constraint if exists leave_requests_status_check;
alter table public.leave_requests add constraint leave_requests_status_check
  check (status in ('pending','approved','rejected','revoked'));
alter table public.leave_requests add column requested_rest_dates date[] not null default '{}';
alter table public.leave_requests add column revision integer not null default 1;
alter table public.leave_requests add column reviewed_at timestamptz;
alter table public.leave_requests add column revoked_at timestamptz;
alter table public.leave_requests add column revoked_by uuid references public.profiles(id) on delete set null;
alter table public.shifts add column source_leave_request_id uuid references public.leave_requests(id) on delete set null;

create table public.leave_request_day_ledger (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.leave_requests(id) on delete cascade,
  store_id uuid not null references public.stores(id),
  user_id uuid not null references public.profiles(id),
  leave_date date not null,
  disposition text not null check (disposition in ('charged_leave','approved_rest','requested_rest','preexisting_rest','closed')),
  before_shift jsonb,
  applied_shift_id uuid,
  applied_revision integer,
  created_at timestamptz not null default statement_timestamp(),
  unique(request_id,leave_date),
  check ((applied_shift_id is null) = (applied_revision is null))
);
create index leave_day_ledger_user_date on public.leave_request_day_ledger(store_id,user_id,leave_date);
create table public.leave_request_events (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.leave_requests(id) on delete cascade,
  store_id uuid not null references public.stores(id),
  actor_id uuid not null references public.profiles(id),
  action text not null check (action in ('submitted','approved','rejected','revoked')),
  previous_status text,
  new_status text not null,
  revision integer not null,
  charged_days integer not null default 0,
  requested_rest_dates date[] not null default '{}',
  created_at timestamptz not null default statement_timestamp()
);
alter table public.leave_request_day_ledger enable row level security;
alter table public.leave_request_events enable row level security;
revoke all on public.leave_request_day_ledger,public.leave_request_events from anon,authenticated;
grant select on public.leave_request_day_ledger,public.leave_request_events to authenticated;
create policy leave_ledger_read on public.leave_request_day_ledger for select to authenticated using (
  user_id=auth.uid() or public.can_manage_store(store_id));
create policy leave_events_read on public.leave_request_events for select to authenticated using (
  exists(select 1 from public.leave_requests l where l.id=request_id and
    (l.user_id=auth.uid() or public.can_manage_store(public.leave_request_events.store_id))));
create policy leave_ledger_active_store on public.leave_request_day_ledger as restrictive for select to authenticated
  using (public.actor_is_active() and public.can_access_store(store_id));
create policy leave_events_active_store on public.leave_request_events as restrictive for select to authenticated
  using (public.actor_is_active() and public.can_access_store(store_id));

-- No direct REST updates can approve, edit, or revoke an absence.
drop policy if exists leave_insert_self on public.leave_requests;
drop policy if exists leave_update_self on public.leave_requests;
drop policy if exists leave_review_admin on public.leave_requests;
drop policy if exists leave_delete_admin on public.leave_requests;
revoke insert,update,delete on public.leave_requests from anon,authenticated;
revoke insert,update,delete on public.shifts from anon,authenticated;
create trigger trg_support_write_guard before insert or update or delete on public.leave_request_day_ledger
  for each row execute function public.guard_support_write();
create trigger trg_support_write_audit after insert or update or delete on public.leave_request_day_ledger
  for each row execute function public.audit_support_write();
create trigger trg_support_write_guard before insert or update or delete on public.leave_request_events
  for each row execute function public.guard_support_write();
create trigger trg_support_write_audit after insert or update or delete on public.leave_request_events
  for each row execute function public.audit_support_write();

create function public.enforce_leave_request_profile()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if tg_op='UPDATE' and row(new.store_id,new.user_id,new.type,new.start_date,new.end_date,new.reason)
    is distinct from row(old.store_id,old.user_id,old.type,old.start_date,old.end_date,old.reason) then
    raise exception 'Το περιεχόμενο της αίτησης δεν τροποποιείται· ανακαλέστε και υποβάλετε νέα' using errcode='23514';
  end if;
  if tg_op='UPDATE' and new.requested_rest_dates is distinct from old.requested_rest_dates
    and not (old.status='pending' and new.status='approved' and public.can_manage_store(old.store_id)) then
    raise exception 'Οι προτιμήσεις ρεπό αλλάζουν μόνο κατά την έγκριση από υπεύθυνο' using errcode='23514';
  end if;
  return new;
end;
$$;
create trigger trg_leave_request_immutable before update on public.leave_requests
  for each row execute function public.enforce_leave_request_profile();

-- Extend W2 validation only for an exact, ledger-backed restoration snapshot.
create or replace function public.protect_shift_intervals()
returns trigger language plpgsql security definer set search_path=public as $$
declare v_template public.shift_templates%rowtype; v_absence text; v_closed boolean; v_open text; v_close text;
  v_has_user boolean; v_restoring boolean:=false; v_snapshot jsonb; v_snapshot_template uuid;
begin
  if tg_op='UPDATE' then
    if auth.uid() is not null and row(new.id,new.store_id,new.user_id,new.date) is distinct from row(old.id,old.store_id,old.user_id,old.date) then
      raise exception 'Η ταυτότητα ανάθεσης δεν μεταφέρεται' using errcode='42501'; end if;
    new.revision:=old.revision+1;
    if old.source_leave_request_id is not null and new.source_leave_request_id is null then
      select before_shift into v_snapshot from public.leave_request_day_ledger
        where request_id=old.source_leave_request_id and applied_shift_id=old.id and applied_revision=old.revision;
      if found and v_snapshot is not null then
        v_snapshot_template:=nullif(v_snapshot->>'template_id','')::uuid;
        v_restoring:=new.shift_type=v_snapshot->>'shift_type'
          and new.template_id is not distinct from v_snapshot_template
          and new.segments is not distinct from nullif(v_snapshot->'segments','null'::jsonb)
          and new.start_time is not distinct from v_snapshot->>'start_time'
          and new.end_time is not distinct from v_snapshot->>'end_time'
          and new.note is not distinct from v_snapshot->>'note';
      end if;
    end if;
  end if;
  if auth.uid() is not null and not public.can_manage_store(new.store_id) then raise exception 'Δεν έχετε δικαίωμα αλλαγής βάρδιας' using errcode='42501'; end if;
  select exists(select 1 from public.store_memberships m join public.profiles p on p.id=m.user_id
    where m.store_id=new.store_id and m.user_id=new.user_id and m.active and p.active and p.deleted_at is null and p.role<>'master') into v_has_user;
  if auth.uid() is not null and not v_has_user and not v_restoring then
    if tg_op='INSERT' then raise exception 'Ο εργαζόμενος δεν ανήκει στο ενεργό προσωπικό' using errcode='23514'; end if;
    if row(new.shift_type,new.template_id,new.segments,new.start_time,new.end_time) is distinct from row(old.shift_type,old.template_id,old.segments,old.start_time,old.end_time) then
      raise exception 'Το ιστορικό μη ενεργού μέλους δεν ανατίθεται ξανά' using errcode='23514'; end if;
  end if;
  if new.shift_type in ('repo','adeia') then new.segments:=null; new.template_id:=null; new.start_time:=null; new.end_time:=null;
  elsif new.template_id is not null then
    select * into v_template from public.shift_templates where id=new.template_id and store_id=new.store_id;
    if not found or new.date<v_template.valid_from or (v_template.valid_to is not null and new.date>v_template.valid_to) then
      raise exception 'Ο τύπος βάρδιας δεν ισχύει για αυτή την ημερομηνία' using errcode='22023'; end if;
    if not v_template.active and (tg_op='INSERT' or (new.template_id is distinct from old.template_id and not v_restoring)) then
      raise exception 'Ο τύπος έχει αρχειοθετηθεί' using errcode='22023'; end if;
    if new.segments is distinct from v_template.segments or new.shift_type<>v_template.legacy_type then
      raise exception 'Τα διαστήματα δεν αντιστοιχούν στον τύπο βάρδιας' using errcode='22023'; end if;
  elsif new.segments is null and new.shift_type<>'split'
    and public.valid_work_segments(jsonb_build_array(jsonb_build_object('start',left(new.start_time,5),'end',left(new.end_time,5)))) then
    new.segments:=jsonb_build_array(jsonb_build_object('start',left(new.start_time,5),'end',left(new.end_time,5)));
  end if;
  if new.segments is not null then
    if not public.valid_work_segments(new.segments) or (new.shift_type='split' and (jsonb_array_length(new.segments)<>2 or new.segments->1->>'start'<=new.segments->0->>'end')) then
      raise exception 'Μη έγκυρα ή επικαλυπτόμενα διαστήματα' using errcode='22023'; end if;
    if tg_op='UPDATE' and new.segments is not distinct from old.segments
      and row(new.start_time,new.end_time) is distinct from row(old.start_time,old.end_time)
      and row(new.start_time,new.end_time) is distinct from row(new.segments->0->>'start',new.segments->(jsonb_array_length(new.segments)-1)->>'end') then
      raise exception 'Αλλάξτε τα πραγματικά διαστήματα, όχι μόνο το συνολικό εύρος' using errcode='22023'; end if;
    new.start_time:=new.segments->0->>'start'; new.end_time:=new.segments->(jsonb_array_length(new.segments)-1)->>'end';
  elsif auth.uid() is not null and new.shift_type not in ('repo','adeia') then
    if not v_restoring and (tg_op='INSERT' or row(new.shift_type,new.start_time,new.end_time) is distinct from row(old.shift_type,old.start_time,old.end_time)) then
      raise exception 'Συμπληρώστε τα πραγματικά διαστήματα πριν αλλάξετε τη βάρδια' using errcode='22023'; end if;
  end if;
  if auth.uid() is not null and not v_restoring then
    select type into v_absence from public.leave_requests where store_id=new.store_id and user_id=new.user_id and status='approved'
      and start_date<=new.date and end_date>=new.date order by type limit 1;
    if found and new.shift_type<>v_absence and not exists(select 1 from public.leave_request_day_ledger l
      where l.request_id=new.source_leave_request_id and l.user_id=new.user_id and l.leave_date=new.date and l.disposition='requested_rest') then
      raise exception 'Υπάρχει δεσμευτική εγκεκριμένη απουσία' using errcode='23514'; end if;
    if new.segments is not null then
      select not c.is_working,c.open_time,c.close_time into v_closed,v_open,v_close from public.store_calendar c where c.store_id=new.store_id and c.date=new.date;
      if not found then select p.closed,p.start_time,p.end_time into v_closed,v_open,v_close from public.store_patterns p where p.store_id=new.store_id and p.weekday=extract(isodow from new.date); end if;
      if v_closed is true or (v_open is not null and new.start_time<left(v_open,5)) or (v_close is not null and new.end_time>left(v_close,5)) then
        raise exception 'Η βάρδια είναι εκτός ωραρίου καταστήματος' using errcode='23514'; end if;
    end if;
  end if;
  return new;
end;
$$;

create function public.leave_store_open(p_store uuid,p_day date)
returns boolean language plpgsql stable security definer set search_path=public as $$
declare v_open boolean; v_weekday integer := extract(isodow from p_day)::integer;
begin
  select is_working into v_open from public.store_calendar where store_id=p_store and date=p_day;
  if found then return v_open; end if;
  select not closed into v_open from public.store_patterns where store_id=p_store and weekday=v_weekday;
  if found then return v_open; end if;
  return v_weekday<>7;
end;
$$;
create function public.leave_rest_dates(p_store uuid,p_day date,p_user uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from public.shifts where store_id=p_store and user_id=p_user and date=p_day and shift_type='repo');
$$;
create function public.leave_dates(p_start date,p_end date)
returns setof date language sql immutable as $$
  select d::date from generate_series(p_start::timestamp,p_end::timestamp,interval '1 day') d;
$$;
revoke all on function public.leave_store_open(uuid,date),public.leave_rest_dates(uuid,date,uuid),public.leave_dates(date,date) from public,anon,authenticated;

create function public.submit_leave_request(
  p_store uuid,p_type text,p_start date,p_end date,p_reason text default null,p_requested_rest_dates date[] default '{}'
)
returns uuid language plpgsql security definer set search_path=public as $$
declare v_id uuid; v_date date;
begin
  if p_store is null or public.current_store() is distinct from p_store or not public.can_access_store(p_store) then
    raise exception 'Δεν έχετε πρόσβαση σε αυτό το κατάστημα' using errcode='42501'; end if;
  if p_type is null or p_type not in ('repo','adeia') or p_start is null or p_end is null or p_end<p_start or p_end-p_start>89 then
    raise exception 'Επιλέξτε έγκυρο διάστημα έως 90 ημέρες' using errcode='22023'; end if;
  if coalesce(length(p_reason),0)>2000 then raise exception 'Η αιτιολογία υπερβαίνει τους 2000 χαρακτήρες' using errcode='22023'; end if;
  if coalesce(cardinality(p_requested_rest_dates),0)>90 or (p_type<>'adeia' and cardinality(p_requested_rest_dates)>0) then
    raise exception 'Μη έγκυρες επιπλέον προτιμήσεις ρεπό' using errcode='22023'; end if;
  if cardinality(coalesce(p_requested_rest_dates,'{}')) <>
    cardinality(array(select distinct d from unnest(coalesce(p_requested_rest_dates,'{}')) d)) then
    raise exception 'Οι ημερομηνίες πρόσθετου ρεπό πρέπει να είναι μοναδικές' using errcode='22023'; end if;
  perform 1 from public.stores where id=p_store for update;
  perform 1 from public.profiles where id=auth.uid() and active and deleted_at is null for update;
  if not exists(select 1 from public.profiles where id=auth.uid() and active and deleted_at is null)
    or not exists(select 1 from public.store_memberships where store_id=p_store and user_id=auth.uid() and active) then
    raise exception 'Απαιτείται ενεργή συμμετοχή στο κατάστημα' using errcode='42501'; end if;
  if exists(select 1 from public.leave_requests l where l.store_id=p_store and l.user_id=auth.uid()
    and l.status in ('pending','approved') and l.start_date<=p_end and l.end_date>=p_start) then
    raise exception 'Υπάρχει ήδη αίτηση ή εγκεκριμένη απουσία που επικαλύπτεται' using errcode='23505'; end if;
  foreach v_date in array coalesce(p_requested_rest_dates,'{}') loop
    if v_date<p_start or v_date>p_end or not public.leave_store_open(p_store,v_date)
      or public.leave_rest_dates(p_store,v_date,auth.uid()) then
      raise exception 'Επιλέξτε πρόσθετο ρεπό μόνο σε διαθέσιμη εργάσιμη ημέρα της άδειας' using errcode='22023'; end if;
  end loop;
  insert into public.leave_requests(store_id,user_id,type,start_date,end_date,reason,status,requested_rest_dates,revision)
  values(p_store,auth.uid(),p_type,p_start,p_end,nullif(trim(p_reason),''),'pending',coalesce(p_requested_rest_dates,'{}'),1)
  returning id into v_id;
  insert into public.leave_request_events(request_id,store_id,actor_id,action,new_status,revision,requested_rest_dates)
  values(v_id,p_store,auth.uid(),'submitted','pending',1,coalesce(p_requested_rest_dates,'{}'));
  insert into public.activity_log(store_id,actor_id,action,detail)
  values(p_store,auth.uid(),'Αίτηση ρεπό/άδειας',p_start::text||' → '||p_end::text);
  return v_id;
end;
$$;

create function public.review_leave_request(
  p_store uuid,p_request uuid,p_revision integer,p_decision text,p_selected_rest_dates date[] default null
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_leave public.leave_requests%rowtype; v_date date; v_shift public.shifts%rowtype;
  v_open boolean; v_kind text; v_new_type text; v_count integer:=0; v_selected date[]; v_has_shift boolean;
  v_shift_id uuid; v_revision integer;
begin
  if p_store is null or not public.can_manage_store(p_store) or (not public.is_master() and public.current_store() is distinct from p_store) then
    raise exception 'Δεν έχετε δικαίωμα διαχείρισης αιτημάτων σε αυτό το κατάστημα' using errcode='42501'; end if;
  if p_decision is null or p_decision not in ('approved','rejected') then raise exception 'Μη έγκυρη απόφαση' using errcode='22023'; end if;
  perform 1 from public.stores where id=p_store for update;
  select * into v_leave from public.leave_requests where id=p_request and store_id=p_store for update;
  if not found or v_leave.status<>'pending' or v_leave.revision<>p_revision then
    raise exception 'Η αίτηση άλλαξε ή δεν είναι πλέον σε αναμονή. Ανανεώστε τη λίστα' using errcode='40001'; end if;
  if v_leave.user_id=auth.uid() then raise exception 'Δεν μπορείτε να εγκρίνετε τη δική σας αίτηση' using errcode='42501'; end if;
  perform 1 from public.profiles where id=v_leave.user_id for update;
  if not exists(select 1 from public.store_memberships m join public.profiles p on p.id=m.user_id
    where m.store_id=p_store and m.user_id=v_leave.user_id and m.active and p.active and p.deleted_at is null and p.role<>'master') then
    raise exception 'Το άτομο δεν είναι πλέον ενεργό μέλος του καταστήματος' using errcode='23514'; end if;
  if p_decision='rejected' then
    update public.leave_requests set status='rejected',reviewed_by=auth.uid(),reviewed_at=statement_timestamp(),revision=revision+1 where id=p_request;
    insert into public.leave_request_events(request_id,store_id,actor_id,action,previous_status,new_status,revision,requested_rest_dates)
    values(p_request,p_store,auth.uid(),'rejected','pending','rejected',v_leave.revision+1,v_leave.requested_rest_dates);
    insert into public.activity_log(store_id,actor_id,action,detail) values(p_store,auth.uid(),'Απόρριψη αιτήματος',p_request::text);
    return jsonb_build_object('status','rejected','charged_days',0,'revision',v_leave.revision+1);
  end if;
  if exists(select 1 from public.leave_requests other where other.store_id=p_store and other.user_id=v_leave.user_id
    and other.id<>p_request and other.status in ('pending','approved') and other.start_date<=v_leave.end_date and other.end_date>=v_leave.start_date) then
    raise exception 'Υπάρχει άλλη αίτηση ή απουσία που επικαλύπτεται' using errcode='23514'; end if;
  v_selected:=case when p_selected_rest_dates is null then v_leave.requested_rest_dates else p_selected_rest_dates end;
  if v_leave.type<>'adeia' and cardinality(v_selected)>0 then raise exception 'Πρόσθετα ρεπό ισχύουν μόνο σε αίτηση άδειας' using errcode='22023'; end if;
  if cardinality(v_selected)<>cardinality(array(select distinct x from unnest(v_selected) x)) then raise exception 'Διπλές ημερομηνίες ρεπό' using errcode='22023'; end if;
  foreach v_date in array coalesce(v_selected,'{}') loop
    if v_date<v_leave.start_date or v_date>v_leave.end_date or not public.leave_store_open(p_store,v_date)
      or public.leave_rest_dates(p_store,v_date,v_leave.user_id) then
      raise exception 'Η επιλεγμένη πρόσθετη ημέρα ρεπό δεν είναι διαθέσιμη' using errcode='22023'; end if;
  end loop;
  update public.leave_requests set status='approved',reviewed_by=auth.uid(),reviewed_at=statement_timestamp(),
    requested_rest_dates=coalesce(v_selected,'{}'),revision=revision+1 where id=p_request;
  for v_date in select * from public.leave_dates(v_leave.start_date,v_leave.end_date) loop
    v_open:=public.leave_store_open(p_store,v_date);
    select * into v_shift from public.shifts where store_id=p_store and user_id=v_leave.user_id and date=v_date for update;
    v_has_shift:=found;
    if not v_open and v_has_shift and v_shift.shift_type not in ('repo','adeia') then
      raise exception 'Υπάρχει βάρδια σε κλειστή ημέρα %',v_date using errcode='23514'; end if;
    if not v_open then v_kind:='closed'; v_new_type:=null;
    elsif v_has_shift and v_shift.shift_type='repo' then v_kind:='preexisting_rest'; v_new_type:=null;
    elsif v_leave.type='repo' then v_kind:='approved_rest'; v_new_type:='repo';
    elsif v_date=any(coalesce(v_selected,'{}')) then v_kind:='requested_rest'; v_new_type:='repo';
    else v_kind:='charged_leave'; v_new_type:='adeia'; v_count:=v_count+1;
    end if;
    insert into public.leave_request_day_ledger(request_id,store_id,user_id,leave_date,disposition,before_shift)
    values(p_request,p_store,v_leave.user_id,v_date,v_kind,case when v_has_shift then to_jsonb(v_shift) else null end);
    if v_new_type is not null then
      if v_has_shift then
        update public.shifts set shift_type=v_new_type,template_id=null,segments=null,start_time=null,end_time=null,
          source_leave_request_id=p_request,note=case when v_new_type='repo' then 'Ρεπό — αίτηση '||p_request::text else 'Άδεια — αίτηση '||p_request::text end
          where id=v_shift.id returning id,revision into v_shift_id,v_revision;
      else
        insert into public.shifts(store_id,user_id,date,shift_type,note,revision,source_leave_request_id)
        values(p_store,v_leave.user_id,v_date,v_new_type,case when v_new_type='repo' then 'Ρεπό — αίτηση '||p_request::text else 'Άδεια — αίτηση '||p_request::text end,1,p_request)
        returning id,revision into v_shift_id,v_revision;
      end if;
      update public.leave_request_day_ledger set applied_shift_id=v_shift_id,applied_revision=v_revision
        where request_id=p_request and leave_date=v_date;
    end if;
  end loop;
  insert into public.leave_request_events(request_id,store_id,actor_id,action,previous_status,new_status,revision,charged_days,requested_rest_dates)
  values(p_request,p_store,auth.uid(),'approved','pending','approved',v_leave.revision+1,v_count,coalesce(v_selected,'{}'));
  insert into public.activity_log(store_id,actor_id,action,detail) values(p_store,auth.uid(),'Έγκριση αιτήματος',p_request::text||' · '||v_count||' χρεώσιμες ημέρες');
  return jsonb_build_object('status','approved','charged_days',v_count,'excluded_days',v_leave.end_date-v_leave.start_date+1-v_count,'revision',v_leave.revision+1);
end;
$$;

create function public.revoke_leave_request(p_store uuid,p_request uuid,p_revision integer)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_leave public.leave_requests%rowtype; v_ledger public.leave_request_day_ledger%rowtype; v_shift public.shifts%rowtype; v_assignment jsonb;
begin
  if p_store is null or not public.actor_is_active() or not public.can_access_store(p_store)
    or (not public.is_master() and p_store is distinct from public.current_store()) then
    raise exception 'Δεν έχετε πρόσβαση ανάκλησης σε αυτό το κατάστημα' using errcode='42501'; end if;
  perform 1 from public.stores where id=p_store for update;
  select * into v_leave from public.leave_requests where id=p_request and store_id=p_store for update;
  if not found or v_leave.revision<>p_revision or v_leave.status not in ('pending','approved') then
    raise exception 'Η αίτηση άλλαξε ή δεν μπορεί να ανακληθεί. Ανανεώστε τη λίστα' using errcode='40001'; end if;
  if not public.can_manage_store(p_store) and not (v_leave.status='pending' and v_leave.user_id=auth.uid()) then
    raise exception 'Μόνο ο αιτών μπορεί να ακυρώσει δική του εκκρεμή αίτηση' using errcode='42501'; end if;
  perform 1 from public.profiles where id=v_leave.user_id for update;
  update public.leave_requests set status='revoked',revoked_by=auth.uid(),revoked_at=statement_timestamp(),
    revision=revision+1 where id=p_request;
  if v_leave.status='approved' then
    for v_ledger in select * from public.leave_request_day_ledger where request_id=p_request order by leave_date loop
      if v_ledger.applied_shift_id is null then continue; end if;
      select * into v_shift from public.shifts where id=v_ledger.applied_shift_id for update;
      if not found or v_shift.source_leave_request_id<>p_request or v_shift.revision<>v_ledger.applied_revision then
        raise exception 'Η βάρδια % άλλαξε μετά την έγκριση. Η ανάκληση ακυρώθηκε χωρίς μερικές αλλαγές',v_ledger.leave_date using errcode='40001'; end if;
      if v_ledger.before_shift is null then
        delete from public.shifts where id=v_shift.id;
      else
        v_assignment:=v_ledger.before_shift;
        update public.shifts set shift_type=v_assignment->>'shift_type',template_id=nullif(v_assignment->>'template_id','')::uuid,
          segments=nullif(v_assignment->'segments','null'::jsonb),start_time=v_assignment->>'start_time',end_time=v_assignment->>'end_time',
          note=v_assignment->>'note',source_leave_request_id=nullif(v_assignment->>'source_leave_request_id','')::uuid where id=v_shift.id;
      end if;
    end loop;
  end if;
  insert into public.leave_request_events(request_id,store_id,actor_id,action,previous_status,new_status,revision,charged_days,requested_rest_dates)
  values(p_request,p_store,auth.uid(),'revoked',v_leave.status,'revoked',v_leave.revision+1,
    (select count(*)::integer from public.leave_request_day_ledger where request_id=p_request and disposition='charged_leave'),v_leave.requested_rest_dates);
  insert into public.activity_log(store_id,actor_id,action,detail) values(p_store,auth.uid(),'Ανάκληση αιτήματος',p_request::text);
  return jsonb_build_object('status','revoked','revision',v_leave.revision+1);
end;
$$;

create function public.save_schedule_day(p_store uuid,p_date date,p_assignments jsonb)
returns integer language plpgsql security definer set search_path=public as $$
declare v_item jsonb; v_user uuid; v_count integer:=0;
begin
  if not public.can_manage_store(p_store) or (not public.is_master() and public.current_store() is distinct from p_store) then
    raise exception 'Δεν έχετε δικαίωμα αποθήκευσης ημέρας' using errcode='42501'; end if;
  if p_date is null or p_assignments is null or jsonb_typeof(p_assignments)<>'array' or jsonb_array_length(p_assignments)>100 then
    raise exception 'Μη έγκυρο ημερήσιο πρόγραμμα' using errcode='22023'; end if;
  perform 1 from public.stores where id=p_store for update;
  if exists(select 1 from jsonb_array_elements(p_assignments) x where jsonb_typeof(x)<>'object'
    or nullif(x->>'user_id','') is null or (x->>'date') is null or x->>'date'<>p_date::text
    or nullif(x->>'shift_type','') is null or (x->>'revision') is null) then
    raise exception 'Ελλιπής ή μη έγκυρη ανάθεση ημέρας' using errcode='22023'; end if;
  if exists(select 1 from jsonb_array_elements(p_assignments) x group by x->>'user_id' having count(*)>1) then
    raise exception 'Διπλή ανάθεση εργαζομένου' using errcode='23505'; end if;
  for v_item in select value from jsonb_array_elements(p_assignments) order by value->>'user_id' loop
    v_user:=(v_item->>'user_id')::uuid;
    perform public.save_shift_assignment(p_store,v_item);
    v_count:=v_count+1;
  end loop;
  return v_count;
end;
$$;

-- Extend the W2 public wrapper while retaining the protected private W1 base.
create or replace function public.read_schedule(p_store uuid,p_start date,p_end date,p_scope text default 'team')
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v_data jsonb; v_rows jsonb;
begin
  v_data:=app_private.read_schedule(p_store,p_start,p_end,p_scope);
  select coalesce(jsonb_agg(x.value || jsonb_build_object('segments',s.segments,'revision',s.revision,
    'template_id',s.template_id,'template_code',t.code,'template_name',t.name,
    'template_short_label',t.short_label,'template_color',t.color) order by s.date,s.user_id),'[]'::jsonb)
    into v_rows from jsonb_array_elements(v_data->'shifts') x join public.shifts s on s.id=(x.value->>'id')::uuid
      left join public.shift_templates t on t.id=s.template_id;
  v_data:=jsonb_set(v_data,'{shifts}',v_rows);
  select coalesce(jsonb_agg(x.value || jsonb_build_object(
    'revision',l.revision,'requested_rest_dates',to_jsonb(l.requested_rest_dates),
    'reviewed_at',l.reviewed_at,'revoked_at',l.revoked_at,
    'ledger',coalesce((select jsonb_agg(jsonb_build_object('date',g.leave_date,'disposition',g.disposition) order by g.leave_date)
      from public.leave_request_day_ledger g where g.request_id=l.id),'[]'::jsonb)
  ) order by l.created_at desc),'[]'::jsonb) into v_rows
  from jsonb_array_elements(v_data->'leaves') x join public.leave_requests l on l.id=(x.value->>'id')::uuid;
  v_data:=jsonb_set(v_data,'{leaves}',v_rows);
  return v_data;
end;
$$;

revoke all on function public.submit_leave_request(uuid,text,date,date,text,date[]),
  public.review_leave_request(uuid,uuid,integer,text,date[]),public.revoke_leave_request(uuid,uuid,integer),
  public.save_schedule_day(uuid,date,jsonb) from public,anon;
grant execute on function public.submit_leave_request(uuid,text,date,date,text,date[]),
  public.review_leave_request(uuid,uuid,integer,text,date[]),public.revoke_leave_request(uuid,uuid,integer),
  public.save_schedule_day(uuid,date,jsonb) to authenticated;
revoke all on function public.read_schedule(uuid,date,date,text) from public,anon;
grant execute on function public.read_schedule(uuid,date,date,text) to authenticated;
commit;

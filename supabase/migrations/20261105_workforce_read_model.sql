-- W1. Run AFTER all four preceding 20261105 authorization/support migrations.
begin;

-- Team scheduling needs absence dates, not colleagues' private request reasons.
-- The scoped read RPC below provides that limited projection separately.
create policy leave_reason_scope on public.leave_requests as restrictive for select to authenticated
  using (user_id = auth.uid() or public.can_manage_store(store_id));

create function public.read_schedule(p_store uuid, p_start date, p_end date, p_scope text default 'team')
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_manager boolean;
  v_staff jsonb;
  v_shifts jsonb;
  v_leaves jsonb;
  v_patterns jsonb;
  v_calendar jsonb;
begin
  if p_store is null or not public.can_access_store(p_store) then
    raise exception 'Δεν έχετε πρόσβαση στο πρόγραμμα αυτού του καταστήματος' using errcode = '42501';
  end if;
  if p_start is null or p_end is null or p_end <= p_start or p_end - p_start > 62
    or p_scope is null or p_scope not in ('own', 'team') then
    raise exception 'Μη έγκυρη περίοδος ή προβολή προγράμματος (έως 62 ημέρες)' using errcode = '22023';
  end if;
  v_manager := public.can_manage_store(p_store);

  with relevant_users as (
    select m.user_id from public.store_memberships m join public.profiles p on p.id = m.user_id
    where m.store_id = p_store and m.active and p.active and p.deleted_at is null and p.role <> 'master'
    union
    select s.user_id from public.shifts s where s.store_id = p_store and s.date >= p_start and s.date < p_end
    union
    select l.user_id from public.leave_requests l where l.store_id = p_store
      and l.start_date < p_end and l.end_date >= p_start
      and (v_manager or l.user_id = auth.uid() or l.status = 'approved')
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', p.id,
    'full_name', case when p.deleted_at is not null then 'Πρώην μέλος'
      when p.role = 'master' then 'Λογαριασμός πλατφόρμας' else p.full_name end,
    'active', p.active and p.deleted_at is null and p.role <> 'master' and exists (
      select 1 from public.store_memberships m where m.store_id = p_store and m.user_id = p.id and m.active)
  ) order by p.full_name, p.id), '[]'::jsonb) into v_staff
  from relevant_users r join public.profiles p on p.id = r.user_id
  where p_scope = 'team' or p.id = auth.uid();

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', s.id, 'store_id', s.store_id, 'user_id', s.user_id, 'date', s.date,
    'shift_type', s.shift_type, 'start_time', s.start_time, 'end_time', s.end_time,
    'note', case when v_manager or s.user_id = auth.uid() then s.note else null end
  ) order by s.date, s.user_id), '[]'::jsonb) into v_shifts
  from public.shifts s where s.store_id = p_store and s.date >= p_start and s.date < p_end
    and (p_scope = 'team' or s.user_id = auth.uid());

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', l.id, 'store_id', l.store_id, 'user_id', l.user_id, 'type', l.type,
    'start_date', l.start_date, 'end_date', l.end_date, 'status', l.status,
    'reason', case when v_manager or l.user_id = auth.uid() then l.reason else null end,
    'reviewed_by', case when v_manager or l.user_id = auth.uid() then l.reviewed_by else null end,
    'created_at', l.created_at
  ) order by l.created_at desc, l.id), '[]'::jsonb) into v_leaves
  from public.leave_requests l where l.store_id = p_store and l.start_date < p_end and l.end_date >= p_start
    and (p_scope = 'team' or l.user_id = auth.uid())
    and (v_manager or l.user_id = auth.uid() or l.status = 'approved');

  select coalesce(jsonb_agg(jsonb_build_object(
    'store_id', p.store_id, 'weekday', p.weekday, 'closed', p.closed, 'level', p.level,
    'start_time', p.start_time, 'end_time', p.end_time,
    'note', case when v_manager then p.note else null end
  ) order by p.weekday), '[]'::jsonb) into v_patterns
  from public.store_patterns p where p.store_id = p_store;

  select coalesce(jsonb_agg(to_jsonb(c) order by c.date), '[]'::jsonb) into v_calendar
  from public.store_calendar c where c.store_id = p_store and c.date >= p_start and c.date < p_end;

  return jsonb_build_object('store_id', p_store, 'start', p_start, 'end', p_end, 'scope', p_scope,
    'can_manage', v_manager, 'min_staff', (select coalesce(min_staff, 0) from public.stores where id = p_store),
    'staff', v_staff, 'shifts', v_shifts, 'leaves', v_leaves,
    'patterns', v_patterns, 'calendar', v_calendar);
end;
$$;
revoke all on function public.read_schedule(uuid, date, date, text) from public, anon;
grant execute on function public.read_schedule(uuid, date, date, text) to authenticated;

commit;

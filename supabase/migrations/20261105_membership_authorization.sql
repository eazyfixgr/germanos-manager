-- Phase 1.2a: store-scoped authority. Run AFTER the 20261104 migrations.
-- No historical membership/ownership rows are rewritten by this migration.
begin;

create or replace function public.actor_is_active()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles
    where id = auth.uid() and active and deleted_at is null);
$$;

create or replace function public.is_org_member(p_org uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.actor_is_active() and exists (
    select 1 from public.organization_memberships
    where organization_id = p_org and user_id = auth.uid());
$$;

create or replace function public.is_org_manager(p_org uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.actor_is_active() and exists (
    select 1 from public.organization_memberships where organization_id = p_org
      and user_id = auth.uid() and role in ('owner', 'admin'));
$$;

create or replace function public.can_access_store(p_store uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.actor_is_active() and exists (
    select 1 from public.stores s where s.id = p_store and s.deleted_at is null
      and (public.is_master() or public.is_org_manager(s.organization_id)
        or exists (select 1 from public.store_memberships m
          where m.store_id = s.id and m.user_id = auth.uid() and m.active)));
$$;

create or replace function public.can_manage_store(p_store uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.can_access_store(p_store) and (
    public.is_master() or public.is_org_manager(public.organization_for_store(p_store))
    or exists (select 1 from public.store_memberships m
      where m.store_id = p_store and m.user_id = auth.uid() and m.active and m.role = 'admin'));
$$;

create or replace function public.can_lead_store(p_store uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.can_manage_store(p_store) and (
    public.is_master() or public.is_org_manager(public.organization_for_store(p_store))
    or exists (select 1 from public.store_memberships m
      where m.store_id = p_store and m.user_id = auth.uid() and m.active and m.is_primary));
$$;

create or replace function public.current_store()
returns uuid language sql stable security definer set search_path = public as $$
  select coalesce(p.active_store_id, p.store_id) from public.profiles p
  where p.id = auth.uid() and p.active and p.deleted_at is null
    and public.can_access_store(coalesce(p.active_store_id, p.store_id));
$$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_master() or public.can_manage_store(public.current_store());
$$;

create or replace function public.is_primary_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_master() or public.can_lead_store(public.current_store());
$$;

create or replace function public.can_edit_points()
returns boolean language sql stable security definer set search_path = public as $$
  select public.actor_is_active() and exists (
    select 1 from public.store_memberships m where m.user_id = auth.uid()
      and m.store_id = public.current_store() and m.active and m.can_edit_points);
$$;

-- A self-edit may update contact fields, never identity, lifecycle or authority.
-- Active store changes are validated even for calls that bypass the UI.
create or replace function public.protect_profile_fields()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return new; end if;
  if new.id is distinct from old.id or new.email is distinct from old.email
    or new.created_at is distinct from old.created_at then
    raise exception 'Δεν επιτρέπεται αλλαγή ταυτότητας λογαριασμού' using errcode = '42501';
  end if;
  if new.active_store_id is distinct from old.active_store_id then
    if new.id <> auth.uid() or not public.can_access_store(new.active_store_id) then
      raise exception 'Μη εξουσιοδοτημένη αλλαγή καταστήματος' using errcode = '42501';
    end if;
  end if;
  if public.is_master() then return new; end if;
  if new.store_id is distinct from old.store_id or new.role = 'master' or old.role = 'master' then
    raise exception 'Δεν επιτρέπεται αλλαγή ιδιοκτησίας λογαριασμού' using errcode = '42501';
  end if;
  if not public.can_manage_store(old.store_id) then
    if row(new.role, new.active, new.can_edit_points, new.is_primary, new.is_seller,
      new.deleted_at, new.deleted_by, new.pending_store_name, new.pending_store_code)
      is distinct from row(old.role, old.active, old.can_edit_points, old.is_primary, old.is_seller,
      old.deleted_at, old.deleted_by, old.pending_store_name, old.pending_store_code) then
      raise exception 'Δεν έχετε δικαίωμα αλλαγής δικαιωμάτων' using errcode = '42501';
    end if;
  elsif not public.can_lead_store(old.store_id) then
    if new.role is distinct from old.role or new.is_primary is distinct from old.is_primary then
      raise exception 'Απαιτείται κύριος υπεύθυνος' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

-- Do not recreate a revoked membership when editing a name or switching stores.
create or replace function public.sync_store_membership()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' then
    if row(new.store_id, new.role, new.is_primary, new.is_seller, new.can_edit_points,
      new.active, new.deleted_at) is not distinct from row(old.store_id, old.role,
      old.is_primary, old.is_seller, old.can_edit_points, old.active, old.deleted_at) then
      return new;
    end if;
  end if;
  if not new.active or new.deleted_at is not null then
    update public.store_memberships set active = false where user_id = new.id;
  end if;
  if new.store_id is not null then
    insert into public.store_memberships(store_id, user_id, role, is_primary, is_seller, can_edit_points, active)
    values (new.store_id, new.id, case when new.role = 'admin' then 'admin' else 'user' end,
      new.is_primary, new.is_seller, new.can_edit_points, new.active and new.deleted_at is null)
    on conflict (store_id, user_id) do update set role = excluded.role,
      is_primary = excluded.is_primary, is_seller = excluded.is_seller,
      can_edit_points = excluded.can_edit_points, active = excluded.active;
  end if;
  return new;
end;
$$;

-- Store admins must not move a store to a different organization through UPDATE.
create or replace function public.protect_store_tenant()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.is_master()
    and (new.organization_id is distinct from old.organization_id or new.id is distinct from old.id) then
    raise exception 'Δεν επιτρέπεται αλλαγή οργανισμού καταστήματος' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger trg_protect_store_tenant before update on public.stores
  for each row execute function public.protect_store_tenant();

-- The platform master may select a store, but must not acquire tenant membership
-- as a side effect of creating one. Organization managers keep a store assignment.
create or replace function public.create_org_store(
  p_org uuid, p_name text, p_code text, p_address text default null,
  p_phone text default null, p_open_hours text default null
)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_store uuid;
begin
  if p_org is null then raise exception 'Μη έγκυρος οργανισμός'; end if;
  if not (public.is_master() or public.is_org_manager(p_org)) then
    raise exception 'Δεν έχετε δικαίωμα δημιουργίας καταστήματος' using errcode = '42501';
  end if;
  if p_name is null or trim(p_name) = '' then raise exception 'Απαιτείται όνομα καταστήματος'; end if;
  if p_code is null or trim(p_code) = '' then raise exception 'Απαιτείται κωδικός καταστήματος'; end if;
  begin
    insert into public.stores(name, code, address, phone, open_hours, organization_id)
    values (trim(p_name), upper(trim(p_code)), p_address, p_phone, p_open_hours, p_org)
    returning id into v_store;
  exception when unique_violation then
    raise exception 'Ο κωδικός καταστήματος χρησιμοποιείται ήδη';
  end;
  if not public.is_master() then
    insert into public.store_memberships(store_id, user_id, role, is_primary, is_seller, can_edit_points, active)
    select v_store, p.id, 'admin', true, p.is_seller, p.can_edit_points, true
    from public.profiles p where p.id = auth.uid();
  end if;
  update public.profiles set active_store_id = v_store where id = auth.uid();
  return v_store;
end;
$$;
revoke all on function public.create_org_store(uuid, text, text, text, text, text) from public;
grant execute on function public.create_org_store(uuid, text, text, text, text, text) to authenticated;

-- Membership mutations become RPC-only in the next migration. Read policies stay.
drop policy if exists store_memberships_write on public.store_memberships;
drop policy if exists organization_memberships_write on public.organization_memberships;
revoke insert, update, delete on public.store_memberships from anon, authenticated;
revoke insert, update, delete on public.organization_memberships from anon, authenticated;

-- Eliminate the legacy home-store fallback from store reads too.
drop policy if exists stores_select on public.stores;
create policy stores_select on public.stores for select
  using (public.can_access_store(id));
drop policy if exists stores_write on public.stores;
create policy stores_write on public.stores for all
  using (public.can_manage_store(id))
  with check (public.can_manage_store(id));

-- Phase 0's atomic RPC silently filtered bad rows AFTER deleting the old month.
-- Reject the entire payload before changing data. Serialize writers per store.
create or replace function public.replace_month_shifts(
  p_store uuid, p_month text, p_shifts jsonb, p_fairness jsonb
)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_start date;
  v_end date;
begin
  if p_store is null or not public.can_manage_store(p_store) then
    raise exception 'Δεν έχετε δικαίωμα επεξεργασίας προγράμματος' using errcode = '42501';
  end if;
  if p_month is null or p_month !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then
    raise exception 'Μη έγκυρος μήνας' using errcode = '22023';
  end if;
  v_start := (p_month || '-01')::date;
  v_end := (v_start + interval '1 month')::date;
  if p_shifts is null or jsonb_typeof(p_shifts) <> 'array'
    or p_fairness is null or jsonb_typeof(p_fairness) <> 'array' then
    raise exception 'Αναμένονται λίστες βαρδιών και δικαιοσύνης' using errcode = '22023';
  end if;
  perform 1 from public.stores where id = p_store for update;
  if exists (select 1 from jsonb_array_elements(p_shifts) x where
    jsonb_typeof(x) <> 'object' or nullif(x->>'user_id', '') is null
    or nullif(x->>'date', '') is null or nullif(x->>'shift_type', '') is null) then
    raise exception 'Ελλιπής εγγραφή βάρδιας' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_array_elements(p_shifts) x where
    (x->>'date')::date < v_start or (x->>'date')::date >= v_end
    or (x->>'shift_type') not in ('open','mid','close','custom','repo','adeia','split','short','full')
    or not exists (select 1 from public.store_memberships m join public.profiles p on p.id = m.user_id
      where m.store_id = p_store and m.user_id = (x->>'user_id')::uuid
        and m.active and p.active and p.deleted_at is null)) then
    raise exception 'Βάρδια εκτός μήνα ή μη διαθέσιμος υπάλληλος' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_array_elements(p_shifts) x
    group by (x->>'user_id')::uuid, (x->>'date')::date having count(*) > 1) then
    raise exception 'Διπλή βάρδια υπαλλήλου την ίδια ημέρα' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_array_elements(p_fairness) x where
    jsonb_typeof(x) <> 'object' or nullif(x->>'user_id', '') is null
    or (x->>'split_offs') is null or (x->>'short_offs') is null) then
    raise exception 'Ελλιπής εγγραφή δικαιοσύνης' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_array_elements(p_fairness) x where
    (x->>'split_offs')::integer < 0 or (x->>'short_offs')::integer < 0
    or not exists (select 1 from public.store_memberships m join public.profiles p on p.id = m.user_id
      where m.store_id = p_store and m.user_id = (x->>'user_id')::uuid
        and m.active and p.active and p.deleted_at is null)) then
    raise exception 'Μη έγκυρη κατανομή δικαιοσύνης' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_array_elements(p_fairness) x
    group by (x->>'user_id')::uuid having count(*) > 1) then
    raise exception 'Διπλή εγγραφή δικαιοσύνης' using errcode = '22023';
  end if;

  delete from public.shifts where store_id = p_store and date >= v_start and date < v_end;
  insert into public.shifts(store_id, user_id, date, shift_type, start_time, end_time, note)
  select p_store, (x->>'user_id')::uuid, (x->>'date')::date, x->>'shift_type',
    nullif(x->>'start_time', ''), nullif(x->>'end_time', ''), nullif(x->>'note', '')
  from jsonb_array_elements(p_shifts) x;
  delete from public.schedule_fairness where store_id = p_store and month = p_month;
  insert into public.schedule_fairness(store_id, user_id, month, split_offs, short_offs)
  select p_store, (x->>'user_id')::uuid, p_month,
    (x->>'split_offs')::integer, (x->>'short_offs')::integer
  from jsonb_array_elements(p_fairness) x;
  insert into public.activity_log(store_id, actor_id, action, detail)
  values (p_store, auth.uid(), 'Αυτόματο πρόγραμμα', p_month || ': ' || jsonb_array_length(p_shifts) || ' βάρδιες');
end;
$$;
revoke all on function public.replace_month_shifts(uuid, text, jsonb, jsonb) from public;
grant execute on function public.replace_month_shifts(uuid, text, jsonb, jsonb) to authenticated;

-- Return effective capabilities; frontend roles must match these DB checks.
create or replace function public.store_capabilities(p_store uuid)
returns table(can_manage boolean, can_lead boolean, can_edit_points boolean, org_role text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.can_access_store(p_store) then
    raise exception 'Δεν έχετε πρόσβαση σε αυτό το κατάστημα' using errcode = '42501';
  end if;
  return query select public.can_manage_store(p_store), public.can_lead_store(p_store),
    public.can_manage_store(p_store) or exists (select 1 from public.store_memberships m
      where m.store_id = p_store and m.user_id = auth.uid() and m.active and m.can_edit_points),
    (select om.role from public.organization_memberships om
      where om.organization_id = public.organization_for_store(p_store) and om.user_id = auth.uid());
end;
$$;
revoke all on function public.store_capabilities(uuid) from public;
grant execute on function public.store_capabilities(uuid) to authenticated;

-- Existing self-row policies must not keep operational data readable after
-- deactivation/soft deletion. Profiles remain readable to self for approval UI.
do $$
declare v_table text;
begin
  foreach v_table in array array[
    'stores', 'organizations', 'organization_memberships', 'store_memberships',
    'store_targets', 'employee_targets', 'point_entries', 'service_categories',
    'store_categories', 'store_category_targets', 'seller_category_targets',
    'sales_entries', 'orders', 'order_events', 'shifts', 'leave_requests',
    'activity_log', 'store_calendar', 'store_patterns', 'schedule_fairness',
    'task_templates', 'store_tasks'
  ] loop
    execute format('create policy active_account_required on public.%I as restrictive for all to authenticated using (public.actor_is_active()) with check (public.actor_is_active())', v_table);
  end loop;
end $$;

-- Self-row read policies predate memberships. Owning/being assigned a row must
-- not retain access to a tenant after that store membership has been revoked.
do $$
declare v_table text;
begin
  foreach v_table in array array['sales_entries', 'seller_category_targets', 'store_tasks'] loop
    execute format('create policy store_access_required on public.%I as restrictive for all to authenticated using (public.can_access_store(store_id)) with check (public.can_access_store(store_id))', v_table);
  end loop;
end $$;

commit;

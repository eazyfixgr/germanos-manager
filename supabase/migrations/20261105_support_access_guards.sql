-- Phase 1.2d. Run AFTER 20261105_support_access.sql, before the new frontend.
begin;

-- Retain an event's tenant scope during parent-order cascade deletion, when the
-- parent row is already invisible to a trigger's SELECT.
alter table public.order_events add column store_id uuid references public.stores(id);
update public.order_events e set store_id = o.store_id from public.orders o where o.id = e.order_id;
alter table public.order_events alter column store_id set not null;
create function public.set_order_event_store()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  select store_id into new.store_id from public.orders where id = new.order_id;
  if new.store_id is null then raise exception 'Η παραγγελία δεν βρέθηκε' using errcode = '23503'; end if;
  return new;
end;
$$;
create trigger trg_order_event_store before insert or update on public.order_events
  for each row execute function public.set_order_event_store();

-- Restrictive policies intersect every permissive legacy `is_master()` exception.
do $$
declare v_table text;
begin
  foreach v_table in array array[
    'store_targets', 'employee_targets', 'point_entries', 'store_categories',
    'store_category_targets', 'seller_category_targets', 'sales_entries', 'orders',
    'shifts', 'leave_requests', 'activity_log', 'store_calendar', 'store_patterns',
    'schedule_fairness', 'task_templates', 'store_tasks', 'store_memberships'
  ] loop
    execute format('create policy master_support_required on public.%I as restrictive for all to authenticated using (not public.is_master() or public.has_support_access(store_id)) with check (not public.is_master() or public.has_support_access(store_id))', v_table);
  end loop;
end $$;
create policy master_support_required on public.order_events as restrictive for all to authenticated
  using (not public.is_master() or public.has_support_access(store_id))
  with check (not public.is_master() or public.has_support_access(store_id));
create policy master_profile_scope on public.profiles as restrictive for all to authenticated
  using (not public.is_master() or id = auth.uid() or role = 'master'
    or (store_id is null and not active and deleted_at is null and pending_store_code is not null)
    or public.has_support_access(store_id))
  with check (not public.is_master() or id = auth.uid() or role = 'master'
    or (store_id is null and not active and deleted_at is null and pending_store_code is not null)
    or public.has_support_access(store_id));
create policy master_organization_scope on public.organizations as restrictive for all to authenticated
  using (not public.is_master() or exists (select 1 from public.support_access_sessions ss
    where ss.organization_id = organizations.id and public.has_support_access(ss.store_id)))
  with check (not public.is_master() or exists (select 1 from public.support_access_sessions ss
    where ss.organization_id = organizations.id and public.has_support_access(ss.store_id)));
-- Store-scoped support must not expose/change organization-wide staff/authority.
create policy master_org_memberships_denied on public.organization_memberships as restrictive for all to authenticated
  using (not public.is_master()) with check (not public.is_master());
create policy master_org_audit_denied on public.organization_audit_events as restrictive for all to authenticated
  using (not public.is_master()) with check (not public.is_master());
create policy master_org_update_denied on public.organizations as restrictive for update to authenticated
  using (not public.is_master()) with check (not public.is_master());
create policy master_org_delete_denied on public.organizations as restrictive for delete to authenticated
  using (not public.is_master());
create policy stores_platform_insert on public.stores for insert to authenticated
  with check (public.is_master());

-- Promotion into the platform role also removes tenant authority: it must not
-- strand an organization whose last owner would cease to be a tenant manager.
create or replace function public.guard_last_active_owner_profile()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_org uuid;
begin
  if tg_op = 'UPDATE' and new.active and new.deleted_at is null and new.role <> 'master' then return new; end if;
  for v_org in select organization_id from public.organization_memberships
    where user_id = old.id and role = 'owner' order by organization_id loop
    perform 1 from public.organizations where id = v_org for update;
    if found and not exists (
      select 1 from public.organization_memberships m join public.profiles p on p.id = m.user_id
      where m.organization_id = v_org and m.user_id <> old.id and m.role = 'owner'
        and p.active and p.deleted_at is null and p.role <> 'master'
    ) then raise exception 'Ορίστε άλλον ενεργό ιδιοκτήτη πριν αφαιρέσετε τον λογαριασμό' using errcode = '23514'; end if;
  end loop;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
create or replace function public.guard_organization_owner()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' and (new.organization_id <> old.organization_id or new.user_id <> old.user_id) then
    raise exception 'Δεν επιτρέπεται μεταφορά συμμετοχής' using errcode = '22023';
  end if;
  if old.role = 'owner' and (tg_op = 'DELETE' or new.role <> 'owner') then
    perform 1 from public.organizations where id = old.organization_id for update;
    if found and not exists (
      select 1 from public.organization_memberships m join public.profiles p on p.id = m.user_id
      where m.organization_id = old.organization_id and m.user_id <> old.user_id and m.role = 'owner'
        and p.active and p.deleted_at is null and p.role <> 'master'
    ) then raise exception 'Πρέπει να παραμείνει τουλάχιστον ένας ενεργός ιδιοκτήτης' using errcode = '23514'; end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

-- BEFORE guards also cover SECURITY DEFINER RPCs, which bypass table RLS.
-- AFTER audit stores actor/session and old/new rows in the same transaction.
create function public.guard_support_write()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_old jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) else '{}'::jsonb end;
  v_new jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) else '{}'::jsonb end;
  v_store uuid;
  v_new_store uuid;
  v_bootstrap boolean := false;
begin
  if not public.is_master() then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  if tg_table_name = 'profiles' then
    -- Master identity/contact management is platform-level, never tenant access.
    if coalesce(v_old->>'id', v_new->>'id') = auth.uid()::text
      or coalesce(v_old->>'role', v_new->>'role') = 'master' then
      if tg_op = 'DELETE' then return old; end if;
      return new;
    end if;
    -- New-store approval is platform onboarding, not access to an existing tenant.
    v_bootstrap := tg_op = 'UPDATE' and (v_old->>'store_id') is null
      and (v_old->>'active')::boolean = false and nullif(v_old->>'pending_store_code', '') is not null
      and exists (select 1 from public.stores s where s.id = (v_new->>'store_id')::uuid
        and upper(s.code) = upper(v_old->>'pending_store_code')
        and s.created_at >= transaction_timestamp());
    if tg_op = 'UPDATE' and (v_old->>'store_id') is not null
      and v_old->>'store_id' is distinct from v_new->>'store_id' and v_new->>'role' <> 'master' then
      raise exception 'Η υποστήριξη δεν μεταφέρει λογαριασμούς σε άλλο κατάστημα' using errcode = '42501';
    end if;
  end if;
  if tg_table_name = 'stores' then
    if tg_op = 'INSERT' then return new; end if; -- Explicit platform store creation.
    v_store := (v_old->>'id')::uuid;
    if tg_op <> 'DELETE' and row(v_old->>'id', v_old->>'organization_id')
      is distinct from row(v_new->>'id', v_new->>'organization_id') then
      raise exception 'Η υποστήριξη δεν μεταφέρει καταστήματα σε άλλον οργανισμό' using errcode = '42501';
    end if;
  else
    v_store := coalesce(v_old->>'store_id', v_new->>'store_id')::uuid;
    v_new_store := (v_new->>'store_id')::uuid;
  end if;
  if not v_bootstrap and (
    (v_store is not null and not public.has_support_access(v_store))
    or (v_new_store is not null and not public.has_support_access(v_new_store))
    or (v_store is null and tg_table_name <> 'profiles')
  ) then
    raise exception 'Απαιτείται ενεργή πρόσβαση υποστήριξης για αυτό το κατάστημα' using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create function public.audit_support_write()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_old jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) else null end;
  v_new jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) else null end;
  v_row jsonb := coalesce(v_new, v_old);
  v_store uuid;
  v_org uuid;
  v_session public.support_access_sessions%rowtype;
begin
  if not public.is_master() then return null; end if;
  if tg_table_name = 'profiles' and v_row->>'id' = auth.uid()::text then return null; end if;
  if tg_table_name = 'stores' then v_store := (v_row->>'id')::uuid;
  else v_store := coalesce(v_old->>'store_id', v_new->>'store_id')::uuid;
  end if;
  select * into v_session from public.support_access_sessions
    where master_id = auth.uid() and store_id = v_store and ended_at is null
      and expires_at > statement_timestamp();
  select organization_id into v_org from public.stores where id = v_store;
  insert into public.support_audit_events(session_id, actor_id, store_id, organization_id,
    action, table_name, record_id, reason, before_data, after_data)
  values (v_session.id, auth.uid(), v_store, v_org,
    case when v_session.id is null then 'platform.' else 'data.' end || lower(tg_op),
    tg_table_name, v_row->>'id', coalesce(v_session.reason, 'Διαχείριση πλατφόρμας / αίτησης νέου καταστήματος'), v_old, v_new);
  return null;
end;
$$;
do $$
declare v_table text;
begin
  foreach v_table in array array[
    'stores', 'profiles', 'store_targets', 'employee_targets', 'point_entries', 'store_categories',
    'store_category_targets', 'seller_category_targets', 'sales_entries', 'orders', 'order_events',
    'shifts', 'leave_requests', 'activity_log', 'store_calendar', 'store_patterns',
    'schedule_fairness', 'task_templates', 'store_tasks'
  ] loop
    execute format('create trigger trg_support_write_guard before insert or update or delete on public.%I for each row execute function public.guard_support_write()', v_table);
    execute format('create trigger trg_support_write_audit after insert or update or delete on public.%I for each row execute function public.audit_support_write()', v_table);
  end loop;
end $$;

-- Read RPCs bypass RLS too: remove their legacy master-wide exception.
create or replace function public.store_category_sales(p_store uuid, p_month text)
returns table(category_id uuid, quantity numeric)
language plpgsql stable security definer set search_path = public as $$
begin
  if p_store is null or not public.can_access_store(p_store)
    or (not public.is_master() and p_store is distinct from public.current_store()) then
    raise exception 'Δεν έχετε πρόσβαση σε αυτό το κατάστημα' using errcode = '42501';
  end if;
  return query select s.category_id, coalesce(sum(s.quantity), 0) from public.sales_entries s
    where s.store_id = p_store and s.status = 'active' and s.date >= (p_month || '-01')::date
      and s.date < ((p_month || '-01')::date + interval '1 month')::date group by s.category_id;
end;
$$;
create or replace function public.store_daily_sales(p_store uuid, p_month text)
returns table(sales_date date, quantity numeric)
language plpgsql stable security definer set search_path = public as $$
begin
  if p_store is null or not public.can_access_store(p_store)
    or (not public.is_master() and p_store is distinct from public.current_store()) then
    raise exception 'Δεν έχετε πρόσβαση σε αυτό το κατάστημα' using errcode = '42501';
  end if;
  return query select s.date, coalesce(sum(s.quantity), 0) from public.sales_entries s
    join public.service_categories c on c.id = s.category_id
    where s.store_id = p_store and s.status = 'active' and c.unit = 'count'
      and s.date >= (p_month || '-01')::date and s.date < ((p_month || '-01')::date + interval '1 month')::date
    group by s.date order by s.date;
end;
$$;

-- Keep tested owner/admin implementations private; store support cannot change
-- organization-wide memberships or enumerate personnel from other stores.
create schema if not exists app_private;
revoke all on schema app_private from public, anon, authenticated;
alter function public.list_organization_people(uuid) set schema app_private;
alter function public.set_organization_member(uuid, uuid, text) set schema app_private;
alter function public.create_org_store(uuid, text, text, text, text, text) set schema app_private;
revoke all on function app_private.list_organization_people(uuid),
  app_private.set_organization_member(uuid, uuid, text),
  app_private.create_org_store(uuid, text, text, text, text, text) from public, anon, authenticated;
-- The private mutation calls the public list RPC; the caller's JWT is preserved.
create function public.list_organization_people(p_org uuid)
returns table(user_id uuid, full_name text, email text, organization_role text)
language plpgsql stable security definer set search_path = public as $$
begin
  if public.is_master() then raise exception 'Η διαχείριση μελών ανήκει στον ιδιοκτήτη οργανισμού' using errcode = '42501'; end if;
  return query select * from app_private.list_organization_people(p_org);
end;
$$;
create function public.set_organization_member(p_org uuid, p_user uuid, p_role text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if public.is_master() then raise exception 'Η διαχείριση μελών ανήκει στον ιδιοκτήτη οργανισμού' using errcode = '42501'; end if;
  perform app_private.set_organization_member(p_org, p_user, p_role);
end;
$$;
create function public.create_org_store(p_org uuid, p_name text, p_code text,
  p_address text default null, p_phone text default null, p_open_hours text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if public.is_master() then
    if p_org is null or not exists (select 1 from public.organizations where id = p_org)
      or nullif(trim(p_name), '') is null or nullif(trim(p_code), '') is null then
      raise exception 'Μη έγκυρα στοιχεία καταστήματος' using errcode = '22023';
    end if;
    insert into public.stores(name, code, address, phone, open_hours, organization_id)
    values (trim(p_name), upper(trim(p_code)), p_address, p_phone, p_open_hours, p_org) returning id into v_id;
    return v_id; -- Creation grants neither tenant membership nor support access.
  end if;
  return app_private.create_org_store(p_org, p_name, p_code, p_address, p_phone, p_open_hours);
end;
$$;

-- Bootstrap approval uses one profile update. active_store_id remains null until
-- the new owner signs in, avoiding an unauthorized cross-user store switch.
create or replace function public.approve_user(target uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_profile public.profiles%rowtype; v_store uuid; v_org uuid;
begin
  select * into v_profile from public.profiles where id = target and deleted_at is null for update;
  if not found then raise exception 'Ο χρήστης δεν βρέθηκε'; end if;
  if v_profile.store_id is null then
    if not public.is_master() then raise exception 'Νέο κατάστημα: απαιτείται master' using errcode = '42501'; end if;
    if v_profile.active or nullif(v_profile.pending_store_code, '') is null
      or nullif(v_profile.pending_store_name, '') is null then raise exception 'Μη έγκυρη αίτηση νέου καταστήματος'; end if;
    -- An already existing code is not onboarding; it requires that store's support.
    if exists (select 1 from public.stores where upper(code) = upper(v_profile.pending_store_code)) then
      raise exception 'Ο κωδικός καταστήματος χρησιμοποιείται ήδη';
    end if;
    insert into public.organizations(name, created_by) values (v_profile.pending_store_name, target) returning id into v_org;
    insert into public.stores(name, code, organization_id)
      values (v_profile.pending_store_name, upper(v_profile.pending_store_code), v_org) returning id into v_store;
    insert into public.organization_memberships(organization_id, user_id, role) values (v_org, target, 'owner');
    update public.profiles set store_id = v_store, active = true,
      pending_store_name = null, pending_store_code = null where id = target;
  else
    if not public.can_manage_store(v_profile.store_id)
      or (not public.is_master() and v_profile.store_id is distinct from public.current_store()) then
      raise exception 'Δεν έχετε δικαίωμα έγκρισης σε αυτό το κατάστημα' using errcode = '42501';
    end if;
    update public.profiles set active = true where id = target and not active;
  end if;
end;
$$;

revoke all on function public.list_organization_people(uuid),
  public.set_organization_member(uuid, uuid, text),
  public.create_org_store(uuid, text, text, text, text, text) from public, anon;
grant execute on function public.list_organization_people(uuid),
  public.set_organization_member(uuid, uuid, text),
  public.create_org_store(uuid, text, text, text, text, text) to authenticated;

commit;

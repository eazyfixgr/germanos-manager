-- ============================================================
-- Phase 1.1 — Organizations, memberships, multi-store access
-- Additive and backward compatible for the existing demo database.
-- ============================================================

create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.organization_memberships (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null default 'member' check (role in ('owner','admin','member')),
  created_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);

create table if not exists public.store_memberships (
  store_id uuid not null references public.stores(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null default 'user' check (role in ('admin','user')),
  is_primary boolean not null default false,
  is_seller boolean not null default true,
  can_edit_points boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (store_id, user_id)
);

alter table public.stores add column if not exists organization_id uuid references public.organizations(id) on delete set null;
alter table public.profiles add column if not exists active_store_id uuid references public.stores(id) on delete set null;

create index if not exists idx_stores_organization on public.stores(organization_id);
create index if not exists idx_store_memberships_user on public.store_memberships(user_id);
create index if not exists idx_org_memberships_user on public.organization_memberships(user_id);

-- ------------------------------------------------------------
-- Helpers
-- ------------------------------------------------------------
create or replace function public.organization_for_store(p_store uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select organization_id from public.stores where id = p_store;
$$;

create or replace function public.is_org_member(p_org uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.organization_memberships
    where organization_id = p_org and user_id = auth.uid()
  );
$$;

create or replace function public.is_org_manager(p_org uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.organization_memberships
    where organization_id = p_org
      and user_id = auth.uid()
      and role in ('owner','admin')
  );
$$;

create or replace function public.can_access_store(p_store uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.stores where id = p_store and deleted_at is null
  ) and (
    public.is_master()
    or exists (
      select 1 from public.store_memberships
      where store_id = p_store and user_id = auth.uid() and active = true
    )
    or exists (
      select 1
      from public.stores s
      join public.organization_memberships om on om.organization_id = s.organization_id
      where s.id = p_store and om.user_id = auth.uid() and om.role in ('owner','admin')
    )
  );
$$;

create or replace function public.current_store()
returns uuid language sql stable security definer set search_path = public as $$
  with p as (
    select store_id, active_store_id
    from public.profiles
    where id = auth.uid() and active = true and deleted_at is null
  )
  select case
    when p.active_store_id is not null and public.can_access_store(p.active_store_id) then p.active_store_id
    else p.store_id
  end
  from p;
$$;

create or replace function public.set_active_store(p_store uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.can_access_store(p_store) then
    raise exception 'Δεν έχετε πρόσβαση σε αυτό το κατάστημα';
  end if;
  update public.profiles set active_store_id = p_store where id = auth.uid();
end;
$$;
revoke all on function public.set_active_store(uuid) from public;
grant execute on function public.set_active_store(uuid) to authenticated;

-- Δημιουργία καταστήματος μέσα σε organization (owner/admin ή master)
create or replace function public.create_org_store(
  p_org uuid,
  p_name text,
  p_code text,
  p_address text default null,
  p_phone text default null,
  p_open_hours text default null
)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_store uuid;
  v_profile public.profiles%rowtype;
begin
  if p_org is null then
    raise exception 'Μη έγκυρος οργανισμός';
  end if;
  if not (public.is_master() or public.is_org_manager(p_org)) then
    raise exception 'Δεν έχετε δικαίωμα δημιουργίας καταστήματος';
  end if;
  if p_name is null or trim(p_name) = '' then
    raise exception 'Απαιτείται όνομα καταστήματος';
  end if;
  if p_code is null or trim(p_code) = '' then
    raise exception 'Απαιτείται κωδικός καταστήματος';
  end if;

  select * into v_profile from public.profiles where id = auth.uid();

  begin
    insert into public.stores (name, code, address, phone, open_hours, organization_id)
    values (trim(p_name), upper(trim(p_code)), p_address, p_phone, p_open_hours, p_org)
    returning id into v_store;
  exception when unique_violation then
    raise exception 'Ο κωδικός καταστήματος χρησιμοποιείται ήδη';
  end;

  insert into public.store_memberships (store_id, user_id, role, is_primary, is_seller, can_edit_points, active)
  values (v_store, auth.uid(), 'admin', true, coalesce(v_profile.is_seller, false), coalesce(v_profile.can_edit_points, false), true)
  on conflict (store_id, user_id) do update
    set role = 'admin', is_primary = true, active = true;

  update public.profiles set active_store_id = v_store where id = auth.uid();

  return v_store;
end;
$$;
revoke all on function public.create_org_store(uuid, text, text, text, text, text) from public;
grant execute on function public.create_org_store(uuid, text, text, text, text, text) to authenticated;

-- ------------------------------------------------------------
-- New user trigger: set active_store_id
-- ------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_type text; v_name text; v_code text; s_id uuid;
begin
  v_type := coalesce(new.raw_user_meta_data->>'account_type', 'user');
  v_name := nullif(trim(coalesce(new.raw_user_meta_data->>'store_name', '')), '');
  v_code := nullif(trim(coalesce(new.raw_user_meta_data->>'store_code', '')), '');

  if v_type not in ('admin','user') then v_type := 'user'; end if;

  select id into s_id from public.stores
   where code is not null and upper(code) = upper(v_code)
   limit 1;

  if v_type = 'user' then
    if s_id is null then raise exception 'STORE_CODE_NOT_FOUND'; end if;
    insert into public.profiles
      (id, full_name, role, store_id, email, active, can_edit_points, is_primary, active_store_id)
    values (new.id, coalesce(nullif(new.raw_user_meta_data->>'full_name',''), new.email),
            'user', s_id, new.email, false, false, false, s_id)
    on conflict (id) do nothing;
  else
    if s_id is not null then
      insert into public.profiles
        (id, full_name, role, store_id, email, active, can_edit_points, is_primary, active_store_id)
      values (new.id, coalesce(nullif(new.raw_user_meta_data->>'full_name',''), new.email),
              'admin', s_id, new.email, false, false, false, s_id)
      on conflict (id) do nothing;
    else
      if v_name is null then raise exception 'STORE_NAME_REQUIRED'; end if;
      if v_code is null then raise exception 'STORE_CODE_REQUIRED'; end if;
      insert into public.profiles
        (id, full_name, role, store_id, email, active, can_edit_points, is_primary,
         pending_store_name, pending_store_code, active_store_id)
      values (new.id, coalesce(nullif(new.raw_user_meta_data->>'full_name',''), new.email),
              'admin', null, new.email, false, false, true, v_name, upper(v_code), null)
      on conflict (id) do nothing;
    end if;
  end if;

  return new;
end;
$$;

-- ------------------------------------------------------------
-- Approval: new store gets an organization + owner
-- ------------------------------------------------------------
create or replace function public.approve_user(target uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  tr text; ts uuid; pn text; pc text; s_id uuid; v_org uuid;
begin
  select role, store_id, pending_store_name, pending_store_code
    into tr, ts, pn, pc
    from public.profiles
   where id = target and deleted_at is null;

  if tr is null then raise exception 'Ο χρήστης δεν βρέθηκε'; end if;

  if not public.is_master() then
    if ts is null then raise exception 'Νέο κατάστημα: απαιτείται έγκριση από master'; end if;
    if ts is distinct from public.current_store() then raise exception 'Δεν έχετε πρόσβαση σε αυτό το κατάστημα'; end if;
    if not public.is_admin() then raise exception 'Δεν έχετε δικαίωμα έγκρισης'; end if;
  end if;

  if ts is null and pc is not null then
    select id into s_id from public.stores
     where code is not null and upper(code) = upper(pc)
     limit 1;
    if s_id is null then
      insert into public.stores (name, code) values (coalesce(pn, 'Κατάστημα'), upper(pc)) returning id into s_id;
      insert into public.organizations (name, created_by) values (coalesce(pn, 'Κατάστημα'), target) returning id into v_org;
      update public.stores set organization_id = v_org where id = s_id;
      insert into public.organization_memberships (organization_id, user_id, role)
      values (v_org, target, 'owner')
      on conflict (organization_id, user_id) do update set role = 'owner';
    end if;
    update public.profiles
       set store_id = s_id, active_store_id = s_id, pending_store_name = null, pending_store_code = null
     where id = target;
  end if;

  update public.profiles set active = true where id = target and active = false;
end;
$$;

-- ------------------------------------------------------------
-- Keep store_memberships in sync with the home-store profile fields
-- ------------------------------------------------------------
create or replace function public.sync_store_membership()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.store_id is not null then
    insert into public.store_memberships
      (store_id, user_id, role, is_primary, is_seller, can_edit_points, active)
    values (
      new.store_id, new.id,
      case when new.role in ('admin','master') then 'admin' else 'user' end,
      new.is_primary, new.is_seller, new.can_edit_points, new.active
    )
    on conflict (store_id, user_id) do update
      set role = excluded.role,
          is_primary = excluded.is_primary,
          is_seller = excluded.is_seller,
          can_edit_points = excluded.can_edit_points,
          active = excluded.active;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_sync_store_membership on public.profiles;
create trigger trg_sync_store_membership
  after insert or update on public.profiles
  for each row execute function public.sync_store_membership();

-- ------------------------------------------------------------
-- RLS
-- ------------------------------------------------------------
alter table public.organizations enable row level security;
alter table public.organization_memberships enable row level security;
alter table public.store_memberships enable row level security;

drop policy if exists organizations_select on public.organizations;
create policy organizations_select on public.organizations
  for select using (
    public.is_master()
    or public.is_org_member(id)
    or exists (
      select 1
      from public.stores s
      join public.store_memberships sm on sm.store_id = s.id
      where s.organization_id = organizations.id
        and sm.user_id = auth.uid()
        and sm.active = true
    )
  );

drop policy if exists organizations_write on public.organizations;
create policy organizations_write on public.organizations
  for insert with check (public.is_master());
drop policy if exists organizations_update on public.organizations;
create policy organizations_update on public.organizations
  for update using (public.is_master() or public.is_org_manager(id))
  with check (public.is_master() or public.is_org_manager(id));
drop policy if exists organizations_delete on public.organizations;
create policy organizations_delete on public.organizations
  for delete using (public.is_master());

drop policy if exists organization_memberships_select on public.organization_memberships;
create policy organization_memberships_select on public.organization_memberships
  for select using (
    public.is_master() or user_id = auth.uid() or public.is_org_member(organization_id)
  );
drop policy if exists organization_memberships_write on public.organization_memberships;
create policy organization_memberships_write on public.organization_memberships
  for all using (public.is_master() or public.is_org_manager(organization_id))
  with check (public.is_master() or public.is_org_manager(organization_id));

drop policy if exists store_memberships_select on public.store_memberships;
create policy store_memberships_select on public.store_memberships
  for select using (
    public.is_master()
    or user_id = auth.uid()
    or public.is_org_manager(public.organization_for_store(store_id))
    or (public.is_admin() and store_id = public.current_store())
  );
drop policy if exists store_memberships_write on public.store_memberships;
create policy store_memberships_write on public.store_memberships
  for all using (
    public.is_master()
    or public.is_org_manager(public.organization_for_store(store_id))
    or (public.is_admin() and store_id = public.current_store())
  ) with check (
    public.is_master()
    or public.is_org_manager(public.organization_for_store(store_id))
    or (public.is_admin() and store_id = public.current_store())
  );

drop policy if exists stores_select on public.stores;
create policy stores_select on public.stores
  for select using (
    public.is_master() or id = public.current_store() or public.can_access_store(id)
  );

drop policy if exists stores_write on public.stores;
create policy stores_write on public.stores
  for all using (
    public.is_master()
    or (public.is_admin() and id = public.current_store())
    or public.is_org_manager(organization_id)
  ) with check (
    public.is_master()
    or (public.is_admin() and id = public.current_store())
    or public.is_org_manager(organization_id)
  );

-- ------------------------------------------------------------
-- Seed: existing store becomes the first organization
-- ------------------------------------------------------------
do $$
declare
  v_org uuid;
  v_store_id uuid;
  v_store_name text;
  v_owner uuid;
begin
  if not exists (select 1 from public.organizations) then
    select id, name into v_store_id, v_store_name
    from public.stores order by created_at limit 1;
    if v_store_id is not null then
      select id into v_owner from public.profiles
       where role = 'admin' and is_primary and active and deleted_at is null
       order by created_at limit 1;
      if v_owner is null then
        select id into v_owner from public.profiles
         where role = 'admin' and active and deleted_at is null
         order by created_at limit 1;
      end if;
      insert into public.organizations (name, created_by)
      values (v_store_name, v_owner)
      returning id into v_org;
    end if;
  else
    select id into v_org from public.organizations order by created_at limit 1;
  end if;

  if v_org is not null then
    update public.stores set organization_id = v_org where organization_id is null;

    insert into public.organization_memberships (organization_id, user_id, role)
    select v_org, p.id, case when p.is_primary then 'owner' else 'admin' end
    from public.profiles p
    where p.store_id is not null and p.role = 'admin' and p.active and p.deleted_at is null
    on conflict (organization_id, user_id) do update set role = excluded.role;

    insert into public.store_memberships
      (store_id, user_id, role, is_primary, is_seller, can_edit_points, active)
    select p.store_id, p.id,
           case when p.role = 'admin' then 'admin' else 'user' end,
           p.is_primary, p.is_seller, p.can_edit_points, p.active
    from public.profiles p
    where p.store_id is not null
    on conflict (store_id, user_id) do update
      set role = excluded.role,
          is_primary = excluded.is_primary,
          is_seller = excluded.is_seller,
          can_edit_points = excluded.can_edit_points,
          active = excluded.active;

    update public.profiles
       set active_store_id = store_id
     where store_id is not null and active_store_id is null;
  end if;
end $$;

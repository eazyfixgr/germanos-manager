-- Phase 1.2b: owner-controlled organization membership management and audit.
begin;

create table public.organization_audit_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  actor_id uuid references public.profiles(id) on delete set null,
  target_user_id uuid references public.profiles(id) on delete set null,
  action text not null,
  previous_role text,
  new_role text,
  created_at timestamptz not null default now()
);
alter table public.organization_audit_events enable row level security;
create policy organization_audit_read on public.organization_audit_events for select
  using (public.is_master() or public.is_org_manager(organization_id));
revoke insert, update, delete on public.organization_audit_events from anon, authenticated;
grant select on public.organization_audit_events to authenticated;

create or replace function public.guard_organization_owner()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' and (new.organization_id <> old.organization_id or new.user_id <> old.user_id) then
    raise exception 'Δεν επιτρέπεται μεταφορά συμμετοχής' using errcode = '22023';
  end if;
  if old.role = 'owner' and (tg_op = 'DELETE' or new.role <> 'owner') then
    -- Serializes concurrent owner changes. Cascade after deleting the parent is allowed.
    perform 1 from public.organizations where id = old.organization_id for update;
    if found and not exists (
      select 1 from public.organization_memberships m join public.profiles p on p.id = m.user_id
      where m.organization_id = old.organization_id and m.user_id <> old.user_id
        and m.role = 'owner' and p.active and p.deleted_at is null
    ) then
      raise exception 'Πρέπει να παραμείνει τουλάχιστον ένας ενεργός ιδιοκτήτης' using errcode = '23514';
    end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
create trigger trg_guard_organization_owner before update or delete on public.organization_memberships
  for each row execute function public.guard_organization_owner();

-- An owner cannot be bypassed by deactivating or deleting their profile instead.
create or replace function public.guard_last_active_owner_profile()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_org uuid;
begin
  if tg_op = 'UPDATE' and new.active and new.deleted_at is null then return new; end if;
  for v_org in select organization_id from public.organization_memberships
    where user_id = old.id and role = 'owner' order by organization_id loop
    perform 1 from public.organizations where id = v_org for update;
    if found and not exists (
      select 1 from public.organization_memberships m join public.profiles p on p.id = m.user_id
      where m.organization_id = v_org and m.user_id <> old.id and m.role = 'owner'
        and p.active and p.deleted_at is null
    ) then
      raise exception 'Ορίστε άλλον ενεργό ιδιοκτήτη πριν αφαιρέσετε τον λογαριασμό' using errcode = '23514';
    end if;
  end loop;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
create trigger trg_last_active_org_owner before update or delete on public.profiles
  for each row execute function public.guard_last_active_owner_profile();

drop policy if exists organizations_select on public.organizations;
create policy organizations_select on public.organizations for select using (
  public.actor_is_active() and (public.is_master() or public.is_org_member(id) or exists (
    select 1 from public.stores s join public.store_memberships m on m.store_id = s.id
    where s.organization_id = organizations.id and m.user_id = auth.uid() and m.active
  ))
);
drop policy if exists organization_memberships_select on public.organization_memberships;
create policy organization_memberships_select on public.organization_memberships for select
  using (public.actor_is_active() and (public.is_master() or public.is_org_member(organization_id)));

create or replace function public.list_organization_people(p_org uuid)
returns table(user_id uuid, full_name text, email text, organization_role text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not (public.is_master() or public.is_org_manager(p_org)) then
    raise exception 'Δεν έχετε δικαίωμα προβολής προσωπικού οργανισμού' using errcode = '42501';
  end if;
  return query select p.id, p.full_name, p.email, om.role
    from public.profiles p
    left join public.organization_memberships om on om.user_id = p.id and om.organization_id = p_org
    where p.active and p.deleted_at is null and p.role <> 'master'
      and (om.user_id is not null or exists (
        select 1 from public.stores s where s.id = p.store_id and s.organization_id = p_org
      ) or exists (
        select 1 from public.store_memberships m join public.stores s on s.id = m.store_id
        where m.user_id = p.id and m.active and s.organization_id = p_org
      ))
    order by p.full_name, p.id;
end;
$$;
revoke all on function public.list_organization_people(uuid) from public;
grant execute on function public.list_organization_people(uuid) to authenticated;

create or replace function public.set_organization_member(p_org uuid, p_user uuid, p_role text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_previous text;
begin
  if p_org is null or p_user is null or (p_role is not null and p_role not in ('owner', 'admin', 'member')) then
    raise exception 'Μη έγκυρη συμμετοχή οργανισμού' using errcode = '22023';
  end if;
  perform 1 from public.organizations where id = p_org for update;
  if not found then raise exception 'Ο οργανισμός δεν βρέθηκε' using errcode = '22023'; end if;
  if not public.is_master() and not (public.actor_is_active() and exists (
    select 1 from public.organization_memberships m
    where m.organization_id = p_org and m.user_id = auth.uid() and m.role = 'owner'
  )) then
    raise exception 'Μόνο ο ιδιοκτήτης διαχειρίζεται τους ρόλους οργανισμού' using errcode = '42501';
  end if;
  -- Keep target lifecycle stable between validation and role assignment. A
  -- concurrent deactivation must not leave a newly appointed owner inactive.
  perform 1 from public.profiles where id = p_user for update;
  if not exists (select 1 from public.list_organization_people(p_org) p where p.user_id = p_user) then
    raise exception 'Ο χρήστης δεν ανήκει στο προσωπικό αυτού του οργανισμού' using errcode = '42501';
  end if;
  select role into v_previous from public.organization_memberships
    where organization_id = p_org and user_id = p_user;
  if v_previous is not distinct from p_role then return; end if;
  if p_role is null then
    delete from public.organization_memberships where organization_id = p_org and user_id = p_user;
  else
    insert into public.organization_memberships(organization_id, user_id, role)
    values (p_org, p_user, p_role)
    on conflict (organization_id, user_id) do update set role = excluded.role;
  end if;
  insert into public.organization_audit_events(organization_id, actor_id, target_user_id, action, previous_role, new_role)
  values (p_org, auth.uid(), p_user, 'membership.changed', v_previous, p_role);
end;
$$;
revoke all on function public.set_organization_member(uuid, uuid, text) from public;
grant execute on function public.set_organization_member(uuid, uuid, text) to authenticated;

commit;

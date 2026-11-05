-- Phase 1.2c. Run after membership_authorization and organization_membership_management.
-- Platform identity remains is_master(); tenant access requires a support session.
begin;

create table public.support_access_sessions (
  id uuid primary key default gen_random_uuid(),
  master_id uuid not null references public.profiles(id),
  store_id uuid not null references public.stores(id),
  organization_id uuid,
  reason text not null check (length(trim(reason)) between 10 and 1000),
  started_at timestamptz not null default statement_timestamp(),
  expires_at timestamptz not null,
  ended_at timestamptz,
  end_kind text check (end_kind in ('ended', 'expired', 'replaced')),
  check (expires_at > started_at and expires_at <= started_at + interval '60 minutes'),
  check ((ended_at is null) = (end_kind is null))
);
create unique index support_one_open_session_per_master
  on public.support_access_sessions(master_id) where ended_at is null;
create index support_sessions_store on public.support_access_sessions(store_id, started_at desc);

-- Snapshot IDs intentionally have no cascading tenant FK: audit survives data deletion.
create table public.support_audit_events (
  id uuid primary key default gen_random_uuid(),
  session_id uuid references public.support_access_sessions(id),
  actor_id uuid not null,
  store_id uuid,
  organization_id uuid,
  action text not null,
  table_name text,
  record_id text,
  reason text not null,
  before_data jsonb,
  after_data jsonb,
  created_at timestamptz not null default statement_timestamp()
);
create index support_audit_store on public.support_audit_events(store_id, created_at desc);
alter table public.support_access_sessions enable row level security;
alter table public.support_audit_events enable row level security;
revoke all on public.support_access_sessions, public.support_audit_events from anon, authenticated;
grant select on public.support_access_sessions, public.support_audit_events to authenticated;
create policy support_sessions_read on public.support_access_sessions for select to authenticated using (
  (public.is_master() and master_id = auth.uid()) or public.is_org_manager(organization_id)
);
create policy support_audit_read on public.support_audit_events for select to authenticated using (
  (public.is_master() and actor_id = auth.uid()) or public.is_org_manager(organization_id)
);

create or replace function public.has_support_access(p_store uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_master() and exists (
    select 1 from public.support_access_sessions s join public.stores st on st.id = s.store_id
    where s.master_id = auth.uid() and st.deleted_at is null
      and s.store_id = p_store and s.ended_at is null and s.expires_at > statement_timestamp()
  );
$$;

create or replace function public.can_access_store(p_store uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.actor_is_active() and exists (
    select 1 from public.stores s where s.id = p_store and s.deleted_at is null and (
      case when public.is_master() then public.has_support_access(s.id)
      else public.is_org_manager(s.organization_id) or exists (
        select 1 from public.store_memberships m
        where m.store_id = s.id and m.user_id = auth.uid() and m.active) end
    )
  );
$$;
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select public.can_manage_store(public.current_store());
$$;
create or replace function public.is_primary_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select public.can_lead_store(public.current_store());
$$;

-- Legacy tenant memberships never bypass the support boundary for a master.
create or replace function public.is_org_member(p_org uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.actor_is_active() and not public.is_master() and exists (
    select 1 from public.organization_memberships where organization_id = p_org and user_id = auth.uid());
$$;
create or replace function public.is_org_manager(p_org uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.actor_is_active() and not public.is_master() and exists (
    select 1 from public.organization_memberships where organization_id = p_org
      and user_id = auth.uid() and role in ('owner', 'admin'));
$$;

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
    case when public.is_master() then null::text else
      (select om.role from public.organization_memberships om
        where om.organization_id = public.organization_for_store(p_store) and om.user_id = auth.uid()) end;
end;
$$;

-- Only directory metadata is exposed outside support, never a full tenant row.
create function public.list_support_stores()
returns table(id uuid, name text, code text, organization_id uuid)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_master() then raise exception 'Απαιτείται master' using errcode = '42501'; end if;
  return query select s.id, s.name, s.code, s.organization_id
    from public.stores s where s.deleted_at is null order by s.name, s.id;
end;
$$;

create function public.current_support_session()
returns table(id uuid, store_id uuid, reason text, started_at timestamptz,
  expires_at timestamptz, server_now timestamptz)
language sql stable security definer set search_path = public as $$
  select s.id, s.store_id, s.reason, s.started_at, s.expires_at, statement_timestamp()
  from public.support_access_sessions s join public.stores st on st.id = s.store_id
  where public.is_master() and s.master_id = auth.uid() and s.ended_at is null
    and s.expires_at > statement_timestamp() and st.deleted_at is null;
$$;

create function public.start_support_access(p_store uuid, p_reason text, p_minutes integer default 30)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_org uuid;
  v_old public.support_access_sessions%rowtype;
  v_now timestamptz := statement_timestamp();
begin
  -- Serialize starts/ends for the same master across tabs/devices.
  perform 1 from public.profiles where id = auth.uid() for update;
  if not public.is_master() then raise exception 'Απαιτείται ενεργός master' using errcode = '42501'; end if;
  if p_reason is null or length(trim(p_reason)) not between 10 and 1000 then
    raise exception 'Η αιτιολογία πρέπει να έχει 10 έως 1000 χαρακτήρες' using errcode = '22023';
  end if;
  if p_minutes is null or p_minutes not between 5 and 60 then
    raise exception 'Η διάρκεια πρέπει να είναι από 5 έως 60 λεπτά' using errcode = '22023';
  end if;
  select organization_id into v_org from public.stores where id = p_store and deleted_at is null;
  if not found then raise exception 'Το κατάστημα δεν είναι διαθέσιμο' using errcode = '22023'; end if;
  for v_old in select * from public.support_access_sessions
    where master_id = auth.uid() and ended_at is null for update loop
    update public.support_access_sessions set ended_at = least(v_now, expires_at),
      end_kind = case when expires_at <= v_now then 'expired' else 'replaced' end where id = v_old.id;
    insert into public.support_audit_events(session_id, actor_id, store_id, organization_id, action, reason, after_data)
    values (v_old.id, auth.uid(), v_old.store_id, v_old.organization_id,
      case when v_old.expires_at <= v_now then 'session.expired' else 'session.replaced' end, v_old.reason,
      jsonb_build_object('expires_at', v_old.expires_at, 'ended_at', least(v_now, v_old.expires_at)));
  end loop;
  insert into public.support_access_sessions(master_id, store_id, organization_id, reason, started_at, expires_at)
  values (auth.uid(), p_store, v_org, trim(p_reason), v_now, v_now + make_interval(mins => p_minutes))
  returning id into v_id;
  -- Session exists before profile validation checks access to the selected store.
  update public.profiles set active_store_id = p_store where id = auth.uid();
  insert into public.support_audit_events(session_id, actor_id, store_id, organization_id, action, reason, after_data)
  values (v_id, auth.uid(), p_store, v_org, 'session.started', trim(p_reason),
    jsonb_build_object('started_at', v_now, 'expires_at', v_now + make_interval(mins => p_minutes)));
  return v_id;
end;
$$;

create function public.end_support_access(p_session uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_session public.support_access_sessions%rowtype;
begin
  perform 1 from public.profiles where id = auth.uid() for update;
  if not public.is_master() then raise exception 'Απαιτείται ενεργός master' using errcode = '42501'; end if;
  select * into v_session from public.support_access_sessions
    where id = p_session and master_id = auth.uid() for update;
  if not found then raise exception 'Η συνεδρία δεν βρέθηκε' using errcode = '42501'; end if;
  if v_session.ended_at is not null then return; end if;
  update public.support_access_sessions set ended_at = least(statement_timestamp(), expires_at),
    end_kind = case when expires_at <= statement_timestamp() then 'expired' else 'ended' end
    where id = p_session;
  insert into public.support_audit_events(session_id, actor_id, store_id, organization_id, action, reason, after_data)
  values (v_session.id, auth.uid(), v_session.store_id, v_session.organization_id,
    case when v_session.expires_at <= statement_timestamp() then 'session.expired' else 'session.ended' end,
    v_session.reason, jsonb_build_object('expires_at', v_session.expires_at,
      'ended_at', least(statement_timestamp(), v_session.expires_at)));
end;
$$;

revoke all on function public.list_support_stores() from public, anon;
revoke all on function public.current_support_session() from public, anon;
revoke all on function public.start_support_access(uuid, text, integer) from public, anon;
revoke all on function public.end_support_access(uuid) from public, anon;
grant execute on function public.list_support_stores(), public.current_support_session(),
  public.start_support_access(uuid, text, integer), public.end_support_access(uuid) to authenticated;

commit;

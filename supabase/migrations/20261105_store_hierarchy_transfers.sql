-- Store type, approval hierarchy, and auditable employee transfer requests.
-- Run after 20261105_workforce_w3_leave_transactions.sql.
begin;

alter table public.stores add column if not exists store_type text;
alter table public.stores alter column store_type set default 'franchise';
update public.stores set store_type='franchise' where store_type is null;
alter table public.stores alter column store_type set not null;
alter table public.stores add column if not exists acting_director_id uuid;
alter table public.profiles add column if not exists store_position text default 'employee';
update public.profiles set store_position='employee' where store_position is null;
alter table public.profiles alter column store_position set default 'employee';
alter table public.profiles alter column store_position set not null;
alter table public.profiles add column if not exists pending_position text;
alter table public.profiles add column if not exists pending_store_type text;
alter table public.store_memberships add column if not exists position text default 'employee';
update public.store_memberships set position='employee' where position is null;
alter table public.store_memberships alter column position set default 'employee';
alter table public.store_memberships alter column position set not null;
alter table public.organizations add column if not exists store_type text;
alter table public.organizations alter column store_type set default 'franchise';
update public.organizations set store_type='franchise' where store_type is null;
alter table public.organizations alter column store_type set not null;

do $$ begin
  if not exists(select 1 from pg_constraint where conrelid='public.stores'::regclass and conname='stores_store_type_valid_check') then
    alter table public.stores add constraint stores_store_type_valid_check check(store_type in ('franchise','owned'));
  end if;
  if not exists(select 1 from pg_constraint where conrelid='public.stores'::regclass and conname='stores_acting_director_profile_fkey') then
    alter table public.stores add constraint stores_acting_director_profile_fkey foreign key(acting_director_id)
      references public.profiles(id) on delete set null;
  end if;
  if not exists(select 1 from pg_constraint where conrelid='public.profiles'::regclass and conname='profiles_store_position_valid_check') then
    alter table public.profiles add constraint profiles_store_position_valid_check
      check(store_position in ('owner','director','assistant_director','supervisor','employee'));
  end if;
  if not exists(select 1 from pg_constraint where conrelid='public.profiles'::regclass and conname='profiles_pending_position_valid_check') then
    alter table public.profiles add constraint profiles_pending_position_valid_check
      check(pending_position is null or pending_position in ('owner','director','assistant_director','supervisor','employee'));
  end if;
  if not exists(select 1 from pg_constraint where conrelid='public.profiles'::regclass and conname='profiles_pending_store_type_valid_check') then
    alter table public.profiles add constraint profiles_pending_store_type_valid_check
      check(pending_store_type is null or pending_store_type in ('franchise','owned'));
  end if;
  if not exists(select 1 from pg_constraint where conrelid='public.store_memberships'::regclass and conname='store_memberships_position_valid_check') then
    alter table public.store_memberships add constraint store_memberships_position_valid_check
      check(position in ('owner','director','assistant_director','supervisor','employee'));
  end if;
  if not exists(select 1 from pg_constraint where conrelid='public.organizations'::regclass and conname='organizations_store_type_valid_check') then
    alter table public.organizations add constraint organizations_store_type_valid_check check(store_type in ('franchise','owned'));
  end if;
end $$;

-- Existing demo stores were confirmed as Franchise. Preserve existing authority
-- while translating the old admin/user labels into the new account hierarchy.
update public.store_memberships m set position=case
  when exists(select 1 from public.organization_memberships om where om.user_id=m.user_id
    and om.role='owner' and om.organization_id=public.organization_for_store(m.store_id)) then 'owner'
  when m.role='admin' and m.position='employee' then 'director' else m.position end;
update public.store_memberships m set is_primary=(m.position in ('owner','director'));
update public.profiles p set store_position=m.position,is_primary=(m.position in ('owner','director'))
  from public.store_memberships m where m.user_id=p.id and m.store_id=p.store_id;
-- Legacy new-store applications could only request a franchise owner account.
update public.profiles set store_position='owner',pending_position='owner',pending_store_type='franchise'
  where not active and store_id is null and nullif(pending_store_code,'') is not null;

create or replace function public.store_position_rank(p_position text)
returns integer language sql immutable as $$
  select case p_position when 'owner' then 0 when 'director' then 1
    when 'assistant_director' then 2 when 'supervisor' then 3 when 'employee' then 4 else 99 end;
$$;

create or replace function public.actor_store_position(p_store uuid)
returns text language plpgsql stable security definer set search_path=public as $$
declare v_position text;
begin
  if public.is_master() then return 'owner'; end if;
  select om.role into v_position from public.organization_memberships om
    join public.stores s on s.organization_id=om.organization_id
    where s.id=p_store and om.user_id=auth.uid();
  if v_position='owner' then return 'owner'; end if;
  select m.position into v_position from public.store_memberships m
    where m.store_id=p_store and m.user_id=auth.uid() and m.active;
  if v_position is null then return null; end if;
  if exists(select 1 from public.stores s where s.id=p_store and s.acting_director_id=auth.uid()) then
    return 'director';
  end if;
  return v_position;
end;
$$;
create or replace function public.can_manage_store_member(p_store uuid,p_user uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select public.is_master() or (public.actor_store_position(p_store) is not null and exists(
    select 1 from public.store_memberships target
    where target.store_id=p_store and target.user_id=p_user and target.active
      and public.store_position_rank(public.actor_store_position(p_store)) < public.store_position_rank(target.position)));
$$;
revoke all on function public.store_position_rank(text),public.actor_store_position(uuid),
  public.can_manage_store_member(uuid,uuid) from public,anon,authenticated;

create or replace function public.my_store_position(p_store uuid)
returns text language plpgsql stable security definer set search_path=public as $$
begin
  if not public.can_access_store(p_store) then raise exception 'Δεν έχετε πρόσβαση στο κατάστημα' using errcode='42501'; end if;
  return public.actor_store_position(p_store);
end;
$$;

create or replace function public.inherit_organization_store_type()
returns trigger language plpgsql security definer set search_path=public as $$
declare v_type text;
begin
  if new.organization_id is not null then
    select store_type into v_type from public.organizations where id=new.organization_id;
    if found then new.store_type:=v_type; end if;
  end if;
  return new;
end;
$$;
drop trigger if exists trg_store_inherit_organization_type on public.stores;
create trigger trg_store_inherit_organization_type before insert or update of organization_id,store_type on public.stores
  for each row execute function public.inherit_organization_store_type();

create or replace function public.protect_organization_store_type()
returns trigger language plpgsql as $$
begin
  if new.store_type is distinct from old.store_type then raise exception 'Ο τύπος οργανισμού δεν αλλάζει μετά τη δημιουργία' using errcode='23514'; end if;
  return new;
end;
$$;
drop trigger if exists trg_organization_store_type_immutable on public.organizations;
create trigger trg_organization_store_type_immutable before update of store_type on public.organizations
  for each row execute function public.protect_organization_store_type();

-- User-confirmed demo data: existing stores are Franchise. Add one empty,
-- explicitly owned demo store so both registration paths can be exercised.
update public.stores set store_type='franchise' where store_type is distinct from 'franchise';
insert into public.organizations(id,name,store_type)
values('90000000-0000-4000-8000-000000000001','ΓΕΡΜΑΝΟΣ Demo Ιδιόκτητο','owned')
on conflict(id) do nothing;
insert into public.stores(id,name,code,organization_id,store_type)
values('90000000-0000-4000-8000-000000000002','ΓΕΡΜΑΝΟΣ Demo Ιδιόκτητο','DEMO-OWNED-01',
  '90000000-0000-4000-8000-000000000001','owned')
on conflict(id) do nothing;

create or replace function public.can_lead_store(p_store uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select public.can_manage_store(p_store) and (public.is_master()
    or public.actor_store_position(p_store) in ('owner','director'));
$$;

create or replace function public.lookup_store_registration(p_code text)
returns table(id uuid,name text,store_type text)
language sql stable security definer set search_path=public as $$
  select s.id,s.name,s.store_type from public.stores s
  where s.code is not null and upper(s.code)=upper(trim(p_code)) and s.deleted_at is null limit 1;
$$;
revoke all on function public.lookup_store_registration(text) from public;
grant execute on function public.lookup_store_registration(text) to anon,authenticated;

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path=public as $$
declare
  v_account text:=coalesce(new.raw_user_meta_data->>'account_type','user');
  v_position text:=coalesce(new.raw_user_meta_data->>'store_position','employee');
  v_type text:=new.raw_user_meta_data->>'store_type';
  v_name text:=nullif(trim(new.raw_user_meta_data->>'store_name'),'');
  v_code text:=nullif(trim(new.raw_user_meta_data->>'store_code'),'');
  v_store public.stores%rowtype;
begin
  if v_account not in ('admin','user') then raise exception 'INVALID_ACCOUNT_TYPE'; end if;
  if v_account='user' then v_position:='employee'; end if;
  if v_position not in ('owner','director','assistant_director','supervisor','employee') then raise exception 'INVALID_STORE_POSITION'; end if;
  if v_account='admin' and (v_type not in ('franchise','owned')
      or (v_position='owner' and v_type<>'franchise') or (v_position<>'owner' and v_type='franchise' and v_code is null)) then
    raise exception 'INVALID_STORE_REGISTRATION';
  end if;
  select * into v_store from public.stores s where upper(s.code)=upper(v_code) and s.deleted_at is null limit 1;
  if v_account='user' and not found then raise exception 'STORE_CODE_NOT_FOUND'; end if;
  if v_account='admin' and found and v_store.store_type<>v_type then raise exception 'STORE_TYPE_MISMATCH'; end if;
  if v_account='admin' and not found and (v_name is null or v_code is null) then raise exception 'STORE_NAME_REQUIRED'; end if;
  if v_account='admin' and not found and v_type='franchise' and v_position<>'owner' then raise exception 'FRANCHISE_OWNER_REQUIRED'; end if;
  insert into public.profiles(id,full_name,role,store_id,email,active,can_edit_points,is_primary,
    pending_store_name,pending_store_code,active_store_id,store_position,pending_position,pending_store_type)
  values(new.id,coalesce(nullif(new.raw_user_meta_data->>'full_name',''),new.email),
    case when v_account='admin' then 'admin' else 'user' end,
    case when found then v_store.id else null end,new.email,false,false,v_position in ('owner','director'),
    case when found then null else v_name end,case when found then null else upper(v_code) end,
    case when found then v_store.id else null end,v_position,v_position,v_type)
  on conflict(id) do nothing;
  return new;
end;
$$;

create or replace function public.sync_store_membership()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if tg_op='UPDATE' and row(new.store_id,new.role,new.is_primary,new.is_seller,new.can_edit_points,new.active,new.deleted_at,new.store_position)
    is not distinct from row(old.store_id,old.role,old.is_primary,old.is_seller,old.can_edit_points,old.active,old.deleted_at,old.store_position) then return new; end if;
  if not new.active or new.deleted_at is not null then
    update public.store_memberships set active=false where user_id=new.id;
  end if;
  if new.store_id is not null then
    insert into public.store_memberships(store_id,user_id,role,is_primary,is_seller,can_edit_points,active,position)
    values(new.store_id,new.id,case when new.store_position='employee' then 'user' else 'admin' end,
      new.store_position in ('owner','director'),new.is_seller,new.can_edit_points,new.active and new.deleted_at is null,new.store_position)
    on conflict(store_id,user_id) do update set role=excluded.role,is_primary=excluded.is_primary,
      is_seller=excluded.is_seller,can_edit_points=excluded.can_edit_points,active=excluded.active,position=excluded.position;
  end if;
  return new;
end;
$$;

create or replace function public.approve_user(target uuid)
returns void language plpgsql security definer set search_path=public as $$
declare v_profile public.profiles%rowtype; v_store uuid; v_org uuid; v_position text;
begin
  select * into v_profile from public.profiles where id=target and deleted_at is null for update;
  if not found or v_profile.active then raise exception 'Η αίτηση δεν είναι πλέον διαθέσιμη' using errcode='40001'; end if;
  v_position:=coalesce(v_profile.pending_position,v_profile.store_position,'employee');
  if v_profile.store_id is null then
    if not public.is_master() then raise exception 'Νέο κατάστημα: απαιτείται master' using errcode='42501'; end if;
    if v_profile.pending_store_type not in ('franchise','owned') or nullif(v_profile.pending_store_code,'') is null
      or nullif(v_profile.pending_store_name,'') is null then raise exception 'Μη έγκυρη αίτηση νέου καταστήματος'; end if;
    if exists(select 1 from public.stores where upper(code)=upper(v_profile.pending_store_code)) then raise exception 'Ο κωδικός καταστήματος χρησιμοποιείται ήδη'; end if;
    if (v_profile.pending_store_type='franchise' and v_position<>'owner') or (v_profile.pending_store_type='owned' and v_position='owner') then
      raise exception 'Ο ρόλος δεν αντιστοιχεί στον τύπο καταστήματος'; end if;
    insert into public.organizations(name,created_by,store_type)
      values(v_profile.pending_store_name,target,v_profile.pending_store_type) returning id into v_org;
    insert into public.stores(name,code,organization_id,store_type)
      values(v_profile.pending_store_name,upper(v_profile.pending_store_code),v_org,v_profile.pending_store_type) returning id into v_store;
    if v_position='owner' then insert into public.organization_memberships(organization_id,user_id,role) values(v_org,target,'owner'); end if;
    update public.profiles set store_id=v_store,active_store_id=v_store,active=true,store_position=v_position,
      role=case when v_position='employee' then 'user' else 'admin' end,pending_position=null,pending_store_type=null,
      pending_store_name=null,pending_store_code=null where id=target;
    return;
  end if;
  if v_profile.pending_store_type is not null and exists(select 1 from public.stores where id=v_profile.store_id and store_type<>v_profile.pending_store_type) then
    raise exception 'Ο τύπος καταστήματος άλλαξε· υποβάλετε ξανά την αίτηση'; end if;
  if v_position='owner' then
    if not exists(select 1 from public.stores where id=v_profile.store_id and store_type='franchise')
      or not public.is_master() then
      raise exception 'Η απόκτηση ρόλου Ιδιοκτήτη εγκρίνεται από master' using errcode='42501'; end if;
    select organization_id into v_org from public.stores where id=v_profile.store_id;
    insert into public.organization_memberships(organization_id,user_id,role) values(v_org,target,'owner')
      on conflict(organization_id,user_id) do update set role='owner';
  elsif not public.is_master() and (not public.can_manage_store(v_profile.store_id)
    or public.actor_store_position(v_profile.store_id) is null
    or public.store_position_rank(public.actor_store_position(v_profile.store_id))>=public.store_position_rank(v_position)) then
    raise exception 'Η έγκριση απαιτεί ανώτερο ρόλο' using errcode='42501';
  end if;
  insert into public.profile_role_permits(profile_id,actor_id,operation,from_store_id) values(target,auth.uid(),'approve',v_profile.store_id)
    on conflict do nothing;
  update public.profiles set active=true,store_position=v_position,
    role=case when v_position='employee' then 'user' else 'admin' end,
    is_primary=(v_position in ('owner','director')),pending_position=null,pending_store_type=null where id=target;
  if v_position='director' then update public.stores set acting_director_id=null where id=v_profile.store_id; end if;
  delete from public.profile_role_permits where profile_id=target and actor_id=auth.uid() and operation='approve';
end;
$$;

create or replace function public.set_store_position(p_store uuid,p_user uuid,p_position text)
returns void language plpgsql security definer set search_path=public as $$
declare v_old text;
begin
  if p_position not in ('director','assistant_director','supervisor','employee') or not public.can_manage_store_member(p_store,p_user) then
    raise exception 'Δεν έχετε ανώτερο ρόλο για αυτή την αλλαγή' using errcode='42501'; end if;
  select position into v_old from public.store_memberships where store_id=p_store and user_id=p_user and active for update;
  if v_old is null or public.store_position_rank(public.actor_store_position(p_store))>=public.store_position_rank(p_position) then
    raise exception 'Μόνο ανώτερος ρόλος μπορεί να ορίσει αυτόν τον ρόλο' using errcode='42501'; end if;
  update public.store_memberships set position=p_position,role=case when p_position='employee' then 'user' else 'admin' end,
    is_primary=(p_position='director') where store_id=p_store and user_id=p_user;
  insert into public.profile_role_permits(profile_id,actor_id,operation,from_store_id) values(p_user,auth.uid(),'position',p_store)
    on conflict do nothing;
  update public.profiles set store_position=p_position,role=case when p_position='employee' then 'user' else 'admin' end,
    is_primary=(p_position='director') where id=p_user and store_id=p_store;
  if p_position='director' then update public.stores set acting_director_id=null where id=p_store; end if;
  delete from public.profile_role_permits where profile_id=p_user and actor_id=auth.uid() and operation='position';
end;
$$;

create or replace function public.delete_user(target uuid)
returns void language plpgsql security definer set search_path=public as $$
declare v_store uuid;
begin
  if target=auth.uid() then raise exception 'Δεν μπορείτε να αφαιρέσετε τον εαυτό σας' using errcode='42501'; end if;
  select store_id into v_store from public.profiles where id=target and active and deleted_at is null for update;
  if not found then return; end if;
  if not public.is_master() and (v_store is null or not public.can_manage_store_member(v_store,target)) then
    raise exception 'Μόνο ανώτερος ρόλος μπορεί να αφαιρέσει αυτό το μέλος' using errcode='42501'; end if;
  insert into public.profile_role_permits(profile_id,actor_id,operation,from_store_id) values(target,auth.uid(),'delete',v_store) on conflict do nothing;
  update public.stores set acting_director_id=null where acting_director_id=target;
  update public.profiles set deleted_at=statement_timestamp(),deleted_by=auth.uid(),active=false,is_primary=false where id=target;
  delete from public.profile_role_permits where profile_id=target and actor_id=auth.uid() and operation='delete';
end;
$$;

create or replace function public.reject_request(target uuid)
returns void language plpgsql security definer set search_path=public as $$
declare v_profile public.profiles%rowtype;
begin
  select * into v_profile from public.profiles where id=target and not active and deleted_at is null for update;
  if not found then return; end if;
  if not public.is_master() then
    if v_profile.store_id is null then raise exception 'Απαιτείται master για αίτηση νέου καταστήματος' using errcode='42501'; end if;
    if v_profile.pending_position='owner' then
      raise exception 'Μόνο master μπορεί να απορρίψει αίτηση Ιδιοκτήτη' using errcode='42501';
    elsif not public.can_manage_store(v_profile.store_id) or public.actor_store_position(v_profile.store_id) is null
      or public.store_position_rank(public.actor_store_position(v_profile.store_id))>=public.store_position_rank(coalesce(v_profile.pending_position,v_profile.store_position)) then
      raise exception 'Η απόρριψη απαιτεί ανώτερο ρόλο' using errcode='42501';
    end if;
  end if;
  insert into public.profile_role_permits(profile_id,actor_id,operation,from_store_id)
    values(target,auth.uid(),'delete',v_profile.store_id) on conflict do nothing;
  delete from auth.users where id=target;
end;
$$;

create table if not exists public.store_transfer_requests(
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id),
  from_store_id uuid not null references public.stores(id),
  to_store_id uuid not null references public.stores(id),
  position text not null check(position in ('director','assistant_director','supervisor','employee')),
  replacement_user_id uuid references public.profiles(id),
  status text not null default 'pending' check(status in ('pending','approved','rejected','cancelled')),
  review_note text,
  revision integer not null default 1,
  reviewed_by uuid references public.profiles(id),
  created_at timestamptz not null default statement_timestamp(),
  reviewed_at timestamptz,
  check(from_store_id<>to_store_id)
);
alter table public.store_transfer_requests add column if not exists review_note text;
alter table public.store_transfer_requests drop constraint if exists store_transfer_requests_check;
do $$ begin
  if not exists(select 1 from pg_constraint where conrelid='public.store_transfer_requests'::regclass
    and conname='store_transfer_requests_distinct_stores_check') then
    alter table public.store_transfer_requests add constraint store_transfer_requests_distinct_stores_check
      check(from_store_id<>to_store_id);
  end if;
end $$;
create unique index if not exists one_pending_store_transfer on public.store_transfer_requests(user_id) where status='pending';
alter table public.store_transfer_requests enable row level security;
revoke all on public.store_transfer_requests from anon,authenticated;
grant select on public.store_transfer_requests to authenticated;
drop policy if exists transfer_request_read on public.store_transfer_requests;
create policy transfer_request_read on public.store_transfer_requests for select to authenticated using(
  user_id=auth.uid() or public.can_access_store(to_store_id) or public.can_access_store(from_store_id));

-- These transaction-scoped capabilities cannot be created by REST clients.
create table if not exists public.profile_role_permits(
  profile_id uuid not null references public.profiles(id) on delete cascade,
  actor_id uuid not null references public.profiles(id) on delete cascade,
  operation text not null check(operation in ('approve','position','transfer','delete')),
  from_store_id uuid references public.stores(id),
  to_store_id uuid references public.stores(id),
  primary key(profile_id,actor_id,operation)
);
alter table public.profile_role_permits add column if not exists from_store_id uuid references public.stores(id);
alter table public.profile_role_permits add column if not exists to_store_id uuid references public.stores(id);
revoke all on public.profile_role_permits from public,anon,authenticated;

-- Master overrides stay auditable as platform writes and still require a
-- transaction-scoped permit created only by the approved security-definer RPC.
create or replace function public.guard_support_write()
returns trigger language plpgsql security definer set search_path=public as $$
declare
  v_old jsonb:=case when tg_op<>'INSERT' then to_jsonb(old) else '{}'::jsonb end;
  v_new jsonb:=case when tg_op<>'DELETE' then to_jsonb(new) else '{}'::jsonb end;
  v_store uuid; v_new_store uuid; v_bootstrap boolean:=false; v_profile uuid;
begin
  if not public.is_master() then if tg_op='DELETE' then return old; end if; return new; end if;
  if tg_table_name='profiles' then
    v_profile:=coalesce((v_old->>'id')::uuid,(v_new->>'id')::uuid);
    if v_profile=auth.uid() or coalesce(v_old->>'role',v_new->>'role')='master' then
      if tg_op='DELETE' then return old; end if; return new; end if;
    if exists(select 1 from public.profile_role_permits p where p.profile_id=v_profile and p.actor_id=auth.uid()
      and p.operation in ('approve','position','transfer','delete')) then
      if tg_op='DELETE' then return old; end if; return new;
    end if;
    v_bootstrap:=tg_op='UPDATE' and v_old->>'store_id' is null and (v_old->>'active')::boolean=false
      and nullif(v_old->>'pending_store_code','') is not null
      and exists(select 1 from public.stores s where s.id=(v_new->>'store_id')::uuid
        and upper(s.code)=upper(v_old->>'pending_store_code') and s.created_at>=transaction_timestamp());
    if tg_op='UPDATE' and v_old->>'store_id' is not null and v_old->>'store_id' is distinct from v_new->>'store_id' then
      raise exception 'Η υποστήριξη δεν μεταφέρει λογαριασμούς χωρίς permit' using errcode='42501'; end if;
  end if;
  if tg_table_name='stores' then
    if tg_op='INSERT' then return new; end if;
    v_store:=(v_old->>'id')::uuid;
    if exists(select 1 from public.profile_role_permits p where p.actor_id=auth.uid()
      and p.operation in ('approve','position','transfer','delete') and p.from_store_id=v_store) then return new; end if;
    if tg_op<>'DELETE' and row(v_old->>'id',v_old->>'organization_id') is distinct from row(v_new->>'id',v_new->>'organization_id') then
      raise exception 'Η υποστήριξη δεν μεταφέρει καταστήματα σε άλλον οργανισμό' using errcode='42501'; end if;
  else
    v_store:=coalesce(v_old->>'store_id',v_new->>'store_id')::uuid;
    v_new_store:=(v_new->>'store_id')::uuid;
  end if;
  if not v_bootstrap and ((v_store is not null and not public.has_support_access(v_store))
    or (v_new_store is not null and not public.has_support_access(v_new_store))
    or (v_store is null and tg_table_name<>'profiles')) then
    raise exception 'Απαιτείται ενεργή πρόσβαση υποστήριξης για αυτό το κατάστημα' using errcode='42501'; end if;
  if tg_op='DELETE' then return old; end if; return new;
end;
$$;

create or replace function public.protect_profile_fields()
returns trigger language plpgsql security definer set search_path=public as $$
declare v_permitted boolean;
begin
  if auth.uid() is null then return new; end if;
  if new.id is distinct from old.id or new.email is distinct from old.email or new.created_at is distinct from old.created_at then
    raise exception 'Δεν επιτρέπεται αλλαγή ταυτότητας λογαριασμού' using errcode='42501'; end if;
  if public.is_master() then return new; end if;
  select exists(select 1 from public.profile_role_permits p where p.profile_id=old.id and p.actor_id=auth.uid()) into v_permitted;
  if v_permitted then return new; end if;
  if new.active_store_id is distinct from old.active_store_id
    and (new.id<>auth.uid() or not public.can_access_store(new.active_store_id)) then
    raise exception 'Μη εξουσιοδοτημένη αλλαγή ενεργού καταστήματος' using errcode='42501'; end if;
  if row(new.store_id,new.role,new.active,new.is_primary,new.deleted_at,new.deleted_by,
      new.store_position,new.pending_position,new.pending_store_type,new.pending_store_name,new.pending_store_code)
      is distinct from row(old.store_id,old.role,old.active,old.is_primary,old.deleted_at,old.deleted_by,
      old.store_position,old.pending_position,old.pending_store_type,old.pending_store_name,old.pending_store_code) then
    raise exception 'Οι ρόλοι και οι μετακινήσεις αλλάζουν μόνο μέσω εγκεκριμένου αιτήματος' using errcode='42501';
  end if;
  if row(new.can_edit_points,new.is_seller) is distinct from row(old.can_edit_points,old.is_seller)
    and (old.store_id is null or not public.can_manage_store_member(old.store_id,old.id)) then
    raise exception 'Μόνο ανώτερος ρόλος μπορεί να αλλάξει δικαιώματα μέλους' using errcode='42501'; end if;
  return new;
end;
$$;

create or replace function public.submit_store_transfer(p_to_code text,p_replacement uuid default null)
returns uuid language plpgsql security definer set search_path=public as $$
declare v_from uuid; v_to uuid; v_position text; v_id uuid; v_acting boolean;
begin
  if not public.actor_is_active() then raise exception 'Απαιτείται ενεργός λογαριασμός' using errcode='42501'; end if;
  select p.store_id,m.position into v_from,v_position from public.profiles p
    join public.store_memberships m on m.store_id=p.store_id and m.user_id=p.id and m.active
    where p.id=auth.uid() for update of p,m;
  if v_from is null or v_position='owner' then raise exception 'Ο ιδιοκτήτης διαχειρίζεται πρόσβαση μέσω του Franchise' using errcode='22023'; end if;
  select coalesce(acting_director_id=auth.uid(),false) into v_acting from public.stores where id=v_from;
  select id into v_to from public.stores where upper(code)=upper(trim(p_to_code)) and deleted_at is null;
  if v_to is null or v_to=v_from then raise exception 'Επιλέξτε διαφορετικό κατάστημα με κωδικό έγκυρο' using errcode='22023'; end if;
  if v_position='director' or v_acting then
    if not exists(select 1 from public.store_memberships m where m.store_id=v_from and m.user_id=p_replacement
      and m.active and m.position in ('assistant_director','supervisor')) then
      raise exception 'Επιλέξτε υποδιευθυντή ή προϊστάμενο του τρέχοντος καταστήματος ως αναπληρωτή' using errcode='22023'; end if;
  elsif p_replacement is not null then raise exception 'Αναπληρωτής επιλέγεται μόνο κατά μεταφορά διευθυντή ή αναπληρωτή' using errcode='22023'; end if;
  insert into public.store_transfer_requests(user_id,from_store_id,to_store_id,position,replacement_user_id)
    values(auth.uid(),v_from,v_to,v_position,p_replacement) returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.review_store_transfer(p_request uuid,p_revision integer,p_decision text)
returns void language plpgsql security definer set search_path=public as $$
declare v_request public.store_transfer_requests%rowtype; v_position text;
begin
  if p_decision not in ('approved','rejected') then raise exception 'Μη έγκυρη απόφαση' using errcode='22023'; end if;
  select * into v_request from public.store_transfer_requests where id=p_request for update;
  if not found or v_request.status<>'pending' or v_request.revision<>p_revision then raise exception 'Το αίτημα άλλαξε· ανανεώστε τη λίστα' using errcode='40001'; end if;
  if not public.is_master() and (not public.can_manage_store(v_request.to_store_id) or public.actor_store_position(v_request.to_store_id) is null
    or public.store_position_rank(public.actor_store_position(v_request.to_store_id))>=public.store_position_rank(v_request.position)) then
    raise exception 'Η απόφαση απαιτεί ανώτερο ρόλο στο κατάστημα υποδοχής' using errcode='42501'; end if;
  if p_decision='approved' then
    perform 1 from public.profiles where id=v_request.user_id and active and deleted_at is null for update;
    select position into v_position from public.store_memberships where store_id=v_request.from_store_id and user_id=v_request.user_id and active for update;
    if v_position is distinct from v_request.position then raise exception 'Ο ρόλος προέλευσης άλλαξε· ακυρώστε και υποβάλετε ξανά' using errcode='40001'; end if;
    update public.store_memberships set active=false where store_id=v_request.from_store_id and user_id=v_request.user_id;
    insert into public.profile_role_permits(profile_id,actor_id,operation,from_store_id,to_store_id)
      values(v_request.user_id,auth.uid(),'transfer',v_request.from_store_id,v_request.to_store_id)
      on conflict do nothing;
    update public.profiles set store_id=v_request.to_store_id,active_store_id=v_request.to_store_id,store_position=v_request.position,
      role=case when v_request.position='employee' then 'user' else 'admin' end,is_primary=(v_request.position='director')
      where id=v_request.user_id;
    if v_request.replacement_user_id is not null then
      update public.stores set acting_director_id=v_request.replacement_user_id where id=v_request.from_store_id;
    elsif exists(select 1 from public.stores where id=v_request.from_store_id and acting_director_id=v_request.user_id) then
      update public.stores set acting_director_id=null where id=v_request.from_store_id;
    end if;
    delete from public.profile_role_permits where profile_id=v_request.user_id and actor_id=auth.uid() and operation='transfer';
  end if;
  update public.store_transfer_requests set status=p_decision,revision=revision+1,reviewed_by=auth.uid(),reviewed_at=statement_timestamp() where id=p_request;
  if not public.is_master() then
    insert into public.activity_log(store_id,actor_id,action,detail)
      values(v_request.to_store_id,auth.uid(),'Απόφαση μεταφοράς προσωπικού',p_decision||' · '||v_request.user_id::text);
  end if;
end;
$$;

create or replace function public.master_transfer_member(p_user uuid,p_to_code text,p_replacement uuid,p_reason text)
returns uuid language plpgsql security definer set search_path=public as $$
declare v_from uuid; v_to uuid; v_position text; v_id uuid; v_acting boolean;
begin
  if not public.is_master() then raise exception 'Μόνο master μπορεί να μεταφέρει λογαριασμό ως πλατφόρμα' using errcode='42501'; end if;
  if length(trim(coalesce(p_reason,'')))<10 or length(p_reason)>1000 then raise exception 'Αιτιολογία μεταφοράς: 10–1000 χαρακτήρες' using errcode='22023'; end if;
  select store_id into v_from from public.profiles where id=p_user and active and deleted_at is null for update;
  if v_from is null then raise exception 'Ο λογαριασμός δεν έχει ενεργό κατάστημα'; end if;
  select position into v_position from public.store_memberships where store_id=v_from and user_id=p_user and active for update;
  if v_position is null or v_position='owner' then raise exception 'Μεταφέρετε μέλη καταστήματος· ιδιοκτήτες αλλάζουν οργανισμό μέσω των ρόλων Franchise'; end if;
  select coalesce(acting_director_id=p_user,false) into v_acting from public.stores where id=v_from;
  select id into v_to from public.stores where upper(code)=upper(trim(p_to_code)) and deleted_at is null;
  if v_to is null or v_to=v_from then raise exception 'Επιλέξτε άλλο, ενεργό κατάστημα'; end if;
  if (v_position='director' or v_acting) and not exists(select 1 from public.store_memberships where store_id=v_from
    and user_id=p_replacement and active and position in ('assistant_director','supervisor')) then
    raise exception 'Διευθυντής: επιλέξτε υποδιευθυντή ή προϊστάμενο ως αναπληρωτή'; end if;
  if v_position<>'director' and not v_acting and p_replacement is not null then raise exception 'Αναπληρωτής αφορά μόνο διευθυντή ή αναπληρωτή'; end if;
  insert into public.store_transfer_requests(user_id,from_store_id,to_store_id,position,replacement_user_id,status,revision,reviewed_by,reviewed_at,review_note)
    values(p_user,v_from,v_to,v_position,p_replacement,'approved',2,auth.uid(),statement_timestamp(),trim(p_reason)) returning id into v_id;
  update public.store_memberships set active=false where store_id=v_from and user_id=p_user;
  insert into public.profile_role_permits(profile_id,actor_id,operation,from_store_id,to_store_id)
    values(p_user,auth.uid(),'transfer',v_from,v_to);
  update public.profiles set store_id=v_to,active_store_id=v_to,store_position=v_position,
    role=case when v_position='employee' then 'user' else 'admin' end,is_primary=(v_position='director') where id=p_user;
  if p_replacement is not null then update public.stores set acting_director_id=p_replacement where id=v_from;
  elsif v_acting then update public.stores set acting_director_id=null where id=v_from; end if;
  delete from public.profile_role_permits where profile_id=p_user and actor_id=auth.uid() and operation='transfer';
  return v_id;
end;
$$;

create or replace function public.list_store_transfer_requests(p_store uuid)
returns table(id uuid,user_id uuid,user_name text,from_store_id uuid,from_store_name text,
  to_store_id uuid,to_store_name text,requested_position text,replacement_user_id uuid,replacement_name text,revision integer)
language plpgsql stable security definer set search_path=public as $$
begin
  if not public.can_access_store(p_store) and not exists(select 1 from public.store_transfer_requests r
    where r.user_id=auth.uid() and r.status='pending' and (r.from_store_id=p_store or r.to_store_id=p_store)) then
    raise exception 'Δεν έχετε πρόσβαση στα αιτήματα του καταστήματος' using errcode='42501'; end if;
  return query select r.id,r.user_id,p.full_name,r.from_store_id,fs.name,r.to_store_id,ts.name,r.position,
    r.replacement_user_id,repl.full_name,r.revision
    from public.store_transfer_requests r join public.profiles p on p.id=r.user_id
      join public.stores fs on fs.id=r.from_store_id join public.stores ts on ts.id=r.to_store_id
      left join public.profiles repl on repl.id=r.replacement_user_id
    where r.status='pending' and ((r.user_id=auth.uid() and (r.from_store_id=p_store or r.to_store_id=p_store))
      or (r.to_store_id=p_store and public.can_access_store(p_store))) order by r.created_at;
end;
$$;

create or replace function public.cancel_store_transfer(p_request uuid,p_revision integer)
returns void language plpgsql security definer set search_path=public as $$
begin
  update public.store_transfer_requests set status='cancelled',revision=revision+1
    where id=p_request and user_id=auth.uid() and status='pending' and revision=p_revision;
  if not found then raise exception 'Το αίτημα άλλαξε ή δεν μπορεί να ακυρωθεί' using errcode='40001'; end if;
end;
$$;

create or replace function public.set_organization_member(p_org uuid,p_user uuid,p_role text)
returns void language plpgsql security definer set search_path=public as $$
declare v_previous text;
begin
  if p_org is null or p_user is null or (p_role is not null and p_role not in ('owner','admin','member')) then
    raise exception 'Μη έγκυρη συμμετοχή οργανισμού' using errcode='22023'; end if;
  perform 1 from public.organizations where id=p_org for update;
  if not found then raise exception 'Ο οργανισμός δεν βρέθηκε'; end if;
  if not public.is_master() and not exists(select 1 from public.organization_memberships
    where organization_id=p_org and user_id=auth.uid() and role='owner') then
    raise exception 'Μόνο Ιδιοκτήτης ή master διαχειρίζεται μέλη οργανισμού' using errcode='42501'; end if;
  perform 1 from public.profiles where id=p_user and active and deleted_at is null for update;
  if not found then raise exception 'Απαιτείται ενεργός λογαριασμός'; end if;
  select role into v_previous from public.organization_memberships where organization_id=p_org and user_id=p_user;
  if v_previous is not distinct from p_role then return; end if;
  if not public.is_master() and (v_previous='owner' or p_role='owner') then
    raise exception 'Μόνο master μπορεί να αλλάξει ή να διορίσει Ιδιοκτήτη' using errcode='42501'; end if;
  if p_role is null then delete from public.organization_memberships where organization_id=p_org and user_id=p_user;
  else insert into public.organization_memberships(organization_id,user_id,role) values(p_org,p_user,p_role)
    on conflict(organization_id,user_id) do update set role=excluded.role; end if;
  insert into public.organization_audit_events(organization_id,actor_id,target_user_id,action,previous_role,new_role)
    values(p_org,auth.uid(),p_user,'membership.changed',v_previous,p_role);
end;
$$;

revoke all on function public.set_store_position(uuid,uuid,text),public.submit_store_transfer(text,uuid),
  public.review_store_transfer(uuid,integer,text),public.list_store_transfer_requests(uuid),
  public.cancel_store_transfer(uuid,integer),public.master_transfer_member(uuid,text,uuid,text) from public,anon;
grant execute on function public.set_store_position(uuid,uuid,text),public.submit_store_transfer(text,uuid),
  public.review_store_transfer(uuid,integer,text),public.list_store_transfer_requests(uuid),
  public.cancel_store_transfer(uuid,integer),public.master_transfer_member(uuid,text,uuid,text) to authenticated;
revoke all on function public.my_store_position(uuid) from public,anon;
grant execute on function public.my_store_position(uuid) to authenticated;

commit;

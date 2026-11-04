-- ============================================================
-- ΓΕΡΜΑΝΟΣ MANAGER — Σχήμα βάσης v2 (Supabase / Postgres)
-- Ρόλοι: master > admin > user
-- Είναι idempotent: μπορεί να τρέξει πάνω σε υπάρχουσα βάση.
-- Τρέξε το στο Supabase: SQL Editor -> New query -> Run
-- ============================================================

create extension if not exists pgcrypto;

-- ------------------------------------------------------------
-- 1) ΠΙΝΑΚΕΣ
-- ------------------------------------------------------------
create table if not exists public.stores (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  code text,
  address text,
  phone text,
  open_hours text,
  created_at timestamptz not null default now()
);

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  role text not null default 'user',
  store_id uuid references public.stores(id) on delete set null,
  phone text,
  email text not null,
  active boolean not null default false,
  can_edit_points boolean not null default false,
  is_primary boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.master_allowlist (
  email text primary key,
  note text,
  created_at timestamptz not null default now()
);

insert into public.master_allowlist (email, note)
values ('g.tsouhnikas@gmail.com', 'Master')
on conflict (email) do nothing;

create table if not exists public.store_targets (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  month text not null,
  store_points numeric not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (store_id, month)
);

create table if not exists public.employee_targets (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  month text not null,
  points numeric not null default 0,
  projection numeric not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (store_id, user_id, month)
);

create table if not exists public.point_entries (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  date date not null,
  points numeric not null default 0,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (store_id, user_id, date)
);

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  product_code text not null,
  product_name text not null,
  customer_name text not null,
  customer_phone text,
  notes text,
  status text not null default 'new'
    check (status in ('new','ordered','in_transit','received','ready','notified','completed','cancelled')),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.order_events (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  status text not null,
  note text,
  actor_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.shifts (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  date date not null,
  shift_type text not null default 'custom'
    check (shift_type in ('open','mid','close','custom','repo','adeia')),
  start_time text,
  end_time text,
  note text,
  created_at timestamptz not null default now(),
  unique (store_id, user_id, date)
);

create table if not exists public.leave_requests (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  type text not null check (type in ('repo','adeia')),
  start_date date not null,
  end_date date not null,
  reason text,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  reviewed_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.activity_log (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  actor_id uuid references public.profiles(id) on delete set null,
  action text not null,
  detail text,
  created_at timestamptz not null default now()
);

-- ------------------------------------------------------------
-- 2) MIGRATION (για υπάρχουσα βάση)
-- ------------------------------------------------------------
alter table public.stores add column if not exists code text;
alter table public.profiles add column if not exists is_primary boolean not null default false;
alter table public.profiles add column if not exists deleted_at timestamptz;
alter table public.profiles add column if not exists deleted_by uuid;
alter table public.profiles add column if not exists pending_store_name text;
alter table public.profiles add column if not exists pending_store_code text;
alter table public.stores add column if not exists deleted_at timestamptz;

alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles
  add constraint profiles_role_check check (role in ('master','admin','user'));

-- Μοναδικός κωδικός καταστήματος (case-insensitive), όπου υπάρχει
create unique index if not exists stores_code_upper_key
  on public.stores (upper(code)) where code is not null;

-- ------------------------------------------------------------
-- 3) Δείκτες
-- ------------------------------------------------------------
create index if not exists idx_profiles_store on public.profiles(store_id);
create index if not exists idx_targets_store_month on public.employee_targets(store_id, month);
create index if not exists idx_store_targets_month on public.store_targets(store_id, month);
create index if not exists idx_orders_store_status on public.orders(store_id, status);
create index if not exists idx_point_entries_store on public.point_entries(store_id, date);
create index if not exists idx_point_entries_user on public.point_entries(user_id, date);
create index if not exists idx_orders_product_code on public.orders(store_id, product_code);
create index if not exists idx_order_events_order on public.order_events(order_id);
create index if not exists idx_shifts_store_date on public.shifts(store_id, date);
create index if not exists idx_shifts_user on public.shifts(user_id, date);
create index if not exists idx_leave_store on public.leave_requests(store_id);
create index if not exists idx_leave_user on public.leave_requests(user_id);

-- ------------------------------------------------------------
-- 4) ΒΟΗΘΗΤΙΚΕΣ ΣΥΝΑΡΤΗΣΕΙΣ
-- ------------------------------------------------------------
create or replace function public.is_master()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from profiles
    where id = auth.uid() and role = 'master' and active = true and deleted_at is null
  );
$$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from profiles
    where id = auth.uid() and role in ('admin','master') and active = true and deleted_at is null
  );
$$;

create or replace function public.is_primary_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from profiles
    where id = auth.uid() and role = 'master' and active = true and deleted_at is null
  ) or exists (
    select 1 from profiles
    where id = auth.uid() and role = 'admin' and is_primary = true and active = true and deleted_at is null
  );
$$;

create or replace function public.current_store()
returns uuid language sql stable security definer set search_path = public as $$
  select store_id from profiles
  where id = auth.uid() and active = true and deleted_at is null;
$$;

create or replace function public.can_edit_points()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((
    select can_edit_points from profiles where id = auth.uid() and active = true
  ), false);
$$;

-- ------------------------------------------------------------
-- 5) TRIGGERS
-- ------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_store_targets_updated on public.store_targets;
create trigger trg_store_targets_updated before update on public.store_targets
  for each row execute function public.touch_updated_at();

drop trigger if exists trg_employee_targets_updated on public.employee_targets;
create trigger trg_employee_targets_updated before update on public.employee_targets
  for each row execute function public.touch_updated_at();

drop trigger if exists trg_orders_updated on public.orders;
create trigger trg_orders_updated before update on public.orders
  for each row execute function public.touch_updated_at();

-- Προστασία ευαίσθητων πεδίων profile
create or replace function public.protect_profile_fields()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- Server/service context (χωρίς JWT, π.χ. maintenance): εμπιστοσύνη.
  -- Το RLS μπλοκάρει ήδη τους anon users για UPDATE στον profiles.
  if auth.uid() is null then
    return new;
  end if;

  if public.is_master() then
    return new;
  end if;

  if old.role = 'master' then
    raise exception 'Δεν επιτρέπεται η τροποποίηση λογαριασμού master';
  end if;

  -- Κανείς (εκτός master) δεν μπορεί να γίνει master
  if new.role = 'master' then
    new.role := old.role;
  end if;

  if not public.is_admin() then
    new.role := old.role;
    new.active := old.active;
    new.can_edit_points := old.can_edit_points;
    new.is_primary := old.is_primary;
    new.store_id := old.store_id;
    return new;
  end if;

  -- Μη-master admin: δεν αλλάζει κατάστημα
  new.store_id := old.store_id;

  if not public.is_primary_admin() then
    -- Απλός admin: δεν αλλάζει ρόλους, δεν ορίζει primary, δεν αλλάζει
    -- δικαίωμα πόντων άλλου admin. Η ενεργοποίηση επιτρέπεται (για εγκρίσεις).
    new.role := old.role;
    new.is_primary := old.is_primary;
    if old.role = 'admin' then
      new.can_edit_points := old.can_edit_points;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_protect_profile on public.profiles;
create trigger trg_protect_profile before update on public.profiles
  for each row execute function public.protect_profile_fields();

-- Ο υπάλληλος αλλάζει μόνο το δικό του projection, όχι τους πόντους
create or replace function public.protect_target_points()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    return new;
  end if;
  if not (public.is_admin() or public.can_edit_points()) then
    if tg_op = 'UPDATE' then
      new.points := old.points;
    else
      new.points := 0;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_protect_points on public.employee_targets;
create trigger trg_protect_points before insert or update on public.employee_targets
  for each row execute function public.protect_target_points();

-- Δημιουργία profile αυτόματα κατά την εγγραφή
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_type text;
  v_name text;
  v_code text;
  s_id uuid;
begin
  v_type := coalesce(new.raw_user_meta_data->>'account_type', 'user');
  v_name := nullif(trim(coalesce(new.raw_user_meta_data->>'store_name', '')), '');
  v_code := nullif(trim(coalesce(new.raw_user_meta_data->>'store_code', '')), '');

  if v_type not in ('admin','user') then
    v_type := 'user';
  end if;

  select id into s_id from public.stores
   where code is not null and upper(code) = upper(v_code)
   limit 1;

  if v_type = 'user' then
    if s_id is null then
      raise exception 'STORE_CODE_NOT_FOUND';
    end if;

    insert into public.profiles (id, full_name, role, store_id, email, active, can_edit_points, is_primary)
    values (new.id, coalesce(nullif(new.raw_user_meta_data->>'full_name',''), new.email),
            'user', s_id, new.email, false, false, false)
    on conflict (id) do nothing;

  else
    if s_id is not null then
      -- Υπάρχον κατάστημα: αίτηση υπευθύνου -> αναμονή έγκρισης από admin του καταστήματος
      insert into public.profiles (id, full_name, role, store_id, email, active, can_edit_points, is_primary)
      values (new.id, coalesce(nullif(new.raw_user_meta_data->>'full_name',''), new.email),
              'admin', s_id, new.email, false, false, false)
      on conflict (id) do nothing;
    else
      -- Νέο κατάστημα: απαιτείται όνομα + κωδικός -> αναμονή έγκρισης από MASTER
      if v_name is null then
        raise exception 'STORE_NAME_REQUIRED';
      end if;
      if v_code is null then
        raise exception 'STORE_CODE_REQUIRED';
      end if;

      insert into public.profiles
        (id, full_name, role, store_id, email, active, can_edit_points, is_primary, pending_store_name, pending_store_code)
      values (new.id, coalesce(nullif(new.raw_user_meta_data->>'full_name',''), new.email),
              'admin', null, new.email, false, false, true, v_name, upper(v_code))
      on conflict (id) do nothing;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- (καθαρισμός παλιού trigger)
-- Master allowlist: κανείς δεν γίνεται master αν το email του δεν είναι στη λίστα
create or replace function public.enforce_master_allowlist()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.role = 'master'
     and not exists (
       select 1 from public.master_allowlist where lower(email) = lower(new.email)
     ) then
    new.role := 'admin';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_master_allowlist on public.profiles;
create trigger trg_master_allowlist before insert or update on public.profiles
  for each row execute function public.enforce_master_allowlist();

drop trigger if exists trg_auto_admin on public.profiles;

-- ------------------------------------------------------------
-- 6) RPCs (ασφαλείς λειτουργίες)
-- ------------------------------------------------------------
create or replace function public.lookup_store_code(p_code text)
returns table(id uuid, name text)
language sql stable security definer set search_path = public as $$
  select id, name from public.stores
  where code is not null and upper(code) = upper(trim(p_code))
  limit 1;
$$;
revoke all on function public.lookup_store_code(text) from public;
grant execute on function public.lookup_store_code(text) to anon, authenticated;

create or replace function public.approve_user(target uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  tr text;
  ts uuid;
  pn text;
  pc text;
  s_id uuid;
begin
  select role, store_id, pending_store_name, pending_store_code
    into tr, ts, pn, pc
    from public.profiles
   where id = target and deleted_at is null;

  if tr is null then
    raise exception 'Ο χρήστης δεν βρέθηκε';
  end if;

  if not public.is_master() then
    -- Νέο κατάστημα (χωρίς store_id) εγκρίνεται ΜΟΝΟ από master
    if ts is null then
      raise exception 'Νέο κατάστημα: απαιτείται έγκριση από master';
    end if;
    if ts is distinct from public.current_store() then
      raise exception 'Δεν έχετε πρόσβαση σε αυτό το κατάστημα';
    end if;
    if not public.is_admin() then
      raise exception 'Δεν έχετε δικαίωμα έγκρισης';
    end if;
  end if;

  -- Αν είναι αίτημα νέου καταστήματος, δημιούργησέ το τώρα
  if ts is null and pc is not null then
    select id into s_id from public.stores
     where code is not null and upper(code) = upper(pc)
     limit 1;
    if s_id is null then
      insert into public.stores (name, code)
      values (coalesce(pn, 'Κατάστημα'), upper(pc))
      returning id into s_id;
    end if;
    update public.profiles
       set store_id = s_id, pending_store_name = null, pending_store_code = null
     where id = target;
  end if;

  update public.profiles set active = true where id = target and active = false;
end;
$$;
revoke all on function public.approve_user(uuid) from public;
grant execute on function public.approve_user(uuid) to authenticated;

create or replace function public.reject_request(target uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  tr text;
  ts uuid;
begin
  select role, store_id into tr, ts
    from public.profiles
   where id = target and active = false and deleted_at is null;

  if tr is null then
    return;
  end if;

  if not public.is_master() then
    if ts is null then
      raise exception 'Νέο κατάστημα: απαιτείται master';
    end if;
    if ts is distinct from public.current_store() then
      raise exception 'Δεν έχετε πρόσβαση σε αυτό το κατάστημα';
    end if;
    if not public.is_admin() then
      raise exception 'Δεν έχετε δικαίωμα';
    end if;
  end if;

  delete from auth.users where id = target;  -- cascade -> profiles
end;
$$;
revoke all on function public.reject_request(uuid) from public;
grant execute on function public.reject_request(uuid) to authenticated;

create or replace function public.delete_user(target uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  tr text;
  ts uuid;
begin
  if target = auth.uid() then
    raise exception 'Δεν μπορείτε να διαγράψετε τον εαυτό σας';
  end if;

  select role, store_id into tr, ts from public.profiles where id = target;
  if tr is null then
    return;
  end if;
  if tr = 'master' then
    raise exception 'Δεν επιτρέπεται η διαγραφή master λογαριασμού';
  end if;

  if not public.is_master() then
    if ts is distinct from public.current_store() then
      raise exception 'Δεν έχετε πρόσβαση σε αυτό το κατάστημα';
    end if;
    if tr = 'admin' then
      if not public.is_primary_admin() then
        raise exception 'Μόνο ο κύριος υπεύθυνος διαγράφει υπευθύνους';
      end if;
    elsif tr = 'user' then
      if not public.is_admin() then
        raise exception 'Δεν έχετε δικαίωμα διαγραφής';
      end if;
    end if;
  end if;

  -- Soft delete (κάδος ανακύκλωσης)
  update public.profiles
     set deleted_at = now(), deleted_by = auth.uid(), active = false, is_primary = false
   where id = target;
end;
$$;
revoke all on function public.delete_user(uuid) from public;
grant execute on function public.delete_user(uuid) to authenticated;

create or replace function public.restore_user(target uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  tr text;
  ts uuid;
begin
  select role, store_id into tr, ts from public.profiles where id = target and deleted_at is not null;
  if tr is null then
    return;
  end if;
  if tr = 'master' then
    raise exception 'Δεν επιτρέπεται';
  end if;
  if not public.is_master() then
    if ts is distinct from public.current_store() then
      raise exception 'Δεν έχετε πρόσβαση σε αυτό το κατάστημα';
    end if;
    if tr = 'admin' then
      if not public.is_primary_admin() then
        raise exception 'Μόνο ο κύριος υπεύθυνος';
      end if;
    elsif tr = 'user' then
      if not public.is_admin() then
        raise exception 'Δεν έχετε δικαίωμα';
      end if;
    end if;
  end if;

  -- Επαναφορά σε ανενεργή κατάσταση (χρειάζεται εκ νέου έγκριση)
  update public.profiles
     set deleted_at = null, deleted_by = null, active = false, is_primary = false
   where id = target;
end;
$$;
revoke all on function public.restore_user(uuid) from public;
grant execute on function public.restore_user(uuid) to authenticated;

create or replace function public.purge_user(target uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_master() then
    raise exception 'Μόνο ο master μπορεί να διαγράψει οριστικά';
  end if;
  if target = auth.uid() then
    raise exception 'Δεν μπορείτε να διαγράψετε τον εαυτό σας';
  end if;
  if exists (select 1 from public.profiles where id = target and role = 'master') then
    raise exception 'Δεν επιτρέπεται';
  end if;
  delete from auth.users where id = target;  -- cascade -> profiles
end;
$$;
revoke all on function public.purge_user(uuid) from public;
grant execute on function public.purge_user(uuid) to authenticated;

create or replace function public.set_primary(target uuid, val boolean)
returns void language plpgsql security definer set search_path = public as $$
declare
  tr text;
  ts uuid;
  cnt int;
begin
  if not public.is_primary_admin() then
    raise exception 'Μόνο ο κύριος υπεύθυνος ή ο master μπορεί να ορίσει κύριο υπεύθυνο';
  end if;

  select role, store_id into tr, ts from public.profiles where id = target;
  if tr is distinct from 'admin' then
    raise exception 'Μόνο υπεύθυνος μπορεί να γίνει κύριος υπεύθυνος';
  end if;
  if not public.is_master() and ts is distinct from public.current_store() then
    raise exception 'Δεν έχετε πρόσβαση σε αυτό το κατάστημα';
  end if;

  if val = false and (select is_primary from public.profiles where id = target) then
    select count(*) into cnt from public.profiles
     where store_id = ts and role = 'admin' and is_primary = true and active = true;
    if cnt <= 1 then
      raise exception 'Πρέπει να υπάρχει τουλάχιστον ένας κύριος υπεύθυνος';
    end if;
  end if;

  update public.profiles set is_primary = val where id = target;
end;
$$;
revoke all on function public.set_primary(uuid, boolean) from public;
grant execute on function public.set_primary(uuid, boolean) to authenticated;

-- ------------------------------------------------------------
-- 7) ROW LEVEL SECURITY
-- ------------------------------------------------------------
alter table public.stores enable row level security;
alter table public.profiles enable row level security;
alter table public.store_targets enable row level security;
alter table public.employee_targets enable row level security;
alter table public.point_entries enable row level security;
alter table public.orders enable row level security;
alter table public.order_events enable row level security;
alter table public.shifts enable row level security;
alter table public.leave_requests enable row level security;
alter table public.activity_log enable row level security;

-- stores
drop policy if exists stores_select on public.stores;
create policy stores_select on public.stores
  for select using (public.is_master() or id = public.current_store());

drop policy if exists stores_write on public.stores;
create policy stores_write on public.stores
  for all using (public.is_master() or (public.is_admin() and id = public.current_store()))
  with check (public.is_master() or (public.is_admin() and id = public.current_store()));

-- profiles
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select using (
    id = auth.uid() or public.is_master()
    or (public.is_admin() and store_id = public.current_store())
  );

drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles
  for update using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists profiles_update_admin on public.profiles;
create policy profiles_update_admin on public.profiles
  for update using (public.is_master() or (public.is_admin() and store_id = public.current_store()))
  with check (public.is_master() or (public.is_admin() and store_id = public.current_store()));

-- store_targets
drop policy if exists store_targets_select on public.store_targets;
create policy store_targets_select on public.store_targets
  for select using (public.is_master() or store_id = public.current_store());

drop policy if exists store_targets_write on public.store_targets;
create policy store_targets_write on public.store_targets
  for all using (
    public.is_master()
    or ((public.is_admin() or public.can_edit_points()) and store_id = public.current_store())
  ) with check (
    public.is_master()
    or ((public.is_admin() or public.can_edit_points()) and store_id = public.current_store())
  );

-- employee_targets
drop policy if exists employee_targets_select on public.employee_targets;
create policy employee_targets_select on public.employee_targets
  for select using (public.is_master() or store_id = public.current_store());

drop policy if exists employee_targets_insert on public.employee_targets;
create policy employee_targets_insert on public.employee_targets
  for insert with check (
    public.is_master()
    or (store_id = public.current_store()
        and (public.is_admin() or public.can_edit_points() or user_id = auth.uid()))
  );

drop policy if exists employee_targets_update on public.employee_targets;
create policy employee_targets_update on public.employee_targets
  for update using (
    public.is_master()
    or (store_id = public.current_store()
        and (public.is_admin() or public.can_edit_points() or user_id = auth.uid()))
  ) with check (
    public.is_master()
    or (store_id = public.current_store()
        and (public.is_admin() or public.can_edit_points() or user_id = auth.uid()))
  );

drop policy if exists employee_targets_delete on public.employee_targets;
create policy employee_targets_delete on public.employee_targets
  for delete using (
    public.is_master()
    or ((public.is_admin() or public.can_edit_points()) and store_id = public.current_store())
  );

-- orders
-- point_entries
drop policy if exists point_entries_select on public.point_entries;
create policy point_entries_select on public.point_entries
  for select using (public.is_master() or store_id = public.current_store());

drop policy if exists point_entries_insert on public.point_entries;
create policy point_entries_insert on public.point_entries
  for insert with check (
    public.is_master()
    or (store_id = public.current_store()
        and (public.is_admin() or public.can_edit_points() or user_id = auth.uid()))
  );

drop policy if exists point_entries_update on public.point_entries;
create policy point_entries_update on public.point_entries
  for update using (
    public.is_master()
    or (store_id = public.current_store()
        and (public.is_admin() or public.can_edit_points() or user_id = auth.uid()))
  ) with check (
    public.is_master()
    or (store_id = public.current_store()
        and (public.is_admin() or public.can_edit_points() or user_id = auth.uid()))
  );

drop policy if exists point_entries_delete on public.point_entries;
create policy point_entries_delete on public.point_entries
  for delete using (
    public.is_master()
    or (store_id = public.current_store()
        and (public.is_admin() or public.can_edit_points() or user_id = auth.uid()))
  );

drop policy if exists orders_select on public.orders;
create policy orders_select on public.orders
  for select using (public.is_master() or store_id = public.current_store());

drop policy if exists orders_insert on public.orders;
create policy orders_insert on public.orders
  for insert with check (public.is_master() or store_id = public.current_store());

drop policy if exists orders_update on public.orders;
create policy orders_update on public.orders
  for update using (public.is_master() or store_id = public.current_store())
  with check (public.is_master() or store_id = public.current_store());

drop policy if exists orders_delete_admin on public.orders;
create policy orders_delete_admin on public.orders
  for delete using (public.is_master() or (public.is_admin() and store_id = public.current_store()));

-- order_events
drop policy if exists order_events_select on public.order_events;
create policy order_events_select on public.order_events
  for select using (
    public.is_master()
    or exists (select 1 from orders o where o.id = order_id and o.store_id = public.current_store())
  );

drop policy if exists order_events_insert on public.order_events;
create policy order_events_insert on public.order_events
  for insert with check (
    public.is_master()
    or exists (select 1 from orders o where o.id = order_id and o.store_id = public.current_store())
  );

-- shifts
drop policy if exists shifts_select on public.shifts;
create policy shifts_select on public.shifts
  for select using (public.is_master() or store_id = public.current_store());

drop policy if exists shifts_write_admin on public.shifts;
create policy shifts_write_admin on public.shifts
  for all using (public.is_master() or (public.is_admin() and store_id = public.current_store()))
  with check (public.is_master() or (public.is_admin() and store_id = public.current_store()));

drop policy if exists shifts_insert_self on public.shifts;
create policy shifts_insert_self on public.shifts
  for insert with check (user_id = auth.uid() and store_id = public.current_store());

-- leave_requests
drop policy if exists leave_select on public.leave_requests;
create policy leave_select on public.leave_requests
  for select using (public.is_master() or store_id = public.current_store());

drop policy if exists leave_insert_self on public.leave_requests;
create policy leave_insert_self on public.leave_requests
  for insert with check (user_id = auth.uid() and store_id = public.current_store());

drop policy if exists leave_update_self on public.leave_requests;
create policy leave_update_self on public.leave_requests
  for update using (user_id = auth.uid())
  with check (user_id = auth.uid() and status = 'pending');

drop policy if exists leave_review_admin on public.leave_requests;
create policy leave_review_admin on public.leave_requests
  for update using (public.is_master() or (public.is_admin() and store_id = public.current_store()));

drop policy if exists leave_delete_admin on public.leave_requests;
create policy leave_delete_admin on public.leave_requests
  for delete using (public.is_master() or (public.is_admin() and store_id = public.current_store()));

-- activity_log
drop policy if exists activity_select on public.activity_log;
create policy activity_select on public.activity_log
  for select using (public.is_master() or store_id = public.current_store());

drop policy if exists activity_insert on public.activity_log;
create policy activity_insert on public.activity_log
  for insert with check (public.is_master() or store_id = public.current_store());

-- master_allowlist
alter table public.master_allowlist enable row level security;

drop policy if exists master_allowlist_select on public.master_allowlist;
create policy master_allowlist_select on public.master_allowlist
  for select using (public.is_master());

drop policy if exists master_allowlist_write on public.master_allowlist;
create policy master_allowlist_write on public.master_allowlist
  for all using (public.is_master()) with check (public.is_master());

-- ------------------------------------------------------------
-- 8) Realtime
-- ------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
  begin
    alter publication supabase_realtime add table public.orders;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.order_events;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.profiles;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.point_entries;
  exception when duplicate_object then null;
  end;
end $$;

-- ------------------------------------------------------------
-- 9) MASTER ACCOUNT
-- Ο master δεν ανήκει σε κατάστημα και ορίζεται από το master_allowlist.
-- ------------------------------------------------------------
update public.profiles set store_id = null where role = 'master';

-- ============================================================
-- 10) ΥΠΗΡΕΣΙΕΣ / ΠΩΛΗΣΕΙΣ / ΗΜΕΡΟΛΟΓΙΟ (Phase 1) — προσθετικό
-- ============================================================

alter table public.profiles add column if not exists is_seller boolean not null default true;
alter table public.stores add column if not exists fallback_work_days text not null default '1,2,3,4,5,6';

create table if not exists public.service_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  unit text not null default 'count' check (unit in ('count','currency')),
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

insert into public.service_categories (name, unit, sort_order) values
  ('Κινητή', 'count', 10),
  ('Broadband', 'count', 20),
  ('CD Fixed', 'count', 30),
  ('OTE TV', 'count', 40),
  ('CD Mob', 'count', 50),
  ('Business Κινητής', 'count', 60),
  ('Πρώτη Ανανέωση', 'count', 70),
  ('FTTH', 'count', 80),
  ('Φορητότητα Κινητής', 'count', 90),
  ('Φορητότητα Σταθερής', 'count', 100),
  ('Protergia', 'count', 110),
  ('Payzy Pro', 'count', 120),
  ('Τζίρος', 'currency', 130)
on conflict (name) do nothing;

create table if not exists public.store_categories (
  store_id uuid not null references public.stores(id) on delete cascade,
  category_id uuid not null references public.service_categories(id) on delete cascade,
  active boolean not null default true,
  sort_order integer,
  primary key (store_id, category_id)
);

create table if not exists public.store_category_targets (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  category_id uuid not null references public.service_categories(id) on delete cascade,
  month text not null,
  target numeric not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (store_id, category_id, month)
);

create table if not exists public.seller_category_targets (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  category_id uuid not null references public.service_categories(id) on delete cascade,
  month text not null,
  target numeric not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (store_id, user_id, category_id, month)
);

create table if not exists public.sales_entries (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  category_id uuid not null references public.service_categories(id) on delete cascade,
  date date not null,
  quantity numeric not null default 0,
  source text not null default 'manual' check (source in ('manual','import')),
  status text not null default 'active' check (status in ('active','cancelled')),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (store_id, user_id, category_id, date)
);

create table if not exists public.store_calendar (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  date date not null,
  is_working boolean not null default false,
  note text,
  open_time text,
  close_time text,
  created_at timestamptz not null default now(),
  unique (store_id, date)
);

create index if not exists idx_sales_store_date on public.sales_entries(store_id, date);
create index if not exists idx_sales_user_date on public.sales_entries(user_id, date);
create index if not exists idx_sales_category on public.sales_entries(category_id);
create index if not exists idx_seller_targets_store on public.seller_category_targets(store_id, month);
create index if not exists idx_store_calendar_store on public.store_calendar(store_id, date);

drop trigger if exists trg_store_category_targets_updated on public.store_category_targets;
create trigger trg_store_category_targets_updated before update on public.store_category_targets
  for each row execute function public.touch_updated_at();

drop trigger if exists trg_seller_category_targets_updated on public.seller_category_targets;
create trigger trg_seller_category_targets_updated before update on public.seller_category_targets
  for each row execute function public.touch_updated_at();

drop trigger if exists trg_sales_entries_updated on public.sales_entries;
create trigger trg_sales_entries_updated before update on public.sales_entries
  for each row execute function public.touch_updated_at();

-- RLS
alter table public.service_categories enable row level security;
alter table public.store_categories enable row level security;
alter table public.store_category_targets enable row level security;
alter table public.seller_category_targets enable row level security;
alter table public.sales_entries enable row level security;
alter table public.store_calendar enable row level security;

-- service_categories: όλοι διαβάζουν, μόνο master γράφει (κεντρική λίστα)
drop policy if exists service_categories_select on public.service_categories;
create policy service_categories_select on public.service_categories
  for select using (auth.uid() is not null);

drop policy if exists service_categories_write on public.service_categories;
create policy service_categories_write on public.service_categories
  for all using (public.is_master()) with check (public.is_master());

-- store_categories
drop policy if exists store_categories_select on public.store_categories;
create policy store_categories_select on public.store_categories
  for select using (public.is_master() or store_id = public.current_store());

drop policy if exists store_categories_write on public.store_categories;
create policy store_categories_write on public.store_categories
  for all using (public.is_master() or (public.is_admin() and store_id = public.current_store()))
  with check (public.is_master() or (public.is_admin() and store_id = public.current_store()));

-- store_category_targets
drop policy if exists store_category_targets_select on public.store_category_targets;
create policy store_category_targets_select on public.store_category_targets
  for select using (public.is_master() or store_id = public.current_store());

drop policy if exists store_category_targets_write on public.store_category_targets;
create policy store_category_targets_write on public.store_category_targets
  for all using (public.is_master() or (public.is_admin() and store_id = public.current_store()))
  with check (public.is_master() or (public.is_admin() and store_id = public.current_store()));

-- seller_category_targets: ο πωλητής βλέπει μόνο τα δικά του
drop policy if exists seller_category_targets_select on public.seller_category_targets;
create policy seller_category_targets_select on public.seller_category_targets
  for select using (
    public.is_master()
    or (public.is_admin() and store_id = public.current_store())
    or user_id = auth.uid()
  );

drop policy if exists seller_category_targets_write on public.seller_category_targets;
create policy seller_category_targets_write on public.seller_category_targets
  for all using (public.is_master() or (public.is_admin() and store_id = public.current_store()))
  with check (public.is_master() or (public.is_admin() and store_id = public.current_store()));

-- sales_entries: ο πωλητής βλέπει/γράφει μόνο τα δικά του
drop policy if exists sales_entries_select on public.sales_entries;
create policy sales_entries_select on public.sales_entries
  for select using (
    public.is_master()
    or (public.is_admin() and store_id = public.current_store())
    or user_id = auth.uid()
  );

drop policy if exists sales_entries_insert on public.sales_entries;
create policy sales_entries_insert on public.sales_entries
  for insert with check (
    (public.is_master() or (public.is_admin() and store_id = public.current_store()))
    or (store_id = public.current_store() and user_id = auth.uid())
  );

drop policy if exists sales_entries_update on public.sales_entries;
create policy sales_entries_update on public.sales_entries
  for update using (
    (public.is_master() or (public.is_admin() and store_id = public.current_store()))
    or (store_id = public.current_store() and user_id = auth.uid())
  ) with check (
    (public.is_master() or (public.is_admin() and store_id = public.current_store()))
    or (store_id = public.current_store() and user_id = auth.uid())
  );

drop policy if exists sales_entries_delete on public.sales_entries;
create policy sales_entries_delete on public.sales_entries
  for delete using (public.is_master() or (public.is_admin() and store_id = public.current_store()));

-- store_calendar
drop policy if exists store_calendar_select on public.store_calendar;
create policy store_calendar_select on public.store_calendar
  for select using (public.is_master() or store_id = public.current_store());

drop policy if exists store_calendar_write on public.store_calendar;
create policy store_calendar_write on public.store_calendar
  for all using (public.is_master() or (public.is_admin() and store_id = public.current_store()))
  with check (public.is_master() or (public.is_admin() and store_id = public.current_store()));

-- Aggregate για εμφάνιση συνολικής πορείας καταστήματος στους πωλητές
-- (χωρίς να εκθέτει μεμονωμένες εγγραφές άλλων πωλητών)
create or replace function public.store_category_sales(p_store uuid, p_month text)
returns table(category_id uuid, quantity numeric)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_master() then
    if public.current_store() is null or p_store <> public.current_store() then
      raise exception 'Δεν έχετε πρόσβαση σε αυτό το κατάστημα';
    end if;
  end if;

  return query
    select s.category_id, coalesce(sum(s.quantity), 0)
    from public.sales_entries s
    where s.store_id = p_store
      and s.status = 'active'
      and s.date >= (p_month || '-01')::date
      and s.date < ((p_month || '-01')::date + interval '1 month')::date
    group by s.category_id;
end;
$$;
revoke all on function public.store_category_sales(uuid, text) from public;
grant execute on function public.store_category_sales(uuid, text) to authenticated;

-- Realtime για άμεση ενημέρωση πωλήσεων
do $$
begin
  begin
    alter publication supabase_realtime add table public.sales_entries;
  exception when duplicate_object then null;
  end;
end $$;

-- ============================================================
-- 11) ΕΡΓΑΣΙΕΣ ΚΑΤΑΣΤΗΜΑΤΟΣ (Phase 3) — προσθετικό
-- ============================================================

create table if not exists public.task_templates (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  title text not null,
  category text,
  recurrence text not null default 'daily'
    check (recurrence in ('daily','weekly_days','monthly_date','every_n_days')),
  weekdays integer[] not null default '{}',
  month_day integer,
  every_n integer not null default 1,
  due_time text,
  requires_authorized boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.store_tasks (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  template_id uuid references public.task_templates(id) on delete set null,
  title text not null,
  category text,
  assigned_user_id uuid references public.profiles(id) on delete set null,
  scheduled_date date not null,
  due_time text,
  status text not null default 'pending' check (status in ('pending','in_progress','done')),
  requires_authorized boolean not null default false,
  notes text,
  completed_at timestamptz,
  completed_by uuid references public.profiles(id) on delete set null,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_store_tasks_store_date on public.store_tasks(store_id, scheduled_date);
create index if not exists idx_store_tasks_user_date on public.store_tasks(assigned_user_id, scheduled_date);
create index if not exists idx_task_templates_store on public.task_templates(store_id);

-- Αποφυγή διπλής αυτόματης δημιουργίας ίδιου template για την ίδια ημέρα
create unique index if not exists uniq_store_tasks_template_date
  on public.store_tasks(store_id, template_id, scheduled_date)
  where template_id is not null;

drop trigger if exists trg_store_tasks_updated on public.store_tasks;
create trigger trg_store_tasks_updated before update on public.store_tasks
  for each row execute function public.touch_updated_at();

create or replace function public.protect_task_fields()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    return new;
  end if;
  if public.is_master() or (public.is_admin() and old.store_id = public.current_store()) then
    return new;
  end if;
  if old.assigned_user_id = auth.uid() then
    new.store_id := old.store_id;
    new.template_id := old.template_id;
    new.title := old.title;
    new.category := old.category;
    new.assigned_user_id := old.assigned_user_id;
    new.scheduled_date := old.scheduled_date;
    new.due_time := old.due_time;
    new.requires_authorized := old.requires_authorized;
    new.created_by := old.created_by;
  else
    raise exception 'Δεν έχετε δικαίωμα επεξεργασίας αυτής της εργασίας';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_protect_task on public.store_tasks;
create trigger trg_protect_task before update on public.store_tasks
  for each row execute function public.protect_task_fields();

alter table public.task_templates enable row level security;
alter table public.store_tasks enable row level security;

drop policy if exists task_templates_select on public.task_templates;
create policy task_templates_select on public.task_templates
  for select using (public.is_master() or store_id = public.current_store());

drop policy if exists task_templates_write on public.task_templates;
create policy task_templates_write on public.task_templates
  for all using (public.is_master() or (public.is_admin() and store_id = public.current_store()))
  with check (public.is_master() or (public.is_admin() and store_id = public.current_store()));

drop policy if exists store_tasks_select on public.store_tasks;
create policy store_tasks_select on public.store_tasks
  for select using (
    public.is_master()
    or (public.is_admin() and store_id = public.current_store())
    or assigned_user_id = auth.uid()
  );

drop policy if exists store_tasks_insert on public.store_tasks;
create policy store_tasks_insert on public.store_tasks
  for insert with check (public.is_master() or (public.is_admin() and store_id = public.current_store()));

drop policy if exists store_tasks_update on public.store_tasks;
create policy store_tasks_update on public.store_tasks
  for update using (
    public.is_master()
    or (public.is_admin() and store_id = public.current_store())
    or assigned_user_id = auth.uid()
  ) with check (
    public.is_master()
    or (public.is_admin() and store_id = public.current_store())
    or assigned_user_id = auth.uid()
  );

drop policy if exists store_tasks_delete on public.store_tasks;
create policy store_tasks_delete on public.store_tasks
  for delete using (public.is_master() or (public.is_admin() and store_id = public.current_store()));

do $$
begin
  begin
    alter publication supabase_realtime add table public.store_tasks;
  exception when duplicate_object then null;
  end;
end $$;

-- ============================================================
-- 12) ΜΟΤΙΒΑ ΩΡΑΡΙΟΥ + ΑΥΤΟΜΑΤΟ ΠΡΟΓΡΑΜΜΑ (Phase 3b)
-- ============================================================

alter table public.stores add column if not exists min_staff integer not null default 1;

create table if not exists public.store_patterns (
  store_id uuid not null references public.stores(id) on delete cascade,
  weekday integer not null check (weekday between 1 and 7),
  closed boolean not null default false,
  level text not null default 'full' check (level in ('split','short','full')),
  start_time text,
  end_time text,
  note text,
  primary key (store_id, weekday)
);

alter table public.shifts drop constraint if exists shifts_shift_type_check;
alter table public.shifts add constraint shifts_shift_type_check
  check (shift_type in ('open','mid','close','custom','repo','adeia','split','short','full'));

alter table public.store_patterns enable row level security;

drop policy if exists store_patterns_select on public.store_patterns;
create policy store_patterns_select on public.store_patterns
  for select using (public.is_master() or store_id = public.current_store());

drop policy if exists store_patterns_write on public.store_patterns;
create policy store_patterns_write on public.store_patterns
  for all using (public.is_master() or (public.is_admin() and store_id = public.current_store()))
  with check (public.is_master() or (public.is_admin() and store_id = public.current_store()));

-- ============================================================
-- 13) ΔΙΚΑΙΟΣΥΝΗ ΠΡΟΓΡΑΜΜΑΤΟΣ + ΗΜΕΡΗΣΙΕΣ ΠΩΛΗΣΕΙΣ (charts)
-- ============================================================

create table if not exists public.schedule_fairness (
  store_id uuid not null references public.stores(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  month text not null,
  split_offs integer not null default 0,
  short_offs integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (store_id, user_id, month)
);

create index if not exists idx_fairness_store on public.schedule_fairness(store_id, month);

alter table public.schedule_fairness enable row level security;

drop policy if exists schedule_fairness_select on public.schedule_fairness;
create policy schedule_fairness_select on public.schedule_fairness
  for select using (public.is_master() or store_id = public.current_store());

drop policy if exists schedule_fairness_write on public.schedule_fairness;
create policy schedule_fairness_write on public.schedule_fairness
  for all using (public.is_master() or (public.is_admin() and store_id = public.current_store()))
  with check (public.is_master() or (public.is_admin() and store_id = public.current_store()));

-- Ημερήσια συγκεντρωτικά (τεμάχια) για γράφημα χωρίς έκθεση μεμονωμένων πωλητών
create or replace function public.store_daily_sales(p_store uuid, p_month text)
returns table(sales_date date, quantity numeric)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_master() then
    if public.current_store() is null or p_store <> public.current_store() then
      raise exception 'Δεν έχετε πρόσβαση σε αυτό το κατάστημα';
    end if;
  end if;

  return query
    select s.date as sales_date, coalesce(sum(s.quantity), 0) as quantity
    from public.sales_entries s
    join public.service_categories c on c.id = s.category_id
    where s.store_id = p_store
      and s.status = 'active'
      and c.unit = 'count'
      and s.date >= (p_month || '-01')::date
      and s.date < ((p_month || '-01')::date + interval '1 month')::date
    group by s.date
    order by s.date;
end;
$$;
revoke all on function public.store_daily_sales(uuid, text) from public;
grant execute on function public.store_daily_sales(uuid, text) to authenticated;

-- ------------------------------------------------------------
-- 14) ΑΤΟΜΙΚΗ ΑΝΤΙΚΑΤΑΣΤΑΣΗ ΠΡΟΓΡΑΜΜΑΤΟΣ ΜΗΝΑ
-- Διαγραφή + εισαγωγή βαρδιών και ενημέρωση δικαιοσύνης σε ένα transaction.
-- ------------------------------------------------------------
create or replace function public.replace_month_shifts(
  p_store uuid,
  p_month text,
  p_shifts jsonb,
  p_fairness jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer := 0;
begin
  if not public.is_master() then
    if public.current_store() is null or p_store <> public.current_store() then
      raise exception 'Δεν έχετε πρόσβαση σε αυτό το κατάστημα';
    end if;
  end if;
  if not public.is_admin() then
    raise exception 'Δεν έχετε δικαίωμα επεξεργασίας προγράμματος';
  end if;
  if p_month !~ '^[0-9]{4}-[0-9]{2}$' then
    raise exception 'Μη έγκυρος μήνας';
  end if;

  delete from public.shifts
   where store_id = p_store
     and date >= (p_month || '-01')::date
     and date < ((p_month || '-01')::date + interval '1 month')::date;

  insert into public.shifts (store_id, user_id, date, shift_type, start_time, end_time, note)
  select p_store,
         (x->>'user_id')::uuid,
         (x->>'date')::date,
         x->>'shift_type',
         nullif(x->>'start_time', ''),
         nullif(x->>'end_time', ''),
         nullif(x->>'note', '')
  from jsonb_array_elements(coalesce(p_shifts, '[]'::jsonb)) x
  where (x->>'user_id') is not null
    and (x->>'date') is not null
    and (x->>'shift_type') is not null
    and to_char((x->>'date')::date, 'YYYY-MM') = p_month
    and exists (
      select 1 from public.profiles p
      where p.id = (x->>'user_id')::uuid and p.store_id = p_store
    );

  get diagnostics v_count = row_count;

  delete from public.schedule_fairness
   where store_id = p_store and month = p_month;

  insert into public.schedule_fairness (store_id, user_id, month, split_offs, short_offs, updated_at)
  select p_store,
         (x->>'user_id')::uuid,
         p_month,
         coalesce((x->>'split_offs')::integer, 0),
         coalesce((x->>'short_offs')::integer, 0),
         now()
  from jsonb_array_elements(coalesce(p_fairness, '[]'::jsonb)) x
  where (x->>'user_id') is not null
    and exists (
      select 1 from public.profiles p
      where p.id = (x->>'user_id')::uuid and p.store_id = p_store
    );

  insert into public.activity_log (store_id, actor_id, action, detail)
  values (p_store, auth.uid(), 'Αυτόματο πρόγραμμα', p_month || ': ' || v_count || ' βάρδιες');
end;
$$;
revoke all on function public.replace_month_shifts(uuid, text, jsonb, jsonb) from public;
grant execute on function public.replace_month_shifts(uuid, text, jsonb, jsonb) to authenticated;

-- ============================================================
-- ΓΕΡΜΑΝΟΣ MANAGER — Σχήμα βάσης δεδομένων (Supabase / Postgres)
-- Τρέξε ΟΛΟ αυτό το αρχείο μία φορά στο Supabase Dashboard:
--   SQL Editor -> New query -> Paste -> Run
-- Είναι ασφαλές να τρέξει ξανά (idempotent).
-- ============================================================

create extension if not exists pgcrypto;

-- ------------------------------------------------------------
-- 1) ΠΙΝΑΚΕΣ (πρώτα οι πίνακες, μετά οι συναρτήσεις που τους χρησιμοποιούν)
-- ------------------------------------------------------------
create table if not exists public.stores (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  address text,
  phone text,
  open_hours text,
  created_at timestamptz not null default now()
);

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  role text not null default 'user' check (role in ('admin','user')),
  store_id uuid references public.stores(id) on delete set null,
  phone text,
  email text not null,
  active boolean not null default false,
  can_edit_points boolean not null default false,
  created_at timestamptz not null default now()
);

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
-- 2) Δείκτες
-- ------------------------------------------------------------
create index if not exists idx_profiles_store on public.profiles(store_id);
create index if not exists idx_targets_store_month on public.employee_targets(store_id, month);
create index if not exists idx_store_targets_month on public.store_targets(store_id, month);
create index if not exists idx_orders_store_status on public.orders(store_id, status);
create index if not exists idx_orders_product_code on public.orders(store_id, product_code);
create index if not exists idx_order_events_order on public.order_events(order_id);
create index if not exists idx_shifts_store_date on public.shifts(store_id, date);
create index if not exists idx_shifts_user on public.shifts(user_id, date);
create index if not exists idx_leave_store on public.leave_requests(store_id);
create index if not exists idx_leave_user on public.leave_requests(user_id);

-- ------------------------------------------------------------
-- 3) Βοηθητικές συναρτήσεις (security definer — αποφεύγουν RLS recursion)
-- ------------------------------------------------------------
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from profiles
    where id = auth.uid() and role = 'admin' and active = true
  );
$$;

create or replace function public.current_store()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select store_id from profiles where id = auth.uid();
$$;

create or replace function public.can_edit_points()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select can_edit_points from profiles
    where id = auth.uid() and active = true
  ), false);
$$;

-- ------------------------------------------------------------
-- 4) Triggers: updated_at
-- ------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
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

-- ------------------------------------------------------------
-- 5) Trigger: ο ΠΡΩΤΟΣ χρήστης γίνεται admin + active
-- ------------------------------------------------------------
create or replace function public.auto_promote_first_admin()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  cnt integer;
begin
  select count(*) into cnt from public.profiles;
  if cnt = 0 then
    new.role := 'admin';
    new.active := true;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_auto_admin on public.profiles;
create trigger trg_auto_admin before insert on public.profiles
  for each row execute function public.auto_promote_first_admin();

-- ------------------------------------------------------------
-- 6) Trigger: προστασία ευαίσθητων πεδίων profile (κατά privilege escalation)
-- ------------------------------------------------------------
create or replace function public.protect_profile_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    new.role := old.role;
    new.active := old.active;
    new.can_edit_points := old.can_edit_points;
    new.store_id := old.store_id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_protect_profile on public.profiles;
create trigger trg_protect_profile before update on public.profiles
  for each row execute function public.protect_profile_fields();

-- ------------------------------------------------------------
-- 7) Trigger: προστασία πόντων (ο υπάλληλος αλλάζει μόνο projection)
-- ------------------------------------------------------------
create or replace function public.protect_target_points()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
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

-- ------------------------------------------------------------
-- 8) Trigger: δημιουργία profile αυτόματα κατά την εγγραφή (auth.users)
--    (δουλεύει ακόμη κι αν απαιτείται επιβεβαίωση email)
-- ------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  s_id uuid;
  s_name text;
  v_full text;
begin
  v_full := coalesce(nullif(new.raw_user_meta_data->>'full_name', ''), new.email);
  s_name := coalesce(nullif(new.raw_user_meta_data->>'store_name', ''), 'Κατάστημα');

  select id into s_id from public.stores where name = s_name limit 1;
  if s_id is null then
    insert into public.stores(name) values (s_name) returning id into s_id;
  end if;

  insert into public.profiles (id, full_name, role, store_id, email, active, can_edit_points)
  values (new.id, v_full, 'user', s_id, new.email, false, false)
  on conflict (id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ------------------------------------------------------------
-- 9) ROW LEVEL SECURITY
-- ------------------------------------------------------------
alter table public.stores enable row level security;
alter table public.profiles enable row level security;
alter table public.store_targets enable row level security;
alter table public.employee_targets enable row level security;
alter table public.orders enable row level security;
alter table public.order_events enable row level security;
alter table public.shifts enable row level security;
alter table public.leave_requests enable row level security;
alter table public.activity_log enable row level security;

-- ---------- stores ----------
drop policy if exists stores_select on public.stores;
create policy stores_select on public.stores
  for select using (auth.uid() is not null);

drop policy if exists stores_write on public.stores;
create policy stores_write on public.stores
  for all using (public.is_admin()) with check (public.is_admin());

-- ---------- profiles ----------
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select using (id = auth.uid() or public.is_admin());

drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles
  for update using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists profiles_update_admin on public.profiles;
create policy profiles_update_admin on public.profiles
  for update using (public.is_admin());

-- ---------- store_targets ----------
drop policy if exists store_targets_select on public.store_targets;
create policy store_targets_select on public.store_targets
  for select using (store_id = public.current_store());

drop policy if exists store_targets_write on public.store_targets;
create policy store_targets_write on public.store_targets
  for all using (public.is_admin() or public.can_edit_points())
  with check (public.is_admin() or public.can_edit_points());

-- ---------- employee_targets ----------
drop policy if exists employee_targets_select on public.employee_targets;
create policy employee_targets_select on public.employee_targets
  for select using (store_id = public.current_store());

drop policy if exists employee_targets_insert on public.employee_targets;
create policy employee_targets_insert on public.employee_targets
  for insert with check (
    store_id = public.current_store()
    and (public.is_admin() or public.can_edit_points() or user_id = auth.uid())
  );

drop policy if exists employee_targets_update on public.employee_targets;
create policy employee_targets_update on public.employee_targets
  for update using (
    store_id = public.current_store()
    and (public.is_admin() or public.can_edit_points() or user_id = auth.uid())
  )
  with check (
    store_id = public.current_store()
    and (public.is_admin() or public.can_edit_points() or user_id = auth.uid())
  );

drop policy if exists employee_targets_delete on public.employee_targets;
create policy employee_targets_delete on public.employee_targets
  for delete using (public.is_admin() or public.can_edit_points());

-- ---------- orders ----------
drop policy if exists orders_select on public.orders;
create policy orders_select on public.orders
  for select using (store_id = public.current_store());

drop policy if exists orders_insert on public.orders;
create policy orders_insert on public.orders
  for insert with check (store_id = public.current_store());

drop policy if exists orders_update on public.orders;
create policy orders_update on public.orders
  for update using (store_id = public.current_store())
  with check (store_id = public.current_store());

drop policy if exists orders_delete_admin on public.orders;
create policy orders_delete_admin on public.orders
  for delete using (public.is_admin());

-- ---------- order_events ----------
drop policy if exists order_events_select on public.order_events;
create policy order_events_select on public.order_events
  for select using (
    exists (select 1 from orders o where o.id = order_id and o.store_id = public.current_store())
  );

drop policy if exists order_events_insert on public.order_events;
create policy order_events_insert on public.order_events
  for insert with check (
    exists (select 1 from orders o where o.id = order_id and o.store_id = public.current_store())
  );

-- ---------- shifts ----------
drop policy if exists shifts_select on public.shifts;
create policy shifts_select on public.shifts
  for select using (store_id = public.current_store());

drop policy if exists shifts_write_admin on public.shifts;
create policy shifts_write_admin on public.shifts
  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists shifts_insert_self on public.shifts;
create policy shifts_insert_self on public.shifts
  for insert with check (user_id = auth.uid() and store_id = public.current_store());

-- ---------- leave_requests ----------
drop policy if exists leave_select on public.leave_requests;
create policy leave_select on public.leave_requests
  for select using (store_id = public.current_store());

drop policy if exists leave_insert_self on public.leave_requests;
create policy leave_insert_self on public.leave_requests
  for insert with check (user_id = auth.uid() and store_id = public.current_store());

drop policy if exists leave_update_self on public.leave_requests;
create policy leave_update_self on public.leave_requests
  for update using (user_id = auth.uid())
  with check (user_id = auth.uid() and status = 'pending');

drop policy if exists leave_review_admin on public.leave_requests;
create policy leave_review_admin on public.leave_requests
  for update using (public.is_admin());

drop policy if exists leave_delete_admin on public.leave_requests;
create policy leave_delete_admin on public.leave_requests
  for delete using (public.is_admin());

-- ---------- activity_log ----------
drop policy if exists activity_select on public.activity_log;
create policy activity_select on public.activity_log
  for select using (store_id = public.current_store());

drop policy if exists activity_insert on public.activity_log;
create policy activity_insert on public.activity_log
  for insert with check (store_id = public.current_store());

-- ------------------------------------------------------------
-- 10) Realtime (ζωντανή ενημέρωση παραγγελιών/γεγονότων)
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
end $$;

-- Store-specific points by service category, monthly targets and audited corrections.
-- Run after 20261105_store_hierarchy_transfers.sql.
begin;

create table if not exists public.point_categories(
  category_key text primary key check(category_key in ('fixed','mobile','tv','protergia','fixed_portability','mobile_portability')),
  name text not null unique,
  sort_order integer not null unique
);
insert into public.point_categories(category_key,name,sort_order) values
  ('fixed','Σταθερή',10),('mobile','Κινητή',20),('tv','Τηλεόραση',30),
  ('protergia','Protergia',40),('fixed_portability','Φορητότητα σταθερής',50),
  ('mobile_portability','Φορητότητα κινητής',60)
on conflict(category_key) do update set name=excluded.name,sort_order=excluded.sort_order;
alter table public.point_categories enable row level security;
revoke all on public.point_categories from anon,authenticated;
grant select on public.point_categories to authenticated;
drop policy if exists point_categories_read on public.point_categories;
create policy point_categories_read on public.point_categories for select to authenticated using(true);

create table if not exists public.store_point_rules(
  store_id uuid not null references public.stores(id) on delete cascade,
  service_category_id uuid not null references public.service_categories(id),
  valid_from date not null,
  point_category_key text references public.point_categories(category_key),
  points_per_unit numeric(12,4) not null default 0 check(points_per_unit between 0 and 100000),
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default statement_timestamp(),
  primary key(store_id,service_category_id,valid_from)
);
create index if not exists store_point_rules_lookup on public.store_point_rules(store_id,service_category_id,valid_from desc);
alter table public.store_point_rules enable row level security;
revoke all on public.store_point_rules from anon,authenticated;
grant select on public.store_point_rules to authenticated;
drop policy if exists store_point_rules_read on public.store_point_rules;
create policy store_point_rules_read on public.store_point_rules for select to authenticated using(public.can_access_store(store_id));
-- Direct table DML is revoked; writes go through the permission-checking RPC.
-- Keep audit trigger but do not block platform onboarding's after-store seed.
drop trigger if exists trg_support_write_audit on public.store_point_rules;
create trigger trg_support_write_audit after insert or update or delete on public.store_point_rules
  for each row execute function public.audit_support_write();

create table if not exists public.store_point_category_targets(
  store_id uuid not null references public.stores(id) on delete cascade,
  category_key text not null references public.point_categories(category_key),
  month text not null check(month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  target numeric(12,2) not null default 0 check(target>=0),
  created_by uuid references public.profiles(id),
  updated_at timestamptz not null default statement_timestamp(),
  primary key(store_id,category_key,month)
);
create table if not exists public.employee_point_category_targets(
  store_id uuid not null references public.stores(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  category_key text not null references public.point_categories(category_key),
  month text not null check(month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  target numeric(12,2) not null default 0 check(target>=0),
  created_by uuid references public.profiles(id),
  updated_at timestamptz not null default statement_timestamp(),
  primary key(store_id,user_id,category_key,month)
);
alter table public.store_point_category_targets enable row level security;
alter table public.employee_point_category_targets enable row level security;
revoke all on public.store_point_category_targets,public.employee_point_category_targets from anon,authenticated;
grant select on public.store_point_category_targets,public.employee_point_category_targets to authenticated;
drop policy if exists store_point_target_read on public.store_point_category_targets;
create policy store_point_target_read on public.store_point_category_targets for select to authenticated using(public.can_access_store(store_id));
drop policy if exists employee_point_target_read on public.employee_point_category_targets;
create policy employee_point_target_read on public.employee_point_category_targets for select to authenticated
  using(public.can_access_store(store_id) and (user_id=auth.uid() or public.can_manage_store(store_id)));
drop trigger if exists trg_support_write_guard on public.store_point_category_targets;
create trigger trg_support_write_guard before insert or update or delete on public.store_point_category_targets
  for each row execute function public.guard_support_write();
drop trigger if exists trg_support_write_audit on public.store_point_category_targets;
create trigger trg_support_write_audit after insert or update or delete on public.store_point_category_targets
  for each row execute function public.audit_support_write();
drop trigger if exists trg_support_write_guard on public.employee_point_category_targets;
create trigger trg_support_write_guard before insert or update or delete on public.employee_point_category_targets
  for each row execute function public.guard_support_write();
drop trigger if exists trg_support_write_audit on public.employee_point_category_targets;
create trigger trg_support_write_audit after insert or update or delete on public.employee_point_category_targets
  for each row execute function public.audit_support_write();

create table if not exists public.point_category_adjustments(
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  category_key text not null references public.point_categories(category_key),
  date date not null,
  points_delta numeric(12,2) not null check(points_delta<>0),
  reason text not null check(length(trim(reason)) between 5 and 1000),
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default statement_timestamp()
);
create index if not exists point_category_adjustments_month on public.point_category_adjustments(store_id,date,user_id);
alter table public.point_category_adjustments enable row level security;
revoke all on public.point_category_adjustments from anon,authenticated;
grant select on public.point_category_adjustments to authenticated;
drop policy if exists point_category_adjustments_read on public.point_category_adjustments;
create policy point_category_adjustments_read on public.point_category_adjustments for select to authenticated
  using(public.can_access_store(store_id) and (user_id=auth.uid() or public.can_manage_store(store_id)));
drop trigger if exists trg_support_write_guard on public.point_category_adjustments;
create trigger trg_support_write_guard before insert or update or delete on public.point_category_adjustments
  for each row execute function public.guard_support_write();
drop trigger if exists trg_support_write_audit on public.point_category_adjustments;
create trigger trg_support_write_audit after insert or update or delete on public.point_category_adjustments
  for each row execute function public.audit_support_write();

create or replace function public.default_point_bucket(p_service_name text)
returns text language sql immutable as $$
  select case
  when p_service_name in ('Broadband','CD Fixed','FTTH') then 'fixed'
  when p_service_name in ('Κινητή','CD Mob','Business Κινητής','Πρώτη Ανανέωση') then 'mobile'
  when p_service_name='OTE TV' then 'tv'
  when p_service_name='Protergia' then 'protergia'
  when p_service_name='Φορητότητα Σταθερής' then 'fixed_portability'
  when p_service_name='Φορητότητα Κινητής' then 'mobile_portability'
  else null end;
$$;
revoke all on function public.default_point_bucket(text) from public,anon,authenticated;

create or replace function public.seed_store_point_rules()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  insert into public.store_point_rules(store_id,service_category_id,valid_from,point_category_key,points_per_unit)
  select new.id,c.id,current_date,public.default_point_bucket(c.name),0 from public.service_categories c
  on conflict(store_id,service_category_id,valid_from) do nothing;
  return new;
end;
$$;
drop trigger if exists trg_seed_store_point_rules on public.stores;
create trigger trg_seed_store_point_rules after insert on public.stores
  for each row execute function public.seed_store_point_rules();

-- Backfill every current store, including the W4-owned demo store.
insert into public.store_point_rules(store_id,service_category_id,valid_from,point_category_key,points_per_unit)
select s.id,c.id,current_date,public.default_point_bucket(c.name),0
from public.stores s cross join public.service_categories c
where not exists(select 1 from public.store_point_rules r where r.store_id=s.id and r.service_category_id=c.id)
on conflict(store_id,service_category_id,valid_from) do nothing;

create or replace function public.save_store_point_rule(
  p_store uuid,p_service_category uuid,p_point_category text,p_points_per_unit numeric,p_effective_from date default current_date
)
returns void language plpgsql security definer set search_path=public as $$
begin
  if not public.can_lead_store(p_store) or p_service_category is null or p_effective_from is null
    or p_points_per_unit is null or p_points_per_unit<0 or p_points_per_unit>100000
    or (p_point_category is not null and not exists(select 1 from public.point_categories where category_key=p_point_category)) then
    raise exception 'Μη έγκυρος κανόνας πόντων ή ανεπαρκή δικαιώματα' using errcode='42501'; end if;
  if p_effective_from<current_date and not public.is_master() then
    raise exception 'Οι αλλαγές βαθμολογίας ισχύουν από σήμερα και μετά' using errcode='22023'; end if;
  if not exists(select 1 from public.service_categories where id=p_service_category) then raise exception 'Η υπηρεσία δεν βρέθηκε'; end if;
  insert into public.store_point_rules(store_id,service_category_id,valid_from,point_category_key,points_per_unit,updated_by)
    values(p_store,p_service_category,p_effective_from,p_point_category,p_points_per_unit,auth.uid())
  on conflict(store_id,service_category_id,valid_from) do update set point_category_key=excluded.point_category_key,
    points_per_unit=excluded.points_per_unit,updated_by=excluded.updated_by,updated_at=statement_timestamp();
end;
$$;

create or replace function public.save_point_category_target(
  p_store uuid,p_user uuid,p_category text,p_month text,p_target numeric
)
returns void language plpgsql security definer set search_path=public as $$
begin
  if not public.can_manage_store(p_store) or p_category is null or p_month !~ '^[0-9]{4}-(0[1-9]|1[0-2])$'
    or p_target is null or p_target<0 or p_target>100000000 then
    raise exception 'Μη έγκυρος στόχος πόντων' using errcode='22023'; end if;
  if p_user is null then
    insert into public.store_point_category_targets(store_id,category_key,month,target,created_by)
      values(p_store,p_category,p_month,p_target,auth.uid())
    on conflict(store_id,category_key,month) do update set target=excluded.target,updated_at=statement_timestamp();
  else
    if not exists(select 1 from public.store_memberships where store_id=p_store and user_id=p_user and active)
      or (not public.is_master() and not public.can_manage_store_member(p_store,p_user)) then
      raise exception 'Μόνο ανώτερος ρόλος ορίζει στόχο εργαζομένου' using errcode='42501'; end if;
    insert into public.employee_point_category_targets(store_id,user_id,category_key,month,target,created_by)
      values(p_store,p_user,p_category,p_month,p_target,auth.uid())
    on conflict(store_id,user_id,category_key,month) do update set target=excluded.target,updated_at=statement_timestamp();
  end if;
end;
$$;

create or replace function public.adjust_point_category(
  p_store uuid,p_user uuid,p_category text,p_date date,p_delta numeric,p_reason text
)
returns uuid language plpgsql security definer set search_path=public as $$
declare v_id uuid;
begin
  if not public.can_access_store(p_store) or p_user is null or p_category is null or p_date is null or p_delta is null
    or p_delta=0 or abs(p_delta)>1000000 or length(trim(coalesce(p_reason,'')))<5 or length(p_reason)>1000 then
    raise exception 'Ελέγξτε ημερομηνία, κατηγορία, προσαρμογή και αιτιολογία' using errcode='22023'; end if;
  if not exists(select 1 from public.store_memberships where store_id=p_store and user_id=p_user and active)
    or (p_user<>auth.uid() and not public.is_master() and not public.can_manage_store_member(p_store,p_user)) then
    raise exception 'Δεν έχετε δικαίωμα διόρθωσης πόντων αυτού του εργαζομένου' using errcode='42501'; end if;
  insert into public.point_category_adjustments(store_id,user_id,category_key,date,points_delta,reason,created_by)
    values(p_store,p_user,p_category,p_date,p_delta,trim(p_reason),auth.uid()) returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.read_point_category_scores(p_store uuid,p_month text,p_user uuid default null)
returns table(user_id uuid,category_key text,sales_points numeric,adjustments numeric,total_points numeric)
language plpgsql stable security definer set search_path=public as $$
declare v_start date; v_end date;
begin
  if not public.can_access_store(p_store) or p_month !~ '^[0-9]{4}-(0[1-9]|1[0-2])$'
    or (p_user is not null and not public.can_manage_store(p_store) and p_user<>auth.uid()) then
    raise exception 'Δεν έχετε πρόσβαση στα στοιχεία πόντων' using errcode='42501'; end if;
  v_start:=(p_month||'-01')::date; v_end:=(v_start+interval '1 month')::date;
  return query with scored_sales as (
    select s.user_id,r.point_category_key as category_key,sum(s.quantity*r.points_per_unit)::numeric as points
    from public.sales_entries s join lateral (
      select rule.point_category_key,rule.points_per_unit from public.store_point_rules rule
      where rule.store_id=s.store_id and rule.service_category_id=s.category_id and rule.valid_from<=s.date
        and rule.point_category_key is not null order by rule.valid_from desc limit 1
    ) r on true
    where s.store_id=p_store and s.status='active' and s.date>=v_start and s.date<v_end
      and (p_user is null or s.user_id=p_user)
    group by s.user_id,r.point_category_key
  ), corrected as (
    select a.user_id,a.category_key,sum(a.points_delta)::numeric as points
    from public.point_category_adjustments a where a.store_id=p_store and a.date>=v_start and a.date<v_end
      and (p_user is null or a.user_id=p_user) group by a.user_id,a.category_key
  ), users as (
    select scored_sales.user_id from scored_sales union select corrected.user_id from corrected
  )
  select u.user_id,c.category_key,coalesce(s.points,0),coalesce(a.points,0),coalesce(s.points,0)+coalesce(a.points,0)
  from users u cross join public.point_categories c
  left join scored_sales s on s.user_id=u.user_id and s.category_key=c.category_key
  left join corrected a on a.user_id=u.user_id and a.category_key=c.category_key
  where public.can_manage_store(p_store) or u.user_id=auth.uid()
  order by u.user_id,c.sort_order;
end;
$$;

revoke all on function public.save_store_point_rule(uuid,uuid,text,numeric,date),
  public.save_point_category_target(uuid,uuid,text,text,numeric),
  public.adjust_point_category(uuid,uuid,text,date,numeric,text),
  public.read_point_category_scores(uuid,text,uuid) from public,anon;
grant execute on function public.save_store_point_rule(uuid,uuid,text,numeric,date),
  public.save_point_category_target(uuid,uuid,text,text,numeric),
  public.adjust_point_category(uuid,uuid,text,date,numeric,text),
  public.read_point_category_scores(uuid,text,uuid) to authenticated;

commit;

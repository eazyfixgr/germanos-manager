-- ============================================================
-- Phase 0 security stabilization
-- Apply on the existing demo database.
-- These changes are additive/backward compatible.
-- ============================================================

-- 1) current_store must ignore inactive/deleted profiles
create or replace function public.current_store()
returns uuid language sql stable security definer set search_path = public as $$
  select store_id from profiles
  where id = auth.uid() and active = true and deleted_at is null;
$$;

-- 2) Role helpers ignore deleted profiles
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

-- 3) Delete policies must be scoped to the caller's store
drop policy if exists orders_delete_admin on public.orders;
create policy orders_delete_admin on public.orders
  for delete using (public.is_master() or (public.is_admin() and store_id = public.current_store()));

drop policy if exists leave_delete_admin on public.leave_requests;
create policy leave_delete_admin on public.leave_requests
  for delete using (public.is_master() or (public.is_admin() and store_id = public.current_store()));

-- 4) Aggregate RPCs must reject NULL current_store reliably
create or replace function public.store_category_sales(p_store uuid, p_month text)
returns table(category_id uuid, quantity numeric)
language plpgsql stable security definer set search_path = public as $$
begin
  if p_store is null then
    raise exception 'Μη έγκυρο κατάστημα';
  end if;
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

create or replace function public.store_daily_sales(p_store uuid, p_month text)
returns table(sales_date date, quantity numeric)
language plpgsql stable security definer set search_path = public as $$
begin
  if p_store is null then
    raise exception 'Μη έγκυρο κατάστημα';
  end if;
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

-- 5) Atomic month schedule replacement
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
  if p_store is null then
    raise exception 'Μη έγκυρο κατάστημα';
  end if;
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

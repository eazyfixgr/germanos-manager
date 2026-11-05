import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

export const ids = {
  orgA: '10000000-0000-4000-8000-000000000001',
  orgB: '10000000-0000-4000-8000-000000000002',
  storeA: '20000000-0000-4000-8000-000000000001',
  storeB: '20000000-0000-4000-8000-000000000002',
  ownerA: '30000000-0000-4000-8000-000000000001',
  ownerB: '30000000-0000-4000-8000-000000000002',
  employee: '30000000-0000-4000-8000-000000000003',
  orgAdmin: '30000000-0000-4000-8000-000000000004',
  master: '30000000-0000-4000-8000-000000000005',
}

function sqlFile(path: string) {
  return readFileSync(resolve(path), 'utf8')
}

export async function createDatabase(extraMigrations: string[] = []) {
  const db = new PGlite()
  await db.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
    $$;
    create table auth.users (
      id uuid primary key, email text, raw_user_meta_data jsonb default '{}'
    );
  `)
  // Use the actual SQL, excluding only platform-managed pgcrypto and Realtime DDL.
  // gen_random_uuid() is built into the embedded PostgreSQL engine.
  const baseline = sqlFile('supabase/schema.sql')
    .replace('create extension if not exists pgcrypto;', '')
    .replace(/do \$\$[\s\S]*?end \$\$;/g, (block) =>
      block.includes('supabase_realtime') ? '' : block)
  await db.exec(baseline)
  for (const path of [
    'supabase/migrations/20261104_phase0_security_fixes.sql',
    'supabase/migrations/20261104_phase1_organizations.sql',
  ]) await db.exec(sqlFile(path))

  await db.exec(`
    grant usage on schema public, auth to authenticated, anon;
    grant select, insert, update, delete on all tables in schema public to authenticated;
  `)
  await db.exec(`
    insert into organizations(id, name) values
      ('${ids.orgA}', 'Synthetic A'), ('${ids.orgB}', 'Synthetic B');
    insert into stores(id, name, code, organization_id) values
      ('${ids.storeA}', 'Synthetic A', 'TEST-A', '${ids.orgA}'),
      ('${ids.storeB}', 'Synthetic B', 'TEST-B', '${ids.orgB}');
  `)
  const users = [
    [ids.ownerA, 'Owner A', 'TEST-A', 'admin'],
    [ids.ownerB, 'Owner B', 'TEST-B', 'admin'],
    [ids.employee, 'Employee', 'TEST-A', 'user'],
    [ids.orgAdmin, 'Org admin', 'TEST-A', 'user'],
    [ids.master, 'Master', 'TEST-A', 'master'],
  ]
  for (const [id, name, code, role] of users) {
    if (role === 'master') await db.query(
      'insert into master_allowlist(email) values ($1)', [`${id}@example.invalid`])
    await db.query(`insert into auth.users(id, email, raw_user_meta_data)
      values ($1, $2, $3)`, [id, `${id}@example.invalid`, JSON.stringify({
      full_name: name, account_type: 'user', store_code: code,
    })])
    await db.query(`update profiles set role = $2, active = true,
      is_primary = ($2 = 'admin') where id = $1`, [id, role])
  }
  await db.exec(`
    update profiles set store_id = null, active_store_id = null where id = '${ids.master}';
    delete from store_memberships where user_id = '${ids.master}';
    insert into organization_memberships(organization_id, user_id, role) values
      ('${ids.orgA}', '${ids.ownerA}', 'owner'),
      ('${ids.orgB}', '${ids.ownerB}', 'owner'),
      ('${ids.orgA}', '${ids.orgAdmin}', 'admin');
    insert into store_memberships(store_id, user_id, role, active)
      values ('${ids.storeB}', '${ids.ownerA}', 'user', true);
  `)
  // Exercise upgrades against existing accounts/memberships, not only empty DDL.
  for (const path of extraMigrations) await db.exec(sqlFile(path))
  return db
}

export async function asUser<T>(db: PGlite, userId: string, action: () => Promise<T>): Promise<T> {
  await db.exec('begin')
  try {
    await db.query("select set_config('request.jwt.claim.sub', $1, true)", [userId])
    await db.exec('set local role authenticated')
    return await action()
  } finally { await db.exec('rollback') }
}

export function loadSql(path: string) { return sqlFile(path) }

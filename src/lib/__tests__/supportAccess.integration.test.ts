import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { asUser, createDatabase, ids, loadSql } from './databaseFixture'

let db: PGlite
beforeAll(async () => {
  db = await createDatabase([
    'supabase/migrations/20261105_membership_authorization.sql',
    'supabase/migrations/20261105_organization_membership_management.sql',
    'supabase/migrations/20261105_support_access.sql',
  ])
  await db.query(`insert into orders(store_id, product_code, product_name, customer_name)
    values ($1, 'TEST-A', 'Synthetic A', 'Customer A'), ($2, 'TEST-B', 'Synthetic B', 'Customer B')`, [ids.storeA, ids.storeB])
  await db.query("insert into order_events(order_id, status) select id, 'new' from orders")
  await db.exec(loadSql('supabase/migrations/20261105_support_access_guards.sql'))
}, 60000)
afterAll(async () => { await db?.close() })

async function denied(sql: string, params: unknown[] = []) {
  await db.exec('savepoint rejected_support_operation')
  await expect(db.query(sql, params)).rejects.toThrow()
  await db.exec('rollback to savepoint rejected_support_operation; release savepoint rejected_support_operation')
}
async function start(store = ids.storeA) {
  return (await db.query<{ id: string }>('select start_support_access($1, $2, 30) as id',
    [store, 'Έλεγχος προβλήματος καταστήματος'])).rows[0].id
}

describe('Master support access — actual PostgreSQL guards and RLS', () => {
  it('backfills tenant scope on existing order events without losing their parent links', async () => {
    const rows = await db.query<{ store_id: string; matches: boolean }>(`select e.store_id, e.store_id = o.store_id as matches
      from order_events e join orders o on o.id = e.order_id order by e.store_id`)
    expect(rows.rows).toEqual([{ store_id: ids.storeA, matches: true }, { store_id: ids.storeB, matches: true }])
  })

  it('exposes only directory metadata and no operational data without a session', async () => {
    await asUser(db, ids.master, async () => {
      const directory = await db.query<Record<string, unknown>>('select * from list_support_stores()')
      expect(directory.rows).toHaveLength(2)
      expect(Object.keys(directory.rows[0]).sort()).toEqual(['code', 'id', 'name', 'organization_id'])
      expect((await db.query('select * from stores')).rows).toHaveLength(0)
      expect((await db.query('select * from orders')).rows).toHaveLength(0)
      expect((await db.query('select * from order_events')).rows).toHaveLength(0)
      expect((await db.query('select * from profiles')).rows).toEqual([expect.objectContaining({ id: ids.master })])
      expect((await db.query('select is_admin() as admin, current_store() as store')).rows[0]).toEqual({ admin: false, store: null })
      await denied('select * from store_category_sales($1, $2)', [ids.storeA, '2026-11'])
      await denied('select * from store_daily_sales($1, $2)', [ids.storeA, '2026-11'])
      await denied('select set_active_store($1)', [ids.storeA])
    })
  })

  it('rejects non-master users and invalid reasons/durations without creating sessions', async () => {
    for (const user of [ids.employee, ids.ownerA, ids.orgAdmin]) {
      await asUser(db, user, async () => {
        await denied('select start_support_access($1, $2)', [ids.storeA, 'Unauthorized support request'])
        await denied('select * from list_support_stores()')
      })
    }
    await asUser(db, ids.master, async () => {
      for (const [reason, minutes] of [[null, 30], ['short', 30], ['Valid reason here', 0], ['Valid reason here', 61]]) {
        await denied('select start_support_access($1, $2, $3)', [ids.storeA, reason, minutes])
      }
      expect((await db.query('select * from support_access_sessions')).rows).toHaveLength(0)
    })
  })

  it('does not let a master end another master account’s session', async () => {
    const master2 = '30000000-0000-4000-8000-000000000088'
    const email = 'second-master@example.invalid'
    await db.query('insert into master_allowlist(email) values ($1)', [email])
    await db.query('insert into auth.users(id, email, raw_user_meta_data) values ($1, $2, $3)',
      [master2, email, JSON.stringify({ account_type: 'user', store_code: 'TEST-A', full_name: 'Synthetic master 2' })])
    await db.query("update profiles set role = 'master', active = true, store_id = null, active_store_id = null where id = $1", [master2])
    const id = (await db.query<{ id: string }>(`insert into support_access_sessions
      (master_id, store_id, organization_id, reason, expires_at) values ($1, $2, $3, 'Other account session',
      statement_timestamp() + interval '30 minutes') returning id`, [master2, ids.storeA, ids.orgA])).rows[0].id
    try {
      await asUser(db, ids.master, async () => {
        await denied('select end_support_access($1)', [id])
        expect((await db.query('select * from support_access_sessions')).rows).toHaveLength(0)
        expect((await db.query('select * from orders')).rows).toHaveLength(0)
      })
    } finally {
      await db.query('delete from support_access_sessions where id = $1', [id])
      await db.query('delete from auth.users where id = $1', [master2])
      await db.query('delete from master_allowlist where email = $1', [email])
    }
  })

  it('revokes support when the master account is deactivated', async () => {
    const id = (await db.query<{ id: string }>(`insert into support_access_sessions
      (master_id, store_id, organization_id, reason, expires_at) values ($1, $2, $3, 'Deactivation fixture',
      statement_timestamp() + interval '30 minutes') returning id`, [ids.master, ids.storeA, ids.orgA])).rows[0].id
    try {
      await db.query('update profiles set active = false where id = $1', [ids.master])
      await asUser(db, ids.master, async () => {
        expect((await db.query('select * from orders')).rows).toHaveLength(0)
        expect((await db.query('select * from current_support_session()')).rows).toHaveLength(0)
        await denied('select start_support_access($1, $2)', [ids.storeA, 'Inactive master request'])
        await denied('select * from store_daily_sales($1, $2)', [ids.storeA, '2026-11'])
      })
    } finally {
      await db.query('update profiles set active = true where id = $1', [ids.master])
      await db.query('delete from support_access_sessions where id = $1', [id])
    }
  })

  it('limits table reads, capabilities, and aggregate RPCs to the selected support store', async () => {
    await asUser(db, ids.master, async () => {
      await start()
      expect((await db.query<{ id: string }>('select id from stores')).rows).toEqual([{ id: ids.storeA }])
      expect((await db.query('select product_name from orders')).rows).toEqual([{ product_name: 'Synthetic A' }])
      expect((await db.query('select is_admin() as admin, current_store() as store')).rows[0])
        .toEqual({ admin: true, store: ids.storeA })
      expect((await db.query<{ can_manage: boolean }>('select * from store_capabilities($1)', [ids.storeA])).rows[0].can_manage).toBe(true)
      await db.query('select * from store_category_sales($1, $2)', [ids.storeA, '2026-11'])
      await denied('select * from store_daily_sales($1, $2)', [ids.storeB, '2026-11'])
      await denied('select * from store_capabilities($1)', [ids.storeB])
      await denied('select set_active_store($1)', [ids.storeB])
    })
  })

  it('records before/after data changes against the authenticated actor and support reason', async () => {
    await asUser(db, ids.master, async () => {
      const sessionId = await start()
      await db.query("update orders set product_name = 'Updated A' where store_id = $1", [ids.storeA])
      const audit = await db.query<{ session_id: string; actor_id: string; reason: string; before_data: { product_name: string }; after_data: { product_name: string } }>(
        "select * from support_audit_events where action = 'data.update' and table_name = 'orders'")
      expect(audit.rows).toHaveLength(1)
      expect(audit.rows[0]).toMatchObject({ session_id: sessionId, actor_id: ids.master,
        reason: 'Έλεγχος προβλήματος καταστήματος', before_data: { product_name: 'Synthetic A' }, after_data: { product_name: 'Updated A' } })
      await denied('insert into support_audit_events(actor_id, action, reason) values ($1, $2, $3)', [ids.master, 'forged', 'forged'])
      await denied("update support_audit_events set reason = 'forged'")
      await denied('delete from support_audit_events')
      await denied("update support_access_sessions set expires_at = expires_at + interval '1 hour'")
    })
  })

  it('audits order deletion and its event cascade without losing the tenant scope', async () => {
    await asUser(db, ids.master, async () => {
      await start()
      await db.query(`insert into order_events(order_id, status)
        select id, 'new' from orders where store_id = $1`, [ids.storeA])
      await db.query('delete from orders where store_id = $1', [ids.storeA])
      const events = await db.query<{ table_name: string; store_id: string }>(
        "select table_name, store_id from support_audit_events where action = 'data.delete' order by table_name")
      expect(events.rows).toEqual([
        { table_name: 'order_events', store_id: ids.storeA }, { table_name: 'order_events', store_id: ids.storeA },
        { table_name: 'orders', store_id: ids.storeA },
      ])
    })
  })

  it('ends access immediately and idempotently, including calls through definer lifecycle RPCs', async () => {
    await asUser(db, ids.master, async () => {
      const sessionId = await start()
      await db.query('select end_support_access($1)', [sessionId])
      await db.query('select end_support_access($1)', [sessionId])
      expect((await db.query('select * from orders')).rows).toHaveLength(0)
      expect((await db.query('select * from current_support_session()')).rows).toHaveLength(0)
      expect((await db.query("select * from support_audit_events where action = 'session.ended'")).rows).toHaveLength(1)
      await denied('select delete_user($1)', [ids.employee])
      await denied('select purge_user($1)', [ids.employee])
      await denied('select set_primary($1, false)', [ids.ownerB])
      await denied('select replace_month_shifts($1, $2, $3, $4)', [ids.storeA, '2026-11', '[]', '[]'])
    })
  })

  it('replaces the old session rather than allowing simultaneous store access', async () => {
    await asUser(db, ids.master, async () => {
      const first = await start()
      const second = await start(ids.storeB)
      expect(first).not.toBe(second)
      expect((await db.query('select id from current_support_session()')).rows).toEqual([{ id: second }])
      expect((await db.query('select product_name from orders')).rows).toEqual([{ product_name: 'Synthetic B' }])
      expect((await db.query('select end_kind from support_access_sessions where id = $1', [first])).rows).toEqual([{ end_kind: 'replaced' }])
      await denied('select purge_user($1)', [ids.employee])
    })
  })

  it('enforces expiry in the database without waiting for cleanup or a browser timer', async () => {
    const expiredId = (await db.query<{ id: string }>(`insert into support_access_sessions
      (master_id, store_id, organization_id, reason, started_at, expires_at)
      values ($1, $2, $3, 'Expired fixture reason', statement_timestamp() - interval '31 minutes',
        statement_timestamp() - interval '1 minute') returning id`, [ids.master, ids.storeA, ids.orgA])).rows[0].id
    try {
      await asUser(db, ids.master, async () => {
        expect((await db.query('select * from orders')).rows).toHaveLength(0)
        expect((await db.query('select * from current_support_session()')).rows).toHaveLength(0)
        await denied('select * from store_daily_sales($1, $2)', [ids.storeA, '2026-11'])
        await denied('select purge_user($1)', [ids.employee])
        await start(ids.storeB)
        expect((await db.query('select end_kind from support_access_sessions where id = $1', [expiredId])).rows).toEqual([{ end_kind: 'expired' }])
      })
    } finally { await db.query('delete from support_access_sessions where id = $1', [expiredId]) }
  })

  it('expires between statements even inside an already-open transaction', async () => {
    const id = (await db.query<{ id: string }>(`insert into support_access_sessions
      (master_id, store_id, organization_id, reason, expires_at) values ($1, $2, $3, 'Statement expiry fixture',
      statement_timestamp() + interval '1 second') returning id`, [ids.master, ids.storeA, ids.orgA])).rows[0].id
    try {
      await asUser(db, ids.master, async () => {
        expect((await db.query('select * from orders')).rows).toHaveLength(1)
        await new Promise((resolve) => setTimeout(resolve, 1100))
        expect((await db.query('select * from orders')).rows).toHaveLength(0)
        await denied('select * from store_daily_sales($1, $2)', [ids.storeA, '2026-11'])
      })
    } finally { await db.query('delete from support_access_sessions where id = $1', [id]) }
  })

  it('does not let store-scoped support enumerate or change organization-wide personnel', async () => {
    await asUser(db, ids.master, async () => {
      await start()
      await denied('select * from list_organization_people($1)', [ids.orgA])
      await denied('select set_organization_member($1, $2, $3)', [ids.orgA, ids.employee, 'admin'])
      await denied('select * from app_private.list_organization_people($1)', [ids.orgA])
      await denied('select app_private.set_organization_member($1, $2, $3)', [ids.orgA, ids.employee, 'owner'])
      expect((await db.query('select * from organization_memberships')).rows).toHaveLength(0)
      expect((await db.query('select * from organization_audit_events')).rows).toHaveLength(0)
      expect((await db.query("update organizations set name = 'Forbidden' returning id")).rows).toHaveLength(0)
      await denied('update profiles set store_id = null where id = $1', [ids.employee])
    })
  })

  it('ignores legacy master ownership and protects the last tenant owner from platform promotion', async () => {
    await db.query("insert into organization_memberships(organization_id, user_id, role) values ($1, $2, 'owner')", [ids.orgA, ids.master])
    try {
      await asUser(db, ids.master, async () => {
        expect((await db.query('select is_org_manager($1) as manager, can_access_store($2) as access', [ids.orgA, ids.storeA])).rows)
          .toEqual([{ manager: false, access: false }])
        await start()
        expect((await db.query('select org_role from store_capabilities($1)', [ids.storeA])).rows).toEqual([{ org_role: null }])
        await db.query('insert into master_allowlist(email) select email from profiles where id = $1', [ids.ownerA])
        await denied("update profiles set role = 'master', store_id = null where id = $1", [ids.ownerA])
      })
    } finally { await db.query('delete from organization_memberships where organization_id = $1 and user_id = $2', [ids.orgA, ids.master]) }
  })

  it('retains owner visibility of support sessions/audit only within their organization', async () => {
    const id = (await db.query<{ id: string }>(`insert into support_access_sessions
      (master_id, store_id, organization_id, reason, expires_at) values ($1, $2, $3, 'Synthetic support audit',
      statement_timestamp() + interval '30 minutes') returning id`, [ids.master, ids.storeA, ids.orgA])).rows[0].id
    await db.query(`insert into support_audit_events(session_id, actor_id, store_id, organization_id, action, reason)
      values ($1, $2, $3, $4, 'session.started', 'Synthetic support audit')`, [id, ids.master, ids.storeA, ids.orgA])
    try {
      expect((await asUser(db, ids.ownerA, () => db.query('select id from support_access_sessions'))).rows).toEqual([{ id }])
      expect((await asUser(db, ids.ownerB, () => db.query('select id from support_access_sessions'))).rows).toHaveLength(0)
      expect((await asUser(db, ids.employee, () => db.query('select id from support_access_sessions'))).rows).toHaveLength(0)
      expect((await asUser(db, ids.ownerA, () => db.query('select * from support_audit_events'))).rows).toHaveLength(1)
      expect((await asUser(db, ids.ownerB, () => db.query('select * from support_audit_events'))).rows).toHaveLength(0)
      expect((await asUser(db, ids.employee, () => db.query('select * from support_audit_events'))).rows).toHaveLength(0)
    } finally {
      await db.query('delete from support_audit_events where session_id = $1', [id])
      await db.query('delete from support_access_sessions where id = $1', [id])
    }
  })

  it('preserves tenant-owner operations and platform new-store onboarding', async () => {
    await asUser(db, ids.ownerA, async () => {
      await db.query('select set_organization_member($1, $2, $3)', [ids.orgA, ids.employee, 'member'])
      await db.query("update orders set product_name = 'Owner edit' where store_id = $1", [ids.storeA])
    })
    const pending = '30000000-0000-4000-8000-000000000099'
    await db.query('insert into auth.users(id, email, raw_user_meta_data) values ($1, $2, $3)',
      [pending, 'new-store@example.invalid', JSON.stringify({ account_type: 'admin', full_name: 'New owner', store_name: 'New tenant', store_code: 'NEW-TENANT' })])
    try {
      await asUser(db, ids.master, async () => {
        await db.query('select approve_user($1)', [pending])
        expect((await db.query('select * from orders')).rows).toHaveLength(0)
        expect((await db.query('select * from support_access_sessions')).rows).toHaveLength(0)
        expect((await db.query('select * from list_support_stores()')).rows).toHaveLength(3)
      })
    } finally { await db.query('delete from auth.users where id = $1', [pending]) }
  })
})

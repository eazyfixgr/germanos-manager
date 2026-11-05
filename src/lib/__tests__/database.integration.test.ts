import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { asUser, createDatabase, ids, loadSql } from './databaseFixture'

let db: PGlite
let legacy: PGlite
const migrations = [
  'supabase/migrations/20261105_membership_authorization.sql',
  'supabase/migrations/20261105_organization_membership_management.sql',
]

beforeAll(async () => {
  legacy = await createDatabase()
  db = await createDatabase(migrations)
}, 60000)
afterAll(async () => { await legacy?.close(); await db?.close() })

describe('Phase 0/1.1 PostgreSQL baseline', () => {
  it('loads the actual baseline and migrations in an isolated database', async () => {
    const result = await asUser(legacy, ids.employee, () => legacy.query<{ id: string }>('select id from stores'))
    expect(result.rows.map((r) => r.id)).toEqual([ids.storeA])
  })

  it('reproduces the legacy admin privilege leaking into an employee membership', async () => {
    const result = await asUser(legacy, ids.ownerA, async () => {
      await legacy.query('select set_active_store($1)', [ids.storeB])
      return legacy.query<{ admin: boolean }>('select is_admin() as admin')
    })
    expect(result.rows[0].admin).toBe(true) // Confirmed vulnerability in Phase 1.1.
  })

  it('reproduces legacy schedule replacement silently dropping an invalid row', async () => {
    await asUser(legacy, ids.ownerA, async () => {
      await legacy.query('select replace_month_shifts($1, $2, $3, $4)', [ids.storeA, '2026-11',
        JSON.stringify([{ user_id: ids.ownerB, date: '2026-11-02', shift_type: 'full' }]), '[]'])
      const result = await legacy.query<{ count: number }>('select count(*)::int as count from shifts')
      expect(result.rows[0].count).toBe(0) // No error, although the requested row was invalid.
    })
  })
})

async function denied(sql: string, params: unknown[] = [], message?: string) {
  await db.exec('savepoint rejected_operation')
  await expect(db.query(sql, params)).rejects.toThrow(message)
  await db.exec('rollback to savepoint rejected_operation')
  await db.exec('release savepoint rejected_operation')
}

describe('Patched membership authorization (actual PostgreSQL RLS)', () => {
  it('does not grant admin rights in a store where the caller is only an employee', async () => {
    await asUser(db, ids.ownerA, async () => {
      await db.query('select set_active_store($1)', [ids.storeB])
      const result = await db.query<{ admin: boolean; primary: boolean }>(
        'select is_admin() as admin, is_primary_admin() as primary')
      expect(result.rows[0]).toEqual({ admin: false, primary: false })
      await denied('insert into store_category_targets(store_id, category_id, month, target) select $1, id, $2, 10 from service_categories limit 1', [ids.storeB, '2026-11'])
    })
  })

  it('grants org-only managers real store admin capabilities without changing profile role', async () => {
    await asUser(db, ids.orgAdmin, async () => {
      const r = await db.query<{ admin: boolean }>('select is_admin() as admin')
      expect(r.rows[0].admin).toBe(true)
      const caps = await db.query<{ can_manage: boolean; org_role: string }>('select * from store_capabilities($1)', [ids.storeA])
      expect(caps.rows[0].can_manage).toBe(true)
      expect(caps.rows[0].org_role).toBe('admin')
    })
  })

  it('lets an org-only admin create and switch stores without inheriting another tenant', async () => {
    await asUser(db, ids.orgAdmin, async () => {
      const created = await db.query<{ id: string }>(
        'select create_org_store($1, $2, $3) as id', [ids.orgA, 'Additional store', 'TEST-NEW'])
      const storeId = created.rows[0].id
      const current = await db.query<{ role: string; active_store_id: string }>(
        'select role, active_store_id from profiles where id = $1', [ids.orgAdmin])
      expect(current.rows[0]).toEqual({ role: 'user', active_store_id: storeId })
      expect((await db.query<{ id: string }>('select id from stores')).rows.map((s) => s.id))
        .toEqual(expect.arrayContaining([ids.storeA, storeId]))
      await denied('select create_org_store($1, $2, $3)', [ids.orgB, 'Forbidden', 'NO-ACCESS'])
      await denied('select set_active_store($1)', [ids.storeB])
      await db.query('select set_active_store($1)', [ids.storeA])
    })
  })

  it('keeps the platform master outside tenant memberships when creating a store', async () => {
    await asUser(db, ids.master, async () => {
      const created = await db.query<{ id: string }>(
        'select create_org_store($1, $2, $3) as id', [ids.orgA, 'Master-created store', 'MASTER-NEW'])
      expect((await db.query('select store_id, active_store_id from profiles where id = $1', [ids.master])).rows)
        .toEqual([{ store_id: null, active_store_id: created.rows[0].id }])
      expect((await db.query('select * from store_memberships where user_id = $1', [ids.master])).rows).toHaveLength(0)
      expect((await db.query('select * from organization_memberships where user_id = $1', [ids.master])).rows).toHaveLength(0)
    })
  })

  it('denies foreign stores and null aggregates to an employee', async () => {
    await asUser(db, ids.employee, async () => {
      await denied('select set_active_store($1)', [ids.storeB])
      await denied('select * from store_category_sales($1, $2)', [ids.storeB, '2026-11'])
      await denied('select * from store_daily_sales(null, $1)', ['2026-11'])
    })
  })

  it('ignores inactive or deleted organization managers', async () => {
    await db.query('update profiles set active = false where id = $1', [ids.orgAdmin])
    try {
      await asUser(db, ids.orgAdmin, async () => {
        const r = await db.query<{ access: boolean; manager: boolean }>(
          'select can_access_store($1) as access, is_org_manager($2) as manager', [ids.storeA, ids.orgA])
        expect(r.rows[0]).toEqual({ access: false, manager: false })
        await denied('select create_org_store($1, $2, $3)', [ids.orgA, 'Forbidden', 'FORBIDDEN'])
      })
    } finally { await db.query('update profiles set active = true where id = $1', [ids.orgAdmin]) }
  })

  it('does not resurrect a revoked home-store membership after a contact edit', async () => {
    await db.query('update store_memberships set active = false where user_id = $1', [ids.employee])
    try {
      await asUser(db, ids.employee, async () => {
        await db.query("update profiles set full_name = 'Updated contact' where id = $1", [ids.employee])
        const r = await db.query<{ store: string | null }>('select current_store() as store')
        expect(r.rows[0].store).toBeNull()
        expect((await db.query('select * from stores')).rows).toHaveLength(0)
      })
    } finally { await db.query('update store_memberships set active = true where user_id = $1', [ids.employee]) }
  })

  it('blocks self-promotion, seller/lifecycle edits and forged active stores', async () => {
    await asUser(db, ids.employee, async () => {
      await denied("update profiles set role = 'admin' where id = $1", [ids.employee])
      await denied('update profiles set is_seller = false where id = $1', [ids.employee])
      await denied('update profiles set deleted_at = now() where id = $1', [ids.employee])
      await denied('update profiles set active_store_id = $1 where id = $2', [ids.storeB, ids.employee])
    })
  })

  it('prevents reparenting a managed store into another tenant', async () => {
    await asUser(db, ids.ownerA, () => denied(
      'update stores set organization_id = $1 where id = $2', [ids.orgB, ids.storeA]))
  })

  it('does not allow direct membership escalation even for an org admin', async () => {
    await asUser(db, ids.orgAdmin, async () => {
      await denied("update organization_memberships set role = 'owner' where user_id = $1", [ids.orgAdmin])
      await denied("update store_memberships set role = 'admin' where user_id = $1", [ids.employee])
    })
  })

  it.each(['inactive', 'deleted'] as const)('hides own sales from an %s account', async (state) => {
    await db.query(`insert into sales_entries(store_id, user_id, category_id, date, quantity)
      select $1, $2, id, '2026-11-02', 1 from service_categories limit 1`, [ids.storeA, ids.employee])
    try {
      expect((await asUser(db, ids.employee, () => db.query('select * from sales_entries'))).rows).toHaveLength(1)
      await db.query(state === 'inactive' ? 'update profiles set active = false where id = $1'
        : 'update profiles set deleted_at = now() where id = $1', [ids.employee])
      await asUser(db, ids.employee, async () => {
        expect((await db.query('select * from sales_entries')).rows).toHaveLength(0)
        expect((await db.query('select * from profiles where id = $1', [ids.employee])).rows).toHaveLength(1)
        await denied('select set_active_store($1)', [ids.storeA])
        await denied('select * from store_capabilities($1)', [ids.storeA])
      })
    } finally {
      await db.query('update profiles set active = true, deleted_at = null where id = $1', [ids.employee])
      await db.query('delete from sales_entries where user_id = $1', [ids.employee])
    }
  })

  it('revokes access to own sales, seller targets, and assigned tasks with the store membership', async () => {
    await db.query(`insert into sales_entries(store_id, user_id, category_id, date, quantity)
      select $1, $2, id, '2026-11-02', 1 from service_categories limit 1`, [ids.storeA, ids.employee])
    await db.query(`insert into seller_category_targets(store_id, user_id, category_id, month, target)
      select $1, $2, id, '2026-11', 10 from service_categories limit 1`, [ids.storeA, ids.employee])
    await db.query(`insert into store_tasks(store_id, assigned_user_id, title, scheduled_date)
      values ($1, $2, 'Synthetic task', '2026-11-02')`, [ids.storeA, ids.employee])
    await asUser(db, ids.employee, async () => {
      for (const table of ['sales_entries', 'seller_category_targets', 'store_tasks']) {
        expect((await db.query(`select * from ${table}`)).rows).toHaveLength(1)
      }
    })
    await db.query('update store_memberships set active = false where user_id = $1', [ids.employee])
    try {
      await asUser(db, ids.employee, async () => {
        for (const table of ['sales_entries', 'seller_category_targets', 'store_tasks']) {
          expect((await db.query(`select * from ${table}`)).rows).toHaveLength(0)
        }
        expect((await db.query("update store_tasks set status = 'done' returning id")).rows).toHaveLength(0)
      })
    } finally {
      await db.query('update store_memberships set active = true where user_id = $1', [ids.employee])
      await db.query('delete from sales_entries where user_id = $1', [ids.employee])
      await db.query('delete from seller_category_targets where user_id = $1', [ids.employee])
      await db.query('delete from store_tasks where assigned_user_id = $1', [ids.employee])
    }
  })

  it('prevents moving a self-owned leave request into an inaccessible store', async () => {
    await asUser(db, ids.employee, async () => {
      await db.query(`insert into leave_requests(store_id, user_id, start_date, end_date, type)
        values ($1, $2, '2026-11-02', '2026-11-02', 'repo')`, [ids.storeA, ids.employee])
      await denied('update leave_requests set store_id = $1 where user_id = $2', [ids.storeB, ids.employee])
    })
  })
})

describe('Atomic schedule replacement', () => {
  const valid = JSON.stringify([{ user_id: ids.employee, date: '2026-11-02', shift_type: 'short' }])
  it('preserves old shifts AND fairness when ANY payload row is invalid', async () => {
    await asUser(db, ids.ownerA, async () => {
      await db.query('select replace_month_shifts($1, $2, $3, $4)', [ids.storeA, '2026-11', valid,
        JSON.stringify([{ user_id: ids.employee, split_offs: 1, short_offs: 0 }])])
      for (const bad of [
        [{ user_id: ids.ownerB, date: '2026-11-03', shift_type: 'full' }],
        [{ user_id: ids.employee, date: '2026-12-03', shift_type: 'full' }],
        [{ user_id: ids.employee, date: '2026-11-03' }],
        [{ user_id: ids.employee, date: '2026-11-03', shift_type: 'invalid' }],
      ]) await denied('select replace_month_shifts($1, $2, $3, $4)', [ids.storeA, '2026-11', JSON.stringify(bad), '[]'])
      expect((await db.query<{ shift_type: string }>('select shift_type from shifts')).rows).toEqual([{ shift_type: 'short' }])
      expect((await db.query<{ split_offs: number }>('select split_offs from schedule_fairness')).rows).toEqual([{ split_offs: 1 }])
    })
  })

  it('rejects duplicate dates, negative fairness, malformed arrays, and invalid months', async () => {
    await asUser(db, ids.ownerA, async () => {
      const row = { user_id: ids.employee, date: '2026-11-02', shift_type: 'short' }
      await denied('select replace_month_shifts($1, $2, $3, $4)', [ids.storeA, '2026-11', JSON.stringify([row, row]), '[]'])
      await denied('select replace_month_shifts($1, $2, $3, $4)', [ids.storeA, '2026-11', valid, JSON.stringify([{ user_id: ids.employee, split_offs: -1, short_offs: 0 }])])
      await denied('select replace_month_shifts($1, $2, $3, $4)', [ids.storeA, '2026-11', '{}', '[]'])
      await denied('select replace_month_shifts($1, $2, $3, $4)', [ids.storeA, null, '[]', '[]'])
      await denied('select replace_month_shifts($1, $2, $3, $4)', [ids.storeA, '2026-13', '[]', '[]'])
    })
  })

  it('denies an employee and an unrelated store owner', async () => {
    await asUser(db, ids.employee, () => denied('select replace_month_shifts($1, $2, $3, $4)', [ids.storeA, '2026-11', valid, '[]']))
    await asUser(db, ids.ownerB, () => denied('select replace_month_shifts($1, $2, $3, $4)', [ids.storeA, '2026-11', valid, '[]']))
  })

  it('accepts an active store member whose home profile belongs to another store', async () => {
    await asUser(db, ids.ownerB, async () => {
      await db.query('select replace_month_shifts($1, $2, $3, $4)', [ids.storeB, '2026-11',
        JSON.stringify([{ user_id: ids.ownerA, date: '2026-11-02', shift_type: 'full' }]), '[]'])
      expect((await db.query('select user_id from shifts')).rows).toEqual([{ user_id: ids.ownerA }])
    })
  })
})

describe('Organization membership management', () => {
  it('allows an owner to appoint an org-only admin and records before/after roles', async () => {
    await asUser(db, ids.ownerA, async () => {
      await db.query('select set_organization_member($1, $2, $3)', [ids.orgA, ids.employee, 'admin'])
      const people = await db.query<{ user_id: string; organization_role: string }>('select * from list_organization_people($1)', [ids.orgA])
      expect(people.rows.find((p) => p.user_id === ids.employee)?.organization_role).toBe('admin')
      expect(people.rows.find((p) => p.user_id === ids.ownerB)).toBeUndefined()
      const audit = await db.query<{ previous_role: string | null; new_role: string }>('select previous_role, new_role from organization_audit_events')
      expect(audit.rows).toEqual([{ previous_role: null, new_role: 'admin' }])
    })
  })

  it('prevents admins from promoting themselves or changing other org roles', async () => {
    await asUser(db, ids.orgAdmin, () => denied('select set_organization_member($1, $2, $3)', [ids.orgA, ids.orgAdmin, 'owner']))
    await asUser(db, ids.employee, () => denied('select set_organization_member($1, $2, $3)', [ids.orgA, ids.employee, 'admin']))
  })

  it('prevents enrolling an unrelated tenant account', async () => {
    await asUser(db, ids.ownerA, () => denied('select set_organization_member($1, $2, $3)', [ids.orgA, ids.ownerB, 'admin']))
  })

  it('protects the last owner from removal or demotion', async () => {
    await asUser(db, ids.ownerA, async () => {
      await denied('select set_organization_member($1, $2, $3)', [ids.orgA, ids.ownerA, null])
      await denied('select set_organization_member($1, $2, $3)', [ids.orgA, ids.ownerA, 'admin'])
      expect((await db.query('select * from organization_audit_events')).rows).toHaveLength(0)
    })
  })

  it('also protects the last owner from profile deactivation or soft deletion', async () => {
    await asUser(db, ids.master, async () => {
      await denied('update profiles set active = false where id = $1', [ids.ownerA])
      await denied('update profiles set deleted_at = now() where id = $1', [ids.ownerA])
      await denied('select purge_user($1)', [ids.ownerA], 'Ορίστε άλλον ενεργό ιδιοκτήτη')
    })
  })

  it('permits ownership transfer after appointing another active owner', async () => {
    await asUser(db, ids.ownerA, async () => {
      await db.query('select set_organization_member($1, $2, $3)', [ids.orgA, ids.employee, 'owner'])
      await db.query('select set_organization_member($1, $2, $3)', [ids.orgA, ids.ownerA, 'member'])
      expect((await db.query<{ role: string }>('select role from organization_memberships where user_id = $1', [ids.ownerA])).rows[0].role).toBe('member')
    })
  })

  it('keeps the audit log append-only for application accounts', async () => {
    await asUser(db, ids.ownerA, async () => {
      await denied("insert into organization_audit_events(organization_id, action) values ($1, 'forged')", [ids.orgA])
      await denied("update organization_audit_events set action = 'forged'")
      await denied('delete from organization_audit_events')
    })
  })
})

describe('Migration safety', () => {
  it('preserves existing tenant, role, lifecycle, and membership data during upgrade', async () => {
    for (const sql of [
      'select id, role, active, store_id, active_store_id, deleted_at from profiles order by id',
      'select id, organization_id, name, code from stores order by id',
      'select id, name from organizations order by id',
      'select organization_id, user_id, role from organization_memberships order by organization_id, user_id',
      'select store_id, user_id, role, active, is_primary, is_seller, can_edit_points from store_memberships order by store_id, user_id',
    ]) expect((await db.query(sql)).rows).toEqual((await legacy.query(sql)).rows)
  })

  it('can run the whole migration sequence from the real baseline', async () => {
    expect((await db.query<{ count: number }>('select count(*)::int as count from profiles')).rows[0].count).toBe(5)
    expect(loadSql(migrations[0])).toContain('begin;')
  })
})

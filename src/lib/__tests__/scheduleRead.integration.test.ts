import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { asUser, createDatabase, ids } from './databaseFixture'
import type { ScheduleData } from '../schedule/model'

let db: PGlite
beforeAll(async () => {
  db = await createDatabase([
    'supabase/migrations/20261105_membership_authorization.sql',
    'supabase/migrations/20261105_organization_membership_management.sql',
    'supabase/migrations/20261105_support_access.sql',
    'supabase/migrations/20261105_support_access_guards.sql',
    'supabase/migrations/20261105_workforce_read_model.sql',
  ])
  await db.query(`insert into shifts(store_id, user_id, date, shift_type, note) values
    ($1, $2, '2026-11-02', 'full', 'Own shift note'), ($1, $3, '2026-11-02', 'full', 'Private colleague note'),
    ($1, $2, '2026-12-02', 'full', null)`, [ids.storeA, ids.employee, ids.ownerA])
  await db.query(`insert into leave_requests(store_id, user_id, type, start_date, end_date, status, reason) values
    ($1, $2, 'adeia', '2026-10-30', '2026-11-03', 'pending', 'Own request'),
    ($1, $3, 'repo', '2026-11-02', '2026-11-02', 'approved', 'Private approved reason'),
    ($1, $3, 'repo', '2026-11-10', '2026-11-10', 'pending', 'Private pending reason')`, [ids.storeA, ids.employee, ids.ownerA])
}, 60000)
afterAll(async () => { await db?.close() })

async function read(storeId = ids.storeA, scope = 'team'): Promise<ScheduleData> {
  return (await db.query<{ data: ScheduleData }>('select read_schedule($1, $2, $3, $4) as data',
    [storeId, '2026-11-01', '2026-12-01', scope])).rows[0].data
}
async function denied(sql: string, params: unknown[]) {
  await db.exec('savepoint denied_read')
  await expect(db.query(sql, params)).rejects.toThrow()
  await db.exec('rollback to savepoint denied_read; release savepoint denied_read')
}

describe('Workforce W1 scoped read model', () => {
  it('uses active memberships, including staff whose home profile is in another store', async () => {
    await asUser(db, ids.ownerB, async () => {
      const result = await read(ids.storeB)
      expect(result.staff.map((person) => person.id)).toEqual(expect.arrayContaining([ids.ownerA, ids.ownerB]))
      expect(Object.keys(result.staff[0]).sort()).toEqual(['active', 'full_name', 'id'])
      expect(result.can_manage).toBe(true)
    })
  })
  it('bounds shifts and includes overlapping requests that started before the visible window', async () => {
    await asUser(db, ids.employee, async () => {
      const result = await read(ids.storeA, 'own')
      expect(result.staff.map((person) => person.id)).toEqual([ids.employee])
      expect(result.shifts).toHaveLength(1)
      expect(result.leaves).toHaveLength(1)
      expect(result.leaves[0].start_date).toBe('2026-10-30')
      expect(result.leaves[0].reason).toBe('Own request')
    })
  })
  it('redacts colleagues’ reasons/notes and hides their unapproved requests from an employee', async () => {
    await asUser(db, ids.employee, async () => {
      const result = await read()
      expect(result.shifts.find((shift) => shift.user_id === ids.ownerA)?.note).toBeNull()
      expect(result.shifts.find((shift) => shift.user_id === ids.employee)?.note).toBe('Own shift note')
      const other = result.leaves.filter((leave) => leave.user_id === ids.ownerA)
      expect(other).toHaveLength(1)
      expect(other[0]).toMatchObject({ status: 'approved', reason: null, reviewed_by: null })
      expect((await db.query('select * from leave_requests where user_id = $1', [ids.ownerA])).rows).toHaveLength(0)
    })
  })
  it('keeps manager request review data available only within the accessible store', async () => {
    await asUser(db, ids.orgAdmin, async () => {
      const result = await read()
      expect(result.can_manage).toBe(true)
      expect(result.leaves).toHaveLength(3)
      expect(result.leaves.find((leave) => leave.reason === 'Private pending reason')).toBeDefined()
      await denied('select read_schedule($1, $2, $3)', [ids.storeB, '2026-11-01', '2026-12-01'])
    })
  })
  it('rejects null/oversize/reversed windows, invalid scope, and foreign stores', async () => {
    await asUser(db, ids.employee, async () => {
      for (const [store, start, end, scope] of [
        [ids.storeB, '2026-11-01', '2026-12-01', 'team'],
        [ids.storeA, null, '2026-12-01', 'team'],
        [ids.storeA, '2026-11-01', '2027-03-01', 'team'],
        [ids.storeA, '2026-12-01', '2026-11-01', 'team'],
        [ids.storeA, '2026-11-01', '2026-12-01', 'forged'],
      ]) await denied('select read_schedule($1, $2, $3, $4)', [store, start, end, scope])
    })
  })
  it('requires live support even for master and revokes reads on session end', async () => {
    await asUser(db, ids.master, async () => {
      await denied('select read_schedule($1, $2, $3)', [ids.storeA, '2026-11-01', '2026-12-01'])
      const session = (await db.query<{ id: string }>('select start_support_access($1, $2) as id', [ids.storeA, 'Read model verification'])).rows[0].id
      expect((await read()).staff).toHaveLength(3)
      await db.query('select end_support_access($1)', [session])
      await denied('select read_schedule($1, $2, $3)', [ids.storeA, '2026-11-01', '2026-12-01'])
    })
  })
  it.each(['inactive', 'revoked'] as const)('denies the new read RPC after the actor becomes %s', async (state) => {
    await db.query(state === 'inactive' ? 'update profiles set active = false where id = $1'
      : 'update store_memberships set active = false where user_id = $1', [ids.employee])
    try {
      await asUser(db, ids.employee, () => denied('select read_schedule($1, $2, $3)', [ids.storeA, '2026-11-01', '2026-12-01']))
    } finally {
      await db.query('update profiles set active = true where id = $1', [ids.employee])
      await db.query('update store_memberships set active = true where user_id = $1', [ids.employee])
    }
  })
})

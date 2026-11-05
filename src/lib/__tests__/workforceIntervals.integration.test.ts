import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { asUser, createDatabase, ids, loadSql } from './databaseFixture'

let db: PGlite
const future = '2099-11-02'
const split = [{ start: '09:00', end: '13:00' }, { start: '17:00', end: '21:00' }]
beforeAll(async () => {
  db = await createDatabase([
    'supabase/migrations/20261105_membership_authorization.sql',
    'supabase/migrations/20261105_organization_membership_management.sql',
    'supabase/migrations/20261105_support_access.sql',
    'supabase/migrations/20261105_support_access_guards.sql',
    'supabase/migrations/20261105_workforce_read_model.sql',
  ])
  await db.query(`insert into shifts(store_id,user_id,date,shift_type,start_time,end_time,note) values
    ($1,$2,'2026-11-02','full','09:00','15:00','Historical full'),
    ($1,$2,'2026-11-03','split','09:00','21:00','Historical split')`, [ids.storeA, ids.employee])
  for (const file of ['01_intervals', '02_configuration', '03_assignments']) await db.exec(loadSql(`supabase/migrations/20261105_workforce_w2_${file}.sql`))
}, 60000)
afterAll(async () => { await db?.close() })
async function denied(sql: string, values: unknown[] = []) {
  await db.exec('savepoint invalid_w2')
  await expect(db.query(sql, values)).rejects.toThrow()
  await db.exec('rollback to savepoint invalid_w2; release savepoint invalid_w2')
}
async function template(patch: Record<string, unknown> = {}, store = ids.storeA) {
  const row = { code: 'split_test', name: 'Σπαστό', short_label: 'Σ', color: '#6655cc', legacy_type: 'split',
    segments: split, valid_from: '2099-11-01', valid_to: null, ...patch }
  return (await db.query<{ id: string }>('select save_shift_template($1,$2) as id', [store, JSON.stringify(row)])).rows[0].id
}
async function assignment(patch: Record<string, unknown> = {}) {
  return (await db.query<{ id: string }>('select save_shift_assignment($1,$2) as id', [ids.storeA,
    JSON.stringify({ user_id: ids.employee, date: future, shift_type: 'split', segments: split, ...patch })])).rows[0].id
}
describe('W2 PostgreSQL intervals/configuration/assignments', () => {
  it('backfills only unambiguous single intervals and preserves unresolved historical split spans', async () => {
    const result = await db.query<{ shift_type: string; segments: unknown; note: string }>('select shift_type,segments,note from shifts order by date')
    expect(result.rows).toEqual([
      { shift_type: 'full', segments: [{ start: '09:00', end: '15:00' }], note: 'Historical full' },
      { shift_type: 'split', segments: null, note: 'Historical split' },
    ])
  })
  it('stores real split snapshots and detects stale assignment revisions', async () => {
    await asUser(db, ids.ownerA, async () => {
      const id = await template()
      const shiftId = await assignment({ template_id: id, segments: null })
      expect((await db.query('select segments,start_time,end_time from shifts where id=$1', [shiftId])).rows[0])
        .toEqual({ segments: split, start_time: '09:00', end_time: '21:00' })
      await assignment({ id: shiftId, revision: 1, template_id: id, note: 'New note' })
      await denied('select save_shift_assignment($1,$2)', [ids.storeA, JSON.stringify({ id: shiftId, revision: 1, user_id: ids.employee, date: future, template_id: id })])
      const data = (await db.query<{ data: { workforce_schema: number; shifts: { template_name: string }[] } }>('select read_schedule($1,$2,$3) as data', [ids.storeA, '2099-11-01', '2099-12-01'])).rows[0].data
      expect(data.workforce_schema).toBe(2)
      expect(data.shifts[0].template_name).toBe('Σπαστό')
    })
  })
  it('rejects overlap, invalid clock values, and direct employee mutations', async () => {
    await asUser(db, ids.ownerA, async () => {
      for (const segments of [[{ start: '09:00', end: '14:00' }, { start: '13:00', end: '21:00' }], [{ start: '25:00', end: '26:00' }], []]) {
        await denied('select save_shift_template($1,$2)', [ids.storeA, JSON.stringify({ code: 'bad', name: 'Bad', short_label: 'B', color: '#555555', legacy_type: 'split', valid_from: future, segments })])
      }
      await denied("insert into shifts(store_id,user_id,date,shift_type,start_time,end_time) values($1,$2,$3,'full','09:00','15:00')", [ids.storeA, ids.ownerB, future])
    })
    await asUser(db, ids.employee, async () => {
      await denied('select save_shift_assignment($1,$2)', [ids.storeA, JSON.stringify({ user_id: ids.employee, date: future, shift_type: 'full', segments: [{ start: '09:00', end: '15:00' }] })])
      await denied("insert into shift_templates(store_id,code,name,short_label,color,legacy_type,segments,valid_from) values ($1,'x','X','X','#555555','full','[]',$2)", [ids.storeA, future])
    })
  })
  it('versions used templates without rewriting historical assignments', async () => {
    await asUser(db, ids.ownerA, async () => {
      const oldId = await template()
      const shiftId = await assignment({ template_id: oldId })
      const next = [{ start: '10:00', end: '14:00' }, { start: '17:00', end: '21:00' }]
      const nextId = await template({ id: oldId, revision: 1, valid_from: '2099-11-08', name: 'Νέο σπαστό', segments: next })
      expect(nextId).not.toBe(oldId)
      expect((await db.query('select valid_to::text from shift_templates where id=$1', [oldId])).rows[0]).toEqual({ valid_to: '2099-11-07' })
      expect((await db.query('select segments from shifts where id=$1', [shiftId])).rows[0]).toEqual({ segments: split })
      await denied('select save_shift_assignment($1,$2)', [ids.storeA, JSON.stringify({ user_id: ids.employee, date: '2099-11-09', template_id: oldId })])
    })
  })
  it('rejects a version change that would invalidate already assigned future dates', async () => {
    await asUser(db, ids.ownerA, async () => {
      const id = await template()
      await assignment({ template_id: id, date: '2099-11-20' })
      await denied('select save_shift_template($1,$2)', [ids.storeA, JSON.stringify({ id, revision: 1, valid_from: '2099-11-08', segments: split })])
      expect((await db.query('select valid_to from shift_templates where id=$1', [id])).rows[0]).toEqual({ valid_to: null })
    })
  })
  it('keeps archived template history while rejecting new assignments to it', async () => {
    await asUser(db, ids.ownerA, async () => {
      const id = await template(); await assignment({ template_id: id })
      await db.query('select archive_shift_template($1,$2,1)', [ids.storeA, id])
      await denied('select save_shift_assignment($1,$2)', [ids.storeA, JSON.stringify({ user_id: ids.employee, date: '2099-11-03', template_id: id })])
      expect((await db.query('select * from shifts where template_id=$1', [id])).rows).toHaveLength(1)
    })
  })
  it('validates requirements, temporal overlap and revisions', async () => {
    await asUser(db, ids.ownerA, async () => {
      const payload = { weekday: 1, start_time: '09:00', end_time: '21:00', minimum: 2, valid_from: '2099-11-01' }
      const id = (await db.query<{ id: string }>('select save_staffing_requirement($1,$2) as id', [ids.storeA, JSON.stringify(payload)])).rows[0].id
      await denied('select save_staffing_requirement($1,$2)', [ids.storeA, JSON.stringify(payload)])
      await denied('select save_staffing_requirement($1,$2)', [ids.storeA, JSON.stringify({ ...payload, id, revision: 9 })])
      await db.query('select end_staffing_requirement($1,$2,1,$3)', [ids.storeA, id, '2099-11-07'])
      await db.query('select save_staffing_requirement($1,$2)', [ids.storeA, JSON.stringify({ ...payload, valid_from: '2099-11-08' })])
    })
  })
  it('enforces approved absences and stops legacy generation from erasing interval assignments', async () => {
    await db.query("insert into leave_requests(store_id,user_id,type,start_date,end_date,status) values($1,$2,'adeia',$3,$3,'approved')", [ids.storeA, ids.employee, future])
    try { await asUser(db, ids.ownerA, async () => {
      await denied('select save_shift_assignment($1,$2)', [ids.storeA, JSON.stringify({ user_id: ids.employee, date: future, shift_type: 'split', segments: split })])
      await template()
      await denied('select replace_month_shifts($1,$2,$3,$4)', [ids.storeA, '2026-11', '[]', '[]'])
      expect((await db.query('select * from shifts')).rows).toHaveLength(2)
    }) } finally { await db.query('delete from leave_requests where start_date=$1', [future]) }
  })
  it('requires live master support and denies foreign stores', async () => {
    await asUser(db, ids.ownerB, () => denied('select save_shift_template($1,$2)', [ids.storeA, '{}']))
    await asUser(db, ids.master, async () => {
      await denied('select save_shift_template($1,$2)', [ids.storeA, '{}'])
      const id = (await db.query<{ id: string }>('select start_support_access($1,$2) as id', [ids.storeA, 'Interval configuration test'])).rows[0].id
      await template()
      await db.query('select end_support_access($1)', [id])
      await denied('select save_staffing_requirement($1,$2)', [ids.storeA, '{}'])
    })
  })
  it('enforces opening hours and rejects an envelope-only change to resolved segments', async () => {
    await asUser(db, ids.ownerA, async () => {
      await db.query('insert into store_calendar(store_id,date,is_working,open_time,close_time) values($1,$2,true,$3,$4)', [ids.storeA, future, '09:00', '15:00'])
      await denied('select save_shift_assignment($1,$2)', [ids.storeA, JSON.stringify({ user_id: ids.employee, date: future, shift_type: 'split', segments: split })])
      const id = await assignment({ shift_type: 'full', segments: [{ start: '09:00', end: '15:00' }] })
      await denied("update shifts set start_time='10:00' where id=$1", [id])
      await denied('select replace_month_shifts($1,$2,$3,$4)', [ids.storeA, '2099-11', '[]', '[]'])
      expect((await db.query('select * from shifts where id=$1', [id])).rows).toHaveLength(1)
    })
  })
})

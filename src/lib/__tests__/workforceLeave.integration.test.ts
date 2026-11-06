import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { asUser, createDatabase, ids, loadSql } from './databaseFixture'

let db: PGlite
const start = '2099-11-02'
const end = '2099-11-05'
const validSegments = JSON.stringify([{ start: '09:00', end: '15:00' }])
beforeAll(async () => {
  db = await createDatabase([
    'supabase/migrations/20261105_membership_authorization.sql',
    'supabase/migrations/20261105_organization_membership_management.sql',
    'supabase/migrations/20261105_support_access.sql',
    'supabase/migrations/20261105_support_access_guards.sql',
    'supabase/migrations/20261105_workforce_read_model.sql',
    'supabase/migrations/20261105_workforce_w2_01_intervals.sql',
    'supabase/migrations/20261105_workforce_w2_02_configuration.sql',
    'supabase/migrations/20261105_workforce_w2_03_assignments.sql',
  ])
  await db.exec(loadSql('supabase/migrations/20261105_workforce_w3_leave_transactions.sql'))
  // The demo database already has this column; W4 must tolerate it and fill/validate it.
  await db.exec('alter table public.stores add column store_type text')
  await db.exec(loadSql('supabase/migrations/20261105_store_hierarchy_transfers.sql'))
  // The dashboard SQL runner may preserve earlier DDL after a failed script.
  await db.exec(loadSql('supabase/migrations/20261105_store_hierarchy_transfers.sql'))
  await db.exec(loadSql('supabase/migrations/20261105_store_point_categories.sql'))
}, 60000)
afterAll(async () => { await db?.close() })
beforeEach(async () => {
  await db.query('delete from store_transfer_requests')
  await db.query("update stores set acting_director_id=null where id=$1", [ids.storeA])
  await db.query("update store_memberships set active=true,position='employee',role='user',is_primary=false where store_id=$1 and user_id=$2", [ids.storeA,ids.employee])
  await db.query("update store_memberships set active=false where store_id=$1 and user_id=$2", [ids.storeB,ids.employee])
  await db.query("update profiles set store_id=$2,active_store_id=$2,store_position='employee',role='user',is_primary=false where id=$1", [ids.employee,ids.storeA])
  await db.query("update store_memberships set active=true,position='director',role='admin',is_primary=true where store_id=$1 and user_id=$2", [ids.storeA,ids.orgAdmin])
  await db.query("update store_memberships set active=true,position='supervisor',role='admin',is_primary=false where store_id=$1 and user_id=$2", [ids.storeA,ids.employee])
  await db.query('delete from leave_requests where store_id=$1', [ids.storeA])
  await db.query('delete from shifts where store_id=$1 and date >= $2', [ids.storeA, '2099-11-01'])
  await db.query('delete from store_calendar where store_id=$1 and date >= $2', [ids.storeA, '2099-11-01'])
})

async function denied(sql: string, params: unknown[] = []) {
  await db.exec('savepoint denied_w3')
  await expect(db.query(sql, params)).rejects.toThrow()
  await db.exec('rollback to savepoint denied_w3; release savepoint denied_w3')
}
async function addShift(user: string, date: string, type = 'full') {
  return db.query<{id:string}>('insert into shifts(store_id,user_id,date,shift_type,segments,start_time,end_time,revision) values($1,$2,$3,$4,$5::jsonb,$6,$7,0) returning id',
    [ids.storeA, user, date, type, type === 'repo' ? null : validSegments, type === 'repo' ? null : '09:00', type === 'repo' ? null : '15:00'])
}
async function asUserCommit<T>(userId: string, action: () => Promise<T>): Promise<T> {
  await db.exec('begin')
  try {
    await db.query("select set_config('request.jwt.claim.sub',$1,true)", [userId])
    await db.exec('set local role authenticated')
    const result = await action()
    await db.exec('commit')
    return result
  } catch (error) {
    await db.exec('rollback')
    throw error
  }
}

describe('W3 transactional leave and day editing', () => {
  it('submits a revisioned request with selected rest preferences and blocks direct mutation/overlap', async () => {
    const requestId = await asUserCommit(ids.employee, async () => {
      const result = await db.query<{ id: string }>(`select submit_leave_request($1,'adeia',$2,$3,$4,$5::date[]) as id`,
        [ids.storeA, start, end, 'Συνθετικός λόγος αίτησης', ['2099-11-05']])
      const id = result.rows[0].id
      await denied("insert into leave_requests(store_id,user_id,type,start_date,end_date,status) values($1,$2,'adeia',$3,$4,'approved')", [ids.storeA, ids.employee, '2099-11-10', '2099-11-10'])
      await denied("update leave_requests set status='approved' where id=$1", [id])
      await denied('delete from leave_requests where id=$1', [id])
      await denied('select submit_leave_request($1,$2,$3,$4)', [ids.storeA, 'repo', '2099-11-04', '2099-11-06'])
      return id
    })
    const row = (await db.query('select status,revision,requested_rest_dates::text[] as requested_rest_dates from leave_requests where id=$1', [requestId])).rows[0]
    expect(row).toEqual({ status: 'pending', revision: 1, requested_rest_dates: ['2099-11-05'] })
    expect((await db.query('select action from leave_request_events where request_id=$1', [requestId])).rows).toEqual([{ action: 'submitted' }])
  })

  it('rejects overlapping submissions and lets the applicant cancel only a pending request', async () => {
    const requestId = await asUserCommit(ids.employee, async () => {
      const id = (await db.query<{id:string}>(`select submit_leave_request($1,'repo',$2,$3,'Pending cancellation') as id`,
        [ids.storeA,start,end])).rows[0].id
      await denied(`select submit_leave_request($1,'adeia',$2,$3,'Overlap')`, [ids.storeA,'2099-11-04','2099-11-06'])
      return id
    })
    const result = await asUserCommit(ids.employee, async () => (await db.query<{result:{status:string}}>(
      'select revoke_leave_request($1,$2,1) as result',[ids.storeA,requestId])).rows[0].result)
    expect(result.status).toBe('revoked')
    expect((await db.query<{count:number}>('select count(*)::int as count from leave_request_day_ledger where request_id=$1',[requestId])).rows[0].count).toBe(0)
    await asUser(db, ids.ownerA, () => denied('select revoke_leave_request($1,$2,2)',[ids.storeA,requestId]))
  })

  it('prevents a store manager from approving their own request', async () => {
    const requestId = await asUserCommit(ids.ownerA, async () => (await db.query<{id:string}>(
      `select submit_leave_request($1,'adeia',$2,$2,'Manager own leave') as id`,[ids.storeA,start])).rows[0].id)
    await asUser(db,ids.ownerA,()=>denied("select review_leave_request($1,$2,1,'approved')",[ids.storeA,requestId]))
    expect((await db.query<{status:string}>('select status from leave_requests where id=$1',[requestId])).rows[0].status).toBe('pending')
  })

  it('approves leave, stores the dated charge ledger and atomically applies/rests schedules', async () => {
    const existingWork = (await addShift(ids.employee, start)).rows[0].id
    const existingRest = (await addShift(ids.employee, '2099-11-03', 'repo')).rows[0].id
    const unaffected = (await addShift(ids.ownerA, start)).rows[0].id
    await db.query("insert into store_calendar(store_id,date,is_working,note) values($1,'2099-11-04',false,'Store holiday')", [ids.storeA])
    const requestId = await asUserCommit(ids.employee, async () => (await db.query<{id:string}>(`select submit_leave_request($1,'adeia',$2,$3,'Leave with exclusions',$4::date[]) as id`,
      [ids.storeA, start, end, ['2099-11-05']])).rows[0].id)
    const review = await asUserCommit(ids.ownerA, async () => {
      await denied('select review_leave_request($1,$2,$3,$4,$5::date[])', [ids.storeA, requestId, 9, 'approved', null])
      return (await db.query<{result:{status:string;charged_days:number;excluded_days:number;revision:number}}>("select review_leave_request($1,$2,$3,'approved',$4::date[]) as result", [ids.storeA, requestId, 1, ['2099-11-02']])).rows[0].result
    })
    expect(review).toMatchObject({ status: 'approved', charged_days: 1, excluded_days: 3, revision: 2 })
    const ledger = await db.query<{leave_date:string;disposition:string}>('select leave_date::text,disposition from leave_request_day_ledger where request_id=$1 order by leave_date', [requestId])
    expect(ledger.rows).toEqual([
      { leave_date: start, disposition: 'requested_rest' },
      { leave_date: '2099-11-03', disposition: 'preexisting_rest' },
      { leave_date: '2099-11-04', disposition: 'closed' },
      { leave_date: end, disposition: 'charged_leave' },
    ])
    expect((await db.query<{shift_type:string;source_leave_request_id:string}>('select shift_type,source_leave_request_id from shifts where id=$1', [existingWork])).rows[0])
      .toEqual({ shift_type: 'repo', source_leave_request_id: requestId })
    expect((await db.query<{shift_type:string}>('select shift_type from shifts where id=$1', [existingRest])).rows[0]).toEqual({ shift_type: 'repo' })
    expect((await db.query<{shift_type:string;source_leave_request_id:string}>('select shift_type,source_leave_request_id from shifts where user_id=$1 and date=$2', [ids.employee, end])).rows[0])
      .toEqual({ shift_type: 'adeia', source_leave_request_id: requestId })
    expect((await db.query<{count:number}>('select count(*)::int as count from shifts where user_id=$1 and date=$2', [ids.employee, '2099-11-04'])).rows[0].count).toBe(0)
    const projection=await asUser(db,ids.ownerA,()=>db.query<{data:{shifts:{id:string;segments:unknown}[];leaves:{revision:number;ledger:{disposition:string}[]}[]}}>(
      'select read_schedule($1,$2,$3) as data',[ids.storeA,'2099-11-01','2099-11-06']))
    expect(projection.rows[0].data.shifts.find((row)=>row.id===unaffected)?.segments).toEqual([{start:'09:00',end:'15:00'}])
    expect(projection.rows[0].data.leaves.find((leave)=>leave.revision===2)?.ledger.map((day)=>day.disposition)).toEqual([
      'requested_rest','preexisting_rest','closed','charged_leave',
    ])
  })

  it('revokes only unchanged request-owned assignments and restores snapshots in the same transaction', async () => {
    const original = (await addShift(ids.employee, start, 'full')).rows[0].id
    const requestId = await asUserCommit(ids.employee, async () => (await db.query<{id:string}>(`select submit_leave_request($1,'adeia',$2,$2,'Reversible leave') as id`,
      [ids.storeA, start])).rows[0].id)
    await asUserCommit(ids.ownerA, () => db.query("select review_leave_request($1,$2,1,'approved')", [ids.storeA, requestId]))
    const approvedRevision = (await db.query<{revision:number}>('select revision from leave_requests where id=$1', [requestId])).rows[0].revision
    const result = await asUserCommit(ids.ownerA, async () => (await db.query<{result:{status:string}}>('select revoke_leave_request($1,$2,$3) as result',
      [ids.storeA, requestId, approvedRevision])).rows[0].result)
    expect(result.status).toBe('revoked')
    expect((await db.query<{shift_type:string;segments:unknown;source_leave_request_id:string|null;revision:number}>('select shift_type,segments,source_leave_request_id,revision from shifts where id=$1', [original])).rows[0])
      .toEqual({ shift_type: 'full', segments: [{ start: '09:00', end: '15:00' }], source_leave_request_id: null, revision: 2 })
    expect((await db.query<{status:string}>('select status from leave_requests where id=$1', [requestId])).rows[0].status).toBe('revoked')
    expect((await db.query<{count:number}>('select count(*)::int as count from leave_request_day_ledger where request_id=$1', [requestId])).rows[0].count).toBe(1)
  })

  it('aborts leave review without partial shift/ledger changes on conflicting approved absence', async () => {
    const requestId = await asUserCommit(ids.employee, async () => (await db.query<{id:string}>(`select submit_leave_request($1,'adeia',$2,$3,'First request') as id`,
      [ids.storeA, start, end])).rows[0].id)
    await db.query("insert into leave_requests(store_id,user_id,type,start_date,end_date,status) values($1,$2,'repo','2099-11-04','2099-11-06','approved')", [ids.storeA, ids.employee])
    await addShift(ids.employee, start)
    await asUser(db, ids.ownerA, () => denied("select review_leave_request($1,$2,1,'approved')", [ids.storeA, requestId]))
    expect((await db.query<{status:string}>('select status from leave_requests where id=$1', [requestId])).rows[0].status).toBe('pending')
    expect((await db.query<{count:number}>('select count(*)::int as count from leave_request_day_ledger where request_id=$1', [requestId])).rows[0].count).toBe(0)
    expect((await db.query<{shift_type:string}>('select shift_type from shifts where user_id=$1 and date=$2', [ids.employee, start])).rows[0].shift_type).toBe('full')
  })

  it('revoke refuses to overwrite a shift that changed after the approval', async () => {
    const original = (await addShift(ids.employee, start)).rows[0].id
    const requestId = await asUserCommit(ids.employee, async () => (await db.query<{id:string}>(`select submit_leave_request($1,'adeia',$2,$2,'Conflict restore') as id`,
      [ids.storeA, start])).rows[0].id)
    await asUserCommit(ids.ownerA, () => db.query("select review_leave_request($1,$2,1,'approved')", [ids.storeA, requestId]))
    await db.query('update shifts set note=note where id=$1', [original])
    await asUser(db, ids.ownerA, async () => {
      await denied('select revoke_leave_request($1,$2,2)', [ids.storeA, requestId])
    })
    expect((await db.query<{status:string}>('select status from leave_requests where id=$1', [requestId])).rows[0].status).toBe('approved')
    expect((await db.query<{shift_type:string;source_leave_request_id:string}>('select shift_type,source_leave_request_id from shifts where id=$1', [original])).rows[0])
      .toEqual({ shift_type: 'adeia', source_leave_request_id: requestId })
  })

  it('saves a day batch atomically and preserves assignments if a later row is invalid', async () => {
    const ownerShift = (await addShift(ids.ownerA, start)).rows[0].id
    const employeeShift = (await addShift(ids.employee, start)).rows[0].id
    const ownerRevision = (await db.query<{revision:number}>('select revision from shifts where id=$1', [ownerShift])).rows[0].revision
    await asUser(db, ids.ownerA, async () => {
      await denied('select save_schedule_day($1,$2,$3::jsonb)', [ids.storeA, start, JSON.stringify([
        { id: ownerShift, revision: ownerRevision, user_id: ids.ownerA, date: start, shift_type: 'full', segments: [{ start: '10:00', end: '16:00' }] },
        { id: employeeShift, revision: 0, user_id: ids.employee, date: start, shift_type: 'split', segments: [{ start: '09:00', end: '14:00' }, { start: '13:00', end: '21:00' }] },
      ])])
    })
    expect((await db.query<{start_time:string;revision:number}>('select start_time,revision from shifts where id=$1', [ownerShift])).rows[0])
      .toEqual({ start_time: '09:00', revision: 0 })
    expect((await db.query<{shift_type:string}>('select shift_type from shifts where id=$1', [employeeShift])).rows[0].shift_type).toBe('full')
  })

  it('saves a valid multi-person day batch with interval snapshots and new optimistic revisions', async () => {
    const ownerShift=(await addShift(ids.ownerA,start)).rows[0].id
    const employeeShift=(await addShift(ids.employee,start)).rows[0].id
    const changed=await asUserCommit(ids.ownerA,async()=>db.query<{count:number}>(`select save_schedule_day($1,$2,$3::jsonb) as count`,[
      ids.storeA,start,JSON.stringify([
        {id:ownerShift,revision:0,user_id:ids.ownerA,date:start,template_id:null,shift_type:'full',segments:[{start:'09:00',end:'16:00'}],note:null},
        {id:employeeShift,revision:0,user_id:ids.employee,date:start,template_id:null,shift_type:'split',segments:[{start:'09:00',end:'13:00'},{start:'17:00',end:'21:00'}],note:null},
      ])]))
    expect(changed.rows[0].count).toBe(2)
    expect((await db.query<{user_id:string;segments:{start:string;end:string}[];revision:number}>('select user_id,segments,revision from shifts where date=$1 order by user_id',[start])).rows)
      .toEqual([{user_id:ids.ownerA,segments:[{start:'09:00',end:'16:00'}],revision:1},
        {user_id:ids.employee,segments:[{start:'09:00',end:'13:00'},{start:'17:00',end:'21:00'}],revision:1}])
    await asUser(db,ids.ownerA,()=>denied("update shifts set note='Direct REST write' where id=$1",[ownerShift]))
  })

  it('records Franchise store type and enforces strict account-role hierarchy for member changes', async () => {
    expect((await db.query<{store_type:string}>('select store_type from stores where id=$1',[ids.storeA])).rows[0].store_type).toBe('franchise')
    const ownedDemo=await db.query<{name:string;code:string;store_type:string;org_type:string}>(`select s.name,s.code,s.store_type,o.store_type as org_type
      from stores s join organizations o on o.id=s.organization_id where s.code='DEMO-OWNED-01'`)
    expect(ownedDemo.rows[0]).toEqual({name:'ΓΕΡΜΑΝΟΣ Demo Ιδιόκτητο',code:'DEMO-OWNED-01',store_type:'owned',org_type:'owned'})
    expect((await db.query('select 1 from store_memberships where store_id=(select id from stores where code=\'DEMO-OWNED-01\')')).rows).toHaveLength(0)
    await asUser(db,ids.ownerA,()=>db.query("select set_store_position($1,$2,'supervisor')",[ids.storeA,ids.employee]))
    await asUser(db,ids.employee,()=>denied("select set_store_position($1,$2,'director')",[ids.storeA,ids.ownerA]))
    expect((await db.query<{position:string}>('select position from store_memberships where store_id=$1 and user_id=$2',[ids.storeA,ids.employee])).rows[0].position).toBe('supervisor')
    await asUser(db,ids.employee,()=>denied("update profiles set store_position='owner' where id=$1",[ids.employee]))
  })

  it('validates manager registration metadata and bootstraps an owned store with its requested type', async () => {
    expect((await db.query<{store_type:string}>('select store_type from lookup_store_registration($1)', ['TEST-A'])).rows[0].store_type).toBe('franchise')
    await expect(db.query(`insert into auth.users(id,email,raw_user_meta_data) values($1,$2,$3::jsonb)`,[
      '40000000-0000-4000-8000-000000000003','mismatch@example.invalid',JSON.stringify({full_name:'Mismatch',account_type:'admin',store_name:'Synthetic A',store_code:'TEST-A',store_type:'owned',store_position:'director'})]))
      .rejects.toThrow('STORE_TYPE_MISMATCH')
    const newId='40000000-0000-4000-8000-000000000001'
    await db.query(`insert into auth.users(id,email,raw_user_meta_data) values($1,$2,$3::jsonb)`,[
      newId,'new-director@example.invalid',JSON.stringify({full_name:'New Director',account_type:'admin',store_name:'Owned Test',store_code:'OWNED-1',store_type:'owned',store_position:'director'})])
    expect((await db.query<{pending_position:string;pending_store_type:string}>('select pending_position,pending_store_type from profiles where id=$1',[newId])).rows[0])
      .toEqual({pending_position:'director',pending_store_type:'owned'})
    await asUserCommit(ids.master,()=>db.query('select approve_user($1)',[newId]))
    expect((await db.query<{store_type:string;org_type:string}>('select s.store_type,o.store_type as org_type from profiles p join stores s on s.id=p.store_id join organizations o on o.id=s.organization_id where p.id=$1',[newId])).rows[0])
      .toEqual({store_type:'owned',org_type:'owned'})
    expect((await db.query<{point_category_key:string;points_per_unit:string}>(`select r.point_category_key,r.points_per_unit from store_point_rules r
      join stores s on s.id=r.store_id join service_categories c on c.id=r.service_category_id
      where s.code='OWNED-1' and c.name='Protergia'`)).rows[0]).toEqual({point_category_key:'protergia',points_per_unit:'0.0000'})
  })

  it('allows an existing Franchise owner to approve an additional owner without changing other owners', async () => {
    const newId='40000000-0000-4000-8000-000000000002'
    await db.query(`insert into auth.users(id,email,raw_user_meta_data) values($1,$2,$3::jsonb)`,[
      newId,'new-owner@example.invalid',JSON.stringify({full_name:'Additional Owner',account_type:'admin',store_name:'Synthetic A',store_code:'TEST-A',store_type:'franchise',store_position:'owner'})])
    await asUser(db,ids.ownerA,()=>denied('select approve_user($1)',[newId]))
    await asUserCommit(ids.master,()=>db.query('select approve_user($1)',[newId]))
    expect((await db.query<{role:string}>('select role from organization_memberships where organization_id=$1 and user_id=$2',[ids.orgA,newId])).rows[0].role).toBe('owner')
    expect((await db.query('select 1 from organization_memberships where organization_id=$1 and user_id=$2 and role=\'owner\'',[ids.orgA,ids.ownerA])).rows).toHaveLength(1)
    await asUser(db,ids.ownerA,()=>denied("select set_organization_member($1,$2,'admin')",[ids.orgA,newId]))
  })

  it('moves an employee only after a higher-ranked member of the destination accepts', async () => {
    const request=await asUserCommit(ids.employee,()=>db.query<{id:string}>("select submit_store_transfer('TEST-B') as id"))
    const id=request.rows[0].id
    await asUser(db,ids.employee,()=>denied("select review_store_transfer($1,1,'approved')",[id]))
    await asUserCommit(ids.ownerB,()=>db.query("select review_store_transfer($1,1,'approved')",[id]))
    expect((await db.query<{active:boolean}>('select active from store_memberships where store_id=$1 and user_id=$2',[ids.storeA,ids.employee])).rows[0].active).toBe(false)
    expect((await db.query<{position:string;active:boolean}>('select position,active from store_memberships where store_id=$1 and user_id=$2',[ids.storeB,ids.employee])).rows[0])
      .toEqual({position:'supervisor',active:true})
    expect((await db.query<{store_id:string}>('select store_id from profiles where id=$1',[ids.employee])).rows[0].store_id).toBe(ids.storeB)
  })

  it('allows the master to complete a cross-store transfer as an audited platform action', async () => {
    const request=await asUserCommit(ids.employee,()=>db.query<{id:string}>("select submit_store_transfer('TEST-B') as id"))
    await asUserCommit(ids.master,()=>db.query("select review_store_transfer($1,1,'approved')",[request.rows[0].id]))
    expect((await db.query<{store_id:string}>('select store_id from profiles where id=$1',[ids.employee])).rows[0].store_id).toBe(ids.storeB)
    expect((await db.query<{action:string}>('select action from support_audit_events where actor_id=$1 and table_name=\'profiles\' and record_id=$2 order by created_at desc limit 1',[ids.master,ids.employee])).rows[0].action).toBe('platform.update')
  })

  it('records the director-selected acting replacement without changing that person\'s title', async () => {
    await db.query("update profiles set store_position='director',role='admin' where id=$1",[ids.orgAdmin])
    const request=await asUserCommit(ids.orgAdmin,()=>db.query<{id:string}>("select submit_store_transfer('TEST-B',$1) as id",[ids.employee]))
    await asUserCommit(ids.ownerB,()=>db.query("select review_store_transfer($1,1,'approved')",[request.rows[0].id]))
    expect((await db.query<{acting_director_id:string}>('select acting_director_id from stores where id=$1',[ids.storeA])).rows[0].acting_director_id).toBe(ids.employee)
    expect((await db.query<{position:string}>('select position from store_memberships where store_id=$1 and user_id=$2',[ids.storeA,ids.employee])).rows[0].position).toBe('supervisor')
  })

  it('derives store-specific category points from sales, adds auditable corrections, and keeps total points independent', async () => {
    const categories=(await db.query<{id:string;name:string}>("select id,name from service_categories where name in ('Broadband','OTE TV')")).rows
    const fixed=categories.find((row)=>row.name==='Broadband')!.id
    const tv=categories.find((row)=>row.name==='OTE TV')!.id
    await asUserCommit(ids.ownerA,async()=>{
      await db.query("select save_store_point_rule($1,$2,'fixed',2.5,'2099-11-01')",[ids.storeA,fixed])
      await db.query("select save_store_point_rule($1,$2,'tv',3,'2099-11-01')",[ids.storeA,tv])
      await db.query("select save_point_category_target($1,null,'fixed','2099-11',100)",[ids.storeA])
      await db.query("select save_point_category_target($1,$2,'fixed','2099-11',30)",[ids.storeA,ids.employee])
      await db.query("select adjust_point_category($1,$2,'fixed','2099-11-02',2,'Διόρθωση συνθετικού ελέγχου')",[ids.storeA,ids.employee])
    })
    // A retry/backfill must preserve per-store rates and existing adjustments.
    await db.exec(loadSql('supabase/migrations/20261105_store_point_categories.sql'))
    await db.query(`insert into sales_entries(store_id,user_id,category_id,date,quantity,created_by)
      values($1,$2,$3,'2099-11-02',3,$4),($1,$2,$5,'2099-11-02',2,$4)`,[ids.storeA,ids.employee,fixed,ids.ownerA,tv])
    await db.query("insert into point_entries(store_id,user_id,date,points,created_by) values($1,$2,'2099-11-02',50,$3)",[ids.storeA,ids.employee,ids.ownerA])
    const score=await asUser(db,ids.employee,()=>db.query<{category_key:string;sales_points:number;adjustments:number;total_points:number}>(
      'select category_key,sales_points,adjustments,total_points from read_point_category_scores($1,$2,$3)',[ids.storeA,'2099-11',ids.employee]))
    const fixedScore=score.rows.find((row)=>row.category_key==='fixed')!
    expect({sales_points:Number(fixedScore.sales_points),adjustments:Number(fixedScore.adjustments),total_points:Number(fixedScore.total_points)})
      .toEqual({sales_points:7.5,adjustments:2,total_points:9.5})
    expect(Number(score.rows.find((row)=>row.category_key==='tv')?.total_points)).toBe(6)
    expect(Number((await db.query<{points:number}>('select points from point_entries where store_id=$1 and user_id=$2 and date=$3',[ids.storeA,ids.employee,'2099-11-02'])).rows[0].points)).toBe(50)
    expect(Number((await db.query<{target:number}>('select target from employee_point_category_targets where store_id=$1 and user_id=$2 and category_key=\'fixed\'',[ids.storeA,ids.employee])).rows[0].target)).toBe(30)
    await asUser(db,ids.employee,()=>denied("select save_point_category_target($1,$2,'fixed','2099-11',100)",[ids.storeA,ids.ownerA]))
    await asUser(db,ids.employee,()=>denied("insert into point_category_adjustments(store_id,user_id,category_key,date,points_delta,reason,created_by) values($1,$2,'fixed','2099-11-02',10,'forged',$2)",[ids.storeA,ids.employee]))
  })
})

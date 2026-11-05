import { describe, expect, it } from 'vitest'
import { supportSessionFromRow, type SupportSessionRow } from '../support'

const row: SupportSessionRow = { id: 'session', store_id: 'store', reason: 'Synthetic reason',
  started_at: '2026-11-05T12:00:00Z', server_now: '2026-11-05T12:10:00Z', expires_at: '2026-11-05T12:30:00Z' }
describe('support deadline from server time', () => {
  it('uses the remaining server duration even if the client clock differs by hours', () => {
    const requestStart = Date.parse('2026-11-05T02:00:00Z')
    expect(supportSessionFromRow(row, requestStart).localDeadline).toBe(requestStart + 20 * 60000)
  })
  it('treats an expired server session as immediately expired', () => {
    expect(supportSessionFromRow({ ...row, expires_at: row.started_at }, 1000).localDeadline).toBe(1000)
  })
  it('fails closed on malformed server timestamps', () => {
    expect(() => supportSessionFromRow({ ...row, server_now: 'invalid' }, 1000)).toThrow()
  })
})

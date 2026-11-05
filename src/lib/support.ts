export interface SupportStore { id: string; name: string; code: string | null; organization_id: string | null }
export interface SupportSessionRow {
  id: string
  store_id: string
  reason: string
  started_at: string
  expires_at: string
  server_now: string
}
export interface SupportSession extends SupportSessionRow { localDeadline: number }

/** Use server time, conservatively anchored BEFORE the network request. */
export function supportSessionFromRow(row: SupportSessionRow, requestStartedAt: number): SupportSession {
  const remaining = Math.max(0, Date.parse(row.expires_at) - Date.parse(row.server_now))
  if (!Number.isFinite(remaining)) throw new Error('Μη έγκυρος χρόνος συνεδρίας υποστήριξης.')
  return { ...row, localDeadline: requestStartedAt + remaining }
}

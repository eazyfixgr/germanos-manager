import { useCallback, useEffect, useState } from 'react'
import type { DateRange } from './dates'
import type { ScheduleData, ScheduleScope } from './model'
import { readSchedule } from './data'

export function useScheduleData(storeId: string | undefined, range: DateRange, scope: ScheduleScope) {
  const [revision, setRevision] = useState(0)
  const key = JSON.stringify([storeId, range.start, range.end, scope])
  const [result, setResult] = useState<{ key: string; revision: number; data: ScheduleData | null; error: string } | null>(null)
  useEffect(() => {
    if (!storeId) return
    let cancelled = false
    void readSchedule(storeId, { start: range.start, end: range.end }, scope).then(
      (data) => { if (!cancelled) setResult({ key, revision, data, error: '' }) },
      (error: unknown) => { if (!cancelled) setResult({ key, revision, data: null, error: error instanceof Error ? error.message : 'Σφάλμα φόρτωσης.' }) },
    )
    return () => { cancelled = true }
  }, [storeId, range.start, range.end, scope, key, revision])
  const current = result?.key === key ? result : null
  return {
    data: current?.data ?? null,
    loading: Boolean(storeId && (!current || current.revision !== revision)),
    error: current?.error ?? '',
    reload: useCallback(() => setRevision((value) => value + 1), []),
  }
}

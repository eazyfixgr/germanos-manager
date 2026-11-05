import type { StaffingRequirement } from './intervals'
import { minutes, resolvedSegments } from './intervals'
import { weekday } from './dates'
import type { ScheduleDay } from './model'

export interface CoverageGap { start: string; end: string; required: number; actual: number; templateCode: string | null }
export interface DayCoverage {
  status: 'unknown' | 'closed' | 'partial' | 'missing' | 'covered'
  label: string; gaps: CoverageGap[]; requirements: StaffingRequirement[]; unresolved: number
}
const clock = (value: number) => `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`
export function evaluateCoverage(day: ScheduleDay, all: StaffingRequirement[], team: boolean): DayCoverage {
  const requirements = all.filter((rule) => rule.weekday === weekday(day.date) + 1
    && rule.valid_from <= day.date && (!rule.valid_to || rule.valid_to >= day.date))
  const unresolved = day.working.filter((row) => resolvedSegments(row.shift) === null).length
  const result = (status: DayCoverage['status'], label: string, gaps: CoverageGap[] = []): DayCoverage => ({ status, label, gaps, requirements, unresolved })
  if (!team) return result('unknown', 'Προσωπική προβολή')
  if (day.opening === 'closed') return result(day.working.length ? 'missing' : requirements.some((rule) => rule.minimum > 0) ? 'partial' : 'closed',
    day.working.length ? 'Βάρδιες σε κλειστή ημέρα' : requirements.some((rule) => rule.minimum > 0) ? 'Ανάγκες σε κλειστή ημέρα' : 'Κλειστή ημέρα')
  if (day.opening === 'unknown' || !day.hours || requirements.length === 0) return result('unknown', 'Κάλυψη μη αξιολογημένη')
  const [opening, closing] = day.hours.split('–').map(minutes)
  if (requirements.some((rule) => minutes(rule.start_time) < opening || minutes(rule.end_time) > closing)) return result('partial', 'Ανάγκες εκτός ωραρίου καταστήματος')
  const gaps: CoverageGap[] = []
  for (const requirement of requirements) {
    const start = minutes(requirement.start_time); const end = minutes(requirement.end_time)
    const eligible = day.working.filter((row) => !requirement.template_code || row.shift?.template_code === requirement.template_code)
      .map((row) => ({ id: row.person.id, segments: resolvedSegments(row.shift) ?? [] }))
    const edges = [...new Set([start, end, ...eligible.flatMap((person) => person.segments.flatMap((segment) => [minutes(segment.start), minutes(segment.end)]))])]
      .filter((edge) => edge >= start && edge <= end).sort((a, b) => a - b)
    for (let index = 0; index < edges.length - 1; index++) {
      const from = edges[index]; const until = edges[index + 1]
      const actual = new Set(eligible.filter((person) => person.segments.some((segment) => minutes(segment.start) <= from && minutes(segment.end) >= until)).map((person) => person.id)).size
      if (actual < requirement.minimum) gaps.push({ start: clock(from), end: clock(until), actual, required: requirement.minimum, templateCode: requirement.template_code })
    }
  }
  if (unresolved) return result('unknown', 'Χρειάζονται πραγματικά διαστήματα', gaps)
  if (gaps.length) return result('missing', 'Ελλείψεις στελέχωσης', gaps)
  const intervals = requirements.map((rule) => [minutes(rule.start_time), minutes(rule.end_time)]).sort((a, b) => a[0] - b[0])
  let cursor = opening
  for (const [start, end] of intervals) { if (start > cursor) break; cursor = Math.max(cursor, end) }
  if (cursor < closing || !requirements.some((rule) => rule.minimum > 0)) return result('partial', 'Συμπληρώστε τις ανάγκες ωραρίου')
  if (day.working.some((row) => row.hoursIssue) || day.rows.some((row) => row.conflict)) return result('unknown', 'Χρειάζεται έλεγχος αναθέσεων')
  return result('covered', 'Κάλυψη δηλωμένων αναγκών')
}

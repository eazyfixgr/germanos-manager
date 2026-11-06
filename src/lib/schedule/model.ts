import type { LeaveRequest, Shift, StoreCalendarDay, StorePattern } from '../types'
import { SHIFT_TYPE } from '../constants'
import { weekday } from './dates'
import { formatSegments, resolvedSegments, type ShiftTemplate, type StaffingRequirement } from './intervals'
import { evaluateCoverage, type DayCoverage } from './coverage'

export type ScheduleScope = 'own' | 'team'
export interface ScheduleStaff { id: string; full_name: string; active: boolean }
export interface ScheduleData {
  store_id: string; start: string; end: string; scope: ScheduleScope; can_manage: boolean; min_staff: number
  staff: ScheduleStaff[]; shifts: Shift[]; leaves: LeaveRequest[]
  patterns: StorePattern[]; calendar: StoreCalendarDay[]
  workforce_schema?: number; templates?: ShiftTemplate[]; requirements?: StaffingRequirement[]
}
export type DayStatus = 'work' | 'repo' | 'adeia' | 'unassigned' | 'closed'
export interface DayAssignmentDraft {
  id: string | null; revision: number; user_id: string; date: string; template_id: string | null
  template_code?: string | null; template_name?: string | null; template_short_label?: string | null; template_color?: string | null
  shift_type: string; segments: { start: string; end: string }[] | null; note: string | null
}
export interface StaffDay {
  person: ScheduleStaff; shift?: Shift; approved?: LeaveRequest
  status: DayStatus; conflict: boolean; hoursIssue: boolean
}
export interface ScheduleDay {
  date: string; opening: 'open' | 'closed' | 'unknown'; hours: string | null
  rows: StaffDay[]; working: StaffDay[]; away: StaffDay[]; unassigned: StaffDay[]
  pending: number; issues: string[]; groups: { type: string; label: string; rows: StaffDay[] }[]
  coverage?: DayCoverage
}

export function shiftLabel(type?: string): string {
  if (!type) return 'Χωρίς ανάθεση'
  if (type === 'closed') return 'Κλειστό κατάστημα'
  if (type === 'unassigned') return 'Χωρίς ανάθεση'
  if (type === 'short') return 'Βραχεία'
  return SHIFT_TYPE[type as keyof typeof SHIFT_TYPE]?.label ?? 'Άγνωστος τύπος'
}
export function shiftTone(type?: string): string {
  if (type === 'repo') return 'bg-slate-100 text-slate-600'
  if (type === 'adeia') return 'bg-rose-50 text-rose-700'
  return SHIFT_TYPE[type as keyof typeof SHIFT_TYPE]?.color ?? 'bg-slate-50 text-slate-500'
}
export function shiftStyle(shift?: Shift) {
  const color = shift?.template_color
  return color && /^#[0-9a-f]{6}$/i.test(color) ? { color, backgroundColor: `${color}18` } : undefined
}
export function shiftHours(shift?: Shift): string {
  if (!shift || shift.shift_type === 'repo' || shift.shift_type === 'adeia') return '—'
  if (shift.segments?.length) return formatSegments(shift.segments)
  if (!shift.start_time || !shift.end_time) return 'Χωρίς ορισμένες ώρες'
  const range = `${shift.start_time.slice(0, 5)}–${shift.end_time.slice(0, 5)}`
  return shift.shift_type === 'split' ? `${range} · εύρος σπαστού` : range
}
export function initials(name: string): string {
  return name.split(' ').filter(Boolean).slice(0, 2).map((part) => part[0]).join('')
}
export function buildDay(data: ScheduleData, date: string, minStaff = 0): ScheduleDay {
  const calendar = data.calendar.find((day) => day.date === date)
  const pattern = data.patterns.find((day) => day.weekday === weekday(date) + 1)
  const opening = calendar ? (calendar.is_working ? 'open' : 'closed')
    : pattern ? (pattern.closed ? 'closed' : 'open') : 'unknown'
  const start = calendar?.open_time ?? pattern?.start_time
  const end = calendar?.close_time ?? pattern?.end_time
  const hours = opening === 'open' && start && end ? `${start.slice(0, 5)}–${end.slice(0, 5)}` : null
  const shifts = new Map(data.shifts.filter((shift) => shift.date === date).map((shift) => [shift.user_id, shift]))
  const relevant = data.leaves.filter((leave) => leave.start_date <= date && leave.end_date >= date)
  const approved = relevant.filter((leave) => leave.status === 'approved')
  const issues = new Set<string>()
  const rows: StaffDay[] = []
  for (const person of data.staff) {
    const shift = shifts.get(person.id)
    const absences = approved.filter((leave) => leave.user_id === person.id)
    const absence = absences.find((leave) => leave.type === 'adeia') ?? absences[0]
    if (!person.active && !shift && !absence) continue
    const ledgerDay = absence?.ledger?.find((entry) => entry.date === date)
    const scheduledRest = absence?.type === 'adeia' && shift?.shift_type === 'repo'
      && ['requested_rest','preexisting_rest'].includes(ledgerDay?.disposition ?? '')
    const conflict = Boolean(absence && shift && shift.shift_type !== absence.type && !scheduledRest)
    if (conflict) issues.add('Εγκεκριμένη απουσία με διαφορετική καταχωρημένη βάρδια.')
    if (absences.length > 1) issues.add('Επικαλυπτόμενες εγκεκριμένες απουσίες.')
    const type = scheduledRest ? 'repo' : absence?.type ?? shift?.shift_type
    const status: DayStatus = type === 'repo' || type === 'adeia' ? type
      : shift ? 'work' : opening === 'closed' ? 'closed' : 'unassigned'
    const hoursIssue = status === 'work' && Boolean(shift?.start_time && shift.end_time && (
      shift.start_time.slice(0, 5) >= shift.end_time.slice(0, 5)
      || (start && shift.start_time.slice(0, 5) < start.slice(0, 5))
      || (end && shift.end_time.slice(0, 5) > end.slice(0, 5))))
    if (hoursIssue) issues.add('Υπάρχουν βάρδιες με μη έγκυρες ώρες ή εκτός ωραρίου καταστήματος.')
    rows.push({ person, shift, approved: absence, status, conflict, hoursIssue })
  }
  const working = rows.filter((row) => row.status === 'work').sort((a, b) =>
    (a.shift?.start_time ?? '99:99').localeCompare(b.shift?.start_time ?? '99:99') || a.person.full_name.localeCompare(b.person.full_name, 'el'))
  const away = rows.filter((row) => row.status === 'repo' || row.status === 'adeia')
  const unassigned = rows.filter((row) => row.status === 'unassigned')
  if (opening === 'closed' && working.length) issues.add('Υπάρχουν βάρδιες σε κλειστή ημέρα.')
  if (opening !== 'closed' && unassigned.length) issues.add(`${unassigned.length} άτομα χωρίς ανάθεση.`)
  if (working.some((row) => !row.shift?.start_time || !row.shift.end_time)) issues.add('Υπάρχουν βάρδιες χωρίς ορισμένες ώρες.')
  if (working.some((row) => row.shift?.shift_type === 'split' && resolvedSegments(row.shift) === null)) issues.add('Χρειάζονται τα δύο πραγματικά διαστήματα σπαστού.')
  if (data.scope === 'team' && opening === 'open' && minStaff > working.length) issues.add('Κάτω από το ημερήσιο ελάχιστο προσωπικού.')
  const groups: ScheduleDay['groups'] = []
  for (const row of working) {
    const type = row.shift!.template_id ?? row.shift!.shift_type
    const group = groups.find((item) => item.type === type)
    if (group) group.rows.push(row)
    else groups.push({ type, label: row.shift!.template_name ?? shiftLabel(type), rows: [row] })
  }
  const day: ScheduleDay = { date, opening, hours, rows, working, away, unassigned,
    pending: relevant.filter((leave) => leave.status === 'pending').length, issues: [...issues], groups }
  day.coverage = evaluateCoverage(day, data.requirements ?? [], data.scope === 'team')
  return day
}

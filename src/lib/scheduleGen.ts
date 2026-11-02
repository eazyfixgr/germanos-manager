import type { PatternLevel } from './types'

export interface SchedulePattern {
  weekday: number
  closed: boolean
  level: PatternLevel
  start_time: string | null
  end_time: string | null
}
export interface ScheduleEmployee { id: string; full_name: string }
export interface ScheduleLeave {
  user_id: string
  type: 'repo' | 'adeia'
  start_date: string
  end_date: string
  status: 'pending' | 'approved' | 'rejected'
}
export interface ScheduleCalendar {
  date: string
  is_working: boolean
  open_time: string | null
  close_time: string | null
}
export interface PlannedShift {
  store_id: string
  user_id: string
  date: string
  shift_type: string
  start_time: string | null
  end_time: string | null
  note: string | null
}
export interface ScheduleResult { shifts: PlannedShift[]; warnings: string[] }

function pad(n: number) { return String(n).padStart(2, '0') }
function ymd(d: Date) {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
}
function parseYmd(s: string) {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d))
}
function eachDate(start: string, end: string): string[] {
  const out: string[] = []
  let cur = parseYmd(start)
  const last = parseYmd(end)
  while (cur.getTime() <= last.getTime()) {
    out.push(ymd(cur))
    cur = new Date(cur.getTime() + 86400000)
  }
  return out
}

/**
 * Δημιουργεί πρόγραμμα βαρδιών για έναν μήνα:
 * - Σέβεται κλειστές ημέρες / μοτίβα ωραρίου (split/short/full).
 * - Σέβεται εγκεκριμένες άδειες και αιτήματα ρεπό (approved + pending repo).
 * - Δίνει 1 κυλιόμενο ρεπό/εβδομάδα ανά υπάλληλο (εκτός αν έχει ήδη ρεπό).
 * - Δίκαιη κατανομή: τα ρεπό σε ημέρες «σπαστού» μοιράζονται σε όσους είχαν λιγότερα.
 */
export function buildSchedule(params: {
  storeId: string
  month: string
  employees: ScheduleEmployee[]
  patterns: SchedulePattern[]
  calendar: ScheduleCalendar[]
  leaves: ScheduleLeave[]
  minStaff: number
}): ScheduleResult {
  const { storeId, month, employees, patterns, calendar, leaves } = params
  const minStaff = Math.max(0, params.minStaff ?? 1)
  const [y, m] = month.split('-').map(Number)
  const dim = new Date(Date.UTC(y, m, 0)).getUTCDate()
  const monthStart = `${month}-01`
  const monthEnd = `${month}-${pad(dim)}`

  const patternByWd = new Map<number, SchedulePattern>()
  patterns.forEach((p) => patternByWd.set(p.weekday, p))
  const calByDate = new Map<string, ScheduleCalendar>()
  calendar.forEach((c) => calByDate.set(c.date, c))

  const dates = Array.from({ length: dim }, (_, i) => {
    const d = new Date(Date.UTC(y, m - 1, i + 1))
    const wd = d.getUTCDay() === 0 ? 7 : d.getUTCDay()
    const date = ymd(d)
    const pat = patternByWd.get(wd)
    const cal = calByDate.get(date)
    const closed = cal ? !cal.is_working : (pat ? pat.closed : wd === 7)
    const level: PatternLevel = pat?.level ?? 'full'
    const start = cal?.open_time || pat?.start_time || '09:00'
    const end = cal?.close_time || pat?.end_time || '21:00'
    return { date, weekday: wd, closed, level, start, end }
  })

  const repoByUser = new Map<string, Set<string>>()
  const adeiaByUser = new Map<string, Set<string>>()
  const add = (map: Map<string, Set<string>>, key: string, d: string) => {
    if (!map.has(key)) map.set(key, new Set())
    map.get(key)!.add(d)
  }
  for (const lv of leaves) {
    if (lv.status === 'rejected') continue
    const start = lv.start_date < monthStart ? monthStart : lv.start_date
    const end = lv.end_date > monthEnd ? monthEnd : lv.end_date
    if (start > end) continue
    for (const d of eachDate(start, end)) {
      if (lv.type === 'adeia') {
        if (lv.status === 'approved') add(adeiaByUser, lv.user_id, d)
      } else {
        add(repoByUser, lv.user_id, d)
      }
    }
  }

  const splitOffs = new Map<string, number>()
  const shortOffs = new Map<string, number>()
  employees.forEach((e) => { splitOffs.set(e.id, 0); shortOffs.set(e.id, 0) })

  const rollingOff = new Map<string, Set<string>>()
  const warnings: string[] = []

  const weeks = new Map<string, typeof dates>()
  for (const d of dates) {
    const dt = parseYmd(d.date)
    const ws = new Date(dt.getTime() - (d.weekday - 1) * 86400000)
    const key = ymd(ws)
    if (!weeks.has(key)) weeks.set(key, [])
    weeks.get(key)!.push(d)
  }

  for (const key of [...weeks.keys()].sort()) {
    const weekDates = weeks.get(key)!.slice().sort((a, b) => a.date.localeCompare(b.date))
    const openDays = weekDates.filter((d) => !d.closed)
    if (openDays.length === 0) continue

    // Αν η Δευτέρα της εβδομάδας ανήκει σε προηγούμενο μήνα, το ρεπό της
    // εβδομάδας το έχει ήδη δώσει το προηγούμενο πρόγραμμα. Αποφεύγουμε διπλό ρεπό.
    if (key.slice(0, 7) !== month) continue

    const needed = employees.filter((emp) => {
      if (weekDates.some((d) => repoByUser.get(emp.id)?.has(d.date))) return false
      const allLeave = openDays.every((d) => adeiaByUser.get(emp.id)?.has(d.date))
      return !allLeave
    })
    if (needed.length === 0) continue

    const baseCap = Math.max(1, Math.ceil(needed.length / openDays.length))
    const slots = new Map<string, number>()
    const assignedCount = new Map<string, number>()
    for (const d of openDays) {
      const alreadyOff = employees.filter((emp) =>
        adeiaByUser.get(emp.id)?.has(d.date) || repoByUser.get(emp.id)?.has(d.date),
      ).length
      const available = employees.length - alreadyOff
      slots.set(d.date, Math.max(0, Math.min(baseCap, available - minStaff)))
      assignedCount.set(d.date, 0)
    }

    const order = needed.slice().sort((a, b) => {
      const sa = splitOffs.get(a.id) ?? 0
      const sb = splitOffs.get(b.id) ?? 0
      if (sa !== sb) return sa - sb
      const ha = shortOffs.get(a.id) ?? 0
      const hb = shortOffs.get(b.id) ?? 0
      if (ha !== hb) return ha - hb
      return a.full_name.localeCompare(b.full_name)
    })

    const load = (d: { date: string }) => assignedCount.get(d.date) ?? 0
    for (const emp of order) {
      const candidates = openDays.filter((d) =>
        !adeiaByUser.get(emp.id)?.has(d.date) &&
        !repoByUser.get(emp.id)?.has(d.date) &&
        (slots.get(d.date) ?? 0) > 0,
      )
      if (candidates.length === 0) {
        warnings.push(`${emp.full_name}: δεν βρέθηκε διαθέσιμη ημέρα για ρεπό.`)
        continue
      }
      const byLoad = (a: { date: string }, b: { date: string }) =>
        load(a) - load(b) || a.date.localeCompare(b.date)
      const splitCand = candidates.filter((d) => d.level === 'split').sort(byLoad)
      const chosen = splitCand[0] ?? candidates.slice().sort(byLoad)[0]

      if (!rollingOff.has(chosen.date)) rollingOff.set(chosen.date, new Set())
      rollingOff.get(chosen.date)!.add(emp.id)
      slots.set(chosen.date, (slots.get(chosen.date) ?? 1) - 1)
      assignedCount.set(chosen.date, (assignedCount.get(chosen.date) ?? 0) + 1)
      if (chosen.level === 'split') splitOffs.set(emp.id, (splitOffs.get(emp.id) ?? 0) + 1)
      else shortOffs.set(emp.id, (shortOffs.get(emp.id) ?? 0) + 1)
    }
  }

  const shifts: PlannedShift[] = []
  for (const d of dates) {
    if (d.closed) continue
    for (const emp of employees) {
      const base = {
        store_id: storeId, user_id: emp.id, date: d.date,
        start_time: null as string | null, end_time: null as string | null, note: null as string | null,
      }
      if (adeiaByUser.get(emp.id)?.has(d.date)) {
        shifts.push({ ...base, shift_type: 'adeia', note: 'Άδεια' })
      } else if (repoByUser.get(emp.id)?.has(d.date)) {
        shifts.push({ ...base, shift_type: 'repo', note: 'Ρεπό (αίτημα)' })
      } else if (rollingOff.get(d.date)?.has(emp.id)) {
        shifts.push({ ...base, shift_type: 'repo', note: 'Ρεπό' })
      } else {
        shifts.push({
          ...base,
          shift_type: d.level,
          start_time: d.start,
          end_time: d.end,
          note: d.level === 'split' ? 'Σπαστό' : d.level === 'short' ? 'Βραχεία βάρδια' : null,
        })
      }
    }
  }

  return { shifts, warnings }
}

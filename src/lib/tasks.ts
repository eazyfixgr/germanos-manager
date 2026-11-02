import type { TaskRecurrence } from './types'

export interface GenTemplate {
  id: string
  title: string
  category: string | null
  recurrence: TaskRecurrence
  weekdays: number[]
  month_day: number | null
  every_n: number
  due_time: string | null
  requires_authorized: boolean
}

export interface GenEmployee { id: string; full_name: string; role: string }
export interface GenShift { user_id: string; date: string; shift_type: string }
export interface GenLeave { user_id: string; start_date: string; end_date: string }

export interface TaskInsert {
  store_id: string
  template_id: string
  title: string
  category: string | null
  assigned_user_id: string
  scheduled_date: string
  due_time: string | null
  status: 'pending'
  requires_authorized: boolean
  created_by: string
}

function pad(n: number) { return String(n).padStart(2, '0') }
function dateStr(y: number, m: number, d: number) { return `${y}-${pad(m)}-${pad(d)}` }
function isoWeekday(y: number, m: number, d: number) {
  const wd = new Date(y, m - 1, d).getDay()
  return wd === 0 ? 7 : wd
}

export function taskDatesForTemplate(t: GenTemplate, month: string, storeDays: string[]): string[] {
  const [y, m] = month.split('-').map(Number)
  const daysInMonth = new Date(y, m, 0).getDate()

  if (t.recurrence === 'daily') return [...storeDays]

  if (t.recurrence === 'weekly_days') {
    const set = new Set(t.weekdays)
    const out: string[] = []
    for (let d = 1; d <= daysInMonth; d++) {
      if (set.has(isoWeekday(y, m, d))) out.push(dateStr(y, m, d))
    }
    return out
  }

  if (t.recurrence === 'monthly_date') {
    const d = t.month_day ?? 1
    return d >= 1 && d <= daysInMonth ? [dateStr(y, m, d)] : []
  }

  if (t.recurrence === 'every_n_days') {
    const n = Math.max(1, t.every_n || 1)
    const working = new Set(storeDays)
    const out: string[] = []
    for (let d = 1; d <= daysInMonth; d++) {
      if ((d - 1) % n !== 0) continue
      const ds = dateStr(y, m, d)
      if (working.size === 0 || working.has(ds)) out.push(ds)
    }
    return out
  }

  return []
}

export function generateTaskPlan(params: {
  storeId: string
  month: string
  creatorId: string
  templates: GenTemplate[]
  employees: GenEmployee[]
  shifts: GenShift[]
  leaves: GenLeave[]
  storeDays: string[]
  existing: Set<string>
}): TaskInsert[] {
  const { storeId, month, creatorId, templates, employees, shifts, leaves, storeDays, existing } = params

  const onLeave = (userId: string, date: string) =>
    leaves.some((l) => l.user_id === userId && date >= l.start_date && date <= l.end_date)

  const shiftSet = new Map<string, Set<string>>()
  shifts.forEach((s) => {
    if (s.shift_type === 'repo' || s.shift_type === 'adeia') return
    if (!shiftSet.has(s.user_id)) shiftSet.set(s.user_id, new Set())
    shiftSet.get(s.user_id)!.add(s.date)
  })

  // template/date -> tasks to create
  const byDate = new Map<string, GenTemplate[]>()
  const seen = new Set<string>(existing)
  for (const t of templates) {
    for (const date of taskDatesForTemplate(t, month, storeDays)) {
      const key = `${t.id}|${date}`
      if (seen.has(key)) continue
      seen.add(key)
      if (!byDate.has(date)) byDate.set(date, [])
      byDate.get(date)!.push(t)
    }
  }

  const overall = new Map<string, number>()
  const dayCount = new Map<string, Map<string, number>>()
  const plan: TaskInsert[] = []

  for (const date of [...byDate.keys()].sort()) {
    const templatesForDay = byDate.get(date)!
    if (!dayCount.has(date)) dayCount.set(date, new Map())
    const dCount = dayCount.get(date)!

    for (const t of templatesForDay) {
      let eligible = employees.filter((e) => !onLeave(e.id, date))
      if (t.requires_authorized) {
        eligible = eligible.filter((e) => e.role === 'admin' || e.role === 'master')
      }
      if (eligible.length === 0) continue

      const withShift = eligible.filter((e) => shiftSet.get(e.id)?.has(date))
      if (withShift.length > 0) eligible = withShift

      eligible.sort((a, b) => {
        const da = dCount.get(a.id) ?? 0
        const db = dCount.get(b.id) ?? 0
        if (da !== db) return da - db
        const oa = overall.get(a.id) ?? 0
        const ob = overall.get(b.id) ?? 0
        if (oa !== ob) return oa - ob
        return a.full_name.localeCompare(b.full_name)
      })

      const chosen = eligible[0]
      plan.push({
        store_id: storeId,
        template_id: t.id,
        title: t.title,
        category: t.category,
        assigned_user_id: chosen.id,
        scheduled_date: date,
        due_time: t.due_time,
        status: 'pending',
        requires_authorized: t.requires_authorized,
        created_by: creatorId,
      })
      dCount.set(chosen.id, (dCount.get(chosen.id) ?? 0) + 1)
      overall.set(chosen.id, (overall.get(chosen.id) ?? 0) + 1)
    }
  }

  return plan
}

export const DEFAULT_TEMPLATES: Omit<GenTemplate, 'id'>[] = [
  { title: 'Καθαρισμός τουαλετών', category: 'Καθαριότητα', recurrence: 'daily', weekdays: [], month_day: null, every_n: 1, due_time: null, requires_authorized: false },
  { title: 'Ξεσκόνισμα προϊόντων', category: 'Καθαριότητα', recurrence: 'daily', weekdays: [], month_day: null, every_n: 1, due_time: null, requires_authorized: false },
  { title: 'Τακτοποίηση αποθήκης', category: 'Αποθήκη', recurrence: 'daily', weekdays: [], month_day: null, every_n: 1, due_time: null, requires_authorized: false },
  { title: 'Καθαρισμός βιτρινών', category: 'Καθαριότητα', recurrence: 'daily', weekdays: [], month_day: null, every_n: 1, due_time: null, requires_authorized: false },
  { title: 'Σφουγγάρισμα', category: 'Καθαριότητα', recurrence: 'daily', weekdays: [], month_day: null, every_n: 1, due_time: null, requires_authorized: false },
  { title: 'Σκούπισμα', category: 'Καθαριότητα', recurrence: 'daily', weekdays: [], month_day: null, every_n: 1, due_time: null, requires_authorized: false },
  { title: 'Αλλαγές τιμών', category: 'Εμπορικό', recurrence: 'weekly_days', weekdays: [1], month_day: null, every_n: 1, due_time: null, requires_authorized: false },
  { title: 'Σκουπίδια', category: 'Καθαριότητα', recurrence: 'daily', weekdays: [], month_day: null, every_n: 1, due_time: null, requires_authorized: false },
  { title: 'Cupex', category: 'Εμπορικό', recurrence: 'weekly_days', weekdays: [5], month_day: null, every_n: 1, due_time: null, requires_authorized: false },
  { title: 'Ταμείο', category: 'Ταμείο', recurrence: 'daily', weekdays: [], month_day: null, every_n: 1, due_time: null, requires_authorized: true },
  { title: 'Τιμολόγηση', category: 'Εμπορικό', recurrence: 'daily', weekdays: [], month_day: null, every_n: 1, due_time: null, requires_authorized: false },
]

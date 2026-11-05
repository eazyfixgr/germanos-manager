export type ScheduleView = 'month' | 'week'
export interface DateRange { start: string; end: string }
export const WEEKDAYS = ['Δευτέρα', 'Τρίτη', 'Τετάρτη', 'Πέμπτη', 'Παρασκευή', 'Σάββατο', 'Κυριακή']

export function dateValue(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('Μη έγκυρη ημερομηνία.')
  const date = new Date(`${value}T12:00:00Z`)
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new Error('Μη έγκυρη ημερομηνία.')
  return date
}
export function dateKey(date: Date): string { return date.toISOString().slice(0, 10) }
export function todayInAthens(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Athens', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now)
  const get = (type: string) => parts.find((part) => part.type === type)!.value
  return `${get('year')}-${get('month')}-${get('day')}`
}
export function addDays(value: string, days: number): string {
  const date = dateValue(value)
  date.setUTCDate(date.getUTCDate() + days)
  return dateKey(date)
}
export function weekday(value: string): number { return (dateValue(value).getUTCDay() + 6) % 7 }
export function monthRange(month: string): DateRange {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error('Μη έγκυρος μήνας.')
  const start = `${month}-01`
  const next = dateValue(start)
  next.setUTCMonth(next.getUTCMonth() + 1)
  return { start, end: dateKey(next) }
}
export function daysInRange(range: DateRange): string[] {
  dateValue(range.start); dateValue(range.end)
  if (range.start >= range.end) return []
  const days = Math.round((dateValue(range.end).getTime() - dateValue(range.start).getTime()) / 86400000)
  if (days > 62) throw new Error('Η περίοδος υπερβαίνει τις 62 ημέρες.')
  return Array.from({ length: days }, (_, index) => addDays(range.start, index))
}
export function weekRange(anchor: string): DateRange {
  const start = addDays(anchor, -weekday(anchor))
  return { start, end: addDays(start, 7) }
}
export function calendarRange(anchor: string): DateRange {
  const month = monthRange(anchor.slice(0, 7))
  const start = weekRange(month.start).start
  return { start, end: weekRange(addDays(month.end, -1)).end }
}
export function movePeriod(anchor: string, view: ScheduleView, direction: number): string {
  if (view === 'week') return addDays(anchor, direction * 7)
  const date = dateValue(anchor)
  const day = date.getUTCDate()
  date.setUTCDate(1); date.setUTCMonth(date.getUTCMonth() + direction)
  const last = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate()
  date.setUTCDate(Math.min(day, last))
  return dateKey(date)
}
export function formatScheduleDate(value: string, long = false): string {
  return dateValue(value).toLocaleDateString('el-GR', long
    ? { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }
    : { timeZone: 'UTC', day: '2-digit', month: '2-digit', year: 'numeric' })
}

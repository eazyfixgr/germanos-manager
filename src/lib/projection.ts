export interface PointEntry {
  date: string
  points: number
}

export interface ShiftDay {
  date: string
  shift_type: string
}

const OFF_DAYS = new Set(['repo', 'adeia'])

function pad(n: number) {
  return String(n).padStart(2, '0')
}

function ymd(d: Date) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** Εργάσιμες ημέρες από το πρόγραμμα (εξαιρούν ρεπό/άδεια). Fallback: Δευτέρα–Σάββατο. */
export function workingDays(month: string, shifts: ShiftDay[]): string[] {
  const [y, m] = month.split('-').map(Number)
  const daysInMonth = new Date(y, m, 0).getDate()
  const scheduled = shifts
    .filter((s) => s.date.slice(0, 7) === month && !OFF_DAYS.has(s.shift_type))
    .map((s) => s.date)

  if (scheduled.length > 0) return [...new Set(scheduled)]

  const days: string[] = []
  for (let d = 1; d <= daysInMonth; d++) {
    const dt = new Date(y, m - 1, d)
    if (dt.getDay() !== 0) days.push(`${y}-${pad(m)}-${pad(d)}`)
  }
  return days
}

/**
 * Projection = (σύνολο πόντων ÷ εργάσιμες που πέρασαν) × σύνολο εργάσιμων μήνα.
 */
export function computeProjection(
  entries: PointEntry[],
  shifts: ShiftDay[],
  month: string,
  today: Date = new Date(),
) {
  const days = workingDays(month, shifts)
  const totalWorking = days.length
  const todayStr = ymd(today)
  const elapsed = days.filter((d) => d <= todayStr).length
  const total = entries
    .filter((e) => e.date.slice(0, 7) === month)
    .reduce((sum, e) => sum + Number(e.points || 0), 0)
  const projection = elapsed > 0 ? Math.round((total / elapsed) * totalWorking) : 0
  return { total, projection, elapsed, totalWorking }
}

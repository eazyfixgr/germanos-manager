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

export function parseFallbackDays(s?: string | null): number[] {
  const def = [1, 2, 3, 4, 5, 6]
  if (!s) return def
  const arr = s
    .split(',')
    .map((x) => Number(x.trim()))
    .filter((n) => Number.isInteger(n) && n >= 1 && n <= 7)
  return arr.length > 0 ? arr : def
}

/** Εργάσιμες ημέρες από το πρόγραμμα (εξαιρούν ρεπό/άδεια). Fallback: ρυθμίσιμες ημέρες. */
export function workingDays(
  month: string,
  shifts: ShiftDay[],
  fallbackDays: number[] = [1, 2, 3, 4, 5, 6],
): string[] {
  const [y, m] = month.split('-').map(Number)
  const daysInMonth = new Date(y, m, 0).getDate()
  const scheduled = shifts
    .filter((s) => s.date.slice(0, 7) === month && !OFF_DAYS.has(s.shift_type))
    .map((s) => s.date)

  if (scheduled.length > 0) return [...new Set(scheduled)]

  const days: string[] = []
  for (let d = 1; d <= daysInMonth; d++) {
    const dt = new Date(y, m - 1, d)
    const wd = dt.getDay() === 0 ? 7 : dt.getDay()
    if (fallbackDays.includes(wd)) days.push(`${y}-${pad(m)}-${pad(d)}`)
  }
  return days
}

/** Εργάσιμες ημέρες καταστήματος από το ημερολόγιο, αλλιώς fallback. */
export function storeWorkingDays(
  month: string,
  calendar: { date: string; is_working: boolean }[],
  fallbackDays: number[],
): string[] {
  const rows = calendar.filter((c) => c.date.slice(0, 7) === month)
  if (rows.length > 0) return rows.filter((c) => c.is_working).map((c) => c.date)
  return workingDays(month, [], fallbackDays)
}

/**
 * Projection = (σύνολο πόντων ÷ εργάσιμες που πέρασαν) × σύνολο εργάσιμων μήνα.
 */
export function computeProjection(
  entries: PointEntry[],
  shifts: ShiftDay[],
  month: string,
  today: Date = new Date(),
  fallbackDays: number[] = [1, 2, 3, 4, 5, 6],
) {
  const days = workingDays(month, shifts, fallbackDays)
  const totalWorking = days.length
  const todayStr = ymd(today)
  const elapsed = days.filter((d) => d <= todayStr).length
  const total = entries
    .filter((e) => e.date.slice(0, 7) === month)
    .reduce((sum, e) => sum + Number(e.points || 0), 0)
  const projection = elapsed > 0 ? Math.round((total / elapsed) * totalWorking) : 0
  return { total, projection, elapsed, totalWorking }
}

export interface CategoryStats {
  progress: number
  target: number
  achievement: number | null
  projection: number | null
  deviation: number | null
  requiredDaily: number | null
  elapsed: number
  totalWorking: number
  remaining: number
}

function roundUnit(v: number, unit: 'count' | 'currency') {
  return unit === 'currency' ? Math.round(v * 100) / 100 : Math.round(v)
}

export function calcCategoryStats(
  progress: number,
  target: number,
  workDays: string[],
  today: Date = new Date(),
  unit: 'count' | 'currency' = 'count',
): CategoryStats {
  const todayStr = ymd(today)
  const totalWorking = workDays.length
  const elapsed = workDays.filter((d) => d <= todayStr).length
  const remaining = workDays.filter((d) => d > todayStr).length

  const achievement = target > 0 ? (progress / target) * 100 : null
  const rawProjection = elapsed > 0 ? (progress / elapsed) * totalWorking : null
  const projection = rawProjection == null ? null : roundUnit(rawProjection, unit)
  const deviation =
    projection == null || target <= 0
      ? null
      : unit === 'currency'
        ? Math.round((projection - target) * 100) / 100
        : Math.round(projection - target)

  let requiredDaily: number | null = null
  if (target > 0 && remaining > 0) {
    const r = (target - progress) / remaining
    requiredDaily = r <= 0 ? 0 : unit === 'currency' ? Math.round(r * 100) / 100 : Math.ceil(r)
  }

  return {
    progress,
    target,
    achievement,
    projection,
    deviation,
    requiredDaily,
    elapsed,
    totalWorking,
    remaining,
  }
}

import { describe, it, expect } from 'vitest'
import { buildSchedule, type SchedulePattern, type ScheduleEmployee } from '../scheduleGen'

const patterns: SchedulePattern[] = [
  { weekday: 1, closed: false, level: 'split', start_time: '09:00', end_time: '21:00' },
  { weekday: 2, closed: false, level: 'short', start_time: '09:00', end_time: '15:00' },
  { weekday: 3, closed: false, level: 'split', start_time: '09:00', end_time: '21:00' },
  { weekday: 4, closed: false, level: 'short', start_time: '09:00', end_time: '15:00' },
  { weekday: 5, closed: false, level: 'split', start_time: '09:00', end_time: '21:00' },
  { weekday: 6, closed: false, level: 'short', start_time: '09:00', end_time: '15:00' },
  { weekday: 7, closed: true, level: 'full', start_time: null, end_time: null },
]

function employees(n: number): ScheduleEmployee[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `u${i + 1}`,
    full_name: `User ${String(i + 1).padStart(2, '0')}`,
  }))
}

function run(
  month: string,
  emps: ScheduleEmployee[],
  options?: {
    leaves?: Parameters<typeof buildSchedule>[0]['leaves']
    minStaff?: number
    calendar?: Parameters<typeof buildSchedule>[0]['calendar']
  },
) {
  return buildSchedule({
    storeId: 'store',
    month,
    employees: emps,
    patterns,
    calendar: options?.calendar ?? [],
    leaves: options?.leaves ?? [],
    minStaff: options?.minStaff ?? 1,
  })
}

describe('buildSchedule', () => {
  it('gives one rolling day off per employee per full week', () => {
    const emps = employees(3)
    const result = run('2026-11', emps)
    for (const emp of emps) {
      const repos = result.shifts.filter((s) => s.user_id === emp.id && s.shift_type === 'repo')
      expect(repos).toHaveLength(4)
    }
    expect(result.warnings).toHaveLength(0)
  })

  it('prefers a pending repo request when staffing allows it', () => {
    const emps = employees(3)
    const result = run('2026-11', emps, {
      leaves: [{
        user_id: 'u1', type: 'repo',
        start_date: '2026-11-04', end_date: '2026-11-04', status: 'pending',
      }],
    })
    const u1Week = result.shifts
      .filter((s) => s.user_id === 'u1' && s.date >= '2026-11-02' && s.date <= '2026-11-08' && s.shift_type === 'repo')
      .map((s) => s.date)
    expect(u1Week).toEqual(['2026-11-04'])
  })

  it('does not force a pending repo request when staffing prevents a day off', () => {
    const result = run('2026-11', employees(1), {
      minStaff: 1,
      leaves: [{
        user_id: 'u1', type: 'repo',
        start_date: '2026-11-04', end_date: '2026-11-04', status: 'pending',
      }],
    })
    const nov4 = result.shifts.find((s) => s.user_id === 'u1' && s.date === '2026-11-04')
    expect(nov4?.shift_type).not.toBe('repo')
  })

  it('keeps an approved repo as a binding day off', () => {
    const result = run('2026-11', employees(3), {
      leaves: [{
        user_id: 'u1', type: 'repo',
        start_date: '2026-11-04', end_date: '2026-11-04', status: 'approved',
      }],
    })
    const nov4 = result.shifts.find((s) => s.user_id === 'u1' && s.date === '2026-11-04')
    expect(nov4?.shift_type).toBe('repo')
  })

  it('respects minimum staffing and reports when a day off cannot be assigned', () => {
    const result = run('2026-11', employees(1), { minStaff: 1 })
    expect(result.shifts.filter((s) => s.shift_type === 'repo')).toHaveLength(0)
    expect(result.warnings.length).toBeGreaterThan(0)
  })

  it('allows a day off when minimum staffing is zero', () => {
    const result = run('2026-11', employees(1), { minStaff: 0 })
    expect(result.shifts.filter((s) => s.shift_type === 'repo')).toHaveLength(4)
  })

  it('balances split-day days off across employees over the month', () => {
    const emps = employees(6)
    const result = run('2026-11', emps)
    for (const emp of emps) {
      const f = result.fairness.find((x) => x.user_id === emp.id)
      expect(f?.split_offs).toBe(2)
      expect(f?.short_offs).toBe(2)
    }
  })

  it('assigns each shared-boundary week to the month with the majority of days', () => {
    const emps = employees(3)
    const result = run('2026-10', emps)
    for (const emp of emps) {
      const repos = result.shifts.filter((s) => s.user_id === emp.id && s.shift_type === 'repo')
      expect(repos).toHaveLength(5)
    }
  })

  it('does not create shifts on a closed Sunday', () => {
    const result = run('2026-11', employees(3))
    expect(result.shifts.filter((s) => s.date === '2026-11-01')).toHaveLength(0)
  })

  it('opens a Sunday when the store calendar overrides it', () => {
    const result = run('2026-11', employees(3), {
      calendar: [{
        date: '2026-11-01', is_working: true, open_time: '09:00', close_time: '21:00',
      }],
    })
    const sunday = result.shifts.filter((s) => s.date === '2026-11-01')
    expect(sunday).toHaveLength(3)
    expect(sunday.every((s) => s.shift_type === 'full')).toBe(true)
  })

  it('uses the pattern type and times for working shifts', () => {
    const result = run('2026-11', employees(3))
    const monday = result.shifts.filter((s) => s.date === '2026-11-02' && s.shift_type !== 'repo')
    expect(monday.length).toBeGreaterThan(0)
    for (const shift of monday) {
      expect(shift.shift_type).toBe('split')
      expect(shift.start_time).toBe('09:00')
      expect(shift.end_time).toBe('21:00')
    }
  })
})

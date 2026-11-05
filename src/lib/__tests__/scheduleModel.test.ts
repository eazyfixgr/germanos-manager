import { describe, expect, it } from 'vitest'
import { addDays, calendarRange, daysInRange, formatScheduleDate, monthRange, movePeriod, todayInAthens, weekRange } from '../schedule/dates'
import { buildDay, shiftHours, type ScheduleData } from '../schedule/model'
import type { LeaveRequest, Shift } from '../types'

const empty: ScheduleData = { store_id: 'store', start: '2026-11-01', end: '2026-12-01', scope: 'team', can_manage: true, min_staff: 1,
  staff: [{ id: 'one', full_name: 'Πρώτος', active: true }], shifts: [], leaves: [], patterns: [], calendar: [] }
const shift: Shift = { id: 's', store_id: 'store', user_id: 'one', date: '2026-11-02', shift_type: 'full', start_time: '09:00', end_time: '15:00', note: null }

describe('schedule date keys', () => {
  it('uses Athens day at UTC midnight boundaries and handles daylight-saving transitions', () => {
    expect(todayInAthens(new Date('2026-11-05T22:30:00Z'))).toBe('2026-11-06')
    expect(addDays('2026-03-28', 1)).toBe('2026-03-29')
    expect(addDays('2026-03-29', 1)).toBe('2026-03-30')
    expect(formatScheduleDate('2026-11-02')).toBe('02/11/2026')
  })
  it('spans full Monday–Sunday calendar rows across month/year boundaries', () => {
    expect(weekRange('2026-11-01')).toEqual({ start: '2026-10-26', end: '2026-11-02' })
    const range = calendarRange('2026-11-05')
    expect(range).toEqual({ start: '2026-10-26', end: '2026-12-07' })
    expect(daysInRange(range)).toHaveLength(42)
    expect(monthRange('2026-12').end).toBe('2027-01-01')
  })
  it('clamps month navigation to real dates and rejects impossible dates', () => {
    expect(movePeriod('2024-01-31', 'month', 1)).toBe('2024-02-29')
    expect(movePeriod('2026-12-31', 'month', 1)).toBe('2027-01-31')
    expect(() => addDays('2026-02-30', 1)).toThrow()
    expect(() => daysInRange({ start: '2026-01-01', end: '2027-01-01' })).toThrow()
  })
})

describe('schedule day semantics', () => {
  it('never turns an absent assignment or an unknown opening into a day off', () => {
    const day = buildDay(empty, '2026-11-02')
    expect(day.opening).toBe('unknown')
    expect(day.rows[0].status).toBe('unassigned')
    expect(day.away).toHaveLength(0)
  })
  it('distinguishes a closed day from repo and respects an open-Sunday calendar override', () => {
    const data: ScheduleData = { ...empty, patterns: [{ store_id: 'store', weekday: 7, closed: true, level: 'full', start_time: null, end_time: null, note: null }] }
    expect(buildDay(data, '2026-11-01').rows[0].status).toBe('closed')
    const day = buildDay({ ...data, calendar: [{ id: 'c', store_id: 'store', date: '2026-11-01', is_working: true,
      open_time: '10:00', close_time: '16:00', note: null }] }, '2026-11-01')
    expect(day.opening).toBe('open')
    expect(day.hours).toBe('10:00–16:00')
  })
  it('surfaces approved absence conflicts while pending requests do not become binding absences', () => {
    const leave: LeaveRequest = { id: 'l', store_id: 'store', user_id: 'one', type: 'adeia', start_date: '2026-11-02',
      end_date: '2026-11-03', status: 'pending', reason: null, reviewed_by: null, created_at: '' }
    expect(buildDay({ ...empty, shifts: [shift], leaves: [leave] }, shift.date).working).toHaveLength(1)
    const day = buildDay({ ...empty, shifts: [shift], leaves: [{ ...leave, status: 'approved' }] }, shift.date)
    expect(day.working).toHaveLength(0)
    expect(day.away[0]).toMatchObject({ status: 'adeia', conflict: true })
    expect(day.issues.length).toBeGreaterThan(0)
  })
  it('labels legacy split spans honestly and orders groups by their actual first start time', () => {
    expect(shiftHours({ ...shift, shift_type: 'split', end_time: '21:00' })).toContain('εύρος σπαστού')
    const day = buildDay({ ...empty, staff: [...empty.staff, { id: 'two', full_name: 'Δεύτερος', active: true }],
      shifts: [{ ...shift, start_time: '15:00', shift_type: 'close' }, { ...shift, id: 's2', user_id: 'two', start_time: '09:00' }] }, shift.date)
    expect(day.groups.map((group) => group.type)).toEqual(['full', 'close'])
  })
  it('surfaces a shift extending outside explicitly configured opening hours', () => {
    const day = buildDay({ ...empty, patterns: [{ store_id: 'store', weekday: 1, closed: false, level: 'short', start_time: '09:00', end_time: '15:00', note: null }],
      shifts: [{ ...shift, start_time: '15:00', end_time: '21:00' }] }, shift.date)
    expect(day.working[0].hoursIssue).toBe(true)
    expect(day.issues.some((issue) => issue.includes('εκτός ωραρίου'))).toBe(true)
  })
})

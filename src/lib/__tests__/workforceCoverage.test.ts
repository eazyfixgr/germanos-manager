import { describe, expect, it } from 'vitest'
import { buildDay, type ScheduleData } from '../schedule/model'
import { segmentHours, validSegments } from '../schedule/intervals'
import type { Shift } from '../types'

const split = [{ start: '09:00', end: '13:00' }, { start: '17:00', end: '21:00' }]
const base: ScheduleData = { store_id: 'store', start: '2026-11-01', end: '2026-12-01', scope: 'team', can_manage: true, min_staff: 0,
  staff: [{ id: 'one', full_name: 'One', active: true }], shifts: [], leaves: [], calendar: [],
  patterns: [{ store_id: 'store', weekday: 1, closed: false, level: 'full', start_time: '09:00', end_time: '21:00', note: null }],
  requirements: [{ id: 'r', store_id: 'store', template_code: null, weekday: 1, start_time: '09:00', end_time: '21:00', minimum: 1, valid_from: '2026-11-01', valid_to: null, revision: 1 }] }
const shift: Shift = { id: 's', store_id: 'store', user_id: 'one', date: '2026-11-02', shift_type: 'split',
  start_time: '09:00', end_time: '21:00', segments: split, note: null }

describe('real interval coverage', () => {
  it('counts eight real hours, never the twelve-hour outer split span', () => {
    expect(segmentHours(split)).toBe(8)
    const coverage = buildDay({ ...base, shifts: [shift] }, shift.date).coverage!
    expect(coverage.status).toBe('missing')
    expect(coverage.gaps).toEqual([{ start: '13:00', end: '17:00', required: 1, actual: 0, templateCode: null }])
  })
  it('handles exact adjacent handoffs without a gap or double count', () => {
    const day = buildDay({ ...base, staff: [...base.staff, { id: 'two', full_name: 'Two', active: true }], shifts: [
      { ...shift, shift_type: 'full', end_time: '15:00', segments: [{ start: '09:00', end: '15:00' }] },
      { ...shift, id: 's2', user_id: 'two', shift_type: 'close', start_time: '15:00', segments: [{ start: '15:00', end: '21:00' }] },
    ] }, shift.date)
    expect(day.coverage?.status).toBe('covered')
    expect(day.coverage?.gaps).toHaveLength(0)
  })
  it('keeps unresolved legacy splits unknown and excludes approved leave from available staff', () => {
    expect(buildDay({ ...base, shifts: [{ ...shift, segments: null }] }, shift.date).coverage?.status).toBe('unknown')
    const day = buildDay({ ...base, shifts: [shift], leaves: [{ id: 'l', store_id: 'store', user_id: 'one', type: 'adeia',
      start_date: shift.date, end_date: shift.date, status: 'approved', reason: null, reviewed_by: null, created_at: '' }] }, shift.date)
    expect(day.working).toHaveLength(0)
    expect(day.coverage?.gaps[0].actual).toBe(0)
  })
  it('does not call an incompletely specified day covered', () => {
    const day = buildDay({ ...base, shifts: [{ ...shift, shift_type: 'full', end_time: '15:00', segments: [{ start: '09:00', end: '15:00' }] }],
      requirements: [{ ...base.requirements![0], end_time: '15:00' }] }, shift.date)
    expect(day.coverage?.status).toBe('partial')
  })
  it('honors requirement effective dates and explicit template-code constraints', () => {
    expect(buildDay({ ...base, shifts: [shift], requirements: [{ ...base.requirements![0], valid_from: '2026-11-03' }] }, shift.date).coverage?.status).toBe('unknown')
    const day = buildDay({ ...base, shifts: [{ ...shift, shift_type: 'full', segments: [{ start: '09:00', end: '21:00' }], template_code: 'other' }],
      requirements: [{ ...base.requirements![0], template_code: 'morning' }] }, shift.date)
    expect(day.coverage?.gaps[0].actual).toBe(0)
  })
  it('never evaluates team staffing from only the personal view', () => {
    expect(buildDay({ ...base, scope: 'own', shifts: [shift] }, shift.date).coverage?.status).toBe('unknown')
  })
  it('rejects invalid clocks and overlapping intervals before a form save', () => {
    expect(validSegments([{ start: '09:00', end: '14:00' }, { start: '13:59', end: '17:00' }])).toBe(false)
    expect(validSegments([{ start: '24:00', end: '25:00' }])).toBe(false)
    expect(validSegments(split)).toBe(true)
  })
})

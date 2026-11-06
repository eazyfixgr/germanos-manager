import type { LeaveRequest, StoreCalendarDay, StorePattern, Shift } from '../types'
import { dateValue } from './dates'

export type LeaveDisposition = 'charged_leave' | 'approved_rest' | 'requested_rest' | 'preexisting_rest' | 'closed'
export interface LeaveDayEstimate { date: string; disposition: LeaveDisposition; reason: string }
export function estimateLeaveDays(input: {
  storeId: string; type: 'repo' | 'adeia'; start: string; end: string; selectedRests?: string[]
  patterns: StorePattern[]; calendar: StoreCalendarDay[]; shifts: Shift[]
}): LeaveDayEstimate[] {
  dateValue(input.start); dateValue(input.end)
  const span = Math.round((dateValue(input.end).getTime() - dateValue(input.start).getTime()) / 86400000) + 1
  if (span < 1 || span > 90) throw new Error('Επιλέξτε διάστημα έως 90 συνεχόμενων ημερών.')
  const chosen = new Set(input.selectedRests ?? [])
  return Array.from({ length: span }, (_, index) => {
    const date = new Date(dateValue(input.start).getTime() + index * 86400000).toISOString().slice(0, 10)
    const weekday = (dateValue(date).getUTCDay() + 6) % 7 + 1
    const calendar = input.calendar.find((row) => row.store_id === input.storeId && row.date === date)
    const pattern = input.patterns.find((row) => row.store_id === input.storeId && row.weekday === weekday)
    const open = calendar ? calendar.is_working : pattern ? !pattern.closed : weekday !== 7
    if (!open) return { date, disposition: 'closed', reason: calendar?.note || 'Κλειστό κατάστημα' }
    const existing = input.shifts.find((shift) => shift.store_id === input.storeId && shift.date === date && shift.shift_type === 'repo')
    if (existing) return { date, disposition: 'preexisting_rest', reason: 'Υπάρχει ήδη προγραμματισμένο ρεπό' }
    if (input.type === 'repo') return { date, disposition: 'approved_rest', reason: 'Αίτημα ρεπό' }
    if (chosen.has(date)) return { date, disposition: 'requested_rest', reason: 'Προτεινόμενο πρόσθετο ρεπό' }
    return { date, disposition: 'charged_leave', reason: 'Εργάσιμη ημέρα άδειας' }
  })
}
export function leaveLedgerSummary(leave: LeaveRequest) {
  if (leave.status === 'approved' && leave.ledger) return {
    charged: leave.ledger.filter((day) => day.disposition === 'charged_leave').length,
    excluded: leave.ledger.filter((day) => day.disposition !== 'charged_leave').length,
    days: leave.ledger,
  }
  return { charged: null, excluded: null, days: [] as NonNullable<LeaveRequest['ledger']> }
}

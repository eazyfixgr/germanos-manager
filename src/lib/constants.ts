import type { OrderStatus, ShiftType } from './types'

export const ORDER_STATUS: Record<OrderStatus, { label: string; color: string }> = {
  new: { label: 'Νέα παραγγελία', color: 'bg-blue-100 text-blue-800' },
  ordered: { label: 'Σε παραγγελία (αποθήκη)', color: 'bg-purple-100 text-purple-800' },
  in_transit: { label: 'Σε παραλαβή', color: 'bg-amber-100 text-amber-800' },
  received: { label: 'Παρελήφθη — αναμονή', color: 'bg-orange-100 text-orange-800' },
  ready: { label: 'Έτοιμο — ενημέρωση πελάτη', color: 'bg-cyan-100 text-cyan-800' },
  notified: { label: 'Ενημερώθηκε ο πελάτης', color: 'bg-teal-100 text-teal-800' },
  completed: { label: 'Ολοκληρώθηκε', color: 'bg-green-100 text-green-800' },
  cancelled: { label: 'Ακυρώθηκε', color: 'bg-red-100 text-red-800' },
}

export const ORDER_FLOW: OrderStatus[] = [
  'new',
  'ordered',
  'in_transit',
  'received',
  'ready',
  'notified',
  'completed',
]

export const SHIFT_TYPE: Record<ShiftType, { label: string; color: string }> = {
  open: { label: 'Άνοιγμα', color: 'bg-blue-100 text-blue-800' },
  mid: { label: 'Μεσαία βάρδια', color: 'bg-green-100 text-green-800' },
  close: { label: 'Κλείσιμο', color: 'bg-purple-100 text-purple-800' },
  custom: { label: 'Προσαρμοσμένο', color: 'bg-gray-100 text-gray-800' },
  repo: { label: 'Ρεπό', color: 'bg-red-100 text-red-800' },
  adeia: { label: 'Άδεια', color: 'bg-orange-100 text-orange-800' },
  split: { label: 'Σπαστό', color: 'bg-indigo-100 text-indigo-800' },
  short: { label: 'Βραχεία (έως 15:00)', color: 'bg-lime-100 text-lime-800' },
  full: { label: 'Πλήρης', color: 'bg-sky-100 text-sky-800' },
}

export function currentMonth(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export function monthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number)
  const names = [
    'Ιανουάριος', 'Φεβρουάριος', 'Μάρτιος', 'Απρίλιος', 'Μάιος', 'Ιούνιος',
    'Ιούλιος', 'Αύγουστος', 'Σεπτέμβριος', 'Οκτώβριος', 'Νοέμβριος', 'Δεκέμβριος',
  ]
  return `${names[(m || 1) - 1]} ${y}`
}

export function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('el-GR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
  })
}

export function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString('el-GR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

export function fmtNum(n: number): string {
  return new Intl.NumberFormat('el-GR').format(n)
}

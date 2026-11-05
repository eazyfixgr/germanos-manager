import { downloadCsv } from '../csv'
import { buildDay, shiftHours, shiftLabel, type ScheduleData } from './model'
import { WEEKDAYS, weekday } from './dates'

function spreadsheetText(value: string) { return /^[\s]*[=+@-]/.test(value) ? `'${value}` : value }
export function exportSchedule(data: ScheduleData, dates: string[]) {
  const rows = dates.flatMap((date) => buildDay(data, date, data.min_staff).rows.map((row) => [
    date, WEEKDAYS[weekday(date)], row.person.full_name,
    row.status === 'work' ? shiftLabel(row.shift?.shift_type) : shiftLabel(row.status),
    row.status === 'work' ? shiftHours(row.shift) : '', row.conflict ? 'Ασυμφωνία με εγκεκριμένη απουσία' : '',
  ].map(spreadsheetText)))
  downloadCsv(`programma-${dates[0]}-${data.scope}.csv`, ['Ημερομηνία', 'Ημέρα', 'Εργαζόμενος', 'Κατάσταση / βάρδια', 'Αποθηκευμένες ώρες', 'Έλεγχος'], rows)
}

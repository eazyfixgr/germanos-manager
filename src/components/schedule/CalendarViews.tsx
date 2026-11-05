import { useRef } from 'react'
import type { ScheduleData, ScheduleDay } from '../../lib/schedule/model'
import { buildDay, shiftHours, shiftLabel, shiftStyle, shiftTone } from '../../lib/schedule/model'
import { formatScheduleDate, WEEKDAYS, weekday } from '../../lib/schedule/dates'
import './schedule.css'

const short: Record<string, string> = { open: 'Αν', mid: 'Μ', close: 'Κ', custom: 'Πρ', split: 'Σ', short: 'Βρ', full: 'Πλ' }

export function MonthCalendar({ dates, month, selected, today, days, onHighlight, onOpen }: {
  dates: string[]; month: string; selected: string; today: string; days: Map<string, ScheduleDay>
  onHighlight: (date: string) => void; onOpen: (date: string) => void
}) {
  const container = useRef<HTMLDivElement>(null)
  return <div ref={container} className="schedule-month" role="group" aria-label="Μηνιαίο ημερολόγιο βαρδιών">
    <div className="schedule-weekdays" aria-hidden="true">{WEEKDAYS.map((day) => <div key={day}><span className="hidden lg:inline">{day}</span><span className="lg:hidden">{day.slice(0, 3)}</span></div>)}</div>
    <div className="schedule-month-grid">
      {dates.map((date, index) => {
        const day = days.get(date)!
        const outside = date.slice(0, 7) !== month
        const title = `${formatScheduleDate(date, true)} · ${day.working.length} βάρδιες · ${day.away.length} απουσίες / ρεπό`
        return <button key={date} type="button" data-date={date} aria-label={title}
          aria-current={date === today ? 'date' : undefined} aria-pressed={date === selected}
          tabIndex={date === (dates.includes(selected) ? selected : dates[0]) ? 0 : -1}
          className={`schedule-day ${outside ? 'is-outside' : ''} ${day.opening === 'closed' ? 'is-closed' : ''} ${date === today ? 'is-today' : ''} ${date === selected ? 'is-selected' : ''}`}
          onFocus={() => onHighlight(date)} onClick={() => onOpen(date)}
          onKeyDown={(event) => {
            const moves: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7, Home: -weekday(date), End: 6 - weekday(date) }
            if (!(event.key in moves)) return
            const target = dates[index + moves[event.key]]
            if (target) { event.preventDefault(); container.current?.querySelector<HTMLElement>(`[data-date="${target}"]`)?.focus() }
          }}>
          <span className="schedule-day-top"><span className="schedule-day-number">{Number(date.slice(8))}</span>{date === today && <span className="schedule-today-label">Σήμερα</span>}</span>
          <span className="schedule-day-hours">{day.opening === 'closed' ? 'Κλειστό' : day.hours ? <><span className="hidden sm:inline">{day.hours}</span><span className="sm:hidden">{day.hours.replace(/:00/g, '')}</span></> : 'Ωράριο μη ορισμένο'}</span>
          {day.away.length > 0 && <span className="schedule-day-away"><span className="hidden sm:inline">{day.away.length} άδεια / ρεπό</span><span className="sm:hidden">{day.away.length} απ./ρεπό</span></span>}
          <span className="schedule-day-shifts">
            {day.groups.slice(0, 3).map((group) => <span key={group.type} style={shiftStyle(group.rows[0].shift)} className={`schedule-shift-mini ${shiftTone(group.rows[0].shift?.shift_type)}`} title={group.label}><span>{group.rows[0].shift?.template_short_label ?? short[group.type] ?? group.label.slice(0, 2)}</span><b>{group.rows.length}</b></span>)}
            {day.groups.length > 3 && <span className="schedule-more">+{day.groups.length - 3} τύποι</span>}
            {day.working.length === 0 && <span className="schedule-no-shift">{day.opening === 'closed' ? 'Χωρίς εργασία' : 'Χωρίς βάρδιες'}</span>}
          </span>
          <span className={`schedule-day-status ${day.issues.length || day.coverage?.status === 'missing' || day.coverage?.status === 'partial' ? 'has-issues' : day.coverage?.status === 'covered' ? 'is-covered' : ''}`}>
            {day.issues.length ? `${day.unassigned.length ? `${day.unassigned.length} χωρίς ανάθεση` : 'Χρειάζεται έλεγχο'}`
              : day.coverage?.status === 'covered' ? 'Κάλυψη αναγκών' : day.coverage?.status === 'missing' ? 'Ελλείψεις κάλυψης'
                : day.coverage?.status === 'partial' ? 'Έλεγχος αναγκών' : day.opening === 'closed' ? 'Κλειστή ημέρα'
                  : <><span className="hidden sm:inline">Κάλυψη μη αξιολογημένη</span><span className="sm:hidden">Κάλυψη —</span></>}
          </span>
          {day.pending > 0 && <span className="schedule-pending">{day.pending} εκκρεμείς αιτήσεις</span>}
        </button>
      })}
    </div>
  </div>
}

export function WeekCalendar({ dates, data, today, filter, onOpen, minStaff }: {
  dates: string[]; data: ScheduleData; today: string; filter: string; onOpen: (date: string) => void; minStaff: number
}) {
  const days = dates.map((date) => buildDay(data, date, minStaff))
  const people = data.staff.filter((person) => person.full_name.toLocaleLowerCase('el').includes(filter.trim().toLocaleLowerCase('el')))
  return <div className="schedule-week-scroll">
    <table className="schedule-week-table"><caption className="sr-only">Πρόγραμμα εβδομάδας ανά εργαζόμενο</caption>
      <thead><tr><th scope="col">Εργαζόμενος</th>{dates.map((date) => <th key={date} scope="col" className={date === today ? 'is-today' : ''}>
        <span>{WEEKDAYS[weekday(date)]}</span><b>{formatScheduleDate(date)}</b></th>)}</tr></thead>
      <tbody>{people.map((person) => <tr key={person.id}>
        <th scope="row"><b>{person.full_name}</b><span>{person.active ? 'Μέλος καταστήματος' : 'Ιστορικό περιόδου'}</span></th>
        {days.map((day) => {
          const row = day.rows.find((item) => item.person.id === person.id)
          const type = row?.status === 'work' ? row.shift?.shift_type : row?.status
          return <td key={day.date}><button type="button" className="schedule-week-cell" onClick={() => onOpen(day.date)} aria-label={`${person.full_name}, ${formatScheduleDate(day.date)}, ${shiftLabel(type)}`}>
            <span style={row?.status === 'work' ? shiftStyle(row.shift) : undefined} className={`inline-flex rounded-md px-2 py-1 text-[11px] font-semibold ${shiftTone(type)}`}>{row ? row.status === 'work' ? row.shift?.template_name ?? shiftLabel(type) : shiftLabel(type) : '—'}</span>
            {row?.status === 'work' && <small>{shiftHours(row.shift)}</small>}
            {row?.approved && <small>Εγκεκριμένη απουσία</small>}
            {row?.conflict && <small className="!text-amber-700">Ασυμφωνία βάρδιας</small>}
            {row?.hoursIssue && <small className="!text-amber-700">Έλεγχος ωραρίου</small>}
          </button></td>
        })}
      </tr>)}
        {people.length === 0 && <tr><td colSpan={8} className="!p-8 text-center text-muted">Δεν βρέθηκαν εργαζόμενοι για το φίλτρο.</td></tr>}
        <tr className="schedule-counts"><th scope="row">Σύνοψη ημέρας</th>{days.map((day) => <td key={day.date}><b>{day.working.length} βάρδιες</b><small>{day.away.length} άδεια / ρεπό</small><button type="button" onClick={() => onOpen(day.date)}>Ανάλυση ημέρας</button></td>)}</tr>
      </tbody>
    </table>
  </div>
}

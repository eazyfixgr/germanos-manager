import Dialog from '../Dialog'
import { Button } from '../ui'
import type { ScheduleDay, StaffDay } from '../../lib/schedule/model'
import { initials, shiftHours, shiftLabel, shiftStyle, shiftTone } from '../../lib/schedule/model'
import { resolvedSegments } from '../../lib/schedule/intervals'
import CoveragePanel from './CoveragePanel'
import { formatScheduleDate } from '../../lib/schedule/dates'

export default function DayReview({ day, canEdit, loading, onClose, onEdit, onRequests }: {
  day: ScheduleDay; canEdit: boolean; loading: boolean
  onClose: () => void; onEdit: (row: StaffDay) => void; onRequests: () => void
}) {
  function personRow(row: StaffDay) {
    return <div key={row.person.id} className="flex flex-wrap items-center justify-between gap-3 border-t border-line p-3">
      <div className="flex min-w-0 items-center gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-slate-100 text-[11px] font-bold text-slate-600">{initials(row.person.full_name)}</span>
        <div><div className="text-sm font-semibold">{row.person.full_name}</div>
          <div className="mt-1 text-[11px] text-muted">{row.status === 'work' ? shiftHours(row.shift) : shiftLabel(row.status)}{!row.person.active && ' · ιστορικό περιόδου'}</div>
          {row.approved && <div className="mt-1 text-[11px] text-rose-700">Εγκεκριμένη απουσία</div>}
          {row.conflict && <div className="mt-1 text-[11px] font-semibold text-amber-700">Η καταχωρημένη βάρδια διαφέρει από την έγκριση.</div>}
          {row.hoursIssue && <div className="mt-1 text-[11px] font-semibold text-amber-700">Οι ώρες χρειάζονται έλεγχο με το ωράριο καταστήματος.</div>}
          {row.approved?.reason && <p className="mt-1 max-w-md text-xs text-muted">{row.approved.reason}</p>}
        </div>
      </div>
      {canEdit && row.person.active && <Button type="button" variant="secondary" className="!px-2.5 !py-1.5 !text-xs"
        disabled={loading || Boolean(row.approved)} title={row.approved ? 'Η εγκεκριμένη απουσία διαχειρίζεται από τις Αιτήσεις.' : undefined}
        onClick={() => onEdit(row)}>{row.shift ? 'Αλλαγή βάρδιας' : 'Καταχώριση'}</Button>}
    </div>
  }
  const notWorking = day.rows.filter((row) => row.status === 'unassigned' || row.status === 'closed')
  return <Dialog open onClose={onClose} title="Πρόγραμμα ημέρας" size="xl"
    description={`${formatScheduleDate(day.date, true)} · ${day.opening === 'closed' ? 'Κλειστό κατάστημα' : day.hours ?? 'Ωράριο μη ορισμένο'}`}
    footer={<><Button type="button" variant="secondary" onClick={onRequests} disabled={loading}>Άδειες & ρεπό</Button><Button type="button" onClick={onClose}>Κλείσιμο</Button></>}>
    <div className="mb-5 grid grid-cols-2 gap-2 rounded-xl border border-line bg-slate-50 p-3 sm:grid-cols-4">
      {[['Βάρδιες', day.working.length], ['Άδειες / ρεπό', day.away.length], ['Χωρίς ανάθεση', day.unassigned.length], ['Εκκρεμή αιτήματα', day.pending]].map(([label, value]) =>
        <div key={label} className="rounded-lg border border-line bg-white p-3 text-center"><b className="text-xl">{value}</b><span className="mt-1 block text-[10px] text-muted">{label}</span></div>)}
    </div>
    <CoveragePanel day={day} />
    {day.issues.length > 0 && <div className="mb-4 rounded-control border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900"><strong>Σημεία για έλεγχο</strong><ul className="mt-1 list-inside list-disc space-y-1">{day.issues.map((issue) => <li key={issue}>{issue}</li>)}</ul></div>}
    <div className="grid items-start gap-4 lg:grid-cols-[1.3fr_1fr]">
      <section className="rounded-xl border border-line p-4">
        <h3 className="text-sm font-bold">Προγραμματισμένες βάρδιες</h3><p className="mt-1 text-xs text-muted">Με σειρά αποθηκευμένης ώρας έναρξης</p>
        {day.groups.length === 0 && <p className="mt-4 rounded-lg bg-slate-50 p-5 text-center text-sm text-muted">Δεν έχουν καταχωρηθεί βάρδιες.</p>}
        {day.groups.map((group) => <div key={group.type} className="mt-3 overflow-hidden rounded-xl border border-line">
          <div className="flex items-center justify-between gap-2 bg-slate-50 p-3"><span style={shiftStyle(group.rows[0].shift)} className={`rounded-md px-2 py-1 text-[11px] font-semibold ${shiftTone(group.rows[0].shift?.shift_type)}`}>{group.label}</span><span className="text-xs text-muted">{group.rows.length} {group.rows.length === 1 ? 'άτομο' : 'άτομα'}</span></div>
          {group.rows.map(personRow)}
        </div>)}
      </section>
      <div className="space-y-4">
        <section className="rounded-xl border border-rose-100 bg-rose-50/30 p-4"><h3 className="text-sm font-bold">Απουσίες & ρεπό</h3>
          {day.away.length ? <div className="mt-3 overflow-hidden rounded-xl border border-rose-100 bg-white">{day.away.map(personRow)}</div> : <p className="mt-3 text-xs text-muted">Δεν υπάρχουν εγκεκριμένες απουσίες ή καταχωρημένα ρεπό.</p>}
        </section>
        {notWorking.length > 0 && <section className="rounded-xl border border-line p-4"><h3 className="text-sm font-bold">{day.opening === 'closed' ? 'Χωρίς βάρδια — κλειστό' : 'Χωρίς ανάθεση'}</h3>
          <div className="mt-3 overflow-hidden rounded-xl border border-line">{notWorking.map(personRow)}</div>
        </section>}
      </div>
    </div>
    {day.working.some((row) => row.shift?.shift_type === 'split' && resolvedSegments(row.shift) === null) && <p className="mt-4 rounded-control border border-blue-100 bg-blue-50/50 p-3 text-xs leading-relaxed text-slate-600">Στο παλιό σπαστό προβάλλεται μόνο το αποθηκευμένο εύρος. Συμπληρώστε τα δύο πραγματικά διαστήματα χωρίς να επινοήσετε ώρες.</p>}
  </Dialog>
}

import { useMemo, useState } from 'react'
import { useAuth } from '../lib/auth'
import { monthLabel } from '../lib/constants'
import { addDays, calendarRange, daysInRange, formatScheduleDate, monthRange, movePeriod, todayInAthens, weekRange, type ScheduleView } from '../lib/schedule/dates'
import { buildDay, shiftLabel, shiftTone, type ScheduleScope, type StaffDay } from '../lib/schedule/model'
import { useScheduleData } from '../lib/schedule/useScheduleData'
import { exportSchedule } from '../lib/schedule/export'
import { Button, Card, EmptyState, ErrorBox, Input, MetricCard, PageHeader, SuccessBox } from '../components/ui'
import { MonthCalendar, WeekCalendar } from '../components/schedule/CalendarViews'
import DayReview from '../components/schedule/DayReview'
import WorkforceSettings from '../components/schedule/WorkforceSettings'
import GenerationDialog from '../components/schedule/GenerationDialog'
import ShiftEditor from '../components/schedule/ShiftEditor'
import { LeaveRequestForm, LeaveRequests } from '../components/schedule/LeaveRequests'
import ScheduleIcon from '../components/schedule/ScheduleIcon'

export default function Schedule() {
  const { profile, store, isAdmin, isMaster } = useAuth()
  const [today] = useState(todayInAthens)
  const [cursor, setCursor] = useState(today)
  const [selected, setSelected] = useState(today)
  const [view, setView] = useState<ScheduleView>('month')
  const [scope, setScope] = useState<ScheduleScope>(isAdmin ? 'team' : 'own')
  const [filter, setFilter] = useState('')
  const [dayOpen, setDayOpen] = useState(false)
  const [requestsOpen, setRequestsOpen] = useState(false)
  const [newRequest, setNewRequest] = useState(false)
  const [patternOpen, setPatternOpen] = useState(false)
  const [generationOpen, setGenerationOpen] = useState(false)
  const [editing, setEditing] = useState<StaffDay | null>(null)
  const [success, setSuccess] = useState('')

  const period = view === 'month' ? monthRange(cursor.slice(0, 7)) : weekRange(cursor)
  const range = view === 'month' ? calendarRange(cursor) : period
  const dates = useMemo(() => daysInRange({ start: range.start, end: range.end }), [range.start, range.end])
  const periodDates = useMemo(() => daysInRange({ start: period.start, end: period.end }), [period.start, period.end])
  const { data, loading, error, reload } = useScheduleData(store?.id, range, scope)
  const days = useMemo(() => new Map(data ? dates.map((date) => [date, buildDay(data, date, data.min_staff)]) : []), [data, dates])
  const currentDays = periodDates.map((date) => days.get(date)).filter((day) => day !== undefined)
  const reviewDays = currentDays.filter((day) => day.issues.length > 0 || day.coverage?.status === 'missing' || day.coverage?.status === 'partial')
  const evaluated = currentDays.filter((day) => day.coverage?.status === 'covered' || day.coverage?.status === 'missing').length
  const covered = currentDays.filter((day) => day.coverage?.status === 'covered').length
  const canManage = isAdmin && data?.can_manage === true
  const canRequest = !isMaster && Boolean(data?.staff.some((person) => person.id === profile?.id && person.active))
  const selectedDay = days.get(selected)
  const pending = data?.leaves.filter((leave) => leave.status === 'pending' && leave.start_date < period.end && leave.end_date >= period.start
    && (canManage || leave.user_id === profile?.id)).length ?? 0

  function navigate(direction: number) {
    const next = movePeriod(cursor, view, direction)
    setCursor(next); setSelected(next); setSuccess('')
  }
  function openDay(date: string) {
    setSelected(date)
    if (view === 'month' && date.slice(0, 7) !== cursor.slice(0, 7)) setCursor(date)
    setDayOpen(true)
  }
  function saved(message: string) { setSuccess(message); reload() }

  if (!store) return <><PageHeader title="Πρόγραμμα εργασίας" subtitle="Βάρδιες, ρεπό και άδειες" /><Card><EmptyState title="Δεν έχει επιλεγεί κατάστημα" text="Επιλέξτε ένα από τα καταστήματα στα οποία έχετε πρόσβαση." /></Card></>

  return <div className="space-y-5">
    <PageHeader eyebrow="Διαχείριση προσωπικού" title="Πρόγραμμα εργασίας" subtitle={`${store.name} · ${data?.staff.filter((person) => person.active).length ?? '—'} ενεργά μέλη στην προβολή`}
      actions={<>
        <Button type="button" variant="secondary" onClick={() => setRequestsOpen(true)} disabled={!data || loading}><ScheduleIcon name="calendar" />Άδειες & ρεπό{pending ? ` (${pending})` : ''}</Button>
        <Button type="button" variant="secondary" onClick={() => data && exportSchedule(data, periodDates)} disabled={!data || loading}><ScheduleIcon name="download" />Εξαγωγή</Button>
        {canManage && <Button type="button" variant="secondary" onClick={() => setPatternOpen(true)} disabled={loading}><ScheduleIcon name="settings" />Ρυθμίσεις βαρδιών</Button>}
        {canManage ? <Button type="button" onClick={() => setGenerationOpen(true)} disabled={loading}><ScheduleIcon name="generate" />Δημιουργία προγράμματος</Button>
          : canRequest && <Button type="button" onClick={() => setNewRequest(true)} disabled={loading}><ScheduleIcon name="plus" />Νέα αίτηση</Button>}
      </>} />

    <ErrorBox message={error} />
    {error && <Button type="button" variant="secondary" onClick={reload}>Επανάληψη φόρτωσης</Button>}
    <SuccessBox message={success} />

    <div className="schedule-metrics grid grid-cols-2 gap-2 sm:gap-3 xl:grid-cols-4" aria-busy={loading}>
      <MetricCard label="Κάλυψη ημερών" value={evaluated ? `${covered} / ${evaluated}` : <span className="text-base sm:text-lg">Μη αξιολογημένη</span>} detail={evaluated ? 'Αξιολογημένες ημέρες με δηλωμένες ανάγκες' : 'Απαιτούνται ανάγκες και πραγματικά διαστήματα'} icon={<ScheduleIcon name="calendar" />} />
      <MetricCard label="Βάρδιες εργασίας" value={data ? currentDays.reduce((sum, day) => sum + day.working.length, 0) : '—'} detail="Χωρίς τις εγκεκριμένες απουσίες" icon={<ScheduleIcon name="people" />} />
      <MetricCard label="Ημέρες για έλεγχο" value={data ? reviewDays.length : '—'} detail="Αναθέσεις, ώρες και ασυμφωνίες" accent="amber" icon={<ScheduleIcon name="warning" />} />
      <MetricCard label="Ρεπό / άδειες" value={data ? currentDays.reduce((sum, day) => sum + day.away.length, 0) : '—'} detail="Ημέρες απουσίας · όχι χρέωση άδειας" accent="purple" icon={<ScheduleIcon name="clock" />} />
    </div>

    <section className="schedule-surface" aria-label="Προβολές προγράμματος" aria-busy={loading}>
      <div className="schedule-toolbar">
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="secondary" className="!px-2" aria-label="Προηγούμενη περίοδος" onClick={() => navigate(-1)}><ScheduleIcon name="left" /></Button>
          <Button type="button" variant="secondary" className="!px-2" aria-label="Επόμενη περίοδος" onClick={() => navigate(1)}><ScheduleIcon name="right" /></Button>
          <h2 className="mx-1 text-base font-bold tracking-tight">{view === 'month' ? monthLabel(cursor.slice(0, 7)) : `${formatScheduleDate(period.start)} – ${formatScheduleDate(addDays(period.end, -1))}`}</h2>
          <Button type="button" variant="secondary" className="!text-xs" onClick={() => { const date = todayInAthens(); setCursor(date); setSelected(date) }}>Σήμερα</Button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-control border border-line bg-slate-50 p-1" aria-label="Περίοδος προβολής">
            {([['month', 'Μήνας'], ['week', 'Εβδομάδα']] as const).map(([value, label]) => <button type="button" key={value} aria-pressed={view === value}
              onClick={() => { setCursor(selected); setView(value) }} className={`rounded-md px-3 py-2 text-xs font-semibold ${view === value ? 'bg-white text-ink shadow-sm' : 'text-muted'}`}>{label}</button>)}
          </div>
          <div className="w-40"><Input type="month" aria-label="Επιλογή μήνα" value={cursor.slice(0, 7)} onChange={(e) => {
            if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(e.target.value)) return
            const date = `${e.target.value}-01`; setCursor(date); setSelected(date)
          }} /></div>
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3 sm:px-5">
        <div className="flex gap-1 rounded-lg bg-slate-100 p-1" aria-label="Εύρος προσωπικού">
          {([['own', 'Το πρόγραμμά μου'], ['team', 'Ομάδα καταστήματος']] as const).map(([value, label]) => <button key={value} type="button" aria-pressed={scope === value} onClick={() => setScope(value)} className={`rounded-md px-3 py-2 text-xs font-semibold ${scope === value ? 'bg-white text-ink shadow-sm' : 'text-muted'}`}>{label}</button>)}
        </div>
        {view === 'week' && <div className="w-full sm:w-60"><Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Αναζήτηση εργαζομένου…" aria-label="Αναζήτηση εργαζομένου" /></div>}
        <p className="text-[11px] text-muted">Καταχωρημένο πρόγραμμα · επιλέξτε ημέρα για ανάλυση</p>
      </div>
      <div className="schedule-legend">{[...new Set(['split', 'full', 'short', 'repo', 'adeia', ...(data?.shifts.map((shift) => shift.shift_type) ?? [])])].map((type) => <span key={type} className={`rounded-md px-1.5 py-1 font-semibold ${shiftTone(type)}`}>{shiftLabel(type)}</span>)}<span>Η κενή καταχώριση σημαίνει «Χωρίς ανάθεση».</span></div>
      {!data ? loading ? <div role="status" className="flex min-h-72 items-center justify-center gap-3 text-sm text-muted"><span className="h-5 w-5 animate-spin rounded-full border-2 border-slate-200 border-t-brand" />Φόρτωση περιόδου…</div>
        : <EmptyState title="Το πρόγραμμα δεν είναι διαθέσιμο" text="Ελέγξτε το μήνυμα φόρτωσης και δοκιμάστε ξανά." />
        : view === 'month' ? <MonthCalendar dates={dates} month={cursor.slice(0, 7)} selected={selected} today={today} days={days} onHighlight={setSelected} onOpen={openDay} />
          : <WeekCalendar dates={dates} data={data} today={today} filter={filter} onOpen={openDay} minStaff={data.min_staff} />}
      <div className="flex flex-wrap justify-between gap-2 px-5 py-3 text-[11px] text-muted"><span>{scope === 'own' ? 'Προσωπική προβολή' : 'Προβολή ομάδας με περιορισμένα στοιχεία προσωπικού'}</span><span aria-live="polite">{loading ? 'Ενημέρωση…' : data ? 'Φορτώθηκε η επιλεγμένη περίοδος' : 'Δεν φορτώθηκαν δεδομένα'}</span></div>
    </section>

    {data && selectedDay && <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
      <Card><div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-sm font-bold">Σύνοψη επιλεγμένης ημέρας</h2><p className="mt-1 text-xs text-muted">{formatScheduleDate(selected, true)}</p></div><Button type="button" variant="secondary" className="!text-xs" onClick={() => openDay(selected)}>Ανάλυση ημέρας</Button></div>
        <div className="mt-4 grid grid-cols-3 gap-2">{[['Βάρδιες', selectedDay.working.length], ['Απουσίες / ρεπό', selectedDay.away.length], ['Χωρίς ανάθεση', selectedDay.unassigned.length]].map(([label, count]) => <div key={label} className="rounded-lg border border-line bg-slate-50 p-3"><b className="text-lg">{count}</b><span className="mt-1 block text-[10px] text-muted">{label}</span></div>)}</div>
        <div className="mt-3 flex flex-wrap gap-2">{selectedDay.working.slice(0, 6).map((row) => <span key={row.person.id} className="rounded-md bg-slate-100 px-2 py-1 text-[11px] text-slate-600">{row.person.full_name}</span>)}</div>
      </Card>
      <Card><h2 className="text-sm font-bold">Σημεία προσοχής</h2><p className="mt-1 text-xs text-muted">Ενδείξεις από τις καταχωρήσεις της περιόδου</p>
        {reviewDays.length === 0 ? <p className="mt-4 text-sm text-muted">Δεν εντοπίστηκαν ασυμφωνίες στις φορτωμένες αναθέσεις. Η χρονική κάλυψη παραμένει μη αξιολογημένη.</p>
          : <ul className="mt-3 space-y-3">{reviewDays.slice(0, 3).map((day) => <li key={day.date}><button type="button" onClick={() => openDay(day.date)} className="text-left text-xs leading-relaxed text-slate-600 hover:text-brand"><b>{formatScheduleDate(day.date)}</b> · {day.issues[0] ?? day.coverage?.label}</button></li>)}</ul>}
      </Card>
    </div>}

    {data && dayOpen && selectedDay && <DayReview day={selectedDay} canEdit={canManage} loading={loading} onClose={() => setDayOpen(false)} onEdit={setEditing} onRequests={() => setRequestsOpen(true)} />}
    {data && editing && canManage && <ShiftEditor key={`${editing.person.id}-${selected}`} storeId={store.id} date={selected} row={editing} templates={data.templates} closed={selectedDay?.opening === 'closed'} openingHours={selectedDay?.hours} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); saved('Η βάρδια αποθηκεύτηκε.') }} />}
    {data && requestsOpen && profile && <LeaveRequests data={data} range={period} actorId={profile.id} canManage={canManage} canRequest={canRequest} onClose={() => setRequestsOpen(false)} onNew={() => setNewRequest(true)} onChanged={() => saved('Η κατάσταση της αίτησης ενημερώθηκε.')} />}
    {newRequest && profile && canRequest && <LeaveRequestForm storeId={store.id} userId={profile.id} initialDate={selected} onClose={() => setNewRequest(false)} onSaved={() => { setNewRequest(false); saved('Η αίτηση υποβλήθηκε για έγκριση.') }} />}
    {data && patternOpen && canManage && <WorkforceSettings data={data} onClose={() => setPatternOpen(false)} onChanged={() => saved('Οι ρυθμίσεις ενημερώθηκαν.')} />}
    {generationOpen && canManage && <GenerationDialog storeId={store.id} month={cursor.slice(0, 7)} onClose={() => setGenerationOpen(false)} onSaved={(message) => { setGenerationOpen(false); saved(message) }} />}
  </div>
}

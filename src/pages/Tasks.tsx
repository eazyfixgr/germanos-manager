import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { currentMonth, fmtDate, monthLabel } from '../lib/constants'
import { parseFallbackDays, storeWorkingDays } from '../lib/projection'
import {
  DEFAULT_TEMPLATES, generateTaskPlan, type GenEmployee, type GenLeave, type GenShift,
} from '../lib/tasks'
import type {
  Profile, StoreCalendarDay, StoreTask, TaskRecurrence, TaskTemplate,
} from '../lib/types'
import { Button, Card, ErrorBox, Field, Input, Modal, PageHeader, Select, Spinner, SuccessBox, Textarea } from '../components/ui'

interface ShiftRow { user_id: string; date: string; shift_type: string }
interface LeaveRow { user_id: string; start_date: string; end_date: string }

const WEEKDAYS = [
  { v: 1, l: 'Δευ' }, { v: 2, l: 'Τρί' }, { v: 3, l: 'Τετ' }, { v: 4, l: 'Πέμ' },
  { v: 5, l: 'Παρ' }, { v: 6, l: 'Σάβ' }, { v: 7, l: 'Κυρ' },
]

function pad(n: number) { return String(n).padStart(2, '0') }
function todayStr() {
  const d = new Date()
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function statusBadge(status: string) {
  if (status === 'done') return 'bg-green-100 text-green-800'
  if (status === 'in_progress') return 'bg-blue-100 text-blue-800'
  return 'bg-amber-100 text-amber-800'
}
function statusLabel(status: string) {
  if (status === 'done') return 'Ολοκληρώθηκε'
  if (status === 'in_progress') return 'Σε εξέλιξη'
  return 'Εκκρεμεί'
}

const emptyTemplate = {
  title: '', category: '', recurrence: 'daily' as TaskRecurrence, weekdays: [1] as number[],
  month_day: 1, every_n: 1, due_time: '', requires_authorized: false,
}

export default function Tasks() {
  const { profile, store, isAdmin, isMaster } = useAuth()
  const [month, setMonth] = useState(currentMonth())
  const [selectedDate, setSelectedDate] = useState(todayStr())
  const [tasks, setTasks] = useState<StoreTask[]>([])
  const [templates, setTemplates] = useState<TaskTemplate[]>([])
  const [employees, setEmployees] = useState<Profile[]>([])
  const [shifts, setShifts] = useState<ShiftRow[]>([])
  const [leaves, setLeaves] = useState<LeaveRow[]>([])
  const [calendar, setCalendar] = useState<StoreCalendarDay[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [busy, setBusy] = useState(false)

  const [newTaskOpen, setNewTaskOpen] = useState(false)
  const [templatesOpen, setTemplatesOpen] = useState(false)
  const [newTask, setNewTask] = useState({
    title: '', category: '', assigned_user_id: '', scheduled_date: todayStr(),
    due_time: '', requires_authorized: false, notes: '',
  })
  const [tplForm, setTplForm] = useState({ ...emptyTemplate })

  const [start, next] = useMemo(() => {
    const [y, m] = month.split('-').map(Number)
    return [`${month}-01`, m === 12 ? `${y + 1}-01-01` : `${y}-${pad(m + 1)}-01`] as const
  }, [month])

  const fallbackDays = useMemo(() => parseFallbackDays(store?.fallback_work_days), [store?.fallback_work_days])
  const storeDays = useMemo(() => storeWorkingDays(month, calendar, fallbackDays), [month, calendar, fallbackDays])

  async function load() {
    if (!store) { setLoading(false); return }
    setLoading(true)
    setError('')
    const [tplRes, taskRes, empRes, shRes, lvRes, calRes] = await Promise.all([
      supabase.from('task_templates').select('*').eq('store_id', store.id).order('title'),
      supabase.from('store_tasks').select('*').eq('store_id', store.id)
        .gte('scheduled_date', start).lt('scheduled_date', next).order('scheduled_date'),
      supabase.from('profiles').select('*').eq('store_id', store.id)
        .eq('active', true).is('deleted_at', null).order('full_name'),
      supabase.from('shifts').select('user_id, date, shift_type').eq('store_id', store.id)
        .gte('date', start).lt('date', next),
      supabase.from('leave_requests').select('user_id, start_date, end_date').eq('store_id', store.id)
        .eq('status', 'approved'),
      supabase.from('store_calendar').select('*').eq('store_id', store.id)
        .gte('date', start).lt('date', next),
    ])
    setTemplates((tplRes.data as TaskTemplate[]) ?? [])
    setTasks((taskRes.data as StoreTask[]) ?? [])
    setEmployees((empRes.data as Profile[]) ?? [])
    setShifts((shRes.data as ShiftRow[]) ?? [])
    setLeaves((lvRes.data as LeaveRow[]) ?? [])
    setCalendar((calRes.data as StoreCalendarDay[]) ?? [])
    setLoading(false)
  }

  useEffect(() => { load() }, [store, month])

  const empName = (id: string | null) => employees.find((e) => e.id === id)?.full_name ?? '—'
  const myTasks = tasks.filter((t) => t.assigned_user_id === profile?.id && t.scheduled_date === selectedDate)
  const dayTasks = tasks.filter((t) => t.scheduled_date === selectedDate)
  const grouped = useMemo(() => {
    const map = new Map<string, StoreTask[]>()
    tasks.forEach((t) => {
      if (!map.has(t.scheduled_date)) map.set(t.scheduled_date, [])
      map.get(t.scheduled_date)!.push(t)
    })
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [tasks])

  async function toggleTask(t: StoreTask) {
    const done = t.status !== 'done'
    const { error } = await supabase.from('store_tasks').update({
      status: done ? 'done' : 'pending',
      completed_at: done ? new Date().toISOString() : null,
      completed_by: done ? profile?.id ?? null : null,
    }).eq('id', t.id)
    if (error) { setError(error.message); return }
    setTasks((prev) => prev.map((x) => (x.id === t.id
      ? { ...x, status: done ? 'done' : 'pending', completed_at: done ? new Date().toISOString() : null, completed_by: done ? profile?.id ?? null : null }
      : x)))
  }

  async function addTask(e: React.FormEvent) {
    e.preventDefault()
    if (!store || !profile) return
    setError(''); setSuccess('')
    if (!newTask.title.trim() || !newTask.assigned_user_id || !newTask.scheduled_date) {
      setError('Συμπληρώστε τίτλο, υπεύθυνο και ημερομηνία.')
      return
    }
    setBusy(true)
    const { error } = await supabase.from('store_tasks').insert({
      store_id: store.id,
      title: newTask.title.trim(),
      category: newTask.category.trim() || null,
      assigned_user_id: newTask.assigned_user_id,
      scheduled_date: newTask.scheduled_date,
      due_time: newTask.due_time || null,
      requires_authorized: newTask.requires_authorized,
      notes: newTask.notes.trim() || null,
      status: 'pending',
      created_by: profile.id,
    })
    setBusy(false)
    if (error) { setError(error.message); return }
    setNewTaskOpen(false)
    setNewTask({ title: '', category: '', assigned_user_id: '', scheduled_date: selectedDate, due_time: '', requires_authorized: false, notes: '' })
    setSuccess('Η εργασία προστέθηκε.')
    await load()
  }

  async function deleteTask(t: StoreTask) {
    if (!window.confirm(`Διαγραφή εργασίας «${t.title}»;`)) return
    const { error } = await supabase.from('store_tasks').delete().eq('id', t.id)
    if (error) { setError(error.message); return }
    setTasks((prev) => prev.filter((x) => x.id !== t.id))
  }

  async function generate() {
    if (!store || !profile) return
    if (!window.confirm(`Αυτόματη δημιουργία προγράμματος για ${monthLabel(month)}; Θα προστεθούν οι εργασίες που λείπουν.`)) return
    setError(''); setSuccess(''); setBusy(true)
    const existing = new Set(tasks.filter((t) => t.template_id).map((t) => `${t.template_id}|${t.scheduled_date}`))
    const plan = generateTaskPlan({
      storeId: store.id,
      month,
      creatorId: profile.id,
      templates: templates.filter((t) => t.active).map((t) => ({
        id: t.id, title: t.title, category: t.category, recurrence: t.recurrence,
        weekdays: t.weekdays ?? [], month_day: t.month_day, every_n: t.every_n,
        due_time: t.due_time, requires_authorized: t.requires_authorized,
      })),
      employees: employees.map((e) => ({ id: e.id, full_name: e.full_name, role: e.role })) as GenEmployee[],
      shifts: shifts as GenShift[],
      leaves: leaves as GenLeave[],
      storeDays,
      existing,
    })
    if (plan.length === 0) {
      setBusy(false)
      setSuccess('Δεν υπάρχουν νέες εργασίες προς δημιουργία.')
      return
    }
    let added = 0
    for (let i = 0; i < plan.length; i += 200) {
      const { error } = await supabase.from('store_tasks').insert(plan.slice(i, i + 200))
      if (error) { setError(error.message); break }
      added += Math.min(200, plan.length - i)
    }
    setBusy(false)
    setSuccess(`Δημιουργήθηκαν ${added} εργασίες.`)
    await load()
  }

  async function seedTemplates() {
    if (!store) return
    setError(''); setSuccess('')
    const existingTitles = new Set(templates.map((t) => t.title))
    const missing = DEFAULT_TEMPLATES.filter((t) => !existingTitles.has(t.title))
    if (missing.length === 0) { setSuccess('Υπάρχουν ήδη τα βασικά πρότυπα.'); return }
    setBusy(true)
    const { error } = await supabase.from('task_templates').insert(
      missing.map((t) => ({ ...t, store_id: store.id })),
    )
    setBusy(false)
    if (error) { setError(error.message); return }
    setSuccess('Προστέθηκαν τα βασικά πρότυπα.')
    await load()
  }

  async function addTemplate(e: React.FormEvent) {
    e.preventDefault()
    if (!store) return
    setError(''); setSuccess('')
    if (!tplForm.title.trim()) { setError('Συμπληρώστε τίτλο.'); return }
    setBusy(true)
    const { error } = await supabase.from('task_templates').insert({
      store_id: store.id,
      title: tplForm.title.trim(),
      category: tplForm.category.trim() || null,
      recurrence: tplForm.recurrence,
      weekdays: tplForm.recurrence === 'weekly_days' ? tplForm.weekdays : [],
      month_day: tplForm.recurrence === 'monthly_date' ? tplForm.month_day : null,
      every_n: tplForm.recurrence === 'every_n_days' ? Math.max(1, tplForm.every_n) : 1,
      due_time: tplForm.due_time || null,
      requires_authorized: tplForm.requires_authorized,
    })
    setBusy(false)
    if (error) { setError(error.message); return }
    setTplForm({ ...emptyTemplate })
    await load()
  }

  async function deleteTemplate(t: TaskTemplate) {
    if (!window.confirm(`Διαγραφή προτύπου «${t.title}»;`)) return
    const { error } = await supabase.from('task_templates').delete().eq('id', t.id)
    if (error) { setError(error.message); return }
    await load()
  }

  if (loading) return <Spinner />
  if (!store) {
    return <Card><p className="text-sm text-slate-500">Δεν έχει επιλεγεί κατάστημα. Επιλέξτε κατάστημα από πάνω.</p></Card>
  }

  return (
    <div className="space-y-4">
      <div className="no-print">
        <PageHeader
          eyebrow="Οργάνωση"
          title="Εργασίες καταστήματος"
          subtitle={`${monthLabel(month)} · ${store.name}`}
          actions={
            <>
              <Field label="Μήνας">
                <input type="month" value={month} onChange={(e) => setMonth(e.target.value)}
                  className="h-10 rounded-control border border-line bg-surface px-3 text-sm" />
              </Field>
              <Field label="Ημέρα">
                <input type="date" value={selectedDate} onChange={(e) => setSelectedDate(e.target.value)}
                  className="h-10 rounded-control border border-line bg-surface px-3 text-sm" />
              </Field>
              {isAdmin && <Button onClick={() => { setNewTask({ ...newTask, scheduled_date: selectedDate }); setNewTaskOpen(true) }}>Νέα εργασία</Button>}
              {isAdmin && <Button variant="secondary" onClick={generate} disabled={busy}>Αυτόματο πρόγραμμα</Button>}
              {isAdmin && <Button variant="secondary" onClick={() => setTemplatesOpen(true)}>Πρότυπα</Button>}
              {isAdmin && <Button variant="secondary" onClick={() => window.print()}>Εκτύπωση</Button>}
            </>
          }
        />
      </div>

      <div className="no-print">
        <ErrorBox message={error} />
        <SuccessBox message={success} />
      </div>

      <Card className="no-print">
        <h2 className="font-semibold text-slate-900">Οι εργασίες μου · {fmtDate(selectedDate)}</h2>
        {myTasks.length === 0 ? (
          <p className="mt-2 text-sm text-slate-500">Δεν έχεις εργασίες για αυτή την ημέρα.</p>
        ) : (
          <ul className="mt-2 divide-y divide-slate-100">
            {myTasks.map((t) => (
              <li key={t.id} className="flex items-center justify-between gap-2 py-2">
                <div className="flex items-center gap-2">
                  <input type="checkbox" checked={t.status === 'done'} onChange={() => toggleTask(t)} />
                  <div>
                    <div className={`text-sm font-medium ${t.status === 'done' ? 'text-slate-400 line-through' : 'text-slate-800'}`}>{t.title}</div>
                    <div className="text-xs text-slate-500">{t.category ?? '—'}{t.due_time ? ` · ${t.due_time}` : ''}</div>
                  </div>
                </div>
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusBadge(t.status)}`}>{statusLabel(t.status)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {isAdmin && (
        <>
          <Card className="no-print">
            <h2 className="font-semibold text-slate-900">Πρόγραμμα ημέρας · {fmtDate(selectedDate)}</h2>
            {dayTasks.length === 0 ? (
              <p className="mt-2 text-sm text-slate-500">Δεν υπάρχουν εργασίες για αυτή την ημέρα.</p>
            ) : (
              <div className="mt-2 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 text-left text-xs uppercase text-slate-500">
                      <th className="py-2 pr-2">Εργασία</th>
                      <th className="py-2 pr-2">Υπεύθυνος</th>
                      <th className="py-2 pr-2">Ώρα</th>
                      <th className="py-2 pr-2">Κατάσταση</th>
                      <th className="py-2 text-right">Ενέργειες</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {dayTasks.map((t) => (
                      <tr key={t.id}>
                        <td className="py-2 pr-2 font-medium text-slate-800">{t.title}</td>
                        <td className="py-2 pr-2 text-slate-600">{empName(t.assigned_user_id)}</td>
                        <td className="py-2 pr-2 text-slate-600">{t.due_time ?? '—'}</td>
                        <td className="py-2 pr-2">
                          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusBadge(t.status)}`}>{statusLabel(t.status)}</span>
                        </td>
                        <td className="py-2 text-right">
                          <button className="mr-2 text-xs font-medium text-slate-700 hover:underline" onClick={() => toggleTask(t)}>
                            {t.status === 'done' ? 'Επαναφορά' : 'Ολοκλήρωση'}
                          </button>
                          <button className="text-xs font-medium text-red-600 hover:underline" onClick={() => deleteTask(t)}>Διαγραφή</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <Card className="no-print">
            <h2 className="font-semibold text-slate-900">Πρόγραμμα μήνα</h2>
            <div className="mt-2 max-h-96 overflow-y-auto">
              {grouped.length === 0 ? (
                <p className="text-sm text-slate-500">Δεν υπάρχουν εργασίες για τον μήνα.</p>
              ) : (
                grouped.map(([date, list]) => (
                  <div key={date} className="border-b border-slate-100 py-2 last:border-0">
                    <div className="text-xs font-semibold uppercase text-slate-500">{fmtDate(date)}</div>
                    <ul className="mt-1 space-y-1">
                      {list.map((t) => (
                        <li key={t.id} className="flex items-center justify-between text-sm">
                          <span className={t.status === 'done' ? 'text-slate-400 line-through' : 'text-slate-700'}>
                            {t.title} · {empName(t.assigned_user_id)}
                          </span>
                          <span className={`rounded-full px-2 py-0.5 text-xs ${statusBadge(t.status)}`}>{statusLabel(t.status)}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))
              )}
            </div>
          </Card>
        </>
      )}

      {/* Print-only monthly program */}
      {isAdmin && (
      <div id="print-area">
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 18, fontWeight: 700 }}>{store.name} — Πρόγραμμα εργασιών</div>
          <div style={{ fontSize: 12 }}>{monthLabel(month)}{store.code ? ` · ${store.code}` : ''}</div>
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 10 }}>
          <thead>
            <tr style={{ background: '#f1f5f9', textAlign: 'left' }}>
              <th style={{ border: '1px solid #cbd5e1', padding: 4 }}>Ημερομηνία</th>
              <th style={{ border: '1px solid #cbd5e1', padding: 4 }}>Εργασία</th>
              <th style={{ border: '1px solid #cbd5e1', padding: 4 }}>Υπεύθυνος</th>
              <th style={{ border: '1px solid #cbd5e1', padding: 4 }}>Ώρα</th>
              <th style={{ border: '1px solid #cbd5e1', padding: 4 }}>Κατάσταση</th>
            </tr>
          </thead>
          <tbody>
            {[...tasks].sort((a, b) => a.scheduled_date.localeCompare(b.scheduled_date) || a.title.localeCompare(b.title)).map((t) => (
              <tr key={t.id}>
                <td style={{ border: '1px solid #cbd5e1', padding: 4 }}>{fmtDate(t.scheduled_date)}</td>
                <td style={{ border: '1px solid #cbd5e1', padding: 4 }}>{t.title}</td>
                <td style={{ border: '1px solid #cbd5e1', padding: 4 }}>{empName(t.assigned_user_id)}</td>
                <td style={{ border: '1px solid #cbd5e1', padding: 4 }}>{t.due_time ?? '—'}</td>
                <td style={{ border: '1px solid #cbd5e1', padding: 4 }}>{statusLabel(t.status)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      )}

      <Modal open={newTaskOpen} onClose={() => setNewTaskOpen(false)} title="Νέα εργασία">
        <form onSubmit={addTask} className="space-y-3">
          <Field label="Τίτλος"><Input value={newTask.title} onChange={(e) => setNewTask({ ...newTask, title: e.target.value })} /></Field>
          <Field label="Κατηγορία"><Input value={newTask.category} onChange={(e) => setNewTask({ ...newTask, category: e.target.value })} /></Field>
          <Field label="Υπεύθυνος">
            <Select value={newTask.assigned_user_id} onChange={(e) => setNewTask({ ...newTask, assigned_user_id: e.target.value })}>
              <option value="">—</option>
              {employees.map((e) => <option key={e.id} value={e.id}>{e.full_name}</option>)}
            </Select>
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Ημερομηνία"><Input type="date" value={newTask.scheduled_date} onChange={(e) => setNewTask({ ...newTask, scheduled_date: e.target.value })} /></Field>
            <Field label="Ώρα"><Input type="time" value={newTask.due_time} onChange={(e) => setNewTask({ ...newTask, due_time: e.target.value })} /></Field>
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={newTask.requires_authorized} onChange={(e) => setNewTask({ ...newTask, requires_authorized: e.target.checked })} />
            Απαιτεί εξουσιοδοτημένο (π.χ. ταμείο)
          </label>
          <Field label="Σημειώσεις"><Textarea rows={2} value={newTask.notes} onChange={(e) => setNewTask({ ...newTask, notes: e.target.value })} /></Field>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setNewTaskOpen(false)}>Άκυρο</Button>
            <Button type="submit" disabled={busy}>{busy ? 'Αποθήκευση…' : 'Αποθήκευση'}</Button>
          </div>
        </form>
      </Modal>

      <Modal open={templatesOpen} onClose={() => setTemplatesOpen(false)} title="Πρότυπα επαναλαμβανόμενων εργασιών" wide>
        <div className="mb-3 flex items-center justify-between">
          <p className="text-xs text-slate-500">Τα πρότυπα παράγουν εργασίες μέσω «Αυτόματο πρόγραμμα».</p>
          <Button variant="secondary" className="!px-2 !py-1 text-xs" onClick={seedTemplates} disabled={busy}>Βασικά πρότυπα</Button>
        </div>
        <div className="max-h-56 overflow-y-auto rounded-lg border border-slate-200">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr><th className="px-2 py-2">Τίτλος</th><th className="px-2 py-2">Επανάληψη</th><th className="px-2 py-2" /></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {templates.map((t) => (
                <tr key={t.id}>
                  <td className="px-2 py-1.5 text-slate-800">{t.title}<div className="text-xs text-slate-400">{t.category ?? '—'}</div></td>
                  <td className="px-2 py-1.5 text-xs text-slate-500">
                    {t.recurrence === 'daily' ? 'Καθημερινά' : t.recurrence === 'weekly_days' ? `Εβδομαδιαία (${t.weekdays.join(',')})` : t.recurrence === 'monthly_date' ? `Μηνιαία (${t.month_day})` : `Κάθε ${t.every_n} ημέρες`}
                  </td>
                  <td className="px-2 py-1.5 text-right">
                    <button className="text-xs text-red-600 hover:underline" onClick={() => deleteTemplate(t)}>Διαγραφή</button>
                  </td>
                </tr>
              ))}
              {templates.length === 0 && <tr><td colSpan={3} className="px-2 py-3 text-center text-slate-400">Δεν υπάρχουν πρότυπα.</td></tr>}
            </tbody>
          </table>
        </div>

        <form onSubmit={addTemplate} className="mt-4 space-y-2 rounded-lg bg-slate-50 p-3">
          <div className="text-sm font-medium text-slate-700">Νέο πρότυπο</div>
          <div className="grid gap-2 sm:grid-cols-2">
            <Field label="Τίτλος"><Input value={tplForm.title} onChange={(e) => setTplForm({ ...tplForm, title: e.target.value })} /></Field>
            <Field label="Κατηγορία"><Input value={tplForm.category} onChange={(e) => setTplForm({ ...tplForm, category: e.target.value })} /></Field>
            <Field label="Επανάληψη">
              <Select value={tplForm.recurrence} onChange={(e) => setTplForm({ ...tplForm, recurrence: e.target.value as TaskRecurrence })}>
                <option value="daily">Καθημερινά (εργάσιμες)</option>
                <option value="weekly_days">Συγκεκριμένες ημέρες</option>
                <option value="monthly_date">Μία φορά τον μήνα</option>
                <option value="every_n_days">Κάθε N ημέρες</option>
              </Select>
            </Field>
            <Field label="Ώρα (προαιρετικά)"><Input type="time" value={tplForm.due_time} onChange={(e) => setTplForm({ ...tplForm, due_time: e.target.value })} /></Field>
          </div>
          {tplForm.recurrence === 'weekly_days' && (
            <div className="flex flex-wrap gap-2">
              {WEEKDAYS.map((w) => (
                <label key={w.v} className="flex items-center gap-1 text-xs text-slate-700">
                  <input
                    type="checkbox"
                    checked={tplForm.weekdays.includes(w.v)}
                    onChange={(e) => setTplForm({
                      ...tplForm,
                      weekdays: e.target.checked ? [...tplForm.weekdays, w.v] : tplForm.weekdays.filter((x) => x !== w.v),
                    })}
                  />
                  {w.l}
                </label>
              ))}
            </div>
          )}
          {tplForm.recurrence === 'monthly_date' && (
            <Field label="Ημέρα μήνα"><Input type="number" min={1} max={31} value={tplForm.month_day} onChange={(e) => setTplForm({ ...tplForm, month_day: Number(e.target.value) || 1 })} /></Field>
          )}
          {tplForm.recurrence === 'every_n_days' && (
            <Field label="Κάθε N ημέρες"><Input type="number" min={1} value={tplForm.every_n} onChange={(e) => setTplForm({ ...tplForm, every_n: Number(e.target.value) || 1 })} /></Field>
          )}
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={tplForm.requires_authorized} onChange={(e) => setTplForm({ ...tplForm, requires_authorized: e.target.checked })} />
            Απαιτεί εξουσιοδοτημένο (π.χ. ταμείο)
          </label>
          <div className="flex justify-end">
            <Button type="submit" disabled={busy}>Προσθήκη προτύπου</Button>
          </div>
        </form>
        {isMaster && <p className="mt-2 text-xs text-slate-400">Master: τα πρότυπα ορίζονται ανά κατάστημα.</p>}
      </Modal>
    </div>
  )
}

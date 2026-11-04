import { useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { currentMonth } from '../lib/constants'
import { downloadXlsx, readWorkbook, type WorkbookReader } from '../lib/xlsx'
import { monthOf, normEmail, normText, parseDateFlexible, toNumber } from '../lib/normalize'
import { logActivity } from '../lib/activity'
import type { Profile, ServiceCategory } from '../lib/types'
import { Button, Card, ErrorBox, Field, Input, PageHeader, Select, SuccessBox } from '../components/ui'

type ImportType = 'store_targets' | 'seller_targets' | 'sales' | 'orders' | 'points_targets'

interface FieldDef { key: string; label: string; required: boolean; synonyms: string[] }

const TYPE_OPTIONS: { value: ImportType; label: string }[] = [
  { value: 'store_targets', label: 'Στόχοι κατηγοριών καταστήματος' },
  { value: 'seller_targets', label: 'Στόχοι κατηγοριών πωλητών' },
  { value: 'sales', label: 'Πωλήσεις (ημερήσια αποτελέσματα)' },
  { value: 'orders', label: 'Παραγγελίες πελατών' },
  { value: 'points_targets', label: 'Στόχοι πόντων (υπάρχον)' },
]

const FIELDS: Record<ImportType, FieldDef[]> = {
  store_targets: [
    { key: 'category', label: 'Κατηγορία', required: true, synonyms: ['κατηγορια', 'category', 'υπηρεσια', 'service'] },
    { key: 'target', label: 'Στόχος', required: true, synonyms: ['στοχος', 'target', 'goal'] },
  ],
  seller_targets: [
    { key: 'seller', label: 'Πωλητής (email ή όνομα)', required: true, synonyms: ['πωλητης', 'υπαλληλος', 'seller', 'employee', 'email', 'ονομα'] },
    { key: 'category', label: 'Κατηγορία', required: true, synonyms: ['κατηγορια', 'category', 'υπηρεσια', 'service'] },
    { key: 'target', label: 'Στόχος', required: true, synonyms: ['στοχος', 'target', 'goal'] },
  ],
  sales: [
    { key: 'seller', label: 'Πωλητής (email ή όνομα)', required: true, synonyms: ['πωλητης', 'υπαλληλος', 'seller', 'employee', 'email', 'ονομα'] },
    { key: 'category', label: 'Κατηγορία', required: true, synonyms: ['κατηγορια', 'category', 'υπηρεσια', 'service'] },
    { key: 'date', label: 'Ημερομηνία', required: false, synonyms: ['ημερομηνια', 'date', 'μερα', 'day'] },
    { key: 'quantity', label: 'Ποσότητα', required: true, synonyms: ['ποσοτητα', 'quantity', 'πολησεις', 'πωλησεις', 'sales', 'τεμαχια', 'τζιρος', 'amount', 'qty'] },
  ],
  orders: [
    { key: 'product_code', label: 'Κωδικός προϊόντος', required: false, synonyms: ['κωδικος', 'code', 'sku', 'κωδικος προιοντος'] },
    { key: 'product_name', label: 'Όνομα προϊόντος', required: true, synonyms: ['προιον', 'product', 'περιγραφη', 'description'] },
    { key: 'customer_name', label: 'Πελάτης', required: true, synonyms: ['πελατης', 'customer', 'ονομα πελατη'] },
    { key: 'customer_phone', label: 'Τηλέφωνο', required: false, synonyms: ['τηλεφωνο', 'phone', 'τηλ', 'mobile'] },
    { key: 'notes', label: 'Σημειώσεις', required: false, synonyms: ['σημειωσεις', 'notes', 'σχολια', 'comment'] },
  ],
  points_targets: [
    { key: 'email', label: 'Email υπαλλήλου', required: true, synonyms: ['email', 'mail', 'ημεηλ'] },
    { key: 'points', label: 'Πόντοι στόχου', required: true, synonyms: ['ποντοι', 'points', 'ποντος'] },
    { key: 'projection', label: 'Projection (προαιρετικό)', required: false, synonyms: ['projection', 'προβλεψη'] },
  ],
}

const TEMPLATE_EXAMPLES: Record<ImportType, (string | number)[]> = {
  store_targets: ['Κινητή', 10],
  seller_targets: ['email@example.gr', 'Κινητή', 5],
  sales: ['email@example.gr', 'Κινητή', '02/11/2026', 3],
  orders: ['G-12345', 'Samsung Galaxy', 'Γιώργος Παπαδόπουλος', '6900000000', 'Σημείωση'],
  points_targets: ['email@example.gr', 1000, 850],
}

interface Conflict {
  row: number
  label: string
  oldQty: number
  newQty: number
  user_id: string
  category_id: string
  date: string
  quantity: number
}

interface Validated {
  records: Record<string, unknown>[]
  errors: { row: number; message: string }[]
  conflicts: Conflict[]
  duplicates: number
}

function pad(n: number) { return String(n).padStart(2, '0') }
function todayStr() {
  const d = new Date()
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function autoMapWith(fields: FieldDef[], headers: string[]): Record<string, number | ''> {
  const map: Record<string, number | ''> = {}
  for (const f of fields) {
    const candidates = [f.key, f.label, ...f.synonyms].map(normText).filter((c) => c.length > 0)
    let idx = headers.findIndex((h) => candidates.includes(normText(h)))
    if (idx < 0) {
      idx = headers.findIndex((h) => {
        const nh = normText(h)
        return candidates.some((c) => c.length >= 3 && (nh.includes(c) || c.includes(nh)))
      })
    }
    map[f.key] = idx >= 0 ? idx : ''
  }
  return map
}

export default function Import() {
  const { store, profile } = useAuth()
  const [type, setType] = useState<ImportType>('store_targets')
  const [month, setMonth] = useState(currentMonth())
  const [defaultDate, setDefaultDate] = useState(todayStr())
  const [fileName, setFileName] = useState('')
  const [sheetNames, setSheetNames] = useState<string[]>([])
  const [sheetName, setSheetName] = useState('')
  const readerRef = useRef<WorkbookReader | null>(null)
  const [headers, setHeaders] = useState<string[]>([])
  const [rows, setRows] = useState<string[][]>([])
  const [mapping, setMapping] = useState<Record<string, number | ''>>({})
  const [validated, setValidated] = useState<Validated | null>(null)
  const [replaceConflicts, setReplaceConflicts] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [busy, setBusy] = useState(false)

  const fields = FIELDS[type]

  async function onFile(file: File) {
    setError(''); setSuccess(''); setValidated(null)
    setFileName(file.name)
    setHeaders([]); setRows([]); setSheetNames([]); setMapping({})
    readerRef.current = null
    try {
      const reader = await readWorkbook(file)
      readerRef.current = reader
      setSheetNames(reader.sheetNames)
      if (reader.sheetNames.length > 0) loadSheet(reader.sheetNames[0])
    } catch {
      setError('Δεν ήταν δυνατή η ανάγνωση του αρχείου. Δοκίμασε .xlsx ή .csv.')
    }
  }

  function loadSheet(name: string) {
    if (!readerRef.current) return
    setSheetName(name)
    const data = readerRef.current.read(name)
    setHeaders(data.headers)
    setRows(data.rows)
    setMapping(autoMapWith(fields, data.headers))
    setValidated(null)
  }

  function changeType(next: ImportType) {
    setType(next)
    setValidated(null)
    setError(''); setSuccess('')
    if (headers.length > 0) setMapping(autoMapWith(FIELDS[next], headers))
  }

  function setField(key: string, value: string) {
    setValidated(null)
    setMapping((prev) => ({ ...prev, [key]: value === '' ? '' : Number(value) }))
  }

  function downloadTemplate() {
    const headers = fields.map((f) => f.label)
    const example = fields.map((_, i) => TEMPLATE_EXAMPLES[type][i] ?? '')
    downloadXlsx(`protypo-${type}.xlsx`, [{ name: 'Πρότυπο', headers, rows: [example] }])
  }

  async function validate() {
    setError(''); setSuccess(''); setValidated(null)
    if (!store || !profile) { setError('Δεν υπάρχει ενεργό κατάστημα.'); return }
    const missing = fields.filter((f) => f.required && (mapping[f.key] === '' || mapping[f.key] === undefined))
    if (missing.length > 0) { setError(`Αντιστοιχίστε τις στήλες: ${missing.map((m) => m.label).join(', ')}`); return }
    if (rows.length === 0) { setError('Δεν υπάρχουν γραμμές προς εισαγωγή.'); return }

    setBusy(true)
    try {
      const { data: catData } = await supabase.from('service_categories').select('id, name, unit')
      const cats = (catData as ServiceCategory[]) ?? []
      const catMap = new Map(cats.map((c) => [normText(c.name), c]))

      let emps: Profile[] = []
      if (type !== 'store_targets') {
        const { data } = await supabase.from('profiles').select('*')
          .eq('store_id', store.id).eq('active', true).is('deleted_at', null)
        emps = (data as Profile[]) ?? []
      }
      const byEmail = new Map(emps.map((e) => [normEmail(e.email), e]))
      const byName = new Map(emps.map((e) => [normText(e.full_name), e]))
      const resolveEmp = (value: string, requireSeller: boolean) => {
        const v = String(value ?? '').trim()
        if (!v) return null
        const cand = byEmail.get(normEmail(v)) ?? byName.get(normText(v)) ?? null
        if (!cand) return null
        if (requireSeller && !cand.is_seller) return null
        return cand
      }

      let existingSales = new Map<string, number>()
      if (type === 'sales') {
        const [y, m] = month.split('-').map(Number)
        const next = m === 12 ? `${y + 1}-01-01` : `${y}-${pad(m + 1)}-01`
        const { data } = await supabase.from('sales_entries')
          .select('user_id, category_id, date, quantity')
          .eq('store_id', store.id).eq('status', 'active')
          .gte('date', `${month}-01`).lt('date', next)
        existingSales = new Map(
          ((data as { user_id: string; category_id: string; date: string; quantity: number }[]) ?? [])
            .map((s) => [`${s.user_id}|${s.category_id}|${s.date}`, Number(s.quantity)]),
        )
      }

      const records: Record<string, unknown>[] = []
      const errors: { row: number; message: string }[] = []
      const conflicts: Conflict[] = []
      const seen = new Set<string>()
      let duplicates = 0

      rows.forEach((row, i) => {
        const rowNo = i + 2
        const cell = (key: string) => {
          const idx = mapping[key]
          return idx === '' || idx === undefined ? '' : (row[idx] ?? '')
        }

        if (type === 'store_targets') {
          const cat = catMap.get(normText(cell('category')))
          const target = toNumber(cell('target'))
          if (!cat) { errors.push({ row: rowNo, message: `Άγνωστη κατηγορία «${cell('category')}»` }); return }
          if (target == null) { errors.push({ row: rowNo, message: 'Μη έγκυρος στόχος' }); return }
          records.push({ category_id: cat.id, target })
          return
        }

        if (type === 'seller_targets') {
          const emp = resolveEmp(cell('seller'), true)
          const cat = catMap.get(normText(cell('category')))
          const target = toNumber(cell('target'))
          if (!emp) { errors.push({ row: rowNo, message: `Πωλητής «${cell('seller')}» δεν βρέθηκε ή δεν είναι πωλητής` }); return }
          if (!cat) { errors.push({ row: rowNo, message: `Άγνωστη κατηγορία «${cell('category')}»` }); return }
          if (target == null) { errors.push({ row: rowNo, message: 'Μη έγκυρος στόχος' }); return }
          records.push({ user_id: emp.id, category_id: cat.id, target })
          return
        }

        if (type === 'sales') {
          const emp = resolveEmp(cell('seller'), true)
          const cat = catMap.get(normText(cell('category')))
          const dateRaw = String(cell('date') ?? '').trim()
          const date = (dateRaw ? parseDateFlexible(dateRaw) : defaultDate) ?? null
          const qty = toNumber(cell('quantity'))
          if (!emp) { errors.push({ row: rowNo, message: `Πωλητής «${cell('seller')}» δεν βρέθηκε ή δεν είναι πωλητής` }); return }
          if (!cat) { errors.push({ row: rowNo, message: `Άγνωστη κατηγορία «${cell('category')}»` }); return }
          if (!date) { errors.push({ row: rowNo, message: 'Μη έγκυρη ημερομηνία' }); return }
          if (monthOf(date) !== month) { errors.push({ row: rowNo, message: `Η ημερομηνία ${date} είναι εκτός του μήνα ${month}` }); return }
          if (qty == null) { errors.push({ row: rowNo, message: 'Μη έγκυρη ποσότητα' }); return }

          const key = `${emp.id}|${cat.id}|${date}`
          if (seen.has(key)) { duplicates++; return }
          seen.add(key)

          const existing = existingSales.get(key)
          if (existing !== undefined) {
            if (Math.abs(existing - qty) < 1e-9) { duplicates++; return }
            conflicts.push({
              row: rowNo, label: `${emp.full_name} · ${cat.name} · ${date}`,
              oldQty: existing, newQty: qty, user_id: emp.id, category_id: cat.id, date, quantity: qty,
            })
            return
          }
          records.push({ user_id: emp.id, category_id: cat.id, date, quantity: qty })
          return
        }

        if (type === 'orders') {
          const productName = String(cell('product_name')).trim()
          const customerName = String(cell('customer_name')).trim()
          if (!productName || !customerName) { errors.push({ row: rowNo, message: 'Χρειάζονται όνομα προϊόντος και πελάτη' }); return }
          const key = [
            cell('product_code'), productName, customerName, cell('customer_phone'), cell('notes'),
          ].map((v) => normText(v)).join('|')
          if (seen.has(key)) { duplicates++; return }
          seen.add(key)
          records.push({
            product_code: String(cell('product_code')).trim() || '—',
            product_name: productName,
            customer_name: customerName,
            customer_phone: String(cell('customer_phone')).trim() || null,
            notes: String(cell('notes')).trim() || null,
          })
          return
        }

        if (type === 'points_targets') {
          const emp = resolveEmp(cell('email'), false)
          const points = toNumber(cell('points'))
          const projection = toNumber(cell('projection')) ?? 0
          if (!emp) { errors.push({ row: rowNo, message: `Υπάλληλος «${cell('email')}» δεν βρέθηκε` }); return }
          if (points == null) { errors.push({ row: rowNo, message: 'Μη έγκυροι πόντοι' }); return }
          records.push({ user_id: emp.id, points, projection })
        }
      })

      setValidated({ records, errors, conflicts, duplicates })
      if (records.length === 0 && conflicts.length === 0) {
        setError('Δεν βρέθηκαν έγκυρες γραμμές. Δες τα σφάλματα παρακάτω.')
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Σφάλμα ελέγχου.')
    } finally {
      setBusy(false)
    }
  }

  async function commit() {
    if (!validated || !store || !profile) return
    setBusy(true); setError(''); setSuccess('')
    let imported = 0
    let replaced = 0
    let skipped = validated.duplicates
    try {
      if (type === 'store_targets') {
        const payload = validated.records.map((r) => ({
          store_id: store.id, month, category_id: String(r.category_id), target: Number(r.target),
        }))
        if (payload.length > 0) {
          const { error } = await supabase.from('store_category_targets')
            .upsert(payload, { onConflict: 'store_id,category_id,month' })
          if (error) throw error
        }
        imported = payload.length
      } else if (type === 'seller_targets') {
        const payload = validated.records.map((r) => ({
          store_id: store.id, month, user_id: String(r.user_id),
          category_id: String(r.category_id), target: Number(r.target),
        }))
        if (payload.length > 0) {
          const { error } = await supabase.from('seller_category_targets')
            .upsert(payload, { onConflict: 'store_id,user_id,category_id,month' })
          if (error) throw error
        }
        imported = payload.length
      } else if (type === 'sales') {
        const payload: Record<string, unknown>[] = validated.records.map((r) => ({
          store_id: store.id, user_id: String(r.user_id), category_id: String(r.category_id),
          date: String(r.date), quantity: Number(r.quantity),
          source: 'import', status: 'active', created_by: profile.id,
        }))
        imported = payload.length
        if (replaceConflicts) {
          validated.conflicts.forEach((c) => {
            payload.push({
              store_id: store.id, user_id: c.user_id, category_id: c.category_id,
              date: c.date, quantity: c.quantity, source: 'import', status: 'active', created_by: profile.id,
            })
          })
          replaced = validated.conflicts.length
        } else {
          skipped += validated.conflicts.length
        }
        if (payload.length > 0) {
          const { error } = await supabase.from('sales_entries')
            .upsert(payload, { onConflict: 'store_id,user_id,category_id,date' })
          if (error) throw error
        }
      } else if (type === 'orders') {
        const payload = validated.records.map((r) => ({
          store_id: store.id,
          product_code: String(r.product_code),
          product_name: String(r.product_name),
          customer_name: String(r.customer_name),
          customer_phone: (r.customer_phone as string | null) ?? null,
          notes: (r.notes as string | null) ?? null,
          status: 'new', created_by: profile.id,
        }))
        if (payload.length > 0) {
          const { error } = await supabase.from('orders').insert(payload)
          if (error) throw error
        }
        imported = payload.length
      } else {
        const payload = validated.records.map((r) => ({
          store_id: store.id, user_id: String(r.user_id), month,
          points: Number(r.points), projection: Number(r.projection),
        }))
        if (payload.length > 0) {
          const { error } = await supabase.from('employee_targets')
            .upsert(payload, { onConflict: 'store_id,user_id,month' })
          if (error) throw error
        }
        imported = payload.length
      }

      await logActivity('Εισαγωγή δεδομένων', `${TYPE_OPTIONS.find((t) => t.value === type)?.label}: ${imported} εγγραφές`)
      setSuccess(`Ολοκληρώθηκε. Εισήχθησαν ${imported}, παραλείφθηκαν ${skipped}, αντικαταστάθηκαν ${replaced}, σφάλματα ${validated.errors.length}.`)
      setValidated(null)
    } catch (e) {
      const msg = e && typeof e === 'object' && 'message' in e ? String((e as { message: unknown }).message) : 'Σφάλμα εισαγωγής.'
      setError(msg)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader eyebrow="Δεδομένα" title="Εισαγωγή δεδομένων" subtitle="Μεταφορά στόχων, πωλήσεων και παραγγελιών από Excel/CSV" />

      <Card>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Τι εισάγεις">
            <Select value={type} onChange={(e) => changeType(e.target.value as ImportType)}>
              {TYPE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </Select>
          </Field>
          <Field label="Μήνας (για στόχους/πωλήσεις)">
            <Input type="month" value={month} onChange={(e) => { setMonth(e.target.value); setValidated(null) }} />
          </Field>
          {type === 'sales' && (
            <Field label="Προεπιλεγμένη ημερομηνία (αν δεν υπάρχει στήλη)">
              <Input type="date" value={defaultDate} onChange={(e) => { setDefaultDate(e.target.value); setValidated(null) }} />
            </Field>
          )}
          <div className="flex items-end">
            <Button variant="secondary" onClick={downloadTemplate}>Λήψη προτύπου Excel</Button>
          </div>
        </div>

        <label className="mt-3 block text-sm font-medium text-slate-700">
          Αρχείο (.xlsx / .csv)
          <input
            type="file"
            accept=".xlsx,.csv"
            className="mt-1 block w-full text-sm text-slate-500"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f) }}
          />
        </label>

        {sheetNames.length > 1 && (
          <div className="mt-3 max-w-xs">
            <Field label="Φύλλο εργασίας">
              <Select value={sheetName} onChange={(e) => loadSheet(e.target.value)}>
                {sheetNames.map((s) => <option key={s} value={s}>{s}</option>)}
              </Select>
            </Field>
          </div>
        )}
      </Card>

      <ErrorBox message={error} />
      <SuccessBox message={success} />

      {headers.length > 0 && (
        <Card>
          <h2 className="font-semibold text-slate-900">Αντιστοίχιση στηλών</h2>
          <p className="mt-1 text-xs text-slate-500">{fileName} · φύλλο «{sheetName}» · {rows.length} γραμμές</p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {fields.map((f) => (
              <Field key={f.key} label={`${f.label}${f.required ? ' *' : ''}`}>
                <Select value={String(mapping[f.key] ?? '')} onChange={(e) => setField(f.key, e.target.value)}>
                  <option value="">—</option>
                  {headers.map((h, i) => <option key={i} value={i}>{i}: {h}</option>)}
                </Select>
              </Field>
            ))}
          </div>

          <div className="mt-4 overflow-x-auto">
            <div className="mb-1 text-xs font-medium uppercase text-slate-500">Προεπισκόπηση</div>
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-200 text-left uppercase text-slate-500">
                  {headers.map((h, i) => <th key={i} className="py-1 pr-3 whitespace-nowrap">{h}</th>)}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.slice(0, 8).map((r, ri) => (
                  <tr key={ri}>
                    {headers.map((_, ci) => <td key={ci} className="py-1 pr-3 text-slate-700 whitespace-nowrap">{r[ci]}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-3 flex justify-end">
            <Button onClick={validate} disabled={busy}>{busy ? 'Έλεγχος…' : 'Έλεγχος δεδομένων'}</Button>
          </div>
        </Card>
      )}

      {validated && (
        <Card>
          <h2 className="font-semibold text-slate-900">Αποτέλεσμα ελέγχου</h2>
          <div className="mt-2 flex flex-wrap gap-2 text-xs">
            <span className="rounded-full bg-green-100 px-2 py-1 font-medium text-green-800">Έγκυρες: {validated.records.length}</span>
            <span className="rounded-full bg-amber-100 px-2 py-1 font-medium text-amber-800">Διπλότυπα: {validated.duplicates}</span>
            <span className="rounded-full bg-orange-100 px-2 py-1 font-medium text-orange-800">Διαφορές: {validated.conflicts.length}</span>
            <span className="rounded-full bg-red-100 px-2 py-1 font-medium text-red-800">Σφάλματα: {validated.errors.length}</span>
          </div>

          {validated.errors.length > 0 && (
            <div className="mt-3 max-h-40 overflow-y-auto rounded-lg border border-red-200 bg-red-50 p-2 text-xs text-red-700">
              {validated.errors.map((e, i) => <div key={i}>Γραμμή {e.row}: {e.message}</div>)}
            </div>
          )}

          {validated.conflicts.length > 0 && (
            <div className="mt-3 rounded-lg border border-orange-200 bg-orange-50 p-3">
              <div className="text-sm font-medium text-orange-900">Υπάρχουσες καταχωρήσεις με διαφορετική ποσότητα</div>
              <div className="mt-2 max-h-40 overflow-y-auto text-xs text-orange-800">
                {validated.conflicts.map((c, i) => (
                  <div key={i}>Γραμμή {c.row}: {c.label} — υπάρχον {c.oldQty} → νέο {c.newQty}</div>
                ))}
              </div>
              <div className="mt-2 flex flex-wrap gap-3 text-sm text-orange-900">
                <label className="flex items-center gap-1">
                  <input type="radio" checked={!replaceConflicts} onChange={() => setReplaceConflicts(false)} />
                  Παράλειψη υπαρχουσών (ασφαλές)
                </label>
                <label className="flex items-center gap-1">
                  <input type="radio" checked={replaceConflicts} onChange={() => setReplaceConflicts(true)} />
                  Αντικατάσταση με τις νέες τιμές
                </label>
              </div>
            </div>
          )}

          <div className="mt-4 flex justify-end">
            <Button onClick={commit} disabled={busy || (validated.records.length === 0 && validated.conflicts.length === 0)}>
              {busy ? 'Εισαγωγή…' : 'Επιβεβαίωση εισαγωγής'}
            </Button>
          </div>
        </Card>
      )}
    </div>
  )
}

import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { currentMonth, fmtNum, monthLabel } from '../lib/constants'
import {
  calcCategoryStats, parseFallbackDays, storeWorkingDays, workingDays,
} from '../lib/projection'
import type {
  Profile, SalesEntry, SellerCategoryTarget, ServiceCategory, StoreCalendarDay,
  StoreCategory, StoreCategoryTarget,
} from '../lib/types'
import { Button, Card, ErrorBox, Field, Input, Select, Spinner, SuccessBox } from '../components/ui'
import CategorySettings from '../components/services/CategorySettings'
import CalendarSettings from '../components/services/CalendarSettings'

interface ShiftRow { date: string; shift_type: string }

function pad(n: number) { return String(n).padStart(2, '0') }
function todayStr() {
  const d = new Date()
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
function fmtVal(v: number, unit: 'count' | 'currency') {
  if (unit === 'currency') {
    return new Intl.NumberFormat('el-GR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v)
  }
  return fmtNum(Math.round(v))
}
function fmtPct(v: number | null) { return v == null ? '—' : `${v.toFixed(1)}%` }

export default function Services() {
  const { profile, store, isAdmin, isMaster } = useAuth()
  const [month, setMonth] = useState(currentMonth())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const [categories, setCategories] = useState<ServiceCategory[]>([])
  const [storeCats, setStoreCats] = useState<StoreCategory[]>([])
  const [storeTargets, setStoreTargets] = useState<StoreCategoryTarget[]>([])
  const [sellerTargets, setSellerTargets] = useState<SellerCategoryTarget[]>([])
  const [storeAgg, setStoreAgg] = useState<Record<string, number>>({})
  const [sellerSales, setSellerSales] = useState<SalesEntry[]>([])
  const [allSales, setAllSales] = useState<SalesEntry[]>([])
  const [shifts, setShifts] = useState<ShiftRow[]>([])
  const [calendar, setCalendar] = useState<StoreCalendarDay[]>([])
  const [employees, setEmployees] = useState<Profile[]>([])
  const [selectedSeller, setSelectedSeller] = useState('')

  const [entryDate, setEntryDate] = useState(todayStr())
  const [entryVals, setEntryVals] = useState<Record<string, string>>({})
  const [entryBusy, setEntryBusy] = useState(false)

  const [catOpen, setCatOpen] = useState(false)
  const [calOpen, setCalOpen] = useState(false)

  const [start, next] = useMemo(() => {
    const [y, m] = month.split('-').map(Number)
    return [
      `${month}-01`,
      m === 12 ? `${y + 1}-01-01` : `${y}-${pad(m + 1)}-01`,
    ] as const
  }, [month])

  const sellerId = isAdmin ? selectedSeller : (profile?.id ?? '')

  async function load() {
    if (!store) { setLoading(false); return }
    setLoading(true)
    setError('')

    const [catRes, scRes, stRes, stlRes, calRes, aggRes] = await Promise.all([
      supabase.from('service_categories').select('*').order('sort_order'),
      supabase.from('store_categories').select('*').eq('store_id', store.id),
      supabase.from('store_category_targets').select('*').eq('store_id', store.id).eq('month', month),
      supabase.from('seller_category_targets').select('*').eq('store_id', store.id).eq('month', month),
      supabase.from('store_calendar').select('*').eq('store_id', store.id).gte('date', start).lt('date', next),
      supabase.rpc('store_category_sales', { p_store: store.id, p_month: month }),
    ])

    setCategories((catRes.data as ServiceCategory[]) ?? [])
    setStoreCats((scRes.data as StoreCategory[]) ?? [])
    setStoreTargets((stRes.data as StoreCategoryTarget[]) ?? [])
    setSellerTargets((stlRes.data as SellerCategoryTarget[]) ?? [])
    setCalendar((calRes.data as StoreCalendarDay[]) ?? [])

    const agg: Record<string, number> = {}
    ;((aggRes.data as { category_id: string; quantity: number }[] | null) ?? []).forEach((r) => {
      agg[r.category_id] = Number(r.quantity)
    })
    setStoreAgg(agg)

    let emps: Profile[] = []
    if (isAdmin) {
      const { data } = await supabase
        .from('profiles').select('*').eq('store_id', store.id)
        .eq('active', true).is('deleted_at', null).eq('is_seller', true).order('full_name')
      emps = (data as Profile[]) ?? []
    } else if (profile) {
      emps = [profile]
    }
    setEmployees(emps)

    const sid = isAdmin ? (selectedSeller || emps[0]?.id || '') : profile?.id ?? ''
    if (isAdmin && !selectedSeller && sid) setSelectedSeller(sid)

    if (sid) {
      const [ssRes, shRes] = await Promise.all([
        supabase.from('sales_entries').select('*').eq('store_id', store.id)
          .eq('user_id', sid).gte('date', start).lt('date', next).eq('status', 'active'),
        supabase.from('shifts').select('date, shift_type').eq('store_id', store.id)
          .eq('user_id', sid).gte('date', start).lt('date', next),
      ])
      setSellerSales((ssRes.data as SalesEntry[]) ?? [])
      setShifts((shRes.data as ShiftRow[]) ?? [])
    } else {
      setSellerSales([])
      setShifts([])
    }

    if (isAdmin) {
      const { data } = await supabase.from('sales_entries').select('*')
        .eq('store_id', store.id).gte('date', start).lt('date', next).eq('status', 'active')
      setAllSales((data as SalesEntry[]) ?? [])
    } else {
      setAllSales([])
    }

    setLoading(false)
  }

  useEffect(() => { load() }, [store, month, selectedSeller, isAdmin])

  useEffect(() => {
    const map: Record<string, string> = {}
    sellerSales.filter((e) => e.date === entryDate).forEach((e) => { map[e.category_id] = String(e.quantity) })
    setEntryVals(map)
  }, [entryDate, sellerSales])

  const visible = useMemo(() => {
    return categories
      .map((c) => {
        const o = storeCats.find((x) => x.category_id === c.id)
        return { ...c, active: o ? o.active : c.active, sort: o?.sort_order ?? c.sort_order }
      })
      .filter((c) => c.active)
      .sort((a, b) => a.sort - b.sort)
  }, [categories, storeCats])

  const fallbackDays = parseFallbackDays(store?.fallback_work_days)
  const storeDays = useMemo(() => storeWorkingDays(month, calendar, fallbackDays), [month, calendar, fallbackDays])
  const sellerDays = useMemo(() => workingDays(month, shifts, fallbackDays), [month, shifts, fallbackDays])

  const storeTargetFor = (cid: string) => Number(storeTargets.find((t) => t.category_id === cid)?.target ?? 0)
  const storeProgress = (cid: string) => Number(storeAgg[cid] ?? 0)
  const sellerTargetFor = (cid: string) => Number(
    sellerTargets.find((t) => t.user_id === sellerId && t.category_id === cid)?.target ?? 0,
  )
  const sellerProgress = (cid: string) => sellerSales
    .filter((e) => e.category_id === cid).reduce((s, e) => s + Number(e.quantity), 0)

  const countCats = visible.filter((c) => c.unit === 'count')
  const countTarget = countCats.reduce((s, c) => s + storeTargetFor(c.id), 0)
  const countProgress = countCats.reduce((s, c) => s + storeProgress(c.id), 0)
  const countAchievement = countTarget > 0 ? (countProgress / countTarget) * 100 : null
  const currencyCat = visible.find((c) => c.unit === 'currency')
  const currencyTarget = currencyCat ? storeTargetFor(currencyCat.id) : 0
  const currencyProgress = currencyCat ? storeProgress(currencyCat.id) : 0
  const elapsedStoreDays = storeDays.filter((d) => d <= todayStr()).length

  const comparison = useMemo(() => employees.map((e) => {
    const cT = countCats.reduce((s, c) => s + Number(
      sellerTargets.find((t) => t.user_id === e.id && t.category_id === c.id)?.target ?? 0,
    ), 0)
    const cS = allSales.filter((s) => s.user_id === e.id && countCats.some((c) => c.id === s.category_id))
      .reduce((s, x) => s + Number(x.quantity), 0)
    const curT = currencyCat ? Number(
      sellerTargets.find((t) => t.user_id === e.id && t.category_id === currencyCat.id)?.target ?? 0,
    ) : 0
    const curS = currencyCat
      ? allSales.filter((s) => s.user_id === e.id && s.category_id === currencyCat.id)
        .reduce((s, x) => s + Number(x.quantity), 0)
      : 0
    return { e, cT, cS, cAch: cT > 0 ? (cS / cT) * 100 : null, curT, curS }
  }), [employees, sellerTargets, allSales, countCats, currencyCat])

  async function saveStoreTarget(cid: string, value: string) {
    if (!store) return
    const num = Number(value) || 0
    const existing = storeTargets.find((t) => t.category_id === cid)
    if (existing) {
      const { error } = await supabase.from('store_category_targets').update({ target: num }).eq('id', existing.id)
      if (error) { setError(error.message); return }
      setStoreTargets((prev) => prev.map((t) => (t.id === existing.id ? { ...t, target: num } : t)))
    } else {
      const { data, error } = await supabase.from('store_category_targets')
        .insert({ store_id: store.id, category_id: cid, month, target: num }).select().single()
      if (error) { setError(error.message); return }
      setStoreTargets((prev) => [...prev, data as StoreCategoryTarget])
    }
  }

  async function saveSellerTarget(cid: string, value: string) {
    if (!store || !sellerId) return
    const num = Number(value) || 0
    const { data, error } = await supabase.from('seller_category_targets').upsert(
      { store_id: store.id, user_id: sellerId, category_id: cid, month, target: num },
      { onConflict: 'store_id,user_id,category_id,month' },
    ).select().single()
    if (error) { setError(error.message); return }
    setSellerTargets((prev) => [
      ...prev.filter((t) => !(t.user_id === sellerId && t.category_id === cid)),
      data as SellerCategoryTarget,
    ])
  }

  async function saveEntry() {
    if (!store || !profile || !sellerId) return
    setError('')
    setSuccess('')
    const rows = visible
      .filter((c) => entryVals[c.id] !== undefined && entryVals[c.id] !== '')
      .map((c) => ({
        store_id: store.id,
        user_id: sellerId,
        category_id: c.id,
        date: entryDate,
        quantity: Number(entryVals[c.id]) || 0,
        source: 'manual',
        status: 'active',
        created_by: profile.id,
      }))
    if (rows.length === 0) { setError('Συμπληρώστε τουλάχιστον μία ποσότητα.'); return }
    setEntryBusy(true)
    const { error } = await supabase.from('sales_entries').upsert(rows, {
      onConflict: 'store_id,user_id,category_id,date',
    })
    setEntryBusy(false)
    if (error) { setError(error.message); return }
    setSuccess('Οι πωλήσεις καταχωρήθηκαν.')
    await load()
  }

  if (loading) return <Spinner />

  if (!store) {
    return <Card><p className="text-sm text-slate-500">Δεν έχει επιλεγεί κατάστημα. Επιλέξτε κατάστημα από πάνω.</p></Card>
  }

  const today = new Date()

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Υπηρεσίες</h1>
          <p className="text-sm text-slate-500">{monthLabel(month)} · {store.name}</p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <Field label="Μήνας">
            <input type="month" value={month} onChange={(e) => setMonth(e.target.value)}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
          </Field>
          {isAdmin && (
            <Field label="Πωλητής">
              <Select value={selectedSeller} onChange={(e) => setSelectedSeller(e.target.value)} className="min-w-44">
                {employees.map((e) => <option key={e.id} value={e.id}>{e.full_name}</option>)}
              </Select>
            </Field>
          )}
          {isAdmin && <Button variant="secondary" onClick={() => setCatOpen(true)}>Κατηγορίες</Button>}
          {isAdmin && <Button variant="secondary" onClick={() => setCalOpen(true)}>Ημερολόγιο</Button>}
        </div>
      </div>

      <ErrorBox message={error} />
      <SuccessBox message={success} />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <div className="text-sm text-slate-500">Στόχος τεμαχίων</div>
          <div className="mt-1 text-2xl font-bold text-slate-900">{fmtNum(countTarget)}</div>
        </Card>
        <Card>
          <div className="text-sm text-slate-500">Πωλήσεις τεμαχίων</div>
          <div className="mt-1 text-2xl font-bold text-slate-900">{fmtNum(countProgress)}</div>
        </Card>
        <Card>
          <div className="text-sm text-slate-500">Επίτευξη</div>
          <div className="mt-1 text-2xl font-bold text-slate-900">{fmtPct(countAchievement)}</div>
        </Card>
        <Card>
          <div className="text-sm text-slate-500">Τζίρος (πρόοδος / στόχος)</div>
          <div className="mt-1 text-2xl font-bold text-slate-900">{fmtVal(currencyProgress, 'currency')}</div>
          <div className="text-xs text-slate-400">στόχος: {fmtVal(currencyTarget, 'currency')}</div>
        </Card>
      </div>

      <p className="text-xs text-slate-500">
        Εργάσιμες καταστήματος: {elapsedStoreDays}/{storeDays.length}
        {sellerId ? ` · Εργάσιμες πωλητή: ${sellerDays.filter((d) => d <= todayStr()).length}/${sellerDays.length}` : ''}
      </p>

      <Card>
        <h2 className="font-semibold text-slate-900">Καταχώρηση πωλήσεων</h2>
        <p className="mt-1 text-xs text-slate-500">
          Μία εγγραφή ανά πωλητή, κατηγορία και ημέρα. Η εισαγωγή ενημερώνει την ίδια εγγραφή.
        </p>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <Field label="Ημερομηνία">
            <Input type="date" value={entryDate} onChange={(e) => setEntryDate(e.target.value)} />
          </Field>
          {isAdmin && (
            <Field label="Πωλητής">
              <Select value={selectedSeller} onChange={(e) => setSelectedSeller(e.target.value)}>
                {employees.map((e) => <option key={e.id} value={e.id}>{e.full_name}</option>)}
              </Select>
            </Field>
          )}
        </div>
        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {visible.map((c) => (
            <Field key={c.id} label={`${c.name} (${c.unit === 'currency' ? '€' : 'τεμ.'})`}>
              <Input
                type="number"
                step={c.unit === 'currency' ? '0.01' : '1'}
                value={entryVals[c.id] ?? ''}
                onChange={(e) => setEntryVals((prev) => ({ ...prev, [c.id]: e.target.value }))}
                placeholder="0"
              />
            </Field>
          ))}
        </div>
        <div className="mt-3 flex justify-end">
          <Button onClick={saveEntry} disabled={entryBusy}>{entryBusy ? 'Αποθήκευση…' : 'Αποθήκευση ημέρας'}</Button>
        </div>
      </Card>

      <Card>
        <h2 className="font-semibold text-slate-900">Στόχοι καταστήματος</h2>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs uppercase text-slate-500">
                <th className="py-2 pr-2">Κατηγορία</th>
                <th className="py-2 pr-2">Μονάδα</th>
                <th className="py-2 pr-2 text-right">Στόχος</th>
                <th className="py-2 pr-2 text-right">Πρόοδος</th>
                <th className="py-2 pr-2 text-right">Επίτευξη</th>
                <th className="py-2 pr-2 text-right">Projection</th>
                <th className="py-2 pr-2 text-right">Απόκλιση</th>
                <th className="py-2 text-right">Ημερήσια ανάγκη</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {visible.map((c) => {
                const target = storeTargetFor(c.id)
                const progress = storeProgress(c.id)
                const s = calcCategoryStats(progress, target, storeDays, today, c.unit)
                return (
                  <tr key={c.id}>
                    <td className="py-2 pr-2 font-medium text-slate-800">{c.name}</td>
                    <td className="py-2 pr-2 text-xs text-slate-500">{c.unit === 'currency' ? 'Ευρώ' : 'Τεμάχια'}</td>
                    <td className="py-2 pr-2">
                      {isAdmin ? (
                        <input
                          type="number"
                          key={`${c.id}-${target}`}
                          defaultValue={target}
                          onBlur={(e) => saveStoreTarget(c.id, e.target.value)}
                          className="w-24 rounded-lg border border-slate-300 px-2 py-1 text-right text-sm"
                        />
                      ) : (
                        <div className="text-right">{fmtVal(target, c.unit)}</div>
                      )}
                    </td>
                    <td className="py-2 pr-2 text-right">{fmtVal(progress, c.unit)}</td>
                    <td className="py-2 pr-2 text-right">{fmtPct(s.achievement)}</td>
                    <td className="py-2 pr-2 text-right">{s.projection == null ? 'Μη διαθέσιμη' : fmtVal(s.projection, c.unit)}</td>
                    <td className={`py-2 pr-2 text-right ${s.deviation != null && s.deviation < 0 ? 'text-red-600' : 'text-slate-700'}`}>
                      {s.deviation == null ? '—' : `${s.deviation > 0 ? '+' : ''}${fmtVal(s.deviation, c.unit)}`}
                    </td>
                    <td className="py-2 text-right">{s.requiredDaily == null ? '—' : fmtVal(s.requiredDaily, c.unit)}</td>
                  </tr>
                )
              })}
              {visible.length === 0 && (
                <tr><td colSpan={8} className="py-3 text-center text-slate-400">Δεν υπάρχουν ενεργές κατηγορίες.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <Card>
        <h2 className="font-semibold text-slate-900">Απόδοση πωλητή</h2>
        <p className="mt-1 text-xs text-slate-500">
          {employees.find((e) => e.id === sellerId)?.full_name ?? '—'}
        </p>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs uppercase text-slate-500">
                <th className="py-2 pr-2">Κατηγορία</th>
                <th className="py-2 pr-2">Μονάδα</th>
                <th className="py-2 pr-2 text-right">Στόχος</th>
                <th className="py-2 pr-2 text-right">Πρόοδος</th>
                <th className="py-2 pr-2 text-right">Projection</th>
                <th className="py-2 text-right">Επίτευξη</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {visible.map((c) => {
                const target = sellerTargetFor(c.id)
                const progress = sellerProgress(c.id)
                const s = calcCategoryStats(progress, target, sellerDays, today, c.unit)
                return (
                  <tr key={c.id}>
                    <td className="py-2 pr-2 font-medium text-slate-800">{c.name}</td>
                    <td className="py-2 pr-2 text-xs text-slate-500">{c.unit === 'currency' ? 'Ευρώ' : 'Τεμάχια'}</td>
                    <td className="py-2 pr-2">
                      {isAdmin ? (
                        <input
                          type="number"
                          key={`${c.id}-${sellerId}-${target}`}
                          defaultValue={target}
                          onBlur={(e) => saveSellerTarget(c.id, e.target.value)}
                          className="w-24 rounded-lg border border-slate-300 px-2 py-1 text-right text-sm"
                        />
                      ) : (
                        <div className="text-right">{fmtVal(target, c.unit)}</div>
                      )}
                    </td>
                    <td className="py-2 pr-2 text-right">{fmtVal(progress, c.unit)}</td>
                    <td className="py-2 pr-2 text-right">{s.projection == null ? 'Μη διαθέσιμη' : fmtVal(s.projection, c.unit)}</td>
                    <td className="py-2 text-right">{fmtPct(s.achievement)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {isAdmin && (
        <Card>
          <h2 className="font-semibold text-slate-900">Σύγκριση πωλητών</h2>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs uppercase text-slate-500">
                  <th className="py-2 pr-2">Πωλητής</th>
                  <th className="py-2 pr-2 text-right">Στόχος τεμ.</th>
                  <th className="py-2 pr-2 text-right">Πωλήσεις τεμ.</th>
                  <th className="py-2 pr-2 text-right">Επίτευξη</th>
                  <th className="py-2 pr-2 text-right">Στόχος τζίρος</th>
                  <th className="py-2 text-right">Τζίρος</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {comparison.map((r) => (
                  <tr key={r.e.id}>
                    <td className="py-2 pr-2 font-medium text-slate-800">{r.e.full_name}</td>
                    <td className="py-2 pr-2 text-right">{fmtNum(r.cT)}</td>
                    <td className="py-2 pr-2 text-right">{fmtNum(r.cS)}</td>
                    <td className="py-2 pr-2 text-right">{fmtPct(r.cAch)}</td>
                    <td className="py-2 pr-2 text-right">{fmtVal(r.curT, 'currency')}</td>
                    <td className="py-2 text-right">{fmtVal(r.curS, 'currency')}</td>
                  </tr>
                ))}
                {comparison.length === 0 && (
                  <tr><td colSpan={6} className="py-3 text-center text-slate-400">Δεν υπάρχουν πωλητές.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <CategorySettings
        open={catOpen}
        onClose={() => setCatOpen(false)}
        storeId={store.id}
        categories={categories}
        storeCats={storeCats}
        isMaster={isMaster}
        onSaved={load}
      />
      <CalendarSettings
        open={calOpen}
        onClose={() => setCalOpen(false)}
        storeId={store.id}
        month={month}
        calendar={calendar}
        fallbackDays={fallbackDays}
        onSaved={load}
      />
    </div>
  )
}

import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { currentMonth, fmtDate, fmtNum, monthLabel, ORDER_STATUS } from '../lib/constants'
import { computeProjection, parseFallbackDays, storeWorkingDays } from '../lib/projection'
import type { EmployeeTarget, Order, StoreCalendarDay, StoreTarget } from '../lib/types'
import { Button, Card, EmptyState, MetricCard, PageHeader, Spinner } from '../components/ui'
import { SalesTrendChart, type TrendPoint } from '../components/Charts'

interface MasterStats { stores: number; users: number; pending: number }

export default function Dashboard() {
  const { profile, store, isMaster } = useAuth()
  const [storeTarget, setStoreTarget] = useState<StoreTarget | null>(null)
  const [myTarget, setMyTarget] = useState<EmployeeTarget | null>(null)
  const [orders, setOrders] = useState<Order[]>([])
  const [openOrders, setOpenOrders] = useState(0)
  const [reminders, setReminders] = useState<Order[]>([])
  const [myEntries, setMyEntries] = useState<{ date: string; points: number }[]>([])
  const [myShifts, setMyShifts] = useState<{ date: string; shift_type: string }[]>([])
  const [trend, setTrend] = useState<{ points: TrendPoint[]; target: number; actual: number; projection: number } | null>(null)
  const [masterStats, setMasterStats] = useState<MasterStats | null>(null)
  const [loading, setLoading] = useState(true)

  const month = currentMonth()

  useEffect(() => {
    if (!profile) return
    ;(async () => {
      const cutoff = new Date(Date.now() - 2 * 86400000).toISOString()

      if (isMaster) {
        const [{ count: sc }, { count: uc }, { count: pc }] = await Promise.all([
          supabase.from('stores').select('*', { count: 'exact', head: true }).is('deleted_at', null),
          supabase.from('profiles').select('*', { count: 'exact', head: true }).eq('active', true).is('deleted_at', null),
          supabase.from('profiles').select('*', { count: 'exact', head: true }).eq('active', false).is('deleted_at', null),
        ])
        setMasterStats({ stores: sc ?? 0, users: uc ?? 0, pending: pc ?? 0 })
      }

      if (store) {
        const [yy, mm] = month.split('-').map(Number)
        const start = `${month}-01`
        const next = mm === 12 ? `${yy + 1}-01-01` : `${yy}-${String(mm + 1).padStart(2, '0')}-01`
        const [st, mt, ord, rem, pe, ms, catRes, tgtRes, calRes, dailyRes, openRes] = await Promise.all([
          supabase.from('store_targets').select('*').eq('store_id', store.id).eq('month', month).maybeSingle(),
          isMaster
            ? Promise.resolve({ data: null })
            : supabase.from('employee_targets').select('*').eq('user_id', profile.id).eq('month', month).maybeSingle(),
          supabase.from('orders').select('*').eq('store_id', store.id).order('created_at', { ascending: false }).limit(5),
          supabase.from('orders').select('*').eq('store_id', store.id).eq('status', 'ready').lt('updated_at', cutoff).order('updated_at', { ascending: true }),
          supabase.from('point_entries').select('date, points').eq('store_id', store.id).eq('user_id', profile.id).gte('date', start).lt('date', next),
          supabase.from('shifts').select('date, shift_type').eq('store_id', store.id).eq('user_id', profile.id).gte('date', start).lt('date', next),
          supabase.from('service_categories').select('id, unit'),
          supabase.from('store_category_targets').select('category_id, target').eq('store_id', store.id).eq('month', month),
          supabase.from('store_calendar').select('*').eq('store_id', store.id).gte('date', start).lt('date', next),
          supabase.rpc('store_daily_sales', { p_store: store.id, p_month: month }),
          supabase.from('orders').select('*', { count: 'exact', head: true })
            .eq('store_id', store.id)
            .in('status', ['new', 'ordered', 'in_transit', 'received', 'ready', 'notified']),
        ])
        setStoreTarget(st.data as StoreTarget | null)
        setMyTarget((mt.data as EmployeeTarget | null) ?? null)
        setOrders((ord.data as Order[]) ?? [])
        setOpenOrders(openRes.count ?? 0)
        setReminders((rem.data as Order[]) ?? [])
        setMyEntries((pe.data as { date: string; points: number }[]) ?? [])
        setMyShifts((ms.data as { date: string; shift_type: string }[]) ?? [])

        const cats = (catRes.data as { id: string; unit: string }[] | null) ?? []
        const countIds = new Set(cats.filter((c) => c.unit === 'count').map((c) => c.id))
        const tgtRows = (tgtRes.data as { category_id: string; target: number }[] | null) ?? []
        const countTarget = tgtRows
          .filter((t) => countIds.has(t.category_id))
          .reduce((s, t) => s + Number(t.target), 0)
        const cal = (calRes.data as StoreCalendarDay[] | null) ?? []
        const days = storeWorkingDays(month, cal, parseFallbackDays(store.fallback_work_days))
        const dailyMap = new Map<string, number>(
          (((dailyRes.data as { sales_date: string; quantity: number }[] | null) ?? []))
            .map((r) => [r.sales_date, Number(r.quantity)]),
        )
        const now = new Date()
        const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
        let cumulative = 0
        const points: TrendPoint[] = days.map((d, i) => {
          cumulative += dailyMap.get(d) ?? 0
          const isPast = d <= todayStr
          const ideal = countTarget > 0 && days.length > 0 ? (countTarget * (i + 1)) / days.length : 0
          return { label: String(Number(d.slice(8))), actual: isPast ? cumulative : null, ideal }
        })
        const elapsed = days.filter((d) => d <= todayStr).length
        const actualTotal = days
          .filter((d) => d <= todayStr)
          .reduce((s, d) => s + (dailyMap.get(d) ?? 0), 0)
        const projection = elapsed > 0 ? Math.round((actualTotal / elapsed) * days.length) : 0
        setTrend({ points, target: countTarget, actual: actualTotal, projection })
      }
      setLoading(false)
    })()
  }, [profile, store, isMaster, month])

  if (loading) return <Spinner />

  const myProj = computeProjection(myEntries, myShifts, month)
  const first = profile?.full_name.split(' ')[0] ?? ''
  const personalProgress = myTarget && Number(myTarget.points) > 0
    ? (myProj.total / Number(myTarget.points)) * 100
    : 0

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Επισκόπηση"
        title={`Καλημέρα, ${first}`}
        subtitle={`${monthLabel(month)}${store ? ` · ${store.name}` : ''}`}
        actions={<Link to="/services"><Button>Υπηρεσίες</Button></Link>}
      />

      {isMaster && masterStats && (
        <div className="grid gap-4 sm:grid-cols-3">
          <Link to="/stores"><MetricCard label="Καταστήματα" value={masterStats.stores} detail="ενεργά καταστήματα" /></Link>
          <Link to="/employees"><MetricCard label="Ενεργοί χρήστες" value={masterStats.users} detail="σε όλα τα καταστήματα" accent="green" /></Link>
          <Link to="/requests"><MetricCard label="Εκκρεμείς αιτήσεις" value={masterStats.pending} detail="προς έγκριση" accent="amber" /></Link>
        </div>
      )}

      {store ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <MetricCard
              label="Στόχος καταστήματος"
              value={fmtNum(storeTarget?.store_points ?? 0)}
              detail="πόντοι μήνα"
            />
            {!isMaster && (
              <MetricCard
                label="Ο στόχος μου"
                value={fmtNum(myTarget?.points ?? 0)}
                detail={`Πόντοι: ${fmtNum(myProj.total)} · Projection: ${fmtNum(myProj.projection)}`}
                progress={personalProgress}
                accent="green"
              />
            )}
            <MetricCard
              label="Ανοιχτές παραγγελίες"
              value={openOrders}
              detail="σε εκκρεμότητα"
              accent="purple"
            />
            <MetricCard
              label="Υπενθυμίσεις"
              value={reminders.length}
              detail="έτοιμες χωρίς ενημέρωση"
              accent={reminders.length > 0 ? 'amber' : 'brand'}
            />
          </div>

          {reminders.length > 0 && (
            <Card className="border-amber-200 bg-amber-50">
              <div className="flex items-center justify-between">
                <h2 className="font-semibold text-amber-900">Έτοιμες παραγγελίες χωρίς ενημέρωση πελάτη</h2>
                <Link to="/orders" className="text-sm font-semibold text-amber-800 hover:underline">Παραγγελίες</Link>
              </div>
              <ul className="mt-3 divide-y divide-amber-200">
                {reminders.slice(0, 6).map((o) => (
                  <li key={o.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                    <Link to={`/orders/${o.id}`} className="min-w-0 flex-1">
                      <div className="truncate font-medium text-amber-900">{o.product_name}</div>
                      <div className="truncate text-xs text-amber-700">{o.customer_name} · από {fmtDate(o.updated_at)}</div>
                    </Link>
                    <span className="text-xs font-semibold text-amber-700">+2 ημέρες</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {trend && (
            <Card>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h2 className="font-semibold text-ink">Πορεία πωλήσεων · τεμάχια</h2>
                  <p className="text-xs text-muted">{monthLabel(month)} · στόχος {fmtNum(trend.target)}</p>
                </div>
                <Link to="/services" className="text-sm font-semibold text-brand hover:underline">Υπηρεσίες</Link>
              </div>
              {trend.target === 0 && trend.actual === 0 ? (
                <EmptyState title="Δεν υπάρχουν πωλήσεις ή στόχοι" text="Όρισε στόχους κατηγοριών και καταχώρησε πωλήσεις από τις Υπηρεσίες." />
              ) : (
                <>
                  <div className="mt-3 flex flex-wrap items-center gap-4 text-[11px] text-muted">
                    <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-brand" /> Πραγματικό</span>
                    <span className="flex items-center gap-1.5"><span className="h-0.5 w-4 bg-slate-300" /> Στόχος</span>
                    <span>Πραγματικό: <strong className="text-ink">{fmtNum(trend.actual)}</strong></span>
                    <span>Projection: <strong className="text-ink">{fmtNum(trend.projection)}</strong></span>
                  </div>
                  <div className="mt-2">
                    <SalesTrendChart points={trend.points} />
                  </div>
                </>
              )}
            </Card>
          )}

          <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
            <Card>
              <div className="flex items-center justify-between">
                <h2 className="font-semibold text-ink">Τελευταίες παραγγελίες</h2>
                <Link to="/orders" className="text-sm font-semibold text-brand hover:underline">Όλες</Link>
              </div>
              {orders.length === 0 ? (
                <EmptyState title="Δεν υπάρχουν παραγγελίες ακόμα" text="Δημιούργησε την πρώτη από τις Παραγγελίες." />
              ) : (
                <ul className="mt-3 divide-y divide-line">
                  {orders.map((o) => (
                    <li key={o.id} className="flex items-center justify-between gap-3 py-2.5">
                      <Link to={`/orders/${o.id}`} className="min-w-0 flex-1">
                        <div className="truncate text-sm font-semibold text-ink">{o.product_name}</div>
                        <div className="truncate text-xs text-muted">{o.customer_name} · {o.product_code}</div>
                      </Link>
                      <span className={`shrink-0 rounded-md px-2 py-1 text-[11px] font-semibold ${ORDER_STATUS[o.status].color}`}>
                        {ORDER_STATUS[o.status].label}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <Card>
              <h2 className="font-semibold text-ink">Γρήγορες ενέργειες</h2>
              <div className="mt-3 grid grid-cols-2 gap-2">
                {[
                  { to: '/targets', label: 'Στόχοι', desc: 'Πόντοι & projection' },
                  { to: '/services', label: 'Υπηρεσίες', desc: 'Κατηγορίες & πωλήσεις' },
                  { to: '/orders', label: 'Παραγγελίες', desc: 'Παραλαβές/πελάτες' },
                  { to: '/tasks', label: 'Εργασίες', desc: 'Καθημερινές αναθέσεις' },
                ].map((q) => (
                  <Link
                    key={q.to}
                    to={q.to}
                    className="rounded-control border border-line bg-surface px-3 py-2.5 transition hover:border-brand/40 hover:bg-blue-50/40"
                  >
                    <div className="text-sm font-semibold text-ink">{q.label}</div>
                    <div className="mt-0.5 text-[11px] text-muted">{q.desc}</div>
                  </Link>
                ))}
              </div>
              {openOrders > 0 && (
                <div className="mt-3 rounded-control border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
                  Έχεις <strong>{openOrders}</strong> παραγγελία(ες) σε εκκρεμότητα.
                </div>
              )}
            </Card>
          </div>
        </>
      ) : (
        <Card>
          <EmptyState
            title={isMaster ? 'Επιλέξτε κατάστημα' : 'Δεν έχετε συνδεδεμένο κατάστημα'}
            text={isMaster
              ? 'Χρησιμοποίησε τον επιλογέα καταστήματος στην κορυφή ή δημιούργησε νέο από «Καταστήματα».'
              : 'Επικοινωνήστε με τον διαχειριστή του καταστήματος.'}
          />
        </Card>
      )}
    </div>
  )
}

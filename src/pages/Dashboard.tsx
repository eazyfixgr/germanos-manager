import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { currentMonth, fmtDate, fmtNum, monthLabel, ORDER_STATUS } from '../lib/constants'
import { computeProjection } from '../lib/projection'
import type { EmployeeTarget, Order, StoreTarget } from '../lib/types'
import { Card, Spinner } from '../components/ui'

interface MasterStats { stores: number; users: number; pending: number }

export default function Dashboard() {
  const { profile, store, isMaster } = useAuth()
  const [storeTarget, setStoreTarget] = useState<StoreTarget | null>(null)
  const [myTarget, setMyTarget] = useState<EmployeeTarget | null>(null)
  const [orders, setOrders] = useState<Order[]>([])
  const [reminders, setReminders] = useState<Order[]>([])
  const [myEntries, setMyEntries] = useState<{ date: string; points: number }[]>([])
  const [myShifts, setMyShifts] = useState<{ date: string; shift_type: string }[]>([])
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
        const [st, mt, ord, rem, pe, ms] = await Promise.all([
          supabase.from('store_targets').select('*').eq('store_id', store.id).eq('month', month).maybeSingle(),
          isMaster
            ? Promise.resolve({ data: null })
            : supabase.from('employee_targets').select('*').eq('user_id', profile.id).eq('month', month).maybeSingle(),
          supabase.from('orders').select('*').eq('store_id', store.id).order('created_at', { ascending: false }).limit(5),
          supabase.from('orders').select('*').eq('store_id', store.id).eq('status', 'ready').lt('updated_at', cutoff).order('updated_at', { ascending: true }),
          supabase.from('point_entries').select('date, points').eq('store_id', store.id).eq('user_id', profile.id).gte('date', start).lt('date', next),
          supabase.from('shifts').select('date, shift_type').eq('store_id', store.id).eq('user_id', profile.id).gte('date', start).lt('date', next),
        ])
        setStoreTarget(st.data as StoreTarget | null)
        setMyTarget((mt.data as EmployeeTarget | null) ?? null)
        setOrders((ord.data as Order[]) ?? [])
        setReminders((rem.data as Order[]) ?? [])
        setMyEntries((pe.data as { date: string; points: number }[]) ?? [])
        setMyShifts((ms.data as { date: string; shift_type: string }[]) ?? [])
      }
      setLoading(false)
    })()
  }, [profile, store, isMaster, month])

  if (loading) return <Spinner />

  const myProj = computeProjection(myEntries, myShifts, month)

  const activeOrders = orders.filter((o) => !['completed', 'cancelled'].includes(o.status))

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold text-slate-900">Καλημέρα, {profile?.full_name.split(' ')[0]}</h1>
      <p className="text-sm text-slate-500">{monthLabel(month)}</p>

      {isMaster && masterStats && (
        <div className="grid gap-4 sm:grid-cols-3">
          <Link to="/stores"><Card className="transition hover:shadow-md">
            <div className="text-sm text-slate-500">Καταστήματα</div>
            <div className="mt-1 text-3xl font-bold text-slate-900">{masterStats.stores}</div>
          </Card></Link>
          <Link to="/employees"><Card className="transition hover:shadow-md">
            <div className="text-sm text-slate-500">Ενεργοί χρήστες</div>
            <div className="mt-1 text-3xl font-bold text-slate-900">{masterStats.users}</div>
          </Card></Link>
          <Link to="/requests"><Card className="transition hover:shadow-md">
            <div className="text-sm text-slate-500">Εκκρεμείς αιτήσεις</div>
            <div className="mt-1 text-3xl font-bold text-slate-900">{masterStats.pending}</div>
          </Card></Link>
        </div>
      )}

      {store ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <Card>
              <div className="text-sm text-slate-500">Στόχος καταστήματος · {store.name}</div>
              <div className="mt-1 text-3xl font-bold text-slate-900">{fmtNum(storeTarget?.store_points ?? 0)}</div>
            </Card>
            {!isMaster && (
              <Card>
                <div className="text-sm text-slate-500">Ο προσωπικός σου στόχος</div>
                <div className="mt-1 text-3xl font-bold text-slate-900">{fmtNum(myTarget?.points ?? 0)}</div>
                <div className="text-xs text-slate-400">
                  Πόντοι μήνα: {fmtNum(myProj.total)} · Projection: {fmtNum(myProj.projection)}
                  {myProj.totalWorking > 0 ? ` (${myProj.elapsed}/${myProj.totalWorking} εργάσιμες)` : ''}
                </div>
              </Card>
            )}
          </div>

          {reminders.length > 0 && (
            <Card className="border-amber-300 bg-amber-50">
              <div className="flex items-center justify-between">
                <h2 className="font-semibold text-amber-900">Υπενθυμίσεις: έτοιμες παραγγελίες χωρίς ενημέρωση πελάτη</h2>
                <Link to="/orders" className="text-sm font-medium text-amber-800 hover:underline">Παραγγελίες</Link>
              </div>
              <ul className="mt-3 divide-y divide-amber-200">
                {reminders.slice(0, 6).map((o) => (
                  <li key={o.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                    <Link to={`/orders/${o.id}`} className="min-w-0 flex-1">
                      <div className="truncate font-medium text-amber-900">{o.product_name}</div>
                      <div className="truncate text-xs text-amber-700">{o.customer_name} · από {fmtDate(o.updated_at)}</div>
                    </Link>
                    <span className="text-xs text-amber-700">+2 ημέρες</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <Card>
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-slate-900">Τελευταίες παραγγελίες</h2>
              <Link to="/orders" className="text-sm font-medium text-slate-700 hover:underline">Όλες</Link>
            </div>
            {orders.length === 0 ? (
              <p className="mt-3 text-sm text-slate-500">Δεν υπάρχουν παραγγελίες ακόμα.</p>
            ) : (
              <ul className="mt-3 divide-y divide-slate-100">
                {orders.map((o) => (
                  <li key={o.id} className="flex items-center justify-between py-2">
                    <Link to={`/orders/${o.id}`} className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium text-slate-800">{o.product_name}</div>
                      <div className="truncate text-xs text-slate-400">{o.customer_name} · {o.product_code}</div>
                    </Link>
                    <span className={`ml-2 rounded-full px-2 py-0.5 text-xs font-medium ${ORDER_STATUS[o.status].color}`}>
                      {ORDER_STATUS[o.status].label}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {activeOrders.length > 0 && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
              Έχεις <strong>{activeOrders.length}</strong> παραγγελία(ες) σε εκκρεμότητα.
            </div>
          )}
        </>
      ) : (
        <Card>
          <p className="text-sm text-slate-500">
            {isMaster
              ? 'Επιλέξτε κατάστημα από πάνω για να δείτε στοιχεία καταστήματος.'
              : 'Δεν έχετε συνδεδεμένο κατάστημα. Επικοινωνήστε με τον διαχειριστή.'}
          </p>
        </Card>
      )}
    </div>
  )
}

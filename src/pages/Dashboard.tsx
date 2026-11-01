import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { currentMonth, fmtNum, monthLabel, ORDER_STATUS } from '../lib/constants'
import type { EmployeeTarget, Order, StoreTarget } from '../lib/types'
import { Card, Spinner } from '../components/ui'

export default function Dashboard() {
  const { profile, store } = useAuth()
  const [storeTarget, setStoreTarget] = useState<StoreTarget | null>(null)
  const [myTarget, setMyTarget] = useState<EmployeeTarget | null>(null)
  const [orders, setOrders] = useState<Order[]>([])
  const [loading, setLoading] = useState(true)

  const month = currentMonth()

  useEffect(() => {
    if (!profile || !store) return
    ;(async () => {
      const [st, mt, ord] = await Promise.all([
        supabase.from('store_targets').select('*').eq('store_id', store.id).eq('month', month).maybeSingle(),
        supabase.from('employee_targets').select('*').eq('user_id', profile.id).eq('month', month).maybeSingle(),
        supabase.from('orders').select('*').eq('store_id', store.id).order('created_at', { ascending: false }).limit(5),
      ])
      setStoreTarget(st.data as StoreTarget | null)
      setMyTarget(mt.data as EmployeeTarget | null)
      setOrders((ord.data as Order[]) ?? [])
      setLoading(false)
    })()
  }, [profile, store, month])

  if (loading) return <Spinner />

  const activeOrders = orders.filter((o) => !['completed', 'cancelled'].includes(o.status))

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold text-slate-900">Καλημέρα, {profile?.full_name.split(' ')[0]}</h1>
      <p className="text-sm text-slate-500">{monthLabel(month)}</p>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <div className="text-sm text-slate-500">Στόχος καταστήματος (πόντοι)</div>
          <div className="mt-1 text-3xl font-bold text-slate-900">{fmtNum(storeTarget?.store_points ?? 0)}</div>
        </Card>
        <Card>
          <div className="text-sm text-slate-500">Ο προσωπικός σου στόχος</div>
          <div className="mt-1 text-3xl font-bold text-slate-900">{fmtNum(myTarget?.points ?? 0)}</div>
          <div className="text-xs text-slate-400">Projection: {fmtNum(myTarget?.projection ?? 0)}</div>
        </Card>
      </div>

      <Card>
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-slate-900">Τελευταίες παραγγελίες</h2>
          <Link to="/orders" className="text-sm font-medium text-slate-700 hover:underline">Όλες →</Link>
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
        <div className="rounded-xl bg-amber-50 border border-amber-200 p-4 text-sm text-amber-800">
          Έχεις <strong>{activeOrders.length}</strong> παραγγελία(ες) σε εκκρεμότητα.
        </div>
      )}
    </div>
  )
}

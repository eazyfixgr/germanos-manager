import { useEffect, useState } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { supabase } from '../lib/supabase'

type IconName =
  | 'home' | 'target' | 'box' | 'calendar' | 'inbox' | 'users' | 'store'
  | 'history' | 'shield' | 'user' | 'trash' | 'upload' | 'building' | 'layers'

function Icon({ name }: { name: IconName }) {
  const common = {
    width: 18,
    height: 18,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  }
  switch (name) {
    case 'home':
      return <svg {...common}><path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" /></svg>
    case 'target':
      return <svg {...common}><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="3" /></svg>
    case 'box':
      return <svg {...common}><path d="M21 8 12 3 3 8v8l9 5 9-5z" /><path d="m3 8 9 5 9-5" /><path d="M12 13v8" /></svg>
    case 'calendar':
      return <svg {...common}><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M8 3v4M16 3v4M3 10h18" /></svg>
    case 'inbox':
      return <svg {...common}><path d="M3 13h5l2 3h4l2-3h5" /><path d="M5 5h14l2 8v5a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-5z" /></svg>
    case 'users':
      return <svg {...common}><circle cx="9" cy="8" r="3.5" /><path d="M3 20a6 6 0 0 1 12 0" /><path d="M16 5.5a3.5 3.5 0 0 1 0 6.5" /><path d="M18 14a6 6 0 0 1 3 5.5" /></svg>
    case 'store':
      return <svg {...common}><path d="M4 9h16v11H4z" /><path d="M3 9l2-5h14l2 5" /><path d="M9 20v-6h6v6" /></svg>
    case 'building':
      return <svg {...common}><rect x="4" y="3" width="16" height="18" rx="1" /><path d="M9 7h2M13 7h2M9 11h2M13 11h2M9 15h2M13 15h2" /></svg>
    case 'history':
      return <svg {...common}><circle cx="12" cy="12" r="8" /><path d="M12 8v4l3 2" /></svg>
    case 'shield':
      return <svg {...common}><path d="M12 3l7 3v6c0 4-3 7-7 9-4-2-7-5-7-9V6z" /><path d="m9 12 2 2 4-4" /></svg>
    case 'user':
      return <svg {...common}><circle cx="12" cy="8" r="4" /><path d="M4 20a8 8 0 0 1 16 0" /></svg>
    case 'trash':
      return <svg {...common}><path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13" /></svg>
    case 'upload':
      return <svg {...common}><path d="M12 16V4M7 8l5-4 5 4" /><path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" /></svg>
    case 'layers':
      return <svg {...common}><path d="m12 3 9 5-9 5-9-5 9-5Z" /><path d="m3 13 9 5 9-5" /><path d="m3 17 9 5 9-5" /></svg>
  }
}

interface Item {
  to: string
  label: string
  icon: IconName
  end: boolean
}

function roleLabel(role?: string, primary?: boolean) {
  if (role === 'master') return 'Master'
  if (role === 'admin') return primary ? 'Κύριος υπεύθυνος' : 'Υπεύθυνος'
  return 'Υπάλληλος'
}

function Badge({ n }: { n: number }) {
  if (n <= 0) return null
  return (
    <span className="ml-auto flex h-5 min-w-5 items-center justify-center rounded-full bg-red-600 px-1.5 text-[11px] font-semibold text-white">
      {n}
    </span>
  )
}

export default function Layout() {
  const {
    profile, store, stores, activeStoreId, setActiveStoreId,
    isAdmin, isMaster, signOut,
  } = useAuth()
  const navigate = useNavigate()
  const [pending, setPending] = useState(0)
  const [reminders, setReminders] = useState(0)

  useEffect(() => {
    if (!isAdmin) return
    let cancelled = false
    async function load() {
      const { count } = await supabase.from('profiles')
        .select('*', { count: 'exact', head: true })
        .eq('active', false).is('deleted_at', null)
      if (!cancelled) setPending(count ?? 0)
    }
    load()
    const ch = supabase.channel('pending-badge')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, load)
      .subscribe()
    return () => { cancelled = true; supabase.removeChannel(ch) }
  }, [isAdmin])

  useEffect(() => {
    if (!store) { setReminders(0); return }
    let cancelled = false
    const cutoff = new Date(Date.now() - 2 * 86400000).toISOString()
    async function load() {
      const { count } = await supabase.from('orders')
        .select('*', { count: 'exact', head: true })
        .eq('store_id', store!.id).eq('status', 'ready').lt('updated_at', cutoff)
      if (!cancelled) setReminders(count ?? 0)
    }
    load()
    const ch = supabase.channel('reminder-badge')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, load)
      .subscribe()
    return () => { cancelled = true; supabase.removeChannel(ch) }
  }, [store])

  const items: Item[] = [
    { to: '/', label: 'Αρχική', icon: 'home', end: true },
    { to: '/targets', label: 'Στόχοι', icon: 'target', end: false },
    { to: '/services', label: 'Υπηρεσίες', icon: 'layers', end: false },
    { to: '/orders', label: 'Παραγγελίες', icon: 'box', end: false },
    { to: '/schedule', label: 'Πρόγραμμα', icon: 'calendar', end: false },
  ]
  if (isAdmin) {
    items.push(
      { to: '/requests', label: 'Αιτήσεις', icon: 'inbox', end: false },
      { to: '/employees', label: 'Προσωπικό', icon: 'users', end: false },
      { to: '/import', label: 'Εισαγωγή', icon: 'upload', end: false },
      { to: '/trash', label: 'Κάδος', icon: 'trash', end: false },
    )
  }
  if (isAdmin && !isMaster) {
    items.push({ to: '/store', label: 'Κατάστημα', icon: 'store', end: false })
  }
  if (isMaster) {
    items.push({ to: '/stores', label: 'Καταστήματα', icon: 'building', end: false })
    items.push({ to: '/security', label: 'Ασφάλεια', icon: 'shield', end: false })
  }
  items.push({ to: '/activity', label: 'Ιστορικό', icon: 'history', end: false })
  items.push({ to: '/account', label: 'Λογαριασμός', icon: 'user', end: false })

  return (
    <div className="flex min-h-screen w-full flex-col bg-slate-100">
      <header className="sticky top-0 z-40 w-full bg-slate-900 text-white shadow">
        <div className="flex w-full flex-wrap items-center justify-between gap-2 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-white/10">
              <Icon name="store" />
            </div>
            <div>
              <div className="text-sm font-semibold leading-tight">Γερμανός Manager</div>
              <div className="text-xs text-slate-400">
                {isMaster ? 'Master · όλα τα καταστήματα' : (store?.name ?? '—')}
                {!isMaster && store?.code ? ` · ${store.code}` : ''}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {isMaster && stores.length > 0 && (
              <select
                value={activeStoreId ?? ''}
                onChange={(e) => setActiveStoreId(e.target.value)}
                className="max-w-[46vw] rounded-lg border border-slate-600 bg-slate-800 px-2 py-1.5 text-xs text-white sm:max-w-none"
                title="Ενεργό κατάστημα"
              >
                {stores.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}{s.code ? ` (${s.code})` : ''}
                  </option>
                ))}
              </select>
            )}
            <div className="hidden text-right sm:block">
              <div className="text-xs font-medium leading-tight">{profile?.full_name}</div>
              <div className="text-[11px] text-slate-400">
                {roleLabel(profile?.role, profile?.is_primary)}
              </div>
            </div>
            <button
              className="rounded-lg bg-slate-700 px-3 py-1.5 text-xs font-medium hover:bg-slate-600"
              onClick={async () => { await signOut(); navigate('/login') }}
            >
              Έξοδος
            </button>
          </div>
        </div>
      </header>

      <div className="flex w-full flex-1 flex-col sm:flex-row">
        <aside className="shrink-0 border-b border-slate-200 bg-white sm:w-56 sm:border-b-0 sm:border-r">
          <nav className="flex gap-1 overflow-x-auto p-2 sm:flex-col sm:gap-0.5 sm:p-3">
            {items.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  `flex shrink-0 items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm font-medium transition ${
                    isActive ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'
                  }`
                }
              >
                <Icon name={item.icon} />
                <span>{item.label}</span>
                {item.to === '/requests' && <Badge n={pending} />}
                {item.to === '/orders' && <Badge n={reminders} />}
              </NavLink>
            ))}
          </nav>
        </aside>

        <main className="min-w-0 flex-1 p-4 sm:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  )
}

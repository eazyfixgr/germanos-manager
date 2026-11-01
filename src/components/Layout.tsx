import { useEffect, useState } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { supabase } from '../lib/supabase'

type IconName = 'home' | 'target' | 'box' | 'calendar' | 'inbox' | 'users' | 'store' | 'history'

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
    case 'history':
      return <svg {...common}><circle cx="12" cy="12" r="8" /><path d="M12 8v4l3 2" /></svg>
  }
}

const navItems: { to: string; label: string; icon: IconName; end: boolean; adminOnly?: boolean }[] = [
  { to: '/', label: 'Αρχική', icon: 'home', end: true },
  { to: '/targets', label: 'Στόχοι', icon: 'target', end: false },
  { to: '/orders', label: 'Παραγγελίες', icon: 'box', end: false },
  { to: '/schedule', label: 'Πρόγραμμα', icon: 'calendar', end: false },
  { to: '/requests', label: 'Αιτήσεις', icon: 'inbox', end: false, adminOnly: true },
  { to: '/employees', label: 'Υπάλληλοι', icon: 'users', end: false, adminOnly: true },
  { to: '/store', label: 'Κατάστημα', icon: 'store', end: false, adminOnly: true },
  { to: '/activity', label: 'Ιστορικό', icon: 'history', end: false },
]

function roleLabel(role?: string, primary?: boolean) {
  if (role === 'master') return 'Master'
  if (role === 'admin') return primary ? 'Κύριος υπεύθυνος' : 'Υπεύθυνος'
  return 'Υπάλληλος'
}

export default function Layout() {
  const { profile, store, isAdmin, isPrimary, isMaster, signOut } = useAuth()
  const navigate = useNavigate()
  const [pending, setPending] = useState(0)

  useEffect(() => {
    if (!isAdmin) return
    let cancelled = false
    async function loadCount() {
      let q = supabase.from('profiles').select('*', { count: 'exact', head: true }).eq('active', false)
      if (!isPrimary) q = q.eq('role', 'user')
      const { count } = await q
      if (!cancelled) setPending(count ?? 0)
    }
    loadCount()
    const channel = supabase
      .channel('pending-badge')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, loadCount)
      .subscribe()
    return () => {
      cancelled = true
      supabase.removeChannel(channel)
    }
  }, [isAdmin, isPrimary])

  const items = navItems.filter((i) => !i.adminOnly || isAdmin)

  return (
    <div className="flex min-h-screen w-full flex-col bg-slate-100">
      <header className="sticky top-0 z-40 w-full bg-slate-900 text-white shadow">
        <div className="flex w-full items-center justify-between px-4 py-3 sm:px-6">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-white/10">
              <Icon name="store" />
            </div>
            <div>
              <div className="text-sm font-semibold leading-tight">Γερμανός Manager</div>
              <div className="text-xs text-slate-400">
                {store?.name ?? '—'}
                {store?.code ? ` · ${store.code}` : ''}
                {isMaster ? ' · Master' : ''}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="hidden text-right sm:block">
              <div className="text-xs font-medium leading-tight">{profile?.full_name}</div>
              <div className="text-[11px] text-slate-400">
                {roleLabel(profile?.role, profile?.is_primary)}
              </div>
            </div>
            <button
              className="rounded-lg bg-slate-700 px-3 py-1.5 text-xs font-medium hover:bg-slate-600"
              onClick={async () => {
                await signOut()
                navigate('/login')
              }}
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
                    isActive
                      ? 'bg-slate-900 text-white'
                      : 'text-slate-600 hover:bg-slate-100'
                  }`
                }
              >
                <Icon name={item.icon} />
                <span>{item.label}</span>
                {item.to === '/requests' && pending > 0 && (
                  <span className="ml-auto flex h-5 min-w-5 items-center justify-center rounded-full bg-red-600 px-1.5 text-[11px] font-semibold text-white">
                    {pending}
                  </span>
                )}
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

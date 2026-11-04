import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { supabase } from '../lib/supabase'
import type { AccountType, Profile, Store } from '../lib/types'

interface AuthState {
  session: { user: { id: string; email: string } } | null
  profile: Profile | null
  store: Store | null
  stores: Store[]
  activeStoreId: string | null
  setActiveStoreId: (id: string) => void
  loading: boolean
  isMaster: boolean
  isAdmin: boolean
  isPrimary: boolean
  signIn: (email: string, password: string) => Promise<{ error: string | null }>
  signUp: (
    email: string,
    password: string,
    fullName: string,
    accountType: AccountType,
    storeName: string,
    storeCode: string,
  ) => Promise<{ error: string | null }>
  signOut: () => Promise<void>
  refreshProfile: () => Promise<void>
}

const AuthContext = createContext<AuthState | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<AuthState['session']>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [stores, setStores] = useState<Store[]>([])
  const [activeStoreId, setActiveStoreIdState] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const store = useMemo(
    () => stores.find((s) => s.id === activeStoreId) ?? null,
    [stores, activeStoreId],
  )

  async function loadProfile(userId: string) {
    const { data } = await supabase.from('profiles').select('*').eq('id', userId).single()
    if (!data) return
    const p = data as Profile
    setProfile(p)

    if (p.role === 'master') {
      const { data: st } = await supabase
        .from('stores')
        .select('*')
        .is('deleted_at', null)
        .order('name')
      const list = (st as Store[]) ?? []
      setStores(list)
      const saved = localStorage.getItem('gm_active_store')
      const initial = list.find((s) => s.id === saved)?.id ?? list[0]?.id ?? null
      setActiveStoreIdState(initial)
    } else {
      const { data: st } = await supabase
        .from('stores')
        .select('*')
        .is('deleted_at', null)
        .order('name')
      let list = (st as Store[]) ?? []
      if (list.length === 0 && p.store_id) {
        const { data: own } = await supabase.from('stores').select('*').eq('id', p.store_id).single()
        if (own) list = [own as Store]
      }
      setStores(list)
      const preferred = p.active_store_id && list.some((s) => s.id === p.active_store_id)
        ? p.active_store_id
        : p.store_id && list.some((s) => s.id === p.store_id)
          ? p.store_id
          : list[0]?.id ?? null
      setActiveStoreIdState(preferred)
    }
  }

  async function refreshProfile() {
    if (session?.user?.id) await loadProfile(session.user.id)
  }

  function setActiveStoreId(id: string) {
    if (profile?.role === 'master') {
      setActiveStoreIdState(id)
      localStorage.setItem('gm_active_store', id)
      return
    }
    void (async () => {
      const { error } = await supabase.rpc('set_active_store', { p_store: id })
      if (error) return
      setActiveStoreIdState(id)
      localStorage.setItem('gm_active_store', id)
      setProfile((prev) => (prev ? { ...prev, active_store_id: id } : prev))
    })()
  }

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      const s = data.session
      if (s) {
        setSession({ user: { id: s.user.id, email: s.user.email ?? '' } })
        loadProfile(s.user.id)
      }
      setLoading(false)
    })

    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      if (s) {
        setSession({ user: { id: s.user.id, email: s.user.email ?? '' } })
        loadProfile(s.user.id)
      } else {
        setSession(null)
        setProfile(null)
        setStores([])
        setActiveStoreIdState(null)
      }
    })

    return () => sub.subscription.unsubscribe()
  }, [])

  async function signIn(email: string, password: string) {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) return { error: 'Λάθος email ή κωδικός.' }
    return { error: null }
  }

  async function signUp(
    email: string,
    password: string,
    fullName: string,
    accountType: AccountType,
    storeName: string,
    storeCode: string,
  ) {
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          full_name: fullName.trim(),
          account_type: accountType,
          store_name: storeName.trim(),
          store_code: storeCode.trim().toUpperCase(),
        },
      },
    })
    if (error) {
      const msg = error.message.toLowerCase()
      if (msg.includes('already registered')) {
        return { error: 'Υπάρχει ήδη λογαριασμός με αυτό το email.' }
      }
      if (msg.includes('store_code_not_found')) {
        return { error: 'Δεν βρέθηκε κατάστημα με αυτόν τον κωδικό.' }
      }
      if (msg.includes('store_name_required')) {
        return { error: 'Απαιτείται όνομα καταστήματος.' }
      }
      if (msg.includes('store_code_required')) {
        return { error: 'Απαιτείται κωδικός καταστήματος.' }
      }
      return { error: error.message }
    }
    return { error: null }
  }

  async function signOut() {
    await supabase.auth.signOut()
  }

  return (
    <AuthContext.Provider
      value={{
        session,
        profile,
        store,
        stores,
        activeStoreId,
        setActiveStoreId,
        loading,
        isMaster: profile?.role === 'master',
        isAdmin: profile?.role === 'admin' || profile?.role === 'master',
        isPrimary:
          profile?.role === 'master' || (profile?.role === 'admin' && profile.is_primary === true),
        signIn,
        signUp,
        signOut,
        refreshProfile,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}

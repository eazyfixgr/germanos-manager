import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { supabase } from '../lib/supabase'
import type { AccountType, Profile, Store } from '../lib/types'
import { effectivePermissions, type OrganizationRole, type StoreCapabilities } from './access'
import { supportSessionFromRow, type SupportSession, type SupportSessionRow, type SupportStore } from './support'

interface AuthState {
  session: { user: { id: string; email: string } } | null
  profile: Profile | null
  store: Store | null
  stores: Store[]
  activeStoreId: string | null
  setActiveStoreId: (id: string) => Promise<{ error: string | null }>
  loading: boolean
  switching: boolean
  authError: string | null
  isMaster: boolean
  isAdmin: boolean
  isPrimary: boolean
  canEditPoints: boolean
  orgRole: OrganizationRole | null
  supportSession: SupportSession | null
  supportStores: SupportStore[]
  startSupport: (storeId: string, reason: string, minutes: number) => Promise<{ error: string | null }>
  endSupport: () => Promise<{ error: string | null }>
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
  const [switching, setSwitching] = useState(false)
  const [authError, setAuthError] = useState<string | null>(null)
  const [capabilities, setCapabilities] = useState<StoreCapabilities | null>(null)
  const [supportSession, setSupportSession] = useState<SupportSession | null>(null)
  const [supportStores, setSupportStores] = useState<SupportStore[]>([])
  const requestId = useRef(0)
  const switchLock = useRef(false)

  const store = useMemo(
    () => stores.find((s) => s.id === activeStoreId) ?? null,
    [stores, activeStoreId],
  )

  const loadProfile = useCallback(async (userId: string): Promise<string | null> => {
    const generation = ++requestId.current
    setLoading(true)
    setAuthError(null)
    setCapabilities(null)
    try {
      const { data, error } = await supabase.from('profiles').select('*').eq('id', userId).single()
      if (error || !data) throw new Error('Δεν ήταν δυνατή η φόρτωση του λογαριασμού.')
      const p = data as Profile
      if (!p.active || p.deleted_at) {
        if (generation !== requestId.current) return 'Η συνεδρία άλλαξε. Δοκιμάστε ξανά.'
        setProfile(p); setStores([]); setActiveStoreIdState(null); setSupportSession(null); setSupportStores([])
        return null
      }
      let nextSupport: SupportSession | null = null
      let directory: SupportStore[] = []
      if (p.role === 'master') {
        const startedAt = Date.now()
        const [sessionResult, directoryResult] = await Promise.all([
          supabase.rpc('current_support_session'), supabase.rpc('list_support_stores'),
        ])
        if (sessionResult.error || directoryResult.error) throw new Error('Δεν ήταν δυνατή η επιβεβαίωση πρόσβασης υποστήριξης.')
        directory = (directoryResult.data ?? []) as SupportStore[]
        const row = sessionResult.data?.[0] as SupportSessionRow | undefined
        nextSupport = row ? supportSessionFromRow(row, startedAt) : null
        if (nextSupport && nextSupport.localDeadline <= Date.now()) nextSupport = null
      }
      const { data: st, error: storeError } = p.role === 'master' && !nextSupport
        ? { data: [], error: null }
        : await supabase.from('stores').select('*').is('deleted_at', null).order('name')
      if (storeError) throw new Error('Δεν ήταν δυνατή η φόρτωση των καταστημάτων.')
      const list = (st as Store[]) ?? []
      const preferredId = p.active_store_id ?? (p.role === 'master' ? localStorage.getItem('gm_active_store') : null)
      const selected = p.role === 'master' ? nextSupport?.store_id ?? null
        : list.find((s) => s.id === preferredId)?.id
          ?? list.find((s) => s.id === p.store_id)?.id ?? list[0]?.id ?? null
      if (generation !== requestId.current) return 'Η συνεδρία άλλαξε. Δοκιμάστε ξανά.'
      // Keep the DB's current_store aligned with the UI after a revoked membership.
      if (selected && p.role !== 'master' && selected !== p.active_store_id) {
        const { error: switchError } = await supabase.rpc('set_active_store', { p_store: selected })
        if (switchError) throw new Error('Δεν ήταν δυνατή η ενεργοποίηση καταστήματος.')
        p.active_store_id = selected
      }
      let nextCaps: StoreCapabilities | null = null
      if (selected) {
        const { data: caps, error: capsError } = await supabase.rpc('store_capabilities', { p_store: selected })
        if (capsError || !caps?.[0]) {
          throw new Error('Δεν ήταν δυνατή η επιβεβαίωση δικαιωμάτων. Ελέγξτε ότι εφαρμόστηκαν τα νέα migrations.')
        }
        nextCaps = caps[0] as StoreCapabilities
      }
      if (generation !== requestId.current) return 'Η συνεδρία άλλαξε. Δοκιμάστε ξανά.'
      setProfile(p); setStores(list); setActiveStoreIdState(selected); setCapabilities(nextCaps)
      setSupportSession(nextSupport); setSupportStores(directory)
      return null
    } catch (error) {
      if (generation !== requestId.current) return 'Η συνεδρία άλλαξε. Δοκιμάστε ξανά.'
      setProfile(null); setStores([]); setActiveStoreIdState(null); setCapabilities(null)
      setSupportSession(null); setSupportStores([])
      const message = error instanceof Error ? error.message : 'Σφάλμα σύνδεσης με τη βάση.'
      setAuthError(message)
      return message
    } finally {
      if (generation === requestId.current) setLoading(false)
    }
  }, [])

  async function refreshProfile() {
    if (session?.user?.id) await loadProfile(session.user.id)
  }

  async function setActiveStoreId(id: string) {
    if (profile?.role === 'master') return { error: 'Επιλέξτε κατάστημα από την Πρόσβαση υποστήριξης.' }
    if (switchLock.current || !session) return { error: 'Η αλλαγή καταστήματος βρίσκεται σε εξέλιξη.' }
    switchLock.current = true
    setSwitching(true)
    const generation = requestId.current
    try {
      const { error } = await supabase.rpc('set_active_store', { p_store: id })
      if (error) return { error: error.message }
      if (generation !== requestId.current) return { error: 'Η συνεδρία άλλαξε. Δοκιμάστε ξανά.' }
      localStorage.setItem('gm_active_store', id)
      return { error: await loadProfile(session.user.id) }
    } catch {
      return { error: 'Δεν ήταν δυνατή η αλλαγή καταστήματος. Δοκιμάστε ξανά.' }
    } finally {
      switchLock.current = false
      setSwitching(false)
    }
  }

  async function mutateSupport(action: 'start' | 'end', storeId?: string, reason?: string, minutes?: number) {
    if (switchLock.current || !session) return { error: 'Μια αλλαγή πρόσβασης βρίσκεται σε εξέλιξη.' }
    if (action === 'end' && !supportSession) return { error: null }
    switchLock.current = true; setSwitching(true)
    const generation = requestId.current
    try {
      const result = action === 'start'
        ? await supabase.rpc('start_support_access', { p_store: storeId, p_reason: reason, p_minutes: minutes })
        : await supabase.rpc('end_support_access', { p_session: supportSession!.id })
      if (result.error) return { error: result.error.message }
      if (generation !== requestId.current) return { error: 'Η συνεδρία άλλαξε. Ελέγξτε την τρέχουσα πρόσβαση.' }
      return { error: await loadProfile(session.user.id) }
    } catch { return { error: 'Δεν ήταν δυνατή η αλλαγή πρόσβασης υποστήριξης.' } }
    finally { switchLock.current = false; setSwitching(false) }
  }

  // Expiry clears tenant context immediately; polling/focus handles other tabs
  // and server revocation without periodically unmounting active forms.
  useEffect(() => {
    if (!supportSession) return
    const expire = () => {
      requestId.current++
      setSupportSession(null); setCapabilities(null); setStores([]); setActiveStoreIdState(null)
      setLoading(false)
    }
    const timer = setTimeout(expire, Math.max(0, supportSession.localDeadline - Date.now()))
    return () => clearTimeout(timer)
  }, [supportSession])

  useEffect(() => {
    if (profile?.role !== 'master' || !profile.active) return
    let disposed = false
    let checking = false
    const check = async () => {
      if (checking) return
      checking = true
      const generation = requestId.current
      const startedAt = Date.now()
      try {
        const { data, error } = await supabase.rpc('current_support_session')
        if (disposed || generation !== requestId.current) return
        if (error) throw error
        const row = data?.[0] as SupportSessionRow | undefined
        if ((row?.id ?? null) !== (supportSession?.id ?? null)) {
          await loadProfile(profile.id)
        } else if (row) setSupportSession(supportSessionFromRow(row, startedAt))
      } catch {
        if (!disposed && generation === requestId.current) {
          requestId.current++
          setSupportSession(null); setCapabilities(null); setStores([]); setActiveStoreIdState(null)
          setAuthError('Δεν ήταν δυνατή η επαλήθευση της συνεδρίας υποστήριξης. Δοκιμάστε ξανά.')
        }
      } finally { checking = false }
    }
    const onFocus = () => { void check() }
    const timer = setInterval(onFocus, 15000)
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onFocus)
    return () => { disposed = true; clearInterval(timer); window.removeEventListener('focus', onFocus); document.removeEventListener('visibilitychange', onFocus) }
  }, [profile?.id, profile?.role, profile?.active, supportSession?.id, loadProfile])

  useEffect(() => {
    let disposed = false
    let receivedAuthEvent = false
    let lastUserId: string | null = null
    const timers = new Set<ReturnType<typeof setTimeout>>()
    const receiveSession = (s: Awaited<ReturnType<typeof supabase.auth.getSession>>['data']['session']) => {
      if (disposed) return
      timers.forEach(clearTimeout)
      timers.clear()
      requestId.current++
      if ((s?.user.id ?? null) !== lastUserId) {
        lastUserId = s?.user.id ?? null
        setProfile(null); setStores([]); setActiveStoreIdState(null)
        setCapabilities(null); setSupportSession(null); setSupportStores([])
      }
      if (s) {
        setSession({ user: { id: s.user.id, email: s.user.email ?? '' } })
        setLoading(true)
        // Never await Supabase calls within the auth callback (it owns an auth lock).
        const timer = setTimeout(() => { timers.delete(timer); if (!disposed) void loadProfile(s.user.id) }, 0)
        timers.add(timer)
      } else {
        setSession(null)
        setProfile(null)
        setStores([])
        setActiveStoreIdState(null)
        setCapabilities(null)
        setSupportSession(null)
        setSupportStores([])
        setAuthError(null)
        setLoading(false)
      }
    }
    supabase.auth.getSession().then(({ data, error }) => {
      if (disposed || receivedAuthEvent) return
      if (error) { setAuthError('Δεν ήταν δυνατή η φόρτωση της συνεδρίας.'); setLoading(false); return }
      receiveSession(data.session)
    }).catch(() => { if (!disposed && !receivedAuthEvent) { setAuthError('Σφάλμα φόρτωσης συνεδρίας.'); setLoading(false) } })
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      receivedAuthEvent = true
      receiveSession(s)
    })

    return () => {
      disposed = true
      requestId.current++
      timers.forEach(clearTimeout)
      sub.subscription.unsubscribe()
    }
  }, [loadProfile])

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
    if (supportSession) {
      // Best-effort explicit end; the server TTL remains authoritative offline.
      try { await supabase.rpc('end_support_access', { p_session: supportSession.id }) } catch { /* Continue logout. */ }
    }
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
        switching,
        authError,
        supportSession,
        supportStores,
        startSupport: (id, reason, minutes) => mutateSupport('start', id, reason, minutes),
        endSupport: () => mutateSupport('end'),
        ...effectivePermissions(profile, capabilities),
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

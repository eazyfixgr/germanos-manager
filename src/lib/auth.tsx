import { createContext, useContext, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { supabase } from '../lib/supabase'
import type { AccountType, Profile, Store } from '../lib/types'

interface AuthState {
  session: { user: { id: string; email: string } } | null
  profile: Profile | null
  store: Store | null
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
  const [store, setStore] = useState<Store | null>(null)
  const [loading, setLoading] = useState(true)

  async function loadProfile(userId: string) {
    const { data } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single()
    if (data) {
      setProfile(data as Profile)
      if (data.store_id) {
        const { data: st } = await supabase
          .from('stores')
          .select('*')
          .eq('id', data.store_id)
          .single()
        if (st) setStore(st as Store)
      }
    }
  }

  async function refreshProfile() {
    if (session?.user?.id) await loadProfile(session.user.id)
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
        setStore(null)
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
    // Το profile/κατάστημα δημιουργούνται από trigger στη βάση με βάση τα metadata.
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

import { createContext, useContext, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { supabase } from '../lib/supabase'
import type { Profile, Store } from '../lib/types'

interface AuthState {
  session: { user: { id: string; email: string } } | null
  profile: Profile | null
  store: Store | null
  loading: boolean
  signIn: (email: string, password: string) => Promise<{ error: string | null }>
  signUp: (email: string, password: string, fullName: string, storeName: string) => Promise<{ error: string | null }>
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

  async function signUp(email: string, password: string, fullName: string, storeName: string) {
    const { data, error } = await supabase.auth.signUp({ email, password })
    if (error) {
      if (error.message.includes('already registered')) {
        return { error: 'Υπάρχει ήδη λογαριασμός με αυτό το email.' }
      }
      return { error: error.message }
    }

    const userId = data.user?.id
    if (!userId) return { error: 'Αποτυχία εγγραφής.' }

    // Δημιουργία ή εύρεση καταστήματος
    let storeId: string | null = null
    const { data: existing } = await supabase
      .from('stores')
      .select('id')
      .eq('name', storeName.trim())
      .maybeSingle()
    if (existing) {
      storeId = existing.id
    } else {
      const { data: created } = await supabase
        .from('stores')
        .insert({ name: storeName.trim() })
        .select('id')
        .single()
      storeId = created?.id ?? null
    }

    if (!storeId) return { error: 'Αποτυχία δημιουργίας καταστήματος.' }

    const { error: profileErr } = await supabase
      .from('profiles')
      .insert({
        id: userId,
        full_name: fullName.trim(),
        email,
        store_id: storeId,
        role: 'user',
        active: false,
      })
    if (profileErr) return { error: profileErr.message }

    return { error: null }
  }

  async function signOut() {
    await supabase.auth.signOut()
  }

  return (
    <AuthContext.Provider
      value={{ session, profile, store, loading, signIn, signUp, signOut, refreshProfile }}
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

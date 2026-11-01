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
    // Το profile και το κατάστημα δημιουργούνται αυτόματα από trigger στη βάση,
    // χρησιμοποιώντας τα metadata που στέλνουμε εδώ.
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          full_name: fullName.trim(),
          store_name: storeName.trim(),
        },
      },
    })
    if (error) {
      if (error.message.toLowerCase().includes('already registered')) {
        return { error: 'Υπάρχει ήδη λογαριασμός με αυτό το email.' }
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

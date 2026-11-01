import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

if (!url || !anonKey || url.includes('YOUR-PROJECT') || anonKey.includes('YOUR-ANON-KEY')) {
  throw new Error(
    'Λείπει η ρύθμιση του Supabase. Αντίγραψε το .env.example σε .env και βάλε το URL και το anon key του project σου.',
  )
}

export const supabase = createClient(url, anonKey)

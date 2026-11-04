import { supabase } from './supabase'

export async function logActivity(action: string, detail?: string, storeId?: string) {
  const { data: user } = await supabase.auth.getUser()
  const userId = user.user?.id
  if (!userId) return

  let sid: string | null | undefined = storeId
  if (!sid) {
    const { data: p } = await supabase.from('profiles').select('store_id').eq('id', userId).single()
    sid = p?.store_id
  }
  if (!sid && typeof localStorage !== 'undefined') {
    sid = localStorage.getItem('gm_active_store') ?? undefined
  }
  if (!sid) return

  await supabase.from('activity_log').insert({
    actor_id: userId,
    store_id: sid,
    action,
    detail: detail ?? null,
  })
}

import { supabase } from '../supabase'
import type { DateRange } from './dates'
import type { ScheduleData, ScheduleScope } from './model'

export async function readSchedule(storeId: string, range: DateRange, scope: ScheduleScope): Promise<ScheduleData> {
  const { data, error } = await supabase.rpc('read_schedule', {
    p_store: storeId, p_start: range.start, p_end: range.end, p_scope: scope,
  })
  if (error) throw new Error(error.code === 'PGRST202'
    ? 'Η νέα προβολή Προγράμματος απαιτεί το migration workforce_read_model.'
    : 'Δεν ήταν δυνατή η φόρτωση του προγράμματος. Ελέγξτε τη σύνδεση και την πρόσβασή σας.')
  if (!data || data.store_id !== storeId || data.start !== range.start || data.end !== range.end || data.scope !== scope
    || typeof data.can_manage !== 'boolean'
    || typeof data.min_staff !== 'number' || data.min_staff < 0
    || !['staff', 'shifts', 'leaves', 'patterns', 'calendar'].every((key) => Array.isArray(data[key]))) {
    throw new Error('Η απάντηση προγράμματος δεν αντιστοιχεί στην επιλεγμένη περίοδο.')
  }
  if (data.workforce_schema === 2 && (!Array.isArray(data.templates) || !Array.isArray(data.requirements))) throw new Error('Ελλιπή δεδομένα ρυθμίσεων διαστημάτων.')
  return data as ScheduleData
}

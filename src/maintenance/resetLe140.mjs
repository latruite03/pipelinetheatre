import { getSupabaseAdmin } from '../lib/supabase.mjs'

const supabase = getSupabaseAdmin()

const source = 'le140'
const from = '2026-01-01'
const to = '2026-06-30'

const { data, error } = await supabase
  .from('representations')
  .delete()
  .eq('source', source)
  .gte('date', from)
  .lte('date', to)
  .select('id,date,heure,titre')

if (error) throw new Error(error.message)

console.log(`Deleted ${data?.length || 0} rows for source=${source} (${from}..${to})`)

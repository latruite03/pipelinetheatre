import { getSupabaseAdmin } from '../lib/supabase.mjs'

export async function upsertRepresentations(reps) {
  const supabase = getSupabaseAdmin()

  // NOTE: requires DB columns: source, source_url, fingerprint (unique), plus existing ones.
  const { data, error } = await supabase
    .from('representations')
    .upsert(reps, { onConflict: 'fingerprint' })
    .select('id,fingerprint')

  if (error) throw new Error(error.message)

  return {
    upserted: data?.length || 0,
  }
}

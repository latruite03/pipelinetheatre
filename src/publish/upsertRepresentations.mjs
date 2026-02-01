import { getSupabaseAdmin } from '../lib/supabase.mjs'

export async function upsertRepresentations(reps) {
  const supabase = getSupabaseAdmin()

  // De-dup by fingerprint to avoid ON CONFLICT affecting the same row twice
  const seen = new Map()
  for (const r of reps || []) {
    if (!r?.fingerprint) continue
    if (!seen.has(r.fingerprint)) seen.set(r.fingerprint, r)
  }
  const unique = Array.from(seen.values())

  // NOTE: requires DB columns: source, source_url, fingerprint (unique), plus existing ones.
  const { data, error } = await supabase
    .from('representations')
    .upsert(unique, { onConflict: 'fingerprint' })
    .select('id,fingerprint')

  if (error) throw new Error(error.message)

  return {
    upserted: data?.length || 0,
  }
}

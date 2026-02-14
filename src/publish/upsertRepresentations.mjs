import { getSupabaseAdmin } from '../lib/supabase.mjs'
import { fetchOgImage } from '../enrich/ogImage.mjs'

export async function upsertRepresentations(reps) {
  const supabase = getSupabaseAdmin()

  // Safety: never publish explicit non-theatre items
  const incoming = (reps || []).filter((r) => r && r.is_theatre !== false)

  // De-dup by fingerprint to avoid ON CONFLICT affecting the same row twice
  const seen = new Map()
  for (const r of incoming) {
    if (!r?.fingerprint) continue
    if (!seen.has(r.fingerprint)) seen.set(r.fingerprint, r)
  }
  const unique = Array.from(seen.values())

  // Try to recover missing images via og:image when URL exists (limited per run)
  const maxRecover = Number(process.env.IMAGE_RECOVERY_MAX || 20)
  let recovered = 0
  for (const r of unique) {
    if (recovered >= maxRecover) break
    if (!r?.image_url && r?.url) {
      const og = await fetchOgImage(r.url)
      if (og) {
        r.image_url = og
        recovered += 1
      }
    }
  }

  // NOTE: requires DB columns: source, source_url, fingerprint (unique), plus existing ones.
  const { data, error } = await supabase
    .from('representations')
    .upsert(unique, { onConflict: 'fingerprint' })
    .select('id,fingerprint')

  if (error) throw new Error(error.message)

  return {
    upserted: data?.length || 0,
    imagesRecovered: recovered,
  }
}


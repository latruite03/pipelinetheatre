import { getSupabaseAdmin } from '../lib/supabase.mjs'
import { fetchOgImage } from '../enrich/ogImage.mjs'

export async function upsertRepresentations(reps) {
  const supabase = getSupabaseAdmin()

  // Agenda policy: keep only upcoming items (>= today) unless overridden.
  const MIN_DATE = process.env.MIN_DATE || new Date().toISOString().slice(0, 10)

  // Safety: never publish explicit non-theatre items
  const incoming = (reps || [])
    .filter((r) => r && r.is_theatre !== false)
    .filter((r) => !r?.date || r.date >= MIN_DATE)

  function normUrl(u) {
    if (!u) return ''
    try {
      const url = new URL(String(u))
      url.hash = ''
      for (const k of ['utm_source','utm_medium','utm_campaign','utm_term','utm_content','fbclid','gclid']) {
        url.searchParams.delete(k)
      }
      return url.toString()
    } catch {
      return String(u).split('#')[0]
    }
  }

  function score(r) {
    // Prefer richer rows when we must choose between duplicates
    return (
      (r?.image_url ? 100 : 0) +
      Math.min(80, String(r?.description || '').length / 10) +
      Math.min(20, String(r?.titre || '').length / 10)
    )
  }

  // Functional de-dup (pre-fingerprint): same canonical URL + date + time + theatre.
  // This prevents duplicates when a connector changes its title formatting between runs
  // (e.g. KVS: "M.O.L." vs "M.O.L. (…)") but the event URL is identical.
  const byEventKey = new Map()
  for (const r of incoming) {
    const key = [
      normUrl(r?.url || r?.source_url),
      r?.date || '',
      r?.heure || '',
      String(r?.theatre_nom || '').trim().toLowerCase(),
    ].join('|')

    if (!byEventKey.has(key)) {
      byEventKey.set(key, r)
      continue
    }

    const cur = byEventKey.get(key)
    if (score(r) > score(cur)) byEventKey.set(key, r)
  }
  const deduped = Array.from(byEventKey.values())

  // De-dup by fingerprint to avoid ON CONFLICT affecting the same row twice
  const seen = new Map()
  for (const r of deduped) {
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

  // Normalize payload: keep only columns that exist in `representations`.
  // (Some connectors may emit extra fields like `ticket_url`.)
  const ALLOWED = [
    'source',
    'source_url',
    'fingerprint',
    'date',
    'heure',
    'titre',
    'theatre_nom',
    'theatre_adresse',
    'url',
    'genre',
    'style',
    'description',
    'image_url',
    'is_theatre',
  ]

  const cleaned = unique.map((r) => {
    const out = {}
    for (const k of ALLOWED) {
      if (r[k] !== undefined) out[k] = r[k]
    }
    return out
  })

  // NOTE: requires DB columns: source, source_url, fingerprint (unique), plus existing ones.
  const { data, error } = await supabase
    .from('representations')
    .upsert(cleaned, { onConflict: 'fingerprint' })
    .select('id,fingerprint')

  if (error) throw new Error(error.message)

  return {
    upserted: data?.length || 0,
    imagesRecovered: recovered,
  }
}


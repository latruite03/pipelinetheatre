import { getSupabaseAdmin } from '../lib/supabase.mjs'
import { fetchOgImage } from '../enrich/ogImage.mjs'

export async function upsertRepresentations(reps) {
  const supabase = getSupabaseAdmin()

  // Agenda policy: keep only upcoming items (>= today) unless overridden.
  const MIN_DATE = process.env.MIN_DATE || new Date().toISOString().slice(0, 10)

  // Safety: never publish explicit non-theatre items
  // + hard denylist for non-theatre/noise venues
  const DENY_VENUE_RE = /(brigitt|marni)/i

  // Guardrail #1: if a single venue emits an absurd number of items for the same day,
  // it is very likely a scraping failure (e.g. sitemap/index pages mis-parsed as events).
  const MAX_ITEMS_PER_VENUE_DAY = Number(process.env.MAX_ITEMS_PER_VENUE_DAY || 12)

  // Guardrail #2: if the description clearly mentions a different date range than rep.date,
  // treat it as a bad extraction and do not publish.
  function monthToNum(word) {
    const m = String(word || '')
      .toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/\.$/, '')
      .trim()
    const map = {
      janvier: '01',
      fevrier: '02',
      mars: '03',
      avril: '04',
      mai: '05',
      juin: '06',
      juillet: '07',
      aout: '08',
      septembre: '09',
      octobre: '10',
      novembre: '11',
      decembre: '12',
    }
    return map[m] || null
  }

  function extractRangeFromDescription(desc) {
    const t = String(desc || '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&#8217;|&#039;/g, "'")
      .replace(/\s+/g, ' ')
      .trim()

    // Examples: "21 octobre > 2 novembre" / "21 octobre au 2 novembre" / "21 octobre - 2 novembre"
    const re = /(\d{1,2})\s+([\p{L}.]+)\s*(?:>|-|>|au|jusqu'au|jusqu	2)\s*(\d{1,2})\s+([\p{L}.]+)/iu
    const m = re.exec(t)
    if (!m) return null

    const d1 = String(m[1]).padStart(2, '0')
    const m1 = monthToNum(m[2])
    const d2 = String(m[3]).padStart(2, '0')
    const m2 = monthToNum(m[4])
    if (!m1 || !m2) return null

    // Year inference for our season window (2026H1 mostly; Oct/Nov likely 2025)
    const y1 = Number(m1) >= 7 ? 2025 : 2026
    const y2 = Number(m2) >= 7 ? 2025 : 2026

    const start = `${y1}-${m1}-${d1}`
    const end = `${y2}-${m2}-${d2}`
    return { start, end }
  }

  function looksLikeDateMismatch(rep) {
    if (!rep?.date) return false
    const r = extractRangeFromDescription(rep.description)
    if (!r) return false
    // If rep.date is outside the mentioned range by a lot, it's wrong.
    return rep.date < r.start || rep.date > r.end
  }

  const incomingAll = (reps || [])
    .filter((r) => r)
    .map((r) => {
      if (DENY_VENUE_RE.test(String(r?.theatre_nom || ''))) return { ...r, is_theatre: false }
      if (looksLikeDateMismatch(r)) return { ...r, is_theatre: false }
      return r
    })
    .filter((r) => r.is_theatre !== false)
    .filter((r) => !r?.date || r.date >= MIN_DATE)

  // Apply venue/day volume guardrail
  const counts = new Map()
  for (const r of incomingAll) {
    const k = `${String(r?.theatre_nom || '').toLowerCase().trim()}|${r?.date || ''}`
    counts.set(k, (counts.get(k) || 0) + 1)
  }

  const incoming = incomingAll.filter((r) => {
    const k = `${String(r?.theatre_nom || '').toLowerCase().trim()}|${r?.date || ''}`
    return (counts.get(k) || 0) <= MAX_ITEMS_PER_VENUE_DAY
  })

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

  function normTitle(t) {
    return String(t || '')
      .toLowerCase()
      .replace(/[’‘`´]/g, "'")
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
  }

  // Functional de-dup (pre-fingerprint) — stage 1:
  // same canonical URL + date + time + theatre.
  // Prevents duplicates when only title formatting changes but URL stays identical.
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

  // Functional de-dup — stage 2:
  // same date + time + theatre + normalized title (even if URL differs).
  // This catches cases where the ticket URL changes between runs (or differs between sources)
  // but it is clearly the same representation slot.
  const bySlotKey = new Map()
  for (const r of byEventKey.values()) {
    const key = [
      r?.date || '',
      r?.heure || '',
      String(r?.theatre_nom || '').trim().toLowerCase(),
      normTitle(r?.titre),
    ].join('|')

    if (!bySlotKey.has(key)) {
      bySlotKey.set(key, r)
      continue
    }

    const cur = bySlotKey.get(key)
    if (score(r) > score(cur)) bySlotKey.set(key, r)
  }

  const deduped = Array.from(bySlotKey.values())

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


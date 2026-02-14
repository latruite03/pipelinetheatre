import crypto from 'node:crypto'

export function stripDiacritics(s) {
  return (s || '')
    .normalize('NFD')
    .replace(/\p{Diacritic}+/gu, '')
}

export function normKey(s) {
  return stripDiacritics(String(s || ''))
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '')
}

function normUrl(u) {
  if (!u) return ''
  try {
    const url = new URL(String(u))
    url.hash = ''
    // Remove tracking noise where possible
    for (const k of ['utm_source','utm_medium','utm_campaign','utm_term','utm_content','fbclid','gclid']) {
      url.searchParams.delete(k)
    }
    return url.toString()
  } catch {
    return String(u).split('#')[0]
  }
}

function canonicalTitle(titre, theatre_nom) {
  let t = String(titre || '').trim()
  const venue = String(theatre_nom || '').trim()

  // Remove common suffixes like "— VENUE" or "| VENUE" (case-insensitive)
  // Also handle venue variants without diacritics and casing (e.g., "— brass" while theatre_nom="BRASS").
  const candidates = new Set()
  if (venue) {
    candidates.add(venue)
    candidates.add(stripDiacritics(venue))
    candidates.add(stripDiacritics(venue).toLowerCase())
  }

  for (const v of candidates) {
    if (!v) continue
    const escaped = String(v).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    t = t.replace(new RegExp(`\s*(?:—|\-|\||:)?\s*${escaped}\s*$`, 'i'), '').trim()
  }

  // Collapse whitespace
  t = t.replace(/\s+/g, ' ').trim()
  return t
}

// Fingerprint strategy (important):
// - Prefer a public event/ticket URL when available (stable across reruns)
// - Otherwise fallback to (theatre + date + time + canonicalized title)
// Avoid including source/source_url in the primary identity to prevent duplicates.
export function computeFingerprint({
  url,
  source_url,
  date,
  heure,
  theatre_nom,
  titre,
}) {
  const keyUrl = normUrl(url || source_url)
  const base = [
    keyUrl,
    date || '',
    heure || '',
    normKey(theatre_nom || ''),
    normKey(canonicalTitle(titre, theatre_nom)),
  ].join('|')

  return crypto.createHash('sha1').update(base).digest('hex')
}

export function normalizeGenre(value) {
  if (!value) return null
  const v = stripDiacritics(String(value)).toLowerCase().trim()

  if (v === 'comedie' || v === 'drame' || v === 'autre') return v
  if (v.includes('com')) return 'comedie'
  if (v.includes('dram') || v.includes('trag')) return 'drame'
  // DB constraint currently only allows (comedie|drame|autre).
  // We keep "jeune public" as a derived UI tag for now.
  if (v.includes('jeune public') || v.includes('jeunepublic') || v.includes('familial') || v.includes('enfant')) return 'autre'
  if (v.includes('experimental') || v.includes('inclassable')) return 'autre'
  return null
}

export function normalizeStyle(value) {
  if (!value) return null
  const v = stripDiacritics(String(value)).toLowerCase().trim()

  if (v === 'classique' || v === 'contemporain') return v
  if (v.includes('class')) return 'classique'
  if (v.includes('contemp') || v.includes('moderne') || v.includes('creation') || v.includes('création')) return 'contemporain'
  return null
}

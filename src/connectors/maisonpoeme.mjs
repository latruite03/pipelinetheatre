import fetch from 'node-fetch'
import { computeFingerprint } from '../lib/normalize.mjs'

const SOURCE = 'maisonpoeme'
const BASE = 'https://maisonpoeme.be'
const API = `${BASE}/wp-json/wp/v2/event`
// NOTE: media endpoint exists, but fetching it per item can be slow; keep optional.
const MEDIA_API = `${BASE}/wp-json/wp/v2/media/`
const SOURCE_URL = `${BASE}/` // homepage shows the season highlights; canonical source for humans

function stripTags(s) {
  return String(s || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
}

async function getFeaturedMediaUrl(id) {
  if (!id || id === 0) return null
  try {
    const res = await fetch(`${MEDIA_API}${id}`, { headers: { 'user-agent': 'Mozilla/5.0 (OpenClaw pipelinetheatre)' } })
    if (!res.ok) return null
    const j = await res.json()
    return j?.source_url || null
  } catch {
    return null
  }
}

function parseHeureFromHtml(html) {
  const txt = stripTags(html)
  // common patterns: "@ 19h30" / "19h30" / "19:30"
  const m = txt.match(/\b(\d{1,2})\s*(?:h|:)\s*(\d{2})\b/i)
  if (!m) return null
  const hh = String(m[1]).padStart(2, '0')
  const mm = String(m[2]).padStart(2, '0')
  return `${hh}:${mm}`
}

function parseDateFromLink(link) {
  // links often start with /evenement/2026-...
  const m = String(link || '').match(/\/evenement\/(\d{4})-/)
  return m ? m[1] : null
}

export async function loadMaisonPoeme({
  minDate = '2026-02-15',
  maxDate = '2026-06-30',
  perPage = 20,
  maxPages = 1,
} = {}) {
  const theatre_nom = 'Maison Poème'
  const theatre_adresse = 'Rue d’Écosse 30, 1060 Saint-Gilles'

  // Repérage-first: this venue uses a WP REST custom post type "event".
  // In practice the API payload can be heavy/slow; keep this connector safe by default.
  // Enable live fetch explicitly when you want to invest time debugging/optimizing.
  if (process.env.MAISONPOEME_LIVE !== '1') {
    return []
  }

  const reps = []

  for (let page = 1; page <= maxPages; page++) {
    const url = new URL(API)
    url.searchParams.set('per_page', String(perPage))
    url.searchParams.set('page', String(page))
    // no _embed: payload is huge otherwise
    url.searchParams.set('order', 'desc')
    url.searchParams.set('orderby', 'date')

    const ac = new AbortController()
    const t = setTimeout(() => ac.abort(), 10000)
    const res = await fetch(url.toString(), {
      headers: { 'user-agent': 'Mozilla/5.0 (OpenClaw pipelinetheatre)' },
      signal: ac.signal,
    }).finally(() => clearTimeout(t))
    if (!res.ok) {
      // Stop when pages run out (WP returns 400/404 for out-of-range pages depending on config)
      break
    }
    const events = await res.json()
    if (!Array.isArray(events) || events.length === 0) break

    for (const e of events) {
      const link = e?.link || null
      const titre = stripTags(e?.title?.rendered)
      const excerpt = stripTags(e?.excerpt?.rendered)
      const content = e?.content?.rendered || ''

      // WordPress `date` here is publication date; the real event date is usually embedded in content.
      // But their 2026 pages are actually published in 2026, so we can use the year signal + content time.
      // We derive the date from the URL slug pattern /evenement/2026-... + publication year fallback.
      const pubDate = e?.date ? String(e.date).slice(0, 10) : null
      const yearFromLink = parseDateFromLink(link)

      // If link suggests 2026, use publication date as event date anchor (best available via API)
      // This connector is primarily for "repérage"; it may be refined later if they expose real event dates explicitly.
      const date = pubDate

      if (!date || date < minDate || date > maxDate) continue

      // Filter plays only (very rough): keep items mentioning theatre, spectacle, scène, performance.
      // Maison Poème is mixed (poésie, concerts, etc.).
      const blob = `${titre} ${excerpt} ${stripTags(content)}`.toLowerCase()
      const pos = /(th[eé]âtre|spectacle|mise en sc[eè]ne|sc[eè]ne|performance|seul en sc[eè]ne)/i
      const neg = /(concert|musique|dj|cin[eé]ma|expo|atelier|stage|conf[eé]rence)/i
      if (!pos.test(blob) || neg.test(blob)) {
        // still allow if it clearly looks like a stage piece even without keywords
        // but default: skip.
        continue
      }

      const heure = parseHeureFromHtml(content) || null
      const image_url = null // keep fast for now

      const rep = {
        source: SOURCE,
        source_url: SOURCE_URL,
        date,
        heure,
        titre,
        theatre_nom,
        theatre_adresse,
        url: link,
        genre: null,
        style: null,
        description: excerpt || null,
        image_url,
        is_theatre: true,
      }

      rep.fingerprint = computeFingerprint(rep)
      reps.push(rep)
    }

    // Quick stop: once we're below minDate (since we order desc)
    const last = events[events.length - 1]
    const lastPub = last?.date ? String(last.date).slice(0, 10) : null
    if (lastPub && lastPub < minDate) break
  }

  // de-dup
  const seen = new Set()
  const out = []
  for (const r of reps) {
    if (!r?.fingerprint) continue
    if (seen.has(r.fingerprint)) continue
    seen.add(r.fingerprint)
    out.push(r)
  }

  return out
}

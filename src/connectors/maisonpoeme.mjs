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

const MONTHS = {
  jan: '01',
  janvier: '01',
  fev: '02',
  fév: '02',
  fevr: '02',
  févr: '02',
  fevrier: '02',
  février: '02',
  mar: '03',
  mars: '03',
  avr: '04',
  avril: '04',
  mai: '05',
  jun: '06',
  juin: '06',
  jui: '07',
  juillet: '07',
  aou: '08',
  août: '08',
  aout: '08',
  sep: '09',
  sept: '09',
  septembre: '09',
  oct: '10',
  octobre: '10',
  nov: '11',
  novembre: '11',
  dec: '12',
  déc: '12',
  decembre: '12',
  décembre: '12',
}

function parseDateFromText(s) {
  const txt = stripTags(s).toLowerCase()

  // Pattern: "lun 13 Avr 2026" / "13 avr 2026"
  const m = txt.match(/\b(\d{1,2})\s+([a-zéûîôàèç]{3,9})\.?\s+(\d{4})\b/i)
  if (!m) return null
  const dd = String(m[1]).padStart(2, '0')
  const mm = MONTHS[m[2]]
  const yyyy = m[3]
  if (!mm) return null
  return `${yyyy}-${mm}-${dd}`
}

function parseDateFromLink(link) {
  // links often start with /evenement/2026-...
  const m = String(link || '').match(/\/evenement\/(\d{4})-/)
  return m ? m[1] : null
}

export async function loadMaisonPoeme({
  minDate = '2026-02-15',
  maxDate = '2026-06-30',
  perPage = 10,
  maxPages = 3,
  timeoutMs = 8000,
} = {}) {
  const theatre_nom = 'Maison Poème'
  const theatre_adresse = 'Rue d’Écosse 30, 1060 Saint-Gilles'

  // This venue exposes a WP REST CPT "event". Keep payload minimal via `_fields`.
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
    // request minimal fields to avoid huge payload / hangs
    url.searchParams.set(
      '_fields',
      [
        'id',
        'date',
        'link',
        'title',
        'excerpt',
        'content',
        'featured_media',
        'event-category',
        'event-tag',
      ].join(',')
    )

    const ac = new AbortController()
    const t = setTimeout(() => ac.abort(), timeoutMs)
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

      // WP `date` is publication timestamp; actual event date is often present in content (e.g. "lun 13 Avr 2026 @ 19h30").
      const pubDate = e?.date ? String(e.date).slice(0, 10) : null
      const dateFromContent = parseDateFromText(content) || parseDateFromText(excerpt)

      // Prefer an explicit event date if found; otherwise fall back to publication date.
      const date = dateFromContent || pubDate

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

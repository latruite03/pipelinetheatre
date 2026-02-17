import fetch from 'node-fetch'
import { computeFingerprint, stripDiacritics } from '../lib/normalize.mjs'

const SOURCE = 'archipel19'
const BASE = 'https://archipel19.be'
const LIST_URL = `${BASE}/evenements/categorie/spectacles/`

const FETCH_OPTS = {
  headers: {
    'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36',
    'accept-language': 'fr-BE,fr;q=0.9,en;q=0.8,nl;q=0.7',
  },
}

const FRENCH_MONTHS = [
  'janvier',
  'février',
  'fevrier',
  'mars',
  'avril',
  'mai',
  'juin',
  'juillet',
  'août',
  'aout',
  'septembre',
  'octobre',
  'novembre',
  'décembre',
  'decembre',
]

function decodeHtmlEntities(s) {
  return (s || '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&rsquo;/g, '’')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
}

function stripTags(s) {
  return decodeHtmlEntities(s || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function toAbsUrl(u) {
  if (!u) return null
  if (u.startsWith('http://') || u.startsWith('https://')) return u
  if (u.startsWith('/')) return `${BASE}${u}`
  return `${BASE}/${u}`
}

function inRange(date) {
  return date >= '2026-01-01' && date <= '2026-06-30'
}

function sanitizeDescription(text) {
  let t = (text || '').replace(/\s+/g, ' ').trim()
  if (!t) return null

  // Avoid re-embedding the date range(s) in the description
  // Examples:
  // - "dim 08.02.26 | 15h00"
  // - "08.02.26"
  t = t
    .replace(/\b\d{2}\.\d{2}\.\d{2}\b(\s*\|\s*\d{1,2}h\d{2})?/gi, ' ')
    .replace(/\b\d{1,2}\s*(?:h|:)\s*\d{2}\b/gi, ' ')

  // Remove explicit French dates like "14 février 2026"
  const monthAlt = FRENCH_MONTHS.map((m) => m.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')
  const reFr = new RegExp(`\\b\\d{1,2}\\s+(?:${monthAlt})\\s+\\d{4}\\b`, 'gi')
  t = t.replace(reFr, ' ')

  t = t.replace(/\s+/g, ' ').trim()
  if (!t) return null
  return t
}

function parseEventUrls(listHtml) {
  // Category archive uses <a href="https://archipel19.be/evenement/.../"> ...
  const urls = []
  const re = /href="(https?:\/\/archipel19\.be\/evenement\/[^\"]+)"/gi
  let m
  while ((m = re.exec(listHtml))) urls.push(toAbsUrl(m[1]))

  // uniq
  return Array.from(new Set(urls))
}

function parseTitle(eventHtml) {
  const m = /<h1[^>]*class="tribe-events-single-event-title"[^>]*>([\s\S]*?)<\/h1>/i.exec(eventHtml)
  if (m) return stripTags(m[1])
  const m2 = /<title>([\s\S]*?)<\/title>/i.exec(eventHtml)
  return m2 ? stripTags(m2[1]).replace(/\s*-\s*Archipel 19\s*$/i, '').trim() : null
}

function parseDateTimes(eventHtml) {
  // On event page, top line often like: "dim 08.02.26 | 15h00"
  const out = []
  const re = /\b(\d{2})\.(\d{2})\.(\d{2})\s*\|\s*(\d{1,2})h(\d{2})\b/g
  let m
  while ((m = re.exec(eventHtml))) {
    const dd = m[1]
    const mm = m[2]
    const yy = m[3]
    const yyyy = `20${yy}`
    const hh = String(m[4]).padStart(2, '0')
    const min = m[5]
    out.push({ date: `${yyyy}-${mm}-${dd}`, heure: `${hh}:${min}:00` })
  }

  // fallback: sometimes time is absent; handle date-only "dim 08.02.26"
  if (out.length === 0) {
    const re2 = /\b(\d{2})\.(\d{2})\.(\d{2})\b/g
    while ((m = re2.exec(eventHtml))) {
      const dd = m[1]
      const mm = m[2]
      const yy = m[3]
      const yyyy = `20${yy}`
      out.push({ date: `${yyyy}-${mm}-${dd}`, heure: null })
    }
  }

  // uniq
  const seen = new Set()
  const res = []
  for (const dt of out) {
    const k = `${dt.date}|${dt.heure || ''}`
    if (seen.has(k)) continue
    seen.add(k)
    res.push(dt)
  }
  return res
}

function parseDescription(eventHtml) {
  // 1) meta description / OG description
  const meta = /<meta\s+name="description"\s+content="([^"]+)"/i.exec(eventHtml)?.[1]
  const og = /<meta\s+property="og:description"\s+content="([^"]+)"/i.exec(eventHtml)?.[1]

  // 2) JSON-LD
  let jsonLdDesc = null
  for (const m of eventHtml.matchAll(/<script[^>]+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const raw = m[1].trim()
      if (!raw) continue
      const data = JSON.parse(raw)
      const candidates = Array.isArray(data) ? data : [data]
      for (const c of candidates) {
        const d = c?.description
        if (typeof d === 'string' && stripTags(d).length > 40) {
          jsonLdDesc = stripTags(d)
          break
        }
      }
      if (jsonLdDesc) break
    } catch {}
  }

  // 3) On-page content (The Events Calendar)
  const body =
    /<div[^>]+class="tribe-events-single-event-description"[^>]*>([\s\S]*?)<\/div>/i.exec(eventHtml)?.[1] ||
    /<div[^>]+class="tribe-events-content"[^>]*>([\s\S]*?)<\/div>/i.exec(eventHtml)?.[1]

  const picked = stripTags(meta || og || jsonLdDesc || body || '')
  const cleaned = sanitizeDescription(picked)
  if (!cleaned) return null

  // Keep it reasonably short for UI cards
  return cleaned.slice(0, 600)
}

function parseVenueLine(eventHtml) {
  // The archive shows: "Archipel 19, Place de l'Église..." or other places.
  // Try to capture a venue label from common TEC markup.
  const m = /tribe-venue[^>]*>([\s\S]*?)<\/[^>]+>/i.exec(eventHtml)
  if (m) return stripTags(m[1])

  // Fallback: find the first occurrence of " - <Commune>" in the meta line.
  const line = stripTags(eventHtml)
  const idx = line.indexOf(' - ')
  if (idx > 0) return line.slice(0, idx).trim()
  return null
}

function venueToTheatreNom(venueText) {
  const v = stripDiacritics(String(venueText || '')).toLowerCase()
  if (v.includes('maison stepman') || v.includes('stepman')) return 'Archipel 19 – Maison Stepman'
  return 'Archipel 19 – Le Fourquet'
}

export async function loadArchipel19() {
  const listHtml = await (await fetch(LIST_URL, FETCH_OPTS)).text()
  const eventUrls = parseEventUrls(listHtml)

  const theatre_adresse_default = "Place de l'Église 15, 1082 Berchem-Sainte-Agathe"

  const reps = []

  for (const url of eventUrls) {
    const eventHtml = await (await fetch(url, FETCH_OPTS)).text()
    const titre = parseTitle(eventHtml) || 'Spectacle'
    const description = parseDescription(eventHtml)
    const dts = parseDateTimes(eventHtml)

    const venueLine = parseVenueLine(eventHtml)
    const theatre_nom = venueToTheatreNom(venueLine)

    // TODO: if we find a reliable per-venue address, set it here.
    const theatre_adresse = theatre_adresse_default

    for (const dt of dts) {
      if (!dt.date || !inRange(dt.date)) continue

      const rep = {
        source: SOURCE,
        source_url: url,
        date: dt.date,
        heure: dt.heure, // may be null
        titre,
        theatre_nom,
        theatre_adresse,
        url,
        genre: null,
        style: null,
        ...(description ? { description } : {}),
        is_theatre: true,
      }
      rep.fingerprint = computeFingerprint(rep)
      reps.push(rep)
    }
  }

  const out = []
  const seen = new Set()
  for (const r of reps) {
    const k = r.fingerprint
    if (seen.has(k)) continue
    seen.add(k)
    out.push(r)
  }
  return out
}

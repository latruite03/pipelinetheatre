import fetch from 'node-fetch'
import { computeFingerprint, stripDiacritics } from '../lib/normalize.mjs'

// Maison des Cultures et de la Cohésion Sociale (Molenbeek)
// Source: lamaison1080hethuis.be (Drupal views calendar)

const SOURCE = 'mccs'
const BASE = 'https://lamaison1080hethuis.be'

const FETCH_OPTS = {
  headers: {
    'user-agent': 'Mozilla/5.0 (OpenClaw pipelinetheatre)',
    'accept-language': 'fr-BE,fr;q=0.9,en;q=0.8',
  },
}

function stripTags(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function toAbsUrl(u) {
  if (!u) return null
  if (u.startsWith('http://') || u.startsWith('https://')) return u
  if (u.startsWith('/')) return `${BASE}${u}`
  return `${BASE}/${u}`
}

function addDays(date, n) {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

function yyyymmdd(date) {
  return date.replace(/-/g, '')
}

function inRange(date, minDate, maxDate) {
  return date >= minDate && date <= maxDate
}

function parseDayJson(jsonText) {
  // Response is JSON: { data: "<div ...>...</div>", status: 200 }
  try {
    const obj = JSON.parse(jsonText)
    return obj?.data || ''
  } catch {
    return ''
  }
}

function parseDaySnippet(dayHtml, date) {
  const items = []
  // Each event row contains <a href="/fr/programme/..." class="day-infos-card"> ... <div>19h00 - 20h07</div> ... <div>Title</div>
  const re = /<a[^>]+href="([^"]+)"[^>]*class="day-infos-card"[^>]*>([\s\S]*?)<\/a>/gi
  let m
  while ((m = re.exec(dayHtml))) {
    const href = m[1]
    const block = m[2] || ''

    const timeLine = stripTags(/<div class=\"day-infos\">[\s\S]*?<div>([\s\S]*?)<\/div>/i.exec(block)?.[1] || '')
    const title = stripTags(block.split('</div>').slice(-1)[0] || block)

    const tm = /(\d{1,2})h(\d{2})\s*[-–]\s*(\d{1,2})h(\d{2})/i.exec(timeLine)
      || /(\d{1,2})h(\d{2})/i.exec(timeLine)
      || /(\d{1,2}):(\d{2})\s*[-–]\s*(\d{1,2}):(\d{2})/i.exec(timeLine)
      || /(\d{1,2}):(\d{2})/i.exec(timeLine)

    let heure = null
    if (tm) {
      const hh = String(tm[1]).padStart(2, '0')
      const mi = tm[2]
      heure = `${hh}:${mi}:00`
    }

    items.push({
      date,
      heure,
      url: toAbsUrl(href),
      title: title || null,
    })
  }
  return items
}

function isTheatreLike({ title, description, categoryText }) {
  const t = stripDiacritics(String(title || '')).toLowerCase()
  const d = stripDiacritics(String(description || '')).toLowerCase()
  const c = stripDiacritics(String(categoryText || '')).toLowerCase()

  const hay = `${t} ${c} ${d}`

  // deny obvious non-show items
  if (/\b(stage|atelier|workshop|cours|formation|residence|résidence|projection|expo|exposition|visite|balade|rencontre|conference|conférence|debat|débat)\b/i.test(hay)) return false

  // allow theatre-ish / show-ish
  if (/\b(theatre|théatre|spectacle|stand[-\s]?up|humour|conte|cirque|marionnette|lecture|performance)\b/i.test(hay)) return true

  return false
}

function parseDetail(html) {
  const title = stripTags(/<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html)?.[1] || '') || null

  const ogImg = /<meta\s+property="og:image"\s+content="([^"]+)"/i.exec(html)?.[1] || null
  const image_url = ogImg ? toAbsUrl(ogImg) : null

  const ogDesc = /<meta\s+property="og:description"\s+content="([^"]+)"/i.exec(html)?.[1] || null
  const description = ogDesc ? stripTags(ogDesc) : null

  // Some pages show type/category in a badge; keep a little context for filtering.
  const categoryText = stripTags(/class="field--name-field-type"[\s\S]*?<div[^>]*class="field__item"[^>]*>([\s\S]*?)<\/div>/i.exec(html)?.[1] || '') || null

  // Ticket link sometimes exists; otherwise keep page url.
  const ticket = html.match(/href="([^"]+)"[^>]*>\s*(?:Billetterie|R[ée]server|Tickets?)\s*</i)?.[1] || null

  return { title, image_url, description, categoryText, ticket }
}

export async function loadMCCS({
  minDate = '2026-01-01',
  maxDate = '2026-06-30',
} = {}) {
  const theatre_nom = 'Maison des Cultures et de la Cohésion Sociale'
  const theatre_adresse = 'Rue Mommaerts 4, 1080 Molenbeek-Saint-Jean'

  const detailCache = new Map() // url -> details

  const reps = []

  for (let d = minDate; d <= maxDate; d = addDays(d, 1)) {
    if (!inRange(d, minDate, maxDate)) continue

    const dayUrl = `${BASE}/fr/calendrier/day/${yyyymmdd(d)}`
    let jsonText = ''
    try {
      jsonText = await (await fetch(dayUrl, FETCH_OPTS)).text()
    } catch {
      continue
    }

    const snippet = parseDayJson(jsonText)
    if (!snippet) continue

    const items = parseDaySnippet(snippet, d)
    if (!items.length) continue

    for (const it of items) {
      if (!it.url) continue

      if (!detailCache.has(it.url)) {
        try {
          const html = await (await fetch(it.url, FETCH_OPTS)).text()
          detailCache.set(it.url, parseDetail(html))
        } catch {
          detailCache.set(it.url, { title: it.title, image_url: null, description: null, categoryText: null, ticket: null })
        }
      }

      const details = detailCache.get(it.url)
      const titre = details?.title || it.title || 'Événement'

      // Apply theatre-only-ish filter
      const keep = isTheatreLike({ title: titre, description: details?.description, categoryText: details?.categoryText })
      if (!keep) continue

      const rep = {
        source: SOURCE,
        source_url: it.url,
        date: it.date,
        heure: it.heure || null,
        titre,
        theatre_nom,
        theatre_adresse,
        url: details?.ticket ? toAbsUrl(details.ticket) : it.url,
        genre: null,
        style: null,
        ...(details?.image_url ? { image_url: details.image_url } : {}),
        ...(details?.description ? { description: details.description.slice(0, 600) } : {}),
        is_theatre: true,
      }
      rep.fingerprint = computeFingerprint(rep)
      reps.push(rep)
    }
  }

  // de-dup
  const seen = new Set()
  const out = []
  for (const r of reps) {
    if (seen.has(r.fingerprint)) continue
    seen.add(r.fingerprint)
    out.push(r)
  }

  return out
}

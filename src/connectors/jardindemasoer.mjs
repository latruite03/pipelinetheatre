import { computeFingerprint } from '../lib/normalize.mjs'
import { shouldEmitTheatre } from '../lib/classify.mjs'

const SOURCE = 'https://www.lejardindemasoeur.be'
const SOURCE_URL = 'https://www.lejardindemasoeur.be/jardinevents'
const THEATRE_NOM = 'Le Jardin de ma Sœur'
// Address not on the listing page; keep null (can be enriched later)

function pad2(n) { return String(n).padStart(2, '0') }

function* eachDayInclusive(startISO, endISO) {
  const start = new Date(`${startISO}T00:00:00Z`)
  const end = new Date(`${endISO}T00:00:00Z`)
  for (let d = start; d <= end; d = new Date(d.getTime() + 24 * 3600 * 1000)) {
    const iso = `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`
    yield iso
  }
}

function stripTags(s) {
  return String(s || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
}

async function fetchHtml(url) {
  const res = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 (OpenClaw pipelinetheatre)' } })
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`)
  return await res.text()
}

export async function loadJardinDeMaSoeur({
  minDate = '2026-02-15',
  maxDate = '2026-06-30',
} = {}) {
  const html = await fetchHtml(SOURCE_URL)

  // Extract each event block.
  // We rely on Squarespace's event list markup:
  // <a href="/jardinevents/..." class="eventlist-title-link">TITLE</a>
  // then time tags with class event-date + event-time-24hr (start + end).
  const eventRe = /<a\s+href="([^"]+)"\s+class="eventlist-title-link">([\s\S]*?)<\/a>[\s\S]*?<time\s+class="event-date"\s+datetime="(\d{4}-\d{2}-\d{2})"[\s\S]*?<time\s+class="event-time-24hr"\s+datetime="\d{4}-\d{2}-\d{2}">([0-9]{2}:[0-9]{2})<\/time>[\s\S]*?(?:<time\s+class="event-date"\s+datetime="(\d{4}-\d{2}-\d{2})"[\s\S]*?<time\s+class="event-time-24hr"\s+datetime="\d{4}-\d{2}-\d{2}">([0-9]{2}:[0-9]{2})<\/time>)?[\s\S]*?<div\s+class="eventlist-excerpt">([\s\S]*?)<\/div>/g

  const reps = []

  for (const m of html.matchAll(eventRe)) {
    const href = m[1]
    const titre = stripTags(m[2])
    const startDate = m[3]
    const startTime = m[4] || null
    const endDate = m[5] || startDate
    // const endTime = m[6] || startTime
    const excerptHtml = m[7] || ''
    const description = stripTags(excerptHtml)

    if (!href || !titre || !startDate) continue

    const url = new URL(href, SOURCE).toString()

    for (const date of eachDayInclusive(startDate, endDate)) {
      if (date < minDate || date > maxDate) continue

      const rep = {
        source: SOURCE,
        source_url: SOURCE_URL,
        date,
        heure: startTime,
        titre,
        theatre_nom: THEATRE_NOM,
        theatre_adresse: null,
        url,
        genre: null,
        style: null,
        is_theatre: true,
        ...(description ? { description } : {}),
      }

      // Plays-only heuristic for this venue (mixed programming).
      // 1) Exclude obvious non-theatre terms.
      const excl = /(concert|musique|piano|jazz|folk|chanson|improvisation|impro|flanerie|flânerie|promenade|visite|balade|rue|quartier|conference|conférence)/i
      if (excl.test(`${titre} ${description}`)) continue

      // 2) Require some theatre signals (strict=false allows unknown, but we still gate on POS terms).
      const pos = /(theatre|théâtre|pi[eè]ce|mise en sc[eè]ne|spectacle|seul en sc[eè]ne|com[ée]die|drame|tragi)/i
      if (!pos.test(`${titre} ${description}`)) continue

      const { ok } = shouldEmitTheatre(rep, { strict: false })
      if (!ok) continue

      rep.fingerprint = computeFingerprint(rep)
      reps.push(rep)
    }
  }

  // De-dup
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

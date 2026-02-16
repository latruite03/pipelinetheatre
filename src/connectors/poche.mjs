import fetch from 'node-fetch'
import { computeFingerprint } from '../lib/normalize.mjs'

const SOURCE = 'poche'
const BASE = 'https://poche.be'
const START_URL = `${BASE}/`

function stripTags(s) {
  return String(s || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
}

const MONTHS = {
  janvier: '01',
  fevrier: '02',
  février: '02',
  mars: '03',
  avril: '04',
  mai: '05',
  juin: '06',
  juillet: '07',
  aout: '08',
  août: '08',
  septembre: '09',
  octobre: '10',
  novembre: '11',
  decembre: '12',
  décembre: '12',
}

function parseRangeDates(s) {
  // examples:
  // "Du 3 au 21 février 2026"
  // "Du 12 au 30 mai 2026"
  const txt = String(s || '').toLowerCase()
  const m = txt.match(/du\s+(\d{1,2})\s+au\s+(\d{1,2})\s+([a-zéûîôàèç]+)\s+(\d{4})/i)
  if (!m) return null
  const startDay = m[1].padStart(2, '0')
  const endDay = m[2].padStart(2, '0')
  const month = MONTHS[m[3]]
  const year = m[4]
  if (!month) return null
  return {
    start: `${year}-${month}-${startDay}`,
    end: `${year}-${month}-${endDay}`,
  }
}

async function fetchHtml(url) {
  const res = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 (OpenClaw pipelinetheatre)' } })
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`)
  return await res.text()
}

function parseHomepageShows(html) {
  const items = []

  // Homepage shows blocks like:
  // <h3>Les Héroïdes</h3>
  // <p>Inspiré ... | Du 3 au 21 février 2026</p>
  // <a ...>Lire</a> (link is nearby)
  // We'll use a tolerant regex that grabs h3 title, a following paragraph, and the first "Lire" link.
  const re = /<h4[^>]*>([\s\S]*?)<\/h4>[\s\S]*?<p[^>]*>([\s\S]*?)<\/p>[\s\S]*?<a[^>]+href="([^"]+)"[^>]*class="hiddenLink"[^>]*>\s*Lire\s*<\/a>/gi

  for (const m of html.matchAll(re)) {
    const titre = stripTags(m[1])
    const meta = stripTags(m[2])
    const href = m[3]
    const range = parseRangeDates(meta)

    if (!titre || !range) continue
    const url = href.startsWith('http') ? href : `${BASE}${href}`
    items.push({ titre, meta, startDate: range.start, endDate: range.end, url })
  }

  return items
}

async function fetchDetails(url) {
  try {
    const html = await fetchHtml(url)
    const ogDesc = html.match(/property="og:description" content="([^"]+)"/i)?.[1] || null
    const description = ogDesc ? stripTags(ogDesc) : null

    const img = html.match(/property="og:image" content="([^"]+)"/i)?.[1] || null

    return { description, image_url: img }
  } catch {
    return { description: null, image_url: null }
  }
}

export async function loadPoche({
  minDate = '2026-02-15',
  maxDate = '2026-06-30',
  limitShows = 30,
} = {}) {
  const theatre_nom = 'Théâtre de Poche'
  const theatre_adresse = 'Chemin du Gymnase 1A, 1000 Bruxelles'

  const html = await fetchHtml(START_URL)
  const shows = parseHomepageShows(html)

  // Use range end date as a proxy representation date so ongoing runs stay "upcoming".
  const filtered = shows.filter((s) => s.endDate >= minDate && s.endDate <= maxDate).slice(0, limitShows)

  const detailsByUrl = new Map()
  for (const s of filtered) {
    if (!detailsByUrl.has(s.url)) detailsByUrl.set(s.url, await fetchDetails(s.url))
  }

  const reps = []
  for (const s of filtered) {
    const details = detailsByUrl.get(s.url) || {}

    const rep = {
      source: SOURCE,
      source_url: START_URL,
      date: s.endDate,
      heure: null,
      titre: s.titre,
      theatre_nom,
      theatre_adresse,
      url: s.url,
      genre: null,
      style: null,
      description: details.description || null,
      image_url: details.image_url || null,
      is_theatre: true,
    }
    rep.fingerprint = computeFingerprint(rep)
    reps.push(rep)
  }

  return reps
}

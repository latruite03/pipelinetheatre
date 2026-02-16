import fetch from 'node-fetch'
import { computeFingerprint } from '../lib/normalize.mjs'

const SOURCE = 'magicland'
const BASE = 'https://www.magicland-theatre.com/wordpress'
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

function parseFrenchDate(s) {
  const m = String(s || '')
    .toLowerCase()
    .trim()
    .match(/(\d{1,2})\s+([a-zéûîôàèç]+)\s+(\d{4})/i)
  if (!m) return null
  const day = m[1].padStart(2, '0')
  const month = MONTHS[m[2]]
  const year = m[3]
  if (!month) return null
  return `${year}-${month}-${day}`
}

async function fetchHtml(url) {
  const res = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 (OpenClaw pipelinetheatre)' } })
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`)
  return await res.text()
}

function parseListing(html) {
  // Divi portfolio cards contain:
  // <a href="...">
  //   <h3 class="et_pb_module_header">TITLE</h3>
  //   <p class="post-meta ...">27 janvier 2026</p>
  // </a>
  const re = /<a\s+href="([^"]+)"[^>]*>[\s\S]*?<h3[^>]*class="[^"]*et_pb_module_header[^"]*"[^>]*>([\s\S]*?)<\/h3>[\s\S]*?<p[^>]*class="[^"]*post-meta[^"]*"[^>]*>([\s\S]*?)<\/p>/gi
  const items = []
  for (const m of html.matchAll(re)) {
    const url = m[1]
    const titre = stripTags(m[2])
    const dateText = stripTags(m[3])
    const date = parseFrenchDate(dateText)
    if (!url || !titre || !date) continue
    items.push({ url, titre, date })
  }
  return items
}

async function fetchDetails(url) {
  try {
    const html = await fetchHtml(url)
    const ogDesc = html.match(/property="og:description" content="([^"]+)"/i)?.[1] || null
    const ogImg = html.match(/property="og:image" content="([^"]+)"/i)?.[1] || null
    return {
      description: ogDesc ? stripTags(ogDesc) : null,
      image_url: ogImg || null,
    }
  } catch {
    return { description: null, image_url: null }
  }
}

export async function loadMagicLand({
  minDate = '2026-02-15',
  maxDate = '2026-06-30',
  maxItems = 80,
} = {}) {
  const theatre_nom = 'Magic Land Théâtre'
  const theatre_adresse = 'Rue d’Hoogvorst 8, 1030 Schaerbeek'

  const html = await fetchHtml(START_URL)
  const items = parseListing(html).slice(0, maxItems)

  const filtered = items.filter((x) => x.date >= minDate && x.date <= maxDate)

  const detailsByUrl = new Map()
  for (const x of filtered) {
    if (!detailsByUrl.has(x.url)) detailsByUrl.set(x.url, await fetchDetails(x.url))
  }

  const reps = []
  for (const x of filtered) {
    const details = detailsByUrl.get(x.url) || {}
    const rep = {
      source: SOURCE,
      source_url: START_URL,
      date: x.date,
      heure: null,
      titre: x.titre,
      theatre_nom,
      theatre_adresse,
      url: x.url.startsWith('http') ? x.url : `${BASE}${x.url}`,
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

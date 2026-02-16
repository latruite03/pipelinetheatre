import fetch from 'node-fetch'
import { computeFingerprint, stripDiacritics } from '../lib/normalize.mjs'

const SOURCE = 'le140'
const BASE = 'https://www.le140.be'

function stripTags(s) {
  return (s || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
}

function decodeHtml(s) {
  return String(s || '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#0*39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&rsquo;|&lsquo;/g, "'")
    .replace(/&hellip;/g, '…')
    .replace(/&mdash;/g, '—')
}

function slugify(text) {
  return stripDiacritics(decodeHtml(text))
    .toString()
    .toLowerCase()
    .trim()
    .replace(/['’]/g, '')
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9\-]+/g, '')
    .replace(/\-\-+/g, '-')
    .replace(/^\-+|\-+$/g, '')
}

function parseShows(html) {
  const shows = []

  // Each row looks like:
  // <div class="event-row"> ... <h1>SHOW TITLE</h1> <h2>COMPANY</h2> ... <ul class="dates-list"><li>2.03 > 19h00</li>...</ul>
  const rowRe = /<div class="event-row">([\s\S]*?)<\/div>\s*<\/div>\s*<\/div>/gi

  for (const m of html.matchAll(rowRe)) {
    const row = m[1]

    const h1 = row.match(/<h1>([\s\S]*?)<\/h1>/i)?.[1]
    const h2 = row.match(/<h2>([\s\S]*?)<\/h2>/i)?.[1]
    const ul = row.match(/<ul class="dates-list">([\s\S]*?)<\/ul>/i)?.[1]

    const spectacle = stripTags(decodeHtml(h1 || '')).trim()
    const compagnie = stripTags(decodeHtml(h2 || '')).trim()

    if (!spectacle || !ul) continue

    const url = `${BASE}/spectacles/${slugify(spectacle)}/`

    // Prefer a stable title: spectacle — compagnie (if available)
    const titre = compagnie ? `${spectacle} — ${compagnie}` : spectacle

    const dateRe = /<li>(\d{1,2})\.(\d{2})\s*>\s*(\d{1,2})h(\d{2})<\/li>/gi
    for (const dm of ul.matchAll(dateRe)) {
      const day = dm[1].padStart(2, '0')
      const month = dm[2]
      const hour = dm[3].padStart(2, '0')
      const minute = dm[4]

      const monthNum = parseInt(month, 10)
      const year = monthNum >= 9 && monthNum <= 12 ? 2025 : 2026

      const date = `${year}-${month}-${day}`
      const heure = `${hour}:${minute}`

      shows.push({ url, titre, date, heure })
    }
  }

  return shows
}

async function fetchShowDetails(url) {
  try {
    const res = await fetch(url, { redirect: 'follow' })
    if (!res.ok) return { description: null, image_url: null }
    const html = await res.text()

    const ogDesc = html.match(/property="og:description" content="([^"]+)"/i)?.[1] || null
    const description = ogDesc ? stripTags(decodeHtml(ogDesc)) : null

    // Pick first show-like image from <img src="..."> excluding obvious site assets.
    const imgCandidates = [...html.matchAll(/<img[^>]+src="([^"]+)"/gi)]
      .map((m) => m[1])
      .filter(Boolean)
      .filter((u) => /\/wp-content\/uploads\//i.test(u))
      .filter((u) => !/Le140-(?:ico|mobile)\.png/i.test(u))

    const image_url = imgCandidates[0] || null

    return { description, image_url }
  } catch {
    return { description: null, image_url: null }
  }
}

export async function loadLe140({ limitShows = 20 } = {}) {
  const archiveUrl = `${BASE}/spectacles/`
  const archiveHtml = await (await fetch(archiveUrl)).text()

  const theatre_nom = 'Théâtre 140'
  const theatre_adresse = '140 Avenue Eugène Plasky, 1030 Schaerbeek'

  const allShows = parseShows(archiveHtml)
  console.log(`Found ${allShows.length} total show dates`)

  const filteredShows = allShows.filter((s) => s.date >= '2026-01-01' && s.date <= '2026-06-30')
  console.log(`Found ${filteredShows.length} shows in 2026-01-01 to 2026-06-30`)

  const shows = filteredShows.slice(0, limitShows * 10)

  // Fetch details once per unique show URL
  const detailsByUrl = new Map()
  for (const s of shows) {
    if (!detailsByUrl.has(s.url)) detailsByUrl.set(s.url, await fetchShowDetails(s.url))
  }

  const reps = []
  for (const s of shows) {
    const details = detailsByUrl.get(s.url) || {}

    const rep = {
      source: SOURCE,
      source_url: archiveUrl,
      date: s.date,
      heure: s.heure,
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

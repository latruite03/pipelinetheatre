import fetch from 'node-fetch'
import { computeFingerprint } from '../lib/normalize.mjs'

const SOURCE = 'lerideau'
const SEASON_URL = 'https://lerideau.brussels/spectacles/saison/2025-2026'
const BASE_URL = 'https://lerideau.brussels'

const FETCH_OPTS = {
  headers: {
    'user-agent': 'Mozilla/5.0',
    'accept-language': 'fr-BE,fr;q=0.9,en;q=0.8',
  },
}

function decodeHtmlEntities(s) {
  return (s || '')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&rsquo;|&lsquo;/g, "'")
    .replace(/&ldquo;|&rdquo;/g, '"')
    .replace(/&eacute;/g, 'é')
    .replace(/&egrave;/g, 'è')
    .replace(/&ecirc;/g, 'ê')
    .replace(/&agrave;/g, 'à')
    .replace(/&ccedil;/g, 'ç')
}

function stripTags(s) {
  return (s || '')
    .replace(/<br\s*\/?\s*>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function inRange(date) {
  return date >= '2026-01-01' && date <= '2026-06-30'
}

const MONTHS = {
  janvier: '01',
  janv: '01',
  fevrier: '02',
  février: '02',
  fevr: '02',
  févr: '02',
  mars: '03',
  avril: '04',
  avr: '04',
  mai: '05',
  juin: '06',
  juillet: '07',
  juil: '07',
  aout: '08',
  août: '08',
  sept: '09',
  septembre: '09',
  oct: '10',
  octobre: '10',
  nov: '11',
  novembre: '11',
  dec: '12',
  décembre: '12',
  decembre: '12',
}

function normalizeMonthWord(s) {
  return (s || '')
    .toLowerCase()
    .replace(/\.$/, '')
    .trim()
}

function inferYearFromMonth(mm) {
  // Season is 2025-2026 (Jul-Dec 2025, Jan-Jun 2026)
  return Number(mm) >= 7 ? 2025 : 2026
}

function toIsoDate(day, monthWord) {
  const mm = MONTHS[normalizeMonthWord(monthWord)]
  if (!mm) return null
  const yyyy = inferYearFromMonth(mm)
  const dd = String(day).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

function parseTime(s) {
  if (!s) return null
  const m = /\b(\d{1,2})h(\d{2})\b/i.exec(s)
  if (!m) return null
  const hh = String(Number(m[1])).padStart(2, '0')
  const min = String(Number(m[2])).padStart(2, '0')
  return `${hh}:${min}`
}

function parseSpectacleLinksFromSeason(html) {
  const re = /href="(\/spectacles\/[^"]+)"/g
  const set = new Set()
  let m
  while ((m = re.exec(html))) {
    const href = m[1].split('#')[0]
    if (/^\/spectacles\/saison\//.test(href)) continue
    set.add(href)
  }
  return [...set].map((p) => (p.startsWith('http') ? p : `${BASE_URL}${p}`))
}

function parseMeta(html) {
  const title = /<meta\s+property="og:title"\s+content="([^"]+)"/i.exec(html)?.[1]
  const ogImage = /<meta\s+property="og:image"\s+content="([^"]+)"/i.exec(html)?.[1]
  const desc = /<meta\s+name="description"\s+content="([^"]+)"/i.exec(html)?.[1]

  return {
    titre: title ? stripTags(decodeHtmlEntities(title)).replace(/\s*\|\s*Le Rideau\s*$/i, '') : null,
    image_url: ogImage ? stripTags(decodeHtmlEntities(ogImage)) : null,
    description: desc ? stripTags(decodeHtmlEntities(desc)) : null,
  }
}

function parseCalendarEntries(html) {
  const entries = []

  const re = /<a[^>]*class="[^"]*c-spectacle-dates__entry[^"]*"[\s\S]*?<\/a>/gi
  let m
  while ((m = re.exec(html))) {
    const block = m[0]

    const dateTextRaw = /<div[^>]*class="[^"]*c-spectacle-dates__date[^"]*"[^>]*>([\s\S]*?)<\/div>/i.exec(block)?.[1]
    const dateText = dateTextRaw ? stripTags(decodeHtmlEntities(dateTextRaw)) : null
    if (!dateText) continue

    // Typical: "10 mars - 20h00" or "3 juin - 19h15"
    const dm = /\b(\d{1,2})\s+([\p{L}.]+)\b/u.exec(dateText)
    if (!dm) continue

    const isoDate = toIsoDate(dm[1], dm[2])
    if (!isoDate) continue

    const heure = parseTime(dateText)

    entries.push({ date: isoDate, heure })
  }

  return entries
}

export async function loadLeRideau() {
  const seasonHtml = await (await fetch(SEASON_URL, FETCH_OPTS)).text()
  const spectacleUrls = parseSpectacleLinksFromSeason(seasonHtml)

  const theatre_nom = 'Le Rideau'
  const theatre_adresse = 'Rue Goffart 7a, 1050 Ixelles, Bruxelles'

  const reps = []

  for (const url of spectacleUrls) {
    const html = await (await fetch(url, FETCH_OPTS)).text()
    const meta = parseMeta(html)
    const entries = parseCalendarEntries(html)

    for (const e of entries) {
      if (!inRange(e.date)) continue

      const rep = {
        source: SOURCE,
        source_url: SEASON_URL,
        date: e.date,
        heure: e.heure || null,
        titre: meta.titre || 'Spectacle',
        theatre_nom,
        theatre_adresse,
        url,
        genre: null,
        style: null,
        ...(meta.image_url ? { image_url: meta.image_url } : {}),
        ...(meta.description ? { description: meta.description.slice(0, 500) } : {}),
      }

      rep.fingerprint = computeFingerprint(rep)
      reps.push(rep)
    }
  }

  // dedupe
  const out = []
  const seen = new Set()
  for (const r of reps) {
    if (seen.has(r.fingerprint)) continue
    seen.add(r.fingerprint)
    out.push(r)
  }

  return out
}

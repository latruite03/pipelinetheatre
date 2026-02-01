import fetch from 'node-fetch'
import { computeFingerprint } from '../lib/normalize.mjs'

const SOURCE = 'oceannord'
const BASE = 'https://www.oceannord.org'
const HOME_URL = `${BASE}/`

const THEATRE_NOM = 'Théâtre Océan Nord'
const THEATRE_ADRESSE = 'Rue Vandeweyer 63, 1030 Schaerbeek'

const FETCH_OPTS = {
  headers: {
    'user-agent':
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36',
    'accept-language': 'fr-BE,fr;q=0.9,en;q=0.7,nl;q=0.6',
  },
}

function stripTagsKeepBreaks(s) {
  return (s || '')
    .replace(/<br\s*\/?>(\r?\n)?/gi, '\n')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;/g, "'")
    .replace(/&rsquo;/g, '’')
    .replace(/&lsquo;/g, '‘')
    .replace(/&eacute;/gi, 'é')
    .replace(/&egrave;/gi, 'è')
    .replace(/&ecirc;/gi, 'ê')
    .replace(/&agrave;/gi, 'à')
    .replace(/&acirc;/gi, 'â')
    .replace(/&icirc;/gi, 'î')
    .replace(/&ocirc;/gi, 'ô')
    .replace(/&uuml;/gi, 'ü')
    .replace(/&mdash;/g, '—')
    .replace(/&ndash;/g, '–')
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
}

function stripTags(s) {
  return stripTagsKeepBreaks(s).replace(/\n+/g, ' ').replace(/\s+/g, ' ').trim()
}

function toAbsUrl(u) {
  if (!u) return null
  if (u.startsWith('http://') || u.startsWith('https://')) return u
  if (u.startsWith('//')) return `https:${u}`
  if (u.startsWith('/')) return `${BASE}${u}`
  return `${BASE}/${u}`
}

function inRange(date) {
  return date >= '2026-01-01' && date <= '2026-06-30'
}

function parseHomeShows(html) {
  // Cards look like:
  // <h3><a href="...">TITLE</a></h3>
  // <p>... @ Théâtre Océan Nord<br />
  // 03 > 14.02 2026</p>

  const out = []
  const re = /<h3>\s*<a href="([^"]+)">([\s\S]*?)<\/a>\s*<\/h3>[\s\S]*?<p>([\s\S]*?)<\/p>/gi
  let m
  while ((m = re.exec(html))) {
    const url = toAbsUrl((m[1] || '').split('#')[0])
    const title = stripTags(m[2])
    const pHtml = m[3] || ''
    const pText = stripTagsKeepBreaks(pHtml).replace(/\s+/g, ' ').trim()

    // Only keep shows explicitly at Océan Nord.
    if (!/@\s*Théâtre\s*Océan\s*Nord/i.test(pText)) continue

    const yearM = /\b(20\d{2})\b/.exec(pText)
    if (!yearM) continue
    const year = yearM[1]

    // Examples: "03 > 14.02 2026" or "17 > 25.04 2026"
    const rangeM = /\b(\d{1,2})\s*>\s*(\d{1,2})\.(\d{2})\s+20\d{2}\b/.exec(pText)
    if (!rangeM) continue

    const startDay = String(rangeM[1]).padStart(2, '0')
    const endDay = String(rangeM[2]).padStart(2, '0')
    const month = String(rangeM[3]).padStart(2, '0')

    out.push({ url, title, year, month, startDay, endDay })
  }

  // De-dup by URL
  const seen = new Set()
  return out.filter((x) => {
    if (seen.has(x.url)) return false
    seen.add(x.url)
    return true
  })
}

function parseTitle(html) {
  const og = /<meta property="og:title" content="([^"]+)"/i.exec(html)
  if (og) {
    const t = stripTags(og[1])
    // "L’ÈRE DU VERSEAU – Théâtre Océan Nord" => keep left side.
    return t.split('–')[0].split('|')[0].trim()
  }

  const h1 = /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html)
  return h1 ? stripTags(h1[1]) : null
}

function parseImage(html) {
  const m = /<meta property="og:image" content="([^"]+)"/i.exec(html)
  if (m) return toAbsUrl(m[1])

  const img = /<article[\s\S]*?<img[^>]+src="([^"]+)"/i.exec(html)
  return img ? toAbsUrl(img[1]) : null
}

function parseDescription(html) {
  const meta = /<meta name="description" content="([^"]+)"/i.exec(html)
  if (meta) {
    const d = stripTags(meta[1])
    if (d && !/^Théâtre Océan Nord/i.test(d)) return d
  }

  // Fallback: first <p> after the <h1>
  const idx = html.search(/<h1[^>]*>/i)
  const slice = idx >= 0 ? html.slice(idx, idx + 4000) : html.slice(0, 4000)
  const pm = /<p[^>]*>([\s\S]*?)<\/p>/i.exec(slice)
  return pm ? stripTagsKeepBreaks(pm[1]) : null
}

function parseCalendarRepresentations(html, year) {
  const reps = []

  // Find the first block that contains "CALENDRIER".
  const idx = html.toLowerCase().indexOf('calendrier')
  if (idx < 0) return reps

  // The calendar is usually in a <p> tag with <br> separators.
  const slice = html.slice(Math.max(0, idx - 500), idx + 6000)

  // Example lines:
  // <strong>MA 03.02</strong> 20:00 – <em>Complet...</em><br>
  // <strong>SA 07.02 </strong>18:00 – ...
  const re = /<strong>\s*[A-ZÉ]{2}\s+(\d{1,2})\.(\d{2})\s*<\/strong>\s*([0-2]?\d:\d{2})([\s\S]*?)(?:<br\s*\/?>(?:\r?\n)?|<\/p>)/gi

  let m
  while ((m = re.exec(slice))) {
    const day = String(m[1]).padStart(2, '0')
    const month = String(m[2]).padStart(2, '0')
    const time = m[3]
    const rest = m[4] || ''

    const date = `${year}-${month}-${day}`
    const heure = `${time.padStart(5, '0')}:00`
    const is_complet = /Complet/i.test(rest)

    reps.push({ date, heure, is_complet })
  }

  // De-dup date+time
  const seen = new Set()
  return reps.filter((r) => {
    const k = `${r.date}|${r.heure}`
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
}

export async function loadOceanNord() {
  const homeHtml = await (await fetch(HOME_URL, FETCH_OPTS)).text()
  const shows = parseHomeShows(homeHtml)

  const reps = []

  for (const show of shows) {
    const html = await (await fetch(show.url, FETCH_OPTS)).text()

    const titre = parseTitle(html) || show.title || 'Spectacle'
    const image_url = parseImage(html)
    const description = parseDescription(html)

    const dates = parseCalendarRepresentations(html, show.year)

    for (const dt of dates) {
      if (!inRange(dt.date)) continue

      const rep = {
        source: SOURCE,
        source_url: show.url,
        date: dt.date,
        heure: dt.heure,
        titre,
        theatre_nom: THEATRE_NOM,
        theatre_adresse: THEATRE_ADRESSE,
        url: show.url,
        is_complet: !!dt.is_complet,
        genre: null,
        style: null,
        ...(image_url ? { image_url } : {}),
        ...(description ? { description } : {}),
      }

      rep.fingerprint = computeFingerprint(rep)
      reps.push(rep)
    }
  }

  // Dedup fingerprints
  const out = []
  const seen = new Set()
  for (const r of reps) {
    if (seen.has(r.fingerprint)) continue
    seen.add(r.fingerprint)
    out.push(r)
  }

  return out
}

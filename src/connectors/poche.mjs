import fetch from 'node-fetch'
import { computeFingerprint, stripDiacritics } from '../lib/normalize.mjs'

const SOURCE = 'poche'
const BASE = 'https://poche.be'
const HOME = `${BASE}/`

const FETCH_OPTS = {
  headers: {
    'user-agent': 'Mozilla/5.0',
    'accept-language': 'fr-BE,fr;q=0.9,en;q=0.8',
  },
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

function decodeHtmlEntities(s) {
  return (s || '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
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
    .replace(/&hellip;/g, '…')
    .replace(/&ldquo;/g, '“')
    .replace(/&rdquo;/g, '”')
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

function parseShowLinks(homeHtml) {
  const urls = []
  const re = /https:\/\/poche\.be\/show\/[0-9]{4}-[a-z0-9\-]+/gi
  let m
  while ((m = re.exec(homeHtml))) urls.push(m[0])
  return Array.from(new Set(urls))
}

function parseOgImage(html) {
  const m = /<meta property="og:image" content="([^"]+)"/i.exec(html)
  return m ? toAbsUrl(m[1]) : null
}

function parseMetaDescription(html) {
  const m = /<meta name="description" content="([^"]+)"/i.exec(html)
  return m ? stripTags(m[1]) : null
}

function parseOgTitle(html) {
  const m = /<meta property="og:title" content="([^"]+)"/i.exec(html)
  return m ? stripTags(m[1]) : null
}

function parseH1(html) {
  const m = /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html)
  return m ? stripTags(m[1]) : null
}

function parseTitle(html) {
  // The <title> tag on poche.be show pages is generic ("Théâtre de Poche | Bruxelles").
  // The actual show title is in <h1> and also in og:title.
  const h1 = parseH1(html)
  if (h1) return h1
  const ogt = parseOgTitle(html)
  if (ogt) return ogt.split('|')[0].trim()
  return null
}

function parseDateRangeFromOgTitle(html) {
  // Example in og:title: "Pigeons | ... | Du 12 au 30 mai 2026 | ..."
  const ogt = parseOgTitle(html)
  if (!ogt) return null
  const m = /Du\s+(\d{1,2})\s+au\s+(\d{1,2})\s+([a-zéû]+)\s+(\d{4})/i.exec(ogt)
  if (!m) return null
  const d1 = String(m[1]).padStart(2, '0')
  const d2 = String(m[2]).padStart(2, '0')
  const month = MONTHS[stripDiacritics(m[3]).toLowerCase()] || MONTHS[m[3].toLowerCase()]
  const year = m[4]
  if (!month) return null
  return { start: `${year}-${month}-${d1}`, end: `${year}-${month}-${d2}` }
}

function dateRangeToDates(start, end) {
  const out = []
  const s = new Date(start + 'T00:00:00Z')
  const e = new Date(end + 'T00:00:00Z')
  for (let d = s; d <= e; d = new Date(d.getTime() + 86400000)) {
    const yyyy = d.getUTCFullYear()
    const mm = String(d.getUTCMonth() + 1).padStart(2, '0')
    const dd = String(d.getUTCDate()).padStart(2, '0')
    out.push(`${yyyy}-${mm}-${dd}`)
  }
  return out
}

export async function loadPoche() {
  const homeHtml = await (await fetch(HOME, FETCH_OPTS)).text()
  const showUrls = parseShowLinks(homeHtml)

  const theatre_nom = 'Théâtre de Poche Bruxelles'
  const theatre_adresse = 'Chemin du Gymnase 1, 1000 Bruxelles'

  const reps = []

  for (const url of showUrls) {
    const html = await (await fetch(url, FETCH_OPTS)).text()

    const titre = parseTitle(html) || 'Spectacle'
    const image_url = parseOgImage(html)
    const description = parseMetaDescription(html)

    const range = parseDateRangeFromOgTitle(html)
    if (!range) continue

    const dates = dateRangeToDates(range.start, range.end)

    // Poche does not list per-date times, but mentions a rule on show pages:
    // "les mercredis et jeudis le spectacle joue à 19h30". We apply that rule.
    function guessHeure(dateStr) {
      const d = new Date(dateStr + 'T00:00:00Z')
      const dow = d.getUTCDay() // 0=Sun .. 6=Sat
      if (dow === 3 || dow === 4) return '19:30:00' // Wed/Thu
      // Default: unknown
      return null
    }

    for (const date of dates) {
      if (!inRange(date)) continue

      const rep = {
        source: SOURCE,
        source_url: url,
        date,
        heure: guessHeure(date),
        titre,
        theatre_nom,
        theatre_adresse,
        url,
        genre: null,
        style: null,
        ...(image_url ? { image_url } : {}),
        ...(description ? { description } : {}),
      }

      rep.fingerprint = computeFingerprint(rep)
      reps.push(rep)
    }
  }

  const out = []
  const seen = new Set()
  for (const r of reps) {
    if (seen.has(r.fingerprint)) continue
    seen.add(r.fingerprint)
    out.push(r)
  }

  return out
}

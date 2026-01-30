import fetch from 'node-fetch'
import { computeFingerprint, stripDiacritics } from '../lib/normalize.mjs'

const SOURCE = 'richesclaires'
const BASE = 'https://lesrichesclaires.be'

const ALLOW_CAT = [
  'portfolio-category-lundi-theatre-2',
  'portfolio-category-exclu-lundi-theatre',
  'portfolio-category-creations',
  'portfolio-category-reprises-accueils',
]

const DENY_CAT = [
  'portfolio-category-festivals',
  'portfolio-category-evenements-festivals',
]

function decodeHtmlEntities(s) {
  return (s || '')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
}

function stripTags(s) {
  return (s || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
}

function uniq(arr) {
  return Array.from(new Set(arr))
}

function parseSeasonItems(html) {
  const items = []
  // Grab <article ... class="..."> ... href="https://lesrichesclaires.be/saison/.../"
  const re = /<article[^>]+class="([^"]+)"[\s\S]*?<a[^>]+href="(https:\/\/lesrichesclaires\.be\/saison\/[^"]+)"[^>]*>[\s\S]*?<h2[^>]*class="entry-title[^>]*">([\s\S]*?)<\/h2>/gi
  let m
  while ((m = re.exec(html))) {
    const classes = m[1]
    const url = decodeHtmlEntities(m[2])
    const title = stripTags(decodeHtmlEntities(m[3]))

    const cls = classes.split(/\s+/g)
    const allowed = cls.some((c) => ALLOW_CAT.includes(c))
    const denied = cls.some((c) => DENY_CAT.includes(c))

    const normTitle = stripDiacritics(title).toLowerCase()
    const normUrl = stripDiacritics(url).toLowerCase()
    const isCabaret = normTitle.includes('cabaret') || normUrl.includes('cabaret')

    if (!allowed) continue
    if (denied) continue
    if (isCabaret) continue

    items.push({ url, title })
  }
  return items
}

function parseTitle(html) {
  const m = /<h1[^>]*class="entry-title[^>]*">([\s\S]*?)<\/h1>/i.exec(html)
  return m ? stripTags(decodeHtmlEntities(m[1])) : null
}

function parsePoster(html) {
  const m = /<div class="entry-thumb">[\s\S]*?<img[^>]+src="([^"]+)"/i.exec(html)
  return m ? decodeHtmlEntities(m[1]) : null
}

function parseBookingBaseUrl(html, fallback) {
  const m = /href="(https:\/\/shop\.utick\.(?:be|net)\/[^"]*module=ACTIVITYSERIEDETAILS[^"]*)"/i.exec(html)
  return m ? decodeHtmlEntities(m[1]) : fallback
}

function parseDescription(html) {
  // Try meta description
  const ogd = /<meta name="description" content="([^"]+)"/i.exec(html)?.[1]
  if (ogd) return decodeHtmlEntities(ogd).trim()

  // Otherwise, first substantial <p> before the calendar.
  const body = /<div class="entry-content[^"]*">([\s\S]*?)<\/div>/i.exec(html)?.[1] || html
  const beforeCal = body.split('<!-- DATES -->')[0]

  const reP = /<p[^>]*>([\s\S]*?)<\/p>/gi
  let m
  while ((m = reP.exec(beforeCal))) {
    const t = stripTags(decodeHtmlEntities(m[1]))
    const s = stripDiacritics(t).toLowerCase()
    if (!t) continue
    if (t.length < 80) continue
    if (s.includes('reserver') || s.includes('réserver')) continue
    return t
  }

  return null
}

function parseOccurrences(html) {
  const out = []
  // Only days marked day-on are actual occurrences.
  // We capture inside each day-on block:
  // <div class="pu-cal-day day-on ..."> ... <span>16 - 02 - 2026</span> ... >20:30</a>
  const re = /pu-cal-day\s+day-on[\s\S]*?<span>\s*(\d{1,2})\s*-\s*(\d{1,2})\s*-\s*(\d{4})\s*<\/span>[\s\S]*?>\s*(\d{1,2}):(\d{2})\s*<\/a>/gi
  let m
  while ((m = re.exec(html))) {
    const dd = String(m[1]).padStart(2, '0')
    const mm = String(m[2]).padStart(2, '0')
    const yyyy = m[3]
    const hh = String(m[4]).padStart(2, '0')
    const min = String(m[5]).padStart(2, '0')

    const date = `${yyyy}-${mm}-${dd}`
    const heure = `${hh}:${min}:00`
    out.push({ date, heure })
  }
  return out
}

function inRange(dateStr) {
  return dateStr >= '2026-01-01' && dateStr <= '2026-06-30'
}

export async function loadRichesClaires() {
  const seasonUrl = `${BASE}/la-saison/`
  const html = await (await fetch(seasonUrl)).text()
  const items = parseSeasonItems(html)

  const theatre_nom = 'Les Riches-Claires'
  const theatre_adresse = 'Rue des Riches Claires 24, 1000 Bruxelles'

  const reps = []

  for (const it of items) {
    const showHtml = await (await fetch(it.url)).text()

    const titre = parseTitle(showHtml) || it.title
    const image_url = parsePoster(showHtml)
    const description = parseDescription(showHtml)
    const booking = parseBookingBaseUrl(showHtml, it.url)

    const occ = parseOccurrences(showHtml).filter((d) => inRange(d.date))
    for (const o of occ) {
      const rep = {
        source: SOURCE,
        source_url: it.url,
        date: o.date,
        heure: o.heure,
        titre,
        theatre_nom,
        theatre_adresse,
        url: booking,
        genre: null,
        style: null,
        ...(description ? { description } : {}),
        ...(image_url ? { image_url } : {}),
      }
      rep.fingerprint = computeFingerprint(rep)
      reps.push(rep)
    }
  }

  return reps
}

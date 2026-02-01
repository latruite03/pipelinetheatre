import fetch from 'node-fetch'
import { computeFingerprint, stripDiacritics } from '../lib/normalize.mjs'

const SOURCE = 'ccauderghem'
const BASE = 'https://ccauderghem.be'
const HOME = `${BASE}/`

const FETCH_OPTS = {
  headers: {
    'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36',
    'accept-language': 'fr-BE,fr;q=0.9,en;q=0.8,nl;q=0.7',
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

function isTheatreCategory(cat) {
  const c = stripDiacritics((cat || '').toLowerCase())
  return c.includes('theatre') || c.includes('paris-theatre') || c.includes('paristheatre')
}

function sanitizeDescription(text) {
  let t = (text || '').replace(/\s+/g, ' ').trim()
  if (!t) return null

  // Avoid re-embedding the date range(s) in the description
  // - "02.02.2026"
  // - "2 février 2026"
  t = t.replace(/\b\d{2}\.\d{2}\.\d{4}\b/gi, ' ')

  const monthAlt = FRENCH_MONTHS.map((m) => m.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')
  const reFr = new RegExp(`\\b\\d{1,2}\\s+(?:${monthAlt})\\s+\\d{4}\\b`, 'gi')
  t = t.replace(reFr, ' ')

  t = t.replace(/\b\d{1,2}h\d{2}\b/gi, ' ')
  t = t.replace(/\b\d{1,2}:\d{2}\b/gi, ' ')

  t = t.replace(/\s+/g, ' ').trim()
  return t || null
}

function parseCards(html) {
  // Cards section contains <article class="card card__spectacle" ...>
  const cards = html.split('<article class="card card__spectacle"')
  if (cards.length <= 1) return []

  const out = []
  for (let i = 1; i < cards.length; i++) {
    const chunk = '<article class="card card__spectacle"' + cards[i]

    const catM = /<div class="card--cat">([\s\S]*?)<\/div>/i.exec(chunk)
    const cat = catM ? stripTags(catM[1]) : null

    // main page url (on ccauderghem.be)
    const pageM = /<a\s+href="(https:\/\/ccauderghem\.be\/[^\"]+)"/i.exec(chunk)
    const pageUrl = pageM ? toAbsUrl(pageM[1]) : null

    const titleM = /<h3[^>]*class="card--title"[^>]*>([\s\S]*?)<\/h3>/i.exec(chunk)
    const title = titleM ? stripTags(titleM[1]) : null

    const imgM = /<img[^>]+src="([^"]+)"/i.exec(chunk)
    const image_url = imgM ? toAbsUrl(decodeHtmlEntities(imgM[1])) : null

    const utickM = /<a class="card--utick-link" href="([^"]*)"/i.exec(chunk)
    const utickUrl = utickM ? toAbsUrl(stripTags(utickM[1])) : null

    out.push({ title, category: cat, pageUrl, utickUrl, image_url })
  }
  return out
}

function parseUtickDateTime(text) {
  // Example: "Le vendredi 6 février 2026 à 20:00"
  const t = stripDiacritics(text).toLowerCase()
  const m = /\ble\s+(?:lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)\s+(\d{1,2})\s+([a-zéû]+)\s+(\d{4})\s+a\s+(\d{1,2}):(\d{2})\b/.exec(
    t
  )
  if (!m) return null

  const dd = String(m[1]).padStart(2, '0')
  const monKey = m[2]
  const mm = MONTHS[monKey]
  if (!mm) return null
  const yyyy = m[3]
  const hh = String(m[4]).padStart(2, '0')
  const min = m[5]

  return { date: `${yyyy}-${mm}-${dd}`, heure: `${hh}:${min}:00` }
}

function inRange(date) {
  return date >= '2026-01-01' && date <= '2026-06-30'
}

function parseDescriptionFromPage(showHtml) {
  // WordPress show pages usually expose an OG/meta description, and also body content.
  const meta = /<meta\s+name="description"\s+content="([^"]+)"/i.exec(showHtml)?.[1]
  const og = /<meta\s+property="og:description"\s+content="([^"]+)"/i.exec(showHtml)?.[1]

  // JSON-LD description
  let jsonLdDesc = null
  for (const m of showHtml.matchAll(/<script[^>]+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi)) {
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

  // On-page content: try article content, otherwise first substantial paragraph.
  const content =
    /<div[^>]+class="entry-content"[^>]*>([\s\S]*?)<\/div>/i.exec(showHtml)?.[1] ||
    /<article[\s\S]*?<p[^>]*>([\s\S]*?)<\/p>/i.exec(showHtml)?.[1]

  const raw = stripTags(meta || og || jsonLdDesc || content || '')
  const cleaned = sanitizeDescription(raw)
  if (!cleaned) return null

  return cleaned.slice(0, 600)
}

export async function loadCCAuderghem() {
  const homeHtml = await (await fetch(HOME, FETCH_OPTS)).text()
  const cards = parseCards(homeHtml)

  const theatre_nom = "Centre culturel d’Auderghem (CCA)"
  const theatre_adresse = 'Boulevard du Souverain 183, 1160 Auderghem'

  const metaByUrl = new Map()
  const reps = []

  for (const c of cards) {
    if (!isTheatreCategory(c.category)) continue
    if (!c.utickUrl) continue

    const utickHtml = await (await fetch(c.utickUrl, FETCH_OPTS)).text()
    const dt = parseUtickDateTime(utickHtml)
    if (!dt) continue
    if (!inRange(dt.date)) continue

    let description = null
    if (c.pageUrl) {
      if (metaByUrl.has(c.pageUrl)) {
        description = metaByUrl.get(c.pageUrl)
      } else {
        try {
          const showHtml = await (await fetch(c.pageUrl, FETCH_OPTS)).text()
          description = parseDescriptionFromPage(showHtml)
        } catch {
          description = null
        }
        metaByUrl.set(c.pageUrl, description)
      }
    }

    const rep = {
      source: SOURCE,
      source_url: c.pageUrl || HOME,
      date: dt.date,
      heure: dt.heure,
      titre: c.title || 'Spectacle',
      theatre_nom,
      theatre_adresse,
      url: c.pageUrl || HOME,
      genre: null,
      style: null,
      ...(c.image_url ? { image_url: c.image_url } : {}),
      ...(description ? { description } : {}),
    }

    rep.fingerprint = computeFingerprint(rep)
    reps.push(rep)
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

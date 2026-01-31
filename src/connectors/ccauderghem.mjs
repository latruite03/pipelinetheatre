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
    const pageM = /<a[^>]+href="(https:\/\/ccauderghem\.be\/[^"]+)"/i.exec(chunk)
    const pageUrl = pageM ? toAbsUrl(pageM[1]) : null

    const titleM = /<h3[^>]*class="card--title"[^>]*>([\s\S]*?)<\/h3>/i.exec(chunk)
    const title = titleM ? stripTags(titleM[1]) : null

    const utickM = /<a class="card--utick-link" href="([^"]*)"/i.exec(chunk)
    const utickUrl = utickM ? toAbsUrl(stripTags(utickM[1])) : null

    out.push({ title, category: cat, pageUrl, utickUrl })
  }
  return out
}

function parseUtickDateTime(text) {
  // Example: "Le vendredi 6 février 2026 à 20:00"
  const t = stripDiacritics(text).toLowerCase()
  const m = /\ble\s+(?:lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)\s+(\d{1,2})\s+([a-zéû]+)\s+(\d{4})\s+a\s+(\d{1,2}):(\d{2})\b/.exec(t)
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

export async function loadCCAuderghem() {
  const homeHtml = await (await fetch(HOME, FETCH_OPTS)).text()
  const cards = parseCards(homeHtml)

  const theatre_nom = "Centre culturel d’Auderghem (CCA)"
  const theatre_adresse = 'Boulevard du Souverain 183, 1160 Auderghem'

  const reps = []

  for (const c of cards) {
    if (!isTheatreCategory(c.category)) continue
    if (!c.utickUrl) continue

    const utickHtml = await (await fetch(c.utickUrl, FETCH_OPTS)).text()
    const dt = parseUtickDateTime(utickHtml)
    if (!dt) continue
    if (!inRange(dt.date)) continue

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

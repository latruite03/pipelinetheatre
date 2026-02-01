import fetch from 'node-fetch'
import { computeFingerprint, stripDiacritics } from '../lib/normalize.mjs'

const SOURCE = 'auditoriumjbrel'
const BASE = 'https://auditoriumjbrel.ceria.brussels'

const MONTHS = {
  jan: '01',
  janvier: '01',
  fev: '02',
  fév: '02',
  fevr: '02',
  févr: '02',
  fevrier: '02',
  février: '02',
  mar: '03',
  mars: '03',
  avr: '04',
  avril: '04',
  mai: '05',
  jun: '06',
  juin: '06',
  jui: '07',
  juillet: '07',
  aou: '08',
  août: '08',
  sep: '09',
  septembre: '09',
  oct: '10',
  octobre: '10',
  nov: '11',
  novembre: '11',
  dec: '12',
  déc: '12',
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
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&rsquo;/g, '’')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
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

function sanitizeDescription(text) {
  let t = (text || '').replace(/\s+/g, ' ').trim()
  if (!t) return null

  // Remove SmartDate style fragments, e.g. "jeu 5 mar 2026, 10:30 - 12:00"
  t = t.replace(/\b(?:lun|mar|mer|jeu|ven|sam|dim)\s+\d{1,2}\s+[a-zéû]+\s+\d{4},\s*\d{1,2}:\d{2}\s*-\s*\d{1,2}:\d{2}\b/gi, ' ')

  // Remove explicit French dates like "05 mars 2026" or "05 (scolaire) + Ven 06 mars 2026"
  const monthAlt = FRENCH_MONTHS.map((m) => m.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')
  const reFr = new RegExp(`\\b\\d{1,2}\\s+(?:${monthAlt})\\s+\\d{4}\\b`, 'gi')
  t = t.replace(reFr, ' ')

  // Remove hour-only markers that often appear in résumé blocks
  t = t.replace(/\b\d{1,2}:\d{2}\b/g, ' ')

  t = t.replace(/\s+/g, ' ').trim()
  return t || null
}

function parseSmartDate(text) {
  // Examples:
  // "sam 14 fév 2026, 20:00 - 21:30"
  // "sam 27 juin 2026, 0:00" (all-day-ish)
  const t = stripDiacritics(text).toLowerCase()

  const m = /\b(\d{1,2})\s+([a-zéû]+)\s+(\d{4}),\s*(\d{1,2}):(\d{2})/.exec(t)
  if (!m) return null

  const day = String(m[1]).padStart(2, '0')
  const monKey = m[2]
  const month = MONTHS[monKey]
  if (!month) return null
  const year = m[3]
  const hh = String(m[4]).padStart(2, '0')
  const mm = String(m[5]).padStart(2, '0')

  const date = `${year}-${month}-${day}`
  const heure = `${hh}:${mm}:00`

  return { date, heure }
}

function inRange(date) {
  return date >= '2026-01-01' && date <= '2026-06-30'
}

function parseEventTiles(html) {
  // More robust: split on the tile wrapper.
  const parts = html.split('<div class="col-md-4 event-tile-item')
  if (parts.length <= 1) return []

  const out = []
  for (let i = 1; i < parts.length; i++) {
    let chunk = '<div class="col-md-4 event-tile-item' + parts[i]
    // Remove pager and trailing content to keep regexes fast.
    const pagerIdx = chunk.indexOf('<ul class="js-pager__items')
    if (pagerIdx > 0) chunk = chunk.slice(0, pagerIdx)
    out.push(chunk)
  }
  return out
}

function parseCategory(tileHtml) {
  const m = /views-field-field-categories-evenements[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/i.exec(tileHtml)
  return m ? stripTags(m[1]) : null
}

function parseTitleAndUrl(tileHtml) {
  const m = /views-field-title[\s\S]*?<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i.exec(tileHtml)
  if (!m) return { url: null, title: null }
  return {
    url: toAbsUrl(m[1]),
    title: stripTags(m[2]),
  }
}

function parseImage(tileHtml) {
  const m = /<img[^>]+src="([^"]+)"/i.exec(tileHtml)
  return m ? toAbsUrl(m[1]) : null
}

function parseDate(tileHtml) {
  const m = /views-field-field-date-et-heure[\s\S]*?>([^<]+)<\/div>/i.exec(tileHtml)
  return m ? stripTags(m[1]) : null
}

function parseDescriptionFromDetail(detailHtml) {
  // Drupal: often a "Résumé" block within field--name-body.
  const body =
    /field--name-body[\s\S]*?<div class="field--item">([\s\S]*?)<\/div>/i.exec(detailHtml)?.[1] || null

  const meta = /<meta\s+name="description"\s+content="([^"]+)"/i.exec(detailHtml)?.[1]
  const og = /<meta\s+property="og:description"\s+content="([^"]+)"/i.exec(detailHtml)?.[1]

  const raw = stripTags(meta || og || body || '')
  const cleaned = sanitizeDescription(raw)
  if (!cleaned) return null
  return cleaned.slice(0, 600)
}

async function fetchPage(page) {
  const url = `${BASE}/?field_date_et_heure_value=&field_categories_evenements_target_id=9&page=${page}`
  return await (await fetch(url)).text()
}

export async function loadAuditoriumJacquesBrel({ maxPages = 8 } = {}) {
  const tiles = []
  for (let page = 0; page < maxPages; page++) {
    const html = await fetchPage(page)
    const pageTiles = parseEventTiles(html)
    if (pageTiles.length === 0) break
    tiles.push(...pageTiles)
  }

  const theatre_nom = 'Auditorium Jacques Brel (CERIA)'
  const theatre_adresse = 'Avenue Emile Gryson 1, bâtiment 6, 1070 Anderlecht'

  const descByUrl = new Map()
  const reps = []

  for (const tile of tiles) {
    const category = parseCategory(tile)
    if (!category) continue

    // theatre-only
    const c = stripDiacritics(category).toLowerCase()
    if (c !== 'theatre' && c !== 'théâtre') continue

    const { url, title } = parseTitleAndUrl(tile)
    const image_url = parseImage(tile)
    const dateStr = parseDate(tile)
    const parsed = dateStr ? parseSmartDate(dateStr) : null
    if (!parsed) continue
    if (!inRange(parsed.date)) continue

    let description = null
    if (url) {
      if (descByUrl.has(url)) {
        description = descByUrl.get(url)
      } else {
        try {
          const detailHtml = await (await fetch(url)).text()
          description = parseDescriptionFromDetail(detailHtml)
        } catch {
          description = null
        }
        descByUrl.set(url, description)
      }
    }

    const rep = {
      source: SOURCE,
      source_url: url || `${BASE}/`,
      date: parsed.date,
      heure: parsed.heure,
      titre: title || 'Spectacle',
      theatre_nom,
      theatre_adresse,
      url: url || `${BASE}/`,
      genre: null,
      style: null,
      ...(image_url ? { image_url } : {}),
      ...(description ? { description } : {}),
    }

    rep.fingerprint = computeFingerprint(rep)
    reps.push(rep)
  }

  // dedupe just in case
  const seen = new Set()
  const out = []
  for (const r of reps) {
    const k = [r.date, r.heure, stripDiacritics(r.titre).toLowerCase()].join('|')
    if (seen.has(k)) continue
    seen.add(k)
    out.push(r)
  }

  return out
}

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

function toAbsUrl(u) {
  if (!u) return null
  if (u.startsWith('http://') || u.startsWith('https://')) return u
  if (u.startsWith('/')) return `${BASE}${u}`
  return `${BASE}/${u}`
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

function uniq(arr) {
  return Array.from(new Set(arr))
}

function parseEventTiles(html) {
  // More robust: split on the tile wrapper.
  const parts = html.split('<div class="col-md-4 event-tile-item')
  if (parts.length <= 1) return []

  const out = []
  for (let i = 1; i < parts.length; i++) {
    let chunk = '<div class="col-md-4 event-tile-item' + parts[i]
    // Cut at the next tile start if it exists (we're already split, so just keep chunk as-is).
    // But remove pager and trailing content to keep regexes fast.
    const pagerIdx = chunk.indexOf('<ul class="js-pager__items')
    if (pagerIdx > 0) chunk = chunk.slice(0, pagerIdx)
    out.push(chunk)
  }
  return out
}

function parseCategory(tileHtml) {
  const m = /views-field-field-categories-evenements[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/i.exec(tileHtml)
  return m ? stripTags(decodeHtmlEntities(m[1])) : null
}

function parseTitleAndUrl(tileHtml) {
  const m = /views-field-title[\s\S]*?<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i.exec(tileHtml)
  if (!m) return { url: null, title: null }
  return {
    url: toAbsUrl(decodeHtmlEntities(m[1])),
    title: stripTags(decodeHtmlEntities(m[2])),
  }
}

function parseImage(tileHtml) {
  const m = /<img[^>]+src="([^"]+)"/i.exec(tileHtml)
  return m ? toAbsUrl(decodeHtmlEntities(m[1])) : null
}

function parseDate(tileHtml) {
  const m = /views-field-field-date-et-heure[\s\S]*?>([^<]+)<\/div>/i.exec(tileHtml)
  return m ? stripTags(decodeHtmlEntities(m[1])) : null
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

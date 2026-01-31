import fetch from 'node-fetch'
import { computeFingerprint, stripDiacritics } from '../lib/normalize.mjs'

const SOURCE = 'zinnema'
const BASE = 'https://www.zinnema.be'
const LIST_URL = `${BASE}/fr/evenementen`

function decodeHtmlEntities(s) {
  return (s || '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    // common accented letters used on the site
    .replace(/&eacute;/gi, 'é')
    .replace(/&egrave;/gi, 'è')
    .replace(/&ecirc;/gi, 'ê')
    .replace(/&agrave;/gi, 'à')
    .replace(/&acirc;/gi, 'â')
    .replace(/&icirc;/gi, 'î')
    .replace(/&ocirc;/gi, 'ô')
    .replace(/&uuml;/gi, 'ü')
    .replace(/&iexcl;/gi, '¡')
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

function parseList(html) {
  // Duda gallery item contains:
  // <a ... href="/fr/events/..." data-image-url="https://irp.cdn-website.com/...">
  // ... <h3>Title</h3> ... <p class="rteBlock">Category</p>
  const items = []

  const re = /<a[^>]+href="(\/fr\/events\/[^\"]+)"[^>]*data-image-url="([^"]+)"[\s\S]{0,1400}?<h3[^>]*>([\s\S]*?)<\/h3>[\s\S]{0,900}?<p class="rteBlock">([\s\S]*?)<\/p>/gi
  let m
  while ((m = re.exec(html))) {
    items.push({
      url: toAbsUrl(m[1]),
      image_url: stripTags(m[2]),
      title: stripTags(m[3]),
      category: stripTags(m[4]),
    })
  }

  // fallback if data-image-url missing
  if (items.length === 0) {
    const re2 = /href="(\/fr\/events\/[^\"]+)"[\s\S]{0,1200}?<h3[^>]*>([\s\S]*?)<\/h3>[\s\S]{0,800}?<p class="rteBlock">([\s\S]*?)<\/p>/gi
    while ((m = re2.exec(html))) {
      items.push({
        url: toAbsUrl(m[1]),
        title: stripTags(m[2]),
        category: stripTags(m[3]),
      })
    }
  }

  // uniq by url
  const out = []
  const seen = new Set()
  for (const it of items) {
    if (!it.url || seen.has(it.url)) continue
    seen.add(it.url)
    out.push(it)
  }
  return out
}

function isTheatreCategory(category) {
  const c = stripDiacritics((category || '').toLowerCase())
  return c.includes('theatre')
}

function parseDescription(html) {
  // Grab first two paragraphs from the "Information" block (French).
  // The HTML includes an inline binding: data-inline-binding="dynamic_page_collection.FRENCH DESCRIPTION"
  const idx = html.indexOf('dynamic_page_collection.FRENCH DESCRIPTION')
  if (idx === -1) return null
  const slice = html.slice(idx, idx + 8000)

  const ps = []
  const re = /<p class="rteBlock">([\s\S]*?)<\/p>/gi
  let m
  while ((m = re.exec(slice))) {
    const t = stripTags(m[1])
    if (!t) continue
    // skip credits lines
    if (t.toLowerCase().startsWith('crédits')) break
    ps.push(t)
    if (ps.length >= 2) break
  }

  if (ps.length === 0) return null
  return ps.join(' ')
}

function parseDates(html) {
  // Dates appear as: 12.02.2026 - 14.00 or 13.02.2026 - 20:00
  // sometimes multiple lines
  const out = []
  const re = /(\d{2})\.(\d{2})\.(\d{4})\s*-\s*(\d{1,2})[\.:](\d{2})/g
  let m
  while ((m = re.exec(html))) {
    const dd = m[1]
    const mm = m[2]
    const yyyy = m[3]
    const hh = String(m[4]).padStart(2, '0')
    const min = m[5]
    out.push({ date: `${yyyy}-${mm}-${dd}`, heure: `${hh}:${min}:00` })
  }
  return out
}

function inRange(date) {
  return date >= '2026-01-01' && date <= '2026-06-30'
}

const FETCH_OPTS = {
  headers: {
    'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36',
    'accept-language': 'fr-BE,fr;q=0.9,en;q=0.8,nl;q=0.7',
  },
}

export async function loadZinnema() {
  const listHtml = await (await fetch(LIST_URL, FETCH_OPTS)).text()
  const items = parseList(listHtml)

  const theatre_nom = 'Zinnema'
  // address not reliably on page; keep null if unknown.
  const theatre_adresse = null

  const reps = []

  for (const it of items) {
    if (!isTheatreCategory(it.category)) continue

    const pageHtml = await (await fetch(it.url, FETCH_OPTS)).text()
    const description = parseDescription(pageHtml)
    const dates = parseDates(pageHtml)
    for (const d of dates) {
      if (!inRange(d.date)) continue
      const rep = {
        source: SOURCE,
        source_url: it.url,
        date: d.date,
        heure: d.heure,
        titre: it.title || 'Spectacle',
        theatre_nom,
        theatre_adresse,
        url: it.url,
        genre: null,
        style: null,
        ...(it.image_url ? { image_url: it.image_url } : {}),
        ...(description ? { description } : {}),
      }
      rep.fingerprint = computeFingerprint(rep)
      reps.push(rep)
    }
  }

  // dedupe by fingerprint
  const uniq = []
  const seen = new Set()
  for (const r of reps) {
    if (seen.has(r.fingerprint)) continue
    seen.add(r.fingerprint)
    uniq.push(r)
  }
  return uniq
}

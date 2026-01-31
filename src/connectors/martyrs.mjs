import fetch from 'node-fetch'
import { computeFingerprint } from '../lib/normalize.mjs'

const SOURCE = 'martyrs'
const SEASON_URL = 'https://theatre-martyrs.be/saison-2025-26/'
const BASE = 'https://theatre-martyrs.be'

const FETCH_OPTS = {
  headers: {
    // Martyrs pages sometimes return a reduced/blocked HTML for more detailed UA strings.
    // A simple UA consistently returns the full page with the "widget-list-dates" markup.
    'user-agent': 'Mozilla/5.0',
    'accept-language': 'fr-BE,fr;q=0.9',
  },
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

function inRange(date) {
  return date >= '2026-01-01' && date <= '2026-06-30'
}

function toAbsUrl(u) {
  if (!u) return null
  if (u.startsWith('http://') || u.startsWith('https://')) return u
  if (u.startsWith('/')) return `${BASE}${u}`
  return `${BASE}/${u}`
}

function parseShowUrls(seasonHtml) {
  const urls = []
  const re = /https:\/\/theatre-martyrs\.be\/spectacles\/[^\"\s]+/g
  let m
  while ((m = re.exec(seasonHtml))) urls.push(m[0])
  return Array.from(new Set(urls))
}

function parseTitle(html) {
  const m = /<title>([\s\S]*?)<\/title>/i.exec(html)
  if (!m) return null
  return stripTags(m[1]).replace(/\s*-\s*Théâtre des Martyrs\s*$/i, '').trim()
}

function parseOgImage(html) {
  const m = /<meta property="og:image" content="([^"]+)"/i.exec(html)
  if (m) return toAbsUrl(m[1])

  // Fallback: some show pages don't expose og:image; pick a reasonable poster/banner.
  // Avoid logos/favicons/cropped assets.
  const candidates = Array.from(
    html.matchAll(/https:\/\/theatre-martyrs\.be\/wp-content\/uploads\/[a-zA-Z0-9_\/-]+\.(?:jpg|jpeg|png|webp)/g)
  ).map((x) => x[0])

  for (const u of candidates) {
    const s = u.toLowerCase()
    if (s.includes('cropped-')) continue
    if (s.includes('favicon')) continue
    if (s.includes('logo')) continue
    return u
  }

  return null
}

function parseDescription(html) {
  const m = /<meta name="description" content="([^"]+)"/i.exec(html)
  return m ? stripTags(m[1]) : null
}

function parseDates(html) {
  const out = []
  const re = /<span class="jour">\s*[^<]*?(\d{2})\/(\d{2})\/(\d{2})\s*<\/span>[\s\S]{0,300}?<span class="heure">\s*([0-9]{1,2}:[0-9]{2})\s*<\/span>/gi
  let m
  while ((m = re.exec(html))) {
    const dd = m[1]
    const mm = m[2]
    const yy = m[3]
    const date = `20${yy}-${mm}-${dd}`
    const hm = m[4]
    const hh = hm.split(':')[0].padStart(2, '0')
    const mi = hm.split(':')[1]
    out.push({ date, heure: `${hh}:${mi}:00` })
  }

  const seen = new Set()
  const res = []
  for (const dt of out) {
    const k = `${dt.date}|${dt.heure}`
    if (seen.has(k)) continue
    seen.add(k)
    res.push(dt)
  }
  return res
}

function isLikelyTheatre(showUrl) {
  const s = decodeURIComponent(showUrl).toLowerCase()
  if (s.includes('cine-debat')) return false
  if (s.includes('vis-a-vis')) return false
  return true
}

export async function loadMartyrs() {
  const seasonHtml = await (await fetch(SEASON_URL, FETCH_OPTS)).text()
  const showUrls = parseShowUrls(seasonHtml).filter(isLikelyTheatre)

  const theatre_nom = 'Théâtre des Martyrs'
  const theatre_adresse = 'Place des Martyrs 22, 1000 Bruxelles'

  const reps = []

  for (const url of showUrls) {
    const html = await (await fetch(url, FETCH_OPTS)).text()

    const titre = parseTitle(html) || 'Spectacle'
    const image_url = parseOgImage(html)
    const description = parseDescription(html)
    const dts = parseDates(html)

    for (const dt of dts) {
      if (!inRange(dt.date)) continue
      const rep = {
        source: SOURCE,
        source_url: url,
        date: dt.date,
        heure: dt.heure,
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

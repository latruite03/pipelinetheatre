import fetch from 'node-fetch'
import { computeFingerprint } from '../lib/normalize.mjs'

const SOURCE = 'varia'
const BASE = 'https://varia.be'
const PROGRAMME_URL = `${BASE}/programme`

const FETCH_OPTS = {
  headers: {
    'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36',
    'accept-language': 'fr-BE,fr;q=0.9,en;q=0.7,nl;q=0.6',
  },
}

function stripTagsKeepBreaks(s) {
  return (s || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
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

function parseShowUrls(html) {
  // Example: /programme/2025-2026/jessica-gazon/le-garcon-du-dernier-rang
  const re = /href="(\/programme\/[0-9]{4}-[0-9]{4}\/[^"]+)"/gi
  const urls = []
  let m
  while ((m = re.exec(html))) {
    const href = m[1]
    // Skip landing pages like /programme/2025-2026/insas
    if (!href.split('/').filter(Boolean).includes('programme')) continue
    urls.push(toAbsUrl(href.split('#')[0]))
  }

  return Array.from(new Set(urls))
}

function parseTitle(html) {
  const og = /<meta property="og:title" content="([^"]+)"/i.exec(html)
  const t = og ? stripTags(og[1]) : null
  if (t) {
    // "Chauv·e - Massie ... | Théâtre Varia" => "Chauv·e"
    return t.split('|')[0].split(' - ')[0].trim()
  }

  const h1 = /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html)
  return h1 ? stripTags(h1[1]) : null
}

function parseImage(html) {
  const m = /<meta property="og:image" content="([^"]+)"/i.exec(html)
  return m ? toAbsUrl(m[1]) : null
}

function parseDescription(html) {
  const m = /<meta name="description" content="([^"]+)"/i.exec(html)
  return m ? stripTags(m[1]) : null
}

function parseLieu(html) {
  // We target the "Lieu" info box.
  const startIdx = html.toLowerCase().indexOf('>lieu<')
  const slice = startIdx >= 0 ? html.slice(startIdx, startIdx + 2500) : html.slice(0, 2500)

  const tm = /<div class="lieu-tt">([^<]+)<\/div>/i.exec(slice)
  const theatre_nom = tm ? stripTags(tm[1]) : 'Théâtre Varia'

  const text = stripTagsKeepBreaks(slice)
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)

  let rue = null
  let zip = null

  for (const l of lines) {
    if (!rue && /^Rue\s+/i.test(l)) rue = l
    if (!zip && /^\d{4}\s+/i.test(l)) zip = l
  }

  const theatre_adresse = rue && zip ? `${rue}, ${zip}` : rue || zip || null

  return { theatre_nom, theatre_adresse }
}

function parseRepresentations(html) {
  const out = []

  // Rows have two <time class="datetime"> cells: date and time.
  const re = /<tr[\s\S]*?<time datetime="(\d{4}-\d{2}-\d{2})T[^"]+" class="datetime">[\s\S]*?<\/time>[\s\S]*?<time datetime="\d{4}-\d{2}-\d{2}T[^"]+" class="datetime">\s*(\d{1,2})h(\d{2})\s*<\/time>[\s\S]*?<td class="views-field views-field-field-status-1">([\s\S]*?)<\/td>[\s\S]*?<\/tr>/g

  let m
  while ((m = re.exec(html))) {
    const date = m[1]
    const hh = String(m[2]).padStart(2, '0')
    const mi = String(m[3]).padStart(2, '0')
    const heure = `${hh}:${mi}:00`

    const statusBlock = m[4] || ''
    const is_complet = /Complet/i.test(statusBlock)

    const lm = /href="([^"]+)"/i.exec(statusBlock)
    const reserveUrl = lm ? lm[1].replace(/&amp;/g, '&') : null

    out.push({ date, heure, is_complet, reserveUrl })
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

export async function loadVaria() {
  const programmeHtml = await (await fetch(PROGRAMME_URL, FETCH_OPTS)).text()
  const showUrls = parseShowUrls(programmeHtml)

  const reps = []

  for (const url of showUrls) {
    const html = await (await fetch(url, FETCH_OPTS)).text()

    const titre = parseTitle(html) || 'Spectacle'
    const image_url = parseImage(html)
    const description = parseDescription(html)

    const { theatre_nom, theatre_adresse } = parseLieu(html)

    const dates = parseRepresentations(html)
    for (const dt of dates) {
      if (!inRange(dt.date)) continue

      const rep = {
        source: SOURCE,
        source_url: url,
        date: dt.date,
        heure: dt.heure,
        titre,
        theatre_nom,
        theatre_adresse,
        url: dt.reserveUrl || url,
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

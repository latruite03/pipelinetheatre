import fetch from 'node-fetch'
import { computeFingerprint } from '../lib/normalize.mjs'

const SOURCE = 'atelier210'
const BASE = 'https://atelier210.be'
const AGENDA_URL = `${BASE}/saisons/saison-25-26/agenda/`

const FETCH_OPTS = {
  headers: {
    'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36',
    'accept-language': 'fr-BE,fr;q=0.9,en;q=0.7,nl;q=0.6',
  },
}

function stripTags(s) {
  return (s || '')
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
    .replace(/\s+/g, ' ')
    .trim()
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

function parseEventUrls(html) {
  // Links look like: /saisons/saison-25-26/dirty-closets/
  const re = /href="(\/saisons\/saison-25-26\/[a-z0-9\u00c0-\u017f-]+\/)"/gi
  const urls = []
  let m
  while ((m = re.exec(html))) {
    const href = m[1]
    if (href.endsWith('/agenda/')) continue
    urls.push(toAbsUrl(href))
  }
  return Array.from(new Set(urls))
}

function parseTitle(html) {
  const og = /<meta property="og:title" content="([^"]+)"/i.exec(html)
  if (og) return stripTags(og[1]).replace(/^Atelier 210\s*\|\s*/i, '').trim()

  const h2 = /<h2 class="event-title">([\s\S]*?)<\/h2>/i.exec(html)
  return h2 ? stripTags(h2[1]) : null
}

function parseImage(html) {
  const m = /<meta property="og:image" content="([^"]+)"/i.exec(html)
  return m ? toAbsUrl(m[1]) : null
}

function parseDescription(html) {
  // Often: <p class="text-intro"> ... </p>
  const intro = /<p class="text-intro">([\s\S]*?)<\/p>/i.exec(html)
  if (intro) return stripTags(intro[1])

  // Fallback: first paragraph inside the text body
  const body = /<div class="text-body">([\s\S]*?)<\/div>/i.exec(html)
  if (body) {
    const p = /<p[^>]*>([\s\S]*?)<\/p>/i.exec(body[1])
    if (p) return stripTags(p[1])
  }

  return null
}

function parseYear(html) {
  const m = /<h2 class="dates">[\s\S]*?(\d{2})\.(\d{2})\.(\d{4})/i.exec(html)
  if (m) return m[3]

  const og = /<meta property="og:url" content="([^"]+)"/i.exec(html)
  const u = og ? og[1] : null
  if (u) {
    const m2 = /(20\d{2})/.exec(html)
    if (m2) return m2[1]
  }

  return '2026'
}

function parseDateTimes(html) {
  const year = parseYear(html)

  const out = []

  // Strategy A: explicit date + time on the same line
  // e.g. "je 12.02 · 20:30" or "25.02 · 20:30"
  const reSameLine = /\b(\d{1,2})\.(\d{2})\s*(?:&nbsp;|\u00a0)?\s*[·•]\s*(\d{1,2}:\d{2})\b/g
  let m
  while ((m = reSameLine.exec(html))) {
    const dd = String(m[1]).padStart(2, '0')
    const mm = String(m[2]).padStart(2, '0')
    const date = `${year}-${mm}-${dd}`
    const heure = `${m[3].padStart(5, '0')}:00`
    out.push({ date, heure })
  }

  // Strategy B: date line, then times on following lines (kids concerts etc)
  // Example:
  // "dimanche 01.02 ·" then "· concert: 11:00"
  if (out.length === 0) {
    const tt = /<div class="timetable">([\s\S]*?)<\/div>\s*<div class="event-practicals">/i.exec(html)
    if (tt) {
      const block = tt[1].replace(/<br\s*\/?\s*>/gi, '\n')
      const text = stripTags(block)
      const lines = text.split(/\n+/).map((l) => l.trim()).filter(Boolean)

      let currentDate = null

      for (const line of lines) {
        const d = /(\d{1,2})\.(\d{2})/.exec(line)
        if (d) {
          const dd = String(d[1]).padStart(2, '0')
          const mm = String(d[2]).padStart(2, '0')
          currentDate = `${year}-${mm}-${dd}`
        }

        if (!currentDate) continue

        const times = [...line.matchAll(/(\d{1,2}:\d{2})/g)].map((x) => x[1])
        if (!times.length) continue

        // Prefer the actual show start time when marked (often the last time on the line)
        if (/(concert|spectacle|représentation|show|start)/i.test(line) || line.startsWith('·')) {
          const t = times[times.length - 1]
          out.push({ date: currentDate, heure: `${t.padStart(5, '0')}:00` })
        }
      }
    }
  }

  // de-dup
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

export async function loadAtelier210() {
  const agendaHtml = await (await fetch(AGENDA_URL, FETCH_OPTS)).text()
  const eventUrls = parseEventUrls(agendaHtml)

  const theatre_nom = 'Atelier 210'
  const theatre_adresse = 'Chaussée Saint-Pierre 210, 1040 Etterbeek, Bruxelles'

  const reps = []

  for (const url of eventUrls) {
    const html = await (await fetch(url, FETCH_OPTS)).text()

    const titre = parseTitle(html) || 'Spectacle'
    const image_url = parseImage(html)
    const description = parseDescription(html)

    const dts = parseDateTimes(html)
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

  // de-dup by fingerprint
  const out = []
  const seen = new Set()
  for (const r of reps) {
    if (seen.has(r.fingerprint)) continue
    seen.add(r.fingerprint)
    out.push(r)
  }

  return out
}

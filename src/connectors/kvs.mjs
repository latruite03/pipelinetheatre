import fetch from 'node-fetch'
import { computeFingerprint, stripDiacritics } from '../lib/normalize.mjs'

const SOURCE = 'kvs'
const BASE = 'https://www.kvs.be'
const AGENDA_URL = `${BASE}/nl/agenda?genres%5B%5D=theater`

const FETCH_OPTS = {
  headers: {
    'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36',
    'accept-language': 'nl-BE,nl;q=0.9,fr;q=0.8,en;q=0.7',
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
    .replace(/&euml;/gi, 'ë')
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

function inRange(date) {
  return date >= '2026-01-01' && date <= '2026-06-30'
}

function parseAgendaEventUrls(html) {
  const urls = []
  const re = /<a href="(\/nl\/event\/[a-z0-9-]+)" class="event-card__link">/gi
  let m
  while ((m = re.exec(html))) urls.push(toAbsUrl(m[1]))
  return Array.from(new Set(urls))
}

function parseTitle(html) {
  // <meta property="og:image:alt" content="Copyriot" /> exists
  const m = /<meta property="og:image:alt" content="([^"]+)"/i.exec(html)
  if (m) return stripTags(m[1])
  const m2 = /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html)
  return m2 ? stripTags(m2[1]) : null
}

function parseImage(html) {
  const m = /<meta property="og:image" content="([^"]+)"/i.exec(html)
  return m ? m[1] : null
}

function parseDescription(html) {
  const m = /<meta name="description" content="([^"]+)"/i.exec(html)
  return m ? stripTags(m[1]) : null
}

function parseActivitiesDateTimes(html) {
  // <time class="event-activity__date-date" datetime="2026-02-04 20:30:00">
  const out = []
  const re = /<time class="event-activity__date-date" datetime="(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}):\d{2}"/g
  let m
  while ((m = re.exec(html))) {
    out.push({ date: m[1], heure: `${m[2]}:00` })
  }

  // uniq
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

export async function loadKVS() {
  const agendaHtml = await (await fetch(AGENDA_URL, FETCH_OPTS)).text()
  const eventUrls = parseAgendaEventUrls(agendaHtml)

  const theatre_nom = 'KVS (Koninklijke Vlaamse Schouwburg)'
  const theatre_adresse = 'Arduinkaai 7, 1000 Brussel'

  const reps = []

  for (const url of eventUrls) {
    const html = await (await fetch(url, FETCH_OPTS)).text()

    const titre = parseTitle(html) || 'Spectacle'
    const image_url = parseImage(html)
    const description = parseDescription(html)

    const dts = parseActivitiesDateTimes(html)
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
        url: url + '#activities',
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

import fetch from 'node-fetch'
import { computeFingerprint } from '../lib/normalize.mjs'

const SOURCE = 'bronks'
const BASE = 'https://www.bronks.be'
const AGENDA_URL = `${BASE}/nl/agenda`

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
    .replace(/&ndash;/gi, '–')
    .replace(/&mdash;/gi, '—')
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
  // <a href="/nl/event/worldwide-international-global-idiodrama?type=VRIJE%20VOORSTELLING">
  const urls = []
  const re = /<a[^>]+href="(\/nl\/event\/[^"]+)"/gi
  let m
  while ((m = re.exec(html))) {
    const path = m[1].split('?')[0].split('#')[0]
    urls.push(toAbsUrl(path))
  }
  return Array.from(new Set(urls))
}

function parseTitle(html) {
  const og = /<meta property="og:title" content="([^"]+)"/i.exec(html)
  if (og) return stripTags(og[1])

  const h1 = /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html)
  if (h1) return stripTags(h1[1])

  const t = /<title>([\s\S]*?)<\/title>/i.exec(html)
  return t ? stripTags(t[1]).split('|')[0].trim() : null
}

function parseImage(html) {
  const m = /<meta property="og:image" content="([^"]+)"/i.exec(html)
  return m ? m[1] : null
}

function parseDescription(html) {
  // BRONKS event pages don't expose a meta description consistently.
  // Extract the first paragraph from the event <article>.
  const article = /<article class="event"[\s\S]*?<\/article>/i.exec(html)
  const blob = article ? article[0] : html

  const p = /<p>([\s\S]*?)<\/p>/i.exec(blob)
  if (!p) return null

  const txt = stripTags(p[1])
  return txt || null
}

function parseActivityGroups(html) {
  // We need the group titles (e.g. "Speeldata in Brussel") to infer location
  // when the activity itself doesn't show an explicit location.
  const out = []

  const parts = html.split('<div class="event-activities__group">').slice(1)
  for (const part of parts) {
    // each part ends before the next group; keep it bounded to avoid accidental matches.
    const groupHtml = part.split('<div class="event-activities__group">')[0]

    const titleMatch = /<h2 class="event-activities__title">([^<]+)<\/h2>/i.exec(groupHtml)
    const groupTitle = titleMatch ? stripTags(titleMatch[1]) : ''

    const timeRe = /<time class="event-activity__date" datetime="(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}):\d{2}">([\s\S]*?)<\/time>/g
    let m
    while ((m = timeRe.exec(groupHtml))) {
      const date = m[1]
      const hhmm = m[2]
      const inner = m[3]

      const locMatch = /<span class="event-activity__location">([^<]+)<\/span>/i.exec(inner)
      const rawLoc = locMatch ? stripTags(locMatch[1]) : null

      let location = rawLoc
      if (!location && /brussel/i.test(groupTitle)) location = 'BRONKS'

      out.push({ date, heure: `${hhmm}:00`, location })
    }
  }

  return out
}

function isAtBronks(location) {
  if (!location) return false
  return /\bbronks\b/i.test(location)
}

export async function loadBRONKS() {
  const agendaHtml = await (await fetch(AGENDA_URL, FETCH_OPTS)).text()
  const eventUrls = parseAgendaEventUrls(agendaHtml)

  const theatre_nom = 'BRONKS'
  const theatre_adresse = 'Varkensmarkt 15, 1000 Brussel'

  const reps = []

  for (const url of eventUrls) {
    const html = await (await fetch(url, FETCH_OPTS)).text()

    const titre = parseTitle(html) || 'Spectacle'
    const image_url = parseImage(html)
    const description = parseDescription(html)

    const acts = parseActivityGroups(html)
    for (const a of acts) {
      if (!inRange(a.date)) continue
      if (!isAtBronks(a.location)) continue

      const rep = {
        source: SOURCE,
        source_url: url,
        date: a.date,
        heure: a.heure,
        titre,
        theatre_nom,
        theatre_adresse,
        url: url + '#activiteiten',
        genre: null,
        style: null,
        ...(image_url ? { image_url } : {}),
        ...(description ? { description } : {}),
      }

      rep.fingerprint = computeFingerprint(rep)
      reps.push(rep)
    }
  }

  // uniq on fingerprint
  const out = []
  const seen = new Set()
  for (const r of reps) {
    if (seen.has(r.fingerprint)) continue
    seen.add(r.fingerprint)
    out.push(r)
  }

  return out
}

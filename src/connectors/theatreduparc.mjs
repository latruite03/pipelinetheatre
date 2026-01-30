import fetch from 'node-fetch'
import { computeFingerprint } from '../lib/normalize.mjs'

const SOURCE = 'theatreduparc'
const BASE = 'https://www.theatreduparc.be'

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

function pickFirst(re, text) {
  const m = re.exec(text)
  return m ? m[1] : null
}

function parseEventUrls(html) {
  const urls = new Set()
  const re = /href="(https:\/\/www\.theatreduparc\.be\/event\/[a-z0-9\-]+\/?)"/gi
  let m
  while ((m = re.exec(html))) {
    const u = m[1]
    if (u.includes('/event/feed')) continue
    urls.add(u.endsWith('/') ? u : u + '/')
  }
  return Array.from(urls)
}

function parseDataEvents(html) {
  // Example: <div class="custon-calendar ..." data-events="[{&quot;year&quot;:...}]">
  const raw = pickFirst(/data-events="([\s\S]*?)"/i, html)
  if (!raw) return []
  const jsonStr = decodeHtmlEntities(raw)
  try {
    const arr = JSON.parse(jsonStr)
    return Array.isArray(arr) ? arr : []
  } catch {
    return []
  }
}

function parseTitle(html) {
  // Try h1 first
  const h1 = pickFirst(/<h1[^>]*>([\s\S]*?)<\/h1>/i, html)
  if (h1) return stripTags(h1)
  const og = pickFirst(/<meta property="og:title" content="([^"]+)"/i, html)
  if (og) return og.replace(/\s*-\s*Théâtre Royal du Parc\s*$/i, '').trim()
  return null
}

function parseDescription(html) {
  // Very conservative: first paragraph inside article content if present
  const p = pickFirst(/<article[\s\S]*?<p>([\s\S]*?)<\/p>/i, html)
  return p ? stripTags(p) : null
}

function parsePoster(html) {
  const ogImg = pickFirst(/<meta property="og:image" content="([^"]+)"/i, html)
  return ogImg || null
}

export async function loadTheatreDuParc({ limitEvents = 10 } = {}) {
  const archiveUrl = `${BASE}/event/`
  const archiveHtml = await (await fetch(archiveUrl)).text()
  const eventUrls = parseEventUrls(archiveHtml).slice(0, limitEvents)

  const theatre_nom = 'Théâtre Royal du Parc'
  const theatre_adresse = 'Rue de la Loi 3, 1000 Bruxelles'

  const reps = []

  for (const eventUrl of eventUrls) {
    const html = await (await fetch(eventUrl)).text()

    const titre = parseTitle(html) || eventUrl
    const description = parseDescription(html)
    const image_url = parsePoster(html)

    const events = parseDataEvents(html)

    for (const e of events) {
      const date = `${e.year}-${e.month}-${e.day}`
      const heure = e.time ? `${e.time}:00` : null
      const url = e.shop || eventUrl

      const rep = {
        source: SOURCE,
        source_url: eventUrl,
        date,
        heure,
        titre,
        theatre_nom,
        theatre_adresse,
        url,
        genre: null,
        style: null,
        description,
        image_url,
      }
      rep.fingerprint = computeFingerprint(rep)
      reps.push(rep)
    }
  }

  return reps
}

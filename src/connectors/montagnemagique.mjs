import fetch from 'node-fetch'
import { computeFingerprint } from '../lib/normalize.mjs'

const SOURCE = 'montagnemagique'
const VENUE_URL = 'https://www.out.be/fr/lieux/11159_theatre-la-montagne-magique.html'

const FETCH_OPTS = {
  headers: {
    'user-agent': 'Mozilla/5.0',
    'accept-language': 'fr-BE,fr;q=0.9,en;q=0.8',
  },
}

function decodeHtmlEntities(s) {
  return (s || '')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
}

function stripTags(s) {
  return (s || '')
    .replace(/<br\s*\/?\s*>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function inRange(date) {
  return date >= '2026-01-01' && date <= '2026-06-30'
}

function addDays(date, n) {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

function expandDates(start, end) {
  const out = []
  for (let cur = start; cur <= end; cur = addDays(cur, 1)) out.push(cur)
  return out
}

function parseArticlesFromAgenda(html) {
  const section = /<div id="id-calendar-swipe-list"[\s\S]*?<\/div>\s*(?:<script|<div class="form-newsletters"|<\/div>\s*<\/div>)/i.exec(html)
  const chunk = section ? section[0] : html

  const articles = []
  const re = /<article\b[\s\S]*?<\/article>/gi
  let m
  while ((m = re.exec(chunk))) {
    const block = m[0]

    const start = /data-date-start="(\d{4}-\d{2}-\d{2})"/i.exec(block)?.[1] || null
    const end = /data-date-end="(\d{4}-\d{2}-\d{2})"/i.exec(block)?.[1] || start

    const href = /<a\s+href="([^"]+)"/i.exec(block)?.[1] || null
    const url = href ? (href.startsWith('http') ? href : `https://www.out.be${href}`) : null

    const titleRaw = /<h3 class="title">([\s\S]*?)<\/h3>/i.exec(block)?.[1] || null
    const titre = titleRaw ? stripTags(decodeHtmlEntities(titleRaw)) : null

    const img = /background-image:url\((https?:\/\/[^)]+)\)/i.exec(block)?.[1] || null

    let description = null
    const ld = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/i.exec(block)?.[1]
    if (ld) {
      try {
        const data = JSON.parse(ld)
        const d = stripTags(decodeHtmlEntities(data?.description))
        if (d) description = d
      } catch {
        // ignore
      }
    }

    articles.push({ start, end, titre, url, image_url: img, description })
  }

  return articles
}

export async function loadMontagneMagique() {
  const html = await (await fetch(VENUE_URL, FETCH_OPTS)).text()

  const theatre_nom = 'Théâtre La montagne magique'
  const theatre_adresse = 'Rue du Marais 57, 1000 Bruxelles'

  const reps = []

  const articles = parseArticlesFromAgenda(html)

  for (const a of articles) {
    if (!a.start) continue

    for (const date of expandDates(a.start, a.end || a.start)) {
      if (!inRange(date)) continue

      const rep = {
        source: SOURCE,
        source_url: VENUE_URL,
        date,
        heure: null,
        titre: a.titre || 'Spectacle',
        theatre_nom,
        theatre_adresse,
        url: a.url,
        genre: null,
        style: null,
        ...(a.image_url ? { image_url: a.image_url } : {}),
        ...(a.description ? { description: a.description.slice(0, 500) } : {}),
      }

      rep.fingerprint = computeFingerprint(rep)
      reps.push(rep)
    }
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

import fetch from 'node-fetch'
import { computeFingerprint } from '../lib/normalize.mjs'

const SOURCE = 'halles'
const BASE = 'https://www.halles.be'
const LIST_URL = `${BASE}/fr/agenda`

const FETCH_OPTS = {
  headers: {
    'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36',
    'accept-language': 'fr-BE,fr;q=0.9,en;q=0.8',
  },
}

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

function inRange(date) {
  return date >= '2026-01-01' && date <= '2026-06-30'
}

function parseAgendaMonth(html, year, month) {
  const out = []
  const dayRe = /<li class="agenda__day">([\s\S]*?)<\/ul>\s*<\/li>/gi
  let m
  while ((m = dayRe.exec(html))) {
    const block = m[1]
    const dayNum = stripTags(/class="agenda__date__number"[^>]*>([\s\S]*?)<\/span>/i.exec(block)?.[1] || '')
    if (!dayNum) continue
    const day = String(dayNum).padStart(2, '0')
    const date = `${year}-${month}-${day}`

    const itemRe = /<li class="agenda__item[^"]*">([\s\S]*?)<\/li>/gi
    let im
    while ((im = itemRe.exec(block))) {
      const itemHtml = im[1]
      const timeText = stripTags(/class="agenda__item__hour"[^>]*>([\s\S]*?)<\/div>/i.exec(itemHtml)?.[1] || '')
      let heure = null
      const timeMatch = /(\d{1,2})\s*:\s*(\d{2})/.exec(timeText)
      if (timeMatch) {
        const hh = String(timeMatch[1]).padStart(2, '0')
        const mi = timeMatch[2]
        heure = `${hh}:${mi}:00`
      }

      const href = /<a[^>]+href="([^"]+)"/i.exec(itemHtml)?.[1]
      const url = href ? href : null
      const title = stripTags(/<h2[^>]*class="title item__title"[^>]*>([\s\S]*?)<\/h2>/i.exec(itemHtml)?.[1] || '')
      if (!url || !title) continue

      const is_complet = /Derniers tickets|Complet/i.test(itemHtml)

      out.push({ date, heure, url, title, is_complet })
    }
  }
  return out
}

function parseEventDetails(html) {
  let title = stripTags(/<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html)?.[1] || '') || null
  let venue = null

  for (const m of html.matchAll(/<script[^>]+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const raw = m[1].trim()
      if (!raw) continue
      const data = JSON.parse(raw)
      const items = Array.isArray(data) ? data : [data]
      for (const item of items) {
        if (item?.['@type'] === 'Event') {
          if (item?.name && !title) title = item.name
          if (item?.location?.name) venue = item.location.name
          break
        }
      }
    } catch {}
    if (venue) break
  }

  const ticketMatch = html.match(/https?:\/\/[^"'\s>]*ticketmatic[^"'\s>]*/i)
  const ticketUrl = ticketMatch ? ticketMatch[0] : null

  return { title, venue, ticketUrl }
}

export async function loadHallesDeSchaerbeek({ year = 2026, startMonth = 1, endMonth = 6 } = {}) {
  const theatre_adresse = 'Rue Royale Sainte-Marie 22, 1030 Schaerbeek'

  const entries = []
  for (let m = startMonth; m <= endMonth; m++) {
    const month = String(m).padStart(2, '0')
    const url = `${LIST_URL}?ym=${year}-${month}`
    const html = await (await fetch(url, FETCH_OPTS)).text()
    entries.push(...parseAgendaMonth(html, year, month))
  }

  const eventCache = new Map()
  const reps = []

  for (const entry of entries) {
    if (!entry.date || !inRange(entry.date)) continue

    if (!eventCache.has(entry.url)) {
      const eventHtml = await (await fetch(entry.url, FETCH_OPTS)).text()
      eventCache.set(entry.url, parseEventDetails(eventHtml))
    }
    const details = eventCache.get(entry.url)

    const titre = details?.title || entry.title
    const theatre_nom = details?.venue || 'Les Halles de Schaerbeek'
    const url = details?.ticketUrl || entry.url

    const rep = {
      source: SOURCE,
      source_url: entry.url,
      date: entry.date,
      heure: entry.heure,
      titre,
      theatre_nom,
      theatre_adresse,
      url,
      genre: null,
      style: null,
      is_complet: !!entry.is_complet,
    }
    rep.fingerprint = computeFingerprint(rep)
    reps.push(rep)
  }

  const out = []
  const seen = new Set()
  for (const rep of reps) {
    if (seen.has(rep.fingerprint)) continue
    seen.add(rep.fingerprint)
    out.push(rep)
  }

  return out
}

import fetch from 'node-fetch'
import { computeFingerprint } from '../lib/normalize.mjs'

const SOURCE = 'beursschouwburg'
const BASE = 'https://beursschouwburg.be'
const LIST_URL = `${BASE}/en/`

const FETCH_OPTS = {
  headers: {
    'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36',
    'accept-language': 'en-GB,en;q=0.9,fr-BE;q=0.8,fr;q=0.7',
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

function toAbsUrl(u) {
  if (!u) return null
  if (u.startsWith('http://') || u.startsWith('https://')) return u
  if (u.startsWith('/')) return `${BASE}${u}`
  return `${BASE}/${u}`
}

function formatDateFromTs(ts) {
  const date = new Date(Number(ts) * 1000)
  if (Number.isNaN(date.getTime())) return null
  const yyyy = date.getUTCFullYear()
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(date.getUTCDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

function inRange(date) {
  return date >= '2026-01-01' && date <= '2026-06-30'
}

function parseListEntries(html) {
  const entries = []
  const re = /<a[^>]+class="group\/event-in-list[\s\S]*?<\/a>/gi
  let m
  while ((m = re.exec(html))) {
    const block = m[0]
    const href = /href="([^"]+)"/i.exec(block)?.[1]
    const url = toAbsUrl(href)
    if (!url) continue

    const ts = /data-startdate="(\d+)"/i.exec(block)?.[1]
    const date = ts ? formatDateFromTs(ts) : null

    const times = []
    for (const tm of block.matchAll(/class="datepart time[^"]*"[^>]*>([\s\S]*?)<\/span>/gi)) {
      const t = stripTags(tm[1])
      const mTime = /(\d{1,2})\s*:\s*(\d{2})/.exec(t)
      if (mTime) {
        const hh = String(mTime[1]).padStart(2, '0')
        const mi = mTime[2]
        times.push(`${hh}:${mi}:00`)
      }
    }

    const is_complet = /sold out/i.test(block)

    entries.push({ url, date, times, is_complet })
  }
  return entries
}

function parseEventDetails(html) {
  const title = stripTags(/<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html)?.[1] || '') || null
  const venue = stripTags(/class="location[^"]*"[^>]*>([\s\S]*?)<\/div>/i.exec(html)?.[1] || '') || null

  const ticketMatch = html.match(/https?:\/\/[^"'\s>]*ticketmatic[^"'\s>]*/i)
  const ticketUrl = ticketMatch ? ticketMatch[0] : null

  const ogImage = /<meta\s+property="og:image"\s+content="([^"]+)"/i.exec(html)?.[1] || null
  const image_url = ogImage ? stripTags(ogImage) : null

  const ogDesc = /<meta\s+property="og:description"\s+content="([^"]+)"/i.exec(html)?.[1] || null
  const desc = /<meta\s+name="description"\s+content="([^"]+)"/i.exec(html)?.[1] || null
  const description = stripTags(desc || ogDesc || '') || null

  return { title, venue, ticketUrl, image_url, description }
}

export async function loadBeursschouwburg({ maxPages = 20 } = {}) {
  const theatre_adresse = 'Rue Auguste Orts 20-28, 1000 Bruxelles'

  const entries = []
  for (let page = 1; page <= maxPages; page++) {
    const url = `${LIST_URL}?page=${page}`
    const html = await (await fetch(url, FETCH_OPTS)).text()
    const pageEntries = parseListEntries(html)
    if (!pageEntries.length) break
    entries.push(...pageEntries)
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

    const titre = details?.title || 'Event'
    const theatre_nom = details?.venue || 'Beursschouwburg'
    const url = details?.ticketUrl || entry.url
    const image_url = details?.image_url || null
    const description = details?.description || null

    const times = entry.times.length ? entry.times : [null]
    for (const heure of times) {
      const rep = {
        source: SOURCE,
        source_url: entry.url,
        date: entry.date,
        heure,
        titre,
        theatre_nom,
        theatre_adresse,
        url,
        genre: null,
        style: null,
        is_complet: !!entry.is_complet,
        ...(image_url ? { image_url } : {}),
        ...(description ? { description: description.slice(0, 600) } : {}),
        is_theatre: true,
      }
      rep.fingerprint = computeFingerprint(rep)
      reps.push(rep)
    }
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

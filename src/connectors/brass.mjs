import fetch from 'node-fetch'
import { computeFingerprint } from '../lib/normalize.mjs'

const SOURCE = 'brass'
const BASE = 'https://www.lebrass.be'
const LIST_URL = `${BASE}/`

const FETCH_OPTS = {
  headers: {
    'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36',
    'accept-language': 'fr-BE,fr;q=0.9,en;q=0.7',
  },
}

function decodeHtmlEntities(s) {
  return (s || '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&#8211;/g, '–')
    .replace(/&#8212;/g, '—')
    .replace(/&#8230;/g, '…')
    .replace(/&#[0-9]+;/g, '')
}

function stripTags(s) {
  return decodeHtmlEntities(s || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function inRange(date) {
  return date >= '2026-02-01' && date <= '2026-06-30'
}

function formatTime(t) {
  if (!t) return null
  const m = /^(\d{1,2}):(\d{2})$/.exec(t.trim())
  if (!m) return null
  return `${m[1].padStart(2, '0')}:${m[2]}:00`
}

function parseEventUrls(html) {
  const urls = []
  const re = /href="(https?:\/\/www\.lebrass\.be\/event\/[^"\s>]+)"/gi
  let m
  while ((m = re.exec(html))) {
    const url = m[1].split('#')[0]
    urls.push(url)
  }
  return Array.from(new Set(urls))
}

function parseTitle(html) {
  const summary = /itemprop="summary">([\s\S]*?)<\/h2>/i.exec(html)
  if (summary) return stripTags(summary[1])

  const og = /<meta property="og:title" content="([^"]+)"/i.exec(html)
  if (og) return stripTags(og[1])

  const t = /<title>([\s\S]*?)<\/title>/i.exec(html)
  return t ? stripTags(t[1]).split('—')[0].trim() : null
}

function parseDate(html) {
  const m = /itemprop="startDate"[^>]*datetime="(\d{4}-\d{2}-\d{2})"/i.exec(html)
  if (m) return m[1]
  const m2 = /datetime="(\d{4}-\d{2}-\d{2})"/i.exec(html)
  return m2 ? m2[1] : null
}

function parseTime(html) {
  const detail = /<div class="detail">([\s\S]*?)<\/div>/i.exec(html)
  if (!detail) return null
  const text = stripTags(detail[1])
  const times = Array.from(text.matchAll(/(\d{1,2}:\d{2})/g)).map((m) => m[1])
  if (!times.length) return null
  return formatTime(times[times.length - 1])
}

function parseTicketUrl(html) {
  const ticketLink = /class="ticket-link"[^>]*href="([^"]+)"/i.exec(html)
  if (ticketLink) return ticketLink[1]

  const utick = /href="([^"]*utick[^"\s>]*)"/i.exec(html)
  if (utick) return utick[1]

  const anyTicket = /href="([^"]*ticket[^"\s>]*)"/i.exec(html)
  return anyTicket ? anyTicket[1] : null
}

export async function loadBRASS() {
  const theatre_nom = 'BRASS'
  const theatre_adresse = 'Avenue Van Volxem 364, 1190 Forest / Bruxelles'

  const listHtml = await (await fetch(LIST_URL, FETCH_OPTS)).text()
  const eventUrls = parseEventUrls(listHtml)

  const reps = []
  for (const url of eventUrls) {
    const html = await (await fetch(url, FETCH_OPTS)).text()

    const date = parseDate(html)
    if (!date || !inRange(date)) continue

    const titre = parseTitle(html) || 'Event'
    const heure = parseTime(html)
    const ticketUrl = parseTicketUrl(html) || url

    const is_complet = /complet|sold out|uitverkocht/i.test(`${titre} ${url} ${html}`)

    const rep = {
      source: SOURCE,
      source_url: url,
      date,
      heure,
      titre,
      theatre_nom,
      theatre_adresse,
      url: ticketUrl,
      genre: null,
      style: null,
      is_complet: !!is_complet,
    }

    rep.fingerprint = computeFingerprint(rep)
    reps.push(rep)
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

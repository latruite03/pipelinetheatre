import fetch from 'node-fetch'
import { computeFingerprint } from '../lib/normalize.mjs'

const SOURCE = 'kaaitheater'
const BASE = 'https://kaaitheater.be'
const MONTHS = ['202602', '202603', '202604', '202605', '202606']

const FETCH_OPTS = {
  headers: {
    'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36',
    'accept-language': 'en-BE,en;q=0.9,fr;q=0.8,nl;q=0.7',
  },
}

function stripTags(s) {
  return (s || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
}

function toAbsUrl(u) {
  if (!u) return null
  if (u.startsWith('http://') || u.startsWith('https://')) return u
  if (u.startsWith('/')) return `${BASE}${u}`
  return `${BASE}/${u}`
}

function inRange(date) {
  return date >= '2026-02-01' && date <= '2026-06-30'
}

function parseMonthEntries(html) {
  const blocks = html.split('class="views-row"').slice(1)
  const entries = []

  for (const block of blocks) {
    const date = /<div id="(\d{4}-\d{2}-\d{2})"/i.exec(block)?.[1]
    const href = /<a href="([^"]*\/en\/agenda\/[^\"]+)"/i.exec(block)?.[1]
    const timeRaw = /<div>\s*(\d{1,2}:\d{2})\s*<\/div>/i.exec(block)?.[1]
    const title = /<div class="title">([^<]+)<\/div>/i.exec(block)?.[1]
    const location = /field--name-field-lieu[^>]*>([^<]+)<\/div>/i.exec(block)?.[1]

    if (!date || !href) continue

    const is_complet = /sold out|uitverkocht|complet/i.test(block)

    entries.push({
      date,
      url: toAbsUrl(href),
      timeRaw,
      title: stripTags(title || ''),
      location: stripTags(location || ''),
      is_complet,
    })
  }

  return entries
}

function formatTime(t) {
  if (!t) return null
  const m = /^(\d{1,2}):(\d{2})$/.exec(t.trim())
  if (!m) return null
  return `${m[1].padStart(2, '0')}:${m[2]}:00`
}

export async function loadKaaitheater() {
  const theatre_adresse = 'Sainctelettesquare 20, 1000 Bruxelles'

  const entries = []
  for (const month of MONTHS) {
    const url = `${BASE}/en/calendrier/month/${month}`
    const html = await (await fetch(url, FETCH_OPTS)).text()
    entries.push(...parseMonthEntries(html))
  }

  const reps = []
  for (const entry of entries) {
    if (!inRange(entry.date)) continue

    const rep = {
      source: SOURCE,
      source_url: entry.url,
      date: entry.date,
      heure: formatTime(entry.timeRaw),
      titre: entry.title || 'Event',
      theatre_nom: entry.location || 'Kaaitheater',
      theatre_adresse,
      url: entry.url,
      genre: null,
      style: null,
      is_complet: !!entry.is_complet,
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

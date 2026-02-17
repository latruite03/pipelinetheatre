import fetch from 'node-fetch'
import { computeFingerprint } from '../lib/normalize.mjs'

// Vaux Hall Summer (Parc de Bruxelles)
// Mixed programming; stay STRICT: keep only explicit theatre/spectacle signals.

const SOURCE = 'vauxhallsummer'
const BASE = 'https://vauxhallsummer.brussels'
const START_URL = `${BASE}/`

function stripTags(s) {
  return String(s || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
}

async function fetchHtml(url) {
  const res = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 (OpenClaw pipelinetheatre)' } })
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`)
  return await res.text()
}

function parseDateFromText(s) {
  // expects dd.mm.yyyy
  const m = String(s || '').match(/\b(\d{2})\.(\d{2})\.(\d{4})\b/)
  if (!m) return null
  return `${m[3]}-${m[2]}-${m[1]}`
}

function parseListing(html) {
  // Site is minimal; sometimes only the period is on homepage.
  // We'll extract internal links and try to find event-like pages.
  const links = [...html.matchAll(/href="(\/[^"]+)"/g)].map((m) => m[1])
  const uniq = Array.from(new Set(links)).filter((h) => h.startsWith('/') && !h.startsWith('//'))
  return uniq.map((h) => `${BASE}${h}`)
}

function isTheatreLike(text) {
  const t = text.toLowerCase()
  // strict include
  const pos = /(th[eé]âtre|spectacle|mise en sc[eè]ne|seul en sc[eè]ne|com[ée]die|pi[èe]ce|marionnette)/i
  // strict exclude
  const neg = /(concert|dj|cin[eé]ma|projection|atelier|workshop|cours|sport|expo|exposition|conf[eé]rence)/i
  return pos.test(t) && !neg.test(t)
}

async function tryParseEventPage(url) {
  const html = await fetchHtml(url)
  const text = stripTags(html)

  // naive extraction: pick first title-ish line
  const title = (html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1] && stripTags(html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1])) || null
  const date = parseDateFromText(text)

  if (!title || !date) return null
  if (!isTheatreLike(`${title} ${text}`)) return null

  return { title, date, url }
}

export async function loadVauxHallSummer({
  minDate = '2026-01-01',
  maxDate = '2026-06-30',
  maxPages = 20,
} = {}) {
  const theatre_nom = 'Vaux-Hall (Vaux Hall Summer)'
  const theatre_adresse = 'Parc de Bruxelles, 1000 Bruxelles'

  const home = await fetchHtml(START_URL)
  const urls = parseListing(home).slice(0, maxPages)

  const reps = []
  for (const u of urls) {
    let ev = null
    try {
      ev = await tryParseEventPage(u)
    } catch {
      ev = null
    }
    if (!ev) continue

    if (ev.date < minDate || ev.date > maxDate) continue

    const rep = {
      source: SOURCE,
      source_url: START_URL,
      date: ev.date,
      heure: null,
      titre: ev.title,
      theatre_nom,
      theatre_adresse,
      url: ev.url,
      genre: null,
      style: null,
      description: null,
      image_url: null,
      is_theatre: true,
    }

    rep.fingerprint = computeFingerprint(rep)
    reps.push(rep)
  }

  return reps
}

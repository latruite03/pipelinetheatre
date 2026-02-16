import fetch from 'node-fetch'
import { computeFingerprint } from '../lib/normalize.mjs'

// Centre communautaire de Joli-Bois (Woluwe-Saint-Pierre)
// Thom policy: Stand-up OK; ignore other formats.

const SOURCE = 'jolibois'
const BASE = 'https://centrejolibois.be'
const AGENDA_URL = `${BASE}/agenda/`

function stripTags(s) {
  return String(s || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
}

function parseDateFrDot(s) {
  const m = String(s || '').match(/(\d{2})\.(\d{2})\.(\d{4})/)
  if (!m) return null
  return `${m[3]}-${m[2]}-${m[1]}`
}

async function fetchHtml(url) {
  const res = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 (OpenClaw pipelinetheatre)' } })
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`)
  return await res.text()
}

function parseAgenda(html) {
  const items = []

  // Each card has:
  // <h2>Title</h2>
  // <h3>DD.MM.YYYY</h3>
  // <p class="agenda-item-intro">PLACE</p>
  // <a href="/agenda/?i=..." ...>Plus d'infos</a>
  const re = /<h2[^>]*>([\s\S]*?)<\/h2>[\s\S]*?<h3[^>]*>([\s\S]*?)<\/h3>[\s\S]*?(?:<p[^>]*agenda-item-intro[^"]*"[^>]*>([\s\S]*?)<\/p>)?[\s\S]*?<a[^>]+href="([^"]+\?i=[^"]+)"[^>]*>\s*Plus d'infos\s*<\/a>/gi

  for (const m of html.matchAll(re)) {
    const titre = stripTags(m[1])
    const date = parseDateFrDot(stripTags(m[2]))
    const lieuDansSite = stripTags(m[3] || '') || null
    const href = m[4]
    const url = href.startsWith('http') ? href : `${BASE}${href}`
    if (!titre || !date) continue
    items.push({ titre, date, url, lieuDansSite })
  }

  return items
}

async function fetchDetail(url) {
  try {
    const html = await fetchHtml(url)
    const text = stripTags(html)

    // Find show time "show à 20h00" or "show à 20h"
    const tm = text.match(/show\s+à\s*(\d{1,2})h(\d{2})?/i)
    let heure = null
    if (tm) {
      const hh = String(tm[1]).padStart(2, '0')
      const mm = String(tm[2] || '00').padStart(2, '0')
      heure = `${hh}:${mm}`
    }

    // Keep a short description (the page is mostly text)
    const description = text.length ? text.slice(0, 600) : null

    return { heure, description }
  } catch {
    return { heure: null, description: null }
  }
}

export async function loadJoliBois({
  minDate = '2026-02-16',
  maxDate = '2026-06-30',
} = {}) {
  const theatre_nom = 'Centre communautaire de Joli-Bois'
  const theatre_adresse = 'Drève des Shetlands 15, 1150 Woluwe-Saint-Pierre'

  const html = await fetchHtml(AGENDA_URL)
  const items = parseAgenda(html)

  // Stand-up only
  const filtered = items.filter((x) => /stand\s*-?up|comedy club|what the fun/i.test(x.titre))

  const detailsByUrl = new Map()
  for (const x of filtered) {
    if (!detailsByUrl.has(x.url)) detailsByUrl.set(x.url, await fetchDetail(x.url))
  }

  const reps = []
  for (const x of filtered) {
    if (x.date < minDate || x.date > maxDate) continue
    const det = detailsByUrl.get(x.url) || {}

    const rep = {
      source: SOURCE,
      source_url: AGENDA_URL,
      date: x.date,
      heure: det.heure || null,
      titre: x.titre,
      theatre_nom,
      theatre_adresse,
      url: x.url,
      genre: null,
      style: null,
      description: det.description || null,
      image_url: null,
      is_theatre: true,
    }

    rep.fingerprint = computeFingerprint(rep)
    reps.push(rep)
  }

  return reps
}

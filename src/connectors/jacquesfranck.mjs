import fetch from 'node-fetch'
import { computeFingerprint } from '../lib/normalize.mjs'

const SOURCE = 'jacquesfranck'
const BASE = 'https://lejacquesfranck.be'
const START_URL = `${BASE}/agenda`

function stripTags(s) {
  return String(s || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
}

async function fetchHtml(url) {
  const res = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 (OpenClaw pipelinetheatre)' } })
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`)
  return await res.text()
}

function parseAgendaPage(html) {
  const items = []

  // Each event card:
  // <a class="events-container" href="https://lejacquesfranck.be/event/.../YYYY-MM-DD/">
  //   <h2 class="title-large">TITLE</h2>
  //   <p class="p-small">CATEGORIES</p>
  //   ... <img src="..." alt="TITLE |  Théâtre">
  const cardRe = /<a class="events-container" href="([^"]+\/\d{4}-\d{2}-\d{2}\/)">[\s\S]*?<h2 class="title-large"[^>]*>([\s\S]*?)<\/h2>[\s\S]*?<p class="p-small">([\s\S]*?)<\/p>[\s\S]*?(?:<img[^>]+src="([^"]+)"[^>]*alt="([^"]*)")?/gi

  for (const m of html.matchAll(cardRe)) {
    const url = m[1]
    const titre = stripTags(m[2])
    const categories = stripTags(m[3])
    const image_url = m[4] || null
    const alt = m[5] || ''

    const date = url.match(/\/(\d{4}-\d{2}-\d{2})\/$/)?.[1] || null
    if (!date) continue

    items.push({ url, titre, categories, alt, image_url, date })
  }

  const next = html.match(/href="(https:\/\/lejacquesfranck\.be\/agenda\/p\d+\/)"[^>]*>\s*\d+\s*<\/a>\s*<\/li>\s*<li[^>]*class="active"/i)?.[1] || null
  return { items, next }
}

async function fetchDetails(url) {
  try {
    const html = await fetchHtml(url)
    const ogDesc = html.match(/property="og:description" content="([^"]+)"/i)?.[1] || null
    const description = ogDesc ? stripTags(ogDesc) : null

    // Some pages have a time like 20:00 in a <time> tag; try to find HH:MM
    const heure = html.match(/\b(\d{1,2}:\d{2})\b/)?.[1] || null

    return { description, heure }
  } catch {
    return { description: null, heure: null }
  }
}

export async function loadJacquesFranck({
  minDate = '2026-02-15',
  maxDate = '2026-06-30',
  maxPages = 12,
} = {}) {
  const theatre_nom = 'Centre culturel Jacques Franck'
  const theatre_adresse = 'Chaussée de Waterloo 94, 1060 Saint-Gilles'

  const all = []
  let url = START_URL

  for (let i = 0; i < maxPages; i++) {
    const html = await fetchHtml(url)
    const { items, next } = parseAgendaPage(html)
    all.push(...items)
    if (!next) break
    url = next
  }

  // Filter: theatre pieces only
  const theatreItems = all.filter((x) => {
    const blob = `${x.categories} ${x.alt}`.toLowerCase()
    if (!blob.includes('théâtre') && !blob.includes('theatre')) return false
    // exclude obvious non-play theatre subtypes if they show up
    if (blob.includes('stand-up') || blob.includes('cinéma') || blob.includes('expo') || blob.includes('musique') || blob.includes('atelier')) return false
    return true
  })

  // Fetch details per unique URL (bounded)
  const detailsByUrl = new Map()
  for (const x of theatreItems) {
    if (!detailsByUrl.has(x.url)) detailsByUrl.set(x.url, await fetchDetails(x.url))
  }

  const reps = []
  for (const x of theatreItems) {
    if (x.date < minDate || x.date > maxDate) continue

    const details = detailsByUrl.get(x.url) || {}

    const rep = {
      source: SOURCE,
      source_url: START_URL,
      date: x.date,
      heure: details.heure || null,
      titre: x.titre,
      theatre_nom,
      theatre_adresse,
      url: x.url,
      genre: null,
      style: null,
      description: details.description || null,
      image_url: x.image_url || null,
      is_theatre: true,
    }

    rep.fingerprint = computeFingerprint(rep)
    reps.push(rep)
  }

  return reps
}

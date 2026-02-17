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

  // Parse each card block reliably
  const blockRe = /<a class="events-container"[\s\S]*?<\/a>/gi
  for (const bm of html.matchAll(blockRe)) {
    const block = bm[0]
    const url = block.match(/href="([^"]+\/\d{4}-\d{2}-\d{2}\/)"/i)?.[1] || block.match(/href="([^"]+\/\d{4}-\d{2}-\d{2}\/)"/i)?.[1]
    if (!url) continue

    const date = url.match(/\/(\d{4}-\d{2}-\d{2})\/$/)?.[1] || null
    if (!date) continue

    const titre = stripTags(block.match(/<h2 class="title-large"[^>]*>([\s\S]*?)<\/h2>/i)?.[1] || '')
    const categories = stripTags(block.match(/<p class="p-(?:small|sm)"[^>]*>([\s\S]*?)<\/p>/i)?.[1] || '')
    const image_url = block.match(/<img[^>]+src="([^"]+)"/i)?.[1] || null

    items.push({ url, titre, categories, alt: '', image_url, date })
  }

  // Next page: first /agenda/pN/
  const next = html.match(/href="(https:\/\/lejacquesfranck\.be\/agenda\/p\d+\/)"/i)?.[1] || null
  return { items, next }
}

async function fetchDetails(url) {
  try {
    const html = await fetchHtml(url)
    const ogDesc = html.match(/property="og:description" content="([^"]+)"/i)?.[1] || null
    const description = ogDesc ? stripTags(ogDesc) : null

    const h1 = stripTags(html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1] || '')
    const eventType = h1.split(/\s+/)[0] || null // e.g. "Cinéma", "Stand-up", "Théâtre"

    // Some pages have a time like 20:00 in a <time> tag; try to find HH:MM
    const heure = html.match(/\b(\d{1,2}:\d{2})\b/)?.[1] || null

    return { description, heure, eventType, h1 }
  } catch {
    return { description: null, heure: null, eventType: null, h1: null }
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

  // Fetch details per unique URL (bounded)
  // We classify using the detail page (agenda list categories are not reliable).
  const detailsByUrl = new Map()
  for (const x of all) {
    if (!detailsByUrl.has(x.url)) detailsByUrl.set(x.url, await fetchDetails(x.url))
  }

  const theatreItems = all.filter((x) => {
    const details = detailsByUrl.get(x.url) || {}

    // Prefer explicit type prefix from page H1
    const t = String(details.eventType || '').toLowerCase()
    if (t.startsWith('cin')) return false // cinéma / ciné-rencontre
    if (t.startsWith('expo')) return false
    if (t.startsWith('concert') || t.startsWith('musique')) return false
    if (t.startsWith('stand-up') || t.startsWith('standup')) return false

    if (t.startsWith('th')) return true // théâtre

    // Fallback: keyword heuristic
    const blob = `${x.titre} ${details.h1 || ''} ${details.description || ''}`.toLowerCase()
    if (blob.includes('théâtre') || blob.includes('theatre') || blob.includes('spectacle')) return true
    return false
  })

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

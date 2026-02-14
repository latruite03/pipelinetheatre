import fetch from 'node-fetch'
import { computeFingerprint } from '../lib/normalize.mjs'

const SOURCE = 'whalll'
const BASE = 'https://whalll.be'
const LIST_URL = `${BASE}/evenements/`

const FETCH_OPTS = {
  headers: {
    'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36',
    'accept-language': 'fr-BE,fr;q=0.9,en;q=0.7,nl;q=0.6',
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

function inRange(date) {
  return date >= '2026-02-01' && date <= '2026-06-30'
}

function formatTime(timeStr) {
  if (!timeStr) return null
  const m = /^(\d{2}):(\d{2})/.exec(timeStr)
  if (!m) return null
  return `${m[1]}:${m[2]}:00`
}

function parseJsonLd(html) {
  const script = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/i.exec(html)
  if (!script) return []

  try {
    const data = JSON.parse(script[1])
    return Array.isArray(data) ? data : [data]
  } catch (err) {
    return []
  }
}

function buildAddress(address) {
  if (!address) return null
  const parts = []
  if (address.streetAddress) parts.push(address.streetAddress)
  if (address.postalCode || address.addressLocality) {
    const locality = [address.postalCode, address.addressLocality].filter(Boolean).join(' ')
    if (locality) parts.push(locality)
  }
  return parts.join(', ') || null
}

export async function loadWHalll({ maxPages = 10 } = {}) {
  const reps = []

  for (let page = 1; page <= maxPages; page++) {
    const url = page === 1 ? LIST_URL : `${BASE}/evenements/page/${page}/`
    const html = await (await fetch(url, FETCH_OPTS)).text()
    const items = parseJsonLd(html)
    if (!items.length) break

    for (const item of items) {
      if (!item || item['@type'] !== 'Event') continue

      const startDate = item.startDate || ''
      const [date, timePart] = startDate.split('T')
      if (!date || !inRange(date)) continue

      const heure = formatTime(timePart || '')
      const titre = decodeHtmlEntities(item.name || 'Event').trim()

      // IMPORTANT: keep theatre_nom as the monitored venue name (not the internal room name)
      // item.location.name can be "Auditorium", "Salle Capart", etc.
      const theatre_nom = 'W:Halll'
      const theatre_adresse = buildAddress(item.location?.address) || 'Avenue Charles Thielemans 93, 1150 Woluwe-Saint-Pierre'

      const urlOut = item.url || url
      const is_complet = /complet|sold out|uitverkocht/i.test(`${titre} ${urlOut}`)

      const rep = {
        source: SOURCE,
        source_url: urlOut,
        date,
        heure,
        titre,
        theatre_nom,
        theatre_adresse,
        url: urlOut,
        genre: null,
        style: null,
        is_complet: !!is_complet,
        is_theatre: true,
      }

      rep.fingerprint = computeFingerprint(rep)
      reps.push(rep)
    }
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

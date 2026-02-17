import fetch from 'node-fetch'
import { computeFingerprint } from '../lib/normalize.mjs'
import { shouldEmitTheatre } from '../lib/classify.mjs'

// Escale du Nord (Centre culturel d'Anderlecht)
// Source: WordPress The Events Calendar (tribe) REST API.

const SOURCE = 'escaledunord'
const BASE = 'https://escaledunord.brussels'
const API = `${BASE}/wp-json/tribe/events/v1/events`
const SOURCE_URL = `${BASE}/agenda/`

function stripTags(s) {
  return String(s || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
}

async function fetchJson(url) {
  const res = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 (OpenClaw pipelinetheatre)' } })
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`)
  return await res.json()
}

function toIsoDate(dt) {
  // dt: "2026-03-11 20:00:00" or ISO-ish
  const s = String(dt || '')
  const m = s.match(/\d{4}-\d{2}-\d{2}/)
  return m ? m[0] : null
}

function toIsoTime(dt) {
  const s = String(dt || '')
  const m = s.match(/\b(\d{2}):(\d{2})(?::\d{2})?\b/)
  return m ? `${m[1]}:${m[2]}:00` : null
}

export async function loadEscaleDuNord({
  minDate = '2026-02-17',
  maxDate = '2026-06-30',
  perPage = 50,
  maxPages = 8,
} = {}) {
  const theatre_nom = 'Escale du Nord'
  const theatre_adresse = 'Rue de Scheut 32, 1070 Anderlecht'

  const reps = []

  for (let page = 1; page <= maxPages; page++) {
    const url = new URL(API)
    url.searchParams.set('per_page', String(perPage))
    url.searchParams.set('page', String(page))
    // reduce payload
    url.searchParams.set('_fields', 'events')

    let data
    try {
      data = await fetchJson(url.toString())
    } catch (e) {
      // WP may return 404 for out-of-range pages
      break
    }
    const events = data?.events || []
    if (!Array.isArray(events) || events.length === 0) break

    for (const e of events) {
      const startDate = toIsoDate(e?.start_date)
      const startTime = toIsoTime(e?.start_date)
      const endDate = toIsoDate(e?.end_date)
      const date = startDate || endDate
      if (!date) continue
      if (date < minDate || date > maxDate) continue

      const titre = stripTags(e?.title)
      const description = stripTags(e?.description)
      const urlEvent = e?.url || null
      const image_url = e?.image?.url || null

      const rep = {
        source: SOURCE,
        source_url: SOURCE_URL,
        date,
        heure: startTime,
        titre: titre || 'Événement',
        theatre_nom,
        theatre_adresse,
        url: urlEvent,
        genre: null,
        style: null,
        description: description || null,
        image_url,
        is_theatre: true,
      }

      // Filter: stay fairly strict (mixed venue), but stand-up is allowed.
      const strict = process.env.THEATRE_FILTER_STRICT !== '0'
      const gate = shouldEmitTheatre(rep, { strict })
      if (!gate.ok) continue

      rep.fingerprint = computeFingerprint(rep)
      reps.push(rep)
    }

    // stop early if last events are older than minDate (API order is usually desc)
    const last = events[events.length - 1]
    const lastDate = toIsoDate(last?.start_date) || toIsoDate(last?.end_date)
    if (lastDate && lastDate < minDate) break
  }

  // de-dup by fingerprint
  const seen = new Set()
  const out = []
  for (const r of reps) {
    if (seen.has(r.fingerprint)) continue
    seen.add(r.fingerprint)
    out.push(r)
  }

  return out
}

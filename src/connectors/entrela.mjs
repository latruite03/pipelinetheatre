import fetch from 'node-fetch'
import { computeFingerprint } from '../lib/normalize.mjs'

// L’Entrela’ (Evere)
// Source: Inertia page embeds JSON in `data-page` containing events + representations.

const SOURCE = 'entrela'
const BASE = 'https://www.lentrela.be'
const LIST_URL = `${BASE}/evenements`

function decodeEntities(s) {
  return String(s || '')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&#039;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#x27;/g, "'")
}

function stripTags(s) {
  return decodeEntities(s)
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

async function fetchHtml(url) {
  const res = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 (OpenClaw pipelinetheatre)' } })
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`)
  return await res.text()
}

function parseDataPage(html) {
  const m = html.match(/data-page="([\s\S]*?)">/)
  if (!m) return null
  const jsonStr = decodeEntities(m[1])
  try {
    return JSON.parse(jsonStr)
  } catch {
    return null
  }
}

function toIsoTime(hhmm) {
  const m = String(hhmm || '').match(/^(\d{1,2}):(\d{2})$/)
  if (!m) return null
  return `${m[1].padStart(2, '0')}:${m[2]}:00`
}

export async function loadEntrela({
  minDate = '2026-02-17',
  maxDate = '2026-06-30',
  maxPages = 6,
} = {}) {
  const theatre_nom = 'L’Entrela’'
  const theatre_adresse = 'Rue de la Cité 64, 1140 Evere'

  const reps = []

  for (let page = 1; page <= maxPages; page++) {
    const url = `${LIST_URL}?page=${page}`
    const html = await fetchHtml(url)
    const data = parseDataPage(html)
    const ev = data?.props?.evenements
    const list = ev?.data || []

    for (const e of list) {
      // Category is misspelled on site as "Théatre".
      const cat = stripTags(e?.categorie || '')
      if (!/^th[ée]atre/i.test(cat)) continue

      const titre = stripTags(e?.titre || 'Spectacle')
      const desc = stripTags(e?.description || '')
      const image_url = e?.imageUrl || null
      const eventUrl = e?.url ? (String(e.url).startsWith('http') ? e.url : `${BASE}/${String(e.url).replace(/^\/?/, '')}`) : url

      const repsList = Array.isArray(e?.representation) ? e.representation : []
      for (const r of repsList) {
        const date = r?.dateDebut
        const heure = toIsoTime(r?.heureDebut)
        if (!date) continue
        if (date < minDate || date > maxDate) continue

        const rep = {
          source: SOURCE,
          source_url: url,
          date,
          heure,
          titre,
          theatre_nom,
          theatre_adresse,
          url: eventUrl,
          genre: null,
          style: null,
          description: desc || null,
          image_url,
          is_theatre: true,
        }
        rep.fingerprint = computeFingerprint(rep)
        reps.push(rep)
      }
    }

    const meta = ev?.meta
    if (!meta?.nextPageUrl) break
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

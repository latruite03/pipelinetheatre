import fetch from 'node-fetch'
import { computeFingerprint } from '../lib/normalize.mjs'

const SOURCE = 'toone'
const BASE = 'https://www.toone.be'
const REPERTOIRE_URL = `${BASE}/fr/repertoire.php`

const FETCH_OPTS = {
  headers: {
    'user-agent': 'Mozilla/5.0',
    'accept-language': 'fr-BE,fr;q=0.9',
  },
}

function stripTags(s) {
  return (s || '')
    .replace(/<br\s*\/?\s*>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function inRange(date) {
  return date >= '2026-01-01' && date <= '2026-06-30'
}

async function fetchJson(url) {
  const res = await fetch(url, FETCH_OPTS)
  const text = await res.text()
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

function parseIdsFromHtml(html) {
  const ids = new Set()
  const re = /data-id="(\d+)"/g
  let m
  while ((m = re.exec(html))) ids.add(Number(m[1]))
  return Array.from(ids).sort((a, b) => a - b)
}

export async function loadToone() {
  // Thom explicitly wants Toone excluded (marionettes).
  // Returning empty prevents re-ingesting deleted rows.
  if (process.env.EXCLUDE_TOONE !== '0') return []

  const html = await (await fetch(REPERTOIRE_URL, FETCH_OPTS)).text()
  const ids = parseIdsFromHtml(html)

  const theatre_nom = 'Théâtre Royal de Toone'
  const theatre_adresse = 'Impasse Schuddeveld 6, 1000 Bruxelles'

  const reps = []

  for (const id of ids) {
    const data = await fetchJson(`${BASE}/fonctions/ajax.php?act=ficheevent&id=${id}&lg=fr`)
    if (!data || !data.details) continue

    const titre = data.details.nom || 'Spectacle'
    const image_url = `${BASE}/images/spectacles/${data.details.ID}.jpg`

    // sdesc is mostly a date range (already shown elsewhere), so we exclude it.
    const desc = stripTags(data.details.description)
    const description = (desc || '').slice(0, 320) || null

    const dates = Array.isArray(data.listeventdate) ? data.listeventdate : []

    for (const d of dates) {
      const date = d?.dateE
      const heure = d?.heuredeb
      if (!date || !heure) continue
      if (!inRange(date)) continue

      const rep = {
        source: SOURCE,
        source_url: REPERTOIRE_URL,
        date,
        heure,
        titre,
        theatre_nom,
        theatre_adresse,
        url: null,
        genre: null,
        style: null,
        image_url,
        ...(description ? { description } : {}),
      }

      rep.fingerprint = computeFingerprint(rep)
      reps.push(rep)
    }
  }

  // dedupe
  const out = []
  const seen = new Set()
  for (const r of reps) {
    if (seen.has(r.fingerprint)) continue
    seen.add(r.fingerprint)
    out.push(r)
  }
  return out
}

import fetch from 'node-fetch'
import { computeFingerprint } from '../lib/normalize.mjs'

// L’Os à Moelle (Schaerbeek)
// Policy (Thom): keep stand-up OK; ignore other recurring formats (impro, quiz, dance, etc.)

const SOURCE = 'osamoelle'
const BASE = 'https://www.osamoelle.be'
const START_URL = `${BASE}/`

function stripTags(s) {
  return String(s || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
}

function parseDdMm(s) {
  const m = String(s || '').match(/\b(\d{1,2})\/(\d{1,2})\b/)
  if (!m) return null
  const dd = m[1].padStart(2, '0')
  const mm = m[2].padStart(2, '0')
  return { dd, mm }
}

function toDateIso({ dd, mm }, year = 2026) {
  return `${year}-${mm}-${dd}`
}

async function fetchHtml(url) {
  const res = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 (OpenClaw pipelinetheatre)' } })
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`)
  return await res.text()
}

function extractUpcomingStandup(html) {
  // The homepage contains a big "PROCHAINEMENT" block with repeating cards.
  // Readability view showed patterns like: "WHAT THE FUN24/04Next".
  // We'll do a tolerant scan on plain text.
  const txt = stripTags(html)

  // capture (title ...)(dd/mm)
  const re = /(WHAT THE FUN)[^\d]{0,40}(\d{1,2}\/\d{1,2})/gi
  const items = []
  for (const m of txt.matchAll(re)) {
    const titre = stripTags(m[1])
    const ddmm = parseDdMm(m[2])
    if (!ddmm) continue
    items.push({ titre, ddmm })
  }

  // de-dup by titre+date
  const seen = new Set()
  const out = []
  for (const it of items) {
    const key = `${it.titre}|${it.ddmm.dd}/${it.ddmm.mm}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(it)
  }

  return out
}

export async function loadOsAMoelle({
  minDate = '2026-02-16',
  maxDate = '2026-06-30',
} = {}) {
  const theatre_nom = 'L’Os à Moelle'
  const theatre_adresse = 'Avenue Emile Max 153, 1030 Schaerbeek'

  const html = await fetchHtml(START_URL)
  const upcoming = extractUpcomingStandup(html)

  const reps = []
  for (const it of upcoming) {
    const date = toDateIso(it.ddmm, 2026)
    if (date < minDate || date > maxDate) continue

    const rep = {
      source: SOURCE,
      source_url: START_URL,
      date,
      heure: null,
      titre: it.titre,
      theatre_nom,
      theatre_adresse,
      url: START_URL,
      genre: null,
      style: null,
      description: 'Stand-up',
      image_url: null,
      is_theatre: true,
    }

    rep.fingerprint = computeFingerprint(rep)
    reps.push(rep)
  }

  return reps
}

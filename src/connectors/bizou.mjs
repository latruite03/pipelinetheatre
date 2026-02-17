import fetch from 'node-fetch'
import { computeFingerprint } from '../lib/normalize.mjs'

// Au B'Izou (Anderlecht)
// Source: lightweight agenda mirror https://bizousite.appspot.com/ (works well with web_fetch).

const SOURCE = 'bizou'
const AGENDA_URL = 'https://bizousite.appspot.com/'

const MONTHS = {
  janvier: '01',
  fevrier: '02',
  février: '02',
  mars: '03',
  avril: '04',
  mai: '05',
  juin: '06',
  juillet: '07',
  aout: '08',
  août: '08',
  septembre: '09',
  octobre: '10',
  novembre: '11',
  decembre: '12',
  décembre: '12',
}

function stripTags(s) {
  return String(s || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
}

async function fetchHtml(url) {
  const res = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 (OpenClaw pipelinetheatre)' } })
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`)
  return await res.text()
}

function parseAgendaText(text) {
  // Readability output looks like:
  // "Jeudi 12 mars 2026 à 20h" then title line then description.
  const t = String(text || '')

  const re = /(Lundi|Mardi|Mercredi|Jeudi|Vendredi|Samedi|Dimanche)\s+(\d{1,2})\s+([A-Za-zéûîôàèç]+)\s+(\d{4})\s+à\s+(\d{1,2})h(\d{2})?/gi

  const items = []
  const matches = [...t.matchAll(re)]
  for (let i = 0; i < matches.length; i++) {
    const m = matches[i]
    const day = String(m[2]).padStart(2, '0')
    const month = MONTHS[m[3].toLowerCase()]
    const year = m[4]
    const hh = String(m[5]).padStart(2, '0')
    const mm = String(m[6] || '00').padStart(2, '0')
    if (!month) continue

    const date = `${year}-${month}-${day}`
    const heure = `${hh}:${mm}:00`

    const start = m.index + m[0].length
    const end = i + 1 < matches.length ? matches[i + 1].index : t.length
    const block = t.slice(start, end)

    const lines = block
      .split(/\r?\n/)
      .map((x) => x.trim())
      .filter(Boolean)

    let titre = null
    for (const raw of lines) {
      const line = stripTags(raw)
      if (!line || line.length < 3) continue
      if (re.test(line)) continue
      if (/^(?:\:|\-|•)\s*/.test(line)) {
        const cleaned = line.replace(/^(?:\:|\-|•)\s*/, '').trim()
        if (cleaned.length >= 3) {
          titre = cleaned
          break
        }
      }
      // skip boilerplate/navigation
      if (/P\.A\.F\.|Parking|m[ée]tro|ouverture des portes|plan d'acc[eè]s|archives|partenaires|contact|espace artiste/i.test(line)) continue

      // Prefer a short-ish title line
      if (line.length <= 90) {
        titre = line
        break
      }
    }

    if (!titre) continue

    items.push({ date, heure, titre })
  }

  // de-dup by date+time+title
  const seen = new Set()
  const out = []
  for (const it of items) {
    const k = `${it.date}|${it.heure}|${it.titre}`
    if (seen.has(k)) continue
    seen.add(k)
    out.push(it)
  }
  return out
}

export async function loadBizou({
  minDate = '2026-02-17',
  maxDate = '2026-06-30',
} = {}) {
  const theatre_nom = "Au B'Izou"
  const theatre_adresse = 'Rue de la Promenade 13, 1070 Anderlecht'

  const html = await fetchHtml(AGENDA_URL)
  const text = stripTags(html)
  const items = parseAgendaText(text)
    // keep only theatre-ish items (Bizou can host other formats too)
    .filter((x) => /th[eé]âtre|com[ée]die|pi[èe]ce|lecture-spectacle|seul en sc[eè]ne|spectacle/i.test(x.titre.toLowerCase()))
    .filter((x) => !/hypnose|atelier|cours/i.test(x.titre.toLowerCase()))

  const reps = []
  for (const it of items) {
    if (it.date < minDate || it.date > maxDate) continue

    const rep = {
      source: SOURCE,
      source_url: AGENDA_URL,
      date: it.date,
      heure: it.heure,
      titre: it.titre,
      theatre_nom,
      theatre_adresse,
      url: AGENDA_URL,
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

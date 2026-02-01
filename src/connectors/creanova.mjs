import fetch from 'node-fetch'
import { computeFingerprint, stripDiacritics } from '../lib/normalize.mjs'

const SOURCE = 'creanova'
const URL = 'https://www.theatrecreanova.be/programmation/'

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

const FRENCH_MONTHS = [
  'janvier',
  'février',
  'fevrier',
  'mars',
  'avril',
  'mai',
  'juin',
  'juillet',
  'août',
  'aout',
  'septembre',
  'octobre',
  'novembre',
  'décembre',
  'decembre',
]

function decodeHtmlEntities(s) {
  return (s || '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&rsquo;/g, '’')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
}

function stripTags(s) {
  return decodeHtmlEntities(s || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function parseFrenchDateFromText(text) {
  const t = stripDiacritics(text).toLowerCase()
  const m = /(\d{1,2})\s+(janvier|fevrier|mars|avril|mai|juin|juillet|aout|septembre|octobre|novembre|decembre)\s+(\d{4})/.exec(
    t
  )
  if (!m) return null
  const day = String(m[1]).padStart(2, '0')
  const month = MONTHS[m[2]]
  const year = m[3]
  return `${year}-${month}-${day}`
}

function inRange(dateStr) {
  return dateStr >= '2026-01-01' && dateStr <= '2026-06-30'
}

function sanitizeDescription(text) {
  let t = (text || '').replace(/\s+/g, ' ').trim()
  if (!t) return null

  // Remove explicit French dates like "15 avril 2026"
  const monthAlt = FRENCH_MONTHS.map((m) => m.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')
  const reFr = new RegExp(`\\b\\d{1,2}\\s+(?:${monthAlt})\\s+\\d{4}\\b`, 'gi')
  t = t.replace(reFr, ' ')

  // Remove dd.mm.yyyy and hour-like markers
  t = t.replace(/\b\d{2}\.\d{2}\.\d{4}\b/gi, ' ')
  t = t.replace(/\b\d{1,2}h\d{2}\b/gi, ' ')
  t = t.replace(/\b\d{1,2}:\d{2}\b/gi, ' ')

  t = t.replace(/\s+/g, ' ').trim()
  return t || null
}

function findNearestTitle(html, idx) {
  const before = html.slice(Math.max(0, idx - 12000), idx)
  const m = /<h1[^>]*>([\s\S]*?)<\/h1>\s*$/i.exec(before)
  if (m) {
    const t = stripTags(m[1])
    if (t) return t
  }
  // fallback: last h1 anywhere in window
  const all = [...before.matchAll(/<h1[^>]*>([\s\S]*?)<\/h1>/gi)]
  if (all.length) {
    const t = stripTags(all[all.length - 1][1])
    if (t) return t
  }
  return null
}

function findNearestImage(html, idx) {
  const window = html.slice(Math.max(0, idx - 12000), idx + 2000)
  const m = /<img[^>]+src="(https:\/\/image\.jimcdn\.com\/[^\"]+)"/i.exec(window)
  return m ? decodeHtmlEntities(m[1]) : null
}

function findNearestVenue(html, idx) {
  const window = stripDiacritics(stripTags(html.slice(Math.max(0, idx - 5000), idx + 5000))).toLowerCase()

  if (window.includes('theatre mercelis') || window.includes('théâtre mercelis')) {
    return { theatre_nom: 'Théâtre Mercelis', theatre_adresse: 'Rue Mercelis 13, 1050 Ixelles' }
  }

  // Default to the company itself (unknown venue)
  return { theatre_nom: 'Théâtre CreaNova', theatre_adresse: null }
}

function findNearestDescription(html, idx) {
  // Jimdo pages are modular: the CTA is near content; try to pick nearby <p> blocks.
  const window = html.slice(Math.max(0, idx - 14000), idx + 6000)
  const paragraphs = [...window.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)]
    .map((m) => stripTags(m[1]))
    .map((t) => t.replace(/\s+/g, ' ').trim())
    .filter(Boolean)

  // Filter out CTA/venue/price/date-like lines
  const badRe = /(\bresa\b|\bréserv\b|\bticket\b|\bprix\b|\b€\b|\bart\.?\s*27\b|\bscolaire\b|\btout public\b|theatre mercelis|théâtre mercelis|bruxelles|ixelles)/i

  const filtered = paragraphs
    .map((t) => sanitizeDescription(t) || '')
    .map((t) => t.replace(/\s+/g, ' ').trim())
    .filter((t) => t.length >= 60)
    .filter((t) => !badRe.test(t))

  if (filtered.length === 0) return null

  // Prefer the longest meaningful paragraph; sometimes there are multiple short ones.
  filtered.sort((a, b) => b.length - a.length)
  const best = filtered[0]
  return best ? best.slice(0, 600) : null
}

export async function loadCreaNova() {
  const html = await (await fetch(URL)).text()

  const reps = []

  // Strategy A: only extract explicit dated CTAs, e.g.
  // data-title="RESA BRUXELLES- 15 avril 2026- Théâtre Mercelis"
  const re = /data-title="([^"]+)"[\s\S]{0,400}?href="([^"]+)"/gi
  let m
  while ((m = re.exec(html))) {
    const dataTitle = decodeHtmlEntities(m[1])
    const href = decodeHtmlEntities(m[2])

    const date = parseFrenchDateFromText(dataTitle)
    if (!date) continue
    if (!inRange(date)) continue

    const idx = m.index

    const titre = findNearestTitle(html, idx) || 'CreaNova'
    const image_url = findNearestImage(html, idx)
    const description = findNearestDescription(html, idx)
    const { theatre_nom, theatre_adresse } = findNearestVenue(html, idx)

    const rep = {
      source: SOURCE,
      source_url: URL,
      date,
      heure: null,
      titre,
      theatre_nom,
      theatre_adresse,
      url: href || URL,
      genre: null,
      style: null,
      ...(image_url ? { image_url } : {}),
      ...(description ? { description } : {}),
    }

    rep.fingerprint = computeFingerprint(rep)
    reps.push(rep)
  }

  // de-dup in case multiple CTAs point to the same date
  const seen = new Set()
  const out = []
  for (const r of reps) {
    const k = `${r.date}|${r.heure || ''}|${stripDiacritics(r.titre).toLowerCase()}|${stripDiacritics(r.theatre_nom).toLowerCase()}`
    if (seen.has(k)) continue
    seen.add(k)
    out.push(r)
  }

  return out
}

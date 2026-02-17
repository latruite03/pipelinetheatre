import fetch from 'node-fetch'
import { computeFingerprint } from '../lib/normalize.mjs'

const SOURCE = 'improviste'
const BASE = 'https://www.improviste.be'
const LIST_URL = `${BASE}/-Spectacles-.html`

function stripTags(s) {
  return String(s || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function decodeHtml(s) {
  return String(s || '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#0*39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&rsquo;|&lsquo;/g, '’')
}

async function fetchHtml(url) {
  const res = await fetch(url, {
    headers: {
      'user-agent': 'Mozilla/5.0 (OpenClaw pipelinetheatre)'
    }
  })
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`)
  return await res.text()
}

function toIsoDate(dmy) {
  const m = String(dmy).match(/(\d{1,2})\.(\d{2})\.(\d{4})/)
  if (!m) return null
  const dd = m[1].padStart(2, '0')
  const mm = m[2]
  const yyyy = m[3]
  return `${yyyy}-${mm}-${dd}`
}

function toIsoTime(hhmm) {
  const m = String(hhmm || '').match(/^(\d{1,2}):(\d{2})$/)
  if (!m) return null
  return `${m[1].padStart(2, '0')}:${m[2]}:00`
}

export async function loadImproviste({
  minDate = '2026-01-01',
  maxDate = '2026-06-30',
} = {}) {
  const theatre_nom = 'Théâtre L’Improviste'
  const theatre_adresse = null

  const html = await fetchHtml(LIST_URL)

  const reps = []

  // Each show is within <article class="vueHorizontale"> ... </article>
  const articleRe = /<article\s+class="vueHorizontale">([\s\S]*?)<\/article>/gi
  for (const m of html.matchAll(articleRe)) {
    const block = m[1]

    const href = block.match(/<a\s+href="([^"]+)"[^>]*title="([^"]+)"/i)
    const relUrl = href?.[1]
    const rawTitle = href?.[2]
    const titre = stripTags(decodeHtml(rawTitle || ''))
    if (!relUrl || !titre) continue

    const url = relUrl.startsWith('http') ? relUrl : `${BASE}/${relUrl.replace(/^\/+/, '')}`

    const imgSrc = block.match(/<img\s+[^>]*src="([^"]+)"/i)?.[1]
    const image_url = imgSrc ? (imgSrc.startsWith('http') ? imgSrc : `${BASE}/${imgSrc.replace(/^\/+/, '')}`) : null

    const excerpt = stripTags(decodeHtml(block.match(/<div\s+class="texte"[^>]*>([\s\S]*?)<\/div>/i)?.[1] || ''))

    // Dates list
    const liRe = /<li>\s*<span\s+class="date">[^\d]*(\d{1,2}\.\d{2}\.\d{4})\s*<span>à<\/span>\s*(\d{1,2}:\d{2})<\/span>\s*<\/li>/gi
    let found = false
    for (const lm of block.matchAll(liRe)) {
      found = true
      const date = toIsoDate(lm[1])
      const heure = toIsoTime(lm[2])
      if (!date) continue
      if (date < minDate || date > maxDate) continue

      const rep = {
        source: SOURCE,
        source_url: LIST_URL,
        date,
        heure,
        titre,
        theatre_nom,
        theatre_adresse,
        url,
        genre: null,
        style: null,
        description: excerpt || null,
        image_url,
        is_theatre: true,
      }
      rep.fingerprint = computeFingerprint(rep)
      reps.push(rep)
    }

    // If no dates found, skip (it might be an archive without scheduled representations)
    if (!found) continue
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

import fetch from 'node-fetch'
import { computeFingerprint, stripDiacritics } from '../lib/normalize.mjs'

const SOURCE = 'lavilla'
const BASE = 'https://lavillaculture.be'
const CATEGORY_ID = 31 // "événements la villa" (confirmed)

const FETCH_OPTS = {
  headers: {
    'user-agent': 'Mozilla/5.0 (OpenClaw pipelinetheatre)',
    'accept-language': 'fr-BE,fr;q=0.9,en;q=0.8',
  },
}

function stripTags(s) {
  return String(s || '')
    .replace(/<br\s*\/?\s*>/gi, ' ')
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
    .replace(/&#8211;/g, '–')
    .replace(/&#8217;/g, '’')
    .replace(/&quot;/g, '"')
}

function toAbsUrl(u) {
  if (!u) return null
  if (u.startsWith('http://') || u.startsWith('https://')) return u
  if (u.startsWith('/')) return `${BASE}${u}`
  return `${BASE}/${u}`
}

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

function toIsoTime(h, m) {
  const hh = String(h || '').padStart(2, '0')
  const mm = String(m ?? '00').padStart(2, '0')
  return `${hh}:${mm}:00`
}

function pickImageFromContent(html) {
  // try first <img ... src="...">
  const m = /<img[^>]+src="([^"]+)"/i.exec(String(html || ''))
  return m ? toAbsUrl(decodeHtml(m[1])) : null
}

function extractOccurrences(text) {
  // Returns [{date, heure}] from French strings inside content.
  // Handles:
  // - "Samedi 11 avril 2026 à 19h" / "Samedi 11 avril à 19h"
  // - "11 avril 2026 à 19:30" / "11 avril à 19h30"
  const clean = stripTags(decodeHtml(text))
    .replace(/\s+/g, ' ')
    .trim()

  const out = []

  // Pattern with year
  const reY = /(\d{1,2})\s+(janvier|février|fevrier|mars|avril|mai|juin|juillet|août|aout|septembre|octobre|novembre|décembre|decembre)\s+(20\d{2})[^\d]{0,40}?(?:à|a)\s*(\d{1,2})(?:\s*h\s*(\d{2})|:(\d{2}))?/gi
  let m
  while ((m = reY.exec(clean))) {
    const day = m[1].padStart(2, '0')
    const month = MONTHS[m[2].toLowerCase()]
    const year = m[3]
    if (!month) continue
    const date = `${year}-${month}-${day}`
    const minutes = m[5] || m[6] || '00'
    const heure = toIsoTime(m[4], minutes)
    out.push({ date, heure })
  }

  // Pattern without year: assume 2026 (project window)
  const re = /(\d{1,2})\s+(janvier|février|fevrier|mars|avril|mai|juin)\b[^\d]{0,40}?(?:à|a)\s*(\d{1,2})(?:\s*h\s*(\d{2})|:(\d{2}))?/gi
  while ((m = re.exec(clean))) {
    const day = m[1].padStart(2, '0')
    const month = MONTHS[m[2].toLowerCase()]
    if (!month) continue
    const date = `2026-${month}-${day}`
    const minutes = m[4] || m[5] || '00'
    const heure = toIsoTime(m[3], minutes)
    out.push({ date, heure })
  }

  // uniq
  const seen = new Set()
  const res = []
  for (const o of out) {
    const k = `${o.date}|${o.heure}`
    if (seen.has(k)) continue
    seen.add(k)
    res.push(o)
  }
  return res
}

function isTheatreLike(title, content) {
  const hay = stripDiacritics(`${title || ''} ${content || ''}`).toLowerCase()

  // positive hints
  const POS = ['theatre', 'spectacle', 'scene', 'comedie', 'drame', 'impro', 'stand up', 'standup', 'humour', 'conte']
  const hasPos = POS.some((w) => hay.includes(w.replace(/\s+/g, ' ')))

  // negative hints (workshops/expo etc.)
  const NEG = ['atelier', 'stage', 'exposition', 'vernissage', 'cours', 'formation', 'bibliotheque', 'visite', 'balade', 'conference', 'projection', 'cinema', 'concert']
  const hasNeg = NEG.some((w) => hay.includes(w))

  // If clearly negative and no theatre-ish hint, skip
  if (hasNeg && !hasPos) return false
  // Otherwise keep only if we have theatre-ish hint
  return hasPos
}

async function fetchJson(url) {
  const res = await fetch(url, FETCH_OPTS)
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`)
  return await res.json()
}

export async function loadLaVilla({ minDate = '2026-01-01', maxDate = '2026-06-30', perPage = 100 } = {}) {
  const theatre_nom = 'La Villa'
  const theatre_adresse = 'Rue de Naples 36, 1083 Ganshoren' // may be adjusted later if needed

  const reps = []

  // WP posts endpoint (date filtering is publication date; we still parse event dates in content)
  // We keep a bounded page loop.
  for (let page = 1; page <= 10; page++) {
    const url = `${BASE}/wp-json/wp/v2/posts?categories=${CATEGORY_ID}&per_page=${perPage}&page=${page}`
    let posts
    try {
      posts = await fetchJson(url)
    } catch (e) {
      // stop when page out of range or other
      break
    }
    if (!Array.isArray(posts) || posts.length === 0) break

    for (const p of posts) {
      const titre = stripTags(decodeHtml(p?.title?.rendered || ''))
      const contentHtml = p?.content?.rendered || ''
      const contentText = stripTags(decodeHtml(contentHtml))

      if (!isTheatreLike(titre, contentText)) continue

      const urlPost = toAbsUrl(p?.link) || `${BASE}/?p=${p?.id}`
      const image_url = pickImageFromContent(contentHtml)
      const occ = extractOccurrences(contentHtml)
      if (!occ.length) continue

      for (const o of occ) {
        if (o.date < minDate || o.date > maxDate) continue

        const rep = {
          source: SOURCE,
          source_url: url,
          date: o.date,
          heure: o.heure,
          titre,
          theatre_nom,
          theatre_adresse,
          url: urlPost,
          genre: null,
          style: null,
          description: contentText ? contentText.slice(0, 900) : null,
          image_url,
          is_theatre: true,
        }
        rep.fingerprint = computeFingerprint(rep)
        reps.push(rep)
      }
    }

    if (posts.length < perPage) break
  }

  // de-dup by fingerprint
  const out = []
  const seen = new Set()
  for (const r of reps) {
    if (seen.has(r.fingerprint)) continue
    seen.add(r.fingerprint)
    out.push(r)
  }

  return out
}

import fetch from 'node-fetch'
import { computeFingerprint } from '../lib/normalize.mjs'

const SOURCE = 'marni'
const BASE = 'https://theatremarni.com'
const SITEMAP = `${BASE}/sitemap.xml`

const FETCH_OPTS = {
  headers: {
    'user-agent': 'Mozilla/5.0',
    'accept-language': 'fr-BE,fr;q=0.9,en;q=0.8',
  },
}

function decodeHtmlEntities(s) {
  return (s || '')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
}

function stripTags(s) {
  return (s || '')
    .replace(/<br\s*\/?\s*>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
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

function inRange(date) {
  return date >= '2026-01-01' && date <= '2026-06-30'
}

function parseSitemapUrls(xml) {
  const urls = []
  const re = /<loc>([^<]+)<\/loc>/gi
  let m
  while ((m = re.exec(xml))) {
    const u = m[1]
    if (!u.startsWith(BASE)) continue
    if (/spip\.php/i.test(u)) continue
    // keep content pages that end with -digits (SPIP objects)
    if (/\/[^/]+-\d+$/.test(u)) urls.push(u)
  }
  return Array.from(new Set(urls))
}

function parseTitle(html) {
  const m = /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html)
  if (m) return stripTags(decodeHtmlEntities(m[1]))
  const og = /<meta property="og:title" content="([^"]+)"/i.exec(html)?.[1]
  return og ? decodeHtmlEntities(og).trim() : null
}

function hasTheatreTag(html) {
  // Marni pages expose content tags as small "chips" (e.g. EVENTS / THÉÂTRE).
  // We only want items explicitly tagged THÉÂTRE to avoid false positives (concerts, etc.).
  const decoded = decodeHtmlEntities(html)

  // Look for the tag label as visible element text (avoid matching in meta/JSON).
  // Example patterns observed: >THÉÂTRE<
  return />\s*TH[ÉE]ÂTRE\s*</i.test(decoded)
}

function parseImage(html) {
  return /<meta property="og:image" content="([^"]+)"/i.exec(html)?.[1] || null
}

function parseDescription(html) {
  const og = /<meta property="og:description" content="([^"]+)"/i.exec(html)?.[1]
  return og ? decodeHtmlEntities(og).trim() : null
}

function parseDatesWithTimes(html) {
  const text = stripTags(decodeHtmlEntities(html))
  const out = []

  // Look for patterns like "6 février 2026" and optional time nearby
  const re = /(\d{1,2})\s+(janvier|février|fevrier|mars|avril|mai|juin|juillet|août|aout|septembre|octobre|novembre|décembre|decembre)\s+(\d{4})([^\n]{0,80})/gi
  let m
  while ((m = re.exec(text))) {
    const day = m[1].padStart(2, '0')
    const month = MONTHS[m[2].toLowerCase()]
    const year = m[3]
    const tail = m[4] || ''

    if (!month) continue
    const date = `${year}-${month}-${day}`
    if (!inRange(date)) continue

    let time = null
    const tm = /(\d{1,2})\s*h\s*(\d{2})|(\d{1,2})\:(\d{2})/i.exec(tail)
    if (tm) {
      if (tm[1] && tm[2]) time = `${tm[1].padStart(2,'0')}:${tm[2]}:00`
      else if (tm[3] && tm[4]) time = `${tm[3].padStart(2,'0')}:${tm[4]}:00`
    }

    out.push({ date, heure: time })
  }

  return out
}

export async function loadMarni() {
  // This connector can be slow (sitemap + per-show fetch). Keep opt-in.
  if (process.env.MARNI_LIVE !== '1') {
    console.log('Marni: live fetch disabled (set MARNI_LIVE=1 to enable). Returning 0 rows.')
    return []
  }
  const sitemapXml = await (await fetch(SITEMAP, FETCH_OPTS)).text()
  const urls = parseSitemapUrls(sitemapXml)
  const limit = process.env.MARNI_LIMIT ? Number(process.env.MARNI_LIMIT) : 300
  const limitedUrls = urls.slice(0, limit)

  const theatre_nom = 'Théâtre Marni'
  const theatre_adresse = 'Rue de Vergnies 25, 1050 Ixelles, Bruxelles'

  const reps = []

  for (const url of limitedUrls) {
    const html = await (await fetch(url, FETCH_OPTS)).text()

    // Hard policy: keep only items explicitly tagged "THÉÂTRE" on Marni's site.
    // (They also list many non-theatre events.)
    if (!hasTheatreTag(html)) continue

    const titre = parseTitle(html) || 'Spectacle'
    const image_url = parseImage(html)
    const description = parseDescription(html)

    // Extra safety: drop obvious non-theatre items even if mis-tagged.
    const hay = `${titre} ${description || ''}`.toLowerCase()
    const NEG = [
      'kidz' /* kidzik/kidzik */, 'festival kidz',
      'concert', 'musique', 'dj', 'électro', 'electro', 'pop-électro', 'pop-electro',
      'orchestre', 'chanson', 'piano', 'guitare',
      'danse', 'choré', 'chore', 'chorégraph', 'chorégraphie', 'choregraph',
      'ciné', 'cinema', 'projection',
      'expo', 'exposition',
    ]
    if (NEG.some((w) => hay.includes(w))) {
      continue
    }

    const dates = parseDatesWithTimes(html)
    if (!dates.length) continue

    for (const d of dates) {
      const rep = {
        source: SOURCE,
        source_url: url,
        date: d.date,
        heure: d.heure,
        titre,
        theatre_nom,
        theatre_adresse,
        url,
        genre: null,
        style: null,
        ...(image_url ? { image_url } : {}),
        ...(description ? { description: description.slice(0, 500) } : {}),
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

import fetch from 'node-fetch'
import { computeFingerprint, stripDiacritics } from '../lib/normalize.mjs'

const SOURCE = 'balsamine'
const BASE = 'https://balsamine.be'

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

function decodeHtmlEntities(s) {
  return (s || '')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
}

function stripTags(s) {
  return (s || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
}

function pickFirst(re, text) {
  const m = re.exec(text)
  return m ? m[1] : null
}

function parsePostUrls(html) {
  const urls = new Set()
  const re = /href="(https:\/\/balsamine\.be\/balsa_post\/[^"]+?)"/gi
  let m
  while ((m = re.exec(html))) {
    const u = m[1].replace(/'$/, '')
    if (!u.includes('/balsa_post/')) continue
    urls.add(u.endsWith('/') ? u : u + '/')
  }
  return Array.from(urls)
}

function parseTitle(html) {
  const h1 = pickFirst(/<h1[^>]*>([\s\S]*?)<\/h1>/i, html)
  if (h1) return stripTags(decodeHtmlEntities(h1))
  const og = pickFirst(/<meta property="og:title" content="([^"]+)"/i, html)
  if (og) return og.replace(/\s*\|\s*la Balsamine\s*$/i, '').trim()
  return null
}

function parsePoster(html) {
  return pickFirst(/<meta property="og:image" content="([^"]+)"/i, html)
}

function parseBookingUrl(html) {
  // Try Ticketmatic links
  const m = /href="(https:\/\/apps\.ticketmatic\.com\/[^"]+)"[^>]*>\s*r[ée]server/iu.exec(html)
  if (m) return decodeHtmlEntities(m[1])
  return null
}

function parseDateTokens(text) {
  const t = stripDiacritics(text).toLowerCase()
  // Returns array of {day, monthName, time?}
  const out = []

  // pattern: le 12 fevrier a 18h00
  const reSingle = /\ble\s+(\d{1,2})\s+(janvier|fevrier|mars|avril|mai|juin|juillet|aout|septembre|octobre|novembre|decembre)\s+a\s+(\d{1,2})h(\d{2})?/g
  let m
  while ((m = reSingle.exec(t))) {
    const day = String(m[1]).padStart(2, '0')
    const month = MONTHS[m[2]]
    const hh = String(m[3]).padStart(2, '0')
    const mm = m[4] ? String(m[4]).padStart(2, '0') : '00'
    out.push({ day, month, time: `${hh}:${mm}:00` })
  }

  // pattern: du 3 au 7 mars
  const reRange = /\bdu\s+(\d{1,2})\s+au\s+(\d{1,2})\s+(janvier|fevrier|mars|avril|mai|juin|juillet|aout|septembre|octobre|novembre|decembre)\b/g
  while ((m = reRange.exec(t))) {
    const start = Number(m[1])
    const end = Number(m[2])
    const month = MONTHS[m[3]]
    for (let d = start; d <= end; d++) {
      out.push({ day: String(d).padStart(2, '0'), month, time: null })
    }
  }

  return out
}

function guessYearOrNull(month) {
  // For now we stop at June 2026 (no next season ingestion).
  const m = Number(month)
  if (m >= 1 && m <= 6) return '2026'
  return null
}

function extractUsefulText(html) {
  // Focus around title area where dates are displayed
  const afterH1 = /<h1[\s\S]*?<\/h1>([\s\S]{0,4000})/i.exec(html)?.[1] || html
  return stripTags(decodeHtmlEntities(afterH1))
}

function extractDescription(html) {
  let afterH1 = /<h1[\s\S]*?<\/h1>([\s\S]{0,25000})/i.exec(html)?.[1] || ''

  // Drop style/script blocks: otherwise their raw CSS/JS can leak into text.
  afterH1 = afterH1
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')

  // Collect a handful of paragraphs and pick the first that looks like a pitch.
  const ps = []
  const reP = /<p[^>]*>([\s\S]*?)<\/p>/gi
  let m
  while ((m = reP.exec(afterH1)) && ps.length < 20) {
    const t = stripTags(decodeHtmlEntities(m[1]))
    if (t) ps.push(t)
  }

  const looksLikeDates = (t) => {
    const s = stripDiacritics(t).toLowerCase()
    // typical patterns: "le 12 février à 18h00", "les 12 et 13 février", "du 3 au 7 mars"
    if (/\ble\s+\d{1,2}\s+\w+\s+a\s+\d{1,2}h/.test(s)) return true
    if (/\bles\s+\d{1,2}(\s*,\s*\d{1,2})*(\s+et\s+\d{1,2})?\s+\w+/.test(s) && s.includes('h')) return true
    if (/\bdu\s+\d{1,2}\s+au\s+\d{1,2}\s+\w+/.test(s)) return true
    if (s.includes('reserver') || s.includes('réserver')) return true
    return false
  }

  const looksLikeCss = (t) => {
    const s = stripDiacritics(t).toLowerCase()
    // Heuristics for CSS blobs
    if (t.includes('{') && t.includes('}')) return true
    if (s.includes('position:') || s.includes('font-size:') || s.includes('background:')) return true
    if (s.includes('#cob-') || s.includes('.cob-')) return true
    return false
  }

  for (const t of ps) {
    if (looksLikeDates(t)) continue
    if (looksLikeCss(t)) continue
    if (t.length < 80) continue
    return t
  }

  return null
}

export async function loadBalsamine({ limitPosts = 10 } = {}) {
  const progUrl = `${BASE}/programmation/`
  const html = await (await fetch(progUrl)).text()
  const postUrls = parsePostUrls(html).slice(0, limitPosts)

  const theatre_nom = 'Théâtre la Balsamine'
  const theatre_adresse = 'Avenue Félix Marchal 1, 1030 Schaerbeek'

  const reps = []

  for (const postUrl of postUrls) {
    const postHtml = await (await fetch(postUrl)).text()
    const titre = parseTitle(postHtml) || postUrl
    const image_url = parsePoster(postHtml)
    const description = extractDescription(postHtml)
    const booking = parseBookingUrl(postHtml)

    const text = extractUsefulText(postHtml)
    const dates = parseDateTokens(text)

    // If no explicit dates found, skip (we can improve later)
    for (const d of dates) {
      const year = guessYearOrNull(d.month)
      if (!year) continue
      const date = `${year}-${d.month}-${d.day}`
      const heure = d.time

      const rep = {
        source: SOURCE,
        source_url: postUrl,
        date,
        heure,
        titre,
        theatre_nom,
        theatre_adresse,
        url: booking || postUrl,
        genre: null,
        style: null,
        ...(description ? { description } : {}),
        ...(image_url ? { image_url } : {}),
      }
      rep.fingerprint = computeFingerprint(rep)
      reps.push(rep)
    }
  }

  return reps
}

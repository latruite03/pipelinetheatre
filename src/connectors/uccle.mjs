import fetch from 'node-fetch'
import { computeFingerprint } from '../lib/normalize.mjs'

// Centre Culturel d’Uccle (CCU)
// Source: https://www.ccu.be/programme/
// The page contains blocks like:
//   <div class="dates_block ..."> MA <span class="bolder">03 MAR</span><span> 20:15</span></div>
// followed by a link to /projects/... and title.
// We parse these blocks, expand date ranges when two dates are shown.

const SOURCE = 'ccu'
const SOURCE_URL = 'https://www.ccu.be/programme/'

const MONTHS = {
  JAN: '01',
  'FÉV': '02',
  FEV: '02',
  MAR: '03',
  AVR: '04',
  MAI: '05',
  JUN: '06',
  JUI: '07',
  JUL: '07',
  'AOÛ': '08',
  AOU: '08',
  SEP: '09',
  OCT: '10',
  NOV: '11',
  'DÉC': '12',
  DEC: '12',
}

function stripTags(s) {
  return String(s || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
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

function toIsoTime(hhmm) {
  const m = String(hhmm || '').match(/^(\d{1,2}):(\d{2})$/)
  if (!m) return null
  return `${m[1].padStart(2, '0')}:${m[2]}:00`
}

function addDays(date, n) {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

function expandRange(start, end) {
  const out = []
  for (let cur = start; cur <= end; cur = addDays(cur, 1)) out.push(cur)
  return out
}

function parseDateSpans(datesBlockHtml) {
  // captures "03 MAR" or " 06 OCT"
  const spans = []
  const re = /<span class="bolder">([\s\S]*?)<\/span>/gi
  for (const m of datesBlockHtml.matchAll(re)) {
    const txt = stripTags(decodeHtml(m[1]))
    const mm = txt.match(/(\d{1,2})\s*([A-ZÉÛ]{3})/)
    if (!mm) continue
    const day = mm[1].padStart(2, '0')
    const month = MONTHS[mm[2].toUpperCase()]
    if (!month) continue
    spans.push({ day, month })
  }
  return spans
}

function findBadgeNear(html, pos) {
  const window = html.slice(Math.max(0, pos - 500), pos + 500).toLowerCase()
  if (window.includes('théâtre') || window.includes('theatre')) return 'théâtre'
  if (window.includes('stand-up') || window.includes('stand up') || window.includes('humour')) return 'stand-up'
  return ''
}

function shouldKeep(badge, title) {
  const b = String(badge || '').toLowerCase()
  const t = String(title || '').toLowerCase()
  if (b.includes('théâtre') || b.includes('theatre')) return true
  if (b.includes('stand-up') || b.includes('stand up') || b.includes('humour')) return true
  // fallback keyword
  if (t.includes('théâtre') || t.includes('theatre')) return true
  if (t.includes('stand-up') || t.includes('stand up') || t.includes('humour')) return true
  return false
}

export async function loadCCUccle({ minDate = '2026-02-17', maxDate = '2026-06-30', limit = 400 } = {}) {
  const theatre_nom = "Centre Culturel d’Uccle"
  const theatre_adresse = 'Rue Rouge 47, 1180 Uccle'

  const res = await fetch(SOURCE_URL, { headers: { 'user-agent': 'Mozilla/5.0 (OpenClaw pipelinetheatre)' } })
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${SOURCE_URL}`)
  const html = await res.text()

  const reps = []

  // Block: dates_block ... then link to project and title.
  const re = /<div class="dates_block[\s\S]*?<\/div>[\s\S]{0,500}?<a href="(https:\/\/www\.ccu\.be\/projects\/[^"]+)"[^>]*>[\s\S]{0,500}?<h4[^>]*class="[^"]*title-vignette[^"]*"[^>]*>([\s\S]*?)<\/h4>/gi
  let n = 0
  for (const m of html.matchAll(re)) {
    if (n++ > limit) break
    const blockStart = m.index || 0

    // grab the dates_block html itself
    const before = html.slice(blockStart, blockStart + 600)
    const db = before.match(/<div class="dates_block[\s\S]*?<\/div>/i)?.[0] || ''

    const url = m[1]
    const titre = stripTags(decodeHtml(m[2]))
    const badge = findBadgeNear(html, blockStart)
    if (!shouldKeep(badge, titre)) continue

    const spans = parseDateSpans(db)
    const time = toIsoTime(db.match(/\b(\d{1,2}:\d{2})\b/)?.[1] || '')

    // ticket in nearby window
    const win = html.slice(blockStart, blockStart + 800)
    const ticket = win.match(/<a href="(https:\/\/shop\.utick\.be\/[^"]+)"/i)?.[1] || null

    // image in nearby window
    const image_url = win.match(/data-wpfc-original-src="([^"]+)"/i)?.[1] || win.match(/<img[^>]+src="([^"]+)"/i)?.[1] || null

    // Build date list
    let dates = []
    if (spans.length === 1) {
      const d = `2026-${spans[0].month}-${spans[0].day}`
      dates = [d]
    } else if (spans.length >= 2) {
      const start = `2026-${spans[0].month}-${spans[0].day}`
      const end = `2026-${spans[1].month}-${spans[1].day}`
      dates = expandRange(start, end)
    } else {
      continue
    }

    for (const date of dates) {
      if (date < minDate || date > maxDate) continue

      const rep = {
        source: SOURCE,
        source_url: SOURCE_URL,
        date,
        heure: time,
        titre: titre || 'Spectacle',
        theatre_nom,
        theatre_adresse,
        url: ticket || url,
        genre: null,
        style: null,
        description: null,
        image_url,
        is_theatre: true,
      }
      rep.fingerprint = computeFingerprint(rep)
      reps.push(rep)
    }
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

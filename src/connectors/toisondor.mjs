import fetch from 'node-fetch'
import { computeFingerprint, stripDiacritics } from '../lib/normalize.mjs'

const SOURCE = 'toisondor'
const BASES = ['https://www.toison-dor.com', 'https://www.ttotheatre.com']
const AGENDA_PATH = '/spectacles/'

const FETCH_OPTS = {
  headers: {
    'user-agent':
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36',
    'accept-language': 'fr-BE,fr;q=0.9,en;q=0.7',
  },
}

function decodeHtmlEntities(s) {
  return (s || '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&rsquo;/g, '’')
    .replace(/&lsquo;/g, '‘')
    .replace(/&eacute;/gi, 'é')
    .replace(/&egrave;/gi, 'è')
    .replace(/&ecirc;/gi, 'ê')
    .replace(/&agrave;/gi, 'à')
    .replace(/&acirc;/gi, 'â')
    .replace(/&icirc;/gi, 'î')
    .replace(/&ocirc;/gi, 'ô')
    .replace(/&uuml;/gi, 'ü')
    .replace(/&ldquo;/g, '“')
    .replace(/&rdquo;/g, '”')
    .replace(/&#8211;/g, '–')
    .replace(/&#8212;/g, '—')
}

function stripTags(s) {
  return decodeHtmlEntities(s || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function toAbsUrl(u, base) {
  if (!u) return null
  if (u.startsWith('http://') || u.startsWith('https://')) return u
  if (u.startsWith('/')) return `${base}${u}`
  return `${base}/${u}`
}

function inRange(date) {
  return date >= '2026-01-01' && date <= '2026-06-30'
}

async function fetchHtmlWithFallback(url) {
  const res = await fetch(url, FETCH_OPTS)
  if (res.ok) return { html: await res.text(), url: res.url }

  if (res.status === 403 && url.includes('toison-dor.com')) {
    const altUrl = url.replace('https://www.toison-dor.com', 'https://www.ttotheatre.com')
    const res2 = await fetch(altUrl, FETCH_OPTS)
    if (res2.ok) return { html: await res2.text(), url: res2.url }
  }

  return null
}

function parseSpectacleUrls(html, base) {
  const urls = new Set()

  // The listing uses absolute URLs.
  const reAbs = /href="(https?:\/\/(?:www\.)?(?:ttotheatre|toison-dor)\.com\/spectacle\/[^"]+?)"/gi
  let m
  while ((m = reAbs.exec(html))) urls.add(m[1])

  // Fallback for relative links.
  const reRel = /href="(\/spectacle\/[a-z0-9\-]+\/?)/gi
  while ((m = reRel.exec(html))) urls.add(toAbsUrl(m[1], base))

  return Array.from(urls)
}

function parseTitle(html) {
  const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)
  return h1 ? stripTags(h1[1]) : null
}

function parseImage(html) {
  // On TTO pages, the poster sits in <div class="spectacle__poster"><img ... src="...">
  const m = html.match(/<div class="spectacle__poster">[\s\S]*?<img[^>]+src="([^"]+)"/i)
  if (m) return m[1]

  // Fallback: first upload image
  const m2 = html.match(/<img[^>]+src="([^"]+\/wp-content\/uploads\/[^"]+)"/i)
  return m2 ? m2[1] : null
}

function parseDescription(html) {
  const m = html.match(/<div class="spectacle__content">([\s\S]*?)<\/div>/i)
  if (!m) return null
  const firstP = m[1].match(/<p[^>]*>([\s\S]*?)<\/p>/i)
  return firstP ? stripTags(firstP[1]) : stripTags(m[1])
}

function parseTicketUrl(html) {
  const m = /href="(https?:\/\/[^\"]*utick[^\"]+)"/i.exec(html)
  if (m) return decodeHtmlEntities(m[1])
  return null
}

function parseDateRange(html) {
  const block = html.match(/<div class="spectacle__dates[\s\S]*?<\/div>/i)
  if (!block) return null

  const times = [...block[0].matchAll(/<time[^>]*datetime="(\d{4}-\d{2}-\d{2})"/gi)].map((m) => m[1])
  if (times.length === 0) return null

  const start = times[0]
  const end = times.length > 1 ? times[1] : times[0]

  const p = block[0].match(/<p[^>]*>([\s\S]*?)<\/p>/i)
  const scheduleText = p ? stripTags(p[1]) : null
  const is_complet = /\bcomplet\b|sold out|epuise|épuis/i.test(stripTags(block[0]))

  return { start, end, scheduleText, is_complet }
}

const WEEKDAYS = {
  lundi: 1,
  mardi: 2,
  mercredi: 3,
  jeudi: 4,
  vendredi: 5,
  samedi: 6,
  dimanche: 0,
}

const MONTHS = {
  jan: 1,
  janv: 1,
  janvier: 1,
  fev: 2,
  fevr: 2,
  fevrier: 2,
  mar: 3,
  mars: 3,
  avr: 4,
  avril: 4,
  mai: 5,
  juin: 6,
  jui: 7,
  juil: 7,
  juillet: 7,
  aou: 8,
  aout: 8,
  sep: 9,
  sept: 9,
  septembre: 9,
  oct: 10,
  octobre: 10,
  nov: 11,
  novembre: 11,
  dec: 12,
  decembre: 12,
}

function parseTimesList(text) {
  const out = []
  if (!text) return out

  // Examples: 19h30, 20h00, 20:30
  const re = /(\d{1,2})\s*(?:h|:)\s*(\d{2})/gi
  let m
  while ((m = re.exec(text))) {
    const hh = String(m[1]).padStart(2, '0')
    const mm = String(m[2]).padStart(2, '0')
    out.push(`${hh}:${mm}:00`)
  }

  // uniq
  return Array.from(new Set(out))
}

function parseWeekdaysList(text) {
  if (!text) return []
  const t = stripDiacritics(text.toLowerCase())

  if (/tous\s+les\s+jours/.test(t) || /tous\s+jours/.test(t)) {
    return [0, 1, 2, 3, 4, 5, 6]
  }

  const days = []
  for (const [w, idx] of Object.entries(WEEKDAYS)) {
    if (t.includes(w)) days.push(idx)
  }
  return Array.from(new Set(days))
}

function parseSpecificDates(text, { startYear, startMonth } = {}) {
  // Parse statements like: "Samedi 28 février à 15h00 et 20h00"
  if (!text) return {}

  const t0 = stripDiacritics(text.toLowerCase())
  const out = {}

  const re = /(\d{1,2})\s+(janv(?:ier)?|jan|fevr(?:ier)?|fev|mars|mar|avr(?:il)?|mai|juin|juil(?:let)?|jui|aout|aou|sept(?:embre)?|sep|oct(?:obre)?|nov(?:embre)?|dec(?:embre)?|dec)/gi

  let m
  while ((m = re.exec(t0))) {
    const day = Number(m[1])
    const monKey = m[2]
    const month = MONTHS[monKey] || null
    if (!month) continue

    let year = startYear
    if (startMonth != null && month < startMonth && startMonth >= 11) {
      // If the range starts at end of year (Nov/Dec) and we mention Jan/Feb, it likely belongs to next year.
      year = startYear + 1
    }

    const date = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`

    // take a substring after the date mention to extract times
    const slice = t0.slice(m.index, m.index + 120)
    const times = parseTimesList(slice)
    if (times.length === 0) continue

    out[date] = Array.from(new Set([...(out[date] || []), ...times]))
  }

  return out
}

function expandDateTimes({ start, end, scheduleText }) {
  const startYear = Number(start.slice(0, 4))
  const startMonth = Number(start.slice(5, 7))

  const specificDates = parseSpecificDates(scheduleText, { startYear, startMonth })

  const weekdayRules = {}
  const scheduleNorm = stripDiacritics((scheduleText || '').toLowerCase())
  const segments = scheduleNorm
    .split('.')
    .map((s) => s.trim())
    .filter(Boolean)

  for (const seg of segments) {
    // skip segments that mention a concrete date; those are handled separately
    if (/\d{1,2}\s+(jan|janv|janvier|fev|fevr|fevrier|mar|mars|avr|avril|mai|juin|jui|juil|juillet|aou|aout|sep|sept|septembre|oct|octobre|nov|novembre|dec|decembre)/i.test(seg)) {
      continue
    }

    const times = parseTimesList(seg)
    if (times.length === 0) continue

    const days = parseWeekdaysList(seg)
    if (days.length === 0) {
      // If there is a single date, accept "20h30".
      if (start === end) {
        specificDates[start] = Array.from(new Set([...(specificDates[start] || []), ...times]))
      }
      continue
    }

    for (const d of days) {
      weekdayRules[d] = Array.from(new Set([...(weekdayRules[d] || []), ...times]))
    }
  }

  const startDt = new Date(Date.UTC(startYear, Number(start.slice(5, 7)) - 1, Number(start.slice(8, 10))))
  const endDt = new Date(Date.UTC(Number(end.slice(0, 4)), Number(end.slice(5, 7)) - 1, Number(end.slice(8, 10))))

  const out = []

  for (let cur = startDt; cur <= endDt; cur = new Date(cur.getTime() + 86400000)) {
    const y = cur.getUTCFullYear()
    const m = String(cur.getUTCMonth() + 1).padStart(2, '0')
    const d = String(cur.getUTCDate()).padStart(2, '0')
    const date = `${y}-${m}-${d}`

    const dow = cur.getUTCDay() // 0..6

    const times = []
    if (weekdayRules[dow]) times.push(...weekdayRules[dow])
    if (specificDates[date]) times.push(...specificDates[date])

    const uniqTimes = Array.from(new Set(times))
    for (const heure of uniqTimes) out.push({ date, heure })
  }

  // Deduplicate
  const seen = new Set()
  const res = []
  for (const dt of out) {
    const k = `${dt.date}|${dt.heure}`
    if (seen.has(k)) continue
    seen.add(k)
    res.push(dt)
  }

  return res
}

function isExternalVenue(scheduleText) {
  if (!scheduleText) return false
  const t = stripDiacritics(scheduleText.toLowerCase())
  // TTO site includes external productions tagged like "Au CCU" or "Genval".
  return /\bau\s+ccu\b/.test(t) || /\bgenval\b/.test(t) || /centre\s+culturel\s+duccle/.test(t)
}

export async function loadToisonDor() {
  let agendaHtml = null
  let agendaBase = null
  for (const base of BASES) {
    const res = await fetchHtmlWithFallback(`${base}${AGENDA_PATH}`)
    if (res?.html) {
      agendaHtml = res.html
      agendaBase = base
      break
    }
  }
  if (!agendaHtml) return []

  const showUrls = parseSpectacleUrls(agendaHtml, agendaBase)

  const theatre_nom = "Théâtre de la Toison d'Or"
  const theatre_adresse = "Galeries de la Toison d'Or 396-398, 1050 Ixelles"

  const reps = []

  for (const url of showUrls) {
    const res = await fetchHtmlWithFallback(url)
    if (!res?.html) continue
    const html = res.html

    const { start, end, scheduleText, is_complet } = parseDateRange(html) || {}
    if (!start || !end) continue

    if (isExternalVenue(scheduleText)) continue

    const titre = parseTitle(html) || 'Spectacle'
    const image_url = parseImage(html)
    const description = parseDescription(html)
    const ticket_url = parseTicketUrl(html)

    const dts = expandDateTimes({ start, end, scheduleText })

    for (const dt of dts) {
      if (!inRange(dt.date)) continue

      const rep = {
        source: SOURCE,
        source_url: url,
        date: dt.date,
        heure: dt.heure,
        titre,
        theatre_nom,
        theatre_adresse,
        url,
        genre: null,
        style: null,
        ...(ticket_url ? { ticket_url } : {}),
        ...(is_complet ? { is_complet: true } : {}),
        ...(image_url ? { image_url } : {}),
        ...(description ? { description } : {}),
      }

      rep.fingerprint = computeFingerprint(rep)
      reps.push(rep)
    }
  }

  const out = []
  const seen = new Set()
  for (const r of reps) {
    if (seen.has(r.fingerprint)) continue
    seen.add(r.fingerprint)
    out.push(r)
  }

  return out
}

import fetch from 'node-fetch'
import { computeFingerprint } from '../lib/normalize.mjs'

// La Clarencière (Ixelles)
// Small venue: be more permissive. Keep theatre + théâtre lyrique/cabaret (Thom).

const SOURCE = 'clarenciere'
const BASE = 'https://www.laclarenciere.be'
const AGENDA_FRAME_URL = `${BASE}/index_agenda.htm`

function decodeHtmlEntities(s) {
  return String(s || '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;|&#039;/g, "'")
    .replace(/&rsquo;|&lsquo;/g, "'")
    .replace(/&ldquo;|&rdquo;/g, '"')
    .replace(/&euro;/g, '€')
    // common accents
    .replace(/&egrave;/gi, 'è')
    .replace(/&eacute;/gi, 'é')
    .replace(/&ecirc;/gi, 'ê')
    .replace(/&agrave;/gi, 'à')
    .replace(/&acirc;/gi, 'â')
    .replace(/&icirc;/gi, 'î')
    .replace(/&ocirc;/gi, 'ô')
    .replace(/&ucirc;/gi, 'û')
    .replace(/&uuml;/gi, 'ü')
    .replace(/&ccedil;/gi, 'ç')
    .replace(/&hellip;/g, '…')
    .replace(/&ouml;/gi, 'ö')
}

function stripTags(s) {
  return decodeHtmlEntities(String(s || ''))
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function decodeLatin1(buf) {
  // site declares iso-8859-1
  return new TextDecoder('latin1').decode(buf)
}

async function fetchHtml(url) {
  const res = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 (OpenClaw pipelinetheatre)' } })
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`)
  const ab = await res.arrayBuffer()
  return decodeLatin1(ab)
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

function parseTime(s) {
  const m = String(s || '').match(/\b(\d{1,2})h(\d{2})\b/i)
  if (!m) return null
  return `${String(m[1]).padStart(2, '0')}:${m[2]}:00`
}

function expandDates(line) {
  // Handles:
  // "Le jeudi 12 mars 2026 à 20h30"
  // "Les jeudi 5, vendredi 6 et samedi 7 mars 2026 à 20h30"
  // "Les vendredi 13 février 2026 ..."
  const l = String(line || '').toLowerCase()

  // year + month at end
  const ym = l.match(/\b(\d{4})\b/) && l.match(/\b(janvier|février|fevrier|mars|avril|mai|juin|juillet|août|aout|septembre|octobre|novembre|décembre|decembre)\b/)
  if (!ym) return []
  const year = l.match(/\b(\d{4})\b/)?.[1]
  const monthName = l.match(/\b(janvier|février|fevrier|mars|avril|mai|juin|juillet|août|aout|septembre|octobre|novembre|décembre|decembre)\b/)?.[1]
  const month = MONTHS[monthName]
  if (!year || !month) return []

  const days = [...l.matchAll(/\b(\d{1,2})\b/g)].map((m) => m[1]).filter((d) => Number(d) >= 1 && Number(d) <= 31)
  // Too many numbers includes year; keep only day numbers by excluding 4-digit year and month-like numbers
  const dayNums = Array.from(new Set(days)).filter((d) => d.length <= 2)
  // remove the year itself if captured as day
  const cleaned = dayNums.filter((d) => d !== String(year))

  // Heuristic: keep the first 1-6 day numbers (these pages list a handful)
  const list = cleaned.slice(0, 6)
  return list.map((dd) => `${year}-${month}-${String(dd).padStart(2, '0')}`)
}

function parseShowTitleFromBlock(blockHtml) {
  const h2 = blockHtml.match(/<div[^>]+class="TitreSpectacle"[\s\S]*?<h2>([\s\S]*?)<\/h2>/i)?.[1]
  if (!h2) return null
  const firstLine = h2.split(/<br\s*\/?\s*>/i)[0]
  const title = stripTags(firstLine)
  return title || null
}

function isDeniedTitle(titre) {
  const t = titre.toLowerCase()
  return /atelier|stage|conf[eé]rence|rencontre|djemb[eé]|kora/i.test(t)
}

function toAbsUrl(src, baseUrl) {
  if (!src) return null
  try {
    return new URL(src, baseUrl).toString()
  } catch {
    return null
  }
}

function pickPosterFromBlock(blockHtml, pageUrl) {
  // Prefer affiche images (AFFICHES/...) and ignore obvious UI assets.
  const candidates = [...String(blockHtml || '').matchAll(/<img[^>]+src="([^"]+)"/gi)]
    .map((m) => m[1])
    .filter(Boolean)
    .filter((u) => !/presse\.gif/i.test(u))
    .filter((u) => !/logo/i.test(u))

  const preferred = candidates.find((u) => /AFFICHES\//i.test(u)) || candidates[0]
  return preferred ? toAbsUrl(preferred, pageUrl) : null
}

function parseAgendaText(html, pageUrl) {
  const blocks = String(html).split(/<div[^>]+class="TitreSpectacle"/i)
  const events = []

  for (let i = 1; i < blocks.length; i++) {
    const blockHtml = '<div class="TitreSpectacle"' + blocks[i]
    const titre = parseShowTitleFromBlock(blockHtml)
    if (!titre || isDeniedTitle(titre)) continue

    const image_url = pickPosterFromBlock(blockHtml, pageUrl)

    const cleaned = stripTags(blockHtml)

    // Look for each "Tout public" section inside the same show block
    const re = /Tout public\s*:\s*([\s\S]{0,220}?)(?:P\.A\.F\.|$)/gi
    let m
    while ((m = re.exec(cleaned))) {
      const dateLine = m[1] || ''
      const dates = expandDates(dateLine)
      const heure = parseTime(dateLine)
      for (const date of dates) {
        events.push({ titre, date, heure, image_url })
      }
    }
  }

  // de-dup by (titre,date,heure)
  const seen = new Set()
  const out = []
  for (const e of events) {
    const k = `${e.titre}|${e.date}|${e.heure || ''}`
    if (seen.has(k)) continue
    seen.add(k)
    out.push(e)
  }
  return out
}

export async function loadClarenciere({
  minDate = '2026-02-17',
  maxDate = '2026-06-30',
} = {}) {
  const theatre_nom = 'La Clarencière'
  const theatre_adresse = 'Rue du Belvédère 20, 1050 Ixelles'

  // The agenda page is a frameset; the mainFrame currently points at trimester HTML.
  const agendaFrameHtml = await fetchHtml(AGENDA_FRAME_URL)
  const main = agendaFrameHtml.match(/name="mainFrame"\s+src="([^"]+)"/i)?.[1]
  const mainUrl = main ? `${BASE}/${main}` : `${BASE}/SAISON_2025_2026/trismestre2.htm`

  // Also try trimester 3 (Apr-Jun) if present.
  const tri3Url = `${BASE}/SAISON_2025_2026/trismestre3.htm`

  const html2 = await fetchHtml(mainUrl)
  let html3 = ''
  try {
    html3 = await fetchHtml(tri3Url)
  } catch {
    html3 = ''
  }

  const items = [...parseAgendaText(html2, mainUrl), ...parseAgendaText(html3, tri3Url)]

  const reps = []
  for (const it of items) {
    if (it.date < minDate || it.date > maxDate) continue

    const rep = {
      source: SOURCE,
      source_url: mainUrl,
      date: it.date,
      heure: it.heure || null,
      titre: it.titre,
      theatre_nom,
      theatre_adresse,
      url: mainUrl,
      genre: null,
      style: null,
      description: null,
      image_url: it.image_url || null,
      is_theatre: true,
    }

    rep.fingerprint = computeFingerprint(rep)
    reps.push(rep)
  }

  return reps
}

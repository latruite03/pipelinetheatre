import fetch from 'node-fetch'
import { computeFingerprint, stripDiacritics } from '../lib/normalize.mjs'

// Centre culturel de Jette (L'Armillaire)
// Source: Utick widget (shop.utick.net) — works even when ccjette.be is unreachable.

const SOURCE = 'ccjette'
const UTICK_BASE = 'https://shop.utick.net/'
const POS = 'CCJETTE 2'

const FETCH_OPTS = {
  headers: {
    'user-agent': 'Mozilla/5.0 (OpenClaw pipelinetheatre)',
    'accept-language': 'fr-BE,fr;q=0.9,en;q=0.8',
  },
}

function decodeHtmlEntities(s) {
  return String(s || '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;|&#039;|&apos;/g, "'")
    .replace(/&#8211;/g, '–')
    .replace(/\s+/g, ' ')
    .trim()
}

function stripTags(s) {
  return decodeHtmlEntities(String(s || '').replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim()
}

function toAbsUtickUrl(href) {
  if (!href) return null
  if (href.startsWith('http://') || href.startsWith('https://')) return href
  if (href.startsWith('?')) return `${UTICK_BASE}${href}`
  if (href.startsWith('/')) return `${UTICK_BASE}${href.slice(1)}`
  return `${UTICK_BASE}${href}`
}

function inRange(date, minDate, maxDate) {
  return date >= minDate && date <= maxDate
}

function parseIndexSeriesUrls(html) {
  const hrefs = [...String(html || '').matchAll(/href="([^"]*module=ACTIVITYSERIEDETAILS[^"]*)"/gi)].map((m) => m[1])
  const out = []
  const seen = new Set()
  for (const h of hrefs) {
    const u = toAbsUtickUrl(h)
    if (!u) continue
    if (seen.has(u)) continue
    seen.add(u)
    out.push(u)
  }
  return out
}

function parseSeriesTitle(html) {
  // <title>Boite de Jour ...</title>
  const t = stripTags(/<title>([\s\S]*?)<\/title>/i.exec(html)?.[1] || '')
  return t ? t.replace(/\s*\|\s*Utick.*$/i, '').trim() : null
}

function parseSeriesCategory(html) {
  // First line in readability contains categories like "Atelier, Danse".
  // In HTML it's usually in a div with class "activity-series-categories".
  const m = /class="activity-series-categories"[\s\S]*?<[^>]*>([\s\S]*?)<\/div>/i.exec(html)
  if (m) return stripTags(m[1])
  // fallback: first strong line
  const m2 = /<body[\s\S]*?<div[^>]*>([A-Za-zÀ-ÿ,\s]{3,80})<\/div>/i.exec(html)
  return m2 ? stripTags(m2[1]) : null
}

function parseSeriesVenueLine(html) {
  // "Centre Culturel de Jette | Boulevard de Smet de Naeyer 145 - 1090 Jette"
  const m = /Centre\s+Culturel\s+de\s+Jette[\s\S]{0,140}?\|\s*([^<\n]+?\s*-\s*1090\s+Jette)/i.exec(html)
  return m ? stripTags(m[1]) : null
}

function parseOccurrences(html) {
  // Utick occurrences table rows: "Saturday 28 March 2026" + time
  const out = []
  const rowRe = /<tr[^>]*>[\s\S]*?<td[^>]*>\s*<a[^>]*>([^<]+)<\/a>[\s\S]*?<td[^>]*>\s*([0-9]{1,2}:[0-9]{2})[\s\S]*?<\/tr>/gi
  let m
  while ((m = rowRe.exec(html))) {
    const dateLabel = stripTags(m[1])
    const time = m[2]
    const dm = /(\d{1,2})\s+([A-Za-zÀ-ÿ]+)\s+(\d{4})/i.exec(dateLabel)
    if (!dm) continue

    const dd = String(dm[1]).padStart(2, '0')
    const monName = stripDiacritics(dm[2]).toLowerCase()
    const yyyy = dm[3]

    const MONTHS = {
      january: '01', february: '02', march: '03', april: '04', may: '05', june: '06',
      july: '07', august: '08', september: '09', october: '10', november: '11', december: '12',
      janvier: '01', fevrier: '02', février: '02', mars: '03', avril: '04', mai: '05', juin: '06',
      juillet: '07', aout: '08', août: '08', septembre: '09', octobre: '10', novembre: '11', decembre: '12', décembre: '12',
    }

    const mm = MONTHS[monName]
    if (!mm) continue

    const date = `${yyyy}-${mm}-${dd}`
    const [hh, mi] = time.split(':')

    const is_complet = /Complet|Sold\s*out/i.test(m[0])

    // reservation link in row (module=QUANTITY)
    const reserve = /href="(\?q=[^"]+module=QUANTITY[^"]*)"/i.exec(m[0])?.[1] || null

    out.push({
      date,
      heure: `${String(hh).padStart(2, '0')}:${mi}:00`,
      is_complet,
      reserveUrl: reserve ? toAbsUtickUrl(reserve) : null,
    })
  }
  return out
}

function isAllowed(title, category) {
  const t = stripDiacritics(String(title || '')).toLowerCase()
  const c = stripDiacritics(String(category || '')).toLowerCase()
  const hay = `${t} ${c}`

  // deny
  if (/\b(atelier|stage|cours|danse|workshop|exposition|expo|projection|film|concert|musique|club)\b/i.test(hay)) return false

  // allow theatre-ish
  if (/\b(theatre|théatre|spectacle|humour|stand[-\s]?up|conte|cirque|marionnette|lecture|performance)\b/i.test(hay)) return true

  // Otherwise: default deny (mixed venue)
  return false
}

export async function loadCCJette({
  minDate = '2026-01-01',
  maxDate = '2026-06-30',
} = {}) {
  const theatre_nom = "Centre culturel de Jette (L'Armillaire)"
  const theatre_adresse = 'Bd de Smet de Naeyer 145, 1090 Jette'

  // index page lists all activity series
  const indexUrl = `${UTICK_BASE}?pos=${encodeURIComponent(POS)}`
  const indexHtml = await (await fetch(indexUrl, FETCH_OPTS)).text()
  const seriesUrls = parseIndexSeriesUrls(indexHtml)

  const reps = []
  for (const sUrl of seriesUrls) {
    const html = await (await fetch(sUrl, FETCH_OPTS)).text()

    const titre = parseSeriesTitle(html) || 'Événement'
    const category = parseSeriesCategory(html) || ''
    if (!isAllowed(titre, category)) continue

    const occ = parseOccurrences(html)
    if (!occ.length) continue

    for (const o of occ) {
      if (!inRange(o.date, minDate, maxDate)) continue
      const rep = {
        source: SOURCE,
        source_url: sUrl,
        date: o.date,
        heure: o.heure,
        titre,
        theatre_nom,
        theatre_adresse,
        url: o.reserveUrl || sUrl,
        genre: null,
        style: null,
        is_complet: !!o.is_complet,
        is_theatre: true,
      }
      rep.fingerprint = computeFingerprint(rep)
      reps.push(rep)
    }
  }

  // de-dup
  const seen = new Set()
  const out = []
  for (const r of reps) {
    if (seen.has(r.fingerprint)) continue
    seen.add(r.fingerprint)
    out.push(r)
  }

  return out
}

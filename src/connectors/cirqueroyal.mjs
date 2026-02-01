import fetch from 'node-fetch'
import { computeFingerprint } from '../lib/normalize.mjs'

const SOURCE = 'cirqueroyal'
const BASE = 'https://www.cirque-royal-bruxelles.be'

function decodeHtmlEntities(s) {
  return (s || '')
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&rsquo;/g, '’')
    .replace(/&lsquo;/g, '‘')
    .replace(/&eacute;/g, 'é')
    .replace(/&egrave;/g, 'è')
    .replace(/&ecirc;/g, 'ê')
    .replace(/&agrave;/g, 'à')
    .replace(/&acirc;/g, 'â')
    .replace(/&icirc;/g, 'î')
    .replace(/&ocirc;/g, 'ô')
    .replace(/&ucirc;/g, 'û')
    .replace(/&ccedil;/g, 'ç')
}

function stripTags(s) {
  return (s || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
}

function pickFirst(re, text) {
  const m = re.exec(text)
  return m ? m[1] : null
}

function parseEventUrlsFromAgendaPartial(html) {
  const urls = new Set()
  const re = /href="(https:\/\/www\.cirque-royal-bruxelles\.be\/evenement\/[^"]+)"/gi
  let m
  while ((m = re.exec(html))) {
    urls.add(m[1])
  }
  return Array.from(urls)
}

function buildAgendaFilterQuery(arrayFilters) {
  // arrayFilters is array of { categorie, valeur }
  const params = new URLSearchParams()
  arrayFilters.forEach((f, i) => {
    params.set(`arrayFilters[${i}][categorie]`, f.categorie)
    params.set(`arrayFilters[${i}][valeur]`, f.valeur)
  })
  return params.toString()
}

function parseDateTimeFromEventUrl(eventUrl) {
  // ...-YYYY-MM-DD-HHMM
  const m = /-(\d{4})-(\d{2})-(\d{2})-(\d{4})(?:\/?$|\?)/.exec(eventUrl)
  if (!m) return { date: null, heure: null }
  const [, y, mo, d, hhmm] = m
  const date = `${y}-${mo}-${d}`
  const heure = `${hhmm.slice(0, 2)}:${hhmm.slice(2, 4)}:00`
  return { date, heure }
}

function isDateInRange(date, start, end) {
  if (!date) return false
  return date >= start && date <= end
}

function parseTitleFromEventPage(html) {
  const og = pickFirst(/<meta\s+property="og:title"\s+content="([^"]+)"\s*\/>/i, html)
  if (og) return decodeHtmlEntities(og).trim()
  const h1 = pickFirst(/<h1[^>]*>([\s\S]*?)<\/h1>/i, html)
  return h1 ? stripTags(decodeHtmlEntities(h1)) : null
}

function parseImageFromEventPage(html) {
  const ogImg = pickFirst(/<meta\s+property="og:image"\s+content="([^"]+)"\s*\/>/i, html)
  return ogImg ? ogImg.trim() : null
}

function parseDescriptionFromEventPage(html) {
  // Hidden input contains long description with entities
  const raw = pickFirst(/<input[^>]+name="description"[^>]+value="([^"]*)"/i, html)
  if (raw) return stripTags(decodeHtmlEntities(raw))

  const ogDesc = pickFirst(/<meta\s+property="og:description"\s+content="([^"]*)"\s*\/>/i, html)
  return ogDesc ? stripTags(decodeHtmlEntities(ogDesc)) : null
}

function parseTicketUrlFromEventPage(html) {
  // First outbound offer button, commonly Ticketmaster/Weezevent
  const href = pickFirst(/<a[^>]+itemtype="http:\/\/schema\.org\/Offer"[^>]+href="([^"]+)"/i, html)
  if (href) return href

  const href2 = pickFirst(/<a[^>]+class="btn btn-primary pull-right[^"]*"[^>]+href="([^"]+)"/i, html)
  return href2 || null
}

export async function loadCirqueRoyal({ startDate = '2026-01-01', endDate = '2026-06-30' } = {}) {
  const theatre_nom = 'Cirque Royal'
  const theatre_adresse = "Rue de l'Enseignement 81, 1000 Bruxelles"

  // Query only Theatre type, and months Jan-Jun 2026 (site uses mois=MM-YYYY)
  const months = ['01-2026', '02-2026', '03-2026', '04-2026', '05-2026', '06-2026']

  const eventUrls = new Set()

  for (const mois of months) {
    const qs = buildAgendaFilterQuery([
      { categorie: 'type', valeur: 'Théâtre' },
      { categorie: 'mois', valeur: mois },
    ])
    const url = `${BASE}/agenda?${qs}`
    const html = await (await fetch(url)).text()
    for (const u of parseEventUrlsFromAgendaPartial(html)) eventUrls.add(u)
  }

  const reps = []

  for (const eventUrl of Array.from(eventUrls)) {
    const { date, heure } = parseDateTimeFromEventUrl(eventUrl)
    if (!isDateInRange(date, startDate, endDate)) continue

    const html = await (await fetch(eventUrl)).text()

    const titre = parseTitleFromEventPage(html) || eventUrl
    const description = parseDescriptionFromEventPage(html)
    const image_url = parseImageFromEventPage(html)
    const ticketUrl = parseTicketUrlFromEventPage(html) || eventUrl

    const rep = {
      source: SOURCE,
      source_url: eventUrl,
      date,
      heure,
      titre,
      theatre_nom,
      theatre_adresse,
      url: ticketUrl,
      genre: null,
      style: null,
      description,
      ...(image_url ? { image_url } : {}),
    }

    rep.fingerprint = computeFingerprint(rep)
    reps.push(rep)
  }

  return reps
}

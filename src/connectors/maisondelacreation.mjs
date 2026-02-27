import fetch from 'node-fetch'
import { computeFingerprint } from '../lib/normalize.mjs'

const SOURCE = 'maisondelacreation'
const BASE = 'https://www.maisondelacreation.org'
const LIST_URL = `${BASE}/fr/evenements`
const SITEMAP_URL = `${BASE}/sitemap.xml`

const FETCH_OPTS = {
  headers: {
    'user-agent':
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36',
    'accept-language': 'fr-BE,fr;q=0.9,en;q=0.7,nl;q=0.6',
  },
}

function stripTags(s) {
  return (s || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#8217;|&#039;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim()
}

function toAbsUrl(u) {
  if (!u) return null
  if (u.startsWith('http://') || u.startsWith('https://')) return u
  if (u.startsWith('//')) return `https:${u}`
  if (u.startsWith('/')) return `${BASE}${u}`
  return `${BASE}/${u}`
}

function inRange(date) {
  return date >= '2026-01-01' && date <= '2026-06-30'
}

function isTheatreBadge(html) {
  // Robust detection: on theatre pages, the date "11.03" is followed shortly by a badge "Théâtre".
  // This avoids false positives like "INTI Théâtre" in credits.
  return /\b\d{1,2}\.\d{2}\b[\s\S]{0,250}>\s*Th[ée]âtre\s*<\/p>/i.test(html)
}

function parseListUrls(html) {
  // The list page contains absolute URLs like:
  // https://www.maisondelacreation.org/fr/programmation/evenements/<slug>
  const re = /https:\/\/www\.maisondelacreation\.org\/fr\/programmation\/evenements\/[a-z0-9-]+/gi
  return Array.from(new Set((html.match(re) || []).map((u) => u.trim())))
}

function parseSitemapUrls(xml) {
  const re = /<loc>(https:\/\/www\.maisondelacreation\.org\/fr\/programmation\/evenements\/[a-z0-9-]+)<\/loc>/gi
  const out = []
  let m
  while ((m = re.exec(xml))) out.push(m[1])
  return Array.from(new Set(out))
}

function decodeEntities(s) {
  return (s || '')
    .replace(/&#8217;|&#039;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
}

function parseTitle(html) {
  const og = /<meta property="og:title" content="([^"]+)"/i.exec(html)?.[1]
  if (og) {
    return stripTags(decodeEntities(og))
      .replace(/^Évènements\s*\|\s*Maison de la création\s*$/i, '')
      .replace(/\s*\|\s*Maison de la création\s*$/i, '')
      .trim()
  }

  // Fallback: <title>
  const tt = /<title>([^<]+)<\/title>/i.exec(html)?.[1]
  if (tt) {
    return stripTags(decodeEntities(tt)).replace(/\s*\|\s*Maison de la création\s*$/i, '').trim()
  }

  // NOTE: H1 on this site is often the logo/header, not the event title.
  return null
}

function parseImage(html) {
  const m = /<meta property="og:image" content="([^"]+)"/i.exec(html)?.[1]
  return m ? toAbsUrl(m) : null
}

function parseDescription(html) {
  // Prefer main content paragraphs (meta description is generic on this site).
  const body = /<div class="text-body">([\s\S]*?)<\/div>/i.exec(html)?.[1]
  if (body) {
    const ps = Array.from(body.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)).map((m) => stripTags(m[1]))
    const joined = ps.filter(Boolean).slice(0, 3).join(' ')
    if (joined && joined.length >= 80) return joined
  }

  const m = /<meta property="og:description" content="([^"]+)"/i.exec(html)?.[1]
  if (m) return stripTags(decodeEntities(m))

  // Fallback: first paragraph
  const p = /<p[^>]*>([\s\S]*?)<\/p>/i.exec(html)?.[1]
  return p ? stripTags(p) : null
}

function parseTheatreName(html) {
  // Maison de la création is an umbrella with multiple venues.
  // On detail pages, the venue label appears near the title section as plain text.
  const m = />\s*(MC\s+(?:Gare|Bockstael|NOH|Cité\s+Modèle|Cite\s+Modele))\s*</i.exec(html)
  if (m) {
    const v = stripTags(decodeEntities(m[1])).replace(/\s+/g, ' ').trim()
    return v.replace('MC Cite Modele', 'MC Cité Modèle')
  }
  return 'Maison de la création'
}

function parseAddress(theatreNom) {
  // Best-effort; the site has several venues. Keep blank if unknown.
  // We can refine later per sub-venue.
  return null
}

function parseOccurrencesFromIcs(html) {
  // Each occurrence has an "add to calendar" link with base64 ICS.
  // Example found on detail pages.
  const re = /data:text\/calendar;charset=utf8;base64,([A-Za-z0-9+/=]+)/g
  const b64s = []
  let m
  while ((m = re.exec(html))) b64s.push(m[1])

  const out = []
  for (const b64 of Array.from(new Set(b64s))) {
    try {
      const ics = Buffer.from(b64, 'base64').toString('utf-8')
      const dt = /DTSTART:(\d{8})T(\d{6})Z/.exec(ics)
      if (!dt) continue
      const y = dt[1].slice(0, 4)
      const mo = dt[1].slice(4, 6)
      const d = dt[1].slice(6, 8)
      const hh = dt[2].slice(0, 2)
      const mm = dt[2].slice(2, 4)

      out.push({ date: `${y}-${mo}-${d}`, heure: `${hh}:${mm}:00` })
    } catch {
      // ignore
    }
  }

  // de-dup
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

export async function loadMaisonDeLaCreation({ limitEvents = 250 } = {}) {
  // The list page is incomplete; sitemap is the most reliable discovery mechanism.
  let urls = []
  try {
    const sitemapXml = await (await fetch(SITEMAP_URL, FETCH_OPTS)).text()
    urls = parseSitemapUrls(sitemapXml)
  } catch {
    // fallback to list page
    const listHtml = await (await fetch(LIST_URL, FETCH_OPTS)).text()
    urls = parseListUrls(listHtml)
  }

  urls = urls.slice(0, limitEvents)

  const reps = []

  for (const url of urls) {
    const html = await (await fetch(url, FETCH_OPTS)).text()

    const titre = parseTitle(html) || 'Spectacle'
    const description = parseDescription(html)

    // Editorial pre-filter: only keep pages explicitly tagged as "Théâtre".
    if (!isTheatreBadge(html)) continue

    const image_url = parseImage(html)

    const theatre_nom = parseTheatreName(html)
    const theatre_adresse = parseAddress(theatre_nom)

    const dts = parseOccurrencesFromIcs(html)
    for (const dt of dts) {
      if (!dt?.date || !inRange(dt.date)) continue

      const rep = {
        source: SOURCE,
        source_url: url,
        date: dt.date,
        heure: dt.heure,
        titre,
        theatre_nom,
        ...(theatre_adresse ? { theatre_adresse } : {}),
        url,
        genre: null,
        style: null,
        ...(image_url ? { image_url } : {}),
        ...(description ? { description } : {}),
      }

      rep.fingerprint = computeFingerprint(rep)
      reps.push(rep)
    }
  }

  // de-dup by fingerprint
  const out = []
  const seen = new Set()
  for (const r of reps) {
    if (!r?.fingerprint) continue
    if (seen.has(r.fingerprint)) continue
    seen.add(r.fingerprint)
    out.push(r)
  }

  return out
}

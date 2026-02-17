import fetch from 'node-fetch'
import { computeFingerprint, stripDiacritics } from '../lib/normalize.mjs'

const SOURCE = 'boson'
const BASE = 'https://www.leboson.be'
const START_URL = `${BASE}/fr/plays/`
const MORE_URL = `${BASE}/fr/plays/more/`

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
    .replace(/&quot;/g, '"')
}

function toAbsUrl(u) {
  if (!u) return null
  if (u.startsWith('http://') || u.startsWith('https://')) return u
  if (u.startsWith('/')) return `${BASE}${u}`
  return `${BASE}/${u}`
}

function inRange(date, minDate, maxDate) {
  return date >= minDate && date <= maxDate
}

function parseTitle(html) {
  const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1]
  const t = stripTags(decodeHtml(h1 || ''))
  return t || null
}

function parseDescription(html) {
  // The body text is within <article> ... paragraphs.
  const art = html.match(/<article[\s\S]*?<\/article>/i)?.[0]
  if (!art) return null
  const text = stripTags(decodeHtml(art))
  // Keep it short-ish
  return text ? text.slice(0, 800) : null
}

function parseImage(html) {
  // Fancybox link in complementary figure: /image/.../fancybox/...jpg
  const m = html.match(/href="(\/image\/[^\"]+\/fancybox\/[^\"]+)"/i)?.[1]
  return m ? toAbsUrl(m) : null
}

function parseReservationUrl(html, fallback) {
  const m = html.match(/r[ée]servations\s*<\/a>\s*<a[^>]*href="([^"]+)"/i)?.[1]
  if (m) return decodeHtml(m)
  const m2 = html.match(/\bshop\.utick\.net\/[^"]+/i)?.[0]
  return m2 || fallback
}

function parseOccurrences(html) {
  // Example: "6/02/26 à 20h" or "6/02/26 à 20:30"
  const out = []
  const re = /(\d{1,2})\/(\d{1,2})\/(\d{2})\s*à\s*(\d{1,2})(?::|h)?(\d{2})?/gi
  let m
  while ((m = re.exec(html))) {
    const dd = m[1].padStart(2, '0')
    const mm = m[2].padStart(2, '0')
    const yy = m[3]
    const yyyy = Number(yy) < 70 ? `20${yy}` : `19${yy}`
    const hh = m[4].padStart(2, '0')
    const min = (m[5] || '00').padStart(2, '0')
    out.push({ date: `${yyyy}-${mm}-${dd}`, heure: `${hh}:${min}:00` })
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

function parsePrevNextUrls(html) {
  const urls = []
  for (const m of html.matchAll(/href="([^"]+)"[^>]*>\s*Spectacle\s+(?:pr[ée]c[ée]dent|suivant)/gi)) {
    urls.push(toAbsUrl(decodeHtml(m[1])))
  }
  return urls.filter(Boolean)
}

function parsePlayUrlsFromListing(html) {
  const urls = []
  for (const m of String(html || '').matchAll(/href="(https:\/\/www\.leboson\.be\/fr\/plays\/[0-9][^"]*)"/gi)) {
    const u = m[1]
    if (/\/fr\/plays\/(?:more\/)?$/i.test(u)) continue
    urls.push(u)
  }
  return Array.from(new Set(urls))
}

export async function loadBoson({ minDate = '2026-01-01', maxDate = '2026-06-30', maxPages = 200 } = {}) {
  const theatre_nom = 'Le Boson'
  const theatre_adresse = 'Chaussée de Boondael 361, 1050 Bruxelles'

  const reps = []

  // Seed with play URLs from listing pages
  const seed = new Set()
  for (const lurl of [START_URL, MORE_URL]) {
    const res = await fetch(lurl, FETCH_OPTS)
    if (!res.ok) continue
    const html = await res.text()
    for (const u of parsePlayUrlsFromListing(html)) seed.add(u)
  }

  const queue = Array.from(seed)
  const seenPages = new Set()

  while (queue.length && seenPages.size < maxPages) {
    const url = queue.shift()
    if (!url || seenPages.has(url)) continue
    seenPages.add(url)

    const res = await fetch(url, FETCH_OPTS)
    if (!res.ok) continue
    const html = await res.text()

    const titre = parseTitle(html)
    const occ = parseOccurrences(html)

    if (titre && occ.length) {
      const description = parseDescription(html)
      const image_url = parseImage(html)
      const bookingUrl = parseReservationUrl(html, url)

      for (const o of occ) {
        if (!inRange(o.date, minDate, maxDate)) continue

        const rep = {
          source: SOURCE,
          source_url: url,
          date: o.date,
          heure: o.heure,
          titre: stripTags(decodeHtml(titre)),
          theatre_nom,
          theatre_adresse,
          url: bookingUrl || url,
          genre: null,
          style: null,
          description: description || null,
          image_url: image_url || null,
          is_theatre: true,
        }
        rep.fingerprint = computeFingerprint(rep)
        reps.push(rep)
      }
    }

    for (const u of parsePrevNextUrls(html)) {
      if (u && !seenPages.has(u)) queue.push(u)
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

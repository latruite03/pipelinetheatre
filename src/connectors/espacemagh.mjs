import fetch from 'node-fetch'
import { computeFingerprint, stripDiacritics } from '../lib/normalize.mjs'

const SOURCE = 'espacemagh'
const BASE = 'https://www.espacemagh.be'

const MONTHS = ['01', '02', '03', '04', '05', '06'] // stop at June 2026

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

function uniq(arr) {
  return Array.from(new Set(arr))
}

function listUrl(month) {
  // Theatre discipline = 53, season 25-26 = sa=1046
  return `${BASE}/programme/?fa&post=projects&fi&sa=1046&ye=2026&mo=${month}&disc=53&actv=all&public=all&co=all&tour=all&map=false`
}

function parseProjectUrls(html) {
  const urls = []
  const re = /href="(https:\/\/www\.espacemagh\.be\/projects\/[^"]+)"/gi
  let m
  while ((m = re.exec(html))) {
    const u = m[1]
    // avoid archive listing /projects/
    if (/\/projects\/?$/.test(u)) continue
    urls.push(u)
  }
  return uniq(urls.map((u) => u.replace(/#.*$/, '')))
}

function parseCanonical(html) {
  const canon = pickFirst(/<link rel="canonical" href="([^"]+)"/i, html)
  return canon ? decodeHtmlEntities(canon) : null
}

function parseTitle(html) {
  const og = pickFirst(/<meta property="og:title" content="([^"]+)"/i, html)
  if (og) return og.replace(/\s*-\s*Espace Magh\s*$/i, '').trim()
  const h1 = pickFirst(/<h1[^>]*>([\s\S]*?)<\/h1>/i, html)
  if (h1) return stripTags(decodeHtmlEntities(h1))
  return null
}

function parseDescription(html) {
  const ogd = pickFirst(/<meta property="og:description" content="([^"]+)"/i, html)
  if (ogd) return decodeHtmlEntities(ogd).trim()

  // fallback: first substantial <p>
  const body = /<main[\s\S]*?<\/main>/i.exec(html)?.[0] || html
  const reP = /<p[^>]*>([\s\S]*?)<\/p>/gi
  let m
  while ((m = reP.exec(body))) {
    const t = stripTags(decodeHtmlEntities(m[1]))
    const s = stripDiacritics(t).toLowerCase()
    if (!t) continue
    if (t.length < 80) continue
    if (s.includes('tarif') || s.includes('reservation') || s.includes('réservation')) continue
    return t
  }

  return null
}

function parsePoster(html) {
  // try og:image
  const ogi = pickFirst(/<meta property="og:image" content="([^"]+)"/i, html)
  if (ogi) return decodeHtmlEntities(ogi)

  // fallback: first content image from wp-content/uploads
  const m = /<img[^>]+src="(https:\/\/www\.espacemagh\.be\/wp-content\/uploads\/[^"]+)"/i.exec(html)
  return m ? decodeHtmlEntities(m[1]) : null
}

function parseDateStarts(html) {
  // Example: <input type="hidden" name="date_start" value="2026-02-25 06:00PM">
  const dates = []
  const re = /name="date_start"\s+value="(\d{4}-\d{2}-\d{2})\s+(\d{1,2}):(\d{2})(AM|PM)"/gi
  let m
  while ((m = re.exec(html))) {
    const date = m[1]
    let hh = Number(m[2])
    const mm = m[3]
    const ap = m[4]

    if (ap === 'PM' && hh !== 12) hh += 12
    if (ap === 'AM' && hh === 12) hh = 0

    const heure = `${String(hh).padStart(2, '0')}:${mm}:00`
    dates.push({ date, heure })
  }
  return dates
}

function isInRange(dateStr) {
  // keep only 2026-01-01 .. 2026-06-30
  return /^2026-(0[1-6])-(\d{2})$/.test(dateStr)
}

export async function loadEspaceMagh({ months = MONTHS } = {}) {
  const theatre_nom = 'Espace Magh'
  const theatre_adresse = 'Rue du Poinçon 17, 1000 Bruxelles'

  const projectUrls = []
  for (const mo of months) {
    const html = await (await fetch(listUrl(mo))).text()
    projectUrls.push(...parseProjectUrls(html))
  }

  const uniqueProjects = uniq(projectUrls)
  const reps = []

  for (const u of uniqueProjects) {
    const html = await (await fetch(u)).text()

    const source_url = parseCanonical(html) || u
    const titre = parseTitle(html) || source_url
    const description = parseDescription(html)
    const image_url = parsePoster(html)

    const occurrences = parseDateStarts(html)
      .filter((d) => isInRange(d.date))

    for (const occ of occurrences) {
      const rep = {
        source: SOURCE,
        source_url,
        date: occ.date,
        heure: occ.heure,
        titre,
        theatre_nom,
        theatre_adresse,
        url: source_url,
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

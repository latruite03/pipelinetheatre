import fetch from 'node-fetch'
import { computeFingerprint, stripDiacritics } from '../lib/normalize.mjs'

const SOURCE = 'theatrenational'
const BASE = 'https://www.theatrenational.be'
const PROGRAM_URL = `${BASE}/fr/program/`

const FETCH_OPTS = {
  headers: {
    'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36',
    'accept-language': 'fr-BE,fr;q=0.9,en;q=0.8,nl;q=0.7',
  },
}

function stripTags(s) {
  return (s || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
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
}

function cleanText(s) {
  return stripTags(decodeHtmlEntities(s))
}

function toAbsUrl(u) {
  if (!u) return null
  if (u.startsWith('http://') || u.startsWith('https://')) return u
  if (u.startsWith('/')) return `${BASE}${u}`
  return `${BASE}/${u}`
}

function inRange(date) {
  return date >= '2026-01-01' && date <= '2026-06-30'
}

function isTheatreCategory(cat) {
  const c = stripDiacritics(cleanText(cat).toLowerCase())
  // keep theatre + marionnette etc if labelled theatre; exclude cinema/danse/expo/stage/rencontre.
  if (!c) return false
  if (c.includes('cinema')) return false
  if (c.includes('danse')) return false
  if (c.includes('exposition')) return false
  if (c.includes('stage')) return false
  if (c.includes('rencontre')) return false
  if (c.includes('festival')) return false
  // main include
  return c.includes('theatre')
}

function parseProgramItems(html) {
  // Each item:
  // <li class="item item--activity"> ... <a href=".../activities/..."> ... <div class="category">Théâtre</div> <h3 class="title">...</h3>
  const parts = html.split('<li class="item')
  const items = []

  for (let i = 1; i < parts.length; i++) {
    const chunk = '<li class="item' + parts[i]

    const urlM = /<a href="(https?:\/\/www\.theatrenational\.be\/fr\/activities\/[^"]+)"/i.exec(chunk)
    if (!urlM) continue
    const url = toAbsUrl(urlM[1])

    const catM = /<div class="category">([\s\S]*?)<\/div>/i.exec(chunk)
    const category = catM ? cleanText(catM[1]) : null

    const titleM = /<h3 class="title">([\s\S]*?)<\/h3>/i.exec(chunk)
    const title = titleM ? cleanText(titleM[1]) : null

    // keep only theatre
    if (!isTheatreCategory(category)) continue

    items.push({ url, title, category })
  }

  // uniq by url
  const seen = new Set()
  const out = []
  for (const it of items) {
    if (seen.has(it.url)) continue
    seen.add(it.url)
    out.push(it)
  }
  return out
}

function parseOgImage(activityHtml) {
  const m = /<meta property="og:image" content="([^"]+)"/i.exec(activityHtml)
  return m ? m[1] : null
}

function parseMetaDescription(activityHtml) {
  const m = /<meta name="description" content="([^"]+)"/i.exec(activityHtml)
  if (m) return cleanText(m[1])
  const m2 = /<meta property="og:description" content="([^"]+)"/i.exec(activityHtml)
  return m2 ? cleanText(m2[1]) : null
}

function parseCalendarDateTimes(activityHtml) {
  // Calendar block contains repeated:
  // <time datetime="2026-02-03">...</time> - 20:00
  const out = []
  const re = /<time datetime="(\d{4}-\d{2}-\d{2})"[\s\S]*?<\/time>[\s\S]*?-\s*(\d{1,2}:\d{2})/g
  let m
  while ((m = re.exec(activityHtml))) {
    const date = m[1]
    const hm = m[2]
    const hh = hm.split(':')[0].padStart(2, '0')
    const mm = hm.split(':')[1]
    out.push({ date, heure: `${hh}:${mm}:00` })
  }

  // uniq
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

export async function loadTheatreNational() {
  const programHtml = await (await fetch(PROGRAM_URL, FETCH_OPTS)).text()
  const items = parseProgramItems(programHtml)

  const theatre_nom = 'Théâtre National Wallonie-Bruxelles'
  const theatre_adresse = 'Boulevard Emile Jacqmain 111-115, 1000 Bruxelles'

  const reps = []

  for (const it of items) {
    const activityHtml = await (await fetch(it.url, FETCH_OPTS)).text()
    const image_url = parseOgImage(activityHtml)
    const description = parseMetaDescription(activityHtml)
    const dts = parseCalendarDateTimes(activityHtml)

    for (const dt of dts) {
      if (!inRange(dt.date)) continue

      const rep = {
        source: SOURCE,
        source_url: it.url,
        date: dt.date,
        heure: dt.heure,
        titre: it.title || 'Spectacle',
        theatre_nom,
        theatre_adresse,
        url: it.url,
        genre: null,
        style: null,
        ...(image_url ? { image_url } : {}),
        ...(description ? { description } : {}),
      }

      rep.fingerprint = computeFingerprint(rep)
      reps.push(rep)
    }
  }

  // dedupe by fingerprint
  const out = []
  const seen = new Set()
  for (const r of reps) {
    if (seen.has(r.fingerprint)) continue
    seen.add(r.fingerprint)
    out.push(r)
  }

  return out
}

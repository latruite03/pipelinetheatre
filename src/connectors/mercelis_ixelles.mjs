import fetch from 'node-fetch'
import { computeFingerprint, stripDiacritics } from '../lib/normalize.mjs'

const SOURCE = 'mercelis_ixelles'
const BASE = 'https://culture.ixelles.be'

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

function uniq(arr) {
  return Array.from(new Set(arr))
}

function parseRelatedEventUrlsFromVenuePage(html) {
  // On the venue page, there are repeated blocks:
  // <a href="https://culture.ixelles.be/fr/events/.../" style="position:absolute;...">
  const urls = []
  const re = /href="(https:\/\/culture\.ixelles\.be\/fr\/events\/[^"]+?)"/gi
  let m
  while ((m = re.exec(html))) {
    urls.push(decodeHtmlEntities(m[1]))
  }
  return uniq(urls.map((u) => (u.endsWith('/') ? u : u + '/')))
}

function parseTitle(html) {
  const m = /<h2 class="event-title">([\s\S]*?)<\/h2>/i.exec(html)
  if (m) return stripTags(decodeHtmlEntities(m[1])).replace(/&#8211;/g, '–')
  const og = /<meta property="og:title" content="([^"]+)"/i.exec(html)?.[1]
  if (og) return decodeHtmlEntities(og).replace(/\s*-\s*Ixelles\s*$/i, '').trim()
  return null
}

function parsePoster(html) {
  return /<meta property="og:image" content="([^"]+)"/i.exec(html)?.[1] || null
}

function parseDescription(html) {
  // Description tab contains a <p class="mb-0"> ...
  const m = /<div id="description"[\s\S]*?<p class="mb-0">([\s\S]*?)<\/p>/i.exec(html)
  if (m) {
    const t = stripTags(decodeHtmlEntities(m[1]))
    return t || null
  }
  const ogd = /<meta property="og:description" content="([^"]+)"/i.exec(html)?.[1]
  return ogd ? decodeHtmlEntities(ogd).trim() : null
}

function parseCategory(html) {
  // In the details table: "Catégorie :" then value
  const m = /Cat[ée]gorie\s*:<\/strong>[\s\S]*?<\/td>\s*<td>\s*([\s\S]*?)\s*(?:<\/td>)/i.exec(html)
  if (!m) return null
  return stripTags(decodeHtmlEntities(m[1]))
}

function parseVenueName(html) {
  const m = /<span id="address_title"><a[^>]*>([\s\S]*?)<\/a><\/span>/i.exec(html)
  if (m) return stripTags(decodeHtmlEntities(m[1]))
  return null
}

function parseInfoUrl(html, fallbackUrl) {
  const m = /<a id="reservation_btn" href="([^"]+)"/i.exec(html)
  return m ? decodeHtmlEntities(m[1]) : fallbackUrl
}

function parseDateRange(html) {
  // "27/01/2026 > 31/01/2026"
  const m = /(\d{2})\/(\d{2})\/(\d{4})\s*(?:&gt;|>)\s*(\d{2})\/(\d{2})\/(\d{4})/i.exec(html)
  if (!m) return null
  const start = `${m[3]}-${m[2]}-${m[1]}`
  const end = `${m[6]}-${m[5]}-${m[4]}`
  return { start, end }
}

function parseSingleDate(html) {
  // "27/01/2026"
  const m = /(\d{2})\/(\d{2})\/(\d{4})/i.exec(html)
  if (!m) return null
  return `${m[3]}-${m[2]}-${m[1]}`
}

function parseTime(html) {
  // First time like 20:00 or 20h00
  const m = /(\d{1,2})[:h](\d{2})/i.exec(html)
  if (!m) return null
  return `${m[1].padStart(2, '0')}:${m[2]}:00`
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

function parseWeeklySchedule(html) {
  // Extract start times per weekday from the practical info block.
  // Example:
  // mardi, jeudi, vendredi et samedi: de 20:30 à 22:00
  // mercredi: de 19:30 à 21:00
  const block = /<td id="horaire"[\s\S]*?<span class="info-text"[^>]*>([\s\S]*?)<\/span>/i.exec(html)?.[1]
  if (!block) return {}

  const text = stripTags(decodeHtmlEntities(block))
    .replace(/\s+/g, ' ')
    .trim()

  const map = {}

  // capture patterns like "mardi, jeudi, vendredi et samedi: de 20:30"
  const re1 = /(lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)(?:\s*,\s*(lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche))*[^:]*:\s*de\s*(\d{1,2}:\d{2})/gi
  let m
  while ((m = re1.exec(text))) {
    const time = m[3]
    // m[0] contains the whole group of days; pull all day words inside it.
    const segment = m[0].split(':')[0]
    const days = []
    const reDay = /(lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)/gi
    let dm
    while ((dm = reDay.exec(segment))) days.push(dm[1].toLowerCase())
    for (const d of days) map[d] = time
  }

  // closed days: "lundi: fermé"
  const reClosed = /(lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)\s*:\s*ferm[ée]/gi
  while ((m = reClosed.exec(text))) {
    map[m[1].toLowerCase()] = null
  }

  return map
}

function parseSpecificDates(html) {
  const block = /<td id="horaire"[\s\S]*?<span class="info-text"[^>]*>([\s\S]*?)<\/span>/i.exec(html)?.[1]
  if (!block) return []
  const text = stripTags(decodeHtmlEntities(block)).replace(/\s+/g, ' ').trim()
  const out = []
  const re = /(\d{1,2})\s+(janvier|février|fevrier|mars|avril|mai|juin|juillet|août|aout|septembre|octobre|novembre|décembre|decembre)\s+(\d{4}).*?\b(\d{1,2}:\d{2})/gi
  let m
  while ((m = re.exec(text))) {
    const day = m[1].padStart(2, '0')
    const month = MONTHS[m[2].toLowerCase()]
    const year = m[3]
    const time = m[4]
    if (month) out.push({ date: `${year}-${month}-${day}`, heure: `${time}:00` })
  }
  return out
}

function toWeekdayFr(date) {
  // date: YYYY-MM-DD
  const d = new Date(`${date}T00:00:00Z`)
  const wd = d.getUTCDay() // 0 Sun .. 6 Sat
  return ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'][wd]
}

function addDays(date, n) {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

function expandDateRange({ start, end }, scheduleByDay) {
  const out = []
  for (let cur = start; cur <= end; cur = addDays(cur, 1)) {
    if (cur < '2026-01-01' || cur > '2026-06-30') continue
    const wd = toWeekdayFr(cur)
    const t = scheduleByDay[wd]
    if (!t) continue
    out.push({ date: cur, heure: `${t}:00` })
  }
  return out
}

function isTheatreCategory(cat) {
  if (!cat) return false
  const c = stripDiacritics(cat).toLowerCase()
  // Their taxonomy: "Arts de la scène" for theatre-like stuff.
  if (c.includes('arts de la scene')) return true
  if (c.includes('theatre') || c.includes('théatre')) return true
  return false
}

export async function loadMercelisIxelles() {
  // Venue page (Petit Théâtre Mercelis)
  // Note: the site also has a global category page /fr/event/arts-de-la-scene/
  // but it mixes many venues (TTO, etc.). We must start from the Mercelis place page.
  const venueUrl = `${BASE}/fr/places/petit-theatre-mercelis/`
  const venueHtml = await (await fetch(venueUrl)).text()

  const eventUrls = parseRelatedEventUrlsFromVenuePage(venueHtml)

  const theatre_nom = 'Théâtre Mercelis'
  const theatre_adresse = 'Rue Mercelis 13, 1050 Ixelles'

  const reps = []

  for (const eventUrl of eventUrls) {
    const html = await (await fetch(eventUrl)).text()

    const venueName = parseVenueName(html)
    if (venueName && stripDiacritics(venueName).toLowerCase().includes('mercelis') === false) {
      // Safety: only keep events actually at Mercelis.
      continue
    }

    const category = parseCategory(html)
    if (!isTheatreCategory(category)) continue

    const titre = parseTitle(html) || eventUrl
    const image_url = parsePoster(html)
    const description = parseDescription(html)
    const url = parseInfoUrl(html, eventUrl)

    const range = parseDateRange(html)
    const schedule = parseWeeklySchedule(html)

    let occ = []
    if (range) {
      occ = expandDateRange(range, schedule)
      if (!occ.length) {
        // fallback: explicit dates with times in horaire block
        occ = parseSpecificDates(html)
      }
    } else {
      const single = parseSingleDate(html)
      const time = parseTime(html)
      if (single && time) occ = [{ date: single, heure: time }]
      if (!occ.length) occ = parseSpecificDates(html)
    }

    if (!occ.length) continue
    for (const o of occ) {
      const rep = {
        source: SOURCE,
        source_url: eventUrl,
        date: o.date,
        heure: o.heure,
        titre,
        theatre_nom,
        theatre_adresse,
        url,
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

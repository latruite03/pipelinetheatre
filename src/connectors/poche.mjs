import fetch from 'node-fetch'
import { computeFingerprint, stripDiacritics } from '../lib/normalize.mjs'

const SOURCE = 'poche'
const BASE = 'https://poche.be'
const HOME = `${BASE}/`

const FETCH_OPTS = {
  headers: {
    'user-agent': 'Mozilla/5.0',
    'accept-language': 'fr-BE,fr;q=0.9,en;q=0.8',
  },
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
    .replace(/&hellip;/g, '…')
    .replace(/&ldquo;/g, '“')
    .replace(/&rdquo;/g, '”')
}

function stripTags(s) {
  return decodeHtmlEntities(s || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function htmlToTextWithBreaks(html) {
  return decodeHtmlEntities(html || '')
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\s*\/p\s*>/gi, '\n\n')
    .replace(/<\s*p\b[^>]*>/gi, '')
    .replace(/<\s*\/li\s*>/gi, '\n')
    .replace(/<\s*li\b[^>]*>/gi, '• ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/[ \t\r\f\v]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
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

function parseShowLinks(homeHtml) {
  const urls = []
  const re = /https:\/\/poche\.be\/show\/[0-9]{4}-[a-z0-9\-]+/gi
  let m
  while ((m = re.exec(homeHtml))) urls.push(m[0])
  return Array.from(new Set(urls))
}

function parseOgImage(html) {
  const m = /<meta property="og:image" content="([^"]+)"/i.exec(html)
  return m ? toAbsUrl(m[1]) : null
}

function parseMetaDescription(html) {
  const m = /<meta name="description" content="([^"]+)"/i.exec(html)
  return m ? stripTags(m[1]) : null
}

function parseResumeSection(html) {
  // Show pages typically contain a dedicated section:
  // <section id="sect-resume"> ... <div class="fromWYSIWYG"> ... </div> ... </section>
  const sect = /<section[^>]+id="sect-resume"[^>]*>([\s\S]*?)<\/section>/i.exec(html)
  if (!sect) return null
  const block = sect[1]

  const wys = /<div[^>]+class="fromWYSIWYG"[^>]*>([\s\S]*?)<\/div>/i.exec(block)
  const contentHtml = wys ? wys[1] : block

  const text = htmlToTextWithBreaks(contentHtml)

  // Guard against empty / placeholder content.
  if (!text || text.length < 40) return null
  return text
}

function parseOgTitle(html) {
  const m = /<meta property="og:title" content="([^"]+)"/i.exec(html)
  return m ? stripTags(m[1]) : null
}

function parseH1(html) {
  const m = /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html)
  return m ? stripTags(m[1]) : null
}

function parseTitle(html) {
  // The <title> tag on poche.be show pages is generic ("Théâtre de Poche | Bruxelles").
  // The actual show title is in <h1> and also in og:title.
  const h1 = parseH1(html)
  if (h1) return h1
  const ogt = parseOgTitle(html)
  if (ogt) return ogt.split('|')[0].trim()
  return null
}

function parseDateRangeFromOgTitle(html) {
  // Example in og:title: "Pigeons | ... | Du 12 au 30 mai 2026 | ..."
  const ogt = parseOgTitle(html)
  if (!ogt) return null
  const m = /Du\s+(\d{1,2})\s+au\s+(\d{1,2})\s+([a-zéû]+)\s+(\d{4})/i.exec(ogt)
  if (!m) return null
  const d1 = String(m[1]).padStart(2, '0')
  const d2 = String(m[2]).padStart(2, '0')
  const month = MONTHS[stripDiacritics(m[3]).toLowerCase()] || MONTHS[m[3].toLowerCase()]
  const year = m[4]
  if (!month) return null
  return { start: `${year}-${month}-${d1}`, end: `${year}-${month}-${d2}` }
}

function dateRangeToDates(start, end) {
  const out = []
  const s = new Date(start + 'T00:00:00Z')
  const e = new Date(end + 'T00:00:00Z')
  for (let d = s; d <= e; d = new Date(d.getTime() + 86400000)) {
    const yyyy = d.getUTCFullYear()
    const mm = String(d.getUTCMonth() + 1).padStart(2, '0')
    const dd = String(d.getUTCDate()).padStart(2, '0')
    out.push(`${yyyy}-${mm}-${dd}`)
  }
  return out
}

function parseUtickSeriesUrl(html) {
  const m = html.match(
    /https?:\/\/shop\.utick\.(?:net|be)\/?\?[^"'\s>]*module=ACTIVITYSERIEDETAILS[^"'\s>]*s=[0-9A-F-]{36}/i
  )
  if (!m) return null
  // HTML has &amp; entities
  return m[0].replace(/&amp;/g, '&')
}

function parseUtickDates(utickHtml) {
  // Rows look like:
  // <a href="?q=...&module=QUANTITY">Le mercredi 4 février 2026</a>
  // time in next <td> like 19:30
  // and either a reserve link or a <div ...>Complet</div>
  const out = []
  const rowRe = /<tr>[\s\S]*?<td>\s*<a[^>]*>([^<]+)<\/a>[\s\S]*?<td>\s*([0-9]{2}:[0-9]{2})[\s\S]*?<\/tr>/gi
  let m
  while ((m = rowRe.exec(utickHtml))) {
    const label = stripTags(m[1])
    const time = m[2]
    const lower = stripDiacritics(label).toLowerCase()
    // Extract "4 février 2026"
    const dm = /\b(\d{1,2})\s+([a-zéû]+)\s+(\d{4})\b/i.exec(lower)
    if (!dm) continue
    const dd = String(dm[1]).padStart(2, '0')
    const month = MONTHS[stripDiacritics(dm[2]).toLowerCase()] || MONTHS[dm[2].toLowerCase()]
    const yyyy = dm[3]
    if (!month) continue
    const date = `${yyyy}-${month}-${dd}`

    const trBlock = m[0]
    const is_complet = /Complet/i.test(trBlock)

    // reservation link when available
    const rm = /href="(\?q=[^"]+module=QUANTITY[^"]*)"/i.exec(trBlock)
    const reserveUrl = rm ? `https://shop.utick.net/${rm[1].replace(/&amp;/g, '&')}` : null

    out.push({ date, heure: `${time}:00`, is_complet, reserveUrl })
  }
  return out
}

export async function loadPoche() {
  const homeHtml = await (await fetch(HOME, FETCH_OPTS)).text()
  const showUrls = parseShowLinks(homeHtml)

  const theatre_nom = 'Théâtre de Poche Bruxelles'
  const theatre_adresse = 'Chemin du Gymnase 1, 1000 Bruxelles'

  const reps = []

  for (const url of showUrls) {
    const html = await (await fetch(url, FETCH_OPTS)).text()

    const titre = parseTitle(html) || 'Spectacle'
    const image_url = parseOgImage(html)
    const description = parseResumeSection(html) || parseMetaDescription(html)

    const utickUrl = parseUtickSeriesUrl(html)

    if (utickUrl) {
      const utickHtml = await (await fetch(utickUrl, FETCH_OPTS)).text()
      const utickDates = parseUtickDates(utickHtml)

      for (const dt of utickDates) {
        if (!inRange(dt.date)) continue

        const rep = {
          source: SOURCE,
          source_url: url,
          date: dt.date,
          heure: dt.heure,
          titre,
          theatre_nom,
          theatre_adresse,
          url: dt.reserveUrl || utickUrl,
          is_complet: !!dt.is_complet,
          genre: null,
          style: null,
          ...(image_url ? { image_url } : {}),
          ...(description ? { description } : {}),
        }

        rep.fingerprint = computeFingerprint(rep)
        reps.push(rep)
      }

      continue
    }

    // Fallback: no Utick link found → keep old behavior (date range without per-date times)
    const range = parseDateRangeFromOgTitle(html)
    if (!range) continue

    const dates = dateRangeToDates(range.start, range.end)

    for (const date of dates) {
      if (!inRange(date)) continue

      const rep = {
        source: SOURCE,
        source_url: url,
        date,
        heure: null,
        titre,
        theatre_nom,
        theatre_adresse,
        url,
        is_complet: false,
        genre: null,
        style: null,
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

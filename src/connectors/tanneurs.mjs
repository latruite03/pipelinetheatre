import fetch from 'node-fetch'
import { computeFingerprint, stripDiacritics } from '../lib/normalize.mjs'

const SOURCE = 'tanneurs'
const PROGRAMME_URL = 'https://lestanneurs.be/programme/'

const FETCH_OPTS = {
  headers: {
    'user-agent': 'Mozilla/5.0',
    'accept-language': 'fr-BE,fr;q=0.9,en;q=0.8',
  },
}

const MONTHS = {
  jan: '01',
  fev: '02',
  fév: '02',
  mar: '03',
  avr: '04',
  mai: '05',
  jun: '06',
  juin: '06',
  jul: '07',
  août: '08',
  aou: '08',
  sep: '09',
  sept: '09',
  oct: '10',
  nov: '11',
  dec: '12',
  déc: '12',
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

function stripTags(s) {
  return decodeHtmlEntities(s || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function inRange(date) {
  return date >= '2026-01-01' && date <= '2026-06-30'
}

function parseShowUrls(programmeHtml) {
  const re = /https:\/\/lestanneurs\.be\/spectacle\/[a-z0-9\-]+\//gi
  const urls = []
  let m
  while ((m = re.exec(programmeHtml))) urls.push(m[0])
  return Array.from(new Set(urls))
}

function parseTitle(html) {
  const m = /<h1>([\s\S]*?)<\/h1>/i.exec(html)
  return m ? stripTags(m[1]) : null
}

function parseCoverImage(html) {
  // first big image in header cover
  const m = /<div class="c-cover"[\s\S]*?<img[^>]+src="([^"]+)"/i.exec(html)
  return m ? m[1] : null
}

function parseMetaDescription(html) {
  const m = /<meta name="description" content="([^"]+)"/i.exec(html)
  return m ? stripTags(m[1]) : null
}

function parseDates(html) {
  // Example strings: "04 Avr. 26 19:15"
  const re = /c-spectacle-list__date\">\s*([0-9]{2})\s+([A-Za-zÀ-ÿ]+)\.?\s+([0-9]{2})\s+([0-9]{2}:[0-9]{2})\s*<\/div>/g
  const out = []
  let m
  while ((m = re.exec(html))) {
    const dd = m[1]
    const monRaw = stripDiacritics(m[2]).toLowerCase()
    const mon = MONTHS[monRaw] || MONTHS[m[2].toLowerCase()]
    const yy = m[3]
    const time = m[4]
    if (!mon) continue
    const date = `20${yy}-${mon}-${dd}`
    const [hh, mi] = time.split(':')
    out.push({ date, heure: `${hh}:${mi}:00` })
  }

  // de-dupe
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

export async function loadTanneurs() {
  const programmeHtml = await (await fetch(PROGRAMME_URL, FETCH_OPTS)).text()
  const showUrls = parseShowUrls(programmeHtml)

  const theatre_nom = 'Théâtre Les Tanneurs'
  const theatre_adresse = 'Rue des Tanneurs 75-77, 1000 Bruxelles'

  const reps = []

  for (const url of showUrls) {
    const html = await (await fetch(url, FETCH_OPTS)).text()

    const titre = parseTitle(html) || 'Spectacle'
    const image_url = parseCoverImage(html)
    const description = parseMetaDescription(html)

    const dts = parseDates(html)
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

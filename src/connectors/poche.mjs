import fetch from 'node-fetch'
import { computeFingerprint } from '../lib/normalize.mjs'

const SOURCE = 'poche'
const BASE = 'https://poche.be'
const START_URL = `${BASE}/`

function stripTags(s) {
  return String(s || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
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

function parseRangeDates(s) {
  // examples:
  // "Du 3 au 21 février 2026"
  // "Du 12 au 30 mai 2026"
  const txt = String(s || '').toLowerCase()
  const m = txt.match(/du\s+(\d{1,2})\s+au\s+(\d{1,2})\s+([a-zéûîôàèç]+)\s+(\d{4})/i)
  if (!m) return null
  const startDay = m[1].padStart(2, '0')
  const endDay = m[2].padStart(2, '0')
  const month = MONTHS[m[3]]
  const year = m[4]
  if (!month) return null
  return {
    start: `${year}-${month}-${startDay}`,
    end: `${year}-${month}-${endDay}`,
  }
}

function parseUtickActivityDetailsUrl(html) {
  const m = String(html || '').match(/https:\/\/shop\.utick\.(?:be|net)\/\?[^"']*module=ACTIVITYSERIEDETAILS[^"']*/i)
  return m ? m[0].replace(/&amp;/g, '&') : null
}

function parseUtickOccurrences(html, baseUrl) {
  const out = []
  const months = {
    janvier: '01',
    février: '02',
    mars: '03',
    avril: '04',
    mai: '05',
    juin: '06',
    juillet: '07',
    août: '08',
    septembre: '09',
    octobre: '10',
    novembre: '11',
    décembre: '12',
  }

  // Row pattern: "Le samedi 28 mars 2026" then time; the QUANTITY link may be further away in the HTML.
  const re = /Le\s+(lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)\s+(\d{1,2})\s+(janvier|février|mars|avril|mai|juin|juillet|août|septembre|octobre|novembre|décembre)\s+(20\d{2})([\s\S]{0,2500}?)\b(\d{1,2}:\d{2})\b([\s\S]{0,2500}?)(?=Le\s+(?:lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)\s+\d{1,2}\s+|$)/gi
  let m
  while ((m = re.exec(html))) {
    const dd = String(m[2]).padStart(2, '0')
    const mm = months[m[3].toLowerCase()]
    const yyyy = m[4]
    const time = m[6]
    const date = mm ? `${yyyy}-${mm}-${dd}` : null

    const block = (m[5] || '') + ' ' + (m[7] || '')
    const qMatch = block.match(/href=\"([^\"]*module=QUANTITY[^\"]*)\"/i)
    const q = qMatch ? qMatch[1].replace(/&amp;/g, '&') : null

    const url = q ? (q.startsWith('http') ? q : `${baseUrl}${q.startsWith('?') ? q : '/' + q}`) : null
    if (date) out.push({ date, heure: `${time}:00`, url })
  }

  // uniq
  const seen = new Set()
  const res = []
  for (const o of out) {
    const k = `${o.date}|${o.heure}|${o.url || ''}`
    if (seen.has(k)) continue
    seen.add(k)
    res.push(o)
  }
  return res
}

async function fetchHtml(url) {
  const res = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 (OpenClaw pipelinetheatre)' } })
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`)
  return await res.text()
}

function parseHomepageShows(html) {
  const items = []

  // Homepage shows blocks like:
  // <h3>Les Héroïdes</h3>
  // <p>Inspiré ... | Du 3 au 21 février 2026</p>
  // <a ...>Lire</a> (link is nearby)
  // We'll use a tolerant regex that grabs h3 title, a following paragraph, and the first "Lire" link.
  const re = /<h4[^>]*>([\s\S]*?)<\/h4>[\s\S]*?<p[^>]*>([\s\S]*?)<\/p>[\s\S]*?<a[^>]+href="([^"]+)"[^>]*class="hiddenLink"[^>]*>\s*Lire\s*<\/a>/gi

  for (const m of html.matchAll(re)) {
    const titre = stripTags(m[1])
    const meta = stripTags(m[2])
    const href = m[3]
    const range = parseRangeDates(meta)

    if (!titre || !range) continue
    const url = href.startsWith('http') ? href : `${BASE}${href}`
    items.push({ titre, meta, startDate: range.start, endDate: range.end, url })
  }

  return items
}

async function fetchDetails(url) {
  try {
    const html = await fetchHtml(url)
    const ogDesc = html.match(/property="og:description" content="([^"]+)"/i)?.[1] || null
    const description = ogDesc ? stripTags(ogDesc) : null

    const img = html.match(/property="og:image" content="([^"]+)"/i)?.[1] || null

    const utickActivityUrl = parseUtickActivityDetailsUrl(html)

    return { description, image_url: img, utickActivityUrl, showHtml: html }
  } catch {
    return { description: null, image_url: null, utickActivityUrl: null, showHtml: null }
  }
}

export async function loadPoche({
  minDate = '2026-02-15',
  maxDate = '2026-06-30',
  limitShows = 30,
} = {}) {
  const theatre_nom = 'Théâtre de Poche'
  const theatre_adresse = 'Chemin du Gymnase 1A, 1000 Bruxelles'

  const html = await fetchHtml(START_URL)
  const shows = parseHomepageShows(html)

  const filtered = shows.filter((s) => s.endDate >= minDate && s.startDate <= maxDate).slice(0, limitShows)

  const detailsByUrl = new Map()
  for (const s of filtered) {
    if (!detailsByUrl.has(s.url)) detailsByUrl.set(s.url, await fetchDetails(s.url))
  }

  const reps = []
  for (const s of filtered) {
    const details = detailsByUrl.get(s.url) || {}
    const activityUrl = details.utickActivityUrl

    // If we can, emit real occurrences from Utick (prevents "heure à confirmer" duplicates)
    let occ = []
    if (activityUrl) {
      try {
        const actHtml = await fetchHtml(activityUrl)
        const base = new URL(activityUrl).origin
        occ = parseUtickOccurrences(actHtml, base)
      } catch {
        occ = []
      }
    }

    for (const o of occ) {
      if (o.date < minDate || o.date > maxDate) continue

      const rep = {
        source: SOURCE,
        source_url: START_URL,
        date: o.date,
        heure: o.heure,
        titre: s.titre,
        theatre_nom,
        theatre_adresse,
        url: o.url || activityUrl || s.url,
        genre: null,
        style: null,
        description: details.description || null,
        image_url: details.image_url || null,
        is_theatre: true,
      }
      rep.fingerprint = computeFingerprint(rep)
      reps.push(rep)
    }
  }

  return reps
}

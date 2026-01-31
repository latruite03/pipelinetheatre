import fetch from 'node-fetch'
import { computeFingerprint, stripDiacritics } from '../lib/normalize.mjs'

const SOURCE = 'archipel19'
const BASE = 'https://archipel19.be'
const LIST_URL = `${BASE}/evenements/categorie/spectacles/`

const FETCH_OPTS = {
  headers: {
    'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36',
    'accept-language': 'fr-BE,fr;q=0.9,en;q=0.8,nl;q=0.7',
  },
}

function stripTags(s) {
  return (s || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
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

function parseEventUrls(listHtml) {
  // Category archive uses <a href="https://archipel19.be/evenement/.../"> ...
  const urls = []
  const re = /href="(https?:\/\/archipel19\.be\/evenement\/[^"]+)"/gi
  let m
  while ((m = re.exec(listHtml))) urls.push(toAbsUrl(m[1]))

  // uniq
  return Array.from(new Set(urls))
}

function parseTitle(eventHtml) {
  const m = /<h1[^>]*class="tribe-events-single-event-title"[^>]*>([\s\S]*?)<\/h1>/i.exec(eventHtml)
  if (m) return stripTags(m[1])
  const m2 = /<title>([\s\S]*?)<\/title>/i.exec(eventHtml)
  return m2 ? stripTags(m2[1]).replace(/\s*-\s*Archipel 19\s*$/i, '').trim() : null
}

function parseDateTimes(eventHtml) {
  // On event page, top line often like: "dim 08.02.26 | 15h00"
  const out = []
  const re = /\b(\d{2})\.(\d{2})\.(\d{2})\s*\|\s*(\d{1,2})h(\d{2})\b/g
  let m
  while ((m = re.exec(eventHtml))) {
    const dd = m[1]
    const mm = m[2]
    const yy = m[3]
    const yyyy = `20${yy}`
    const hh = String(m[4]).padStart(2, '0')
    const min = m[5]
    out.push({ date: `${yyyy}-${mm}-${dd}`, heure: `${hh}:${min}:00` })
  }

  // fallback: sometimes time is absent; handle date-only "dim 08.02.26"
  if (out.length === 0) {
    const re2 = /\b(\d{2})\.(\d{2})\.(\d{2})\b/g
    while ((m = re2.exec(eventHtml))) {
      const dd = m[1]
      const mm = m[2]
      const yy = m[3]
      const yyyy = `20${yy}`
      out.push({ date: `${yyyy}-${mm}-${dd}`, heure: null })
    }
  }

  // uniq
  const seen = new Set()
  const res = []
  for (const dt of out) {
    const k = `${dt.date}|${dt.heure || ''}`
    if (seen.has(k)) continue
    seen.add(k)
    res.push(dt)
  }
  return res
}

export async function loadArchipel19() {
  const listHtml = await (await fetch(LIST_URL, FETCH_OPTS)).text()
  const eventUrls = parseEventUrls(listHtml)

  const theatre_nom = 'Archipel 19 – Le Fourquet'
  const theatre_adresse = "Place de l'Église 15, 1082 Berchem-Sainte-Agathe"

  const reps = []

  for (const url of eventUrls) {
    const eventHtml = await (await fetch(url, FETCH_OPTS)).text()
    const titre = parseTitle(eventHtml) || 'Spectacle'
    const dts = parseDateTimes(eventHtml)

    for (const dt of dts) {
      if (!dt.date || !inRange(dt.date)) continue

      const rep = {
        source: SOURCE,
        source_url: url,
        date: dt.date,
        heure: dt.heure, // may be null
        titre,
        theatre_nom,
        theatre_adresse,
        url,
        genre: null,
        style: null,
      }
      rep.fingerprint = computeFingerprint(rep)
      reps.push(rep)
    }
  }

  // filter out null times if your pipeline expects heure always (keep for now; upstream should handle)
  const out = []
  const seen = new Set()
  for (const r of reps) {
    const k = r.fingerprint
    if (seen.has(k)) continue
    seen.add(k)
    out.push(r)
  }
  return out
}

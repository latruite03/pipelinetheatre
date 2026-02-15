import { computeFingerprint, stripDiacritics } from '../lib/normalize.mjs'
import { shouldEmitTheatre } from '../lib/classify.mjs'

const SOURCE = 'https://theatredelavie.be'
const THEATRE_NOM = 'Théâtre de la Vie'
const THEATRE_ADRESSE = 'Rue Traversière 45, 1210 Saint-Josse-ten-Noode'

const MONTHS = new Map([
  ['janvier', '01'],
  ['fevrier', '02'],
  ['février', '02'],
  ['mars', '03'],
  ['avril', '04'],
  ['mai', '05'],
  ['juin', '06'],
  ['juillet', '07'],
  ['aout', '08'],
  ['août', '08'],
  ['septembre', '09'],
  ['octobre', '10'],
  ['novembre', '11'],
  ['decembre', '12'],
  ['décembre', '12'],
])

function pad2(n) { return String(n).padStart(2, '0') }

function* eachDayInclusive(startISO, endISO) {
  const start = new Date(`${startISO}T00:00:00Z`)
  const end = new Date(`${endISO}T00:00:00Z`)
  for (let d = start; d <= end; d = new Date(d.getTime() + 24 * 3600 * 1000)) {
    yield new Date(d)
  }
}

function toISODate(d) {
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`
}

function absUrl(href) {
  if (!href) return null
  try { return new URL(href, SOURCE).toString() } catch { return null }
}

function norm(s) {
  return stripDiacritics(String(s || '')).toLowerCase().trim()
}

function parseDateRange(text) {
  const t = norm(text).replace(/\s+/g, ' ')

  // Patterns seen on the site:
  // - "du 17 au 28 mars 2026"
  // - "du 22 au 24 janvier 2026"
  // - sometimes "07.10 > 18.10.2025" (on saisons page) -> ignore here

  let m = t.match(/\bdu\s+(\d{1,2})\s+au\s+(\d{1,2})\s+([a-zéèêàùôîç]+)\s+(\d{4})\b/i)
  if (m) {
    const d1 = Number(m[1])
    const d2 = Number(m[2])
    const monthName = m[3]
    const year = Number(m[4])
    const mm = MONTHS.get(monthName) || MONTHS.get(stripDiacritics(monthName))
    if (!mm) return null
    const start = `${year}-${mm}-${pad2(d1)}`
    const end = `${year}-${mm}-${pad2(d2)}`
    return { start, end }
  }

  // Single date pattern: "le 22.01.2026" or "le 22/01/2026"
  m = t.match(/\ble\s+(\d{1,2})[\.\/]?(\d{1,2})[\.\/]?(\d{4})\b/i)
  if (m) {
    const day = pad2(m[1])
    const month = pad2(m[2])
    const year = m[3]
    const iso = `${year}-${month}-${day}`
    return { start: iso, end: iso }
  }

  return null
}

function extractOgImage(html) {
  const m = html.match(/<meta\s+property=["']og:image["']\s+content=["']([^"']+)["']/i)
  return m ? m[1] : null
}

function stripTags(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

async function fetchText(url) {
  const res = await fetch(url, {
    headers: {
      'user-agent': 'Mozilla/5.0 (OpenClaw pipelinetheatre)'
    }
  })
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`)
  return await res.text()
}

export async function loadTheatreDeLaVie({ limitShows = 60 } = {}) {
  const saisonUrl = 'https://theatredelavie.be/?page=saisons'
  const html = await fetchText(saisonUrl)

  // Parse the season list directly (contains date + title + link)
  // Example structure:
  // <li class="liste-saison"><a href="/agenda/saison-2025-2026/.../"><ul class="liste-event">
  //   <li><span class="date">13.09.2025</span></li>
  //   <li><span>Ouverture de saison</span></li>
  //   <li><span>Théâtre de la Vie</span></li>
  // </ul></a></li>

  const items = []
  const liRe = /<li\s+class=["']liste-saison["'][^>]*>[\s\S]*?<a\s+href=["']([^"']+)["'][^>]*>[\s\S]*?<span\s+class=["']date["']\s*>\s*([0-9]{2}\.[0-9]{2}\.[0-9]{4})\s*<\/span>[\s\S]*?<ul\s+class=["']liste-event["'][^>]*>[\s\S]*?<li>\s*<span>\s*([^<]+?)\s*<\/span>\s*<\/li>[\s\S]*?<li>\s*<span>\s*([^<]+?)\s*<\/span>\s*<\/li>[\s\S]*?<\/a>/gi

  for (const m of html.matchAll(liRe)) {
    const href = absUrl(m[1])
    const dateFr = m[2]
    const titre = (m[3] || '').trim()
    const lieu = (m[4] || '').trim()

    if (!href || !titre || !dateFr) continue

    const [dd, mm, yyyy] = dateFr.split('.')
    const date = `${yyyy}-${mm}-${dd}`
    if (date < '2026-01-01' || date > '2026-06-30') continue

    items.push({ date, titre, url: href, lieu })
  }

  // If the regex ever fails (site change), fallback to a looser URL scrape
  if (items.length === 0) {
    const hrefs = Array.from(html.matchAll(/href=["']([^"']*\/agenda\/saison-2025-2026\/[^"']+)["']/gi))
      .map((m) => absUrl(m[1]))
      .filter(Boolean)
    const uniq = Array.from(new Set(hrefs))
    for (const u of uniq.slice(0, limitShows)) {
      items.push({ date: null, titre: u, url: u, lieu: null })
    }
  }

  const reps = []
  for (const it of items.slice(0, limitShows)) {
    let description = null
    let image_url = null

    // Try to enrich from detail page (best effort)
    try {
      const showHtml = await fetchText(it.url)
      const text = stripTags(showHtml)
      description = text.slice(0, 900)
      image_url = extractOgImage(showHtml)

      // Sometimes the detail page contains a date range; if so, expand it
      const range = parseDateRange(text)
      if (range && !(range.end < '2026-01-01' || range.start > '2026-06-30')) {
        for (const d of eachDayInclusive(range.start, range.end)) {
          const date = toISODate(d)
          if (date < '2026-01-01' || date > '2026-06-30') continue
          const rep = {
            source: SOURCE,
            source_url: saisonUrl,
            date,
            heure: null,
            titre: it.titre,
            theatre_nom: THEATRE_NOM,
            theatre_adresse: THEATRE_ADRESSE,
            url: it.url,
            genre: null,
            style: null,
            ...(description ? { description } : {}),
            ...(image_url ? { image_url } : {}),
          }
          const tNorm = norm(it.titre)
          if (
            tNorm.includes('lundynamite') ||
            tNorm.includes('scene de travers') ||
            tNorm.includes('scène de travers') ||
            tNorm.includes('scene ouverte') ||
            tNorm.includes('scène ouverte') ||
            tNorm.includes('sortie de residence') ||
            tNorm.includes('sortie de résidence') ||
            tNorm.includes('residence') ||
            tNorm.includes('résidence') ||
            tNorm.includes('atelier') ||
            tNorm.includes('stage')
          ) {
            continue
          }

          const { ok } = shouldEmitTheatre(rep, { strict: true })
          if (!ok) continue
          rep.fingerprint = computeFingerprint(rep)
          reps.push(rep)
        }
        continue
      }
    } catch {
      // ignore
    }

    // Otherwise: use the single date from the season list
    if (!it.date) continue

    // Strict mode for Thom: keep plays only (exclude scene ouverte / lundynamite / residencies / workshops)
    const tNorm = norm(it.titre)
    if (
      tNorm.includes('lundynamite') ||
      tNorm.includes('scene de travers') ||
      tNorm.includes('scène de travers') ||
      tNorm.includes('scene ouverte') ||
      tNorm.includes('scène ouverte') ||
      tNorm.includes('sortie de residence') ||
      tNorm.includes('sortie de résidence') ||
      tNorm.includes('residence') ||
      tNorm.includes('résidence') ||
      tNorm.includes('atelier') ||
      tNorm.includes('stage')
    ) {
      continue
    }

    const rep = {
      source: SOURCE,
      source_url: saisonUrl,
      date: it.date,
      heure: null,
      titre: it.titre,
      theatre_nom: THEATRE_NOM,
      theatre_adresse: THEATRE_ADRESSE,
      url: it.url,
      genre: null,
      style: null,
      ...(description ? { description } : {}),
      ...(image_url ? { image_url } : {}),
    }

    // Require explicit theatre signals
    const { ok } = shouldEmitTheatre(rep, { strict: true })
    if (!ok) continue

    rep.fingerprint = computeFingerprint(rep)
    reps.push(rep)
  }

  // De-dup on fingerprint
  const seen = new Set()
  const out = []
  for (const r of reps) {
    if (!r.fingerprint) continue
    if (seen.has(r.fingerprint)) continue
    seen.add(r.fingerprint)
    out.push(r)
  }

  return out
}

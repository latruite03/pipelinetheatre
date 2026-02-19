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

function decodeHtmlEntities(s) {
  let out = String(s || '')
  out = out
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#0*39;/g, "'")

  // numeric entities
  out = out.replace(/&#(\d+);/g, (_, n) => {
    const code = Number(n)
    if (!Number.isFinite(code)) return _
    try { return String.fromCharCode(code) } catch { return _ }
  })

  return out
}

function stripTags(html) {
  const txt = String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return decodeHtmlEntities(txt)
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

export async function loadTheatreDeLaVie({ limitMonths = 6 } = {}) {
  // New strategy (site is tricky): use the MONTH view, which exposes each occurrence with
  // day-of-month + time + category + link.
  // URLs: /?page=mois&mois=YYYY-MM-01

  function firstOfMonthUTC(d) {
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1))
  }

  function toMonthISO(d) {
    return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-01`
  }

  // Default: scan from current month forward (configurable via limitMonths)
  const start = firstOfMonthUTC(new Date())
  const months = []
  for (let i = 0; i < limitMonths; i++) {
    const d = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + i, 1))
    months.push(toMonthISO(d))
  }

  const excludedTitle = [
    'lundynamite',
    'scene de travers', 'scène de travers',
    'scene ouverte', 'scène ouverte',
    'sortie de residence', 'sortie de résidence',
    'atelier', 'stage',
    'queeriosity',
    'lecture',
  ]
  const excludedCats = ['concert','atelier','soiree','soirée','scene.ouverte','scène.ouverte','sortie','hors']

  function isExcluded(s) {
    const t = norm(s)
    return excludedTitle.some((k) => t.includes(norm(k)))
  }

  // Cache detail pages per URL (title/description/image)
  const showCache = new Map()

  async function getShowMeta(url) {
    if (showCache.has(url)) return showCache.get(url)
    try {
      const html = await fetchText(url)
      const text = stripTags(html)
      const image_url = extractOgImage(html)
      const meta = { description: text.slice(0, 1000), image_url, rawText: text }
      showCache.set(url, meta)
      return meta
    } catch {
      const meta = { description: null, image_url: null, rawText: '' }
      showCache.set(url, meta)
      return meta
    }
  }

  const reps = []

  for (const m0 of months) {
    const monthUrl = `${SOURCE}/?page=mois&mois=${m0}`
    const html = await fetchText(monthUrl)

    const [year, month] = m0.split('-')

    // Event blocks have ids like: pop1monday%02 / pop2wednesday%04 (day-of-month embedded)
    // They wrap an <a href="/agenda/.../"> ... "HH:MM — category — « title » ..."
    const re = /<a[^>]+href=["']([^"']*\/agenda\/[^"']+)["'][^>]*>\s*<div\s+id=["']pop\d+[a-z]+%([0-9]{2})["'][\s\S]*?<div\s+class=["'][^"']*pd8-text-component[^"']*["'][^>]*>([\s\S]*?)<\/div>/gi

    for (const mmatch of html.matchAll(re)) {
      const href = absUrl(mmatch[1])
      const day = mmatch[2]
      const inner = stripTags(mmatch[3])

      if (!href || !day) continue

      const date = `${year}-${month}-${day}`
      if (date < '2026-01-01' || date > '2026-06-30') continue

      // Parse time + category + title from the rendered text
      const timeMatch = inner.match(/\b(\d{1,2}:\d{2})\b/)
      const heure = timeMatch ? timeMatch[1] : null

      const catMatch = inner.match(/—\s*([^—]+?)\s*—/)
      const category = catMatch ? catMatch[1].trim() : null

      const titleMatch = inner.match(/«\s*([^»]+)\s*»/)
      const titre = titleMatch ? titleMatch[1].trim() : inner.split('—').pop()?.trim()?.slice(0, 120)

      if (!titre) continue
      if (isExcluded(titre)) continue
      if (category && excludedCats.some((c) => norm(category).includes(norm(c)))) continue

      // Detail page check to keep plays only
      const meta = await getShowMeta(href)

      // Use the popover text as primary description: it's closer to the actual show synopsis
      // and avoids pulling unrelated site chrome text that can confuse classification.
      const rep = {
        source: SOURCE,
        source_url: monthUrl,
        date,
        heure,
        titre,
        theatre_nom: THEATRE_NOM,
        theatre_adresse: THEATRE_ADRESSE,
        url: href,
        genre: null,
        style: null,
        is_theatre: true,
        description: inner,
        ...(meta.image_url ? { image_url: meta.image_url } : {}),
      }

      // Require explicit theatre signals in title/description (strict)
      // This venue often labels plays as “Création” without explicit theatre keywords.
      // Keep strict=false here, while upstream exclusions already remove workshops/stages/open-mics.
      const { ok } = shouldEmitTheatre(rep, { strict: false })
      if (!ok) continue

      rep.fingerprint = computeFingerprint(rep)
      reps.push(rep)
    }
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

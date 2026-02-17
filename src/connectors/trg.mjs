import fetch from 'node-fetch'
import { computeFingerprint, stripDiacritics } from '../lib/normalize.mjs'

const SOURCE = 'trg'
const BASE = 'https://www.trg.be'
const HOME = `${BASE}/`

const FETCH_OPTS = {
  headers: {
    'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36',
    'accept-language': 'fr-BE,fr;q=0.9,en;q=0.8,nl;q=0.7',
  },
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

function toAbsUrl(u) {
  if (!u) return null
  if (u.startsWith('http://') || u.startsWith('https://')) return u
  if (u.startsWith('/')) return `${BASE}${u}`
  return `${BASE}/${u}`
}

function inRange(date) {
  return date >= '2026-01-01' && date <= '2026-06-30'
}

function parseShowUrlsFromHome(html) {
  // On the home page there are season thumbnails with href="/secret-s" etc.
  const urls = []
  const re = /<a href="\/([a-z0-9\-]+)"[^>]*>\s*<img[^>]+BannerFixe_TRG_Saison_2025_2026/gi
  let m
  while ((m = re.exec(html))) {
    urls.push(`${BASE}/${m[1]}`)
  }

  // fallback: accept any internal links we already know (berlin-berlin etc.)
  if (urls.length === 0) {
    const re2 = /<a href="\/(berlin-berlin|glenn-naissance-dun-prodige|le-prenom|secret-s|lecume-des-jours|deux-mensonges-et-une-verite)"/gi
    while ((m = re2.exec(html))) urls.push(`${BASE}/${m[1]}`)
  }

  return Array.from(new Set(urls))
}

function parseBestImage(html, { slug = null, titre = null } = {}) {
  // TRG sometimes sets og:image to a banner (gif) or to an URL that serves a placeholder.
  // Prefer show-specific JPG/PNG/WEBP images found in-page.

  const imgs = [...html.matchAll(/<img[^>]+src="([^"]+)"/gi)]
    .map((m) => m[1])
    .filter(Boolean)
    .map((u) => (u.startsWith('http') ? u : `${BASE}${u}`))
    .filter((u) => u.includes('/web/image/') && !u.includes('/web/image/website/'))

  const decoded = (u) => {
    try {
      return decodeURIComponent(u)
    } catch {
      return u
    }
  }

  const isImage = (u) => /\.(jpe?g|png|webp)(\?|$)/i.test(u)
  const isBannerish = (u) => /Banner/i.test(u) || /favicon/i.test(u) || /\blogo\b/i.test(u) || /_logo_/i.test(u)

  const slugTokens = (slug || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t && t.length >= 3)

  const titleTokens = stripDiacritics((titre || '').toLowerCase())
    .split(/[^a-z0-9]+/)
    .filter((t) => t && t.length >= 4)

  const scoreUrl = (u) => {
    const d = stripDiacritics(decoded(u).toLowerCase())
    let score = 0

    for (const t of slugTokens) if (d.includes(t)) score += 3
    for (const t of titleTokens) if (d.includes(t)) score += 1

    if (isBannerish(u)) score -= 5
    return score
  }

  const candidates = imgs.filter((u) => isImage(u))

  // 1) best-scoring candidate (slug/title aware)
  if (candidates.length) {
    let best = null
    let bestScore = -1e9
    for (const u of candidates) {
      const s = scoreUrl(u)
      if (s > bestScore) {
        best = u
        bestScore = s
      }
    }
    // Trust the scored pick if it matches at least one meaningful token (title/slug)
    if (best && bestScore >= 1) return best
  }

  // 2) previous heuristics (but avoid picking site logos/banners)
  const best =
    imgs.find((u) => /secret\.s/i.test(decoded(u)) && isImage(u) && !isBannerish(u)) ||
    imgs.find((u) => /carre[_\-]?trg/i.test(decoded(u)) && isImage(u) && !isBannerish(u)) ||
    imgs.find((u) => isImage(u) && !isBannerish(u)) ||
    imgs.find((u) => isImage(u)) ||
    null

  if (best) return best

  // fallback to og:image (may be gif)
  const og = /<meta property="og:image" content="([^"]+)"/i.exec(html)
  return og ? toAbsUrl(og[1]) : null
}

function parseTitle(html) {
  const m = /<title>([\s\S]*?)<\/title>/i.exec(html)
  if (!m) return null
  return stripTags(m[1])
    .replace(/^Théâtre des Galeries\s*-\s*/i, '')
    .trim()
}

function parseDescription(html) {
  // Prefer the body text after "POUR EN SAVOIR PLUS".
  const idx = html.toLowerCase().indexOf('pour en savoir plus')
  if (idx === -1) return null
  const slice = html.slice(idx, idx + 12000)

  // Grab a couple of text fragments (often wrapped in <span class="h5-fs">)
  const bits = []

  const spanRe = /<span class="h5-fs">([\s\S]*?)<\/span>/gi
  let m
  while ((m = spanRe.exec(slice))) {
    const t = stripTags(m[1])
    if (!t) continue
    bits.push(t)
    if (bits.length >= 2) break
  }

  if (bits.length === 0) {
    const pRe = /<p[^>]*>([\s\S]*?)<\/p>/gi
    while ((m = pRe.exec(slice))) {
      const t = stripTags(m[1])
      if (!t) continue
      // avoid headings
      if (t.toLowerCase().includes('distribution')) break
      bits.push(t)
      if (bits.length >= 2) break
    }
  }

  if (bits.length === 0) return null
  const joined = bits.join(' ')
  return joined.length > 320 ? joined.slice(0, 317) + '…' : joined
}

function parseTicketUrl(html) {
  const byLabel = /href="([^"]+)"[^>]*>\s*R[eé]server[^<]*<\/a>/i.exec(html)
  if (byLabel) return decodeHtmlEntities(byLabel[1])

  const byUtick = /href="(https?:\/\/[^\"]*utick[^\"]+)"/i.exec(html)
  if (byUtick) return decodeHtmlEntities(byUtick[1])

  return null
}

function parseCalendar(html) {
  // Cards in sections data-name="Calendrier Dates":
  // <span style="font-size: 24px;">Mer 18.02.26</span>
  // ... <strong class="o_default_snippet_text">20H15</strong>
  const out = []

  const sectionParts = html.split('data-name="Calendrier Dates"')
  if (sectionParts.length <= 1) return out

  for (let i = 1; i < sectionParts.length; i++) {
    const chunk = sectionParts[i].slice(0, 20000)

    // iterate cards
    const cardRe = /<div class="s_card card[\s\S]*?<\/div>\s*<\/div>\s*<\/div>/gi
    let m
    while ((m = cardRe.exec(chunk))) {
      const cardHtml = m[0]

      const dateM = /<span[^>]*>([A-Za-zÀ-ÿ]{2,3})\s*<br\s*\/>\s*(\d{2})\.(\d{2})\.(\d{2})<\/span>|<span[^>]*>([A-Za-zÀ-ÿ]{2,3})\s*(\d{2})\.(\d{2})\.(\d{2})<\/span>/i.exec(cardHtml)
      if (!dateM) continue
      const dd = dateM[2] || dateM[6]
      const mm = dateM[3] || dateM[7]
      const yy = dateM[4] || dateM[8]
      const date = `20${yy}-${mm}-${dd}`

      // time may be in strong or plain text
      const timeM = /<strong class="o_default_snippet_text">\s*([0-9]{1,2})H([0-9]{2})\s*<\/strong>/i.exec(cardHtml)
      let heure = null
      if (timeM) {
        const hh = String(timeM[1]).padStart(2, '0')
        const mi = timeM[2]
        heure = `${hh}:${mi}:00`
      } else {
        const t2 = stripTags(cardHtml)
        // ignore scolaires
        if (/scolaire/i.test(t2)) continue
        const timeM2 = /\b(\d{1,2})H(\d{2})\b/i.exec(t2)
        if (timeM2) {
          const hh = String(timeM2[1]).padStart(2, '0')
          const mi = timeM2[2]
          heure = `${hh}:${mi}:00`
        }
      }

      const is_complet = /\bcomplet\b|sold out|epuise|épuis/i.test(cardHtml)

      out.push({ date, heure, is_complet })
    }
  }

  // uniq
  const seen = new Set()
  const res = []
  for (const dt of out) {
    const k = `${dt.date}|${dt.heure || ''}|${dt.is_complet ? '1' : '0'}`
    if (seen.has(k)) continue
    seen.add(k)
    res.push(dt)
  }

  return res
}

export async function loadTRG() {
  const homeHtml = await (await fetch(HOME, FETCH_OPTS)).text()
  const showUrls = parseShowUrlsFromHome(homeHtml)

  const theatre_nom = 'Théâtre Royal des Galeries'
  const theatre_adresse = "Galerie du Roi 32, 1000 Bruxelles"

  const reps = []

  for (const showUrl of showUrls) {
    const html = await (await fetch(showUrl, FETCH_OPTS)).text()

    const titre = parseTitle(html) || 'Spectacle'
    const slug = showUrl.split('/').filter(Boolean).slice(-1)[0] || null
    const image_url = parseBestImage(html, { slug, titre })
    const description = parseDescription(html)
    const ticket_url = parseTicketUrl(html)
    const dts = parseCalendar(html)

    for (const dt of dts) {
      if (!dt.date || !inRange(dt.date)) continue
      if (!dt.heure) continue // keep only timed performances for now

      const rep = {
        source: SOURCE,
        source_url: showUrl,
        date: dt.date,
        heure: dt.heure,
        titre,
        theatre_nom,
        theatre_adresse,
        url: showUrl,
        genre: null,
        style: null,
        ...(ticket_url ? { ticket_url } : {}),
        ...(dt.is_complet ? { is_complet: true } : {}),
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

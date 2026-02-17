import { computeFingerprint, stripDiacritics } from '../lib/normalize.mjs'
import { shouldEmitTheatre } from '../lib/classify.mjs'

const SOURCE = 'https://www.lavenerie.be'
const SOURCE_URL = 'https://www.lavenerie.be/programme/'
const THEATRE_NOM = 'La Vénerie'

const MEILI_URL = 'https://meilisearch.signelazer.net'
const MEILI_INDEX = 'lavenerie'
// Key is publicly exposed in the site's JS bundle (agenda.min.js)
const MEILI_API_KEY = '25bf1031c76ba5fd2dfc58301795c93f9eea0f44333cc5e25b58570a82a4ab7f'

function norm(s) {
  return stripDiacritics(String(s || '')).toLowerCase().trim()
}

function pick(obj) {
  if (!obj) return null
  if (typeof obj === 'string') return obj
  if (typeof obj.url === 'string') return obj.url
  if (typeof obj.raw === 'string') return obj.raw
  if (typeof obj.rich === 'string') return obj.rich
  return null
}

function cleanTitle(t) {
  return String(t || '')
    .replace(/\s+/g, ' ')
    .replace(/^\s+|\s+$/g, '')
    .replace(/^\d{2}-\d{2}\s+/g, '') // strip season prefix like "24-25"
    .trim()
}

async function meiliSearch({ limit = 200, offset = 0, filter = null } = {}) {
  const res = await fetch(`${MEILI_URL}/indexes/${MEILI_INDEX}/search`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${MEILI_API_KEY}`,
      'user-agent': 'Mozilla/5.0 (OpenClaw pipelinetheatre)'
    },
    body: JSON.stringify({ q: '', limit, offset, ...(filter ? { filter } : {}) }),
  })
  if (!res.ok) throw new Error(`Meilisearch HTTP ${res.status}`)
  return await res.json()
}

export async function loadLavenerie({
  minDate = '2026-02-15',
  maxDate = '2026-06-30',
  maxHits = 2000,
} = {}) {
  const reps = []

  // Exclusions for non-play items
  const excludeTitle = [
    'atelier', 'stage', 'concert', 'exposition', 'vernissage', 'conference', 'conférence',
    'rencontre', 'masterclass', 'workshop', 'bal', 'dj', 'projection', 'cinema', 'cinéma',
    'stand-up', 'stand up',
  ]

  let offset = 0
  const pageSize = 200

  while (offset < maxHits) {
    const page = await meiliSearch({ limit: pageSize, offset })
    const hits = page?.hits || []
    if (hits.length === 0) break

    for (const h of hits) {
      const titreRaw = cleanTitle(pick(h.title))
      const url = pick(h.permalink) || null
      const description = pick(h.first_textarea) || pick(h.resume) || null
      const image_url = pick(h.img) || pick(h.imgs) || null

      if (!titreRaw || !url) continue

      const tnorm = norm(titreRaw)
      if (excludeTitle.some((k) => tnorm.includes(norm(k)))) continue

      const dates = Array.isArray(h.dates) ? h.dates : []
      for (const d of dates) {
        const date = d?.date?.ISO
        if (!date || date < minDate || date > maxDate) continue

        const heure = d?.start_hour || null

        const loc = d?.location || h?.location || null
        const theatre_adresse = loc
          ? [loc.address, loc.zipcode, (loc.city || '').trim()].filter(Boolean).join(', ').replace(/\s+/g, ' ').trim() || null
          : null

        const rep = {
          source: SOURCE,
          source_url: SOURCE_URL,
          date,
          heure,
          titre: titreRaw,
          theatre_nom: THEATRE_NOM,
          theatre_adresse,
          url,
          genre: null,
          style: null,
          is_theatre: true,
          ...(description ? { description } : {}),
          ...(image_url ? { image_url } : {}),
        }

        // Plays-only policy:
        // Keep only items tagged "Théâtre" in disciplines.
        // (Meili index sometimes lacks a reliable "types" field.)
        const disc = (h.disciplines || []).map((x) => x?.name).filter(Boolean).join(' | ')
        const discNorm = norm(disc)
        const isTheatreTagged = discNorm.includes('theatre') || discNorm.includes('théâtre')
        if (!isTheatreTagged) continue

        // Secondary safety net (exclude obvious non-play keywords)
        const { ok } = shouldEmitTheatre(rep, { strict: false })
        if (!ok) continue

        rep.fingerprint = computeFingerprint(rep)
        reps.push(rep)
      }
    }

    if (hits.length < pageSize) break
    offset += pageSize
  }

  // de-dup by fingerprint
  const seen = new Set()
  const out = []
  for (const r of reps) {
    if (!r?.fingerprint) continue
    if (seen.has(r.fingerprint)) continue
    seen.add(r.fingerprint)
    out.push(r)
  }

  return out
}

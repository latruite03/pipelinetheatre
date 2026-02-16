import { computeFingerprint, stripDiacritics } from '../lib/normalize.mjs'

const SOURCE = 'https://www.senghor.be'
const SOURCE_URL = 'https://www.senghor.be/agenda/'
const THEATRE_NOM = 'Espace Senghor'
const THEATRE_ADRESSE_DEFAULT = '366 chaussée de Wavre, 1040 Bruxelles'

const MEILI_URL = 'https://meilisearch.signelazer.net'
const MEILI_INDEX = 'senghor'
const MEILI_API_KEY = '25bf1031c76ba5fd2dfc58301795c93f9eea0f44333cc5e25b58570a82a4ab7f'

function norm(s) {
  return stripDiacritics(String(s || '')).toLowerCase().trim()
}

function pick(obj) {
  if (!obj) return null
  if (typeof obj === 'string') return obj
  if (typeof obj.raw === 'string') return obj.raw
  if (typeof obj.rich === 'string') return obj.rich
  return null
}

function cleanText(s) {
  return String(s || '').replace(/\s+/g, ' ').trim()
}

async function meiliSearch({ q = '', limit = 200, offset = 0 } = {}) {
  const res = await fetch(`${MEILI_URL}/indexes/${MEILI_INDEX}/search`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${MEILI_API_KEY}`,
      'user-agent': 'Mozilla/5.0 (OpenClaw pipelinetheatre)'
    },
    body: JSON.stringify({ q, limit, offset }),
  })
  if (!res.ok) throw new Error(`Meilisearch HTTP ${res.status}`)
  return await res.json()
}

export async function loadSenghor({
  minDate = '2026-02-15',
  maxDate = '2026-06-30',
  maxHits = 2000,
} = {}) {
  const reps = []

  let offset = 0
  const pageSize = 200

  while (offset < maxHits) {
    const page = await meiliSearch({ q: '', limit: pageSize, offset })
    const hits = page?.hits || []
    if (hits.length === 0) break

    for (const h of hits) {
      const titre = cleanText(pick(h.title))
      const url = pick(h.permalink) || null
      const description = pick(h.first_textarea) || pick(h.resume) || null
      const image_url = pick(h.img) || null

      if (!titre || !url) continue

      const disc = (h.disciplines || []).map((x) => x?.name).filter(Boolean).join(' | ')
      const types = (h.types || []).map((x) => x?.name).filter(Boolean).join(' | ')
      const discNorm = norm(disc)
      const typesNorm = norm(types)

      // Plays-only: keep items tagged Théâtre + Représentation
      if (!(discNorm.includes('theatre') || discNorm.includes('théâtre'))) continue
      if (!(typesNorm.includes('representation') || typesNorm.includes('représentation'))) continue

      const dates = Array.isArray(h.dates) ? h.dates : []
      for (const d of dates) {
        const date = d?.date?.ISO
        if (!date || date < minDate || date > maxDate) continue

        const heure = d?.start_hour || null

        const loc = d?.location || h?.location || null
        const theatre_adresse = loc
          ? [loc.address, loc.zipcode, (loc.city || '').trim()].filter(Boolean).join(', ').replace(/\s+/g, ' ').trim() || THEATRE_ADRESSE_DEFAULT
          : THEATRE_ADRESSE_DEFAULT

        const rep = {
          source: SOURCE,
          source_url: SOURCE_URL,
          date,
          heure,
          titre,
          theatre_nom: THEATRE_NOM,
          theatre_adresse,
          url,
          genre: null,
          style: null,
          is_theatre: true,
          ...(description ? { description } : {}),
          ...(image_url ? { image_url } : {}),
        }

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

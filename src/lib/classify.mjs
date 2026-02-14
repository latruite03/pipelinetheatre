// Theatre vs non-theatre classifier
// Goal: keep venues (sources) but emit only theatre representations.
// This is intentionally heuristic (no ML) and can be tuned with keyword lists.

import { stripDiacritics } from './normalize.mjs'

function norm(s) {
  return stripDiacritics(String(s || '')).toLowerCase()
}

// Strong non-theatre signals (exclude)
const NEG = [
  // music
  'concert', 'live', 'dj', 'set', 'club', 'showcase', 'release party', 'album release', 'jam',
  'jazz', 'rock', 'pop', 'hip hop', 'hip-hop', 'electro',
  // visual arts
  'expo', 'exposition', 'vernissage',
  // cinema
  'projection', 'cinema', 'cinema', 'film',
  // talks/workshops
  'conference', 'conférence', 'rencontre', 'masterclass', 'workshop', 'atelier',
  // other performing arts (depends on your definition)
  'dance', 'danse',
]

// Strong theatre signals (include)
const POS = [
  'theatre', 'théâtre',
  'piece', 'pièce',
  'representation', 'représentation',
  'mise en scene', 'mise en scène',
  'spectacle',
  'comedie', 'comédie',
  'drame', 'tragedie', 'tragédie',
  'seul en scene', 'seul en scène',
]

// Some phrases are ambiguous, keep as slight negatives only
const SOFT_NEG = [
  'festival',
]

export function classifyTheatre(rep) {
  const title = norm(rep?.titre)
  const desc = norm(rep?.description)
  const url = norm(rep?.url)

  let score = 0
  const reasons = []

  for (const k of POS) {
    if (title.includes(norm(k))) { score += 3; reasons.push(`pos:title:${k}`) }
    if (desc.includes(norm(k))) { score += 1; reasons.push(`pos:desc:${k}`) }
  }

  for (const k of NEG) {
    const nk = norm(k)
    if (title.includes(nk)) { score -= 4; reasons.push(`neg:title:${k}`) }
    if (desc.includes(nk)) { score -= 2; reasons.push(`neg:desc:${k}`) }
    if (url.includes(nk)) { score -= 1; reasons.push(`neg:url:${k}`) }
  }

  for (const k of SOFT_NEG) {
    const nk = norm(k)
    if (title.includes(nk) || desc.includes(nk)) { score -= 1; reasons.push(`softneg:${k}`) }
  }

  // Heuristic: presence of typical theatre credits slightly increases score
  if (/\b(mise en scene|mise en scène|avec|interpretation|interprétation|texte de|d' apres|d’après)\b/.test(`${title} ${desc}`)) {
    score += 1
    reasons.push('pos:credits')
  }

  // Decide
  // score >= 2 => theatre
  // score <= -2 => non-theatre
  // otherwise unknown (default: non-theatre to reduce noise)
  const decision = score >= 2 ? 'theatre' : (score <= -2 ? 'non-theatre' : 'unknown')

  // Confidence: squashed score
  const conf = Math.max(0, Math.min(1, (score + 6) / 12))

  return {
    decision,
    score,
    confidence: conf,
    reasons: Array.from(new Set(reasons)).slice(0, 12),
  }
}

export function shouldEmitTheatre(rep, { strict = true } = {}) {
  const c = classifyTheatre(rep)
  if (c.decision === 'theatre') return { ok: true, classification: c }
  if (!strict && c.decision === 'unknown') return { ok: true, classification: c }
  return { ok: false, classification: c }
}

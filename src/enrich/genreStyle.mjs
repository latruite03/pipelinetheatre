import { getSupabaseAdmin } from '../lib/supabase.mjs'
import { stripDiacritics } from '../lib/normalize.mjs'

function norm(s) {
  return stripDiacritics(String(s || '')).toLowerCase()
}

const COMEDY_HINTS = [
  'comedie',
  'comédie',
  'humour',
  'drole',
  'drôle',
  'satire',
  'farce',
  'burlesque',
  'cabaret',
  'stand-up',
  'one man show',
  'seul en scene',
  'seule en scene',
]

const DRAMA_HINTS = [
  'drame',
  'tragique',
  'tragedie',
  'tragédie',
  'thriller',
  'noir',
  'guerre',
  'violence',
  'suicide',
  'meurtre',
  'deuil',
]

// A small pragmatic list: if mentioned, likely "classique" (canon)
const CLASSIQUE_AUTHORS = [
  'moliere',
  'shakespeare',
  'racine',
  'corneille',
  'tchekhov',
  'chekhov',
  'sophocle',
  'euripide',
  'eschyle',
  'molière',
  'goldoni',
  'ibsen',
  'strindberg',
  'dostoievski',
  'dostoievsky',
  'dostoevski',
  'ovide',
]

const CONTEMP_HINTS = [
  'creation',
  'création',
  'contemporain',
  'contemporaine',
  'aujourd',
  'performance',
  'documentaire',
  'autofiction',
  'slam',
]

function guessGenre(title, description) {
  const t = norm(title)
  const d = norm(description)
  const blob = `${t} ${d}`

  const hasComedy = COMEDY_HINTS.some((h) => blob.includes(norm(h)))
  const hasDrama = DRAMA_HINTS.some((h) => blob.includes(norm(h)))

  if (hasComedy && !hasDrama) return 'comedie'
  if (hasDrama && !hasComedy) return 'drame'
  if (hasComedy && hasDrama) return 'autre'

  // Default: we keep null to avoid tagging everything as "autre" too aggressively
  return null
}

function guessStyle(title, description) {
  const t = norm(title)
  const d = norm(description)
  const blob = `${t} ${d}`

  const isClassique = CLASSIQUE_AUTHORS.some((a) => blob.includes(norm(a)))
  if (isClassique) return 'classique'

  const isContemp = CONTEMP_HINTS.some((h) => blob.includes(norm(h)))
  if (isContemp) return 'contemporain'

  // If nothing obvious, prefer contemporain (most programming is contemporary).
  return 'contemporain'
}

export async function enrichGenreStyle({ dryRun = true, limit = null } = {}) {
  const supabase = getSupabaseAdmin()

  // We enrich per "piece" (source_url) then apply to all its representations.
  const { data: rows, error } = await supabase
    .from('representations')
    .select('source_url,titre,description,genre,style')

  if (error) throw new Error(error.message)

  const byShow = new Map()
  for (const r of rows || []) {
    const k = r.source_url || ''
    if (!k) continue
    if (!byShow.has(k)) {
      byShow.set(k, {
        source_url: k,
        titre: r.titre,
        description: r.description,
        hasGenre: r.genre != null,
        hasStyle: r.style != null,
      })
    } else {
      const cur = byShow.get(k)
      cur.hasGenre = cur.hasGenre || r.genre != null
      cur.hasStyle = cur.hasStyle || r.style != null
      // keep first non-empty title/description
      if (!cur.titre && r.titre) cur.titre = r.titre
      if (!cur.description && r.description) cur.description = r.description
    }
  }

  let shows = Array.from(byShow.values())
  // only those missing something
  shows = shows.filter((s) => !(s.hasGenre && s.hasStyle))
  if (limit) shows = shows.slice(0, limit)

  let willSetGenre = 0
  let willSetStyle = 0
  let updatedShows = 0

  for (const s of shows) {
    const genre = s.hasGenre ? null : guessGenre(s.titre, s.description)
    const style = s.hasStyle ? null : guessStyle(s.titre, s.description)

    const patch = {}
    if (!s.hasGenre && genre) patch.genre = genre
    if (!s.hasStyle && style) patch.style = style

    if (Object.keys(patch).length === 0) continue

    updatedShows++
    if (patch.genre) willSetGenre++
    if (patch.style) willSetStyle++

    if (dryRun) continue

    const q = supabase.from('representations').update(patch).eq('source_url', s.source_url)
    // only fill missing fields (don’t overwrite manual edits)
    if (patch.genre) q.is('genre', null)
    if (patch.style) q.is('style', null)

    const { error: e2 } = await q
    if (e2) throw new Error(e2.message)
  }

  return {
    dryRun,
    candidateShows: shows.length,
    updatedShows,
    willSetGenre,
    willSetStyle,
  }
}

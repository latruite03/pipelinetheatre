import crypto from 'node:crypto'

export function stripDiacritics(s) {
  return (s || '')
    .normalize('NFD')
    .replace(/\p{Diacritic}+/gu, '')
}

export function normKey(s) {
  return stripDiacritics(String(s || ''))
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '')
}

export function computeFingerprint({
  source,
  source_url,
  date,
  heure,
  theatre_nom,
  titre,
}) {
  const base = [
    source || '',
    source_url || '',
    date || '',
    heure || '',
    normKey(theatre_nom || ''),
    normKey(titre || ''),
  ].join('|')

  return crypto.createHash('sha1').update(base).digest('hex')
}

export function normalizeGenre(value) {
  if (!value) return null
  const v = stripDiacritics(String(value)).toLowerCase().trim()

  if (v === 'comedie' || v === 'drame' || v === 'autre') return v
  if (v.includes('com')) return 'comedie'
  if (v.includes('dram') || v.includes('trag')) return 'drame'
  if (v.includes('jeune public') || v.includes('experimental') || v.includes('inclassable')) return 'autre'
  return null
}

export function normalizeStyle(value) {
  if (!value) return null
  const v = stripDiacritics(String(value)).toLowerCase().trim()

  if (v === 'classique' || v === 'contemporain') return v
  if (v.includes('class')) return 'classique'
  if (v.includes('contemp') || v.includes('moderne') || v.includes('creation') || v.includes('création')) return 'contemporain'
  return null
}

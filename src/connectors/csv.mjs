import fs from 'node:fs/promises'
import { parse } from 'csv-parse/sync'
import { computeFingerprint, normalizeGenre, normalizeStyle } from '../lib/normalize.mjs'

// Generic CSV connector compatible with the app's admin import format.
// Expected headers: date, heure, titre, theatre_nom, theatre_adresse, url, genre, style, description

export async function loadFromCsv({
  filePath,
  source = 'import_csv',
}) {
  const csvText = await fs.readFile(filePath, 'utf8')
  const rows = parse(csvText, {
    columns: true,
    skip_empty_lines: true,
    relax_quotes: true,
    relax_column_count: true,
    trim: true,
  })

  const normalized = []
  for (const r of rows) {
    const rep = {
      source,
      source_url: r.url || null,
      date: r.date,
      heure: r.heure || null,
      titre: r.titre,
      theatre_nom: r.theatre_nom,
      theatre_adresse: r.theatre_adresse || null,
      url: r.url || null,
      genre: normalizeGenre(r.genre),
      style: normalizeStyle(r.style),
      description: r.description || null,
      ...(r.image_url ? { image_url: r.image_url } : {}),
    }

    rep.fingerprint = computeFingerprint(rep)
    normalized.push(rep)
  }

  return normalized
}

// Wolubilis (Woluwe-Saint-Lambert)
// Repérage connector (stub): added so the venue is tracked in the pipeline even if we haven’t
// implemented its agenda scraping yet.

export async function loadWolubilis() {
  console.log('Wolubilis: connector stub (agenda scraping not implemented yet). Returning 0 rows.')
  return []
}

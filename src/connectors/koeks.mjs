// Koek's Théâtre (Koekelberg)
// NOTE (2026-02-16): koeks.be currently resolves to a parked domain page in our environment,
// not the theatre website (no agenda data available to scrape). This connector is a stub
// so the venue is represented in the pipeline; it returns 0 rows.

export async function loadKoeks({} = {}) {
  console.log("Koek's Théâtre: koeks.be appears parked/unavailable; returning 0 rows")
  return []
}

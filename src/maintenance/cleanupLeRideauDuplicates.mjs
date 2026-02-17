import { getSupabaseAdmin } from '../lib/supabase.mjs'

// Remove functional duplicates for Le Rideau:
// same (date, heure, url, theatre_nom) but different fingerprints (often due to title encoding differences).

const supabase = getSupabaseAdmin()

const theatre_nom = 'Le Rideau'
const from = '2026-01-01'
const to = '2026-06-30'

function score(r) {
  const t = String(r?.titre || '')
  const d = String(r?.description || '')
  const img = r?.image_url ? 1 : 0
  // Prefer decoded titles (no &...;), richer description, has image
  return (
    img * 1000 +
    (t.includes('&') ? 0 : 50) +
    Math.min(200, d.length / 4) +
    Math.min(50, t.length)
  )
}

async function main() {
  // Load all Le Rideau rows in window
  const pageSize = 1000
  let fromIdx = 0
  const rows = []

  while (true) {
    const { data, error } = await supabase
      .from('representations')
      .select('id,date,heure,url,theatre_nom,titre,description,image_url,fingerprint,created_at')
      .eq('theatre_nom', theatre_nom)
      .gte('date', from)
      .lte('date', to)
      .range(fromIdx, fromIdx + pageSize - 1)

    if (error) throw new Error(error.message)
    if (!data || data.length === 0) break
    rows.push(...data)
    if (data.length < pageSize) break
    fromIdx += pageSize
  }

  const groups = new Map()
  for (const r of rows) {
    const key = `${r.date}|${r.heure || ''}|${r.url || ''}|${r.theatre_nom}`
    const arr = groups.get(key) || []
    arr.push(r)
    groups.set(key, arr)
  }

  const toDelete = []
  const dupGroups = []

  for (const [key, arr] of groups.entries()) {
    if (arr.length <= 1) continue
    arr.sort((a, b) => score(b) - score(a))
    const keep = arr[0]
    const del = arr.slice(1)
    toDelete.push(...del.map((x) => x.id))
    dupGroups.push({ key, keepId: keep.id, deleteIds: del.map((x) => x.id), titles: arr.map((x) => x.titre) })
  }

  if (toDelete.length === 0) {
    console.log('No functional duplicates found for Le Rideau.')
    return
  }

  // Delete in chunks
  let deleted = 0
  for (let i = 0; i < toDelete.length; i += 200) {
    const chunk = toDelete.slice(i, i + 200)
    const { error } = await supabase.from('representations').delete().in('id', chunk)
    if (error) throw new Error(error.message)
    deleted += chunk.length
  }

  console.log(JSON.stringify({ dupGroups: dupGroups.length, deleted }, null, 2))
}

main().catch((e) => {
  console.error(e?.stack || String(e))
  process.exit(1)
})

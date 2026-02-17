import { getSupabaseAdmin } from '../lib/supabase.mjs'

// Remove functional duplicates for Théâtre de Poche:
// same (date, heure, theatre_nom, titre) but different fingerprints/urls.

const supabase = getSupabaseAdmin()

const theatre_nom = 'Théâtre de Poche'
const from = '2026-01-01'
const to = '2026-06-30'

function score(r) {
  const url = String(r?.url || '')
  const img = r?.image_url ? 1 : 0
  const descLen = String(r?.description || '').length
  const title = String(r?.titre || '')

  return (
    (url.includes('module=QUANTITY') ? 500 : 0) +
    (url.includes('ACTIVITYSERIEDETAILS') ? 200 : 0) +
    img * 100 +
    Math.min(200, descLen / 5) +
    Math.min(50, title.length)
  )
}

async function main() {
  const pageSize = 1000
  let fromIdx = 0
  const rows = []

  while (true) {
    const { data, error } = await supabase
      .from('representations')
      .select('id,date,heure,titre,url,description,image_url')
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
    const key = `${r.date}|${r.heure || ''}|${r.theatre_nom}|${r.titre}`
    const arr = groups.get(key) || []
    arr.push(r)
    groups.set(key, arr)
  }

  const toDelete = []
  let dupGroups = 0

  for (const arr of groups.values()) {
    if (arr.length <= 1) continue
    dupGroups += 1
    arr.sort((a, b) => score(b) - score(a))
    toDelete.push(...arr.slice(1).map((x) => x.id))
  }

  if (toDelete.length === 0) {
    console.log('No functional duplicates found for Théâtre de Poche.')
    return
  }

  let deleted = 0
  for (let i = 0; i < toDelete.length; i += 200) {
    const chunk = toDelete.slice(i, i + 200)
    const { error } = await supabase.from('representations').delete().in('id', chunk)
    if (error) throw new Error(error.message)
    deleted += chunk.length
  }

  console.log(JSON.stringify({ dupGroups, deleted }, null, 2))
}

main().catch((e) => {
  console.error(e?.stack || String(e))
  process.exit(1)
})

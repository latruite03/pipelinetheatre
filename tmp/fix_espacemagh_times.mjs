import { createClient } from '@supabase/supabase-js'
import { loadEspaceMagh } from '../src/connectors/espacemagh.mjs'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

async function main() {
  const reps = await loadEspaceMagh()
  const keepFingerprints = new Set(reps.map((r) => r.fingerprint))

  const { error: upsertError } = await supabase
    .from('representations')
    .upsert(reps, { onConflict: 'fingerprint' })

  if (upsertError) throw new Error(upsertError.message)

  const { data: existing, error: fetchError } = await supabase
    .from('representations')
    .select('id,fingerprint,date')
    .eq('source', 'espacemagh')
    .gte('date', '2026-01-01')
    .lte('date', '2026-06-30')

  if (fetchError) throw new Error(fetchError.message)

  const toDelete = (existing || [])
    .filter((r) => !keepFingerprints.has(r.fingerprint))
    .map((r) => r.id)

  if (toDelete.length > 0) {
    const { error: delError } = await supabase
      .from('representations')
      .delete()
      .in('id', toDelete)

    if (delError) throw new Error(delError.message)
  }

  console.log({ upserted: reps.length, deleted: toDelete.length })
}

main().catch((e) => {
  console.error(e?.stack || String(e))
  process.exit(1)
})

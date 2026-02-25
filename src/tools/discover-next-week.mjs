import { getSupabaseAdmin } from '../lib/supabase.mjs'

import { loadMercelisIxelles } from '../connectors/mercelis_ixelles.mjs'
import { loadRichesClaires } from '../connectors/richesclaires.mjs'
import { loadPoche } from '../connectors/poche.mjs'
import { loadTanneurs } from '../connectors/tanneurs.mjs'
import { loadLeRideau } from '../connectors/lerideau.mjs'
import { loadVaria } from '../connectors/varia.mjs'
import { loadOceanNord } from '../connectors/oceannord.mjs'
import { loadBalsamine } from '../connectors/balsamine.mjs'
import { loadLe140 } from '../connectors/le140.mjs'
import { loadMarni } from '../connectors/marni.mjs'

function startOfDay(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}
function addDays(d, n) {
  const x = new Date(d)
  x.setDate(x.getDate() + n)
  return x
}
function nextMonday(d) {
  const day = d.getDay() // 0..6
  let delta = (8 - day) % 7
  if (delta === 0) delta = 7
  return startOfDay(addDays(d, delta))
}
function toDateString(d) {
  return d.toISOString().slice(0, 10)
}

function inRange(r, startStr, endStr) {
  return r?.date && r.date >= startStr && r.date <= endStr
}

const today = startOfDay(new Date())
const start = nextMonday(today)
const end = addDays(start, 6)
const startStr = toDateString(start)
const endStr = toDateString(end)

console.log('Discovering next-week candidates:', startStr, '→', endStr)

const supabase = getSupabaseAdmin()

// Pull existing fingerprints for that week
const { data: existingRows, error: existingErr } = await supabase
  .from('representations')
  .select('fingerprint')
  .gte('date', startStr)
  .lte('date', endStr)
  .limit(5000)

if (existingErr) {
  console.error('ERROR loading existing fingerprints:', existingErr)
  process.exit(1)
}

const existing = new Set((existingRows || []).map((r) => r.fingerprint).filter(Boolean))
console.log('Existing fingerprints in DB for week:', existing.size)

const sources = [
  { key: 'mercelis', fn: () => loadMercelisIxelles() },
  { key: 'richesclaires', fn: () => loadRichesClaires() },
  { key: 'poche', fn: () => loadPoche() },
  { key: 'tanneurs', fn: () => loadTanneurs() },
  { key: 'lerideau', fn: () => loadLeRideau() },
  { key: 'varia', fn: () => loadVaria() },
  { key: 'oceannord', fn: () => loadOceanNord() },
  { key: 'balsamine', fn: () => loadBalsamine({ limitPosts: 12 }) },
  { key: 'le140', fn: () => loadLe140() },
  { key: 'marni', fn: () => loadMarni() },
]

let all = []
for (const s of sources) {
  try {
    const reps = await s.fn()
    const filtered = (reps || [])
      .filter((r) => r && r.is_theatre !== false)
      .filter((r) => inRange(r, startStr, endStr))

    console.log('Loaded', filtered.length, 'rows for', s.key)
    all = all.concat(filtered)
  } catch (e) {
    console.log('WARN source failed:', s.key, '-', e?.message || e)
  }
}

// Dedupe candidates by fingerprint
const byFp = new Map()
for (const r of all) {
  if (!r?.fingerprint) continue
  if (!byFp.has(r.fingerprint)) byFp.set(r.fingerprint, r)
}
const candidates = Array.from(byFp.values())

const missing = candidates.filter((r) => r?.fingerprint && !existing.has(r.fingerprint))

console.log('Candidates (unique):', candidates.length)
console.log('Missing vs DB:', missing.length)

for (const r of missing.slice(0, 50)) {
  console.log('-', r.date, r.heure || '', '|', r.theatre_nom, '|', r.titre)
  if (r.url) console.log('  ', r.url)
}

// Emit JSON for later use
if (process.env.OUT_JSON === '1') {
  console.log('\nJSON_START')
  console.log(JSON.stringify({ startStr, endStr, missing }, null, 2))
  console.log('JSON_END')
}

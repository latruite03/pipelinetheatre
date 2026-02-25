import { getSupabaseAdmin } from '../lib/supabase.mjs'

// Broad discovery run: load MANY connectors, keep only theatre (is_theatre !== false)
// and next-week range (Mon->Sun), then compare fingerprints against Supabase.

import { loadTheatreDuParc } from '../connectors/theatreduparc.mjs'
import { loadBalsamine } from '../connectors/balsamine.mjs'
import { loadRichesClaires } from '../connectors/richesclaires.mjs'
import { loadMercelisIxelles } from '../connectors/mercelis_ixelles.mjs'
import { loadTheatreNational } from '../connectors/theatrenational.mjs'
import { loadKVS } from '../connectors/kvs.mjs'
import { loadTRG } from '../connectors/trg.mjs'
import { loadMartyrs } from '../connectors/martyrs.mjs'
import { loadToone } from '../connectors/toone.mjs'
import { loadPoche } from '../connectors/poche.mjs'
import { loadTanneurs } from '../connectors/tanneurs.mjs'
import { loadMontagneMagique } from '../connectors/montagnemagique.mjs'
import { loadBRONKS } from '../connectors/bronks.mjs'
import { loadLeRideau } from '../connectors/lerideau.mjs'
import { loadVaria } from '../connectors/varia.mjs'
import { loadBRASS } from '../connectors/brass.mjs'
import { loadOceanNord } from '../connectors/oceannord.mjs'
import { loadToisonDor } from '../connectors/toisondor.mjs'
import { loadKaaitheater } from '../connectors/kaaitheater.mjs'
import { loadWHalll } from '../connectors/whalll.mjs'
import { loadLePublic } from '../connectors/lepublic.mjs'
import { loadWolubilis } from '../connectors/wolubilis.mjs'
import { loadSenghor } from '../connectors/senghor.mjs'
import { loadLavenerie } from '../connectors/lavenerie.mjs'
import { loadBeursschouwburg } from '../connectors/beursschouwburg.mjs'
import { loadHallesDeSchaerbeek } from '../connectors/halles.mjs'
import { loadJacquesFranck } from '../connectors/jacquesfranck.mjs'
import { loadMaisonPoeme } from '../connectors/maisonpoeme.mjs'
import { loadTourAPlomb } from '../connectors/touraplomb.mjs'
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

console.log('Discovering next-week candidates (LARGE):', startStr, '→', endStr)

const supabase = getSupabaseAdmin()

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
  { key: 'theatreduparc', fn: () => loadTheatreDuParc({ limitEvents: 40 }) },
  { key: 'theatrenational', fn: () => loadTheatreNational() },
  { key: 'kvs', fn: () => loadKVS() },
  { key: 'trg', fn: () => loadTRG() },
  { key: 'martyrs', fn: () => loadMartyrs() },
  { key: 'toone', fn: () => loadToone() },
  { key: 'poche', fn: () => loadPoche() },
  { key: 'tanneurs', fn: () => loadTanneurs() },
  { key: 'lerideau', fn: () => loadLeRideau() },
  { key: 'varia', fn: () => loadVaria() },
  { key: 'oceannord', fn: () => loadOceanNord() },
  { key: 'balsamine', fn: () => loadBalsamine({ limitPosts: 20 }) },
  { key: 'richesclaires', fn: () => loadRichesClaires() },
  { key: 'mercelis', fn: () => loadMercelisIxelles() },
  { key: 'marni', fn: () => loadMarni() },
  { key: 'le140', fn: () => loadLe140() },
  { key: 'montagnemagique', fn: () => loadMontagneMagique() },
  { key: 'bronks', fn: () => loadBRONKS() },
  { key: 'brass', fn: () => loadBRASS() },
  { key: 'toisondor', fn: () => loadToisonDor() },
  { key: 'kaaitheater', fn: () => loadKaaitheater() },
  { key: 'whalll', fn: () => loadWHalll() },
  { key: 'lepublic', fn: () => loadLePublic() },
  { key: 'wolubilis', fn: () => loadWolubilis() },
  { key: 'senghor', fn: () => loadSenghor() },
  { key: 'lavenerie', fn: () => loadLavenerie() },
  { key: 'beursschouwburg', fn: () => loadBeursschouwburg() },
  { key: 'halles', fn: () => loadHallesDeSchaerbeek() },
  { key: 'jacquesfranck', fn: () => loadJacquesFranck() },
  { key: 'maisonpoeme', fn: () => loadMaisonPoeme() },
  { key: 'touraplomb', fn: () => loadTourAPlomb() },
]

let all = []
let totalLoaded = 0
for (const s of sources) {
  try {
    const reps = await s.fn()
    const filtered = (reps || [])
      .filter((r) => r && r.is_theatre !== false)
      .filter((r) => inRange(r, startStr, endStr))

    console.log('Loaded', filtered.length, 'rows for', s.key)
    totalLoaded += filtered.length
    all = all.concat(filtered)
  } catch (e) {
    console.log('WARN source failed:', s.key, '-', e?.message || e)
  }
}

const byFp = new Map()
for (const r of all) {
  if (!r?.fingerprint) continue
  if (!byFp.has(r.fingerprint)) byFp.set(r.fingerprint, r)
}
const candidates = Array.from(byFp.values())
const missing = candidates.filter((r) => r?.fingerprint && !existing.has(r.fingerprint))

console.log('Total loaded rows (post-filter):', totalLoaded)
console.log('Candidates (unique fingerprints):', candidates.length)
console.log('Missing vs DB:', missing.length)

for (const r of missing.slice(0, 80)) {
  console.log('-', r.date, r.heure || '', '|', r.theatre_nom, '|', r.titre)
  if (r.url) console.log('  ', r.url)
}

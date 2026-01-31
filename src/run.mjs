#!/usr/bin/env node
import 'dotenv/config'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { loadFromCsv } from './connectors/csv.mjs'
import { loadTheatreDuParc } from './connectors/theatreduparc.mjs'
import { loadBalsamine } from './connectors/balsamine.mjs'
import { loadEspaceMagh } from './connectors/espacemagh.mjs'
import { loadRichesClaires } from './connectors/richesclaires.mjs'
import { loadMercelisIxelles } from './connectors/mercelis_ixelles.mjs'
import { loadCreaNova } from './connectors/creanova.mjs'
import { loadAuditoriumJacquesBrel } from './connectors/auditoriumjbrel.mjs'
import { enrichTheatreDuParc } from './enrich/theatreduparc.mjs'
import { upsertRepresentations } from './publish/upsertRepresentations.mjs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

function usage() {
  console.log(`pipelinetheatre

Usage:
  node src/run.mjs csv <path-to-csv>
  node src/run.mjs theatreduparc
  node src/run.mjs balsamine
  node src/run.mjs espacemagh
  node src/run.mjs richesclaires
  node src/run.mjs mercelis
  node src/run.mjs creanova
  node src/run.mjs auditoriumjbrel
  node src/run.mjs enrich theatreduparc

Env:
  SUPABASE_URL
  SUPABASE_SERVICE_ROLE_KEY
`)
}

async function main() {
  const [mode, arg] = process.argv.slice(2)
  if (!mode || mode === '--help' || mode === '-h') return usage()

  if (mode === 'csv') {
    if (!arg) {
      console.error('Missing CSV path')
      process.exit(1)
    }
    const filePath = path.resolve(process.cwd(), arg)
    const reps = await loadFromCsv({ filePath })
    console.log(`Loaded ${reps.length} rows from CSV`)

    const res = await upsertRepresentations(reps)
    console.log(res)
    return
  }

  if (mode === 'theatreduparc') {
    const reps = await loadTheatreDuParc({ limitEvents: 20 })
    console.log(`Loaded ${reps.length} rows from Théâtre du Parc`)

    const res = await upsertRepresentations(reps)
    console.log(res)
    return
  }

  if (mode === 'balsamine') {
    const reps = await loadBalsamine({ limitPosts: 12 })
    console.log(`Loaded ${reps.length} rows from la Balsamine`)

    const res = await upsertRepresentations(reps)
    console.log(res)
    return
  }

  if (mode === 'espacemagh') {
    const reps = await loadEspaceMagh()
    console.log(`Loaded ${reps.length} rows from Espace Magh`)

    const res = await upsertRepresentations(reps)
    console.log(res)
    return
  }

  if (mode === 'richesclaires') {
    const reps = await loadRichesClaires()
    console.log(`Loaded ${reps.length} rows from Les Riches-Claires (theatre only)`)

    const res = await upsertRepresentations(reps)
    console.log(res)
    return
  }

  if (mode === 'mercelis') {
    const reps = await loadMercelisIxelles()
    console.log(`Loaded ${reps.length} rows from Théâtre Mercelis (Ixelles)`)

    const res = await upsertRepresentations(reps)
    console.log(res)
    return
  }

  if (mode === 'creanova') {
    const reps = await loadCreaNova()
    console.log(`Loaded ${reps.length} rows from Théâtre CreaNova (Strategy A)`)

    const res = await upsertRepresentations(reps)
    console.log(res)
    return
  }

  if (mode === 'auditoriumjbrel') {
    const reps = await loadAuditoriumJacquesBrel()
    console.log(`Loaded ${reps.length} rows from Auditorium Jacques Brel (theatre only)`)

    const res = await upsertRepresentations(reps)
    console.log(res)
    return
  }

  if (mode === 'enrich') {
    const target = arg
    if (target === 'theatreduparc') {
      const dryRun = process.env.DO_IT !== '1'
      const res = await enrichTheatreDuParc({ dryRun, maxChars: 300 })
      console.log(res)
      return
    }

    console.error(`Unknown enrich target: ${target}`)
    process.exit(1)
  }

  console.error(`Unknown mode: ${mode}`)
  usage()
  process.exit(1)
}

main().catch((e) => {
  console.error(e?.stack || String(e))
  process.exit(1)
})

#!/usr/bin/env node
import 'dotenv/config'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { loadFromCsv } from './connectors/csv.mjs'
import { upsertRepresentations } from './publish/upsertRepresentations.mjs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

function usage() {
  console.log(`pipelinetheatre

Usage:
  node src/run.mjs csv <path-to-csv>

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

  console.error(`Unknown mode: ${mode}`)
  usage()
  process.exit(1)
}

main().catch((e) => {
  console.error(e?.stack || String(e))
  process.exit(1)
})

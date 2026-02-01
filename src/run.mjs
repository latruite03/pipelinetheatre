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
import { loadZinnema } from './connectors/zinnema.mjs'
import { loadCCAuderghem } from './connectors/ccauderghem.mjs'
import { loadArchipel19 } from './connectors/archipel19.mjs'
import { loadTheatreNational } from './connectors/theatrenational.mjs'
import { loadKVS } from './connectors/kvs.mjs'
import { loadTRG } from './connectors/trg.mjs'
import { loadMartyrs } from './connectors/martyrs.mjs'
import { loadToone } from './connectors/toone.mjs'
import { loadPoche } from './connectors/poche.mjs'
import { loadTanneurs } from './connectors/tanneurs.mjs'
import { loadCirqueRoyal } from './connectors/cirqueroyal.mjs'
import { loadMontagneMagique } from './connectors/montagnemagique.mjs'
import { loadMarni } from './connectors/marni.mjs'
import { loadAtelier210 } from './connectors/atelier210.mjs'
import { loadBRONKS } from './connectors/bronks.mjs'
import { loadLeRideau } from './connectors/lerideau.mjs'
import { loadVaria } from './connectors/varia.mjs'
import { loadBRASS } from './connectors/brass.mjs'
import { loadOceanNord } from './connectors/oceannord.mjs'
import { loadToisonDor } from './connectors/toisondor.mjs'
import { loadKaaitheater } from './connectors/kaaitheater.mjs'
import { loadNovum } from './connectors/novum.mjs'
import { loadLePublic } from './connectors/lepublic.mjs'
import { loadLe140 } from './connectors/le140.mjs'
import { loadImproviste } from './connectors/improviste.mjs'
import { enrichTheatreDuParc } from './enrich/theatreduparc.mjs'
import { enrichGenreStyle } from './enrich/genreStyle.mjs'
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
  node src/run.mjs zinnema
  node src/run.mjs ccauderghem
  node src/run.mjs archipel19
  node src/run.mjs theatrenational
  node src/run.mjs kvs
  node src/run.mjs trg
  node src/run.mjs martyrs
  node src/run.mjs toone
  node src/run.mjs poche
  node src/run.mjs tanneurs
  node src/run.mjs cirqueroyal
  node src/run.mjs montagnemagique
  node src/run.mjs marni
  node src/run.mjs atelier210
  node src/run.mjs bronks
  node src/run.mjs lerideau
  node src/run.mjs varia
  node src/run.mjs oceannord
  node src/run.mjs toisondor
  node src/run.mjs brass
  node src/run.mjs kaaitheater
  node src/run.mjs novum
  node src/run.mjs lepublic
  node src/run.mjs le140
  node src/run.mjs improviste
  node src/run.mjs enrich theatreduparc
  node src/run.mjs enrich genrestyle

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

  if (mode === 'zinnema') {
    const reps = await loadZinnema()
    console.log(`Loaded ${reps.length} rows from Zinnema (theatre only)`)

    const res = await upsertRepresentations(reps)
    console.log(res)
    return
  }

  if (mode === 'ccauderghem') {
    const reps = await loadCCAuderghem()
    console.log(`Loaded ${reps.length} rows from Centre culturel d’Auderghem (CCA) (theatre only)`)

    const res = await upsertRepresentations(reps)
    console.log(res)
    return
  }

  if (mode === 'archipel19') {
    const reps = await loadArchipel19()
    console.log(`Loaded ${reps.length} rows from Archipel 19 – Le Fourquet (Spectacles category)`)

    const res = await upsertRepresentations(reps)
    console.log(res)
    return
  }

  if (mode === 'theatrenational') {
    const reps = await loadTheatreNational()
    console.log(`Loaded ${reps.length} rows from Théâtre National Wallonie-Bruxelles (theatre only)`)

    const res = await upsertRepresentations(reps)
    console.log(res)
    return
  }

  if (mode === 'kvs') {
    const reps = await loadKVS()
    console.log(`Loaded ${reps.length} rows from KVS (theatre only)`)

    const res = await upsertRepresentations(reps)
    console.log(res)
    return
  }

  if (mode === 'trg') {
    const reps = await loadTRG()
    console.log(`Loaded ${reps.length} rows from Théâtre Royal des Galeries`)

    const res = await upsertRepresentations(reps)
    console.log(res)
    return
  }

  if (mode === 'martyrs') {
    const reps = await loadMartyrs()
    console.log(`Loaded ${reps.length} rows from Théâtre des Martyrs`)

    const res = await upsertRepresentations(reps)
    console.log(res)
    return
  }

  if (mode === 'toone') {
    const reps = await loadToone()
    console.log(`Loaded ${reps.length} rows from Théâtre Royal de Toone`)

    const res = await upsertRepresentations(reps)
    console.log(res)
    return
  }

  if (mode === 'poche') {
    const reps = await loadPoche()
    console.log(`Loaded ${reps.length} rows from Théâtre de Poche Bruxelles`)

    const res = await upsertRepresentations(reps)
    console.log(res)
    return
  }

  if (mode === 'tanneurs') {
    const reps = await loadTanneurs()
    console.log(`Loaded ${reps.length} rows from Théâtre Les Tanneurs`)

    const res = await upsertRepresentations(reps)
    console.log(res)
    return
  }

  if (mode === 'cirqueroyal') {
    const reps = await loadCirqueRoyal()
    console.log(`Loaded ${reps.length} rows from Cirque Royal (theatre only, <=${'2026-06-30'})`)

    const res = await upsertRepresentations(reps)
    console.log(res)
    return
  }

  if (mode === 'montagnemagique') {
    const reps = await loadMontagneMagique()
    console.log(`Loaded ${reps.length} rows from Théâtre La montagne magique (OUT.be venue agenda)`)

    const res = await upsertRepresentations(reps)
    console.log(res)
    return
  }

  if (mode === 'marni') {
    const reps = await loadMarni()
    console.log(`Loaded ${reps.length} rows from Théâtre Marni (OUT.be venue agenda, theatre-only)`)

    const res = await upsertRepresentations(reps)
    console.log(res)
    return
  }

  if (mode === 'atelier210') {
    const reps = await loadAtelier210()
    console.log(`Loaded ${reps.length} rows from Atelier 210`)

    const res = await upsertRepresentations(reps)
    console.log(res)
    return
  }

  if (mode === 'bronks') {
    const reps = await loadBRONKS()
    console.log(`Loaded ${reps.length} rows from BRONKS`)

    const res = await upsertRepresentations(reps)
    console.log(res)
    return
  }

  if (mode === 'lerideau') {
    const reps = await loadLeRideau()
    console.log(`Loaded ${reps.length} rows from Le Rideau`)

    const res = await upsertRepresentations(reps)
    console.log(res)
    return
  }

  if (mode === 'varia') {
    const reps = await loadVaria()
    console.log(`Loaded ${reps.length} rows from Théâtre Varia`)

    const res = await upsertRepresentations(reps)
    console.log(res)
    return
  }

  if (mode === 'oceannord') {
    const reps = await loadOceanNord()
    console.log(`Loaded ${reps.length} rows from Théâtre Océan Nord`)

    const res = await upsertRepresentations(reps)
    console.log(res)
    return
  }

  if (mode === 'toisondor') {
    const reps = await loadToisonDor()
    console.log(`Loaded ${reps.length} rows from Théâtre de la Toison d'Or`)

    const res = await upsertRepresentations(reps)
    console.log(res)
    return
  }

  if (mode === 'brass') {
    const reps = await loadBRASS()
    console.log(`Loaded ${reps.length} rows from BRASS (theatre only, <=2026-06-30)`)

    const res = await upsertRepresentations(reps)
    console.log(res)
    return
  }

  if (mode === 'kaaitheater') {
    const reps = await loadKaaitheater()
    console.log(`Loaded ${reps.length} rows from Kaaitheater (Kaaitheater venues only, 2026-01-01 to 2026-06-30)`)

    const res = await upsertRepresentations(reps)
    console.log(res)
    return
  }

  if (mode === 'novum') {
    const reps = await loadNovum()
    console.log(`Loaded ${reps.length} rows from Théâtre Saint-Michel (NOVUM)`)

    const res = await upsertRepresentations(reps)
    console.log(res)
    return
  }

  if (mode === 'lepublic') {
    const reps = await loadLePublic()
    console.log(`Loaded ${reps.length} rows from Théâtre Le Public (2026-01-01 to 2026-06-30)`)

    const res = await upsertRepresentations(reps)
    console.log(res)
    return
  }

  if (mode === 'le140') {
    const reps = await loadLe140({ limitShows: 30 })
    console.log(`Loaded ${reps.length} rows from Théâtre 140 (2026-01-01 to 2026-06-30)`)

    const res = await upsertRepresentations(reps)
    console.log(res)
    return
  }

  if (mode === 'improviste') {
    const reps = await loadImproviste()
    console.log(`Loaded ${reps.length} rows from Théâtre l'Improviste (2026-01-01 to 2026-06-30)`)

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

    if (target === 'genrestyle') {
      const dryRun = process.env.DO_IT !== '1'
      const limit = process.env.LIMIT ? Number(process.env.LIMIT) : null
      const res = await enrichGenreStyle({ dryRun, limit })
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

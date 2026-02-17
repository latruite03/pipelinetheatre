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
import { loadBizou } from './connectors/bizou.mjs'
import { loadEscaleDuNord } from './connectors/escaledunord.mjs'
import { loadEntrela } from './connectors/entrela.mjs'
import { loadDeACoudre } from './connectors/deacoudre.mjs'
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
import { loadWHalll } from './connectors/whalll.mjs'
import { loadNovum } from './connectors/novum.mjs'
import { loadLePublic } from './connectors/lepublic.mjs'
import { loadCCUccle } from './connectors/uccle.mjs'
import { loadWolubilis } from './connectors/wolubilis.mjs'
import { loadKriekelaar } from './connectors/kriekelaar.mjs'
import { loadOsAMoelle } from './connectors/osamoelle.mjs'
import { loadCoteVillage } from './connectors/cotevillage.mjs'
import { loadJoliBois } from './connectors/jolibois.mjs'
import { loadClarenciere } from './connectors/clarenciere.mjs'
import { loadTourAPlomb } from './connectors/touraplomb.mjs'
import { loadMaisonDeLaCreation } from './connectors/maisondelacreation.mjs'
import { loadMaisonDeLaCreationGare } from './connectors/maisondelacreation_gare.mjs'
import { loadVauxHallSummer } from './connectors/vauxhallsummer.mjs'
import { loadLe140 } from './connectors/le140.mjs'
import { loadJacquesFranck } from './connectors/jacquesfranck.mjs'
import { loadMaisonPoeme } from './connectors/maisonpoeme.mjs'
import { loadKoeks } from './connectors/koeks.mjs'
import { loadImproviste } from './connectors/improviste.mjs'
import { loadBeursschouwburg } from './connectors/beursschouwburg.mjs'
import { loadHallesDeSchaerbeek } from './connectors/halles.mjs'
import { loadVolter } from './connectors/volter.mjs'
import { loadTheatreDeLaVie } from './connectors/theatredelavie.mjs'
import { loadLavenerie } from './connectors/lavenerie.mjs'
import { loadSenghor } from './connectors/senghor.mjs'
import { loadJardinDeMaSoeur } from './connectors/jardindemasoer.mjs'
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
  node src/run.mjs bizou
  node src/run.mjs escaledunord
  node src/run.mjs entrela
  node src/run.mjs deacoudre
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
  node src/run.mjs whalll
  node src/run.mjs novum
  node src/run.mjs lepublic
  node src/run.mjs uccle
  node src/run.mjs wolubilis
  node src/run.mjs kriekelaar
  node src/run.mjs osamoelle
  node src/run.mjs cotevillage
  node src/run.mjs jolibois
  node src/run.mjs clarenciere
  node src/run.mjs touraplomb
  node src/run.mjs maisondelacreation
  node src/run.mjs maisondelacreation_gare
  node src/run.mjs vauxhallsummer
  node src/run.mjs le140
  node src/run.mjs jacquesfranck
  node src/run.mjs maisonpoeme
  node src/run.mjs koeks
  node src/run.mjs poche
  node src/run.mjs improviste
  node src/run.mjs beursschouwburg
  node src/run.mjs halles
  node src/run.mjs volter
  node src/run.mjs theatredelavie
  node src/run.mjs lavenerie
  node src/run.mjs senghor
  node src/run.mjs jardindemasoer
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

  // Agenda policy: keep only upcoming items (>= today) unless explicitly overridden.
  const MIN_DATE = process.env.MIN_DATE || new Date().toISOString().slice(0, 10)
  const keepUpcoming = (reps) => (reps || []).filter((r) => r?.date && r.date >= MIN_DATE)

  if (mode === 'csv') {
    if (!arg) {
      console.error('Missing CSV path')
      process.exit(1)
    }
    const filePath = path.resolve(process.cwd(), arg)
    let reps = await loadFromCsv({ filePath })
    reps = keepUpcoming(reps)
    console.log(`Loaded ${reps.length} upcoming rows from CSV (>=${MIN_DATE})`)

    const res = await upsertRepresentations(reps)
    console.log(res)
    return
  }

  if (mode === 'theatreduparc') {
    let reps = await loadTheatreDuParc({ limitEvents: 20 })
    reps = keepUpcoming(reps)
    console.log(`Loaded ${reps.length} upcoming rows from Théâtre du Parc (>=${MIN_DATE})`)

    const res = await upsertRepresentations(reps)
    console.log(res)
    return
  }

  if (mode === 'balsamine') {
    let reps = await loadBalsamine({ limitPosts: 12 })
    reps = keepUpcoming(reps)
    console.log(`Loaded ${reps.length} upcoming rows from la Balsamine (>=${MIN_DATE})`)

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

  if (mode === 'bizou') {
    let reps = await loadBizou({ minDate: MIN_DATE, maxDate: '2026-06-30' })
    reps = keepUpcoming(reps)
    console.log(`Loaded ${reps.length} upcoming rows from Au B'Izou`) 

    const res = await upsertRepresentations(reps)
    console.log(res)
    return
  }

  if (mode === 'escaledunord') {
    let reps = await loadEscaleDuNord({ minDate: MIN_DATE, maxDate: '2026-06-30' })
    reps = keepUpcoming(reps)
    console.log(`Loaded ${reps.length} upcoming rows from Escale du Nord (filtered theatre/stand-up, >=${MIN_DATE})`) 

    const res = await upsertRepresentations(reps)
    console.log(res)
    return
  }

  if (mode === 'entrela') {
    let reps = await loadEntrela({ minDate: MIN_DATE, maxDate: '2026-06-30' })
    reps = keepUpcoming(reps)
    console.log(`Loaded ${reps.length} upcoming rows from L’Entrela’ (theatre category only, >=${MIN_DATE})`) 

    const res = await upsertRepresentations(reps)
    console.log(res)
    return
  }

  if (mode === 'deacoudre') {
    const reps = await loadDeACoudre()
    console.log(`Loaded ${reps.length} rows from Au Dé à Coudre (stub)`) 

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
    console.log(`Loaded ${reps.length} rows from Kaaitheater (2026-02-01 to 2026-06-30)`)

    const res = await upsertRepresentations(reps)
    console.log(res)
    return
  }

  if (mode === 'whalll') {
    const reps = await loadWHalll()
    console.log(`Loaded ${reps.length} rows from W:Halll (2026-02-01 to 2026-06-30)`)

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
    const reps = await loadLePublic({ limitShows: Number(process.env.LEPUBLIC_LIMIT_SHOWS || 25) })
    console.log(`Loaded ${reps.length} rows from Théâtre Le Public (2026-01-01 to 2026-06-30)`)

    const res = await upsertRepresentations(reps)
    console.log(res)
    return
  }

  if (mode === 'uccle') {
    const reps = await loadCCUccle()
    console.log(`Loaded ${reps.length} rows from Centre Culturel d’Uccle (stub)`) 

    const res = await upsertRepresentations(reps)
    console.log(res)
    return
  }

  if (mode === 'wolubilis') {
    const reps = await loadWolubilis()
    console.log(`Loaded ${reps.length} rows from Wolubilis (stub)`) 

    const res = await upsertRepresentations(reps)
    console.log(res)
    return
  }

  if (mode === 'kriekelaar') {
    const reps = await loadKriekelaar()
    console.log(`Loaded ${reps.length} rows from GC De Kriekelaar (stub)`) 

    const res = await upsertRepresentations(reps)
    console.log(res)
    return
  }

  if (mode === 'osamoelle') {
    const reps = await loadOsAMoelle()
    console.log(`Loaded ${reps.length} rows from L’Os à Moelle (stand-up only)`) 

    const res = await upsertRepresentations(reps)
    console.log(res)
    return
  }

  if (mode === 'cotevillage') {
    const reps = await loadCoteVillage()
    console.log(`Loaded ${reps.length} rows from Côté Village (stub)`) 

    const res = await upsertRepresentations(reps)
    console.log(res)
    return
  }

  if (mode === 'jolibois') {
    const reps = await loadJoliBois({ minDate: MIN_DATE, maxDate: '2026-06-30' })
    console.log(`Loaded ${reps.length} rows from Centre communautaire de Joli-Bois (stand-up only)`) 

    const res = await upsertRepresentations(reps)
    console.log(res)
    return
  }

  if (mode === 'clarenciere') {
    const reps = await loadClarenciere({ minDate: MIN_DATE, maxDate: '2026-06-30' })
    console.log(`Loaded ${reps.length} rows from La Clarencière (small venue, permissive)`) 

    const res = await upsertRepresentations(reps)
    console.log(res)
    return
  }

  if (mode === 'touraplomb') {
    const reps = await loadTourAPlomb()
    console.log(`Loaded ${reps.length} rows from Tour à Plomb (stub, keep an eye)`) 

    const res = await upsertRepresentations(reps)
    console.log(res)
    return
  }

  if (mode === 'maisondelacreation') {
    const reps = await loadMaisonDeLaCreation()
    console.log(`Loaded ${reps.length} rows from Maison de la création (MC NOH) (stub, site unreachable)`) 

    const res = await upsertRepresentations(reps)
    console.log(res)
    return
  }

  if (mode === 'maisondelacreation_gare') {
    const reps = await loadMaisonDeLaCreationGare()
    console.log(`Loaded ${reps.length} rows from Maison de la création – MC Gare (stub, site unreachable)`) 

    const res = await upsertRepresentations(reps)
    console.log(res)
    return
  }

  if (mode === 'vauxhallsummer') {
    let reps = await loadVauxHallSummer({ minDate: MIN_DATE, maxDate: '2026-06-30' })
    reps = keepUpcoming(reps)
    console.log(`Loaded ${reps.length} upcoming rows from Vaux Hall Summer (STRICT filter)`) 

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

  if (mode === 'jacquesfranck') {
    let reps = await loadJacquesFranck({ minDate: MIN_DATE, maxDate: '2026-06-30' })
    reps = keepUpcoming(reps)
    console.log(`Loaded ${reps.length} upcoming rows from Centre culturel Jacques Franck (agenda pages, theatre-only, >=${MIN_DATE})`)

    const res = await upsertRepresentations(reps)
    console.log(res)
    return
  }

  if (mode === 'maisonpoeme') {
    let reps = await loadMaisonPoeme({ minDate: MIN_DATE, maxDate: '2026-06-30' })
    reps = keepUpcoming(reps)
    console.log(`Loaded ${reps.length} upcoming rows from Maison Poème (WP REST event CPT, theatre-ish only, >=${MIN_DATE})`)

    const res = await upsertRepresentations(reps)
    console.log(res)
    return
  }

  if (mode === 'koeks') {
    let reps = await loadKoeks({ minDate: MIN_DATE, maxDate: '2026-06-30' })
    reps = keepUpcoming(reps)
    console.log(`Loaded ${reps.length} upcoming rows from Koek's Théâtre (site unavailable/parked; stub)`) 

    const res = await upsertRepresentations(reps)
    console.log(res)
    return
  }

  if (mode === 'poche') {
    let reps = await loadPoche({ minDate: MIN_DATE, maxDate: '2026-06-30' })
    reps = keepUpcoming(reps)
    console.log(`Loaded ${reps.length} upcoming rows from Théâtre de Poche (homepage listing, start-date per show, >=${MIN_DATE})`)

    const res = await upsertRepresentations(reps)
    console.log(res)
    return
  }

  if (mode === 'improviste') {
    let reps = await loadImproviste({ minDate: MIN_DATE, maxDate: '2026-06-30' })
    reps = keepUpcoming(reps)
    console.log(`Loaded ${reps.length} upcoming rows from Théâtre l'Improviste (spectacles page, >=${MIN_DATE})`)

    const res = await upsertRepresentations(reps)
    console.log(res)
    return
  }

  if (mode === 'beursschouwburg') {
    const reps = await loadBeursschouwburg()
    console.log(`Loaded ${reps.length} rows from Beursschouwburg (2026-01-01 to 2026-06-30)`)

    const res = await upsertRepresentations(reps)
    console.log(res)
    return
  }

  if (mode === 'halles') {
    const reps = await loadHallesDeSchaerbeek()
    console.log(`Loaded ${reps.length} rows from Les Halles de Schaerbeek (2026-01-01 to 2026-06-30)`)

    const res = await upsertRepresentations(reps)
    console.log(res)
    return
  }

  if (mode === 'volter') {
    const reps = await loadVolter()
    console.log(`Loaded ${reps.length} rows from Comédie Royale Claude Volter (generated from official date ranges)`)

    const res = await upsertRepresentations(reps)
    console.log(res)
    return
  }

  if (mode === 'theatredelavie') {
    let reps = await loadTheatreDeLaVie()
    reps = keepUpcoming(reps)
    console.log(`Loaded ${reps.length} upcoming rows from Théâtre de la Vie (plays-only, >=${MIN_DATE})`)

    const res = await upsertRepresentations(reps)
    console.log(res)
    return
  }

  if (mode === 'lavenerie') {
    let reps = await loadLavenerie({ minDate: MIN_DATE, maxDate: '2026-06-30' })
    reps = keepUpcoming(reps)
    console.log(`Loaded ${reps.length} upcoming rows from La Vénerie (meilisearch, plays-only, >=${MIN_DATE})`)

    const res = await upsertRepresentations(reps)
    console.log(res)
    return
  }

  if (mode === 'senghor') {
    let reps = await loadSenghor({ minDate: MIN_DATE, maxDate: '2026-06-30' })
    reps = keepUpcoming(reps)
    console.log(`Loaded ${reps.length} upcoming rows from Espace Senghor (meilisearch, theatre+representation, >=${MIN_DATE})`)

    const res = await upsertRepresentations(reps)
    console.log(res)
    return
  }

  if (mode === 'jardindemasoer') {
    let reps = await loadJardinDeMaSoeur({ minDate: MIN_DATE, maxDate: '2026-06-30' })
    reps = keepUpcoming(reps)
    console.log(`Loaded ${reps.length} upcoming rows from Le Jardin de ma Sœur (Squarespace event list, plays-only, >=${MIN_DATE})`)

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

#!/usr/bin/env node
import 'dotenv/config'
import fetch from 'node-fetch'
import { getSupabaseAdmin } from '../lib/supabase.mjs'
import { stripDiacritics } from '../lib/normalize.mjs'

function stripTags(s) {
  return String(s || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
}

function isKvsHosted(html) {
  const txt = stripDiacritics(stripTags(html)).toLowerCase()
  if (txt.includes('kvs.be')) return true
  if (txt.includes('→ kvs') || txt.includes('-> kvs')) return true
  if (txt.includes('coproduction kvs') || txt.includes('coproduction')) {
    if (txt.includes('kvs')) return true
  }
  if (txt.includes('coprésentation') && txt.includes('kvs')) return true
  return false
}

async function fetchHtml(url) {
  const res = await fetch(url, {
    headers: {
      'user-agent': 'Mozilla/5.0 (OpenClaw pipelinetheatre)',
      'accept-language': 'fr-BE,fr;q=0.9,en;q=0.8',
    },
  })
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`)
  return await res.text()
}

async function main() {
  const supabase = getSupabaseAdmin()

  const { data, error } = await supabase
    .from('representations')
    .select('id,url')
    .eq('source', 'theatrenational')
    .gte('date', '2026-01-01')
    .lte('date', '2026-06-30')
    .limit(5000)

  if (error) throw new Error(error.message)

  const rows = data || []
  const urls = Array.from(new Set(rows.map((r) => r.url).filter(Boolean)))
  console.log(`Scan theatrenational: ${rows.length} rows, ${urls.length} unique urls`)

  const kvsUrls = new Set()
  for (const url of urls) {
    try {
      const html = await fetchHtml(url)
      if (isKvsHosted(html)) kvsUrls.add(url)
    } catch (e) {
      console.warn(`Skip url ${url}: ${e?.message || e}`)
    }
  }

  const toDelete = rows.filter((r) => kvsUrls.has(r.url)).map((r) => r.id)
  console.log({ kvsUrls: kvsUrls.size, deleteCount: toDelete.length })

  let deleted = 0
  for (let i = 0; i < toDelete.length; i += 200) {
    const chunk = toDelete.slice(i, i + 200)
    const { error: e2 } = await supabase.from('representations').delete().in('id', chunk)
    if (e2) throw new Error(e2.message)
    deleted += chunk.length
  }

  console.log({ deleted })
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

#!/usr/bin/env node
import 'dotenv/config'
import fetch from 'node-fetch'
import { getSupabaseAdmin } from '../lib/supabase.mjs'

function stripTags(s) {
  return String(s || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
}

function parseOgDescription(html) {
  const m = html.match(/<meta property="og:description" content="([^"]+)"/i)
  return m ? stripTags(m[1]) : null
}

function parseImage(html) {
  return (
    html.match(/<meta property="og:image" content="([^"]+)"/i)?.[1] ||
    html.match(/<meta name="twitter:image" content="([^"]+)"/i)?.[1] ||
    html.match(/\b(https?:\/\/[^\s"']+\.(?:jpg|jpeg|png|webp))\b/i)?.[1] ||
    null
  )
}

async function fetchHtml(url) {
  const res = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 (OpenClaw pipelinetheatre)' } })
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`)
  return await res.text()
}

async function main() {
  const supabase = getSupabaseAdmin()

  const { data, error } = await supabase
    .from('representations')
    .select('id,url,description,image_url')
    .eq('source', 'lepublic')
    .or('description.is.null,image_url.is.null')
    .limit(2000)

  if (error) throw new Error(error.message)
  const rows = data || []

  const urls = Array.from(new Set(rows.map((r) => r.url).filter(Boolean)))
  console.log(`Found ${rows.length} lepublic rows; ${urls.length} unique URLs to enrich`)

  const byUrl = new Map()
  for (const url of urls) {
    try {
      const html = await fetchHtml(url)
      byUrl.set(url, {
        description: parseOgDescription(html),
        image_url: parseImage(html),
      })
    } catch (e) {
      console.warn(`Skip ${url}: ${e?.message || e}`)
    }
  }

  let updated = 0
  for (const r of rows) {
    const info = byUrl.get(r.url)
    if (!info) continue

    const patch = {}
    if (!r.description && info.description) patch.description = info.description
    if (!r.image_url && info.image_url) patch.image_url = info.image_url

    if (Object.keys(patch).length === 0) continue

    const { error: e2 } = await supabase.from('representations').update(patch).eq('id', r.id)
    if (e2) throw new Error(e2.message)
    updated += 1
  }

  console.log({ updated })
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

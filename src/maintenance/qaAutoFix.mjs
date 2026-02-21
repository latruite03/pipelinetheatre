#!/usr/bin/env node
import 'dotenv/config'
import fetch from 'node-fetch'
import { getSupabaseAdmin } from '../lib/supabase.mjs'

function parseArgs(argv) {
  const out = { apply: false, from: null, to: null, limit: 5000 }
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--apply') out.apply = true
    else if (a === '--from') out.from = argv[++i]
    else if (a === '--to') out.to = argv[++i]
    else if (a === '--limit') out.limit = Number(argv[++i] || out.limit)
  }
  if (!out.from || !out.to) throw new Error('Usage: qaAutoFix.mjs --from YYYY-MM-DD --to YYYY-MM-DD [--apply]')
  return out
}

function nowIso() {
  return new Date().toISOString()
}

function stripTags(s) {
  return String(s || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
}

function decodeHtmlEntities(s) {
  return String(s || '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&rsquo;/g, '’')
    .replace(/&lsquo;/g, '‘')
    .replace(/&eacute;/gi, 'é')
    .replace(/&egrave;/gi, 'è')
    .replace(/&ecirc;/gi, 'ê')
    .replace(/&agrave;/gi, 'à')
    .replace(/&acirc;/gi, 'â')
    .replace(/&icirc;/gi, 'î')
    .replace(/&ocirc;/gi, 'ô')
    .replace(/&uuml;/gi, 'ü')
    .replace(/&ndash;/gi, '–')
    .replace(/&mdash;/gi, '—')
}

function isSuspectImageUrl(u) {
  const s = String(u || '').toLowerCase()
  if (!s) return true
  if (s.startsWith('data:')) return true
  // common non-show images
  if (s.includes('logo')) return true
  if (s.includes('placeholder')) return true
  if (s.includes('favicon')) return true
  // tiny thumbnails are often useless; keep heuristic conservative
  if (s.includes('w=80') || s.includes('w=120') || s.includes('width=80') || s.includes('width=120')) return true
  return false
}

function safeLen(s) {
  return String(s || '').trim().length
}

function chooseBestRow(rows) {
  // Prefer non-suspect image, then longer description, then earlier created? (not available)
  const scored = rows.map((r) => {
    const hasGoodImg = r.image_url && !isSuspectImageUrl(r.image_url)
    const descLen = safeLen(r.description)
    const urlScore = r.source_url ? 1 : 0
    return { r, score: (hasGoodImg ? 10000 : 0) + descLen + urlScore }
  })
  scored.sort((a, b) => b.score - a.score)
  return scored[0]?.r
}

async function fetchHtml(url) {
  const res = await fetch(url, {
    redirect: 'follow',
    headers: {
      'user-agent': 'Mozilla/5.0 (OpenClaw pipelinetheatre QA)',
      'accept-language': 'fr-BE,fr;q=0.9,en;q=0.8,nl;q=0.7',
    },
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return await res.text()
}

function parseOgImage(html) {
  return (
    html.match(/<meta property="og:image" content="([^"]+)"/i)?.[1] ||
    html.match(/<meta name="twitter:image" content="([^"]+)"/i)?.[1] ||
    null
  )
}

function parseOgDescription(html) {
  return (
    html.match(/<meta property="og:description" content="([^"]+)"/i)?.[1] ||
    html.match(/<meta name="description" content="([^"]+)"/i)?.[1] ||
    null
  )
}

function parseJsonLd(html) {
  const blocks = []
  const re = /<script[^>]+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi
  let m
  while ((m = re.exec(html))) blocks.push(m[1])
  return blocks
}

function extractFromJsonLd(html) {
  for (const raw of parseJsonLd(html)) {
    try {
      const json = JSON.parse(raw.trim())
      const nodes = Array.isArray(json) ? json : [json]
      for (const n of nodes) {
        const desc = n?.description || n?.abstract || n?.articleBody
        const img = n?.image && (typeof n.image === 'string' ? n.image : n.image?.url)
        if (desc || img) return { description: desc || null, image_url: img || null }
      }
    } catch {
      // ignore
    }
  }
  return { description: null, image_url: null }
}

function extractSynopsisParagraphs(html, maxChars = 500) {
  const afterH1 = /<h1[^>]*>[\s\S]*?<\/h1>([\s\S]{0,10000})/i.exec(html)?.[1] || ''
  const re = /<p[^>]*>([\s\S]*?)<\/p>/gi
  const paras = []
  let m
  while ((m = re.exec(afterH1))) {
    const t = stripTags(decodeHtmlEntities(m[1]))
    if (!t) continue
    if (/newsletter|cookies|billetterie|réserver|calendrier|représentation/i.test(t) && t.length < 120) continue
    paras.push(t)
    if (paras.length >= 6) break
  }
  const joined = paras.join(' ')
  if (!joined) return null
  const s = joined.replace(/\s+/g, ' ').trim()
  if (s.length <= maxChars) return s
  return s.slice(0, maxChars).replace(/[,;:\s]+$/, '') + '…'
}

async function main() {
  const args = parseArgs(process.argv)
  const supabase = getSupabaseAdmin()

  const { data, error } = await supabase
    .from('representations')
    .select('id,source,source_url,url,date,heure,titre,theatre_nom,image_url,description,hidden_at,hidden_reason')
    .gte('date', args.from)
    .lte('date', args.to)
    .limit(args.limit)

  if (error) throw new Error(error.message)
  const rows = data || []

  const visible = rows.filter((r) => !r.hidden_at)

  // 1) duplicates
  const bySlot = new Map()
  for (const r of visible) {
    const k = `${r.date}|${r.heure}|${r.theatre_nom}|${r.titre}`
    if (!bySlot.has(k)) bySlot.set(k, [])
    bySlot.get(k).push(r)
  }

  const dupGroups = Array.from(bySlot.entries()).filter(([, rs]) => rs.length >= 2)

  let maskedDuplicates = 0
  if (dupGroups.length) {
    for (const [, rs] of dupGroups) {
      const keep = chooseBestRow(rs)
      const toMask = rs.filter((r) => r.id !== keep.id)
      if (!toMask.length) continue
      if (args.apply) {
        for (const r of toMask) {
          const { error: e2 } = await supabase
            .from('representations')
            .update({ hidden_at: nowIso(), hidden_reason: 'auto: duplicate slot' })
            .eq('id', r.id)
          if (e2) throw new Error(e2.message)
          maskedDuplicates += 1
        }
      } else {
        maskedDuplicates += toMask.length
      }
    }
  }

  // For remaining steps, work on still-visible rows (recompute if apply)
  const { data: data2, error: err2 } = await supabase
    .from('representations')
    .select('id,source,source_url,url,date,heure,titre,theatre_nom,image_url,description,hidden_at,hidden_reason')
    .gte('date', args.from)
    .lte('date', args.to)
    .limit(args.limit)
  if (err2) throw new Error(err2.message)
  const rows2 = (data2 || []).filter((r) => !r.hidden_at)

  // 2) images
  const needsImg = rows2.filter((r) => !r.image_url || isSuspectImageUrl(r.image_url))

  // 3) descriptions (we compute early so we can fetch HTML once for both images+descriptions)
  const needsDesc = rows2.filter((r) => safeLen(r.description) < 80)

  const urlsToFetch = new Map() // url -> [rowIds]
  for (const r of [...needsImg, ...needsDesc]) {
    const u = r.source_url || r.url
    if (!u) continue
    if (!urlsToFetch.has(u)) urlsToFetch.set(u, [])
    urlsToFetch.get(u).push(r.id)
  }

  const fetched = new Map() // url -> {image_url, description}
  for (const u of urlsToFetch.keys()) {
    try {
      const html = await fetchHtml(u)
      const ogImg = parseOgImage(html)
      const ogDesc = parseOgDescription(html)
      const jl = extractFromJsonLd(html)
      const img = jl.image_url || ogImg
      const desc = jl.description || ogDesc
      fetched.set(u, {
        image_url: img ? String(img).trim() : null,
        description: desc ? stripTags(decodeHtmlEntities(desc)) : null,
        synopsis: extractSynopsisParagraphs(html),
      })
    } catch (e) {
      fetched.set(u, { error: e?.message || String(e) })
    }
  }

  let imagesUpdated = 0
  for (const r of needsImg) {
    const u = r.source_url || r.url
    const info = fetched.get(u)
    const candidate = info?.image_url
    if (!candidate || isSuspectImageUrl(candidate)) continue

    if (args.apply) {
      const { error: e2 } = await supabase.from('representations').update({ image_url: candidate }).eq('id', r.id)
      if (e2) throw new Error(e2.message)
    }
    imagesUpdated += 1
  }

  // 3) descriptions
  let descriptionsUpdated = 0
  for (const r of needsDesc) {
    const u = r.source_url || r.url
    if (!u) continue
    const info = fetched.get(u)
    let candidate = info?.description || info?.synopsis || null
    candidate = candidate ? stripTags(decodeHtmlEntities(candidate)) : null
    if (!candidate || candidate.length < 80) continue

    if (args.apply) {
      const { error: e2 } = await supabase.from('representations').update({ description: candidate }).eq('id', r.id)
      if (e2) throw new Error(e2.message)
    }
    descriptionsUpdated += 1
  }

  // Remaining issues after (potential) apply
  const { data: data3, error: err3 } = await supabase
    .from('representations')
    .select('id,date,heure,titre,theatre_nom,image_url,description,hidden_at')
    .gte('date', args.from)
    .lte('date', args.to)
    .limit(args.limit)
  if (err3) throw new Error(err3.message)
  const vis3 = (data3 || []).filter((r) => !r.hidden_at)
  const bySlot3 = new Map()
  for (const r of vis3) {
    const k = `${r.date}|${r.heure}|${r.theatre_nom}|${r.titre}`
    if (!bySlot3.has(k)) bySlot3.set(k, 0)
    bySlot3.set(k, bySlot3.get(k) + 1)
  }
  const remainingDupGroups = Array.from(bySlot3.values()).filter((n) => n >= 2).length
  const remainingMissingImages = vis3.filter((r) => !r.image_url || isSuspectImageUrl(r.image_url)).length
  const remainingShortDesc = vis3.filter((r) => safeLen(r.description) < 80).length

  console.log(
    JSON.stringify(
      {
        window: { from: args.from, to: args.to },
        apply: args.apply,
        scannedVisible: vis3.length,
        duplicates: { groups: dupGroups.length, masked: maskedDuplicates, remainingGroups: remainingDupGroups },
        images: { candidates: needsImg.length, updated: imagesUpdated, remaining: remainingMissingImages },
        descriptions: { candidates: needsDesc.length, updated: descriptionsUpdated, remaining: remainingShortDesc },
      },
      null,
      2,
    ),
  )
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

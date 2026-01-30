import fetch from 'node-fetch'
import { getSupabaseAdmin } from '../lib/supabase.mjs'

function stripTags(s) {
  return (s || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
}

function decodeHtmlEntities(s) {
  return (s || '')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
}

function extractText(html) {
  // Prefer the paragraph(s) right after the show title (<h1>), which are the synopsis.
  const afterH1 = /<h1[^>]*>[^<]*<\/h1>([\s\S]{0,8000})/i.exec(html)?.[1] || ''

  const candidates = []
  const re = /<p[^>]*>([\s\S]*?)<\/p>/gi
  let m
  while ((m = re.exec(afterH1))) {
    const t = stripTags(decodeHtmlEntities(m[1]))
    if (!t) continue

    // Ignore calendar/availability lines and boilerplate
    if (/représentation à|liste d'attente/i.test(t)) continue
    if (/newsletter|inscrivez-vous|billetterie/i.test(t)) continue

    candidates.push(t)
    if (candidates.length >= 6) break
  }

  // Heuristic: pick the first long-ish paragraph as synopsis
  const long = candidates.find((p) => p.length >= 80)
  if (long) return long

  // fallback: join a few short ones
  if (candidates.length) return candidates.slice(0, 3).join(' ')

  // final fallback: scan whole page
  const all = []
  while ((m = re.exec(html))) {
    const t = stripTags(decodeHtmlEntities(m[1]))
    if (!t) continue
    if (/représentation à|liste d'attente/i.test(t)) continue
    all.push(t)
    if (all.length >= 5) break
  }
  return all.join(' ')
}

function summarize(text, maxChars = 300) {
  const cleaned = (text || '').replace(/\s+/g, ' ').trim()
  if (!cleaned) return null
  if (cleaned.length <= maxChars) return cleaned

  // Build from sentences
  const parts = cleaned.split(/(?<=[\.!\?…])\s+/)
  let out = ''
  for (const p of parts) {
    const candidate = out ? `${out} ${p}` : p
    if (candidate.length > maxChars) break
    out = candidate
    if (out.length >= Math.floor(maxChars * 0.75)) break
  }

  if (!out) out = cleaned.slice(0, maxChars)
  out = out.replace(/[,;:\s]+$/, '')
  if (!/[\.!\?…]$/.test(out)) out += '…'
  return out
}

export async function enrichTheatreDuParc({
  maxChars = 300,
  dryRun = true,
  limitShows = 50,
} = {}) {
  const supabase = getSupabaseAdmin()

  // Fetch distinct shows by source_url that need description
  const { data: rows, error } = await supabase
    .from('representations')
    .select('source_url,titre,description')
    .eq('source', 'theatreduparc')
    .limit(2000)

  if (error) throw new Error(error.message)

  const byUrl = new Map()
  for (const r of rows || []) {
    const u = r.source_url
    if (!u) continue
    const d = (r.description && String(r.description).trim()) || ''
    const needs = !d || d.length > maxChars + 20
    if (!byUrl.has(u)) {
      byUrl.set(u, { source_url: u, titre: r.titre, needsEnrich: needs, currentLen: d.length })
    } else {
      // If any row for this show needs enrichment, enrich the show once
      const prev = byUrl.get(u)
      if (needs) prev.needsEnrich = true
    }
  }

  const shows = Array.from(byUrl.values())
    // For now we enrich all shows (same source_url) because connector descriptions are not guaranteed to be short/punchy.
    .slice(0, limitShows)

  const results = []

  for (const s of shows) {
    const html = await (await fetch(s.source_url)).text()
    const text = extractText(html)
    const pitch = summarize(text, maxChars)

    results.push({ source_url: s.source_url, titre: s.titre, pitch })

    if (!dryRun && pitch) {
      // Update all dates for this show.
      // Safe rule: overwrite only when description is null/empty OR very long (likely raw paste).
      const { error: upErr } = await supabase
        .from('representations')
        .update({ description: pitch })
        .eq('source', 'theatreduparc')
        .eq('source_url', s.source_url)

      if (upErr) throw new Error(upErr.message)
    }
  }

  return {
    shows_considered: shows.length,
    updated: dryRun ? 0 : results.filter((r) => r.pitch).length,
    sample: results.slice(0, 5),
  }
}

import { getSupabaseAdmin } from '../lib/supabase.mjs'

// Sanity QA: in the visible upcoming window, mask items that look clearly non-theatre
// (talks, conferences, travel lectures, dance qualifiers, album promo, etc.)
// This is intentionally conservative: it only masks when we have a strong deny signal
// and no positive theatre signal.

function toDateString(d) {
  return d.toISOString().slice(0, 10)
}

function addDays(d, n) {
  const x = new Date(d)
  x.setDate(x.getDate() + n)
  return x
}

// Deny keywords must be VERY specific to avoid false positives.
// (We do NOT want to hide actual theatre just because of generic words.)
const DENY_RE = /(lecteurs du soir|science\s*&\s*cocktails|exposition|vernissage|conf[ée]rence|table ronde|rencontre[- ]d[ée]bat|d[ée]bat\b|talk\b|masterclass|projection|cin[ée]ma|album\b|sortie de (son|leur) nouvel album|chanson francophone|concert\b|showcase|d[ée]dicace|voyage\b|bal\b|qualifier\b)/i
const ALLOW_RE = /(th[ée]âtre|pi[eè]ce|com[ée]die|trag[ée]die|drame|seul en sc[eè]ne|stand-?up|humour|impro|marionn|spectacle|lecture-spectacle|cabaret|conte)/i

const supabase = getSupabaseAdmin()
const today = new Date()
const startStr = toDateString(today)
const endStr = toDateString(addDays(today, Number(process.env.DAYS || 14)))
const limit = Number(process.env.LIMIT || 600)

console.log('Theatre-only sanity check:', startStr, '→', endStr)

const { data: rows, error } = await supabase
  .from('representations')
  .select('id,date,titre,theatre_nom,description,url,source')
  .is('hidden_at', null)
  .eq('is_theatre', true)
  .gte('date', startStr)
  .lte('date', endStr)
  .order('date', { ascending: true })
  .limit(limit)

if (error) {
  console.error('ERROR loading rows:', error)
  process.exit(1)
}

const now = new Date().toISOString()
let flagged = 0
let masked = 0

for (const r of rows || []) {
  const hay = `${r.titre || ''} ${r.description || ''}`

  if (!DENY_RE.test(hay)) continue
  if (ALLOW_RE.test(hay)) continue

  // Hard allowlist by known theatre domains (avoid false positives)
  const url = String(r.url || '')
  if (/theatrelepublic\.be/i.test(url)) continue
  if (/kvs\.be/i.test(url)) continue
  if (/trg\.be/i.test(url)) continue
  if (/ttotheatre\.com/i.test(url)) continue

  flagged += 1
  console.log('FLAG non-theatre?', r.date, '-', r.theatre_nom, '-', r.titre)
  console.log('  url:', r.url)

  if (process.env.DRY_RUN === '1') {
    console.log('  DRY_RUN: not masking')
    continue
  }

  const { error: e2 } = await supabase
    .from('representations')
    .update({ is_theatre: false, hidden_at: now, hidden_reason: 'auto: theatreOnlySanity (non-theatre keywords)' })
    .eq('id', r.id)

  if (e2) {
    console.log('  update failed:', e2.message)
  } else {
    masked += 1
  }
}

console.log('Done. flagged=', flagged, 'masked=', masked)

import fetch from 'node-fetch'
import { getSupabaseAdmin } from '../lib/supabase.mjs'
import { fetchOgImage } from '../enrich/ogImage.mjs'

function toDateString(d) {
  return d.toISOString().slice(0, 10)
}

function addDays(d, n) {
  const x = new Date(d)
  x.setDate(x.getDate() + n)
  return x
}

async function checkImage(url) {
  if (!url) return { ok: false, reason: 'empty' }
  try {
    const res = await fetch(url, { method: 'GET', redirect: 'follow', timeout: 15000 })
    const ct = res.headers.get('content-type') || ''
    if (!res.ok) return { ok: false, reason: `http_${res.status}` }
    if (!ct.startsWith('image/')) return { ok: false, reason: `not_image:${ct}` }
    return { ok: true }
  } catch (e) {
    return { ok: false, reason: e?.message || 'fetch_error' }
  }
}

const supabase = getSupabaseAdmin()

const today = new Date()
const startStr = toDateString(today)
const endStr = toDateString(addDays(today, Number(process.env.DAYS || 14)))
const limit = Number(process.env.LIMIT || 120)

console.log('Verify upcoming images range:', startStr, '→', endStr, 'limit', limit)

const { data: rows, error } = await supabase
  .from('representations')
  .select('id,date,heure,titre,theatre_nom,url,image_url')
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

let bad = 0
let fixed = 0

for (const r of rows || []) {
  if (!r.image_url) continue

  const chk = await checkImage(r.image_url)
  if (chk.ok) continue

  bad += 1
  console.log('BAD image', chk.reason, '-', r.date, r.theatre_nom, '|', r.titre)
  console.log('  image_url:', r.image_url)

  // Try recovery from ticket page
  let recovered = null
  if (r.url) recovered = await fetchOgImage(r.url)

  const patch = recovered ? { image_url: recovered } : { image_url: null }
  const { error: upErr } = await supabase
    .from('representations')
    .update(patch)
    .eq('id', r.id)

  if (upErr) {
    console.log('  update failed:', upErr.message)
  } else {
    fixed += 1
    console.log('  -> updated image_url:', recovered || '(cleared)')
  }
}

console.log('Done. bad=', bad, 'fixed=', fixed)

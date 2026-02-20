import { createClient } from '@supabase/supabase-js'
import fs from 'node:fs'

function parseKeyValueFile(content) {
  const out = {}
  for (const line of String(content || '').split(/\r?\n/)) {
    const s = line.trim()
    if (!s || s.startsWith('#')) continue
    const i = s.indexOf('=')
    if (i === -1) continue
    const k = s.slice(0, i).trim()
    const v = s.slice(i + 1).trim()
    if (k) out[k] = v
  }
  return out
}

function getFallbackSupabaseCreds() {
  // Allows cron/automation contexts to run without env injection.
  // This file is expected to exist on Thom's machine (Windows side) and is already used elsewhere.
  const candidates = [
    '/mnt/c/OPENCLAW/Memory/credentials/supabase_theatre.txt',
  ]

  for (const p of candidates) {
    try {
      if (!fs.existsSync(p)) continue
      const parsed = parseKeyValueFile(fs.readFileSync(p, 'utf8'))
      const url = parsed.url
      const key = parsed.service_role_key
      if (url && key) return { url, key, source: p }
    } catch {
      // ignore
    }
  }

  return null
}

export function getSupabaseAdmin() {
  let url = process.env.SUPABASE_URL
  let key = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !key) {
    const fallback = getFallbackSupabaseCreds()
    if (fallback) {
      url = url || fallback.url
      key = key || fallback.key
    }
  }

  if (!url || !key) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY (env or supabase_theatre.txt)')
  }

  return createClient(url, key, {
    auth: { persistSession: false },
  })
}

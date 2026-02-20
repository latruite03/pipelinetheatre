function toAbs(candidate, pageUrl) {
  if (!candidate) return null
  try {
    return new URL(candidate, pageUrl).toString()
  } catch {
    return candidate
  }
}

function looksLikeJunkImage(u) {
  const s = String(u || '').toLowerCase()
  return (
    s.includes('logo') ||
    s.includes('bandeau') ||
    s.includes('banner') ||
    s.includes('footer') ||
    s.includes('favicon')
  )
}

export async function fetchOgImage(pageUrl) {
  if (!pageUrl) return null

  try {
    const res = await fetch(pageUrl, {
      headers: {
        'user-agent': 'Mozilla/5.0 (compatible; OpenClawBot/1.0; +https://openclaw.ai)'
      }
    })
    if (!res.ok) return null
    const html = await res.text()

    // 1) Prefer explicit social meta tags
    const og = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["'][^>]*>/i)
    const tw = html.match(/<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["'][^>]*>/i)
    const meta = (og && og[1]) || (tw && tw[1])
    if (meta) {
      const abs = toAbs(meta, pageUrl)
      if (abs && !looksLikeJunkImage(abs)) return abs
    }

    // 2) Fallback: first <img src> on the page (some sources like SPIP don't set og:image)
    // Keep it conservative: only return something that looks like an actual image URL.
    const img = html.match(/<img[^>]+src=["']([^"']+\.(?:jpg|jpeg|png|webp)(?:\?[^"']*)?)["']/i)
    if (img && img[1]) {
      const abs = toAbs(img[1], pageUrl)
      if (abs && !looksLikeJunkImage(abs)) return abs
    }

    return null
  } catch {
    return null
  }
}

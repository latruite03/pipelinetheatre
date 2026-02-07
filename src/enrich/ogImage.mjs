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

    const og = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["'][^>]*>/i)
    const tw = html.match(/<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["'][^>]*>/i)
    const url = (og && og[1]) || (tw && tw[1])
    if (!url) return null

    try {
      return new URL(url, pageUrl).toString()
    } catch {
      return url
    }
  } catch {
    return null
  }
}

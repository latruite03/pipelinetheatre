import fetch from 'node-fetch'
import { computeFingerprint } from '../lib/normalize.mjs'

const SOURCE = 'improviste'

const VENUE_URL = 'https://www.improviste.be/-Spectacles-.html'

const FETCH_OPTS = {
  headers: {
    'user-agent': 'Mozilla/5.0',
    'accept-language': 'fr-BE,fr;q=0.9,en;q=0.8',
  },
}

function decodeHtmlEntities(s) {
  return (s || '')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#8217;/g, "'")
    .replace(/&#8211;/g, '-')
}

function stripTags(s) {
  return (s || '')
    .replace(/<br\s*\/?\s*>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function inRange(date) {
  return date >= '2026-01-01' && date <= '2026-06-30'
}

function parseFrenchDate(dateStr) {
  // Format: "jeudi 9.04.2026 à 20:00" or "vendredi 10.04.2026 <span>à</span> 20:00"
  const cleaned = dateStr.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
  // Extract date and time
  const match = cleaned.match(/(\d{1,2})\.(\d{2})\.(\d{4}).*?(\d{2}):(\d{2})/)
  if (match) {
    const [, day, month, year, hour, minute] = match
    const dd = String(day).padStart(2, '0')
    return `${year}-${month}-${dd}T${hour}:${minute}:00Z`
  }
  return null
}

function parseArticles(html) {
  const articles = []
  
  // Find all article blocks with events
  const articleRegex = /<article[^>]*class="[^"]*vueHorizontale[^"]*"[\s\S]*?<\/article>/gi
  let match
  while ((match = articleRegex.exec(html))) {
    const block = match[0]
    
    // Extract URL and title
    const titleMatch = /<h2[^>]*><a[^>]+href="([^"]+\.html)"[^>]+title="([^"]+)"[^>]*>([^<]+)<\/a><\/h2>/i.exec(block)
    const url = titleMatch ? `https://www.improviste.be/${titleMatch[1]}` : null
    const title = titleMatch ? decodeHtmlEntities(titleMatch[3]) : null
    
    // Extract image
    const imgMatch = /<picture[^>]*>[\s\S]*?<img[^>]+src="([^"]+)"[^>]*>/i.exec(block)
    const imageUrl = imgMatch ? `https://www.improviste.be/${imgMatch[1]}` : null
    
    // Extract all dates - need to handle nested spans
    const dates = []
    
    // First, find all date list items
    const liRegex = /<li[^>]*><span[^>]+class="[^"]*date[^"]*"[^>]*>([\s\S]*?)<\/span><\/li>/gi
    let liMatch
    while ((liMatch = liRegex.exec(block))) {
      const content = liMatch[1].replace(/<span[^>]*>.*?<\/span>/gi, ' ').trim()
      const parsedDate = parseFrenchDate(content)
      if (parsedDate) {
        dates.push(parsedDate)
      }
    }
    
    if (url && dates.length > 0) {
      articles.push({ url, title, imageUrl, dates })
    }
  }
  
  // Also check for carousel events on main page
  const carouselRegex = /<article[^>]*>[\s\S]*?<a[^>]+href="([^"]+\.html)"[^>]+title="([^"]+)"[^>]*>[\s\S]*?<img[^>]+src="([^"]+)"[^>]*>[\s\S]*?<span[^>]+class="[^"]*date[^"]*"[^>]*>([\s\S]*?)<\/span>[\s\S]*?<ul[^>]+class="[^"]*othersDates[^"]*"[^>]*>([\s\S]*?)<\/ul>/gi
  while ((match = carouselRegex.exec(html))) {
    const url = `https://www.improviste.be/${match[1]}`
    const title = decodeHtmlEntities(match[2])
    const imageUrl = `https://www.improviste.be/${match[3]}`
    
    const mainDate = parseFrenchDate(match[4])
    const dates = mainDate ? [mainDate] : []
    
    // Parse additional dates from othersDates
    const othersDatesMatch = match[5].matchAll(/<li[^>]*><span[^>]+class="[^"]*date[^"]*"[^>]*>([\s\S]*?)<\/span><\/li>/gi)
    for (const dMatch of othersDatesMatch) {
      const parsedDate = parseFrenchDate(dMatch[1])
      if (parsedDate) {
        dates.push(parsedDate)
      }
    }
    
    // Avoid duplicates
    if (url && dates.length > 0 && !articles.some(a => a.url === url)) {
      articles.push({ url, title, imageUrl, dates })
    }
  }
  
  return articles
}

export async function loadImproviste() {
  const html = await (await fetch(VENUE_URL, FETCH_OPTS)).text()

  const theatre_nom = "Théâtre l'Improviste"
  const theatre_adresse = '120 rue de Fierlant, 1190 Bruxelles, Belgique'

  const reps = []

  const articles = parseArticles(html)

  for (const a of articles) {
    for (const dateTime of a.dates) {
      const date = dateTime.slice(0, 10)
      if (!inRange(date)) continue

      const rep = {
        source: SOURCE,
        source_url: VENUE_URL,
        date,
        heure: dateTime.slice(11, 16),
        titre: a.title || 'Spectacle',
        theatre_nom,
        theatre_adresse,
        url: a.url,
        genre: null,
        style: null,
        ...(a.imageUrl ? { image_url: a.imageUrl } : {}),
        description: `Spectacle d'improvisation au Théâtre l'Improviste.`,
      }

      rep.fingerprint = computeFingerprint(rep)
      reps.push(rep)
    }
  }

  // dedupe
  const out = []
  const seen = new Set()
  for (const r of reps) {
    if (seen.has(r.fingerprint)) continue
    seen.add(r.fingerprint)
    out.push(r)
  }

  return out
}

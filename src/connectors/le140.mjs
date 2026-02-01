import fetch from 'node-fetch'
import { computeFingerprint } from '../lib/normalize.mjs'

const SOURCE = 'le140'
const BASE = 'https://www.le140.be'

function stripTags(s) {
  return (s || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
}

function slugify(text) {
  return text
    .toString()
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^\w\-]+/g, '')
    .replace(/\-\-+/g, '-')
}

function parseShows(html) {
  const shows = []
  
  // Find all h2 titles followed by date lists
  // The structure is: <h2>Title</h2> ... <li>DD.MM > HHhMM</li>
  const h2Re = /<h2[^>]*>([^<]+)<\/h2>/gi
  let h2Match
  
  while ((h2Match = h2Re.exec(html))) {
    const titre = stripTags(h2Match[1]).trim()
    
    // Skip non-show titles
    if (!titre || titre.includes('Archives') || titre.includes('Catégories')) continue
    
    // Construct URL from title
    const showUrl = `${BASE}/spectacles/${slugify(titre)}/`
    
    // Find dates after this title (look ahead in the HTML)
    const h2Start = h2Match.index
    const h2End = html.indexOf('</h2>', h2Start) + 5
    const afterH2 = html.substring(h2End)  // Start AFTER the closing H2 tag
    
    // Find the next h2 to determine the end of this section
    const nextH2Match = afterH2.match(/<h2[^>]*>/i)
    const sectionEnd = nextH2Match ? afterH2.indexOf(nextH2Match[0]) : afterH2.length
    const section = afterH2.substring(0, sectionEnd)
    
    // Extract all dates from this section
    const dateRe = /<li>(\d{1,2})\.(\d{2})\s*>\s*(\d{1,2})h(\d{2})<\/li>/gi
    let dateMatch
    
    while ((dateMatch = dateRe.exec(section))) {
      const day = dateMatch[1].padStart(2, '0')
      const month = dateMatch[2]
      const hour = dateMatch[3].padStart(2, '0')
      const minute = dateMatch[4]
      
      // Determine year based on month (September-December = 2025, January-June = 2026)
      const monthNum = parseInt(month, 10)
      const year = monthNum >= 9 && monthNum <= 12 ? 2025 : 2026
      
      const date = `${year}-${month}-${day}`
      const heure = `${hour}:${minute}`
      
      shows.push({
        url: showUrl,
        titre,
        date,
        heure
      })
    }
  }
  
  return shows
}

export async function loadLe140({ limitShows = 20 } = {}) {
  const archiveUrl = `${BASE}/spectacles/`
  const archiveHtml = await (await fetch(archiveUrl)).text()
  
  const theatre_nom = 'Théâtre 140'
  const theatre_adresse = '140 Avenue Eugène Plasky, 1030 Schaerbeek'

  const allShows = parseShows(archiveHtml)
  
  console.log(`Found ${allShows.length} total show dates`)
  
  // Filter to shows within date range
  const filteredShows = allShows.filter(s => s.date >= '2026-01-01' && s.date <= '2026-06-30')
  
  console.log(`Found ${filteredShows.length} shows in 2026-01-01 to 2026-06-30`)
  
  // Limit results
  const shows = filteredShows.slice(0, limitShows * 5)
  
  const reps = []
  
  for (const s of shows) {
    const rep = {
      source: SOURCE,
      source_url: s.url,
      date: s.date,
      heure: s.heure,
      titre: s.titre,
      theatre_nom,
      theatre_adresse,
      url: s.url,
      genre: null,
      style: null,
      description: null,
    }
    rep.fingerprint = computeFingerprint(rep)
    reps.push(rep)
  }

  return reps
}

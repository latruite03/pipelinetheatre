import fetch from 'node-fetch'
import { computeFingerprint, stripDiacritics } from '../lib/normalize.mjs'

const SOURCE = 'lepublic'
const BASE = 'https://www.theatrelepublic.be'

const MONTHS = {
  janvier: '01',
  fevrier: '02',
  février: '02',
  mars: '03',
  avril: '04',
  mai: '05',
  juin: '06',
  juillet: '07',
  aout: '08',
  août: '08',
  septembre: '09',
  octobre: '10',
  novembre: '11',
  decembre: '12',
  décembre: '12',
}

function decodeHtmlEntities(s) {
  return (s || '')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
}

function stripTags(s) {
  return (s || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
}

function pickFirst(re, text) {
  const m = re.exec(text)
  return m ? m[1] : null
}

function parseShowUrlsFromSeason(html) {
  const urls = new Set()
  
  // Extract show URLs from season page
  // Shows can be: l-habilleur, prima-facie, big-mother, o-vous-freres-humains-2026, etc.
  const re = /href="([a-z0-9-]+)"/gi
  let m
  
  while ((m = re.exec(html))) {
    const slug = m[1]
    
    // Skip non-show patterns
    const skipPatterns = [
      'calendrier', 'reservation', 'saison', 'spectacles', 'informations', 
      'blog', 'technique', 'services', 'restaurant', 'librairie', 'billetterie',
      'tarifs', 'contact', 'equipe', 'memoires', 'ecole', 'amis', 'projet',
      'parking', 'pedagogique', 'professionnels', 'location', 'offres', 'infos-pratiques',
      'videos', 'archives', 'voir', 'tournee', 'qui-sommes-nous', 'theatre-le-public',
      'audiodescription', 'navette', 'programmation', 'production', 'evenements',
      'en-attendant', 'merci', 'nouvel-article', 'programme', 'bouton', 'couteau',
      'recherche', 'backend', 'facebook', 'instagram', 'youtube', 'spip', 'plugins',
      'local', 'prive', 'squelettes', 'css', 'js', 'img', 'cache', 'pdf',
      'auteur', 'rubrique', 'mot', 'breve', 'forum', 'signaler', 'envoyer',
      'a-voir-en-famille', 'en-tournee', 'archives-saisons', 'statistiques',
      'login', 'motdepasse', 'oubli', 'valider', 'configurer', '馨', '🍪'
    ]
    
    const isShow = !skipPatterns.some(p => slug.includes(p)) && 
                   slug.length > 3 &&
                   !/^\d+$/.test(slug) &&
                   !slug.includes('article') &&
                   !slug.includes('page') &&
                   !slug.includes('motdepasse') &&
                   !slug.includes('oubli') &&
                   !slug.includes('valider') &&
                   !slug.includes('configurer') &&
                   !slug.includes('auteur') &&
                   !slug.includes('breve') &&
                   !slug.includes('forum') &&
                   !/^https?:\/\//i.test(slug) &&
                   !slug.includes('@')
    
    if (isShow) {
      urls.add(`${BASE}/${slug}`)
    }
  }
  
  return Array.from(urls)
}

function parseTitle(html) {
  // Try to find title in og:meta or h1
  const og = pickFirst(/<meta property="og:title" content="([^"]+)"/i, html)
  if (og) return og.replace(/\s*\|\s*Théâtre Le Public\s*$/i, '').trim()
  
  const h1 = pickFirst(/<h1[^>]*>([\s\S]*?)<\/h1>/i, html)
  if (h1) return stripTags(decodeHtmlEntities(h1))
  
  return null
}

function parsePoster(html) {
  return (
    pickFirst(/<meta property="og:image" content="([^"]+)"/i, html) ||
    pickFirst(/<meta name="twitter:image" content="([^"]+)"/i, html) ||
    pickFirst(/<meta property="twitter:image" content="([^"]+)"/i, html) ||
    pickFirst(/<meta itemprop="image" content="([^"]+)"/i, html) ||
    pickFirst(/\b(https?:\/\/[^\s"']+\.(?:jpg|jpeg|png|webp))\b/i, html)
  )
}

function parseDates(html) {
  // Parse dates from show pages - format:
  // <h6 class="m-0"><span class="nom_jour">mardi</span> 03 février</h6>
  // <div><i class="far fa-clock"></i> <span class="...">20h30</span></div>
  
  const dates = []
  const text = html
  
  // Pattern to match time
  const timeRe = /(\d{1,2})h(\d{2})/g
  const timeMatches = []
  let timeMatch
  while ((timeMatch = timeRe.exec(text))) {
    timeMatches.push({
      hh: timeMatch[1].padStart(2, '0'),
      mm: timeMatch[2],
      index: timeMatch.index
    })
  }
  
  // Pattern to match date
  const dateRe = /<span class="nom_jour">[^<]*<\/span>\s*(\d{1,2})\s+(\w+)/gi
  const dateMatches = []
  let dateMatch
  while ((dateMatch = dateRe.exec(text))) {
    const day = dateMatch[1].padStart(2, '0')
    const monthName = dateMatch[2].toLowerCase()
    const month = MONTHS[monthName]
    if (month) {
      dateMatches.push({
        day,
        month,
        index: dateMatch.index
      })
    }
  }
  
  // Match dates with times based on proximity in HTML
  for (const d of dateMatches) {
    let closestTime = null
    let minDistance = Infinity
    
    for (const t of timeMatches) {
      const distance = Math.abs(t.index - d.index)
      if (distance < minDistance && distance < 500) {
        minDistance = distance
        closestTime = t
      }
    }
    
    if (closestTime && d.month >= '01' && d.month <= '06') {
      dates.push({
        day: d.day,
        month: d.month,
        time: `${closestTime.hh}:${closestTime.mm}:00`
      })
    }
  }
  
  return dates
}

function extractDescription(html) {
  // Prefer og:description when present (pages often lack clean <h1>/<og:image>).
  const og = pickFirst(/<meta property="og:description" content="([^"]+)"/i, html)
  if (og) return stripTags(decodeHtmlEntities(og))

  const afterBody = /<body[\s\S]*?<p[^>]*>([\s\S]{0,8000})/i.exec(html)?.[1] || ''
  
  const ps = []
  const reP = /<p[^>]*>([\s\S]*?)<\/p>/gi
  let m
  while ((m = reP.exec(afterBody)) && ps.length < 15) {
    const t = stripTags(decodeHtmlEntities(m[1]))
    if (t && t.length > 50 && 
        !t.toLowerCase().includes('en savoir plus') && 
        !t.toLowerCase().includes('programme du spectacle') &&
        !t.toLowerCase().includes('production du') &&
        !t.toLowerCase().includes('fédération wallonie') &&
        !t.toLowerCase().includes('tax shelter') &&
        !t.toLowerCase().includes('réservations') &&
        !t.toLowerCase().includes('infos & réservations')) {
      ps.push(t)
    }
  }
  
  return ps[0] || null
}

export async function loadLePublic({ limitShows = 100 } = {}) {
  const seasonUrl = `${BASE}/saison-2025-2026`
  console.log('Fetching season page...')
  const html = await (await fetch(seasonUrl)).text()
  
  const showUrls = parseShowUrlsFromSeason(html).slice(0, limitShows)
  console.log(`Found ${showUrls.length} potential show URLs`)
  
  const theatre_nom = 'Théâtre Le Public'
  const theatre_adresse = 'Rue Braemt 64-70, 1210 Bruxelles'
  
  const reps = []
  
  for (const showUrl of showUrls) {
    try {
      const showHtml = await (await fetch(showUrl)).text()
      const titre = parseTitle(showHtml) || showUrl.split('/').pop()
      
      if (!titre) continue
      
      const description = extractDescription(showHtml)
      const image_url = parsePoster(showHtml)
      const dates = parseDates(showHtml)
      
      if (dates.length === 0) {
        continue
      }
      
      console.log(`Found ${dates.length} dates for: ${titre}`)
      
      for (const d of dates) {
        const date = `2026-${d.month}-${d.day}`
        const heure = d.time
        
        const rep = {
          source: SOURCE,
          source_url: showUrl,
          date,
          heure,
          titre,
          theatre_nom,
          theatre_adresse,
          url: showUrl,
          genre: null,
          style: null,
          ...(description ? { description } : {}),
          ...(image_url ? { image_url } : {}),
        }
        rep.fingerprint = computeFingerprint(rep)
        reps.push(rep)
      }
    } catch (e) {
      console.error(`Error fetching ${showUrl}:`, e?.message || e)
    }
  }
  
  return reps
}

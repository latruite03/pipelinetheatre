import fetch from 'node-fetch'
import { computeFingerprint } from '../lib/normalize.mjs'

const SOURCE = 'novum'
const BASE = 'https://www.novum.brussels'

const MONTHS = {
  'janvier': '01',
  'février': '02',
  'fevrier': '02',
  'mars': '03',
  'avril': '04',
  'mai': '05',
  'juin': '06',
  'juillet': '07',
  'août': '08',
  'aout': '08',
  'septembre': '09',
  'octobre': '10',
  'novembre': '11',
  'décembre': '12',
  'decembre': '12'
}

function decodeHtmlEntities(s) {
  return (s || '')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#8211;/g, '–')
    .replace(/&#8217;/g, "'")
}

function stripTags(s) {
  return (s || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
}

function pickFirst(re, text) {
  const m = re.exec(text)
  return m ? m[1] : null
}

function parseEventCards(html) {
  const events = []
  
  // Extract all titles with their URLs
  const titleRegex = /<h4[^>]*class="[^"]*sc_services_item_title[^"]*"[^>]*>\s*<a[^>]*href="([^"]*)"[^>]*>([^<]*)<\/a>\s*<\/h4>/gi
  let titleMatch
  const titles = []
  
  while ((titleMatch = titleRegex.exec(html))) {
    titles.push({
      url: titleMatch[1],
      title: stripTags(decodeHtmlEntities(titleMatch[2]))
    })
  }
  
  // Extract all dates
  const dateRegex = /<div[^>]*class="[^"]*sc_services_item_content[^"]*"[^>]*>\s*<p>([^<]*)<\/p>/gi
  let dateMatch
  const dates = []
  
  while ((dateMatch = dateRegex.exec(html))) {
    dates.push(stripTags(decodeHtmlEntities(dateMatch[1])))
  }
  
  // Extract all images
  const imageRegex = /<div[^>]*class="[^"]*post_featured[^"]*"[^>]*>[\s\S]*?<img[^>]*class="[^"]*wp-post-image[^"]*"[^>]*src="([^"]*)"/gi
  let imageMatch
  const images = []
  
  while ((imageMatch = imageRegex.exec(html))) {
    images.push(imageMatch[1])
  }
  
  // Extract all booking links
  const bookingRegex = /<a[^>]*class="[^"]*post_link[^"]*"[^>]*href="([^"]*)"[^>]*>/gi
  let bookingMatch
  const bookings = []
  
  while ((bookingMatch = bookingRegex.exec(html))) {
    bookings.push(bookingMatch[1])
  }
  
  // Combine them by index (they should be in the same order)
  const count = Math.min(titles.length, dates.length)
  for (let i = 0; i < count; i++) {
    events.push({
      title: titles[i].title,
      url: titles[i].url,
      bookingUrl: bookings[i] || titles[i].url,
      dateText: dates[i],
      image_url: images[i] || null
    })
  }
  
  return events
}

function parseSingleDate(dateStr) {
  // Pattern: "15 AVRIL 2026 | 20:00"
  const singleMatch = /(\d{1,2})\s+(\w+)\s+(\d{4})\s*\|?\s*(\d{1,2}):(\d{2})/i.exec(dateStr)
  if (singleMatch) {
    const day = String(singleMatch[1]).padStart(2, '0')
    const monthName = singleMatch[2].toLowerCase()
    const year = singleMatch[3]
    const hour = String(singleMatch[4]).padStart(2, '0')
    const minute = singleMatch[5]
    const month = MONTHS[monthName]
    if (month && year === '2026' && Number(month) <= 6) {
      return [{
        date: `${year}-${month}-${day}`,
        time: `${hour}:${minute}:00`
      }]
    }
    return []
  }
  
  // Pattern: "31 JANVIER au 1er FEVRIER 2026" (date range)
  const rangeMatch = /(\d{1,2}(?:er)?)\s+(\w+)\s+(?:au|et)\s+(\d{1,2}(?:er)?)\s+(\w+)\s+(\d{4})/i.exec(dateStr)
  if (rangeMatch) {
    const startDay = String(rangeMatch[1]).replace(/er$/, '')
    const startMonthName = rangeMatch[2].toLowerCase()
    const endDay = String(rangeMatch[3]).replace(/er$/, '')
    const endMonthName = rangeMatch[4].toLowerCase()
    const year = rangeMatch[5]
    
    const startMonth = MONTHS[startMonthName]
    const endMonth = MONTHS[endMonthName]
    
    if (startMonth && endMonth && year === '2026') {
      const dates = []
      
      // If same month, generate all days between start and end
      if (startMonth === endMonth) {
        for (let d = Number(startDay); d <= Number(endDay); d++) {
          dates.push({
            date: `${year}-${startMonth}-${String(d).padStart(2, '0')}`,
            time: null
          })
        }
      } else if (Number(startMonth) < Number(endMonth)) {
        // Spans multiple months
        // Add all days in start month from startDay to end of month
        const daysInStartMonth = new Date(Number(year), Number(startMonth), 0).getDate()
        for (let d = Number(startDay); d <= daysInStartMonth; d++) {
          dates.push({
            date: `${year}-${startMonth}-${String(d).padStart(2, '0')}`,
            time: null
          })
        }
        // Add all days in end month from 1 to endDay
        for (let d = 1; d <= Number(endDay); d++) {
          dates.push({
            date: `${year}-${endMonth}-${String(d).padStart(2, '0')}`,
            time: null
          })
        }
      }
      
      return dates
    }
  }
  
  return []
}

function extractDescription(html) {
  // The description is not available in the card, so we'll skip it
  // or could potentially fetch the booking page for more info
  return null
}

export async function loadNovum({ limitEvents = 50 } = {}) {
  const agendaUrl = `${BASE}/agenda/`
  const html = await (await fetch(agendaUrl)).text()
  
  const events = parseEventCards(html).slice(0, limitEvents)
  
  const theatre_nom = 'Théâtre Saint-Michel'
  const theatre_adresse = '2, Rue Père Eudore Devroye, 1040 Bruxelles'
  
  const reps = []
  
  for (const event of events) {
    const dates = parseSingleDate(event.dateText)
    
    for (const d of dates) {
      const rep = {
        source: SOURCE,
        source_url: event.url,
        date: d.date,
        heure: d.time,
        titre: event.title,
        theatre_nom,
        theatre_adresse,
        url: event.bookingUrl,
        genre: null,
        style: null,
        ...(event.image_url ? { image_url: event.image_url } : {}),
      }
      rep.fingerprint = computeFingerprint(rep)
      reps.push(rep)
    }
  }
  
  return reps
}

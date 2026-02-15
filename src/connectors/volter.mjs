import { computeFingerprint } from '../lib/normalize.mjs'

const SOURCE = 'https://comedieroyaleclaudevolter.be'
const THEATRE_NOM = 'Comédie Royale Claude Volter'
const THEATRE_ADRESSE = 'Av des Frères Legrain 98, 1150 Bruxelles'

function pad2(n) {
  return String(n).padStart(2, '0')
}

function toISODate(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

function* eachDayInclusive(startISO, endISO) {
  const start = new Date(`${startISO}T00:00:00Z`)
  const end = new Date(`${endISO}T00:00:00Z`)
  for (let d = start; d <= end; d = new Date(d.getTime() + 24 * 3600 * 1000)) {
    yield new Date(d)
  }
}

function buildRepsFromRange({
  titre,
  url,
  image_url,
  description,
  startDate,
  endDate,
  timeWeek = '20:15',
  timeSun = '16:00',
}) {
  const reps = []

  for (const d of eachDayInclusive(startDate, endDate)) {
    // JS: 0=Sun,1=Mon,2=Tue,...6=Sat
    const dow = d.getUTCDay()
    if (dow === 1) continue // Mondays: no shows (per site: Tue-Sat + Sun)

    const date = toISODate(d)
    const heure = dow === 0 ? timeSun : timeWeek

    const rep = {
      source: SOURCE,
      source_url: url,
      date,
      heure,
      titre,
      theatre_nom: THEATRE_NOM,
      theatre_adresse: THEATRE_ADRESSE,
      url,
      genre: null,
      style: null,
      description,
      image_url,
    }
    rep.fingerprint = computeFingerprint(rep)
    reps.push(rep)
  }

  return reps
}

export async function loadVolter() {
  // NOTE: We generate the full list of representations from the date range + weekday rules
  // displayed on the official ticketing pages.

  const shows = [
    {
      titre: 'Sarah et le cri de la langouste',
      url: 'https://comedieroyaleclaudevolter.be/index.php?mact=Agenda,cntnt01,DetailEvent,0&cntnt01id_event=103&cur_lang=fr&cntnt01returnid=1',
      image_url: 'https://comedieroyaleclaudevolter.be/events/794049214681214d2eb87e.jpg',
      description:
        "Volontairement exilée à Belle-Île-en-Mer, Sarah Bernhardt, vieillissante, rassemble une dernière fois ses souvenirs. Face à ses humeurs et ses extravagances, tourbillonne Georges Pitou, son fidèle secrétaire, qui joue tous les personnages ayant compté dans la vie de sa maîtresse pour revigorer sa mémoire. Une des pièces les plus attachantes, les plus gaies et les plus sensibles. (Détails, distribution et crédits sur la page officielle.)",
      startDate: '2026-03-03',
      endDate: '2026-03-29',
      timeWeek: '20:15',
      timeSun: '16:00',
    },
    {
      titre: "Coiffeuse d'Ames",
      url: 'https://comedieroyaleclaudevolter.be/index.php?mact=Agenda,cntnt01,DetailEvent,0&cntnt01id_event=104&cur_lang=fr&cntnt01returnid=1',
      image_url: 'https://comedieroyaleclaudevolter.be/events/18195891666821b89ec3544.jpg',
      description:
        "Lorsque, la veille de Noël, Eléonore pénètre dans un salon de coiffure sans avoir pris rendez-vous, elle est loin de se douter de ce qui l'attend. Car Nuwu, coiffeuse d'âmes de son état, a bien une réservation à son nom. Peu à peu, elle éprouve le sentiment étrange que rien ne se déroule comme elle l'avait imaginé. Le salon est vide et la coiffeuse attendait sa venue. Une comédie décoiffante sur le parcours des âmes. (Détails, distribution et crédits sur la page officielle.)",
      startDate: '2026-04-15',
      endDate: '2026-04-26',
      timeWeek: '20:15',
      timeSun: '16:00',
    },
  ]

  const reps = []
  for (const s of shows) {
    reps.push(
      ...buildRepsFromRange({
        titre: s.titre,
        url: s.url,
        image_url: s.image_url,
        description: s.description,
        startDate: s.startDate,
        endDate: s.endDate,
        timeWeek: s.timeWeek,
        timeSun: s.timeSun,
      })
    )
  }

  // Sanity: keep <= 2026-06-30
  return reps.filter((r) => r.date <= '2026-06-30')
}

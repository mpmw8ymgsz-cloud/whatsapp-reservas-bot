// Grupos de turoperador, agencia, DMC, jefe de grupo o guía.
// Solo hechos ya publicados en el bot o en donfadrique.com. Sin precios,
// comisiones, plazas de cortesía ni hueco de autocar: eso va en la propuesta.

const { DateTime } = require('luxon');
const { normalize } = require('./dateParser');
const confirmacion = require('./confirmacion');
const conocimiento = require('./eventosConocimiento');
const faq = require('./faqLlegada');

const TRIGGER_ES = 'Quiero información para un grupo de turoperador';
const TRIGGER_EN = 'I would like information for a tour operator group';
const TYPE = 'evento_turoperador';

const SERVICE_BUTTONS = {
  es: [
    { id: 'top_lunch', title: 'Comida' },
    { id: 'top_dinner', title: 'Cena' },
    { id: 'top_stay', title: 'Alojamiento' },
  ],
  en: [
    { id: 'top_lunch', title: 'Lunch' },
    { id: 'top_dinner', title: 'Dinner' },
    { id: 'top_stay', title: 'Overnight' },
  ],
};

const MEAL_BUTTONS = {
  es: [
    { id: 'top_lunch', title: 'Comida' },
    { id: 'top_dinner', title: 'Cena' },
  ],
  en: [
    { id: 'top_lunch', title: 'Lunch' },
    { id: 'top_dinner', title: 'Dinner' },
  ],
};

const STAY_BUTTONS = {
  es: [
    { id: 'top_also', title: 'También hotel' },
    { id: 'top_mealonly', title: 'Sin hotel' },
    { id: 'top_unsure', title: 'Aún no lo sé' },
  ],
  en: [
    { id: 'top_also', title: 'Also overnight' },
    { id: 'top_mealonly', title: 'Meal only' },
    { id: 'top_unsure', title: 'Not sure yet' },
  ],
};

const COACH_BUTTONS = {
  es: [
    { id: 'top_coach_yes', title: 'En autocar' },
    { id: 'top_coach_no', title: 'Sin autocar' },
    { id: 'top_coach_ns', title: 'Aún no lo sé' },
  ],
  en: [
    { id: 'top_coach_yes', title: 'By coach' },
    { id: 'top_coach_no', title: 'Not by coach' },
    { id: 'top_coach_ns', title: 'Not sure yet' },
  ],
};

const REVIEW_BUTTONS = {
  es: [
    { id: 'top_send', title: 'Enviar solicitud' },
    { id: 'top_fix', title: 'Corregir datos' },
  ],
  en: [
    { id: 'top_send', title: 'Send request' },
    { id: 'top_fix', title: 'Change details' },
  ],
};

function text(body) {
  return { kind: 'text', body };
}

function buttons(body, list) {
  return { kind: 'buttons', body, buttons: list };
}

function say(lang, es, en) {
  return lang === 'en' ? en : es;
}

function fold(value) {
  return normalize(value)
    .replace(/['’]/g, '')
    .replace(/[-_/]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function publicPhone() {
  if (confirmacion.PHONE === '923 37 00 76') return '+34 923 37 00 76';
  return confirmacion.PHONE;
}

function publicEmail() {
  return confirmacion.EMAIL;
}

function contactLines() {
  return `📍 ${confirmacion.ADDRESS}\n📞 ${publicPhone()}\n✉️ ${publicEmail()}`;
}

function isTourButton(buttonId) {
  return typeof buttonId === 'string' && buttonId.startsWith('top_');
}

function isTourOperatorTopic(value) {
  const norm = fold(value);
  if (!norm) return false;
  if (/turoperador|touroperador|tour operador|tour operator/.test(norm)) return true;
  if (/agencia de viajes|agencia de turismo|travel agency|travel agent/.test(norm)) return true;
  if (/\bdmc\b|destination management/.test(norm)) return true;
  if (/operador(?:es)? turistic/.test(norm)) return true;
  if (/agencia receptiva|operador receptivo|receptive agency|incoming operator|inbound operator/.test(norm)) return true;
  if (/tour leader|tour director|tour manager|jefe de grupo|jefa de grupo|director de grupo/.test(norm)) return true;
  if (/guia de grupo|guias de grupo|guia turistic|tour guide|group leader/.test(norm)) return true;
  if (/motorcoach operator|coach operator/.test(norm)) return true;
  if (/\b(soy|somos|i am|im|we are)\b.{0,40}\b(guia|guide)\b/.test(norm) && !/michelin|repsol/.test(norm)) return true;
  if (/\bgroup lunches?\b|\bgroup dinners?\b|\blunch for (?:our|the|a) group\b|\bdinner for (?:our|the|a) group\b/.test(norm)) {
    return true;
  }
  if (
    /\b(groups?|grupos?)\b/.test(norm) &&
    /\b(tours?|itineraries|itinerarios?|coach(?:es)?|autocar(?:es)?|motorcoach|passengers?|pasajeros|pax|departures?|salidas)\b/.test(norm)
  ) {
    return true;
  }
  if (/\bfam trip\b|\bfamiliarization trip\b/.test(norm)) return true;
  if (/\bseries\b/.test(norm) && /\b(groups?|departures?|tours?|grupos?|salidas)\b/.test(norm)) return true;
  if (/grupo de turistas|grupos de turistas|group of tourists|tourist groups?/.test(norm)) return true;
  if (
    /\b(our tours|nuestros tours|nuestras salidas)\b/.test(norm) &&
    /\b(group|grupo|lunch|comida|dinner|cena|hotel|stay|salamanca|20\d{2})\b/.test(norm)
  ) {
    return true;
  }
  return false;
}

function isInquiry(value) {
  const norm = fold(value);
  if (!isTourOperatorTopic(norm)) return false;
  if (conocimiento.isBodaTopic(norm)) return false;
  if (/navidad|nochebuena|nochevieja|ano nuevo/.test(norm)) return false;
  if (
    /\b(congresos?|congress(?:es)?|conferences?|conventions?|seminars?)\b/.test(norm) &&
    !/\b(lunch(?:es)?|dinner|dinners|almuerzo|comida|cena|overnight|alojamiento|habitacion(?:es)?)\b/.test(norm)
  ) {
    return false;
  }
  return true;
}

function detectLang(raw, fallback = 'es') {
  const norm = fold(raw);
  if (!norm) return fallback === 'en' ? 'en' : 'es';
  const en = norm.match(
    /\b(the|and|our|we|are|for|with|from|your|this|would|like|please|hello|hi|about|have|what|where|when|which|will|you|group|tour|tours|lunch|dinner|operator|agency|passengers)\b/g
  );
  const es = norm.match(
    /\b(el|la|los|las|que|para|por|con|somos|queremos|una|hola|buenos|gracias|dias|nuestro|nuestra|como|donde|tambien|comida|cena|agencia|grupo|grupos|turoperador)\b/g
  );
  const enHits = en ? en.length : 0;
  const esHits = es ? es.length : 0;
  if (esHits === 0 && /\b(tour operator|travel agency|travel agent|group lunch|group lunches|tour leader|tour guide|dmc)\b/.test(norm)) {
    return 'en';
  }
  if (enHits === 0 && /\b(turoperador|agencia de viajes|jefe de grupo|guia turistic)\b/.test(norm)) return 'es';
  if (enHits >= 2 && enHits > esHits) return 'en';
  if (esHits >= 2 && esHits > enHits) return 'es';
  return fallback === 'en' ? 'en' : 'es';
}

function shouldAnswerAside(raw) {
  const norm = fold(raw);
  if (!norm) return false;
  if (/\?/.test(raw || '')) return true;
  const words = norm.split(/\s+/).filter(Boolean);
  if (words.length < 4) return false;
  return /^(what|where|when|how|which|do you|can you|could you|is there|are there|cuanto|cuanta|que |cual |donde |como |teneis|hay |podeis|puede )/.test(
    norm
  );
}

function menuBlurb(lang) {
  return say(
    lang,
    'La comida de grupo es para compartir, de cocina tradicional española y salmantina: un pase frío de tapas, ensaladas y especialidades de la zona; un pase caliente con platos de la casa del horno de leña y la parrilla; y postres caseros. El producto es local: cerdo ibérico, ternera morucha, pescado del Tormes y nuestro pan de masa madre.',
    'The group lunch is a sharing meal of traditional Spanish and Salamanca cooking: a cold course of tapas, salads and regional specialities; a hot course with the house dishes from the wood-fired oven and the grill; and homemade desserts. We cook with local produce: Iberian pork, Morucha beef, fish from the river Tormes, and our own sourdough bread.'
  );
}

function proposalLine(lang) {
  return say(
    lang,
    'El equipo envía una propuesta a medida para 2027, con el menú y las condiciones. Por aquí no cierro precios, comisiones ni plazas de cortesía.',
    'The team sends a tailored 2027 proposal, with the menu and the conditions. I can’t quote prices, commission or complimentary places from here.'
  );
}

function parkingLine(lang) {
  return say(
    lang,
    'Hay aparcamiento privado. Si el grupo llega en autocar, el acceso del vehículo se confirma en la propuesta: no tengo cerrado el hueco para el autocar.',
    'There is private parking. If the group arrives by coach, vehicle access is confirmed in the proposal: I don’t have a confirmed space for the coach.'
  );
}

function locationLine(lang) {
  return say(
    lang,
    `Estamos en ${faq.ADDRESS}: a unos 17 km de Salamanca y a las puertas de Alba de Tormes.\n${faq.mapsUrl()}\n\n${contactLines()}`,
    `We are at ${faq.ADDRESS}: about 17 km from Salamanca, at the gates of Alba de Tormes.\n${faq.mapsUrl()}\n\n${contactLines()}`
  );
}

function intro(lang, business) {
  const name = (business && business.name) || 'Hostería Don Fadrique';
  return say(
    lang,
    `🚌 *Turoperador / grupo · ${name}*\n\n` +
      `Estamos en ${faq.ADDRESS}: a unos 17 km de Salamanca y a las puertas de Alba de Tormes. ` +
      `Hay restaurante, ${conocimiento.HABITACIONES}, aparcamiento privado y jardines. ` +
      `La terraza acristalada se reserva para comidas privadas de 10 a 50 comensales, con vistas a Alba de Tormes.\n\n` +
      `${menuBlurb('es')}\n\n` +
      `${proposalLine('es')} ${parkingLine('es')}\n\n` +
      `Nada queda reservado hasta entonces.`,
    `🚌 *Tour operators and groups · ${name}*\n\n` +
      `We are at ${faq.ADDRESS}: about 17 km from Salamanca, at the gates of Alba de Tormes. ` +
      `The house has a restaurant, 21 double rooms, private parking and gardens. ` +
      `The glazed terrace can be booked for a private lunch of 10 to 50 guests, with views over Alba de Tormes.\n\n` +
      `${menuBlurb('en')}\n\n` +
      `${proposalLine('en')} ${parkingLine('en')}\n\n` +
      `Nothing is held until then.`
  );
}

function answerFact(raw, lang) {
  const norm = fold(raw);
  if (!norm) return null;
  if (
    /precio|cuanto cuesta|cuanto vale|tarifa|comision|commission|net rate|\bneto\b|\bfoc\b|complimentary|cortesia|cortesias|how much|what does it cost|per person|por persona|free (?:place|seat|pax)|plaza gratuita|guia gratis|guide free|driver free|conductor gratis/.test(
      norm
    )
  ) {
    return proposalLine(lang);
  }
  if (/parking|aparcamiento|aparcar|\bpark\b|hueco para/.test(norm)) return parkingLine(lang);
  if (/traslado|shuttle|\btransfer\b/.test(norm)) {
    return say(
      lang,
      'El traslado del grupo se estudia según el tamaño y la fecha, y se presupuesta aparte. No va incluido si la propuesta no lo dice.',
      'A group transfer is looked at case by case, by size and date, and it is quoted separately. It is not included unless the proposal says so.'
    );
  }
  if (
    /horario|a que hora|que hora|cerrado|martes|miercoles|opening hours|what time|closed on|tuesday|wednesday/.test(norm)
  ) {
    return say(
      lang,
      'El restaurante sirve comidas de 13:30 a 15:30 y cenas de 20:30 a 22:30. Cierra martes y miércoles. Un servicio de grupo se confirma en la propuesta.',
      'The restaurant serves lunch from 13:30 to 15:30 and dinner from 20:30 to 22:30. It is closed on Tuesdays and Wednesdays. A group service is confirmed in the proposal.'
    );
  }
  if (/michelin|repsol/.test(norm)) {
    return say(
      lang,
      'El restaurante está recomendado en la Guía Michelin y tiene 1 Sol Repsol desde 2015.',
      'The restaurant is recommended in the Michelin Guide and has had 1 Repsol Sun since 2015.'
    );
  }
  if (/terraza|aforo|capacidad|capacity|private lunch|comensales|how many (?:people|guests|diners)|cuantos caben/.test(norm)) {
    return say(
      lang,
      `La terraza acristalada es para comidas privadas de 10 a 50 comensales. Entre todos los espacios caben ${conocimiento.CAPACIDAD_TOTAL}. El reparto se concreta en la propuesta.`,
      'The glazed terrace is for private lunches of 10 to 50 guests. Together the spaces hold 500 to 700 people. How a larger group is split is set out in the proposal.'
    );
  }
  if (/habitacion|habitaciones|double room|rooms?\b|alojamiento|overnight|dormir|pernoct/.test(norm)) {
    return say(
      lang,
      `Hay ${conocimiento.HABITACIONES}. La tarifa y las condiciones van en la propuesta, no las cierro por aquí.`,
      `There are 21 double rooms. The rate and the conditions are in the proposal. I can’t confirm a rate from here.`
    );
  }
  if (/jardin|jardines|gardens?/.test(norm)) {
    return say(
      lang,
      'Hay jardines. La terraza y los jardines tienen vistas a Alba de Tormes.',
      'There are gardens. The terrace and the gardens look out towards Alba de Tormes.'
    );
  }
  if (
    /como llegar|donde estais|donde esta|direccion|ubicacion|address|where are|how far|how do we get|google maps|\bmapa\b|alba de tormes|salamanca/.test(
      norm
    )
  ) {
    return locationLine(lang);
  }
  if (/gluten|vegetar|vegano|vegan|alergi|celiac|intoleran|dietary|diet\b|menu especial|special diet/.test(norm)) {
    return say(
      lang,
      'Las alergias y los menús especiales se anotan y el equipo los incluye en la propuesta. Por aquí no cierro una carta.',
      'Allergies and special diets are noted, and the team includes them in the proposal. I can’t lock a menu from here.'
    );
  }
  if (/telefono|llamar|\bemail\b|correo|contacto|whatsapp|phone number|e-mail|reach you/.test(norm)) {
    return say(
      lang,
      `El teléfono es el ${publicPhone()} y el correo ${publicEmail()}.`,
      `The phone number is ${publicPhone()} and the email is ${publicEmail()}.`
    );
  }
  if (/foto|fotos|photos?|pictures?/.test(norm)) {
    return say(
      lang,
      'Hay fotos de la casa en https://www.donfadrique.com/. Si escribes *ver fotos*, te mando algunas por aquí.',
      'Photos of the house are on https://www.donfadrique.com/. If you write *ver fotos*, I can send a few here as well.'
    );
  }
  if (
    /menu|carta|tapas|horno|parrilla|postre|iberico|morucha|masa madre|sourdough|what do you serve|group lunch|comida de grupo|que se come|platos/.test(
      norm
    )
  ) {
    return `${menuBlurb(lang)}\n\n${proposalLine(lang)}`;
  }
  return null;
}

function isUnknown(norm) {
  const t = fold(norm).replace(/[.!?…]+$/g, '').trim();
  return /^(no lo se( todavia)?|aun no( lo se)?|todavia no|por concretar|sin fecha|fecha abierta|not sure( yet)?|dont know( yet)?|do not know( yet)?|tbd|unsure|no sabemos( aun)?|todavia sin cerrar|aun no esta cerrado)$/.test(
    t
  );
}

function cleanField(value) {
  return String(value ?? '')
    .replace(/\|/g, '/')
    .replace(/\s+/g, ' ')
    .trim();
}

function parsePerson(raw) {
  const text = cleanField(raw);
  if (text.length < 2 || text.length > 120) return null;
  if (!/[a-záéíóúñ]/i.test(text)) return null;
  return text;
}

function parseEmail(raw) {
  const match = String(raw || '').match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  if (match) return match[0];
  const norm = fold(raw);
  if (/sin correo|sin email|no tengo correo|no tengo email|no email|without an email|without email|whatsapp only|only whatsapp|no mail/.test(norm)) {
    return '';
  }
  return null;
}

function parseCountry(raw) {
  const text = cleanField(raw);
  const norm = fold(text);
  if (norm.length < 2 || norm.length > 60) return null;
  if (/^\d+$/.test(norm)) return null;
  if (!/[a-záéíóúñ]/i.test(text)) return null;
  return text;
}

function unambiguousIso(raw) {
  const norm = fold(raw);
  let match = norm.match(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/);
  if (match) {
    const dt = DateTime.fromObject({ year: +match[1], month: +match[2], day: +match[3] });
    return dt.isValid ? dt.toFormat('yyyy-MM-dd') : null;
  }
  match = norm.match(/\b(\d{1,2})[/.](\d{1,2})[/.](\d{4})\b/);
  if (!match) return null;
  const a = +match[1];
  const b = +match[2];
  const year = +match[3];
  let day;
  let month;
  if (a > 12 && b <= 12) {
    day = a;
    month = b;
  } else if (b > 12 && a <= 12) {
    month = a;
    day = b;
  } else {
    return null;
  }
  const dt = DateTime.fromObject({ year, month, day });
  if (!dt.isValid || dt.day !== day || dt.month !== month) return null;
  return dt.toFormat('yyyy-MM-dd');
}

function parseWhen(raw, zone) {
  const text = cleanField(raw).slice(0, 160);
  const norm = fold(text);
  if (!text) return { error: 'invalid' };
  if (isUnknown(norm)) return { date: 'por concretar', dateLabel: 'por concretar' };
  const iso = unambiguousIso(text);
  if (!iso) return { date: text, dateLabel: text };
  const dt = DateTime.fromISO(iso, { zone }).startOf('day');
  const now = DateTime.now().setZone(zone).startOf('day');
  if (!dt.isValid) return { date: text, dateLabel: text };
  if (dt < now) return { error: 'past' };
  if (dt > now.plus({ years: 3 }).endOf('year')) return { error: 'far' };
  return { date: iso, dateLabel: text };
}

function parsePax(raw) {
  const text = cleanField(raw).slice(0, 80);
  if (isUnknown(fold(text))) return { unknown: true };
  const match = text.match(/\d{1,4}/);
  if (!match) return null;
  const value = parseInt(match[0], 10);
  if (!value) return null;
  return { value, label: text };
}

function parseGroups(raw) {
  const text = cleanField(raw).slice(0, 160);
  if (!text) return null;
  if (isUnknown(fold(text))) return 'por concretar';
  if (!/[a-z0-9áéíóúñ]/i.test(text)) return null;
  return text;
}

function parseGroupLang(raw) {
  const text = cleanField(raw).slice(0, 80);
  if (text.length < 2 || !/[a-záéíóúñ]/i.test(text)) return null;
  return text;
}

function parseDiet(raw) {
  const text = cleanField(raw).slice(0, 300);
  const norm = fold(text);
  if (!norm) return null;
  if (/^(no|none|ninguna|ninguno|nada|n\/a|na|sin|no allergies|sin alergias|no dietary requirements|ninguna alergia)$/.test(norm)) {
    return 'ninguna';
  }
  if (norm.length < 2) return null;
  return text;
}

function parseService(raw, buttonId) {
  if (buttonId === 'top_lunch') return { meal: 'comida', stay: null };
  if (buttonId === 'top_dinner') return { meal: 'cena', stay: null };
  if (buttonId === 'top_stay') return { meal: null, stay: 'solo' };
  const norm = fold(raw);
  if (!norm) return null;
  const both = /\bboth\b|\bambos\b|\blas dos cosas\b|\bmeal and (?:a )?(?:room|hotel|stay|overnight)\b/.test(norm);
  const lunch = /\blunch(?:es)?\b|\balmuerzo\b|\bcomida\b|\bmediodia\b/.test(norm) && !/\b(no|sin|without) (?:the )?(?:lunch|almuerzo|comida)\b/.test(norm);
  const dinner = /\bdinner\b|\bcena\b|\bcenar\b/.test(norm) && !/\b(no|sin|without) (?:the )?(?:dinner|cena)\b/.test(norm);
  const overnight = /\bovernight\b|\bstay\b|\brooms?\b|\bhotel\b|\balojamiento\b|\bhabitaciones?\b|\bdormir\b|\bpernoct/.test(norm);
  if ((both || (lunch && overnight)) && lunch && !dinner) return { meal: 'comida', stay: 'sí' };
  if ((both || (dinner && overnight)) && dinner && !lunch) return { meal: 'cena', stay: 'sí' };
  if (lunch && dinner && overnight) return { meal: 'comida y cena', stay: 'sí' };
  if (both && lunch && dinner) return { meal: 'comida y cena', stay: 'sí' };
  if (both) return { meal: null, stay: 'sí' };
  if (overnight && !lunch && !dinner) return { meal: null, stay: 'solo' };
  if (lunch && dinner) return { meal: 'comida y cena', stay: null };
  if (lunch) return { meal: 'comida', stay: null };
  if (dinner) return { meal: 'cena', stay: null };
  return null;
}

function parseStay(raw, buttonId) {
  if (buttonId === 'top_also') return 'sí';
  if (buttonId === 'top_mealonly') return 'no';
  if (buttonId === 'top_unsure') return 'aún no';
  const norm = fold(raw);
  if (!norm) return null;
  if (/not sure|aun no|no lo se|todavia no|dont know|do not know|por concretar|unsure/.test(norm)) return 'aún no';
  if (
    /meal only|solo (?:la )?(?:comida|cena)|sin hotel|without (?:a )?room|without overnight|no overnight|no hotel|no hace falta/.test(
      norm
    ) ||
    /^no\b/.test(norm)
  ) {
    return 'no';
  }
  if (/also overnight|tambien|with rooms|and hotel|y hotel|^si\b|\byes\b|\bsi\b/.test(norm)) return 'sí';
  return null;
}

function parseCoach(raw, buttonId) {
  if (buttonId === 'top_coach_yes') return 'sí';
  if (buttonId === 'top_coach_no') return 'no';
  if (buttonId === 'top_coach_ns') return 'aún no';
  const norm = fold(raw);
  if (!norm) return null;
  if (/not sure|aun no|no lo se|todavia no|dont know|do not know|por concretar|unsure/.test(norm)) return 'aún no';
  if (
    /not by coach|no coach|without (?:a )?coach|sin autocar|sin autobus|en coche|by car|self drive|self-drive|coche propio|^no\b|\bno lleg/.test(
      norm
    )
  ) {
    return 'no';
  }
  if (/^si\b|\byes\b|en autocar|by coach|autocar|autobus|motorcoach|\bcoach\b|\bbus\b/.test(norm)) return 'sí';
  return null;
}

function serviceLabel(data) {
  if (data.stay === 'solo') return 'alojamiento';
  const meal = data.meal || 'servicio por concretar';
  if (data.stay === 'sí') {
    if (meal === 'comida y cena') return 'comida y cena y hotel';
    return `${meal} y hotel`;
  }
  if (data.stay === 'aún no') return `${meal}; alojamiento por concretar`;
  return meal;
}

function servicePublic(data, lang) {
  const label = serviceLabel(data);
  if (lang !== 'en') return label;
  const map = {
    comida: 'lunch',
    cena: 'dinner',
    'comida y cena': 'lunch and dinner',
    alojamiento: 'overnight stay',
    'comida y hotel': 'lunch and an overnight stay',
    'cena y hotel': 'dinner and an overnight stay',
    'comida y cena y hotel': 'lunch, dinner and an overnight stay',
  };
  if (map[label]) return map[label];
  if (label.endsWith('; alojamiento por concretar')) {
    const meal = label.replace('; alojamiento por concretar', '');
    return `${map[meal] || meal}; overnight stay still open`;
  }
  return label;
}

function dietPublic(data, lang) {
  if (data.diet === 'ninguna') return say(lang, 'ninguna', 'none');
  return data.diet;
}

function coachPublic(data, lang) {
  if (data.coach === 'sí') return say(lang, 'sí', 'yes, by coach');
  if (data.coach === 'no') return say(lang, 'no', 'no');
  return say(lang, 'aún no', 'not sure yet');
}

function chatLangLabel(lang) {
  return lang === 'en' ? 'inglés' : 'español';
}

function prompts(data) {
  const lang = data.lang === 'en' ? 'en' : 'es';
  switch (data.stage) {
    case 'company':
      return [text(say(lang, '¿Cómo se llama la empresa o la agencia?', 'What is the company or agency name?'))];
    case 'contact':
      return [text(say(lang, '¿Cómo te llamas? Con el nombre basta.', 'Who should we write to? A first name is enough.'))];
    case 'email':
      return [
        text(
          say(
            lang,
            '¿A qué email enviamos la propuesta? Si no tienes, escribe *sin email*.',
            'Which email should we use for the proposal? If you do not have one, write *no email*.'
          )
        ),
      ];
    case 'country':
      return [text(say(lang, '¿De qué país escribís?', 'Which country are you writing from?'))];
    case 'dates':
      return [
        text(
          say(
            lang,
            '¿Qué fechas o temporada tenéis en mente? Vale 2027, una estación o unos días. Si aún no está cerrado, escribid *aún no lo sé*.',
            'Which dates or season are you looking at? A year, a season or a few days is fine. If it is still open, write *not sure yet*.'
          )
        ),
      ];
    case 'pax':
      return [
        text(
          say(
            lang,
            '¿Cuántos pasajeros trae cada grupo, aproximadamente? Si no está cerrado, dame una cifra aproximada.',
            'About how many passengers are in each group? If it is not fixed, an approximate number is fine.'
          )
        ),
      ];
    case 'groups':
      return [
        text(
          say(
            lang,
            '¿Cuántos grupos o salidas serían? Si es uno solo, escribid 1. Si aún no lo sabéis, *aún no lo sé*.',
            'How many groups or departures would that be? If it is just one, write 1. If you do not know yet, write *not sure yet*.'
          )
        ),
      ];
    case 'language':
      return [text(say(lang, '¿En qué idioma viene el grupo?', 'What language does the group speak?'))];
    case 'service':
      return [
        buttons(
          say(
            lang,
            '¿Qué necesitáis: comida, cena o alojamiento? Si queréis comida y hotel, escribid *ambos* y decid si la comida es al mediodía o por la noche.',
            'What do you need: lunch, dinner or an overnight stay? If you want a meal and rooms, write *both* and say whether the meal is lunch or dinner.'
          ),
          SERVICE_BUTTONS[lang]
        ),
      ];
    case 'meal':
      return [
        buttons(
          say(lang, '¿La comida del grupo es al mediodía o por la noche?', 'Is the group meal lunch or dinner?'),
          MEAL_BUTTONS[lang]
        ),
      ];
    case 'stay':
      return [
        buttons(
          say(
            lang,
            '¿El grupo también se queda a dormir? Hay 21 habitaciones dobles. La tarifa va en la propuesta.',
            'Will the group also stay overnight? There are 21 double rooms. The rate is in the proposal.'
          ),
          STAY_BUTTONS[lang]
        ),
      ];
    case 'diet':
      return [
        text(
          say(
            lang,
            '¿Hay alergias o algún menú especial? Si no, escribid *ninguna*.',
            'Any allergies or special diets? If there are none, write *none*.'
          )
        ),
      ];
    case 'coach':
      return [
        buttons(
          say(
            lang,
            '¿El grupo llega en autocar? El acceso del vehículo, si hace falta, se confirma en la propuesta.',
            'Will the group arrive by coach? If it does, vehicle access is confirmed in the proposal.'
          ),
          COACH_BUTTONS[lang]
        ),
      ];
    case 'review':
      return [buttons(reviewBody(data), REVIEW_BUTTONS[lang])];
    default:
      return [text(say(lang, 'Seguimos cuando quieras.', 'We can carry on whenever you are ready.'))];
  }
}

function reviewBody(data) {
  const lang = data.lang === 'en' ? 'en' : 'es';
  const people = data.paxLabel || data.partySize;
  if (lang === 'en') {
    return (
      `*Tour operator / group request*\n` +
      `If you send this, the team prepares a tailored 2027 proposal, with the menu and the conditions. The date is not held.\n\n` +
      `🏢 ${data.company}\n` +
      `🙋 ${data.contactName}\n` +
      `✉️ ${data.email || 'no email'}\n` +
      `🌍 ${data.country}\n` +
      `📅 ${data.dateLabel}\n` +
      `👥 ${people} passengers per group\n` +
      `🚌 ${data.groups}\n` +
      `🗣️ ${data.groupLang}\n` +
      `🍽️ ${servicePublic(data, 'en')}\n` +
      `🥗 ${dietPublic(data, 'en')}\n` +
      `🚐 Coach: ${coachPublic(data, 'en')}\n\n` +
      `Shall I send it like this?`
    );
  }
  return (
    `*Solicitud de turoperador / grupo*\n` +
    `Si la envías, el equipo prepara una propuesta a medida para 2027, con el menú y las condiciones. La fecha no queda reservada.\n\n` +
    `🏢 ${data.company}\n` +
    `🙋 ${data.contactName}\n` +
    `✉️ ${data.email || 'sin email'}\n` +
    `🌍 ${data.country}\n` +
    `📅 ${data.dateLabel}\n` +
    `👥 ${people} pasajeros por grupo\n` +
    `🚌 ${data.groups}\n` +
    `🗣️ ${data.groupLang}\n` +
    `🍽️ ${servicePublic(data, 'es')}\n` +
    `🥗 ${dietPublic(data, 'es')}\n` +
    `🚐 Autocar: ${coachPublic(data, 'es')}\n\n` +
    `¿La envío así?`
  );
}

function thanksBody(data, business) {
  const lang = data.lang === 'en' ? 'en' : 'es';
  const name = (business && business.name) || 'Hostería Don Fadrique';
  const people = data.paxLabel || data.partySize;
  if (lang === 'en') {
    return (
      `Thank you, ${data.contactName}. I’ve logged request no. {{id}} for *${data.company}*.\n\n` +
      `📅 ${data.dateLabel}\n` +
      `👥 ${people} passengers per group · ${data.groups}\n` +
      `🍽️ ${servicePublic(data, 'en')}\n\n` +
      `This stays *pending*. The team at ${name} will send a tailored 2027 proposal, with the menu and the conditions. Nothing is held until then.\n\n` +
      `${contactLines()}`
    );
  }
  return (
    `Gracias, ${data.contactName}. He anotado la solicitud nº {{id}} de *${data.company}*.\n\n` +
    `📅 ${data.dateLabel}\n` +
    `👥 ${people} pasajeros por grupo · ${data.groups}\n` +
    `🍽️ ${servicePublic(data, 'es')}\n\n` +
    `Queda *pendiente de propuesta*. El equipo de ${name} enviará una propuesta a medida para 2027, con el menú y las condiciones. La fecha no queda reservada hasta entonces.\n\n` +
    `${contactLines()}`
  );
}

function detailParts(data, from) {
  return [
    `Empresa: ${cleanField(data.company)}`,
    `Contacto: ${cleanField(data.contactName)}`,
    `Email: ${data.email || '—'}`,
    `País: ${cleanField(data.country)}`,
    `Fechas: ${cleanField(data.dateLabel)}`,
    `Pasajeros por grupo: ${cleanField(data.paxLabel || data.partySize)}`,
    `Grupos/salidas: ${cleanField(data.groups)}`,
    `Idioma del grupo: ${cleanField(data.groupLang)}`,
    `Idioma del chat: ${chatLangLabel(data.lang)}`,
    `Servicio: ${serviceLabel(data)}`,
    `Dietas: ${cleanField(data.diet)}`,
    `Llegada en autocar: ${data.coach}`,
    `WhatsApp: ${from}`,
    'Estado: pendiente de propuesta 2027',
  ];
}

function adminText(data, from) {
  return [`🚌 Turoperador / grupo — solicitud pendiente de propuesta #{{id}}`, ...detailParts(data, from)].join('\n');
}

function reservationFor(data, from) {
  const email = data.email || '';
  return {
    record: {
      phone: from,
      name: data.contactName,
      partySize: data.partySize,
      date: data.date,
      time: serviceLabel(data),
      type: TYPE,
      status: 'pending',
      details: detailParts(data, from).join(' | '),
    },
    adminText: adminText(data, from),
    alertSummary: ['Turoperador / grupo', data.company, data.dateLabel, `${data.partySize} pax`, email || 'sin email', '#{{id}}']
      .filter(Boolean)
      .join(' · '),
    company: data.company,
    phoneContact: null,
    source: 'turoperador',
  };
}

function stay(data, replies) {
  return { data, replies };
}

function fail(data, message) {
  return stay(data, [text(message), ...prompts(data)]);
}

function aside(data, raw) {
  if (!shouldAnswerAside(raw)) return null;
  const answer =
    answerFact(raw, data.lang) ||
    say(
      data.lang,
      'Puedo contarte la casa, la comida de grupo y cómo llegar. El precio y las condiciones van en la propuesta de 2027.',
      'I can tell you about the house, the group lunch and how to get here. Prices and conditions are in the 2027 proposal.'
    );
  return stay(data, [text(answer), ...prompts(data)]);
}

function nextAfterService(data) {
  if (data.stay == null && data.meal) return { ...data, stage: 'stay' };
  if (data.meal == null && data.stay === 'sí') return { ...data, stage: 'meal' };
  return { ...data, stage: 'diet' };
}

function wantsSend(raw, buttonId) {
  if (buttonId === 'top_send') return true;
  const norm = fold(raw);
  if (['si', 'vale', 'ok', 'okay', 'enviar', 'envialo', 'enviadlo', 'adelante', 'send', 'yes', 'confirm', 'confirmed'].includes(norm)) {
    return true;
  }
  return /^(send|enviar|yes please|de acuerdo|go ahead|looks good|si enviadlo|si envialo)\b/.test(norm);
}

function wantsFix(raw, buttonId) {
  if (buttonId === 'top_fix') return true;
  return /corregir|repetir|cambiar|start again|change details|start over/.test(fold(raw));
}

function start(business, options = {}) {
  const lang = options.lang || detectLang(options.text || '', 'es');
  const data = { flow: 'turoperador', stage: 'company', lang };
  return { data, replies: [text(intro(lang, business)), ...prompts(data)] };
}

function handle(ctx) {
  const business = ctx.business || {};
  const zone = ctx.zone || business.timezone || 'Europe/Madrid';
  const from = ctx.from;
  const raw = ctx.text || '';
  const buttonId = ctx.buttonId || null;
  const data = { ...(ctx.data || {}) };
  data.flow = 'turoperador';
  data.lang = detectLang(raw, data.lang || 'es');

  if (!data.stage) return start(business, { text: raw, lang: data.lang });

  if (wantsFix(raw, buttonId) && (data.stage === 'review' || buttonId === 'top_fix')) {
    const fresh = { flow: 'turoperador', stage: 'company', lang: data.lang };
    return stay(fresh, [
      text(say(data.lang, 'De acuerdo, lo repetimos.', 'No problem. Let’s take it again.')),
      ...prompts(fresh),
    ]);
  }

  if (!buttonId) {
    const side = aside(data, raw);
    if (side) return side;
  }

  if (data.stage === 'company') {
    const company = parsePerson(raw);
    if (!company) {
      return fail(data, say(data.lang, 'Necesito el nombre de la empresa, aunque sea breve.', 'I need the company or agency name, even if it is short.'));
    }
    return stay({ ...data, company, stage: 'contact' }, prompts({ ...data, stage: 'contact' }));
  }

  if (data.stage === 'contact') {
    const contactName = parsePerson(raw);
    if (!contactName) {
      return fail(data, say(data.lang, 'Dime un nombre con el que pueda dirigirme a ti.', 'Tell me a name to write to.'));
    }
    return {
      data: { ...data, contactName, stage: 'email' },
      customerName: contactName,
      replies: prompts({ ...data, stage: 'email' }),
    };
  }

  if (data.stage === 'email') {
    const email = parseEmail(raw);
    if (email == null) {
      return fail(
        data,
        say(
          data.lang,
          'No he visto un email. Escríbelo, por ejemplo ana@agencia.com, o *sin email*.',
          'I couldn’t see an email. Write it, for example ana@agency.com, or *no email*.'
        )
      );
    }
    return stay({ ...data, email, stage: 'country' }, prompts({ ...data, stage: 'country' }));
  }

  if (data.stage === 'country') {
    const country = parseCountry(raw);
    if (!country) return fail(data, say(data.lang, '¿De qué país escribís?', 'Which country are you writing from?'));
    return stay({ ...data, country, stage: 'dates' }, prompts({ ...data, stage: 'dates' }));
  }

  if (data.stage === 'dates') {
    const when = parseWhen(raw, zone);
    if (when.error === 'past') {
      return fail(
        data,
        say(data.lang, 'Esa fecha ya pasó. Dime otra, o una temporada.', 'That date has already passed. Give me another one, or a season.')
      );
    }
    if (when.error === 'far') {
      return fail(
        data,
        say(
          data.lang,
          'Esa fecha queda a más de tres años. Dime una temporada más cercana.',
          'That date is more than three years away. Give me a closer season.'
        )
      );
    }
    if (when.error) {
      return fail(data, say(data.lang, 'No he entendido las fechas. Prueba con primavera de 2027, o con 15/05/2027.', 'I didn’t catch the dates. Try spring 2027, or 15/05/2027.'));
    }
    return stay({ ...data, date: when.date, dateLabel: when.dateLabel, stage: 'pax' }, prompts({ ...data, stage: 'pax' }));
  }

  if (data.stage === 'pax') {
    const parsed = parsePax(raw);
    if (!parsed || parsed.unknown) {
      return fail(
        data,
        say(data.lang, 'Dime un número aproximado de pasajeros por grupo, por ejemplo 40.', 'Give me an approximate number of passengers per group, for example 40.')
      );
    }
    if (parsed.value > conocimiento.MAX_AFORO) {
      return fail(
        data,
        say(
          data.lang,
          `Los espacios, juntos, admiten ${conocimiento.CAPACIDAD_TOTAL}. ¿Cuántos pasajeros vienen en cada grupo?`,
          'Together the spaces hold 500 to 700 people. How many passengers are in each group?'
        )
      );
    }
    return stay(
      { ...data, partySize: parsed.value, paxLabel: parsed.label, stage: 'groups' },
      prompts({ ...data, stage: 'groups' })
    );
  }

  if (data.stage === 'groups') {
    const groups = parseGroups(raw);
    if (!groups) {
      return fail(
        data,
        say(data.lang, 'Dime cuántos grupos o salidas, aunque sea aproximado.', 'Tell me how many groups or departures, even roughly.')
      );
    }
    return stay({ ...data, groups, stage: 'language' }, prompts({ ...data, stage: 'language' }));
  }

  if (data.stage === 'language') {
    const groupLang = parseGroupLang(raw);
    if (!groupLang) return fail(data, say(data.lang, '¿En qué idioma viene el grupo?', 'What language does the group speak?'));
    return stay({ ...data, groupLang, stage: 'service' }, prompts({ ...data, stage: 'service' }));
  }

  if (data.stage === 'service' || data.stage === 'meal') {
    const parsed = parseService(raw, buttonId);
    if (!parsed) {
      return fail(
        data,
        say(data.lang, 'Elige comida, cena, alojamiento, o escribe *ambos*.', 'Choose lunch, dinner or overnight, or write *both*.')
      );
    }
    const next = nextAfterService({
      ...data,
      meal: parsed.meal != null ? parsed.meal : data.meal,
      stay: parsed.stay != null ? parsed.stay : data.stay,
    });
    if (data.stage === 'meal' && parsed.stay === 'solo') {
      return fail(data, say(data.lang, '¿La comida es al mediodía o por la noche?', 'Is the meal lunch or dinner?'));
    }
    if (data.stage === 'meal' && !parsed.meal) {
      return fail(data, say(data.lang, '¿La comida es al mediodía o por la noche?', 'Is the meal lunch or dinner?'));
    }
    return stay(next, prompts(next));
  }

  if (data.stage === 'stay') {
    const stayChoice = parseStay(raw, buttonId);
    if (!stayChoice) {
      return fail(data, say(data.lang, '¿Se quedan a dormir, solo comen, o aún no lo sabéis?', 'Will they stay overnight, is it the meal only, or are you not sure yet?'));
    }
    const next = { ...data, stay: stayChoice, stage: 'diet' };
    return stay(next, prompts(next));
  }

  if (data.stage === 'diet') {
    const diet = parseDiet(raw);
    if (!diet) return fail(data, say(data.lang, 'Cuéntame las dietas, o escribe *ninguna*.', 'Tell me the dietary needs, or write *none*.'));
    return stay({ ...data, diet, stage: 'coach' }, prompts({ ...data, stage: 'coach' }));
  }

  if (data.stage === 'coach') {
    const coach = parseCoach(raw, buttonId);
    if (!coach) {
      return fail(data, say(data.lang, '¿Llegan en autocar? Puedes decir sí, no, o aún no lo sé.', 'Will they arrive by coach? You can say yes, no, or not sure yet.'));
    }
    const next = { ...data, coach, stage: 'review' };
    return stay(next, prompts(next));
  }

  if (data.stage === 'review') {
    if (wantsSend(raw, buttonId)) {
      return {
        data,
        clear: true,
        replies: [text(thanksBody(data, business))],
        reservation: reservationFor(data, from),
      };
    }
    return stay(data, [
      text(
        say(
          data.lang,
          'Pulsa *Enviar solicitud* si está bien, o *Corregir datos* para repetirlos.',
          'Tap *Send request* if this is right, or *Change details* to start again.'
        )
      ),
      ...prompts(data),
    ]);
  }

  return start(business, { text: raw, lang: data.lang });
}

module.exports = {
  TRIGGER_ES,
  TRIGGER_EN,
  TYPE,
  isTourButton,
  isTourOperatorTopic,
  isInquiry,
  detectLang,
  answerFact,
  start,
  handle,
  serviceLabel,
};

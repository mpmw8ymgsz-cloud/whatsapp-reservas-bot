// Galería de catering para congresos. Las fotos viven en public/galeria/catering
// y se sirven en /galeria/catering/<file>.jpg. El chat manda las fotos de galeria.json.

const { normalize } = require('./dateParser');
const fotos = require('./fotos');

const gallery = require('../public/galeria/catering/galeria.json');

const HIGHLIGHTS = [
  '01_mesas_y_coctel.jpg',
  '05_buffet_invitados.jpg',
  '06_comensales.jpg',
  '07_mesas_altas.jpg',
];

const WELCOME_ES =
  'Gracias por tu interés en el catering de congresos. Aquí tienes algunas fotos de mesas, cóctel y comensales. Llevamos más de 20 años haciéndolo, en la sede que elijáis o en nuestra hostería.';

const WELCOME_EN =
  'Thank you for your interest in our congress catering. Here are a few photos of tables, cocktails and guests. We have been doing this for more than 20 years, at the venue you choose or at our hotel.';

const ASK_ES =
  '¿Qué tipo de evento estáis preparando? Congreso, jornada, coffee break, cóctel, comida o cena.\n\nEn la hostería, la terraza acristalada es para 10 a 50, los jardines valen para cócteles y cenas, y entre todos los salones caben de 500 a 700 personas.';

const ASK_EN =
  'What kind of event are you planning? A congress, a meeting, a coffee break, a cocktail, lunch or dinner.\n\nAt the hotel, the glazed terrace is for 10 to 50, the gardens work for cocktails and dinners, and together the rooms hold 500 to 700 people.';

const MORE_ES = 'Estas son el resto de las fotos. Si quieres, preparamos el presupuesto.';
const MORE_EN = 'Here are the rest of the photos. We can prepare a quote whenever you want.';

const ENTRY_BUTTONS_ES = [
  { id: 'gal_more', title: 'Ver más fotos' },
  { id: 'gal_quote', title: 'Pedir presupuesto' },
];

const ENTRY_BUTTONS_EN = [
  { id: 'gal_more', title: 'More photos' },
  { id: 'gal_quote', title: 'Request a quote' },
];

const QUOTE_BUTTON_ES = [{ id: 'gal_quote', title: 'Pedir presupuesto' }];
const QUOTE_BUTTON_EN = [{ id: 'gal_quote', title: 'Request a quote' }];

function intro(lang) {
  return lang === 'en' ? WELCOME_EN : WELCOME_ES;
}

function ask(lang) {
  return lang === 'en' ? ASK_EN : ASK_ES;
}

function offer(lang) {
  const en = lang === 'en';
  return { body: ask(lang), buttons: en ? ENTRY_BUTTONS_EN : ENTRY_BUTTONS_ES };
}

function moreOffer(lang) {
  const en = lang === 'en';
  return { body: en ? MORE_EN : MORE_ES, buttons: en ? QUOTE_BUTTON_EN : QUOTE_BUTTON_ES };
}

function declined(lang) {
  return lang === 'en'
    ? 'All right. When you want a quote, write congress.'
    : 'De acuerdo. Cuando queráis el presupuesto, escribid congreso.';
}

function asPhoto(photo) {
  return {
    kind: 'image',
    file: photo.file,
    folder: 'galeria/catering',
    caption: photo.caption,
    link: fotos.publicUrl(photo.file, 'galeria/catering'),
  };
}

function photos() {
  return (gallery.fotos || []).map(asPhoto);
}

function highlights() {
  const byFile = new Map(photos().map((photo) => [photo.file, photo]));
  return HIGHLIGHTS.map((file) => byFile.get(file)).filter(Boolean);
}

function remaining() {
  const shown = new Set(HIGHLIGHTS);
  return photos().filter((photo) => !shown.has(photo.file));
}

function answer(norm, lang) {
  if (!norm) return '';
  const en = lang === 'en';
  if (/precio|cuanto|how much|tarifa|cuesta|what does it cost/.test(norm)) {
    return en
      ? 'The team prepares a tailored quote. I can’t give a price from here.'
      : 'El equipo prepara un presupuesto a medida. Por aquí no cierro precios.';
  }
  if (/terraza|jardin|salon|aforo|capacidad|cabe|cuanta gente|how many|space/.test(norm)) {
    return en
      ? 'At the hotel, the glazed terrace is for 10 to 50, the gardens work for cocktails and dinners, and together the rooms hold 500 to 700 people. We also cater at the venue you choose.'
      : 'En la hostería, la terraza acristalada es para 10 a 50, los jardines valen para cócteles y cenas, y entre todos los salones caben de 500 a 700 personas. También vamos a la sede que elijáis.';
  }
  if (/otro sitio|otro espacio|otro lugar|fuera|catering|sede|coffee|coctel|cocktail/.test(norm)) {
    return en
      ? 'Yes. Coffee, lunch, a cocktail or dinner, at the congress venue or any other place you choose, or here. The price is in the tailored quote.'
      : 'Sí. Café, comida, cóctel o cena, en la sede del congreso o en otro sitio, o aquí en la hostería. El precio va en el presupuesto a medida.';
  }
  return '';
}

function delayMs() {
  const raw = process.env.GALERIA_PHOTO_DELAY_MS;
  if (raw != null && String(raw).trim() !== '') {
    const n = Number(raw);
    if (Number.isFinite(n) && n >= 0) return Math.min(n, 5000);
  }
  return 400;
}

function waitTurn(index) {
  if (!index || index < 1) return Promise.resolve();
  const ms = delayMs();
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRequest(norm) {
  if (!norm) return false;
  const seeing = /\b(?:galeria|fotos?|imagen(?:es)?|photos?|pictures?|gallery)\b/.test(norm);
  const subject = /\bcaterin(?:g|es)?\b|\bcater\b/.test(norm);
  return seeing && subject;
}

function requestLang(raw, fallback = 'es') {
  const norm = normalize(raw || '');
  const en = /\b(?:photos?|pictures?|gallery|please|show)\b/.test(norm);
  const es = /\b(?:fotos?|galeria|imagen(?:es)?|quiero)\b/.test(norm);
  if (en && !es) return 'en';
  if (es) return 'es';
  return fallback === 'en' ? 'en' : 'es';
}

function wantsMore(norm, buttonId) {
  if (buttonId === 'gal_more') return true;
  return /\b(?:ver mas fotos|mas fotos|more photos|see more)\b/.test(norm || '');
}

function wantsQuote(norm, buttonId) {
  if (buttonId === 'gal_quote' || buttonId === 'gal_si') return true;
  if (!norm || declines(norm, buttonId) || wantsMore(norm, buttonId)) return false;
  return /^(?:si|yes|vale|ok|claro|pedir presupuesto|presupuesto|quiero (?:un )?presupuesto|request a quote|get a quote)\b/.test(norm);
}

function declines(norm, buttonId) {
  if (buttonId === 'gal_no') return true;
  return /^(?:no|ahora no|luego|not now|no thanks)\b/.test(norm || '');
}

module.exports = {
  WELCOME_ES,
  ASK_ES,
  intro,
  ask,
  offer,
  moreOffer,
  declined,
  photos,
  highlights,
  remaining,
  answer,
  delayMs,
  waitTurn,
  isRequest,
  requestLang,
  wantsMore,
  wantsQuote,
  declines,
};

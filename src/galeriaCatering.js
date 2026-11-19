// Galería de catering para congresos. Las fotos viven en public/galeria/catering
// y se sirven en /galeria/catering/<file>.jpg. El chat manda las fotos de galeria.json.

const { normalize } = require('./dateParser');
const fotos = require('./fotos');

const gallery = require('../public/galeria/catering/galeria.json');

const INTRO_ES =
  'Aquí tienes algunas fotos de nuestros caterings para congresos y eventos. Llevamos más de 20 años ofreciendo catering en la sede que elijáis o en nuestra hostería.';

const INTRO_EN =
  'Here are some photos of our catering for congresses and events. We have been offering catering for more than 20 years, at the venue you choose or at our hotel.';

const QUOTE_ES =
  '¿Quieres que te preparemos un presupuesto? Dime la fecha, el número de personas, el lugar (sede del congreso u otro espacio, o nuestra hostería) y el tipo de servicio (café, comida, cóctel o cena).';

const QUOTE_EN =
  'Shall we prepare a quote? Tell me the date, the number of people, the place (the congress venue, another space, or our hotel) and the service (coffee, lunch, cocktail or dinner).';

const BUTTONS_ES = [
  { id: 'gal_si', title: 'Sí' },
  { id: 'gal_no', title: 'Ahora no' },
];

const BUTTONS_EN = [
  { id: 'gal_si', title: 'Yes' },
  { id: 'gal_no', title: 'Not now' },
];

function intro(lang) {
  return lang === 'en' ? INTRO_EN : INTRO_ES;
}

function offer(lang) {
  const en = lang === 'en';
  return { body: en ? QUOTE_EN : QUOTE_ES, buttons: en ? BUTTONS_EN : BUTTONS_ES };
}

function declined(lang) {
  return lang === 'en'
    ? 'All right. When you want a quote, write congress.'
    : 'De acuerdo. Cuando queráis el presupuesto, escribid congreso.';
}

function photos() {
  return (gallery.fotos || []).map((photo) => ({
    kind: 'image',
    file: photo.file,
    folder: 'galeria/catering',
    caption: photo.caption,
    link: fotos.publicUrl(photo.file, 'galeria/catering'),
  }));
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

function wantsQuote(norm, buttonId) {
  if (buttonId === 'gal_si') return true;
  if (!norm || declines(norm, buttonId)) return false;
  return /^(?:si|yes|vale|ok|claro)\b/.test(norm);
}

function declines(norm, buttonId) {
  if (buttonId === 'gal_no') return true;
  return /^(?:no|ahora no|luego|not now|no thanks)\b/.test(norm || '');
}

module.exports = {
  INTRO_ES,
  QUOTE_ES,
  intro,
  offer,
  declined,
  photos,
  delayMs,
  waitTurn,
  isRequest,
  requestLang,
  wantsQuote,
  declines,
};

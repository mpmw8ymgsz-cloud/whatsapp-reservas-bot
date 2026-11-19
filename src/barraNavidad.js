// Carta «Navidad 2026 · La Barra · Don Fadrique».
// Precios de tapas y de copa: solo los que figuran en la carta.
// No hay horario ni fechas de apertura en la carta: no se inventan.

const { normalize } = require('./dateParser');
const { detectLang } = require('./turoperadores');
const config = require('./config');

const PDF_PATH = '/carta_barra_navidad_2026.pdf';
const PDF_FILENAME = 'Carta Barra Navidad 2026 - Don Fadrique.pdf';

// Transcripción de public/carta_barra_navidad_2026.pdf. Solo el precio de copa.
const PARA_PICAR = [
  { name: 'Trucha Ahumada al Corte con Salsa Tártara y Tosta de Pan', price: '7,50 €' },
  { name: 'Nuestra Gilda', price: '5,50 €' },
  { name: 'Anchoas López (2 ud) con Pan Tostado y Tomate', price: '8,00 €' },
  { name: 'Paté Casero con Tostada de Pan y Gelatina de Vermut', price: '8,50 €' },
  { name: 'Croquetas de Jamón (ud)', price: '2,00 €' },
  { name: 'Albóndigas de Jabalí', price: '8,00 €' },
  { name: 'Albóndigas de Jabalí · Media Ración', price: '4,00 €' },
  { name: 'Caldo del Día', price: '3,00 €' },
  { name: 'Plato de Cuchara del Día', price: 'Consultar' },
];

const BLANCOS_COPA = [
  { name: 'Maxi', price: '5,00 €' },
  { name: 'Alto del Tesoro', price: '6,50 €' },
  { name: 'Díscolo Blanco', price: '4,80 €' },
  { name: "Moscato d'Asti Vigna Senza Nome", price: '6,00 €' },
];

const TINTOS_COPA = [
  { name: 'Cinco de Copas', price: '3,00 €' },
  { name: 'Díscolo Tinto', price: '4,80 €' },
  { name: 'López Cristóbal', price: '3,00 €' },
  { name: 'Martín Lacuesta', price: '4,50 €' },
];

const JEREZ_COPA = [
  { name: 'Fino Tradición', price: '5,00 €' },
  { name: 'Manzanilla San León', price: '6,00 €' },
  { name: 'Jalifa Amontillado 30 Años', price: '9,00 €' },
  { name: 'Palo Cortado Península · Lustau', price: '8,00 €' },
];

const BURBUJAS_COPA = [
  { name: 'Far de les Plèiades · Cava', price: '6,00 €' },
  { name: 'Aula', price: '6,00 €' },
  { name: 'Aula Rosado', price: '6,00 €' },
];

function fold(value) {
  return normalize(value).replace(/['’]/g, '').replace(/\s+/g, ' ').trim();
}

function isIntent(value) {
  const norm = fold(value);
  if (!norm) return false;
  if (/barra libre/.test(norm)) return false;
  if (/\bbarra de navidad\b|\bla barra\b|\bchristmas bar\b|\bbarra navidad\b/.test(norm)) return true;
  if (/\btapas\b|\bpicar\b|\bgilda\b|\bcroquetas?\b|\bcroquettes?\b/.test(norm)) return true;
  if (/vinos? por copa|wine by the glass|wines by the glass|generosos? por copa|jerez por copa|sherry by the glass/.test(norm)) {
    return true;
  }
  if (/\bchampagnes?\b|\bchampan\b|\bcava\b/.test(norm) && !/granizado/.test(norm)) return true;
  if (/\bbarra\b/.test(norm) && /navidad|tapas|vino|picar|christmas/.test(norm)) return true;
  return false;
}

function wantsBooking(value, buttonId) {
  if (buttonId === 'barra_book') return true;
  const norm = fold(value);
  return /\breserv/.test(norm) || /^(si|vale|ok|book|yes)$/.test(norm);
}

function linePrice(item) {
  return `${item.name} · ${item.price}`;
}

function section(title, items) {
  return [title, ...items.map(linePrice), ''];
}

function summary(lang) {
  const en = lang === 'en';
  const lines = [
    en ? '🍷 *Christmas 2026 · La Barra · Don Fadrique*' : '🍷 *Navidad 2026 · La Barra · Don Fadrique*',
    '',
    ...section(en ? '*To nibble*' : '*Para picar*', PARA_PICAR),
    ...section(en ? '*Whites, by the glass*' : '*Blancos, copa*', BLANCOS_COPA),
    ...section(en ? '*Reds, by the glass*' : '*Tintos, copa*', TINTOS_COPA),
    ...section(en ? '*Sherry, by the glass*' : '*Jerez, copa*', JEREZ_COPA),
    ...(en ? ['*Bubbles, by the glass*'] : ['*Burbujas, copa*']),
    ...BURBUJAS_COPA.map(linePrice),
    en
      ? 'Champagne from 65,00 € (Laurent-Perrier La Cuvée) up to 3.300,00 €. The full list is on request.'
      : 'Champagne desde 65,00 € (Laurent-Perrier La Cuvée) hasta 3.300,00 €. La lista completa, si la pides.',
    '',
    'Consulta nuestras carnes a la brasa · Disponemos de nuestra carta general de vinos, solicítela a nuestro equipo.',
    'Precios con IVA incluido.',
    '',
    'Imprescindible reservar.',
  ];
  return lines.join('\n');
}

function offer(lang) {
  return lang === 'en'
    ? 'Shall I book a table for La Barra? I need the day, the time and how many people. I don’t have separate opening hours for the bar.'
    : '¿Reservo mesa en La Barra? Necesito el día, la hora y cuántas personas. No tengo un horario propio de la barra.';
}

function offerButtons(lang) {
  return lang === 'en'
    ? [
        { id: 'barra_book', title: 'Book' },
        { id: 'barra_later', title: 'Not now' },
      ]
    : [
        { id: 'barra_book', title: 'Reservar' },
        { id: 'barra_later', title: 'Ahora no' },
      ];
}

function datePrompt(lang) {
  return lang === 'en'
    ? 'Which day? For example Friday or 15/12. I won’t assume a special calendar for the bar.'
    : '¿Para qué día? Por ejemplo, viernes o 15/12. No doy por hecho un calendario propio de la barra.';
}

function documentLink() {
  const base = String(config.publicBaseUrl || '').replace(/\/$/, '');
  return `${base}${PDF_PATH}`;
}

function replies(raw) {
  const lang = detectLang(raw || '', 'es');
  return {
    lang,
    summary: summary(lang),
    offer: offer(lang),
    buttons: offerButtons(lang),
    document: {
      link: documentLink(),
      filename: PDF_FILENAME,
    },
  };
}

module.exports = {
  PDF_PATH,
  PDF_FILENAME,
  PARA_PICAR,
  BLANCOS_COPA,
  TINTOS_COPA,
  JEREZ_COPA,
  BURBUJAS_COPA,
  isIntent,
  wantsBooking,
  summary,
  offer,
  datePrompt,
  documentLink,
  replies,
};

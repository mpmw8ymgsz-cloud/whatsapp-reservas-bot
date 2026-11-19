// Carta «Navidad 2026 · La Barra · Don Fadrique».
// Precios de tapas y de copa: solo los que figuran en la carta.
// No hay horario ni fechas de apertura en la carta: no se inventan.

const { normalize } = require('./dateParser');
const { detectLang } = require('./turoperadores');
const config = require('./config');

const PDF_PATH = '/carta_barra_navidad_2026.pdf';
const PDF_FILENAME = 'Carta Barra Navidad 2026 - Don Fadrique.pdf';

// Para picar, con el precio de la carta. Vacío si esa lista no está en el repo.
const PARA_PICAR = [];

// Vinos y generosos, precio de la copa. Vacío si esa lista no está en el repo.
const WINES_BY_GLASS = [];

const CAVA_GLASS = '6 €';
const CHAMPAGNE_FROM = '65 €';

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

function summary(lang) {
  const en = lang === 'en';
  const lines = [en ? '🍷 *Christmas 2026 · La Barra · Don Fadrique*' : '🍷 *Navidad 2026 · La Barra · Don Fadrique*', ''];
  if (PARA_PICAR.length) {
    lines.push(en ? '*To nibble*' : '*Para picar*');
    for (const item of PARA_PICAR) lines.push(linePrice(item));
    lines.push('');
  }
  if (WINES_BY_GLASS.length) {
    lines.push(en ? '*Wines and sherries, by the glass*' : '*Vinos y generosos, por copa*');
    for (const item of WINES_BY_GLASS) lines.push(linePrice(item));
    lines.push('');
  }
  lines.push(en ? '*Bubbles*' : '*Burbujas*');
  lines.push(en ? `Cava, glass · ${CAVA_GLASS}` : `Cava, copa · ${CAVA_GLASS}`);
  lines.push(
    en
      ? `There is a champagne selection from ${CHAMPAGNE_FROM}. The full list is available on request.`
      : `Hay una selección de champagne desde ${CHAMPAGNE_FROM}. La lista completa, si la pides.`
  );
  lines.push('');
  lines.push('Precios con IVA incluido.');
  lines.push('Consulta nuestras carnes a la brasa.');
  lines.push('');
  lines.push(en ? 'A booking is essential. Imprescindible reservar.' : 'Imprescindible reservar.');
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
  WINES_BY_GLASS,
  CAVA_GLASS,
  CHAMPAGNE_FROM,
  isIntent,
  wantsBooking,
  summary,
  offer,
  datePrompt,
  documentLink,
  replies,
};

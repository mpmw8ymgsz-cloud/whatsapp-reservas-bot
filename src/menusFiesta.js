// Menús oficiales de las fiestas. La comida de empresa sigue siendo a medida
// (ver menusEmpresa.js): estos tres menús se enseñan cuando los piden, y
// sirven de referencia, no como carta cerrada de grupo.

const { normalize } = require('./dateParser');
const conocimiento = require('./eventosConocimiento');
const fotos = require('./fotos');

const ALLERGY = 'Todos nuestros menús se pueden adaptar a alergias e intolerancias.';

const MENUS = [
  {
    id: 'navidad',
    title: 'Menú Navidad',
    date: '25 de diciembre de 2026',
    isoDate: '2026-12-25',
    price: '65 € por persona',
    file: 'menu-navidad-25dic.jpg',
    pdf: 'menu-navidad-25dic.pdf',
    reserveText: 'Quiero reservar el menú de Navidad (25 de diciembre)',
    caption: 'Menú Navidad · 25 de diciembre de 2026 · 65 € por persona',
    courses: [
      { name: 'Aperitivo', detail: 'jamón y lomo; gamba blanca Don Fadrique; paté de pato y fiambres navideños.' },
      { name: 'Entrante individual', detail: 'alcachofa con pistacho y café.' },
      { name: 'Pescado', detail: 'lomo de lubina con cítricos.' },
      { name: 'Asado', detail: 'cochinillo de Navidad.' },
      { name: 'Postre', detail: 'mazapán carmelita.' },
    ],
  },
  {
    id: 'nochevieja',
    title: 'Menú Nochevieja',
    date: '31 de diciembre de 2026',
    isoDate: '2026-12-31',
    price: '110 € por persona',
    file: 'menu-nochevieja-31dic.jpg',
    pdf: 'menu-nochevieja-31dic.pdf',
    reserveText: 'Quiero reservar el menú de Nochevieja (31 de diciembre)',
    caption: 'Menú Nochevieja · 31 de diciembre de 2026 · 110 € por persona',
    courses: [
      { name: 'Aperitivo', detail: 'jamón, gamba blanca Don Fadrique y anchoa.' },
      { name: 'Aperitivo sentado', detail: 'capuchino de lentejas con perdiz.' },
      { name: 'Entrante', detail: 'sopa tradicional marinera.' },
      { name: 'Pescado', detail: 'lubina o besugo de fin de año, según mercado.' },
      { name: 'Sorbete', detail: 'granizado de champagne.' },
      { name: 'Carne', detail: 'venado de Navidad con ragú de setas.' },
      { name: 'Postre', detail: 'tarta tatin de manzana con helado de mango.' },
      { name: 'A medianoche', detail: 'las 12 uvas de la suerte y churros.' },
    ],
  },
  {
    id: 'anonuevo',
    title: 'Menú Año Nuevo',
    date: '1 de enero de 2027',
    isoDate: '2027-01-01',
    price: '65 € por persona',
    file: 'menu-anonuevo-1ene.jpg',
    pdf: 'menu-anonuevo-1ene.pdf',
    reserveText: 'Quiero reservar el menú de Año Nuevo (1 de enero)',
    caption: 'Menú Año Nuevo · 1 de enero de 2027 · 65 € por persona',
    courses: [
      { name: 'Aperitivo', detail: 'pastrami ibérico, paté navideño, croqueta de jamón.' },
      {
        name: 'Entrantes',
        detail: 'ensalada de rúcula con nueces, granada y stracciatella artesana; consomé de faisán con su albóndiga.',
      },
      { name: 'Pescado del día', detail: 'lubina con ajada.' },
      { name: 'Plato principal', detail: 'cochinillo asado tradicional.' },
      { name: 'Postre', detail: 'chocolate de Navidad.' },
    ],
  },
];

const BY_ID = Object.fromEntries(MENUS.map((menu) => [menu.id, menu]));

const SEEING =
  /\b(?:ver|ensen(?:a(?:me|dme|nos|rme)?)?|muestra(?:me|dme|nos)?|envia(?:me|dme|nos)?|manda(?:me|dme|nos)?)\b/;

function tidy(text) {
  return normalize(text).replace(/\s+/g, ' ').replace(/^[«"“]+|[»"”]+$/g, '').trim();
}

function belongsToAnotherFlow(norm) {
  if (conocimiento.isBodaTopic(norm) || conocimiento.isCongresoTopic(norm)) return true;
  if (/\b(?:habitaciones?|hotel|dormir|alojamiento)\b/.test(norm)) return true;
  if (/\bempresas?\b|\ba medida\b|gran gala|\bmediodia\b|presupuesto/.test(norm)) return true;
  if (/\bcomidas? de navidad\b|\bcenas? de navidad\b/.test(norm)) return true;
  if (/\b(?:detalle|incluye|lleva|platos)\b/.test(norm) && !/\bver\b/.test(norm) && !/\breserv/.test(norm)) return true;
  return false;
}

function holidayHits(norm) {
  const hits = [];
  if (/\bnochevieja\b|\bnoche vieja\b/.test(norm)) hits.push('nochevieja');
  if (/\bano nuevo\b/.test(norm)) hits.push('anonuevo');
  const singularNavidad =
    /\b(?:menu|carta) de navidad\b/.test(norm) || /\b(?:menu|carta) navidad\b/.test(norm);
  if (singularNavidad && !/\bmenus de navidad\b/.test(norm)) hits.push('navidad');
  return hits;
}

function matchRequest(text) {
  const norm = tidy(text);
  if (!norm || norm === 'menu') return null;
  if (belongsToAnotherFlow(norm)) return null;

  const seeing = SEEING.test(norm);
  const plural = /\bmenus\b/.test(norm);
  const hasMenuWord = /\b(?:menu|menus|carta)\b/.test(norm);
  const otherHoliday = /\bnochevieja\b|\bnoche vieja\b|\bano nuevo\b/.test(norm);

  if (seeing && plural) return 'all';
  if (plural && /\bnavidad/.test(norm) && !seeing && !otherHoliday) return null;

  const hits = holidayHits(norm);
  if (hits.length > 1) return 'all';
  if (hits.length === 1) return hits[0];

  if (/\bfin de ano\b/.test(norm) && hasMenuWord) return 'nochevieja';
  if (plural) return 'all';
  if (isGeneralAsk(norm, seeing, hasMenuWord)) return 'all';
  return null;
}

function matchReservation(text) {
  const norm = tidy(text);
  if (!norm || !/\breserv/.test(norm)) return null;
  if (belongsToAnotherFlow(norm)) return null;
  const hits = holidayHits(norm);
  if (hits.length === 1) return hits[0];
  if (/\bfin de ano\b/.test(norm) && /\b(?:menu|menus|carta)\b/.test(norm)) return 'nochevieja';
  return null;
}

function isOfficialMenuTopic(text) {
  const norm = tidy(text);
  if (!norm || /\bempresas?\b/.test(norm)) return false;
  if (matchReservation(norm)) return true;
  return !!matchRequest(norm);
}

function isGeneralAsk(norm, seeing, hasMenuWord) {
  if (/^(?:los |el |la )?(?:menus|carta)$/.test(norm)) return true;
  if (/^ver (?:el |los |la )?(?:menu|menus|carta)$/.test(norm)) return true;
  if (seeing && hasMenuWord) return true;
  if (/\b(?:como es|cual es)\b/.test(norm) && hasMenuWord) return true;
  return false;
}

function menuText(menu) {
  const courses = menu.courses.map((course) => `*${course.name}:* ${course.detail}`);
  return [`🍽️ *${menu.title}*`, menu.date, menu.price, '', ...courses, '', ALLERGY].join('\n');
}

function introText() {
  return (
    '🎄 *Menús de las fiestas*\n\n' +
    'En Hostería Don Fadrique, estos son los menús oficiales de Navidad, Nochevieja y Año Nuevo.'
  );
}

function imageReply(menu) {
  return {
    kind: 'image',
    file: menu.file,
    folder: 'menus',
    caption: menu.caption,
    body: menu.caption,
  };
}

function foodPhotoReply() {
  const photo = fotos.CATALOG.cochinillo;
  return {
    kind: 'image',
    file: photo.file,
    caption: photo.caption,
    body: photo.caption,
    source: photo.source,
  };
}

const FOLLOW_UP_BUTTONS = [
  { id: 'exp_rest', title: 'Reservar' },
  { id: 'emp_book', title: 'Pedir presupuesto' },
];

function followUpReply() {
  return {
    kind: 'buttons',
    body:
      'Si quieres venir, escribe *reservar* y te tomo la mesa.\n' +
      'Si es una comida de empresa, pide presupuesto y lo prepara el equipo.',
    buttons: FOLLOW_UP_BUTTONS,
  };
}

function replies(which, options = {}) {
  const withFollowUp = options.followUp !== false;
  const list = which === 'all' ? MENUS : MENUS.filter((menu) => menu.id === which);
  const out = [];
  if (which === 'all') out.push({ kind: 'text', body: introText() });
  for (const menu of list) {
    out.push({ kind: 'text', body: menuText(menu) });
    out.push(imageReply(menu));
  }
  if (which === 'all') {
    out.push(foodPhotoReply());
    if (withFollowUp) out.push(followUpReply());
  }
  return out;
}

function reservationReplies(which) {
  const menu = BY_ID[which];
  if (!menu) return [];
  return [imageReply(menu), { kind: 'text', body: menuText(menu) }];
}

function publicUrl(file) {
  return fotos.publicUrl(file, 'menus');
}

module.exports = {
  ALLERGY,
  MENUS,
  BY_ID,
  FOLLOW_UP_BUTTONS,
  matchRequest,
  matchReservation,
  isOfficialMenuTopic,
  menuText,
  introText,
  replies,
  reservationReplies,
  publicUrl,
};

// Fotos reales publicadas en https://www.donfadrique.com (wp-content/uploads).
// Las copias viven en public/fotos y se sirven por /fotos para que WhatsApp
// pueda descargarlas. No hay bancos de imágenes.

const DEFAULT_PUBLIC_BASE_URL = 'https://whatsapp-reservas-bot.onrender.com';

const CATALOG = {
  habitacionHierro: {
    file: 'habitacion-hierro.jpg',
    caption: 'Habitación con cama de hierro.',
    source: 'https://www.donfadrique.com/wp-content/uploads/portada1-1-1500x630.jpg',
  },
  habitacionAzul: {
    file: 'habitacion-azul.jpg',
    caption: 'Habitación doble.',
    source: 'https://www.donfadrique.com/wp-content/uploads/portada2-1-1500x630.jpg',
  },
  habitacionClasica: {
    file: 'habitacion-clasica.jpg',
    caption: 'Habitación con cabecero clásico.',
    source: 'https://www.donfadrique.com/wp-content/uploads/portada3-1500x630.jpg',
  },
  ceremonia: {
    file: 'ceremonia-jardin.jpg',
    caption: 'Ceremonia en el jardín.',
    source: 'https://www.donfadrique.com/wp-content/uploads/DJI_0855.jpg',
  },
  invitados: {
    file: 'invitados-jardin.jpg',
    caption: 'Invitados en el jardín.',
    source: 'https://www.donfadrique.com/wp-content/uploads/DSF2092-1030x1030.jpg',
  },
  banqueteBoda: {
    file: 'banquete-boda.jpg',
    caption: 'Mesa larga de banquete.',
    source: 'https://www.donfadrique.com/wp-content/uploads/DSF2336-1030x1030.jpg',
  },
  jardinNoche: {
    file: 'jardin-noche.jpg',
    caption: 'Jardín iluminado de noche.',
    source: 'https://www.donfadrique.com/wp-content/uploads/TERRRAZA-JARDIN-NOCHE-1030x773.jpg',
  },
  mesaBanquete: {
    file: 'mesa-banquete.jpg',
    caption: 'Mesa de banquete.',
    source: 'https://www.donfadrique.com/wp-content/uploads/1265-1030x1030.jpg',
  },
  salonRestaurante: {
    file: 'salon-restaurante.jpg',
    caption: 'Salón del restaurante.',
    source: 'https://www.donfadrique.com/wp-content/uploads/slide4.jpg',
  },
  mesaRestaurante: {
    file: 'mesa-restaurante.jpg',
    caption: 'Mesa del restaurante.',
    source: 'https://www.donfadrique.com/wp-content/uploads/4-4-1500x630.jpg',
  },
  plato: {
    file: 'plato.jpg',
    caption: 'Un plato del restaurante.',
    source: 'https://www.donfadrique.com/wp-content/uploads/5-4-1500x630.jpg',
  },
  cochinillo: {
    file: 'cochinillo.jpg',
    caption: 'Cochinillo de la casa.',
    source: 'https://www.donfadrique.com/wp-content/uploads/COCHINILLO-AHUMADO-CARRASCAL-705x705.jpg',
  },
  terrazaDia: {
    file: 'terraza-dia.jpg',
    caption: 'Terraza acristalada de día.',
    source: 'https://www.donfadrique.com/wp-content/uploads/DECORACION-TERRAZA-ACRISTALADA-DIA-687x1030.jpg',
  },
  terrazaInterior: {
    file: 'terraza-interior.jpg',
    caption: 'Interior de la terraza acristalada.',
    source: 'https://www.donfadrique.com/wp-content/uploads/TERRAZA-ACRISTALADA-INTERIOR-1030x773.jpg',
  },
  terrazaVistas: {
    file: 'terraza-vistas.jpg',
    caption: 'Vistas desde la terraza.',
    source: 'https://www.donfadrique.com/wp-content/uploads/VISTAS-TERRAZA-JARDIN1-687x1030.jpg',
  },
  exterior: {
    file: 'exterior-hosteria.jpg',
    caption: 'Exterior de la hostería.',
    source: 'https://www.donfadrique.com/wp-content/uploads/foto_galeria_2_192.jpg',
  },
  vistasAlba: {
    file: 'vistas-alba.jpg',
    caption: 'Vistas hacia Alba de Tormes.',
    source: 'https://www.donfadrique.com/wp-content/uploads/3-4-1500x630.jpg',
  },
  salonEvento: {
    file: 'salon-evento.jpg',
    caption: 'Salón preparado para un evento.',
    source: 'https://www.donfadrique.com/wp-content/uploads/WEB-EVENTOS-19.jpg',
  },
};

const ALBUMS = {
  general: ['exterior', 'vistasAlba', 'terrazaDia', 'habitacionClasica'],
  habitaciones: ['habitacionHierro', 'habitacionAzul', 'habitacionClasica'],
  bodas: ['ceremonia', 'invitados', 'banqueteBoda', 'jardinNoche'],
  restaurante: ['mesaBanquete', 'salonRestaurante', 'mesaRestaurante', 'plato'],
  terraza: ['terrazaDia', 'terrazaInterior', 'terrazaVistas'],
  eventos: ['salonEvento', 'terrazaDia', 'mesaBanquete'],
};

const PRESENTATION = {
  boda: ['ceremonia', 'invitados'],
  congreso: ['salonEvento', 'terrazaDia'],
};

// Pide ver el sitio. El texto ya viene normalizado (sin tildes, en minúsculas).
const SEEING =
  /\b(?:fotos?|imagen(?:es)?)\b|\bver (?:el sitio|la casa|fotos|el jardin|los jardines|la terraza|las habitaciones|el hotel|el restaurante|el salon|la hosteria)\b|\bensen(?:a(?:me|dme|rnos|r)?|arme)\b|\bmuestra(?:me|dme|nos)\b/;

const BARE_JARDIN = /^(?:el |los )?(?:jardin|jardines)$/;

function isPlaceHow(norm) {
  if (!/\bcomo es\b/.test(norm)) return false;
  if (/\b(?:menu|precio|cuesta|tarifa|carta|incluye|plato|iva)\b/.test(norm)) return false;
  return true;
}

function categoryFor(norm) {
  if (/habitacion|\bhotel\b|\bdormir\b|\balojamiento\b/.test(norm)) return 'habitaciones';
  if (/\bbodas?\b|ceremonia|\bjardin|\benlace\b|\bcasar/.test(norm)) return 'bodas';
  if (/terraza/.test(norm)) return 'terraza';
  if (/restaurante|\bsalon\b|banquete/.test(norm)) return 'restaurante';
  if (/congreso|convencion|seminario|macroevento/.test(norm)) return 'eventos';
  return 'general';
}

function matchPhotoRequest(norm) {
  if (!norm) return null;
  if (!SEEING.test(norm) && !isPlaceHow(norm) && !BARE_JARDIN.test(norm)) return null;
  return categoryFor(norm);
}

function asReply(photo) {
  return {
    kind: 'image',
    file: photo.file,
    caption: photo.caption,
    body: photo.caption,
    source: photo.source,
  };
}

function photosByKeys(keys) {
  return keys.map((key) => asReply(CATALOG[key]));
}

function album(category) {
  return photosByKeys(ALBUMS[category] || ALBUMS.general);
}

function presentationReplies(flow) {
  const keys = PRESENTATION[flow];
  if (!keys) return [];
  return photosByKeys(keys);
}

function catalog() {
  return Object.values(CATALOG);
}

function publicBaseUrl() {
  const fromEnv = process.env.PUBLIC_BASE_URL && String(process.env.PUBLIC_BASE_URL).trim();
  return (fromEnv || DEFAULT_PUBLIC_BASE_URL).replace(/\/+$/, '');
}

function publicUrl(file, folder = 'fotos') {
  const dir = String(folder || 'fotos').replace(/^\/+|\/+$/g, '') || 'fotos';
  return `${publicBaseUrl()}/${dir}/${file}`;
}

function clientPhotoNote(data) {
  const n = Number(data && data.fotosCliente) || 0;
  if (n < 1) return '';
  return n === 1
    ? 'El cliente envió 1 foto por WhatsApp'
    : `El cliente envió ${n} fotos por WhatsApp`;
}

module.exports = {
  DEFAULT_PUBLIC_BASE_URL,
  CATALOG,
  ALBUMS,
  matchPhotoRequest,
  categoryFor,
  album,
  presentationReplies,
  catalog,
  publicBaseUrl,
  publicUrl,
  clientPhotoNote,
};

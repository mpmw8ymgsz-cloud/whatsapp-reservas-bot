require('dotenv').config();

function clean(value) {
  return value ? value.trim() : value;
}

// Si no hay ningún teléfono de administración, el aviso sigue yendo al de Nicolás.
const DEFAULT_ADMIN_PHONE = '34661724158';

function phoneDigits(value) {
  if (value == null) return '';
  let digits = String(value).trim().replace(/[\s().-]/g, '');
  if (digits.startsWith('+')) digits = digits.slice(1);
  else if (digits.startsWith('00')) digits = digits.slice(2);
  return digits.replace(/\D/g, '');
}

// ADMIN_PHONES y ADMIN_PHONE aceptan uno o varios números separados por coma.
// Ejemplo: 34600000000,+34 600 000 001. También valen espacios dentro de cada número.
function parsePhoneList(value) {
  if (value == null) return [];
  const raw = String(value).trim();
  if (!raw) return [];
  const phones = [];
  const seen = new Set();
  for (const part of raw.split(/[,;]+/)) {
    const digits = phoneDigits(part);
    if (digits.length < 9 || digits.length > 15 || seen.has(digits)) continue;
    seen.add(digits);
    phones.push(digits);
  }
  return phones;
}

function loadAdminPhones() {
  const phones = [];
  const seen = new Set();
  for (const phone of [...parsePhoneList(process.env.ADMIN_PHONES), ...parsePhoneList(process.env.ADMIN_PHONE)]) {
    if (seen.has(phone)) continue;
    seen.add(phone);
    phones.push(phone);
  }
  if (!phones.length) phones.push(DEFAULT_ADMIN_PHONE);
  return phones;
}

const adminPhones = loadAdminPhones();

// Cabecera IMAGE de comida_navidad_empresas_2026. Pública en main para que
// Meta pueda descargarla cuando no hay media id ni URL en el entorno.
const DEFAULT_MARKETING_HEADER_IMAGE_URL =
  'https://raw.githubusercontent.com/mpmw8ymgsz-cloud/whatsapp-reservas-bot/main/assets/marketing/header_banquete.jpg';

module.exports = {
  port: process.env.PORT || 3000,
  provider: process.env.WHATSAPP_PROVIDER || 'meta', // 'meta' (oficial) o 'baileys' (no oficial, vía QR)
  metaToken: clean(process.env.META_TOKEN),
  phoneNumberId: clean(process.env.PHONE_NUMBER_ID),
  verifyToken: clean(process.env.VERIFY_TOKEN),
  // Teléfonos que reciben avisos y pueden confirmar con OK / NO.
  // ADMIN_PHONES es la lista (coma). ADMIN_PHONE sigue valiendo para un solo número
  // o para la misma lista. Si están las dos, se juntan sin repetir. Sin ninguna,
  // el aviso sigue yendo al de Nicolás.
  adminPhones,
  adminPhone: adminPhones[0],
  // Copia por correo de cada aviso a administración. El plan gratuito de Render
  // bloquea el SMTP (puertos 25, 465 y 587); el envío va por la API HTTPS de Brevo.
  alertEmail: clean(process.env.ALERT_EMAIL) || 'reservas@donfadrique.com',
  alertEmailFrom: clean(process.env.ALERT_EMAIL_FROM) || 'reservas@donfadrique.com',
  alertEmailFromName: clean(process.env.ALERT_EMAIL_FROM_NAME) || 'Hostería Don Fadrique',
  brevoApiKey: clean(process.env.BREVO_API_KEY) || '',
  // Plantilla UTILITY (idioma es) por si el texto de sesión cae fuera de la ventana de 24 h.
  // Cuerpo sugerido: "Nueva solicitud de presupuesto en Hostería Don Fadrique: {{1}}. Revísala en el panel de reservas."
  adminAlertTemplate: clean(process.env.ADMIN_ALERT_TEMPLATE) || 'aviso_solicitud_presupuesto',
  // Plantilla de marketing (comida de Navidad empresas). El envío es manual:
  // nada de esto se manda al arrancar ni por cron.
  marketing: {
    templateName: clean(process.env.MARKETING_TEMPLATE_NAME) || 'comida_navidad_empresas_2026',
    templateLang: clean(process.env.MARKETING_TEMPLATE_LANG) || 'es',
    headerMediaId: clean(process.env.MARKETING_TEMPLATE_HEADER_MEDIA_ID) || null,
    headerImageUrl:
      clean(process.env.MARKETING_TEMPLATE_HEADER_IMAGE_URL) ||
      clean(process.env.HEADER_IMAGE_URL) ||
      DEFAULT_MARKETING_HEADER_IMAGE_URL,
  },
  // URL pública de este servicio. WhatsApp descarga las fotos de /fotos desde aquí.
  publicBaseUrl: clean(process.env.PUBLIC_BASE_URL) || 'https://whatsapp-reservas-bot.onrender.com',
  tursoUrl: clean(process.env.TURSO_DATABASE_URL),
  tursoAuthToken: clean(process.env.TURSO_AUTH_TOKEN),

  business: {
    name: 'Hostería Don Fadrique',
    timezone: 'Europe/Madrid',
    address: 'Ctra. de Salamanca - Alba, Km 17, 37800 Alba de Tormes (Salamanca)',
    phone: '923 37 00 76',
    email: 'reservas@donfadrique.com',
    web: 'https://www.donfadrique.com/',
    hotelBookingUrl: 'https://www.reservaonline.support/donfadrique/reservas.html',
    advanceBookingDays: 60,

    // Restaurante Don Fadrique: comidas y cenas. Cerrado martes y miércoles.
    restaurant: {
      label: 'Restaurante Don Fadrique',
      slotMinutes: 30,
      maxReservationsPerSlot: 8,
      maxPartySize: 12,
      // 0=domingo, 1=lunes, ..., 6=sábado. El fin de cada franja es exclusivo:
      // [13:30-16:00) da horas de 13:30 a 15:30; [20:30-23:00) da de 20:30 a 22:30.
      schedule: {
        0: [['13:30', '16:00'], ['20:30', '23:00']],
        1: [['13:30', '16:00'], ['20:30', '23:00']],
        2: null, // martes cerrado
        3: null, // miércoles cerrado
        4: [['13:30', '16:00'], ['20:30', '23:00']],
        5: [['13:30', '16:00'], ['20:30', '23:00']],
        6: [['13:30', '16:00'], ['20:30', '23:00']],
      },
    },

  },
};

require('dotenv').config();

function clean(value) {
  return value ? value.trim() : value;
}

module.exports = {
  port: process.env.PORT || 3000,
  provider: process.env.WHATSAPP_PROVIDER || 'meta', // 'meta' (oficial) o 'baileys' (no oficial, vía QR)
  metaToken: clean(process.env.META_TOKEN),
  phoneNumberId: clean(process.env.PHONE_NUMBER_ID),
  verifyToken: clean(process.env.VERIFY_TOKEN),
  // Si ADMIN_PHONE no está en Render, avisar al WhatsApp Business de Nicolás Sánchez Monge.
  adminPhone: clean(process.env.ADMIN_PHONE) || '34661724158',
  // Plantilla de marketing (comida de Navidad empresas). El envío es manual:
  // nada de esto se manda al arrancar ni por cron.
  marketing: {
    templateName: clean(process.env.MARKETING_TEMPLATE_NAME) || 'comida_navidad_empresas_2026',
    templateLang: clean(process.env.MARKETING_TEMPLATE_LANG) || 'es',
    headerMediaId: clean(process.env.MARKETING_TEMPLATE_HEADER_MEDIA_ID) || null,
    headerImageUrl:
      clean(process.env.MARKETING_TEMPLATE_HEADER_IMAGE_URL) ||
      clean(process.env.HEADER_IMAGE_URL) ||
      null,
  },
  tursoUrl: clean(process.env.TURSO_DATABASE_URL),
  tursoAuthToken: clean(process.env.TURSO_AUTH_TOKEN),

  business: {
    name: 'Hostería Don Fadrique',
    timezone: 'Europe/Madrid',
    address: 'Ctra. de Salamanca - Alba, Km 17, 37800 Alba de Tormes (Salamanca)',
    phone: '923 37 00 76',
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

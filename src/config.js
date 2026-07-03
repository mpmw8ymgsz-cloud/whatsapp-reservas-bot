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
  adminPhone: clean(process.env.ADMIN_PHONE) || null,
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

    // OTIVM: brunch + música + piscina + cóctel/copa. Jueves a domingo, julio-septiembre.
    otivm: {
      label: 'OTIVM · Brunch · Pool · Tardeo',
      pricePerPerson: 35,
      includes: 'brunch, música, piscina y cóctel o copa',
      months: [7, 8, 9], // julio, agosto, septiembre
      slotMinutes: 30,
      maxReservationsPerSlot: 10,
      maxPartySize: 15,
      // Jueves(4) a domingo(0), de 12:00 a 21:00 (última entrada 20:00)
      schedule: {
        0: [['12:00', '20:30']],
        1: null,
        2: null,
        3: null,
        4: [['12:00', '20:30']],
        5: [['12:00', '20:30']],
        6: [['12:00', '20:30']],
      },
    },
  },
};

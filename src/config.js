require('dotenv').config();

module.exports = {
  port: process.env.PORT || 3000,
  metaToken: process.env.META_TOKEN,
  phoneNumberId: process.env.PHONE_NUMBER_ID,
  verifyToken: process.env.VERIFY_TOKEN,
  adminPhone: process.env.ADMIN_PHONE || null,
  tursoUrl: process.env.TURSO_DATABASE_URL,
  tursoAuthToken: process.env.TURSO_AUTH_TOKEN,

  // Personaliza aquí los datos de tu restaurante
  restaurant: {
    name: 'Mi Restaurante',
    timezone: 'Europe/Madrid',
    slotMinutes: 30, // cada cuántos minutos se puede reservar
    maxReservationsPerSlot: 8, // nº máximo de reservas en el mismo horario
    maxPartySize: 12, // tamaño máximo de grupo aceptado por el bot
    advanceBookingDays: 30, // con cuánta antelación máxima se puede reservar

    // Horario por día de la semana: 0=domingo, 1=lunes, ..., 6=sábado
    // Cada día tiene una lista de franjas [inicio, fin] en formato "HH:MM", o `null` si está cerrado
    schedule: {
      0: [['13:00', '16:30']],
      1: null,
      2: [['13:00', '16:00'], ['20:00', '23:30']],
      3: [['13:00', '16:00'], ['20:00', '23:30']],
      4: [['13:00', '16:00'], ['20:00', '23:30']],
      5: [['13:00', '16:00'], ['20:00', '23:30']],
      6: [['13:00', '16:30'], ['20:00', '00:00']],
    },
  },
};

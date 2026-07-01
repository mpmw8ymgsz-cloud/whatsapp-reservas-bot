const { DateTime } = require('luxon');
const config = require('./config');
const db = require('./db');
const wa = require('./wa');
const { parseDate, parseTimeCandidates, getSlotsForDate, normalize } = require('./dateParser');

const STEP = {
  IDLE: 'IDLE',
  RESERVE_DATE: 'RESERVE_DATE',
  RESERVE_TIME: 'RESERVE_TIME',
  RESERVE_PARTY: 'RESERVE_PARTY',
  RESERVE_NAME: 'RESERVE_NAME',
  RESERVE_CONFIRM: 'RESERVE_CONFIRM',
  CANCEL_SELECT: 'CANCEL_SELECT',
};

async function handleIncoming(from, text, buttonId) {
  const normText = normalize(text);
  const session = (await db.getSession(from)) || { step: STEP.IDLE, data: {} };

  if (['hola', 'menu', 'inicio', 'buenas'].includes(normText)) {
    return showMenu(from);
  }
  if (normText === 'ayuda' || buttonId === 'help') {
    return sendHelp(from);
  }
  if (buttonId === 'start_reserve' || (normText.includes('reserv') && session.step === STEP.IDLE)) {
    return startReserve(from);
  }
  if (buttonId === 'my_reservations' || (normText.includes('mis reserva') && session.step === STEP.IDLE)) {
    return showMyReservations(from);
  }

  switch (session.step) {
    case STEP.RESERVE_DATE:
      return handleDateStep(from, text, session);
    case STEP.RESERVE_TIME:
      return handleTimeStep(from, text, buttonId, session);
    case STEP.RESERVE_PARTY:
      return handlePartyStep(from, text, session);
    case STEP.RESERVE_NAME:
      return handleNameStep(from, text, session);
    case STEP.RESERVE_CONFIRM:
      return handleConfirmStep(from, buttonId, session, text);
    case STEP.CANCEL_SELECT:
      return handleCancelSelect(from, buttonId);
    default:
      return showMenu(from);
  }
}

async function showMenu(from) {
  await db.clearSession(from);
  await wa.sendButtons(
    from,
    `¡Hola! 👋 Soy el asistente de reservas de *${config.restaurant.name}*. ¿Qué quieres hacer?`,
    [
      { id: 'start_reserve', title: '📅 Reservar' },
      { id: 'my_reservations', title: '📋 Mis reservas' },
      { id: 'help', title: '❓ Ayuda' },
    ]
  );
}

async function sendHelp(from) {
  await wa.sendText(
    from,
    'Puedo ayudarte a reservar mesa.\n- Escribe "reservar" para empezar\n- Escribe "mis reservas" para ver o cancelar tus reservas\n- Escribe "menu" para volver al inicio'
  );
}

async function startReserve(from) {
  await db.setSession(from, STEP.RESERVE_DATE, {});
  await wa.sendText(
    from,
    '¿Para qué día quieres reservar? (ej: "hoy", "mañana", "viernes", "15/07")'
  );
}

async function handleDateStep(from, text, session) {
  const zone = config.restaurant.timezone;
  const dt = parseDate(text, zone);
  const now = DateTime.now().setZone(zone).startOf('day');

  if (!dt) {
    return wa.sendText(
      from,
      'No entendí la fecha 🤔. Prueba con "hoy", "mañana", un día de la semana o el formato dd/mm.'
    );
  }
  if (dt < now) {
    return wa.sendText(from, 'Esa fecha ya pasó. Dime otra fecha, por favor.');
  }
  if (dt > now.plus({ days: config.restaurant.advanceBookingDays })) {
    return wa.sendText(
      from,
      `Solo acepto reservas con hasta ${config.restaurant.advanceBookingDays} días de antelación. Prueba con otra fecha.`
    );
  }

  const slots = getSlotsForDate(dt, config.restaurant);
  if (slots.length === 0) {
    return wa.sendText(from, 'Ese día estamos cerrados 😔. Prueba con otra fecha.');
  }

  session.data.date = dt.toFormat('yyyy-MM-dd');
  session.data.dateLabel = dt.setLocale('es').toFormat("cccc d 'de' LLLL");
  await db.setSession(from, STEP.RESERVE_TIME, session.data);
  await wa.sendText(from, `Perfecto, ${session.data.dateLabel}. ¿A qué hora? (ej: "21:00", "9pm")`);
}

async function slotsWithAvailability(date, slots) {
  const available = [];
  for (const s of slots) {
    const count = await db.countReservations(date, s);
    if (count < config.restaurant.maxReservationsPerSlot) available.push(s);
  }
  return available;
}

async function handleTimeStep(from, text, buttonId, session) {
  const zone = config.restaurant.timezone;
  const dt = DateTime.fromFormat(session.data.date, 'yyyy-MM-dd', { zone });
  const slots = getSlotsForDate(dt, config.restaurant);

  let chosen = null;
  if (buttonId && buttonId.startsWith('slot_')) {
    chosen = buttonId.replace('slot_', '');
  } else {
    for (const c of parseTimeCandidates(text)) {
      const hm = `${String(c.hour).padStart(2, '0')}:${String(c.minute).padStart(2, '0')}`;
      if (slots.includes(hm)) {
        chosen = hm;
        break;
      }
    }
  }

  if (!chosen) {
    const options = slots.slice(0, 10).map((s) => ({ id: `slot_${s}`, title: s }));
    if (options.length === 0) {
      return wa.sendText(from, 'No hay horarios disponibles ese día.');
    }
    await wa.sendText(from, 'No reconocí esa hora o no está disponible. Elige una de la lista:');
    return wa.sendList(from, 'Horarios disponibles', 'Ver horarios', options);
  }

  const count = await db.countReservations(session.data.date, chosen);
  if (count >= config.restaurant.maxReservationsPerSlot) {
    const alt = (await slotsWithAvailability(session.data.date, slots)).slice(0, 10);
    if (alt.length === 0) {
      return wa.sendText(from, 'Lo siento, no quedan horarios libres ese día. Escribe "menu" para elegir otra fecha.');
    }
    await wa.sendText(from, 'Esa hora ya está completa 😔. Elige otra:');
    return wa.sendList(from, 'Horarios disponibles', 'Ver horarios', alt.map((s) => ({ id: `slot_${s}`, title: s })));
  }

  session.data.time = chosen;
  await db.setSession(from, STEP.RESERVE_PARTY, session.data);
  await wa.sendText(from, `¿Para cuántas personas? (máx. ${config.restaurant.maxPartySize})`);
}

async function handlePartyStep(from, text, session) {
  const n = parseInt(normalize(text).replace(/[^\d]/g, ''), 10);
  if (!n || n < 1 || n > config.restaurant.maxPartySize) {
    return wa.sendText(from, `Dime un número válido de personas (1-${config.restaurant.maxPartySize}).`);
  }
  session.data.partySize = n;

  const knownName = await db.getCustomerName(from);
  if (knownName) {
    session.data.name = knownName;
    return goToConfirm(from, session);
  }
  await db.setSession(from, STEP.RESERVE_NAME, session.data);
  await wa.sendText(from, '¿A nombre de quién hago la reserva?');
}

async function handleNameStep(from, text, session) {
  const name = (text || '').trim();
  if (!name || name.length < 2) {
    return wa.sendText(from, 'Dime un nombre válido, por favor.');
  }
  session.data.name = name;
  await db.upsertCustomerName(from, name);
  return goToConfirm(from, session);
}

async function goToConfirm(from, session) {
  await db.setSession(from, STEP.RESERVE_CONFIRM, session.data);
  const { dateLabel, time, partySize, name } = session.data;
  await wa.sendButtons(
    from,
    `Confirma tu reserva:\n📅 ${dateLabel}\n🕐 ${time}\n👥 ${partySize} personas\n🙋 ${name}\n\n¿Confirmo?`,
    [
      { id: 'confirm_yes', title: '✅ Confirmar' },
      { id: 'confirm_no', title: '❌ Cancelar' },
    ]
  );
}

async function handleConfirmStep(from, buttonId, session, text) {
  const normText = normalize(text);
  const isYes = buttonId === 'confirm_yes' || ['si', 'sí', 'vale', 'ok', 'confirmar'].includes(normText);
  const isNo = buttonId === 'confirm_no' || ['no', 'cancelar'].includes(normText);

  if (isYes) {
    const { date, time, partySize, name, dateLabel } = session.data;
    const id = await db.createReservation({ phone: from, name, partySize, date, time });
    await db.clearSession(from);
    await wa.sendText(from, `¡Reserva confirmada! 🎉 Número de reserva #${id}. Te esperamos.`);
    if (config.adminPhone) {
      await wa.sendText(
        config.adminPhone,
        `Nueva reserva #${id}: ${name}, ${partySize}p, ${dateLabel} ${time}, tel ${from}`
      );
    }
    return;
  }

  if (isNo) {
    await db.clearSession(from);
    return wa.sendText(from, 'Reserva cancelada. Escribe "reservar" cuando quieras intentarlo de nuevo.');
  }

  return wa.sendText(from, 'Responde "Confirmar" o "Cancelar", por favor.');
}

async function showMyReservations(from) {
  const list = await db.getUpcomingReservations(from);
  if (list.length === 0) {
    return wa.sendText(from, 'No tienes reservas próximas. Escribe "reservar" para crear una.');
  }

  const rows = list.map((r) => ({
    id: `cancel_${r.id}`,
    title: `#${r.id} ${r.date} ${r.time}`,
    description: `${r.party_size} personas`,
  }));
  await db.setSession(from, STEP.CANCEL_SELECT, {});
  await wa.sendText(from, 'Estas son tus próximas reservas. Selecciona una para cancelarla, o escribe "menu" para salir:');
  await wa.sendList(from, 'Tus reservas', 'Ver reservas', rows);
}

async function handleCancelSelect(from, buttonId) {
  if (!buttonId || !buttonId.startsWith('cancel_')) {
    return wa.sendText(from, 'Selecciona una reserva de la lista o escribe "menu" para salir.');
  }
  const id = parseInt(buttonId.replace('cancel_', ''), 10);
  const ok = await db.cancelReservation(id, from);
  await db.clearSession(from);
  if (ok) {
    await wa.sendText(from, `Reserva #${id} cancelada. ¡Esperamos verte pronto!`);
  } else {
    await wa.sendText(from, 'No pude cancelar esa reserva.');
  }
}

module.exports = { handleIncoming };

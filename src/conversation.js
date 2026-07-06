const { DateTime } = require('luxon');
const config = require('./config');
const db = require('./db');
const wa = require('./wa');
const { parseDate, parseTimeCandidates, getSlotsForDate, normalize } = require('./dateParser');

const B = config.business;

const STEP = {
  IDLE: 'IDLE',
  DATE: 'DATE',
  TIME: 'TIME',
  PARTY: 'PARTY',
  NAME: 'NAME',
  CONFIRM: 'CONFIRM',
  HOTEL_DATES: 'HOTEL_DATES',
  HOTEL_PARTY: 'HOTEL_PARTY',
  CANCEL_SELECT: 'CANCEL_SELECT',
};

function expConfig(type) {
  return type === 'otivm' ? B.otivm : B.restaurant;
}

function expLabel(type) {
  if (type === 'otivm') return 'OTIVM (brunch · pool · tardeo)';
  if (type === 'hotel') return 'Hotel';
  return 'Restaurante Don Fadrique';
}

async function handleIncoming(from, text, buttonId) {
  const normText = normalize(text);

  // Comandos de administrador (solo desde el número del negocio)
  if (config.adminPhone && from === config.adminPhone) {
    if (['hoy', 'reservas hoy'].includes(normText)) return sendAdminList(from, 0);
    if (['manana', 'reservas manana'].includes(normText)) return sendAdminList(from, 1);
    if (['semana', 'reservas semana'].includes(normText)) return sendAdminList(from, 7);
  }

  const session = (await db.getSession(from)) || { step: STEP.IDLE, data: {} };

  // Comandos globales, disponibles en cualquier punto
  if (['hola', 'menu', 'inicio', 'buenas', 'empezar', 'volver'].includes(normText)) {
    return showMenu(from);
  }
  if (normText === 'ayuda' || normText === 'info' || buttonId === 'help') {
    return sendInfo(from);
  }
  if (buttonId === 'my_reservations' || normText.includes('mis reserva') || normText === 'cancelar reserva') {
    return showMyReservations(from);
  }

  // Selección de experiencia desde el menú
  if (buttonId === 'exp_rest') return startRestaurant(from);
  if (buttonId === 'exp_otivm') return startOtivm(from);
  if (buttonId === 'exp_hotel') return startHotel(from);

  // Atajos por texto libre
  if (session.step === STEP.IDLE) {
    if (normText.includes('otivm') || normText.includes('piscina') || normText.includes('brunch') || normText.includes('tardeo')) {
      return startOtivm(from);
    }
    if (normText.includes('hotel') || normText.includes('habitacion') || normText.includes('dormir') || normText.includes('alojamiento')) {
      return startHotel(from);
    }
    if (normText.includes('reserv') || normText.includes('mesa') || normText.includes('comer') || normText.includes('cenar') || normText.includes('restaurante')) {
      return startRestaurant(from);
    }
  }

  switch (session.step) {
    case STEP.DATE:
      return handleDateStep(from, text, session);
    case STEP.TIME:
      return handleTimeStep(from, text, buttonId, session);
    case STEP.PARTY:
      return handlePartyStep(from, text, session);
    case STEP.NAME:
      return handleNameStep(from, text, session);
    case STEP.CONFIRM:
      return handleConfirmStep(from, buttonId, session, text);
    case STEP.HOTEL_DATES:
      return handleHotelDates(from, text, session);
    case STEP.HOTEL_PARTY:
      return handleHotelParty(from, text, session);
    case STEP.CANCEL_SELECT:
      return handleCancelSelect(from, buttonId);
    default:
      return showMenu(from);
  }
}

// ---------- Menú e información ----------

async function showMenu(from) {
  await db.clearSession(from);
  await wa.sendButtons(
    from,
    `¡Hola! 👋 Bienvenido/a a *${B.name}*.\n\n¿Qué te apetece reservar?\n\n_También puedes escribir "mis reservas" para ver o cancelar las tuyas, o "info" para horarios y contacto._`,
    [
      { id: 'exp_rest', title: '🍽️ Restaurante' },
      { id: 'exp_otivm', title: '🌿 OTIVM · Pool' },
      { id: 'exp_hotel', title: '🛏️ Hotel' },
    ]
  );
}

async function sendInfo(from) {
  await wa.sendText(
    from,
    `ℹ️ *${B.name}*\n\n` +
      `📍 ${B.address}\n📞 ${B.phone}\n🌐 ${B.web}\n\n` +
      `🍽️ *Restaurante*: comidas 13:30-15:30 y cenas 20:30-22:30. Cerrado martes y miércoles.\n\n` +
      `🌿 *OTIVM* (brunch · pool · tardeo): ${B.otivm.pricePerPerson}€/persona, incluye ${B.otivm.includes}. ` +
      `Jueves a domingo de julio a septiembre, de 12:00 a 21:00. Solo con reserva, plazas limitadas.\n\n` +
      `🛏️ *Hotel*: reserva online en ${B.hotelBookingUrl} o escríbeme aquí y aviso a recepción.\n\n` +
      `Escribe *menu* para volver al inicio.`
  );
}

// ---------- Flujo restaurante ----------

async function startRestaurant(from) {
  await db.setSession(from, STEP.DATE, { type: 'restaurante' });
  await wa.sendText(
    from,
    `🍽️ *Restaurante Don Fadrique*\n\n¿Para qué día quieres la mesa? (ej: "hoy", "mañana", "viernes", "15/08")\n\n_Comidas 13:30-15:30 · Cenas 20:30-22:30 · Cerrado martes y miércoles_`
  );
}

// ---------- Flujo OTIVM ----------

async function startOtivm(from) {
  await db.setSession(from, STEP.DATE, { type: 'otivm' });
  await wa.sendText(
    from,
    `🌿 *OTIVM · Brunch · Pool · Tardeo*\n\n${B.otivm.pricePerPerson}€ por persona. Incluye ${B.otivm.includes}.\n` +
      `Abierto jueves a domingo, de julio a septiembre, de 12:00 a 21:00. Plazas limitadas.\n\n` +
      `¿Qué día quieres venir? (ej: "sábado", "12/07")`
  );
}

// ---------- Flujo hotel ----------

async function startHotel(from) {
  await db.setSession(from, STEP.HOTEL_DATES, { type: 'hotel' });
  await wa.sendText(
    from,
    `🛏️ *Hotel ${B.name}*\n\nPuedes reservar al momento con disponibilidad real aquí:\n${B.hotelBookingUrl}\n\n` +
      `O si prefieres, dime las *fechas de entrada y salida* (ej: "del 15 al 17 de agosto") y aviso a recepción para que te confirmen por aquí sin que tengas que llamar.`
  );
}

async function handleHotelDates(from, text, session) {
  const t = (text || '').trim();
  if (!t || t.length < 4) {
    return wa.sendText(from, 'Dime las fechas de entrada y salida (ej: "del 15 al 17 de agosto").');
  }
  session.data.hotelDates = t;
  await db.setSession(from, STEP.HOTEL_PARTY, session.data);
  await wa.sendText(from, '¿Para cuántas personas? (puedes indicar también niños, ej: "2 adultos y 1 niño")');
}

async function handleHotelParty(from, text, session) {
  const t = (text || '').trim();
  if (!t) {
    return wa.sendText(from, '¿Para cuántas personas sería la estancia?');
  }
  session.data.hotelParty = t;

  const knownName = await db.getCustomerName(from);
  if (knownName) {
    session.data.name = knownName;
    return goToConfirm(from, session);
  }
  await db.setSession(from, STEP.NAME, session.data);
  await wa.sendText(from, '¿A nombre de quién hago la solicitud?');
}

// ---------- Pasos comunes (fecha/hora/personas/nombre/confirmación) ----------

async function handleDateStep(from, text, session) {
  const zone = B.timezone;
  const type = session.data.type;
  const cfg = expConfig(type);
  const dt = parseDate(text, zone);
  const now = DateTime.now().setZone(zone).startOf('day');

  if (!dt) {
    return wa.sendText(from, 'No entendí la fecha 🤔. Prueba con "hoy", "mañana", un día de la semana o el formato dd/mm.');
  }
  if (dt < now) {
    return wa.sendText(from, 'Esa fecha ya pasó. Dime otra fecha, por favor.');
  }
  if (dt > now.plus({ days: B.advanceBookingDays })) {
    return wa.sendText(from, `Aceptamos reservas con hasta ${B.advanceBookingDays} días de antelación. Prueba con otra fecha.`);
  }

  if (type === 'otivm' && !B.otivm.months.includes(dt.month)) {
    return wa.sendText(from, 'OTIVM abre de julio a septiembre 🌞. Dime una fecha dentro de la temporada.');
  }

  const slots = getSlotsForDate(dt, cfg);
  if (slots.length === 0) {
    const cierre = type === 'otivm' ? 'OTIVM abre de jueves a domingo' : 'El restaurante cierra martes y miércoles';
    return wa.sendText(from, `Ese día no abrimos 😔 (${cierre}). Prueba con otra fecha.`);
  }

  session.data.date = dt.toFormat('yyyy-MM-dd');
  session.data.dateLabel = dt.setLocale('es').toFormat("cccc d 'de' LLLL");
  await db.setSession(from, STEP.TIME, session.data);

  const hint = type === 'otivm' ? '(ej: "12:00", "17:30")' : '(ej: "14:00" para comer, "21:00" para cenar)';
  await wa.sendText(from, `Perfecto, ${session.data.dateLabel}. ¿A qué hora? ${hint}`);
}

async function handleTimeStep(from, text, buttonId, session) {
  const zone = B.timezone;
  const type = session.data.type;
  const cfg = expConfig(type);
  const dt = DateTime.fromFormat(session.data.date, 'yyyy-MM-dd', { zone });
  const slots = getSlotsForDate(dt, cfg);

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
    await wa.sendText(from, 'No reconocí esa hora o no está disponible. Elige una de la lista:');
    return wa.sendList(from, 'Horarios disponibles', 'Ver horarios', options);
  }

  const count = await db.countReservations(session.data.date, chosen, type);
  if (count >= cfg.maxReservationsPerSlot) {
    const libres = [];
    for (const s of slots) {
      const c = await db.countReservations(session.data.date, s, type);
      if (c < cfg.maxReservationsPerSlot) libres.push(s);
      if (libres.length >= 10) break;
    }
    if (libres.length === 0) {
      return wa.sendText(from, 'Lo siento, ese día está completo 😔. Escribe "menu" y prueba con otra fecha.');
    }
    await wa.sendText(from, 'Esa hora ya está completa 😔. Elige otra:');
    return wa.sendList(from, 'Horarios disponibles', 'Ver horarios', libres.map((s) => ({ id: `slot_${s}`, title: s })));
  }

  session.data.time = chosen;
  await db.setSession(from, STEP.PARTY, session.data);
  await wa.sendText(from, `¿Para cuántas personas? (máx. ${cfg.maxPartySize})`);
}

async function handlePartyStep(from, text, session) {
  const cfg = expConfig(session.data.type);
  const n = parseInt(normalize(text).replace(/[^\d]/g, ''), 10);
  if (!n || n < 1 || n > cfg.maxPartySize) {
    return wa.sendText(from, `Dime un número válido de personas (1-${cfg.maxPartySize}).`);
  }
  session.data.partySize = n;

  const knownName = await db.getCustomerName(from);
  if (knownName) {
    session.data.name = knownName;
    return goToConfirm(from, session);
  }
  await db.setSession(from, STEP.NAME, session.data);
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
  await db.setSession(from, STEP.CONFIRM, session.data);
  const d = session.data;

  let resumen;
  if (d.type === 'hotel') {
    resumen = `Confirma tu solicitud de *hotel*:\n📅 ${d.hotelDates}\n👥 ${d.hotelParty}\n🙋 ${d.name}\n\nRecepción te confirmará disponibilidad por aquí. ¿Envío la solicitud?`;
  } else if (d.type === 'otivm') {
    const total = d.partySize * B.otivm.pricePerPerson;
    resumen = `Confirma tu reserva en *OTIVM*:\n📅 ${d.dateLabel}\n🕐 ${d.time}\n👥 ${d.partySize} personas\n🙋 ${d.name}\n💶 ${B.otivm.pricePerPerson}€/persona (${total}€, incluye ${B.otivm.includes})\n\n¿Confirmo?`;
  } else {
    resumen = `Confirma tu reserva en el *Restaurante*:\n📅 ${d.dateLabel}\n🕐 ${d.time}\n👥 ${d.partySize} personas\n🙋 ${d.name}\n\n¿Confirmo?`;
  }

  await wa.sendButtons(from, resumen, [
    { id: 'confirm_yes', title: '✅ Confirmar' },
    { id: 'confirm_no', title: '❌ Cancelar' },
  ]);
}

async function handleConfirmStep(from, buttonId, session, text) {
  const normText = normalize(text);
  const isYes = buttonId === 'confirm_yes' || ['si', 'sí', 'vale', 'ok', 'confirmar', 'confirmo'].includes(normText);
  const isNo = buttonId === 'confirm_no' || ['no', 'cancelar'].includes(normText);

  if (isYes) {
    const d = session.data;

    if (d.type === 'hotel') {
      const id = await db.createReservation({
        phone: from,
        name: d.name,
        partySize: 0,
        date: DateTime.now().setZone(B.timezone).toFormat('yyyy-MM-dd'),
        time: '--:--',
        type: 'hotel',
        details: `Fechas: ${d.hotelDates} | Personas: ${d.hotelParty}`,
      });
      await db.clearSession(from);
      await wa.sendText(
        from,
        `¡Solicitud enviada! 🛎️ (nº ${id}) Recepción te escribirá por aquí para confirmar disponibilidad y precio.\n\nSi lo prefieres, también puedes reservar al momento en:\n${B.hotelBookingUrl}`
      );
      if (config.adminPhone) {
        await wa.sendText(
          config.adminPhone,
          `🛏️ SOLICITUD HOTEL #${id}\n${d.hotelDates}\n${d.hotelParty}\nNombre: ${d.name}\nTel: ${from}\n\nResponder al cliente por WhatsApp para confirmar.`
        );
      }
      return;
    }

    const id = await db.createReservation({
      phone: from,
      name: d.name,
      partySize: d.partySize,
      date: d.date,
      time: d.time,
      type: d.type,
    });
    await db.clearSession(from);

    if (d.type === 'otivm') {
      await wa.sendText(
        from,
        `¡Reserva confirmada en OTIVM! 🌿🎉 (nº ${id})\n📅 ${d.dateLabel} a las ${d.time}\n👥 ${d.partySize} personas\n\n` +
          `Recuerda: ${B.otivm.pricePerPerson}€/persona, incluye ${B.otivm.includes}. ¡Nos vemos en la piscina!\n\n_Para cancelar, escribe "mis reservas"._`
      );
    } else {
      await wa.sendText(
        from,
        `¡Mesa confirmada! 🍽️🎉 (nº ${id})\n📅 ${d.dateLabel} a las ${d.time}\n👥 ${d.partySize} personas\n\n` +
          `Te esperamos en ${B.name}.\n📍 ${B.address}\n\n_Para cancelar, escribe "mis reservas"._`
      );
    }

    if (config.adminPhone) {
      const tipo = d.type === 'otivm' ? '🌿 OTIVM' : '🍽️ RESTAURANTE';
      await wa.sendText(
        config.adminPhone,
        `${tipo} — reserva #${id}\n${d.dateLabel} ${d.time}\n${d.partySize} personas\nNombre: ${d.name}\nTel: ${from}`
      );
    }
    return;
  }

  if (isNo) {
    await db.clearSession(from);
    return wa.sendText(from, 'Sin problema, no he guardado nada. Escribe "menu" cuando quieras empezar de nuevo. 😊');
  }

  return wa.sendText(from, 'Responde "Confirmar" o "Cancelar", por favor.');
}

// ---------- Comandos de administrador ----------

async function sendAdminList(from, daysAhead) {
  const zone = B.timezone;
  const start = DateTime.now().setZone(zone).startOf('day');
  const end = daysAhead === 7 ? start.plus({ days: 7 }) : start.plus({ days: daysAhead });
  const fromDate = (daysAhead === 1 ? start.plus({ days: 1 }) : start).toFormat('yyyy-MM-dd');
  const toDate = end.toFormat('yyyy-MM-dd');

  const list = await db.getReservationsByDateRange(fromDate, toDate);
  if (list.length === 0) {
    return wa.sendText(from, `📋 Sin reservas entre ${fromDate} y ${toDate}.`);
  }

  let msg = `📋 *Reservas ${fromDate}${toDate !== fromDate ? ' → ' + toDate : ''}* (${list.length})\n`;
  let currentDate = '';
  for (const r of list) {
    if (r.date !== currentDate) {
      currentDate = r.date;
      msg += `\n📅 *${r.date}*\n`;
    }
    const icon = r.type === 'otivm' ? '🌿' : r.type === 'hotel' ? '🛏️' : '🍽️';
    msg += `${icon} #${r.id} ${r.time} · ${r.name}${r.party_size ? ' · ' + r.party_size + 'p' : ''}${r.details ? ' · ' + r.details : ''} · 📱${r.phone}\n`;
  }
  msg += `\n_Comandos: "hoy", "mañana", "semana"_`;
  await wa.sendText(from, msg);
}

// ---------- Mis reservas / cancelación ----------

async function showMyReservations(from) {
  const list = await db.getUpcomingReservations(from);
  if (list.length === 0) {
    return wa.sendText(from, 'No tienes reservas próximas. Escribe "menu" para crear una.');
  }

  const rows = list.slice(0, 10).map((r) => {
    const icon = r.type === 'otivm' ? '🌿' : r.type === 'hotel' ? '🛏️' : '🍽️';
    return {
      id: `cancel_${r.id}`,
      title: `#${r.id} ${r.date} ${r.time}`.slice(0, 24),
      description: `${icon} ${expLabel(r.type)}${r.party_size ? ' · ' + r.party_size + 'p' : ''}`.slice(0, 72),
    };
  });
  await db.setSession(from, STEP.CANCEL_SELECT, {});
  await wa.sendText(from, 'Estas son tus próximas reservas. Selecciona una para CANCELARLA, o escribe "menu" para salir:');
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
    await wa.sendText(from, `Reserva #${id} cancelada. ¡Esperamos verte pronto! 👋`);
    if (config.adminPhone) {
      await wa.sendText(config.adminPhone, `❌ CANCELACIÓN — reserva #${id} (tel ${from})`);
    }
  } else {
    await wa.sendText(from, 'No pude cancelar esa reserva.');
  }
}

module.exports = { handleIncoming };

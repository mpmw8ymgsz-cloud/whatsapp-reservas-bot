const { DateTime } = require('luxon');
const config = require('./config');
const db = require('./db');
const wa = require('./wa');
const { parseDate, parseTimeCandidates, getSlotsForDate, normalize } = require('./dateParser');
const hotelApi = require('./hotelApi');
const grupos = require('./grupos');
const faq = require('./faqLlegada');
const marketing = require('./marketing');
const fotos = require('./fotos');
const menusFiesta = require('./menusFiesta');
const confirmacion = require('./confirmacion');
const { applyDecision } = require('./reservasDecision');

const B = config.business;

const STEP = {
  IDLE: 'IDLE',
  DATE: 'DATE',
  TIME: 'TIME',
  PARTY: 'PARTY',
  NAME: 'NAME',
  CONFIRM: 'CONFIRM',
  HOTEL_ENTRADA: 'HOTEL_ENTRADA',
  HOTEL_SALIDA: 'HOTEL_SALIDA',
  HOTEL_PAX: 'HOTEL_PAX',
  HOTEL_QUOTE: 'HOTEL_QUOTE',
  CANCEL_SELECT: 'CANCEL_SELECT',
  GRUPO: 'GRUPO',
};

function expConfig() {
  return B.restaurant;
}

function expLabel(type, status) {
  if (type === 'evento_empresa') return 'Empresa · pendiente';
  if (type === 'evento_congreso') return 'Congreso · pendiente';
  if (type === 'evento_boda') return 'Boda · pendiente';
  if (type === 'hotel') return status === 'pending' ? 'Hotel · pendiente' : 'Hotel';
  if (type === 'otivm') return 'OTIVM (histórico)';
  if (status === 'pending') return 'Restaurante · pendiente';
  return 'Restaurante Don Fadrique';
}

function typeIcon(type) {
  if (type === 'evento_congreso') return '🏛️';
  if (type === 'evento_boda') return '💍';
  if (type === 'evento_empresa') return '🎄';
  if (type === 'hotel') return '🛏️';
  if (type === 'otivm') return '🌿';
  return '🍽️';
}

function isPendingEvent(type) {
  return type === 'evento_empresa' || type === 'evento_congreso' || type === 'evento_boda';
}

function inboundIso(rawMessage) {
  const ts = rawMessage && rawMessage.timestamp;
  if (ts != null && /^\d{10,13}$/.test(String(ts))) {
    const raw = String(ts);
    const ms = raw.length >= 13 ? Number(raw) : Number(raw) * 1000;
    if (Number.isFinite(ms)) return new Date(ms).toISOString();
  }
  return new Date().toISOString();
}

async function noteInbound(from, rawMessage) {
  if (typeof db.touchLastInbound !== 'function') return;
  try {
    await db.touchLastInbound(from, inboundIso(rawMessage));
  } catch (err) {
    console.error('[inbound] no se pudo guardar la hora:', err.message);
  }
}

async function deliverDeferred(from) {
  if (typeof db.listDeferredNotices !== 'function') return;
  let rows = [];
  try {
    rows = await db.listDeferredNotices(from);
  } catch (err) {
    console.error('[aviso] no se pudieron leer avisos pendientes:', err.message);
    return;
  }
  for (const row of rows) {
    try {
      const body = row.status === 'rejected' ? confirmacion.customerRejected(row) : confirmacion.customerConfirmed(row);
      await wa.sendText(from, body);
      if (typeof db.setCustomerNotice === 'function') await db.setCustomerNotice(row.id, 'sent');
    } catch (err) {
      console.error(`[aviso] no se pudo entregar #${row.id}:`, err.message);
    }
  }
}

async function handleIncoming(from, text, buttonId, rawMessage) {
  const normText = normalize(text);
  const routedButton = marketing.routeButtonId(buttonId);
  const incomingImage = !!(rawMessage && rawMessage.type === 'image');

  // El teléfono de Nico no entra en el flujo del cliente: confirma o rechaza solicitudes.
  if (confirmacion.isAdminSender(from, config.adminPhone)) {
    return handleAdmin(from, normText, text);
  }

  await noteInbound(from, rawMessage);
  await deliverDeferred(from);

  // Baja de la plantilla de marketing (texto "BAJA" o botón "No me interesa").
  if (marketing.isOptOut(normText, routedButton)) {
    return acknowledgeMarketingOptOut(from, marketing.optOutReason(normText, routedButton));
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

  if (incomingImage) {
    await rememberClientPhoto(from, session, rawMessage);
    if (!normText) {
      await wa.sendText(from, imageAck(session));
      if (!session.step || session.step === STEP.IDLE) return showMenu(from);
      return;
    }
  }

  if (!buttonId && !collectingTable(session)) {
    const reserveId = menusFiesta.matchReservation(normText);
    if (reserveId && holidayMenusNow(session, normText, reserveId)) {
      return startMenuReservation(from, reserveId);
    }
    const which = menusFiesta.matchRequest(normText);
    if (which && holidayMenusNow(session, normText, which)) {
      return sendHolidayMenus(from, which, session);
    }
  }

  if (routedButton === 'ver_fotos') {
    return sendPhotoTour(from, 'fotos', session);
  }

  const askingPhotos = !buttonId && fotos.matchPhotoRequest(normText);
  const ceremonyReply =
    session.step === STEP.GRUPO &&
    session.data &&
    session.data.stage === 'ceremony' &&
    grupos.isCeremonyReply(text, routedButton);
  if (askingPhotos && !ceremonyReply) {
    return sendPhotoTour(from, normText, session);
  }

  if (session.step === STEP.GRUPO || grupos.isGrupoButton(routedButton)) {
    const data = session.step === STEP.GRUPO ? session.data : {};
    return dispatchGrupo(
      from,
      grupos.handle({ data, text, buttonId: routedButton, from, zone: B.timezone, business: B })
    );
  }

  if (buttonId === 'exp_otivm' || (session.step !== STEP.NAME && grupos.isOtivmQuery(normText))) {
    return otivmCerrado(from);
  }

  if (!buttonId && session.step !== STEP.NAME && session.step !== STEP.GRUPO) {
    const location = faq.isLocationQuery(normText);
    const transport = faq.isTransportQuery(normText);
    const intent = grupos.classifyIncoming(normText);
    const asksFaq = location || transport;
    const withLead =
      asksFaq && intent && (intent.kind === 'empresa_overview' || intent.kind === 'congreso' || intent.kind === 'boda');
    if (asksFaq && (faq.shouldAnswerNow(text, normText) || withLead)) {
      const body = faq.reply({
        location,
        transport,
        parking: faq.isParkingQuery(normText),
        business: B,
        inFlow: withLead || session.step !== STEP.IDLE,
      });
      if (withLead) {
        const started = grupos.startIntent(intent, B);
        if (transport) started.data.transporte = true;
        started.replies = [{ kind: 'text', body }, ...started.replies];
        return dispatchGrupo(from, started);
      }
      const tail = session.step === STEP.IDLE ? '' : '\n\nCuando quieras seguimos con lo que estábamos apuntando.';
      await wa.sendText(from, body + tail);
      return;
    }
  }

  if (buttonId === 'exp_eventos') {
    return dispatchGrupo(from, grupos.startHub(B));
  }

  if (session.step !== STEP.NAME) {
    const intent = grupos.classifyIncoming(normText);
    if (intent) return dispatchGrupo(from, grupos.startIntent(intent, B));
    if (marketing.isPresupuestoText(normText)) {
      return dispatchGrupo(
        from,
        grupos.handle({ data: {}, text, buttonId: 'emp_book', from, zone: B.timezone, business: B })
      );
    }
  }

  // Selección de experiencia desde el menú
  if (buttonId === 'exp_rest') return startRestaurant(from);
  if (buttonId === 'exp_hotel') return startHotel(from);

  // Atajos por texto libre
  if (session.step === STEP.IDLE) {
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
    case STEP.HOTEL_ENTRADA:
      return handleHotelEntrada(from, text, session);
    case STEP.HOTEL_SALIDA:
      return handleHotelSalida(from, text, session);
    case STEP.HOTEL_PAX:
      return handleHotelPax(from, text, session);
    case STEP.HOTEL_QUOTE:
      return handleHotelQuote(from, buttonId, session, text);
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
    `¡Hola! 👋 Bienvenido/a a *${B.name}*.\n\n¿Qué te apetece reservar?\n\n_También puedes escribir "ver fotos", "mis reservas", "info", "boda", "comidas de Navidad" o "congreso"._`,
    [
      { id: 'exp_rest', title: '🍽️ Restaurante' },
      { id: 'exp_hotel', title: '🛏️ Hotel' },
      { id: 'exp_eventos', title: '🎉 Eventos' },
    ]
  );
}

async function sendInfo(from) {
  await wa.sendText(
    from,
    `ℹ️ *${B.name}*\n\n` +
      `📍 ${B.address}\n📞 ${B.phone}\n🌐 ${B.web}\n\n` +
      `🍽️ *Restaurante*: comidas 13:30-15:30 y cenas 20:30-22:30. Cerrado martes y miércoles.\n\n` +
      `🛏️ *Hotel*: reserva online en ${B.hotelBookingUrl} o escríbeme aquí y aviso a recepción.\n\n` +
      `🎉 *Eventos*: bodas en exclusiva, congresos y grupos grandes (capacidad total de 500 a 700; terraza acristalada de 10 a 50). ` +
      `En diciembre, comidas de Navidad para empresas: menú a medida, desde 55 € + IVA por persona. Escribe *boda*, *eventos* o *congreso*.\n\n` +
      `Escribe *ver fotos* para ver la casa, o *menu* para volver al inicio.`
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

// ---------- Flujo hotel ----------

async function startHotel(from) {
  await db.setSession(from, STEP.HOTEL_ENTRADA, { type: 'hotel' });
  await wa.sendText(
    from,
    `🛏️ *Hotel ${B.name}*\n\n¿Qué día quieres *entrar* (check-in)? (ej: "15/08", "viernes", "mañana")`
  );
}

async function handleHotelEntrada(from, text, session) {
  const zone = B.timezone;
  const dt = parseDate(text, zone);
  const now = DateTime.now().setZone(zone).startOf('day');
  if (!dt) {
    return wa.sendText(from, 'No entendí la fecha 🤔. Dime el día de entrada (ej: "15/08", "viernes").');
  }
  if (dt < now) {
    return wa.sendText(from, 'Esa fecha ya pasó. Dime otra fecha de entrada, por favor.');
  }
  session.data.entrada = dt.toFormat('yyyy-MM-dd');
  session.data.entradaLabel = dt.setLocale('es').toFormat("cccc d 'de' LLLL");
  await db.setSession(from, STEP.HOTEL_SALIDA, session.data);
  await wa.sendText(from, `Entrada el ${session.data.entradaLabel}. ¿Y qué día *sales* (check-out)?`);
}

async function handleHotelSalida(from, text, session) {
  const zone = B.timezone;
  const dt = parseDate(text, zone);
  if (!dt) {
    return wa.sendText(from, 'No entendí la fecha de salida 🤔. Dime el día de check-out (ej: "17/08").');
  }
  const entrada = DateTime.fromFormat(session.data.entrada, 'yyyy-MM-dd', { zone });
  if (dt <= entrada) {
    return wa.sendText(from, 'La salida tiene que ser posterior a la entrada. Dime otra fecha de salida.');
  }
  session.data.salida = dt.toFormat('yyyy-MM-dd');
  session.data.salidaLabel = dt.setLocale('es').toFormat("cccc d 'de' LLLL");
  session.data.noches = Math.round(dt.diff(entrada, 'days').days);
  await db.setSession(from, STEP.HOTEL_PAX, session.data);
  await wa.sendText(from, `${session.data.noches} noche(s). ¿Para cuántas personas?`);
}

async function handleHotelPax(from, text, session) {
  const n = parseInt(normalize(text).replace(/[^\d]/g, ''), 10);
  if (!n || n < 1 || n > 6) {
    return wa.sendText(from, 'Dime un número válido de personas (1-6). Para grupos mayores, llámanos al 923 37 00 76.');
  }
  session.data.pax = n;

  const knownName = await db.getCustomerName(from);
  if (knownName) {
    session.data.name = knownName;
    return quoteHotel(from, session);
  }
  await db.setSession(from, STEP.NAME, session.data);
  await wa.sendText(from, '¿A nombre de quién hago la reserva?');
}

// Comprueba disponibilidad real, bloquea la habitacion como 'pendiente' y ofrece el precio
async function quoteHotel(from, session) {
  const d = session.data;
  await wa.sendText(from, 'Un momento, compruebo disponibilidad y precio… ⏳');

  let habitacion = null;
  try {
    habitacion = await hotelApi.findFreeRoom(d.entrada, d.salida, d.pax);
  } catch (err) {
    console.error('[hotel] Error consultando disponibilidad:', err.message);
  }

  if (!habitacion) {
    await db.clearSession(from);
    await wa.sendText(
      from,
      `Lo siento, no nos queda disponibilidad para esas fechas 😔\n📅 ${d.entradaLabel} → ${d.salidaLabel}\n\n` +
        `Puedes probar con otras fechas escribiendo *hotel*, o llamarnos al ${B.phone} y lo miramos contigo.`
    );
    return;
  }

  const pms = await hotelApi.createReservation({
    habitacionId: habitacion,
    fechaEntrada: d.entrada,
    fechaSalida: d.salida,
    nombre: d.name,
    telefono: from,
    pax: d.pax,
    obs: `Reserva por WhatsApp (bot). Tel cliente: ${from}. Pendiente de aceptar precio.`,
  });

  if (!pms.ok) {
    await db.clearSession(from);
    await wa.sendText(
      from,
      `Ha habido un problema al reservar esas fechas 😔. Llámanos al ${B.phone} y lo solucionamos enseguida.`
    );
    if (config.adminPhone) {
      await wa.sendText(config.adminPhone, `⚠️ Error del bot al crear reserva de hotel (${d.entrada} -> ${d.salida}, ${d.pax}p, ${d.name}, tel ${from}): ${pms.msg}`);
    }
    return;
  }

  session.data.pmsId = pms.id;
  session.data.habitacion = pms.habitacionId;
  session.data.precioNoche = pms.precioNoche;
  session.data.precioTotal = pms.precioTotal;
  await db.setSession(from, STEP.HOTEL_QUOTE, session.data);

  await wa.sendButtons(
    from,
    `¡Tenemos disponibilidad! ✅\n\n` +
      `📅 Entrada: ${d.entradaLabel}\n📅 Salida: ${d.salidaLabel}\n🌙 ${d.noches} noche(s)\n👥 ${d.pax} personas\n\n` +
      `💶 *Precio: ${pms.precioTotal.toFixed(2)}€* en total (${pms.precioNoche.toFixed(2)}€/noche)\n` +
      `_Solo alojamiento. El pago se realiza a tu llegada al hotel._\n\n` +
      `¿Envío la solicitud? El equipo la confirma y te aviso por aquí.`,
    [
      { id: 'confirm_yes', title: '✅ Confirmar' },
      { id: 'confirm_no', title: '❌ No, gracias' },
    ]
  );
}

async function handleHotelQuote(from, buttonId, session, text) {
  const normText = normalize(text);
  const isYes = buttonId === 'confirm_yes' || ['si', 'sí', 'vale', 'ok', 'confirmar', 'confirmo', 'acepto'].includes(normText);
  const isNo = buttonId === 'confirm_no' || ['no', 'cancelar', 'no gracias'].includes(normText);
  const d = session.data;

  if (isYes) {
    const photoNote = fotos.clientPhotoNote(d);
    const detalles = `Entrada ${d.entrada}, Salida ${d.salida}, ${d.noches} noche(s), ${d.pax} pers. | Hab ${d.habitacion} | ${d.precioTotal} EUR | PMS ${d.pmsId}` +
      (photoNote ? ` | ${photoNote}` : '');
    await finishPendingReservation(from, {
      name: d.name,
      partySize: d.pax,
      date: d.entrada,
      time: '--:--',
      type: 'hotel',
      details: detalles,
      customerLines: [
        'Habitación',
        `Entrada: ${d.entradaLabel}`,
        `Salida: ${d.salidaLabel}`,
        `${d.noches} noche(s) · ${d.pax} personas`,
        `Total: ${Number(d.precioTotal).toFixed(2)} € (se paga a la llegada)`,
        d.name,
      ],
      adminHeading: '🛏️ HOTEL',
      adminLines: [
        `Hab: ${d.habitacion}`,
        `Entrada: ${d.entrada}`,
        `Salida: ${d.salida}`,
        `${d.noches} noche(s) · ${d.pax} pers.`,
        `💶 ${Number(d.precioTotal).toFixed(2)} € (paga a la llegada)`,
        `PMS ${d.pmsId} (sigue pendiente hasta que confirmes)`,
        photoNote,
      ],
    });
    return;
  }

  if (isNo) {
    await hotelApi.deleteReservation(d.pmsId);
    await db.clearSession(from);
    return wa.sendText(
      from,
      `Sin problema, he liberado la reserva. 😊\n\nSi quieres probar otras fechas escribe *hotel*, o llámanos al ${B.phone}.`
    );
  }

  return wa.sendText(from, 'Responde "Confirmar" si te va bien el precio, o "No, gracias" para cancelar.');
}

// ---------- Pasos comunes (fecha/hora/personas/nombre/confirmación) ----------

async function handleDateStep(from, text, session) {
  if (session.data.type === 'otivm') return otivmCerrado(from);
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

  const slots = getSlotsForDate(dt, cfg);
  if (slots.length === 0) {
    return wa.sendText(from, 'Ese día no abrimos 😔 (el restaurante cierra martes y miércoles). Prueba con otra fecha.');
  }

  session.data.date = dt.toFormat('yyyy-MM-dd');
  session.data.dateLabel = dt.setLocale('es').toFormat("cccc d 'de' LLLL");
  await db.setSession(from, STEP.TIME, session.data);

  const hint = '(ej: "14:00" para comer, "21:00" para cenar)';
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
  if (session.data.type === 'hotel') return quoteHotel(from, session);
  return goToConfirm(from, session);
}

async function goToConfirm(from, session) {
  if (session.data.type === 'otivm') return otivmCerrado(from);
  await db.setSession(from, STEP.CONFIRM, session.data);
  const d = session.data;

  if (d.menuId) {
    const resumen =
      `Confirma tu reserva del *${d.menuTitle}*:\n📅 ${d.dateLabel}\n💶 ${d.menuPrice}\n👥 ${d.partySize} personas\n🙋 ${d.name}\n\n¿Envío la solicitud?`;
    await wa.sendButtons(from, resumen, [
      { id: 'confirm_yes', title: '✅ Confirmar' },
      { id: 'confirm_no', title: '❌ Cancelar' },
    ]);
    return;
  }

  const resumen = `Confirma tu solicitud en el *Restaurante*:\n📅 ${d.dateLabel}\n🕐 ${d.time}\n👥 ${d.partySize} personas\n🙋 ${d.name}\n\n¿Envío la solicitud?`;

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
    if (d.type === 'otivm') return otivmCerrado(from);
    if (d.menuId) return confirmMenuReservation(from, session);

    const photoNote = fotos.clientPhotoNote(d);
    await finishPendingReservation(from, {
      name: d.name,
      partySize: d.partySize,
      date: d.date,
      time: d.time,
      type: d.type,
      details: photoNote || undefined,
      customerLines: ['Mesa en el restaurante', `${d.dateLabel} · ${d.time}`, `${d.partySize} personas`, d.name],
      adminHeading: '🍽️ RESTAURANTE',
      adminLines: [`${d.dateLabel} ${d.time}`, `${d.partySize} personas`, photoNote],
    });
    return;
  }

  if (isNo) {
    await db.clearSession(from);
    return wa.sendText(from, 'Sin problema, no he guardado nada. Escribe "menu" cuando quieras empezar de nuevo. 😊');
  }

  return wa.sendText(from, 'Responde "Confirmar" o "Cancelar", por favor.');
}

// ---------- Comandos de administrador ----------

async function handleAdmin(from, normText, rawText) {
  if (['hoy', 'reservas hoy'].includes(normText)) return sendAdminList(from, 0);
  if (['manana', 'reservas manana'].includes(normText)) return sendAdminList(from, 1);
  if (['semana', 'reservas semana'].includes(normText)) return sendAdminList(from, 7);

  const parsed = confirmacion.parseAdminDecision(rawText);
  if (!parsed) return wa.sendText(from, confirmacion.adminHelp());

  try {
    const result = await applyDecision(parsed);
    await wa.sendText(from, result.adminText);
  } catch (err) {
    console.error('[decision]', err.message);
    await wa.sendText(from, 'No he podido actualizar esa solicitud. Prueba de nuevo o usa el panel.');
  }
}

async function sendAdminList(from, daysAhead) {
  const zone = B.timezone;
  const start = DateTime.now().setZone(zone).startOf('day');
  const end = daysAhead === 7 ? start.plus({ days: 7 }) : start.plus({ days: daysAhead });
  const fromDate = (daysAhead === 1 ? start.plus({ days: 1 }) : start).toFormat('yyyy-MM-dd');
  const toDate = end.toFormat('yyyy-MM-dd');

  const list = await db.getReservationsByDateRange(fromDate, toDate);
  const pendingSource =
    typeof db.listPendingReservations === 'function'
      ? await db.listPendingReservations()
      : await db.getPendingEventRequests();
  const pending = pendingSource.filter((r) => r.date >= fromDate && r.date <= toDate);
  if (list.length === 0 && pending.length === 0) {
    return wa.sendText(from, `📋 Sin reservas entre ${fromDate} y ${toDate}.`);
  }

  let msg = '';
  if (list.length) {
    msg += `📋 *Reservas ${fromDate}${toDate !== fromDate ? ' → ' + toDate : ''}* (${list.length})\n`;
    let currentDate = '';
    for (const r of list) {
      if (r.date !== currentDate) {
        currentDate = r.date;
        msg += `\n📅 *${r.date}*\n`;
      }
      msg += `${typeIcon(r.type)} #${r.id} ${r.time} · ${r.name}${r.party_size ? ' · ' + r.party_size + 'p' : ''}${r.details ? ' · ' + r.details : ''} · 📱${r.phone}\n`;
    }
  }
  if (pending.length) {
    msg += `\n⏳ *Solicitudes pendientes de confirmación*\n`;
    for (const r of pending) {
      msg += `${typeIcon(r.type)} #${r.id} ${r.date} ${r.time} · ${r.name}${r.party_size ? ' · ' + r.party_size + 'p' : ''}${r.details ? ' · ' + r.details : ''} · 📱${r.phone}\n`;
    }
  }
  msg += `\n_Comandos: "hoy", "mañana", "semana". Para una solicitud: OK 123 o NO 123 motivo._`;
  await wa.sendText(from, msg);
}

// ---------- Mis reservas / cancelación ----------

async function showMyReservations(from) {
  const list = await db.getUpcomingReservations(from);
  if (list.length === 0) {
    return wa.sendText(from, 'No tienes reservas próximas. Escribe "menu" para crear una.');
  }

  const rows = list.slice(0, 10).map((r) => {
    return {
      id: `cancel_${r.id}`,
      title: `#${r.id} ${r.date} ${r.time}`.slice(0, 24),
      description: `${typeIcon(r.type)} ${expLabel(r.type, r.status)}${r.party_size ? ' · ' + r.party_size + 'p' : ''}`.slice(0, 72),
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
  const row = await db.getReservationById(id, from);
  const ok = await db.cancelReservation(id, from);
  await db.clearSession(from);
  if (ok) {
    let text;
    if (row && isPendingEvent(row.type)) text = `Solicitud #${id} anulada. Seguía pendiente de presupuesto.`;
    else if (row && row.status === 'pending') text = `Solicitud #${id} anulada. Seguía pendiente de confirmación.`;
    else text = `Reserva #${id} cancelada. ¡Esperamos verte pronto! 👋`;
    await wa.sendText(from, text);
    if (config.adminPhone) {
      await wa.sendText(config.adminPhone, `❌ CANCELACIÓN — reserva #${id} (tel ${from})`);
    }
  } else {
    await wa.sendText(from, 'No pude cancelar esa reserva.');
  }
}

async function acknowledgeMarketingOptOut(from, reason) {
  try {
    await db.markMarketingOptOut(from, reason);
  } catch (err) {
    console.error('[marketing] no se pudo guardar el opt-out:', err.message);
  }
  await wa.sendText(from, marketing.OPT_OUT_ACK);
}

async function dispatchGrupo(from, result) {
  if (!result) return;
  if (result.goHome) return showMenu(from);
  if (result.customerName) await db.upsertCustomerName(from, result.customerName);

  if (result.reservation) {
    let id;
    try {
      id = await db.createReservation(result.reservation.record);
    } catch (err) {
      console.error('[eventos] No se pudo guardar la solicitud:', err.message);
      await wa.sendText(
        from,
        `No he podido anotar la solicitud ahora mismo. Llámanos al ${B.phone} y la tomamos por teléfono.`
      );
      return;
    }
    await db.clearSession(from);
    await sendReplies(from, grupos.stampId(result.replies, id));
    await notifyAdminOfBudget(id, result.reservation);
    return;
  }

  if (result.clear) await db.clearSession(from);
  else if (result.data) await db.setSession(from, STEP.GRUPO, result.data);
  await sendReplies(from, result.replies || []);
}

function formatSendError(err) {
  const meta = err?.response?.data?.error;
  if (meta) {
    const code = meta.code != null ? ` code ${meta.code}` : '';
    return `${meta.message || 'error de Meta'}${code}`;
  }
  return err?.message || String(err);
}

function oneLine(value) {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Primero el texto de sesión. Si Meta lo rechaza (p. ej. 131047, fuera de 24 h),
// plantilla UTILITY con un solo parámetro. Si también falla, queda marcado en /admin.
async function notifyAdminOfBudget(id, reservation) {
  if (!config.adminPhone || !reservation?.adminText) return;
  try {
    const [adminReply] = grupos.stampId([{ kind: 'text', body: reservation.adminText }], id);
    const summarySource = reservation.alertSummary || `Solicitud #{{id}}`;
    const [summaryReply] = grupos.stampId([{ kind: 'text', body: summarySource }], id);
    const summary = oneLine(summaryReply.body) || `Solicitud #${id}`;

    try {
      await wa.sendText(config.adminPhone, `${adminReply.body}\n\n${confirmacion.adminInstructions(id)}`);
      return;
    } catch (err) {
      console.error(`[admin-alert] texto de sesión no enviado para #${id}: ${formatSendError(err)}`);
    }

    try {
      if (typeof wa.sendTemplate !== 'function') {
        throw new Error('este proveedor no puede enviar plantillas');
      }
      await wa.sendTemplate(config.adminPhone, {
        name: config.adminAlertTemplate,
        language: 'es',
        bodyParameters: [summary],
      });
      console.log(`[admin-alert] plantilla ${config.adminAlertTemplate} enviada para #${id}`);
    } catch (err) {
      console.error(`[admin-alert] plantilla no enviada para #${id}: ${formatSendError(err)}`);
      try {
        await db.markAdminAlertFailed(id);
      } catch (markErr) {
        console.error(`[admin-alert] no se pudo marcar el fallo de #${id}: ${markErr.message}`);
      }
    }
  } catch (err) {
    console.error(`[admin-alert] fallo inesperado en #${id}: ${formatSendError(err)}`);
    try {
      await db.markAdminAlertFailed(id);
    } catch (markErr) {
      console.error(`[admin-alert] no se pudo marcar el fallo de #${id}: ${markErr.message}`);
    }
  }
}

async function rememberClientPhoto(from, session, rawMessage) {
  if (!session || !session.step || session.step === STEP.IDLE) return;
  const data = { ...(session.data || {}) };
  data.fotosCliente = (Number(data.fotosCliente) || 0) + 1;
  const caption = rawMessage && rawMessage.image && rawMessage.image.caption;
  if (caption && !data.fotoCaption) {
    data.fotoCaption = String(caption).replace(/\s+/g, ' ').trim().slice(0, 120);
  }
  session.data = data;
  await db.setSession(from, session.step, data);
}

function imageAck(session) {
  if (session.step === STEP.GRUPO) {
    return (
      'Gracias por la foto. La dejo anotada en la solicitud. ' +
      'Si puedes, cuéntame por texto qué es y seguimos con lo que estábamos apuntando.'
    );
  }
  if (session.step && session.step !== STEP.IDLE) {
    return 'Gracias por la foto. Por aquí te leo en texto: cuéntame qué es y seguimos con lo que estábamos apuntando.';
  }
  return 'Gracias por la foto. Cuéntame por texto qué necesitas (una mesa, el hotel, una boda o un evento) y te ayudo.';
}

async function sendImageSafe(from, photo) {
  const label = photo.file || photo.link || photo.id || 'imagen';
  try {
    if (typeof wa.sendImage !== 'function') throw new Error('este proveedor no envía imágenes');
    const payload = { caption: photo.caption || photo.body || '' };
    if (photo.id) payload.id = photo.id;
    else payload.link = photo.link || fotos.publicUrl(photo.file, photo.folder || 'fotos');
    await wa.sendImage(from, payload);
  } catch (err) {
    console.error(`[fotos] no se pudo enviar ${label}: ${formatSendError(err)}`);
  }
}

async function deliverPhotos(from, photos) {
  for (const photo of photos) await sendImageSafe(from, photo);
}

function collectingTable(session) {
  return [
    STEP.DATE,
    STEP.TIME,
    STEP.PARTY,
    STEP.NAME,
    STEP.CONFIRM,
    STEP.HOTEL_ENTRADA,
    STEP.HOTEL_SALIDA,
    STEP.HOTEL_PAX,
    STEP.HOTEL_QUOTE,
    STEP.CANCEL_SELECT,
  ].includes(session && session.step);
}

async function startMenuReservation(from, which) {
  const menu = menusFiesta.BY_ID[which];
  const cfg = expConfig('restaurante');
  await db.setSession(from, STEP.PARTY, {
    type: 'restaurante',
    menuId: which,
    date: menu.isoDate,
    dateLabel: menu.date,
    time: 'menú',
    menuTitle: menu.title,
    menuPrice: menu.price,
  });
  await sendReplies(from, [
    ...menusFiesta.reservationReplies(which),
    { kind: 'text', body: `¿Para cuántas personas? (máx. ${cfg.maxPartySize})` },
  ]);
}

async function finishPendingReservation(from, fields) {
  const id = await db.createReservation({
    phone: from,
    name: fields.name,
    partySize: fields.partySize,
    date: fields.date,
    time: fields.time,
    type: fields.type,
    details: fields.details,
    status: 'pending',
  });
  await db.clearSession(from);
  await wa.sendText(
    from,
    confirmacion.customerPending({
      id,
      businessName: B.name,
      lines: fields.customerLines,
    })
  );
  const adminLines = (fields.adminLines || []).filter((line) => line != null && String(line).trim() !== '');
  const adminBody = [
    `${fields.adminHeading} — solicitud #${id} pendiente`,
    ...adminLines,
    `Nombre: ${fields.name}`,
    `Tel: ${from}`,
    '',
    confirmacion.adminInstructions(id),
  ].join('\n');
  await notifyAdminText(id, adminBody);
  return id;
}

async function notifyAdminText(id, body) {
  if (!config.adminPhone) return;
  try {
    await wa.sendText(config.adminPhone, body);
  } catch (err) {
    console.error(`[admin-alert] texto no enviado para #${id}: ${formatSendError(err)}`);
    try {
      if (typeof db.markAdminAlertFailed === 'function') await db.markAdminAlertFailed(id);
    } catch (markErr) {
      console.error(`[admin-alert] no se pudo marcar el fallo de #${id}: ${markErr.message}`);
    }
  }
}

async function confirmMenuReservation(from, session) {
  const d = session.data;
  const photoNote = fotos.clientPhotoNote(d);
  const details = `${d.menuTitle} · ${d.menuPrice}` + (photoNote ? ` | ${photoNote}` : '');
  await finishPendingReservation(from, {
    name: d.name,
    partySize: d.partySize,
    date: d.date,
    time: d.time,
    type: 'restaurante',
    details,
    customerLines: [d.menuTitle, d.dateLabel, d.menuPrice, `${d.partySize} personas`, d.name],
    adminHeading: '🍽️ RESTAURANTE',
    adminLines: [d.menuTitle, d.dateLabel, d.menuPrice, `${d.partySize} personas`, photoNote],
  });
}

function holidayMenusNow(session, norm, which) {
  if (!session || session.step !== STEP.GRUPO) return true;
  const flow = session.data && session.data.flow;
  if (flow === 'boda' || flow === 'congreso') {
    return /\b(?:menu|menus|carta)\b/.test(norm) && /navidad|nochevieja|ano nuevo/.test(norm);
  }
  return true;
}

async function sendHolidayMenus(from, which, session) {
  const inFlow = !!(session && session.step && session.step !== STEP.IDLE);
  await sendReplies(from, menusFiesta.replies(which, { followUp: !inFlow }));
  if (inFlow) {
    await wa.sendText(from, 'Cuando quieras seguimos con lo que estábamos apuntando.');
    return;
  }
  await db.clearSession(from);
}

async function sendPhotoTour(from, norm, session) {
  const category = fotos.matchPhotoRequest(norm) || fotos.categoryFor(norm);
  await deliverPhotos(from, fotos.album(category));
  if (session.step && session.step !== STEP.IDLE) {
    await wa.sendText(from, 'Cuando quieras seguimos con lo que estábamos apuntando.');
    return;
  }
  const intent = grupos.classifyIncoming(norm);
  if (intent && intent.kind === 'boda') {
    return dispatchGrupo(from, grupos.startBoda(B, { withPhotos: false }));
  }
  if (intent && intent.kind === 'congreso') {
    return dispatchGrupo(from, grupos.startCongreso(B, { withPhotos: false }));
  }
  if (intent && (intent.kind === 'empresa_overview' || intent.kind === 'hub')) {
    return dispatchGrupo(from, grupos.startIntent(intent, B));
  }
  if (/habitacion|dormir|alojamiento|\bhotel\b/.test(norm)) return startHotel(from);
  if (/reserv|\bmesa\b|comer|cenar|restaurante/.test(norm)) return startRestaurant(from);
  return showMenu(from);
}

async function sendReplies(from, replies) {
  for (const r of replies) {
    if (r.kind === 'image') {
      await sendImageSafe(from, r);
      continue;
    }
    if (r.kind === 'buttons') await wa.sendButtons(from, r.body, r.buttons);
    else await wa.sendText(from, r.body);
  }
}

async function otivmCerrado(from) {
  await db.clearSession(from);
  await wa.sendButtons(
    from,
    'OTIVM es un espacio en la zona de cocina y fuera de temporada está cerrado. No puedo reservarlo.\n\n¿Seguimos con el restaurante, el hotel o un evento?',
    [
      { id: 'exp_rest', title: '🍽️ Restaurante' },
      { id: 'exp_hotel', title: '🛏️ Hotel' },
      { id: 'exp_eventos', title: '🎉 Eventos' },
    ]
  );
}

module.exports = { handleIncoming };

const { DateTime } = require('luxon');
const config = require('./config');
const db = require('./db');
const wa = require('./wa');
const { parseDate, parseTimeCandidates, getSlotsForDate, normalize } = require('./dateParser');
const hotelApi = require('./hotelApi');
const grupos = require('./grupos');
const tours = require('./turoperadores');
const barra = require('./barraNavidad');
const galeria = require('./galeriaCatering');
const faq = require('./faqLlegada');
const marketing = require('./marketing');
const fotos = require('./fotos');
const menusFiesta = require('./menusFiesta');
const confirmacion = require('./confirmacion');
const weddingSources = require('./weddingSources');
const mailer = require('./mailer');
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
  if (type === 'evento_turoperador') return 'Turoperador / grupo · pendiente';
  if (type === 'hotel') return status === 'pending' ? 'Hotel · pendiente' : 'Hotel';
  if (type === 'otivm') return 'OTIVM (histórico)';
  if (status === 'pending') return 'Restaurante · pendiente';
  return 'Restaurante Don Fadrique';
}

function typeIcon(type) {
  if (type === 'evento_congreso') return '🏛️';
  if (type === 'evento_boda') return '💍';
  if (type === 'evento_empresa') return '🎄';
  if (type === 'evento_turoperador') return '🚌';
  if (type === 'hotel') return '🛏️';
  if (type === 'otivm') return '🌿';
  return '🍽️';
}

function isPendingEvent(type) {
  return type === 'evento_empresa' || type === 'evento_congreso' || type === 'evento_boda' || type === 'evento_turoperador';
}

function isCollectingOtherGroup(session) {
  if (!session || session.step !== STEP.GRUPO) return false;
  const data = session.data || {};
  if (!data.flow || data.flow === 'turoperador') return false;
  if (!data.stage || data.stage === 'hub' || data.stage === 'browse') return false;
  return true;
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

  // Los teléfonos de administración no entran en el flujo del cliente: confirman o rechazan.
  if (confirmacion.isAdminSender(from, config.adminPhones || config.adminPhone)) {
    await noteInbound(from, rawMessage);
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

  if (barraTurn(session, normText, routedButton)) {
    return handleBarra(from, session, text, normText, routedButton);
  }

  const activeTour = session.step === STEP.GRUPO && session.data && session.data.flow === 'turoperador';
  if (!activeTour && session.step !== STEP.NAME && !isCollectingOtherGroup(session) && tours.isInquiry(normText)) {
    return dispatchGrupo(from, tours.start(B, { text }), { text, buttonId: routedButton });
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

  if (galleryTurn(session, normText, routedButton)) {
    return handleGallery(from, session, text, normText, routedButton);
  }

  if (routedButton === 'ver_fotos') {
    return sendPhotoTour(from, 'fotos', session);
  }

  if (
    session.step === STEP.GRUPO &&
    session.data &&
    session.data.flow === 'boda' &&
    !buttonId &&
    fotos.isMoreWeddingPhotos(normText)
  ) {
    return sendMoreWeddingPhotos(from, session, text);
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

  if (activeTour || tours.isTourButton(routedButton)) {
    const data = activeTour ? session.data : {};
    return dispatchGrupo(
      from,
      tours.handle({ data, text, buttonId: routedButton, from, zone: B.timezone, business: B }),
      { text, buttonId: routedButton }
    );
  }

  if (session.step === STEP.GRUPO || grupos.isGrupoButton(routedButton)) {
    const data = session.step === STEP.GRUPO ? session.data : {};
    return dispatchGrupo(
      from,
      grupos.handle({ data, text, buttonId: routedButton, from, zone: B.timezone, business: B }),
      { text, buttonId: routedButton }
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
        const started = grupos.startIntent(intent, B, { text });
        if (transport) started.data.transporte = true;
        started.replies = [{ kind: 'text', body }, ...started.replies];
        return dispatchGrupo(from, started, { text, buttonId });
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
    if (intent) return dispatchGrupo(from, grupos.startIntent(intent, B, { text }), { text, buttonId });
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
    `¡Hola! 👋 Bienvenido/a a *${B.name}*.\n\n¿Qué te apetece reservar?\n\n_También puedes escribir "ver fotos", "mis reservas", "info", "boda", "comidas de Navidad", "congreso" o "turoperador"._`,
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
      `En diciembre, comidas de Navidad para empresas: menú a medida, desde 55 € + IVA por persona. ` +
      `Para una boda, escribid «Quiero información para mi boda». También vale *eventos* o *congreso*.\n\n` +
      `🚌 *Turoperadores*: comida de grupo y alojamiento para agencias, DMC y guías. Escribe *turoperador* y dejo la solicitud para la propuesta de 2027.\n\n` +
      `Escribe *ver fotos* para ver la casa, o *menu* para volver al inicio.`
  );
}

// ---------- Flujo restaurante ----------

function barraTurn(session, normText, buttonId) {
  if (buttonId === 'barra_book' || buttonId === 'barra_later' || buttonId === 'barra_question') return true;
  if (session && session.step === 'BARRA') return true;
  if (session && session.data && session.data.barraNavidad && barra.isMenuQuestion(normText)) return true;
  if (!barra.isIntent(normText)) return false;
  if (session && session.step === STEP.NAME) return false;
  if (isCollectingOtherGroup(session)) return false;
  if (collectingTable(session)) return false;
  if (session && session.step === STEP.GRUPO && session.data && session.data.flow === 'turoperador') return false;
  return true;
}

async function sendDocumentSafe(from, document) {
  try {
    if (typeof wa.sendDocument !== 'function') throw new Error('este proveedor no envía documentos');
    await wa.sendDocument(from, document);
  } catch (err) {
    console.error(`[barra] no se pudo enviar la carta: ${formatSendError(err)}`);
  }
}

function galleryTurn(session, normText, buttonId) {
  if (buttonId === 'gal_si' || buttonId === 'gal_no' || buttonId === 'gal_more' || buttonId === 'gal_quote' || buttonId === 'cong_fotos') {
    return true;
  }
  if (session && session.step === 'GALERIA') return true;
  if (!galeria.isRequest(normText)) return false;
  if (session && session.step === STEP.NAME) return false;
  if (collectingTable(session)) return false;
  return true;
}

async function sendImagesInOrder(from, photos) {
  for (let i = 0; i < photos.length; i += 1) {
    await galeria.waitTurn(i);
    await sendImageSafe(from, photos[i]);
  }
  if (photos.length) await galeria.waitTurn(1);
}

async function handleGallery(from, session, text, normText, buttonId) {
  const stored = (session && session.data) || {};
  const lang = galeria.requestLang(text, stored.lang || 'es');
  const inGroup = session && session.step === STEP.GRUPO;
  if (buttonId === 'gal_no' || (session && session.step === 'GALERIA' && galeria.declines(normText, buttonId))) {
    await wa.sendText(from, galeria.declined(lang));
    return showMenu(from);
  }
  if (!inGroup && (buttonId === 'gal_quote' || buttonId === 'gal_si' || (session && session.step === 'GALERIA' && galeria.wantsQuote(normText, buttonId)))) {
    return dispatchGrupo(
      from,
      grupos.startCongreso(B, { text: stored.eventType || '', withPhotos: false, lang, seed: stored }),
      { text, buttonId }
    );
  }
  if (!inGroup && (buttonId === 'gal_more' || (session && session.step === 'GALERIA' && galeria.wantsMore(normText, buttonId)))) {
    if (!stored.seenMore) await sendImagesInOrder(from, galeria.remaining());
    const card = galeria.moreOffer(lang);
    const body = stored.seenMore
      ? lang === 'en'
        ? 'Those are all the photos. We can prepare a quote whenever you want.'
        : 'Esas son todas las fotos. Si quieres, preparamos el presupuesto.'
      : card.body;
    await wa.sendButtons(from, body, card.buttons);
    await db.setSession(from, 'GALERIA', { ...stored, flow: 'galeria', lang, seenMore: true });
    return;
  }
  if (session && session.step === 'GALERIA') {
    const facts = grupos.previewFacts(text, B.timezone);
    const next = { ...stored, flow: 'galeria', lang };
    grupos.applyCongressFacts(next, facts);
    const reply = galeria.answer(normText, lang);
    const ack = grupos.factAck(facts, lang);
    const card = galeria.offer(lang);
    const body = [reply, ack, card.body].filter(Boolean).join('\n\n');
    await wa.sendButtons(from, body, card.buttons);
    await db.setSession(from, 'GALERIA', next);
    return;
  }
  if (inGroup) {
    await sendImagesInOrder(from, galeria.photos());
    await wa.sendText(
      from,
      lang === 'en'
        ? 'Whenever you want, we can continue with what we were noting down.'
        : 'Cuando quieras seguimos con lo que estábamos apuntando.'
    );
    return;
  }
  await wa.sendText(from, galeria.intro(lang));
  await sendImagesInOrder(from, galeria.highlights());
  const card = galeria.offer(lang);
  await wa.sendButtons(from, card.body, card.buttons);
  await db.setSession(from, 'GALERIA', { flow: 'galeria', lang });
}

async function startBarraBooking(from, lang, extra) {
  await db.setSession(from, STEP.DATE, {
    ...(extra || {}),
    type: 'restaurante',
    barraNavidad: true,
    lang: lang || (extra && extra.lang) || 'es',
  });
  await wa.sendText(from, barra.datePrompt(lang || (extra && extra.lang) || 'es'));
}

function barraData(session, lang) {
  const previous = (session && session.data) || {};
  return { ...previous, type: 'restaurante', barraNavidad: true, lang: lang || previous.lang || 'es' };
}

async function showBarraButtons(from, lang, body) {
  await wa.sendButtons(from, body || barra.follow(lang), barra.buttons(lang));
}

async function handleBarra(from, session, text, normText, buttonId) {
  const previous = (session && session.data) || {};
  const lang = (session && session.step === 'BARRA' && previous.lang) || barra.replies(text).lang;
  const card = barra.replies(lang === 'en' ? 'please show the wine list' : 'la carta');
  const onBarra = session && (session.step === 'BARRA' || previous.barraNavidad);

  if (buttonId === 'barra_later') {
    await db.clearSession(from);
    return showMenu(from);
  }
  if (buttonId === 'barra_question') {
    await db.setSession(from, 'BARRA', barraData(session, lang));
    await showBarraButtons(
      from,
      lang,
      lang === 'en' ? 'Of course. Ask me, and I’ll answer from the menu.' : 'Claro. Pregúntame y te contesto con la carta.'
    );
    return;
  }
  if (onBarra && barra.isMenuQuestion(normText)) {
    await wa.sendText(from, barra.answerQuestion(text));
    if (/carta|\bmenu\b/.test(normText)) await sendDocumentSafe(from, card.document);
    await db.setSession(from, 'BARRA', barraData(session, lang));
    await showBarraButtons(from, lang, barra.follow(lang));
    return;
  }
  if (onBarra && barra.wantsBooking(normText, buttonId)) {
    const data = barraData(session, lang);
    await db.setSession(from, 'BARRA', data);
    return startBarraBooking(from, lang, data);
  }
  if (onBarra && session.step === 'BARRA') {
    const note = (text || '').replace(/\s+/g, ' ').trim().slice(0, 240);
    if (note && (barra.isSpecialNeeds(normText) || !/[?]/.test(text || ''))) {
      const data = barraData(session, lang);
      data.notes = note;
      await db.setSession(from, 'BARRA', data);
      const ack = lang === 'en' ? `Noted: ${note}` : `Lo anoto: ${note}`;
      await showBarraButtons(from, lang, `${ack}\n\n${barra.follow(lang)}`);
      return;
    }
    await db.setSession(from, 'BARRA', barraData(session, lang));
    await showBarraButtons(
      from,
      lang,
      lang === 'en'
        ? 'I can answer from the menu, or book when you want. I won’t ask for the day yet.'
        : 'Puedo contarte la carta, o reservar cuando queráis. Todavía no pido el día.'
    );
    return;
  }

  await wa.sendText(from, lang === 'en' ? barra.intro('en') : barra.intro('es'));
  await sendDocumentSafe(from, card.document);
  if (barra.isMenuQuestion(normText)) await wa.sendText(from, barra.answerQuestion(text));
  await showBarraButtons(from, lang, barra.follow(lang));
  await db.setSession(from, 'BARRA', barraData(session, lang));
}

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
    await notifyAdminEscalation({
      kind: 'error',
      type: 'hotel',
      name: d.name,
      phone: from,
      date: d.entrada,
      time: '',
      partySize: d.pax,
      details: `Error del PMS: ${pms.msg}. Entrada ${d.entrada}, salida ${d.salida}, ${d.pax} personas, ${d.name}.`,
      whatsappBody: `⚠️ Error del bot al crear reserva de hotel (${d.entrada} -> ${d.salida}, ${d.pax}p, ${d.name}, tel ${from}): ${pms.msg}`,
    });
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

  const resumen = d.barraNavidad
    ? `Confirma tu reserva de la *Barra de Navidad*:\n📅 ${d.dateLabel}\n🕐 ${d.time}\n👥 ${d.partySize} personas\n🙋 ${d.name}${d.notes ? `\n📝 ${d.notes}` : ''}\n\nImprescindible reservar. ¿Envío la solicitud?`
    : `Confirma tu solicitud en el *Restaurante*:\n📅 ${d.dateLabel}\n🕐 ${d.time}\n👥 ${d.partySize} personas\n🙋 ${d.name}\n\n¿Envío la solicitud?`;

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
    if (d.barraNavidad) {
      await finishPendingReservation(from, {
        name: d.name,
        partySize: d.partySize,
        date: d.date,
        time: d.time,
        type: d.type,
        details: ['Barra de Navidad 2026 · tapas y vinos', 'Imprescindible reservar', d.notes ? `Atenciones: ${d.notes}` : '', photoNote]
          .filter(Boolean)
          .join(' | '),
        customerLines: ['Barra de Navidad 2026', `${d.dateLabel} · ${d.time}`, `${d.partySize} personas`, d.name, d.notes || ''],
        adminHeading: '🍷 BARRA DE NAVIDAD',
        adminLines: ['Navidad 2026 · La Barra · tapas y vinos', `${d.dateLabel} ${d.time}`, `${d.partySize} personas`, d.notes ? `Atenciones: ${d.notes}` : '', photoNote],
      });
      return;
    }
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
    await notifyAdminEscalation({
      id,
      kind: 'cancelacion',
      type: row && row.type,
      name: row && row.name,
      phone: from,
      date: row && row.date,
      time: row && row.time,
      partySize: row && row.party_size,
      details: 'El cliente ha cancelado esta reserva por WhatsApp.',
      whatsappBody: `❌ CANCELACIÓN — reserva #${id} (tel ${from})`,
    });
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

async function noteWeddingTurn(from, input) {
  const canLead = typeof db.touchWeddingLead === 'function';
  const canQuestion = typeof db.addWeddingQuestion === 'function';
  if (!canLead && !canQuestion) return;
  let update;
  try {
    update = weddingSources.turnUpdate(input);
  } catch (err) {
    console.error('[boda] no se pudo leer el seguimiento:', err.message);
    return;
  }
  if (!update || (!update.lead && !update.question)) return;
  try {
    if (update.lead && canLead) await db.touchWeddingLead(from, update.lead);
    if (update.question && canQuestion) await db.addWeddingQuestion(from, update.question);
  } catch (err) {
    console.error('[boda] no se pudo guardar el seguimiento:', err.message);
  }
}

async function dispatchGrupo(from, result, ctx) {
  if (!result) return;
  let before = null;
  try {
    if (typeof db.getSession === 'function') before = await db.getSession(from);
  } catch (err) {
    before = null;
  }
  try {
    if (result.goHome) return showMenu(from);
    if (result.customerName) await db.upsertCustomerName(from, result.customerName);

    if (result.reservation) {
      let id;
      try {
        id = await db.createReservation(result.reservation.record);
        await noteConversationOutcome(from, 'solicitud');
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
  } finally {
    const context = ctx || {};
    await noteWeddingTurn(from, {
      before,
      result,
      text: context.text,
      buttonId: context.buttonId,
      sawPhotos: context.sawPhotos,
      askedMorePhotos: context.askedMorePhotos,
    });
  }
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
// El correo sale siempre, haya llegado o no el WhatsApp.
async function notifyAdminOfBudget(id, reservation) {
  const whatsapp = await deliverBudgetWhatsapp(id, reservation);
  const record = (reservation && reservation.record) || {};
  await deliverRequestEmail({
    id,
    kind: 'solicitud',
    type: record.type,
    name: record.name,
    company: reservation && reservation.company,
    phone: record.phone,
    phoneContact: reservation && reservation.phoneContact,
    date: record.date,
    time: record.time,
    partySize: record.partySize,
    details: record.details,
    source: reservation && reservation.source,
    whatsappOk: whatsapp.ok,
    whatsappSkipped: whatsapp.skipped,
  });
}

function adminPhoneList() {
  const source = Array.isArray(config.adminPhones) && config.adminPhones.length ? config.adminPhones : [config.adminPhone];
  const phones = [];
  const seen = new Set();
  for (const phone of source) {
    const digits = confirmacion.phoneDigits(phone);
    if (!digits || seen.has(digits)) continue;
    seen.add(digits);
    phones.push(digits);
  }
  return phones;
}

// null: no hay marca, se intenta el mensaje de sesión. true: ventana abierta. false: cerrada.
async function adminWindow(phone) {
  if (typeof db.getLastInbound !== 'function') return null;
  try {
    return confirmacion.isWindowOpen(await db.getLastInbound(phone));
  } catch (err) {
    console.error(`[admin-alert] no se pudo leer la ventana de ${phone}: ${err.message}`);
    return null;
  }
}

// Un intento por cada administrador. Si sabemos que su ventana de 24 h está
// cerrada, no se le escribe. Si no hay marca, se intenta el texto de sesión;
// en los presupuestos, el fallo de ese texto sigue pudiendo usar la plantilla
// de utilidad que ya existía.
async function deliverToAdmins(id, body, { allowTemplate = false, summary = '' } = {}) {
  const phones = adminPhoneList();
  if (!phones.length || !body) return { ok: false, skipped: true };
  let delivered = 0;
  for (const phone of phones) {
    const window = await adminWindow(phone);
    if (window === false) {
      console.log(`[admin-alert] ventana de 24 h cerrada para ${phone}; no se envía #${id}`);
      continue;
    }
    let textOk = false;
    try {
      await wa.sendText(phone, body);
      textOk = true;
      delivered += 1;
    } catch (err) {
      console.error(`[admin-alert] texto de sesión no enviado a ${phone} para #${id}: ${formatSendError(err)}`);
    }
    if (textOk || !allowTemplate) continue;
    try {
      if (typeof wa.sendTemplate !== 'function') {
        throw new Error('este proveedor no puede enviar plantillas');
      }
      await wa.sendTemplate(phone, {
        name: config.adminAlertTemplate,
        language: 'es',
        bodyParameters: [summary || `Solicitud #${id}`],
      });
      console.log(`[admin-alert] plantilla ${config.adminAlertTemplate} enviada a ${phone} para #${id}`);
      delivered += 1;
    } catch (err) {
      console.error(`[admin-alert] plantilla no enviada a ${phone} para #${id}: ${formatSendError(err)}`);
    }
  }
  return { ok: delivered > 0, skipped: false };
}

async function deliverBudgetWhatsapp(id, reservation) {
  if (!reservation?.adminText) return { ok: false, skipped: true };
  try {
    const [adminReply] = grupos.stampId([{ kind: 'text', body: reservation.adminText }], id);
    const summarySource = reservation.alertSummary || `Solicitud #{{id}}`;
    const [summaryReply] = grupos.stampId([{ kind: 'text', body: summarySource }], id);
    const summary = oneLine(summaryReply.body) || `Solicitud #${id}`;
    const result = await deliverToAdmins(
      id,
      `${adminReply.body}\n\n${confirmacion.adminInstructions(id)}`,
      { allowTemplate: true, summary }
    );
    if (!result.ok && !result.skipped) await markAlertFailed(id);
    return result;
  } catch (err) {
    console.error(`[admin-alert] fallo inesperado en #${id}: ${formatSendError(err)}`);
    await markAlertFailed(id);
    return { ok: false, skipped: false };
  }
}

async function markAlertFailed(id) {
  try {
    if (typeof db.markAdminAlertFailed === 'function') await db.markAdminAlertFailed(id);
  } catch (markErr) {
    console.error(`[admin-alert] no se pudo marcar el fallo de #${id}: ${markErr.message}`);
  }
}

async function deliverRequestEmail(alert) {
  const payload = { ...alert };
  try {
    if (!payload.source && payload.type === 'evento_boda' && payload.phone && typeof db.getWeddingLead === 'function') {
      try {
        const lead = await db.getWeddingLead(payload.phone);
        if (lead && lead.source) payload.source = lead.source;
      } catch (err) {
        console.error(`[email-alert] no se pudo leer el origen de #${payload.id}: ${err.message}`);
      }
    }
    if (typeof mailer.sendRequestAlert !== 'function') return;
    await mailer.sendRequestAlert(payload);
  } catch (err) {
    console.error(`[email-alert] fallo inesperado en #${payload.id}: ${err.message}`);
  }
}

async function sendAdminWhatsapp(id, body) {
  return deliverToAdmins(id, body, { allowTemplate: false });
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
  await noteConversationOutcome(from, 'solicitud');
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
  await notifyAdminText(id, adminBody, {
    type: fields.type,
    name: fields.name,
    company: fields.company,
    phone: from,
    phoneContact: fields.phoneContact,
    date: fields.date,
    time: fields.time,
    partySize: fields.partySize,
    details: fields.details,
    source: fields.source,
  });
  return id;
}

async function notifyAdminText(id, body, request) {
  const whatsapp = await sendAdminWhatsapp(id, body);
  if (!whatsapp.ok && !whatsapp.skipped) await markAlertFailed(id);
  await deliverRequestEmail({
    id,
    kind: 'solicitud',
    ...(request || {}),
    whatsappOk: whatsapp.ok,
    whatsappSkipped: whatsapp.skipped,
  });
}

async function noteConversationOutcome(phone, outcome) {
  if (typeof db.markConversationOutcome !== 'function') return;
  try {
    await db.markConversationOutcome(phone, outcome);
  } catch (err) {
    console.error('[conversacion] no se pudo anotar el cierre:', err.message);
  }
}

async function notifyAdminEscalation(request) {
  const whatsapp = await sendAdminWhatsapp(request.id, request.whatsappBody);
  await deliverRequestEmail({
    ...request,
    whatsappOk: whatsapp.ok,
    whatsappSkipped: whatsapp.skipped,
  });
  if (request && request.kind === 'error') await noteConversationOutcome(request.phone, 'escalacion');
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
  if (flow === 'boda' || flow === 'congreso' || flow === 'turoperador') {
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

async function sendMoreWeddingPhotos(from, session, text) {
  await deliverPhotos(from, fotos.moreWeddingReplies());
  await sendReplies(from, [
    { kind: 'text', body: 'Aquí van más fotos de bodas en la casa.' },
    ...grupos.promptReplies(session.data, B),
  ]);
  await noteWeddingTurn(from, {
    before: session,
    result: { data: session.data },
    text,
    askedMorePhotos: true,
    sawPhotos: true,
  });
}

async function sendPhotoTour(from, norm, session) {
  const category = fotos.matchPhotoRequest(norm) || fotos.categoryFor(norm);
  await deliverPhotos(from, fotos.album(category));
  if (session.step && session.step !== STEP.IDLE) {
    await wa.sendText(from, 'Cuando quieras seguimos con lo que estábamos apuntando.');
    return;
  }
  if (tours.isInquiry(norm)) {
    return dispatchGrupo(from, tours.start(B, { text: norm }), { text: norm });
  }
  const intent = grupos.classifyIncoming(norm);
  if (intent && intent.kind === 'boda') {
    return dispatchGrupo(from, grupos.startBoda(B, { withPhotos: false, text: norm }), {
      text: norm,
      sawPhotos: true,
    });
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
    if (r.kind === 'document') {
      await sendDocumentSafe(from, r);
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

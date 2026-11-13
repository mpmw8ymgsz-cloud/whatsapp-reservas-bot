const { DateTime } = require('luxon');
const { parseDate, normalize } = require('./dateParser');
const menus = require('./menusEmpresa');
const conocimiento = require('./eventosConocimiento');
const faq = require('./faqLlegada');
const fotos = require('./fotos');

const MONTHS = {
  enero: 1,
  febrero: 2,
  marzo: 3,
  abril: 4,
  mayo: 5,
  junio: 6,
  julio: 7,
  agosto: 8,
  septiembre: 9,
  setiembre: 9,
  octubre: 10,
  noviembre: 11,
  diciembre: 12,
};

function text(body) {
  return { kind: 'text', body };
}

function buttons(body, list) {
  return { kind: 'buttons', body, buttons: list };
}

function stampId(replies, id) {
  const token = String(id);
  return replies.map((r) => ({ ...r, body: r.body.replaceAll('{{id}}', token) }));
}

function classifyIncoming(norm) {
  if (!norm) return null;
  if (conocimiento.isBodaTopic(norm)) return { kind: 'boda' };
  if (conocimiento.isCongresoTopic(norm)) return { kind: 'congreso' };
  if (menus.isEmpresaTopic(norm)) return { kind: 'empresa_overview' };
  if (conocimiento.isHubTopic(norm)) return { kind: 'hub' };
  return null;
}

function isGrupoButton(buttonId) {
  return (
    typeof buttonId === 'string' &&
    (buttonId.startsWith('emp_') || buttonId.startsWith('cong_') || buttonId.startsWith('boda_'))
  );
}

function base(flow, stage, extra) {
  return { flow, stage, ...extra };
}

function startOverview(business) {
  return {
    data: base('empresa', 'browse'),
    replies: [buttons(menus.overviewText(business.name), menus.OFFER_BUTTONS)],
  };
}

function startCongreso(business, options = {}) {
  const replies = [text(conocimiento.congresoIntro(business.name))];
  if (options.withPhotos !== false) replies.push(...fotos.presentationReplies('congreso'));
  replies.push(text('¿A nombre de qué empresa o entidad lo preparo?'));
  return {
    data: base('congreso', 'company'),
    replies,
  };
}

function datePrompt() {
  return '¿Qué fecha tenéis en mente, aunque sea aproximada? Vale un día, una estación o el año. Si aún no lo sabéis, escribid *no lo sé todavía*.';
}

function startBoda(business, options = {}) {
  const replies = [text(conocimiento.bodaIntro(business.name))];
  if (options.withPhotos !== false) replies.push(...fotos.presentationReplies('boda'));
  replies.push(text(datePrompt()));
  return {
    data: base('boda', 'wdate'),
    replies,
  };
}

const HUB_BUTTONS = [
  { id: 'boda_start', title: 'Boda' },
  { id: 'emp_menus', title: 'Comidas Navidad' },
  { id: 'cong_start', title: 'Evento o congreso' },
];

const HUB_FOLLOWUP = '¿Seguimos con una boda, las comidas de Navidad o un congreso?';

const CEREMONY_BUTTONS = [
  { id: 'boda_si', title: 'En la hostería' },
  { id: 'boda_no', title: 'Solo banquete' },
  { id: 'boda_ns', title: 'Aún no lo sé' },
];

const ROOMS_BUTTONS = [
  { id: 'boda_hab_si', title: 'Sí, habitaciones' },
  { id: 'boda_hab_no', title: 'No hace falta' },
  { id: 'boda_hab_ns', title: 'Aún no lo sé' },
];

const VISIT_BUTTONS = [
  { id: 'boda_vis_si', title: 'Sí, una visita' },
  { id: 'boda_vis_no', title: 'Ahora no' },
  { id: 'boda_vis_ns', title: 'Aún no lo sé' },
];

function startHub(business) {
  return {
    data: base('hub', 'hub'),
    replies: [
      buttons(
        `🎉 *Eventos en ${business.name}*\n\n` +
          `Puedo ayudarte con tres cosas:\n` +
          `• una boda, con la hostería en exclusiva;\n` +
          `• comidas de Navidad para empresas, menú a medida (desde 55 € + IVA por persona);\n` +
          `• un evento de empresa o un congreso (de 500 a 700 personas entre todos los espacios).\n\n` +
          `Nada queda confirmado por aquí: el equipo envía el presupuesto.`,
        HUB_BUTTONS
      ),
    ],
  };
}

function startIntent(intent, business, options) {
  if (!intent) return startHub(business);
  if (intent.kind === 'boda') return startBoda(business, options);
  if (intent.kind === 'empresa_overview' || intent.kind === 'empresa_detail') return startOverview(business);
  if (intent.kind === 'congreso') return startCongreso(business, options);
  return startHub(business);
}

function parseFlexibleDate(textValue, zone) {
  const direct = parseDate(textValue, zone);
  if (direct) return direct;
  const t = normalize(textValue);
  const m = t.match(
    /(\d{1,2})\s*(?:de\s*)?(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)(?:\s*(?:de\s*)?(\d{4}))?/
  );
  if (!m) return null;
  const now = DateTime.now().setZone(zone).startOf('day');
  let year = m[3] ? parseInt(m[3], 10) : now.year;
  if (year < 100) year += 2000;
  let dt = DateTime.fromObject({ day: parseInt(m[1], 10), month: MONTHS[m[2]], year }, { zone }).startOf('day');
  if (!dt.isValid) return null;
  if (!m[3] && dt < now) dt = dt.plus({ years: 1 });
  return dt.isValid ? dt : null;
}

function parseRange(textValue, zone) {
  const t = normalize(textValue);
  let m = t.match(
    /(\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?)\s*(?:al|a|hasta|-|–)\s*(\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?)/
  );
  if (m) {
    const start = parseFlexibleDate(m[1], zone);
    const end = parseFlexibleDate(m[2], zone);
    if (start && end) return { start, end };
  }
  m = t.match(
    /(\d{1,2})\s*(?:al|a|-|–)\s*(\d{1,2})\s*(?:de\s*)?(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)(?:\s*(?:de\s*)?(\d{4}))?/
  );
  if (m) {
    const yearBit = m[4] ? ` de ${m[4]}` : '';
    const start = parseFlexibleDate(`${m[1]} de ${m[3]}${yearBit}`, zone);
    const end = parseFlexibleDate(`${m[2]} de ${m[3]}${yearBit}`, zone);
    if (start && end) return { start, end };
  }
  const one = parseFlexibleDate(textValue, zone);
  if (one) return { start: one, end: null };
  return null;
}

function labelDate(dt) {
  return dt.setLocale('es').toFormat("cccc d 'de' LLLL yyyy");
}

function isDecember2026(dt) {
  return dt.year === 2026 && dt.month === 12;
}

function parseService(textValue, buttonId) {
  if (buttonId === 'emp_comida') return 'comida';
  if (buttonId === 'emp_cena') return 'cena';
  const n = normalize(textValue);
  if (/cena|cenar|noche/.test(n)) return 'cena';
  if (/comida|comer|almuerzo|mediodia/.test(n)) return 'comida';
  return null;
}

function parseParty(textValue) {
  const m = String(textValue || '').match(/\d{1,4}/);
  if (!m) return null;
  const n = parseInt(m[0], 10);
  if (!n || n < 1) return null;
  return n;
}

function parseReach(textValue, from) {
  const raw = (textValue || '').trim();
  const norm = normalize(raw);
  if (!norm) return null;
  const emailMatch = raw.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  const email = emailMatch ? emailMatch[0] : null;
  const phoneMatch = raw.match(/(?:\+|00)?\d[\d\s().-]{8,}/);
  let phone = phoneMatch ? phoneMatch[0].replace(/\D/g, '') : null;
  if (phone && phone.length < 9) phone = null;
  const wantsThis =
    /^(este|este whatsapp|este numero|el mismo|whatsapp|mismo)$/.test(norm) ||
    norm.includes('este whatsapp') ||
    norm.includes('este numero') ||
    norm.includes('el mismo');
  const noEmail = /no tengo|sin email|sin correo|solo whatsapp|solo telefono|solo tel\b/.test(norm);
  if (wantsThis) phone = from;
  if (!email && !phone && noEmail) phone = from;
  if (!email && !phone) return null;
  return { email: email || null, phone: phone || from };
}

function parseNeeds(textValue) {
  const raw = (textValue || '').trim();
  const n = normalize(raw);
  let meals = null;
  let rooms = null;
  let av = null;
  if (/sin comida|sin menu|no\b[^.]*\bcomidas?/.test(n)) meals = false;
  else if (/comida|cena|menu|almuerzo|desayuno|coctel|cocktail/.test(n)) meals = true;
  if (/sin habitacion|sin hotel|sin alojamiento|no\b[^.]*\bhabitaciones?/.test(n)) rooms = false;
  else if (/habitacion|alojamiento|dormir|pernoct/.test(n)) rooms = true;
  if (/sin audiovisual|sin av\b|no\b[^.]*\baudiovisual/.test(n)) av = false;
  else if (/audiovisual|\bav\b|proyector|micro|sonido|pantalla/.test(n)) av = true;
  return { meals, rooms, av, raw };
}

function looksLikeQuestion(raw) {
  const n = normalize(raw);
  return /\?/.test(raw || '') || /^(que |cual |cuanto |cuanta |teneis |hay |podeis |puede )/.test(n);
}

function flag(value) {
  if (value === true) return 'sí';
  if (value === false) return 'no';
  return 'no indicado';
}

function empresaDetails(data, from) {
  const parts = [
    `Empresa: ${data.company}`,
    `Contacto: ${data.contactName}`,
    `Menú: ${menus.OFFER_NAME} (menú a medida)`,
    `Precio: ${menus.PRICE_SHORT}`,
    `Servicio: ${data.service}`,
    `Email: ${data.email || '—'}`,
    `Tel: ${data.phoneContact}`,
    `WhatsApp: ${from}`,
    `Espacio: ${conocimiento.spaceHint(data.partySize)}`,
    trasladoNota(data),
    fotos.clientPhotoNote(data),
    'Estado: pendiente de presupuesto',
  ];
  return parts.filter(Boolean).join(' | ');
}

function congresoDetails(data, from) {
  const fechas = data.dateEndLabel ? `${data.dateLabel} → ${data.dateEndLabel}` : data.dateLabel;
  const parts = [
    `Empresa: ${data.company}`,
    `Contacto: ${data.contactName}`,
    `Tipo: ${data.eventType}`,
    `Fechas: ${fechas}`,
    `Asistentes: ${data.partySize}`,
    `Necesidades: ${data.needsRaw}`,
    `Comidas: ${flag(data.needsMeals)}`,
    `Habitaciones: ${flag(data.needsRooms)}`,
    `Audiovisual: ${flag(data.needsAv)}`,
    `Email: ${data.email || '—'}`,
    `Tel: ${data.phoneContact}`,
    `WhatsApp: ${from}`,
    'Pendiente casa: nombre y aforo de cada salón; equipamiento audiovisual',
    trasladoNota(data),
    fotos.clientPhotoNote(data),
    'Estado: pendiente de presupuesto',
  ];
  return parts.filter(Boolean).join(' | ');
}

function trasladoNota(data) {
  if (!data.transporte) return '';
  return 'Traslado: interesado; se estudia según grupo y fecha, presupuesto aparte';
}

function trasladoLinea(data) {
  if (!data.transporte) return '';
  return '🚐 Traslado: se estudia según el tamaño del grupo y la fecha, y va en el presupuesto.\n';
}

function reviewEmpresa(data, business) {
  return (
    `*Solicitud de comida de Navidad*\n` +
    `Si la envías, el equipo de ${business.name} prepara el presupuesto. La fecha no queda reservada.\n\n` +
    `🏢 ${data.company}\n` +
    `🙋 ${data.contactName}\n` +
    `📅 ${data.dateLabel} · ${data.service}\n` +
    `👥 ${data.partySize} personas\n` +
    `🎄 ${menus.OFFER_NAME} — menú a medida, ${menus.PRICE_SHORT}\n` +
    `✉️ ${data.email || 'sin email'}\n` +
    `📱 ${data.phoneContact}\n\n` +
    `${conocimiento.spaceHint(data.partySize)}\n` +
    `${trasladoLinea(data)}` +
    `Bebida, mínimos y tarifa de grupo, si necesitáis hotel, se detallan en el presupuesto.\n\n` +
    `¿La envío así?`
  );
}

function reviewCongreso(data, business) {
  const fechas = data.dateEndLabel ? `${data.dateLabel} al ${data.dateEndLabel}` : data.dateLabel;
  return (
    `*Solicitud de evento*\n` +
    `Si la envías, el equipo de ${business.name} prepara el presupuesto. La fecha no queda reservada.\n\n` +
    `🏢 ${data.company}\n` +
    `🙋 ${data.contactName}\n` +
    `📌 ${data.eventType}\n` +
    `📅 ${fechas}\n` +
    `👥 ${data.partySize} asistentes\n` +
    `📝 ${data.needsRaw}\n` +
    `✉️ ${data.email || 'sin email'}\n` +
    `📱 ${data.phoneContact}\n\n` +
    `${trasladoLinea(data)}` +
    `El salón concreto y el audiovisual se detallan en el presupuesto.\n\n` +
    `¿La envío así?`
  );
}

const REVIEW_BUTTONS = [
  { id: 'emp_send', title: 'Enviar solicitud' },
  { id: 'emp_fix', title: 'Corregir datos' },
];

function thanksEmpresa(data, business) {
  return (
    `Gracias, ${data.contactName}. He anotado la solicitud nº {{id}} de *${data.company}*.\n\n` +
    `📅 ${data.dateLabel} · ${data.service} · ${data.partySize} personas\n` +
    `🎄 ${menus.OFFER_NAME} — menú a medida, ${menus.PRICE_SHORT}\n\n` +
    `Queda *pendiente de presupuesto*. En breve te escribe el equipo de ${business.name}. No reservo la fecha hasta entonces.\n\n` +
    `📍 ${business.address}\n📞 ${business.phone}`
  );
}

function thanksCongreso(data, business) {
  const fechas = data.dateEndLabel ? `${data.dateLabel} al ${data.dateEndLabel}` : data.dateLabel;
  return (
    `Gracias, ${data.contactName}. He anotado la solicitud nº {{id}} de *${data.company}*.\n\n` +
    `📌 ${data.eventType}\n` +
    `📅 ${fechas} · ${data.partySize} asistentes\n\n` +
    `Queda *pendiente de presupuesto*. El equipo de ${business.name} te escribirá para concretar sala, necesidades y precio. No reservo la fecha hasta entonces.\n\n` +
    `📍 ${business.address}\n📞 ${business.phone}`
  );
}

function adminEmpresa(data, from) {
  const body =
    `🎄 SOLICITUD EMPRESA pendiente de presupuesto #{{id}}\n` +
    `Empresa: ${data.company}\nContacto: ${data.contactName}\n` +
    `${data.dateLabel} · ${data.service} · ${data.partySize} personas\n` +
    `Menú: ${menus.OFFER_NAME} (menú a medida, ${menus.PRICE_SHORT})\n` +
    `Email: ${data.email || '—'}\nTel: ${data.phoneContact}\nWhatsApp: ${from}`;
  return appendPhotoNote(body, data);
}

function adminCongreso(data, from) {
  const fechas = data.dateEndLabel ? `${data.dateLabel} → ${data.dateEndLabel}` : data.dateLabel;
  const body =
    `🏛️ SOLICITUD CONGRESO pendiente de presupuesto #{{id}}\n` +
    `Empresa: ${data.company}\nContacto: ${data.contactName}\nTipo: ${data.eventType}\n` +
    `${fechas} · ${data.partySize} asistentes\n` +
    `Necesidades: ${data.needsRaw}\n` +
    `Email: ${data.email || '—'}\nTel: ${data.phoneContact}\nWhatsApp: ${from}`;
  return appendPhotoNote(body, data);
}

function guestsLabel(data) {
  if (data.guestsLabel) return data.guestsLabel;
  if (data.partySize) return String(data.partySize);
  return 'aún no';
}

function visitLabel(data) {
  if (data.visitWhen) return data.visitWhen;
  if (data.visit === 'sí') return 'sí, día por concretar';
  if (data.visit === 'aún no') return 'aún no';
  return 'no';
}

function bodaDetails(data, from) {
  const parts = [
    `Pareja/contacto: ${data.contactName}`,
    `Fecha: ${data.dateLabel}`,
    `Invitados aprox.: ${guestsLabel(data)}`,
    `Ceremonia: ${data.ceremony}`,
    `Alojamiento: ${data.rooms || 'no indicado'}`,
    `Email: ${data.email || '—'}`,
    `Tel: ${data.phoneContact}`,
    `WhatsApp: ${from}`,
    `Visita: ${visitLabel(data)}`,
    trasladoNota(data),
    fotos.clientPhotoNote(data),
    'Estado: pendiente de presupuesto',
  ];
  return parts.filter(Boolean).join(' | ');
}

function reviewBoda(data, business) {
  const people = data.partySize ? `${data.partySize} invitados, aprox.` : 'invitados por concretar';
  const visita =
    data.visit === 'sí'
      ? `🏡 Visita: ${visitLabel(data)}\n`
      : data.visit === 'aún no'
        ? '🏡 Visita: aún no lo saben\n'
        : '';
  return (
    `*Solicitud de boda*\n` +
    `Si la envías, el equipo de ${business.name} prepara el presupuesto. La fecha no queda reservada.\n\n` +
    `💍 ${data.contactName}\n` +
    `📅 ${data.dateLabel}\n` +
    `👥 ${people}\n` +
    `💒 Ceremonia: ${data.ceremony}\n` +
    `🛏️ Alojamiento: ${data.rooms || 'no indicado'}\n` +
    `${visita}` +
    `✉️ ${data.email || 'sin email'}\n` +
    `📱 ${data.phoneContact}\n\n` +
    `${trasladoLinea(data)}` +
    `Menú y precio: presupuesto a medida.\n\n` +
    `¿La envío así?`
  );
}

function thanksBoda(data, business) {
  const people = data.partySize ? ` · ${data.partySize} invitados` : '';
  const visita =
    data.visit === 'sí'
      ? `🏡 Visita anotada (${visitLabel(data)}). Queda pendiente: os escribo por aquí cuando haya respuesta.\n\n`
      : '';
  const mail = business.email || 'reservas@donfadrique.com';
  return (
    `Gracias. He anotado la solicitud nº {{id}} para *${data.contactName}*.\n\n` +
    `📅 ${data.dateLabel}${people}\n` +
    `💒 Ceremonia: ${data.ceremony}\n\n` +
    `${visita}` +
    `Queda *pendiente de presupuesto*. La fecha de la boda no queda reservada hasta entonces.\n\n` +
    `📍 ${business.address}\n📞 ${business.phone}\n✉️ ${mail}`
  );
}

function adminBoda(data, from) {
  const people = data.partySize ? `${data.partySize} invitados` : 'invitados por concretar';
  const body =
    `💍 SOLICITUD BODA pendiente de presupuesto #{{id}}\n` +
    `Pareja: ${data.contactName}\n` +
    `${data.dateLabel} · ${people}\n` +
    `Ceremonia: ${data.ceremony}\n` +
    `Alojamiento: ${data.rooms || 'no indicado'}\n` +
    `Visita: ${visitLabel(data)}\n` +
    `Email: ${data.email || '—'}\nTel: ${data.phoneContact}\nWhatsApp: ${from}`;
  return appendPhotoNote(body, data);
}

function appendPhotoNote(body, data) {
  const note = fotos.clientPhotoNote(data);
  return note ? `${body}\n${note}` : body;
}

function alertLine(kind, data) {
  const when = data.dateEndLabel ? `${data.dateLabel} al ${data.dateEndLabel}` : data.dateLabel;
  const people = data.partySize ? `${data.partySize} ${kind === 'Boda' ? 'invitados' : 'personas'}` : '';
  const contact = data.email || data.phoneContact || '';
  return [kind, data.contactName, when, people, contact, '#{{id}}'].filter(Boolean).join(' · ');
}

function reviewFor(data, business) {
  if (data.flow === 'congreso') return reviewCongreso(data, business);
  if (data.flow === 'boda') return reviewBoda(data, business);
  return reviewEmpresa(data, business);
}

function thanksFor(data, business) {
  if (data.flow === 'congreso') return thanksCongreso(data, business);
  if (data.flow === 'boda') return thanksBoda(data, business);
  return thanksEmpresa(data, business);
}

function reservationFor(data, from) {
  if (data.flow === 'boda') {
    return {
      record: {
        phone: from,
        name: data.contactName,
        partySize: data.partySize,
        date: data.date,
        time: 'boda',
        type: 'evento_boda',
        status: 'pending',
        details: bodaDetails(data, from),
      },
      adminText: adminBoda(data, from),
      alertSummary: alertLine('Boda', data),
    };
  }
  if (data.flow === 'congreso') {
    return {
      record: {
        phone: from,
        name: data.contactName,
        partySize: data.partySize,
        date: data.date,
        time: 'evento',
        type: 'evento_congreso',
        status: 'pending',
        details: congresoDetails(data, from),
      },
      adminText: adminCongreso(data, from),
      alertSummary: alertLine('Congreso', data),
    };
  }
  return {
    record: {
      phone: from,
      name: data.contactName,
      partySize: data.partySize,
      date: data.date,
      time: data.service,
      type: 'evento_empresa',
      status: 'pending',
      details: empresaDetails(data, from),
    },
    adminText: adminEmpresa(data, from),
    alertSummary: alertLine('Navidad empresa', data),
  };
}

function stay(data, replies) {
  return { data, replies };
}

function sideOr(data, raw, prompt) {
  const norm = normalize(raw);
  const faqAside =
    data.flow === 'boda' &&
    /planner|proveedor|infantil|gluten|vegetar|celiac|vegano|musica|mascota|\bperro|\bpiscina|bodega|huerta|michelin|repsol|hasta tarde/.test(
      norm
    );
  if (!looksLikeQuestion(raw) && !faqAside) return null;
  const side = conocimiento.answerSideQuestion(norm, data.flow);
  if (!side) return null;
  return stay(data, [text(`${side}\n\n${prompt}`)]);
}

function looksLikeFreshBodaAsk(norm) {
  return /quiero|quisiera|queremos|querria|gustaria|informacion|reserv|presupuesto|banquete|casar|una boda|de boda|para bodas|celebracion/.test(
    norm
  );
}

function wantsBodaNow(data, norm, buttonId) {
  const collecting = data.flow === 'boda' && data.stage && !['hub', 'browse'].includes(data.stage);
  if (collecting) return false;
  if (buttonId === 'boda_start') return true;
  if (!conocimiento.isBodaTopic(norm)) return false;
  if (!data.stage || data.stage === 'hub' || data.stage === 'browse') return true;
  return looksLikeFreshBodaAsk(norm);
}

function wantsCongresoNow(data, norm, buttonId) {
  const collecting = data.flow === 'congreso' && data.stage && !['hub', 'browse'].includes(data.stage);
  if (buttonId === 'cong_start') return !collecting;
  if (conocimiento.isBodaTopic(norm) || menus.isEmpresaTopic(norm)) return false;
  if (!conocimiento.isCongresoTopic(norm)) return false;
  return !data.stage || data.stage === 'hub' || data.stage === 'browse';
}

function beginBoda(business, raw, norm) {
  const started = startBoda(business);
  const location = faq.isLocationQuery(norm);
  const transport = faq.isTransportQuery(norm);
  if (transport) started.data.transporte = true;
  if ((location || transport) && faq.shouldAnswerNow(raw, norm)) {
    started.replies = [
      text(
        faq.reply({
          location,
          transport,
          parking: faq.isParkingQuery(norm),
          business,
          inFlow: true,
        })
      ),
      ...started.replies,
    ];
  }
  return started;
}

function askCompany(data) {
  return stay(
    { ...data, stage: 'company' },
    [text('¿A nombre de qué empresa o entidad lo preparo?')]
  );
}

function wantsEmpresaBooking(norm, buttonId) {
  if (buttonId === 'emp_book' || buttonId === 'emp_mediodia' || buttonId === 'emp_navidad' || buttonId === 'emp_gala') {
    return true;
  }
  return (
    /^(solicitar|reservar|presupuesto|pedir presupuesto|quiero solicitar|me interesa)$/.test(norm) ||
    /solicitar|pedir presupuesto|quiero este|lo quiero|pedir fecha|\breservar\b/.test(norm)
  );
}

function handleBrowse(data, raw, norm, buttonId, business) {
  if (buttonId === 'emp_home') return { goHome: true, replies: [] };
  if (buttonId === 'boda_start' || conocimiento.isBodaTopic(norm)) return startBoda(business);
  if (buttonId === 'emp_overview' || buttonId === 'emp_menus') return startOverview(business);
  if (buttonId === 'cong_start' || conocimiento.isCongresoTopic(norm)) return startCongreso(business);
  const side = looksLikeQuestion(raw) ? conocimiento.answerSideQuestion(norm, data.flow) : null;
  if (side && !wantsEmpresaBooking(norm, buttonId)) {
    return stay(data, [
      text(side),
      buttons('Cuando quieras, escribe *solicitar* y tomo los datos.', menus.OFFER_BUTTONS),
    ]);
  }
  if (wantsEmpresaBooking(norm, buttonId)) {
    return stay({ ...data, flow: 'empresa', stage: 'company' }, [text('Qué bien. ¿A nombre de qué empresa lo preparo?')]);
  }
  return startOverview(business);
}

function handleHub(data, raw, norm, buttonId, business) {
  if (buttonId === 'boda_start' || conocimiento.isBodaTopic(norm)) return startBoda(business);
  if (buttonId === 'cong_start' || conocimiento.isCongresoTopic(norm)) return startCongreso(business);
  if (buttonId === 'emp_menus' || menus.isEmpresaTopic(norm)) return startOverview(business);
  const side = looksLikeQuestion(raw) ? conocimiento.answerSideQuestion(norm, data.flow) : null;
  if (side) {
    return stay(data, [text(side), buttons(HUB_FOLLOWUP, HUB_BUTTONS)]);
  }
  return startHub(business);
}

function validFuture(dt, zone, yearsAhead) {
  const now = DateTime.now().setZone(zone).startOf('day');
  const limit = now.plus({ years: yearsAhead }).endOf('year');
  return dt >= now && dt <= limit;
}

function dated(dt, approximate) {
  const label = labelDate(dt);
  return {
    date: dt.toFormat('yyyy-MM-dd'),
    dateEnd: null,
    dateLabel: approximate ? `${label} (aprox.)` : label,
    approximate,
  };
}

function monthStart(month, explicitYear, zone) {
  const now = DateTime.now().setZone(zone).startOf('day');
  let year = explicitYear || now.year;
  let dt = DateTime.fromObject({ year, month, day: 1 }, { zone }).startOf('day');
  if (!explicitYear && dt < now.startOf('month')) dt = dt.plus({ years: 1 });
  return dt.isValid ? dt : null;
}

function parseWeddingWhen(textValue, zone) {
  const raw = String(textValue || '').trim();
  const t = normalize(raw);
  if (!t) return null;
  const hasApproxWord = /aprox|aproximad|sobre el|hacia|alrededor|mas o menos/.test(t);

  const range = parseRange(raw, zone);
  if (range) {
    const label = range.end ? `${labelDate(range.start)} al ${labelDate(range.end)}` : labelDate(range.start);
    return {
      date: range.start.toFormat('yyyy-MM-dd'),
      dateEnd: range.end ? range.end.toFormat('yyyy-MM-dd') : null,
      dateLabel: hasApproxWord ? `${label} (aprox.)` : label,
      approximate: hasApproxWord,
    };
  }

  const embedded = t.match(/(\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?)/);
  if (embedded) {
    const one = parseFlexibleDate(embedded[1], zone);
    if (one) return dated(one, hasApproxWord);
  }

  const monthMatch = t.match(
    /\b(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)\b(?:\s*(?:de\s*)?(\d{4}))?/
  );
  if (monthMatch) {
    const dt = monthStart(MONTHS[monthMatch[1]], monthMatch[2] ? parseInt(monthMatch[2], 10) : null, zone);
    if (!dt) return null;
    return {
      date: dt.toFormat('yyyy-MM-dd'),
      dateEnd: null,
      dateLabel: `${dt.setLocale('es').toFormat("LLLL 'de' yyyy")} (aprox.)`,
      approximate: true,
    };
  }

  const seasonMatch = t.match(/\b(primavera|verano|otono|invierno)\b(?:\s*(?:de\s*)?(\d{4}))?/);
  if (seasonMatch) {
    const seasonMonth = { primavera: 3, verano: 6, otono: 9, invierno: 12 }[seasonMatch[1]];
    const dt = monthStart(seasonMonth, seasonMatch[2] ? parseInt(seasonMatch[2], 10) : null, zone);
    if (!dt) return null;
    const seasonName = { primavera: 'primavera', verano: 'verano', otono: 'otoño', invierno: 'invierno' }[seasonMatch[1]];
    return {
      date: dt.toFormat('yyyy-MM-dd'),
      dateEnd: null,
      dateLabel: `${seasonName} de ${dt.year} (aprox.)`,
      approximate: true,
    };
  }

  if (/ano que viene|proximo ano|el ano proximo/.test(t)) {
    const year = DateTime.now().setZone(zone).year + 1;
    return { date: `${year}-01-01`, dateEnd: null, dateLabel: `${year} (aprox.)`, approximate: true };
  }

  const yearOnly = t.match(/\b(20\d{2})\b/);
  if (yearOnly) {
    const year = parseInt(yearOnly[1], 10);
    return { date: `${year}-01-01`, dateEnd: null, dateLabel: `${year} (aprox.)`, approximate: true };
  }

  if (
    /por concretar|sin fecha|fecha abierta|por decidir|no lo se|aun no|todavia no|no sabemos|mas adelante|ya veremos|cuando se sepa/.test(
      t
    )
  ) {
    return { date: 'por concretar', dateEnd: null, dateLabel: 'fecha por concretar', approximate: true };
  }

  return null;
}

function acceptableWhen(parsed, zone) {
  if (!parsed) return false;
  if (parsed.date === 'por concretar') return true;
  const start = DateTime.fromISO(parsed.date, { zone }).startOf('day');
  if (!start.isValid) return false;
  const end = parsed.dateEnd ? DateTime.fromISO(parsed.dateEnd, { zone }).startOf('day') : null;
  if (parsed.dateEnd && (!end || !end.isValid || end < start)) return false;
  const now = DateTime.now().setZone(zone).startOf('day');
  const limit = now.plus({ years: 2 }).endOf('year');
  if (parsed.approximate) {
    const last = (end || start).endOf('month');
    return last >= now && start <= limit && (!end || end <= limit);
  }
  if (start < now || start > limit) return false;
  if (end && end > limit) return false;
  return true;
}

function isUnknown(norm) {
  return /no lo se|no sabemos|aun no|todavia no|por concretar|sin fecha|no estoy segur|ya veremos|mas adelante|cuando se sepa/.test(
    norm || ''
  );
}

function isCeremonyReply(textValue, buttonId) {
  return parseCeremony(textValue, buttonId) != null;
}

function parseCeremony(textValue, buttonId) {
  if (buttonId === 'boda_si') return 'en la hostería';
  if (buttonId === 'boda_no') return 'solo banquete';
  if (buttonId === 'boda_ns') return 'aún no';
  const n = normalize(textValue);
  if (!n) return null;
  if (isUnknown(n) || /por decidir|quizas|quiza/.test(n)) return 'aún no';
  if (/solo (el )?banquete|sin ceremonia|en otro sitio|fuera de la|ceremonia no/.test(n)) return 'solo banquete';
  if (/^no\b/.test(n)) return 'solo banquete';
  if (/hosteria|en el jardin|en la finca|en el hotel|aqui mismo|en la casa/.test(n) || /^si\b/.test(n)) {
    return 'en la hostería';
  }
  return null;
}

function parseStay(textValue, buttonId) {
  if (buttonId === 'boda_hab_si') return 'sí';
  if (buttonId === 'boda_hab_no') return 'no';
  if (buttonId === 'boda_hab_ns') return 'aún no';
  const n = normalize(textValue);
  if (!n) return null;
  if (isUnknown(n)) return 'aún no';
  if (/sin habitacion|sin hotel|sin alojamiento|no hace falta|^no\b/.test(n)) return 'no';
  if (/habitacion|alojamiento|dormir|pernoct|^si\b/.test(n)) return 'sí';
  return null;
}

function parseVisitChoice(textValue, buttonId) {
  if (buttonId === 'boda_vis_si') return 'sí';
  if (buttonId === 'boda_vis_no') return 'no';
  if (buttonId === 'boda_vis_ns') return 'aún no';
  const n = normalize(textValue);
  if (!n) return null;
  if (isUnknown(n)) return 'aún no';
  if (/^no\b|ahora no|no hace falta|paso/.test(n)) return 'no';
  if (/^si\b|visita|ver la casa|verla|nos gustaria/.test(n)) return 'sí';
  return null;
}

function parseVisitSlot(raw, zone) {
  const norm = normalize(raw);
  if (!norm) return null;
  if (isUnknown(norm)) return 'por concretar';
  const when = parseWeddingWhen(raw, zone);
  let clock = '';
  const tm = norm.match(/a\s+las\s+(\d{1,2})(?:[:.h](\d{2}))?/) || norm.match(/\b(\d{1,2})[:.h](\d{2})\b/);
  if (tm) {
    const hh = parseInt(tm[1], 10);
    const mm = tm[2] ? parseInt(tm[2], 10) : 0;
    if (hh >= 0 && hh <= 23 && mm >= 0 && mm <= 59) {
      clock = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
    }
  }
  if (!clock && /por la manana/.test(norm)) clock = 'por la mañana';
  else if (!clock && /por la tarde/.test(norm)) clock = 'por la tarde';
  else if (!clock && /al mediodia|a mediodia/.test(norm)) clock = 'al mediodía';
  if (when && when.date !== 'por concretar') {
    return clock ? `${when.dateLabel}, ${clock}` : when.dateLabel;
  }
  if (norm.length >= 3 && norm.length <= 80 && !looksLikeQuestion(raw)) return raw.trim();
  return null;
}

function noteTransport(data, norm) {
  if (/autobus|autocar|shuttle|traslado|transporte|\bbus\b/.test(norm || '')) data.transporte = true;
}

function handleBodaStages(data, raw, norm, buttonId, business, zone) {
  if (data.flow !== 'boda') return null;
  noteTransport(data, norm);

  if (data.stage === 'wdate') {
    const prompt = datePrompt();
    const side = sideOr(data, raw, prompt);
    if (side) return side;
    const when = parseWeddingWhen(raw, zone);
    if (!when || !acceptableWhen(when, zone)) {
      return stay(data, [
        text('No entendí esa fecha, ya pasó o queda a más de dos años. Prueba con 12/06/2027, junio de 2027, verano de 2027, o escribe *no lo sé todavía*.'),
      ]);
    }
    return stay(
      {
        ...data,
        date: when.date,
        dateLabel: when.dateLabel,
        dateEnd: when.dateEnd,
        dateApproximate: when.approximate,
        stage: 'guests',
      },
      [text(`${when.dateLabel}. ¿Cuántos invitados, aproximadamente? Si aún no lo sabéis, escribid *no lo sé todavía*.`)]
    );
  }

  if (data.stage === 'guests') {
    const prompt = '¿Cuántos invitados, aproximadamente? Si aún no lo sabéis, escribid *no lo sé todavía*.';
    const side = sideOr(data, raw, prompt);
    if (side) return side;
    const n = parseParty(raw);
    if (isUnknown(norm) && !n) {
      return stay(
        { ...data, partySize: null, guestsLabel: 'aún no', stage: 'ceremony' },
        [buttons('Sin problema. ¿La ceremonia sería en la hostería o solo el banquete?', CEREMONY_BUTTONS)]
      );
    }
    if (!n || n > 9999) return stay(data, [text('Dime un número aproximado de invitados, por ejemplo 120, o escribe *no lo sé todavía*.')]);
    return stay(
      { ...data, partySize: n, guestsLabel: String(n), stage: 'ceremony' },
      [buttons(`${n} invitados. ¿La ceremonia sería en la hostería o solo el banquete?`, CEREMONY_BUTTONS)]
    );
  }

  if (data.stage === 'ceremony') {
    const side = sideOr(data, raw, '¿La ceremonia sería en la hostería o solo el banquete?');
    if (side && !parseCeremony(raw, buttonId)) return side;
    const ceremony = parseCeremony(raw, buttonId);
    if (!ceremony) {
      return stay(data, [buttons('¿La ceremonia sería en la hostería o solo el banquete?', CEREMONY_BUTTONS)]);
    }
    return stay(
      { ...data, ceremony, stage: 'rooms' },
      [buttons('¿Queréis habitación para los invitados? Hay 21 dobles.', ROOMS_BUTTONS)]
    );
  }

  if (data.stage === 'rooms') {
    const side = sideOr(data, raw, '¿Queréis habitación para los invitados? Hay 21 dobles.');
    if (side && !parseStay(raw, buttonId)) return side;
    const rooms = parseStay(raw, buttonId);
    if (!rooms) {
      return stay(data, [buttons('¿Queréis habitación para los invitados? Hay 21 dobles.', ROOMS_BUTTONS)]);
    }
    return stay(
      { ...data, rooms, stage: 'couple' },
      [text('¿Cómo os llamáis? Si preferís no decirlo todavía, escribid *no lo sé todavía*.')]
    );
  }

  if (data.stage === 'couple') {
    const prompt = '¿Cómo os llamáis? Si preferís no decirlo todavía, escribid *no lo sé todavía*.';
    const side = sideOr(data, raw, prompt);
    if (side) return side;
    const contactName = isUnknown(norm) ? 'por concretar' : raw.trim();
    if (contactName.length < 2) return stay(data, [text('Dime los nombres, o escribe *no lo sé todavía*.')]);
    return {
      data: { ...data, contactName, stage: 'reach' },
      customerName: contactName === 'por concretar' ? null : contactName,
      replies: [reachPromptFor(data)],
    };
  }

  if (data.stage === 'visit') {
    const side = sideOr(data, raw, '¿Queréis venir a ver la casa?');
    if (side && !parseVisitChoice(raw, buttonId)) return side;
    const visit = parseVisitChoice(raw, buttonId);
    if (!visit) {
      return stay(data, [buttons('¿Queréis venir a ver la casa?', VISIT_BUTTONS)]);
    }
    if (visit !== 'sí') {
      return stay(
        { ...data, visit, visitWhen: null, stage: 'review' },
        [buttons(reviewFor({ ...data, visit, visitWhen: null }, business), REVIEW_BUTTONS)]
      );
    }
    return stay(
      { ...data, visit, stage: 'visitwhen' },
      [text('Qué bien. ¿Qué día y a qué hora os vendría bien? Puede ser aproximado. Si aún no lo sabéis, escribid *no lo sé todavía*.')]
    );
  }

  if (data.stage === 'visitwhen') {
    const prompt = '¿Qué día y a qué hora os vendría bien la visita? Si aún no lo sabéis, escribid *no lo sé todavía*.';
    const side = sideOr(data, raw, prompt);
    if (side) return side;
    const slot = parseVisitSlot(raw, zone);
    if (!slot) return stay(data, [text(prompt)]);
    const next = { ...data, visitWhen: slot, stage: 'review' };
    return stay(next, [buttons(reviewFor(next, business), REVIEW_BUTTONS)]);
  }

  return null;
}

function handle(ctx) {
  const business = ctx.business;
  const zone = ctx.zone;
  const from = ctx.from;
  const raw = ctx.text || '';
  const norm = normalize(raw);
  const buttonId = ctx.buttonId || null;
  const data = { ...(ctx.data || {}) };

  if (wantsBodaNow(data, norm, buttonId)) return beginBoda(business, raw, norm);
  if (wantsCongresoNow(data, norm, buttonId)) return startCongreso(business);

  if (!data.stage) {
    if (buttonId === 'boda_start') return startBoda(business);
    if (buttonId === 'cong_start') return startCongreso(business);
    if (
      buttonId === 'emp_menus' ||
      buttonId === 'emp_overview' ||
      buttonId === 'emp_book' ||
      buttonId === 'emp_mediodia' ||
      buttonId === 'emp_navidad' ||
      buttonId === 'emp_gala'
    ) {
      return startOverview(business);
    }
    return startHub(business);
  }

  if (!buttonId && data.stage) {
    const interrupted = faqDuringFlow(data, raw, norm, business);
    if (interrupted) return interrupted;
  }

  if (data.stage === 'hub') return handleHub(data, raw, norm, buttonId, business);
  if (data.stage === 'browse') return handleBrowse(data, raw, norm, buttonId, business);

  if (buttonId === 'emp_home') return { goHome: true, replies: [] };
  if (buttonId === 'emp_fix' || (data.stage === 'review' && /corregir|repetir|cambiar/.test(norm))) {
    if (data.flow === 'boda') {
      return stay({ flow: 'boda', stage: 'wdate' }, [
        text(`De acuerdo, lo repetimos. ${datePrompt()}`),
      ]);
    }
    const kept = { flow: data.flow, stage: 'company' };
    return stay(kept, [text('De acuerdo, lo repetimos. ¿A nombre de qué empresa o entidad lo preparo?')]);
  }

  const wedding = handleBodaStages(data, raw, norm, buttonId, business, zone);
  if (wedding) return wedding;

  if (data.stage === 'company') {
    const prompt = '¿A nombre de qué empresa o entidad lo preparo?';
    const side = sideOr(data, raw, prompt);
    if (side) return side;
    const company = raw.trim();
    if (company.length < 2) return stay(data, [text('Necesito el nombre de la empresa, aunque sea breve.')]);
    return stay({ ...data, company, stage: 'contact' }, [text('¿Y tu nombre, para dirigirme a ti?')]);
  }

  if (data.stage === 'contact') {
    const prompt = '¿Cómo te llamas?';
    const side = sideOr(data, raw, prompt);
    if (side) return side;
    const contactName = raw.trim();
    if (contactName.length < 2) return stay(data, [text('Dime un nombre con el que pueda dirigirme a ti.')]);
    const next = { ...data, contactName, stage: data.flow === 'congreso' ? 'type' : 'date' };
    const reply =
      data.flow === 'congreso'
        ? '¿Qué tipo de evento es? Congreso, convención, jornada, presentación…'
        : '¿Qué día de diciembre de 2026 os viene bien? Todo el mes está libre, en comida y en cena. Por ejemplo, 18/12.';
    return { data: next, customerName: contactName, replies: [text(reply)] };
  }

  if (data.stage === 'type') {
    const prompt = '¿Qué tipo de evento es?';
    const side = sideOr(data, raw, prompt);
    if (side) return side;
    const eventType = raw.trim();
    if (eventType.length < 2) return stay(data, [text('Cuéntame en pocas palabras qué acto es.')]);
    return stay(
      { ...data, eventType, stage: 'dates' },
      [text('¿Qué día o días? Una fecha (15/03/2027) o un rango (10/03 al 12/03).')]
    );
  }

  if (data.stage === 'dates') {
    const prompt = '¿Qué día o días? Por ejemplo, 15/03/2027 o 10/03 al 12/03.';
    const side = sideOr(data, raw, prompt);
    if (side) return side;
    const range = parseRange(raw, zone);
    if (!range) return stay(data, [text('No entendí la fecha. Prueba con 15/03/2027 o con 10/03 al 12/03.')]);
    if (range.end && range.end < range.start) {
      return stay(data, [text('La fecha final tiene que ser la misma o posterior al inicio.')]);
    }
    if (!validFuture(range.start, zone, 2) || (range.end && !validFuture(range.end, zone, 2))) {
      return stay(data, [text('Esa fecha ya pasó, o queda demasiado lejos. Dime un día a partir de hoy y dentro de los dos próximos años.')]);
    }
    const next = {
      ...data,
      date: range.start.toFormat('yyyy-MM-dd'),
      dateLabel: labelDate(range.start),
      dateEnd: range.end ? range.end.toFormat('yyyy-MM-dd') : null,
      dateEndLabel: range.end ? labelDate(range.end) : null,
      stage: 'attendees',
    };
    const when = next.dateEndLabel ? `${next.dateLabel} al ${next.dateEndLabel}` : next.dateLabel;
    return stay(next, [
      text(`${when}. ¿Cuántas personas asistirían? Los espacios, juntos, admiten de 500 a 700.`),
    ]);
  }

  if (data.stage === 'attendees') {
    const prompt = '¿Cuántas personas asistirían?';
    const side = sideOr(data, raw, prompt);
    if (side) return side;
    const n = parseParty(raw);
    if (!n) return stay(data, [text('Dime el número de asistentes, por ejemplo 180.')]);
    if (n > conocimiento.MAX_AFORO) {
      return stay(data, [
        text(
          `Los espacios suman una capacidad de 500 a 700 personas. No puedo anotar ${n}. ` +
            'Dime un número dentro de ese aforo y el equipo confirma cómo se reparte.'
        ),
      ]);
    }
    return stay(
      { ...data, partySize: n, stage: 'needs' },
      [
        text(
          `${n} asistentes. ${conocimiento.spaceHint(n)}\n\n` +
            '¿Qué necesitáis? Puedes decirme si hay comidas o cenas, habitaciones para los asistentes ' +
            `(hay ${conocimiento.HABITACIONES}; la tarifa se detalla en el presupuesto) y si hace falta audiovisual. ` +
            'El equipamiento concreto no lo tengo listado.'
        ),
      ]
    );
  }

  if (data.stage === 'needs') {
    const prompt =
      '¿Qué necesitáis? Comidas, habitaciones para los asistentes, audiovisual, o lo que queráis anotar.';
    if (
      looksLikeQuestion(raw) &&
      conocimiento.answerSideQuestion(norm, data.flow) &&
      raw.trim().length < 80 &&
      !/,| y /.test(norm)
    ) {
      return stay(data, [text(`${conocimiento.answerSideQuestion(norm, data.flow)}\n\n${prompt}`)]);
    }
    const needs = parseNeeds(raw);
    if (needs.raw.length < 2) return stay(data, [text(prompt)]);
    return stay(
      {
        ...data,
        needsRaw: needs.raw,
        needsMeals: needs.meals,
        needsRooms: needs.rooms,
        needsAv: needs.av,
        stage: 'reach',
      },
      [reachPrompt()]
    );
  }

  if (data.stage === 'date') {
    const prompt = '¿Qué día de diciembre de 2026? Por ejemplo, 18/12. Vale cualquier día del mes, en comida o en cena.';
    const side = sideOr(data, raw, prompt);
    if (side) return side;
    const maybeRange = parseRange(raw, zone);
    if (maybeRange && maybeRange.end) {
      return stay(data, [text('Para el menú de empresa necesito un solo día. ¿Cuál?')]);
    }
    const dt = parseFlexibleDate(raw, zone);
    if (!dt) return stay(data, [text('No entendí la fecha. Prueba con 18/12 o con 18 de diciembre.')]);
    const now = DateTime.now().setZone(zone).startOf('day');
    if (dt < now) return stay(data, [text('Esa fecha ya pasó. Dime otro día de diciembre de 2026.')]);
    if (!isDecember2026(dt)) {
      return stay(data, [text('Estos menús son solo para diciembre de 2026, cualquier día del mes. ¿Qué fecha te encaja?')]);
    }
    const service = parseService(raw, null);
    const next = {
      ...data,
      date: dt.toFormat('yyyy-MM-dd'),
      dateLabel: labelDate(dt),
      stage: service ? 'pax' : 'service',
      service: service || data.service,
    };
    if (!service) {
      return stay(next, [
        buttons(`${next.dateLabel}. ¿Comida o cena? En diciembre tenemos los dos servicios.`, [
          { id: 'emp_comida', title: 'Comida' },
          { id: 'emp_cena', title: 'Cena' },
        ]),
      ]);
    }
    return stay(next, [paxPrompt()]);
  }

  if (data.stage === 'service') {
    const service = parseService(raw, buttonId);
    if (!service) {
      return stay(data, [
        buttons('¿Lo hacéis en comida o en cena?', [
          { id: 'emp_comida', title: 'Comida' },
          { id: 'emp_cena', title: 'Cena' },
        ]),
      ]);
    }
    return stay({ ...data, service, stage: 'pax' }, [paxPrompt()]);
  }

  if (data.stage === 'pax') {
    const prompt = '¿Para cuántas personas? El espacio privado es desde 10.';
    const side = sideOr(data, raw, prompt);
    if (side) return side;
    const n = parseParty(raw);
    if (!n) return stay(data, [text('Dime cuántas personas seríais, por ejemplo 30.')]);
    if (n < conocimiento.MIN_PRIVADO) {
      return stay(data, [
        text(
          `Los espacios privados de estos menús empiezan en ${conocimiento.MIN_PRIVADO} personas. ` +
            'Para una mesa más pequeña, escribe *menu* y elige Restaurante. ¿De cuántas personas es el grupo?'
        ),
      ]);
    }
    if (n > conocimiento.MAX_AFORO) {
      return stay(data, [
        text(`La capacidad total de los espacios es de 500 a 700 personas. Dime un número dentro de ese aforo.`),
      ]);
    }
    return stay(
      { ...data, partySize: n, stage: 'reach' },
      [text(`${n} personas. ${conocimiento.spaceHint(n)}`), reachPrompt()]
    );
  }

  if (data.stage === 'menu') {
    return stay({ ...data, stage: 'reach' }, [reachPrompt()]);
  }

  if (data.stage === 'reach') {
    const prompt = reachPromptFor(data).body;
    const side = sideOr(data, raw, prompt);
    if (side) return side;
    const reach =
      data.flow === 'boda' && isUnknown(norm) ? { email: null, phone: from } : parseReach(raw, from);
    if (!reach) {
      return stay(data, [
        text(
          data.flow === 'boda'
            ? 'Necesito un email o que me digáis *este* para usar este WhatsApp.'
            : 'Necesito un email o un teléfono. También puedes escribir *este* para usar este WhatsApp.'
        ),
      ]);
    }
    if (data.flow === 'boda') {
      const next = {
        ...data,
        email: reach.email,
        phoneContact: reach.phone === from ? 'este WhatsApp' : reach.phone,
        stage: 'visit',
      };
      return stay(next, [
        buttons('¿Queréis venir a ver la casa? Si os encaja, dejo la visita pendiente y el equipo la confirma por aquí.', VISIT_BUTTONS),
      ]);
    }
    const next = {
      ...data,
      email: reach.email,
      phoneContact: reach.phone,
      stage: 'review',
    };
    return stay(next, [buttons(reviewFor(next, business), REVIEW_BUTTONS)]);
  }

  if (data.stage === 'review') {
    const send =
      buttonId === 'emp_send' ||
      ['si', 'sí', 'vale', 'ok', 'enviar', 'envialo', 'enviarlo', 'de acuerdo', 'adelante'].includes(norm) ||
      norm.startsWith('enviar');
    if (send) {
      return {
        data,
        clear: true,
        replies: [text(thanksFor(data, business))],
        reservation: reservationFor(data, from),
      };
    }
    const side = looksLikeQuestion(raw) ? conocimiento.answerSideQuestion(norm, data.flow) : null;
    if (side) {
      return stay(data, [text(side), buttons(reviewFor(data, business), REVIEW_BUTTONS)]);
    }
    return stay(data, [text('Pulsa *Enviar solicitud* si está bien, o *Corregir datos* para repetirlos.')]);
  }

  return startHub(business);
}

function stagePrompt(data) {
  switch (data.stage) {
    case 'couple':
      return '¿Cómo os llamáis? Si preferís no decirlo todavía, escribid *no lo sé todavía*.';
    case 'wdate':
      return datePrompt();
    case 'guests':
      return '¿Cuántos invitados, aproximadamente? Si aún no lo sabéis, escribid *no lo sé todavía*.';
    case 'ceremony':
      return '¿La ceremonia sería en la hostería o solo el banquete?';
    case 'rooms':
      return '¿Queréis habitación para los invitados? Hay 21 dobles.';
    case 'visit':
      return '¿Queréis venir a ver la casa?';
    case 'visitwhen':
      return '¿Qué día y a qué hora os vendría bien la visita? Si aún no lo sabéis, escribid *no lo sé todavía*.';
    case 'company':
      return '¿A nombre de qué empresa o entidad lo preparo?';
    case 'contact':
      return '¿Cómo te llamas?';
    case 'type':
      return '¿Qué tipo de evento es?';
    case 'dates':
      return '¿Qué día o días? Por ejemplo, 15/03/2027 o 10/03 al 12/03.';
    case 'attendees':
      return '¿Cuántas personas asistirían?';
    case 'needs':
      return '¿Qué necesitáis? Comidas, habitaciones para los asistentes, audiovisual, o lo que queráis anotar.';
    case 'date':
      return '¿Qué día de diciembre de 2026? Por ejemplo, 18/12.';
    case 'pax':
      return '¿Para cuántas personas? El espacio privado es desde 10.';
    case 'reach':
      return reachPrompt().body;
    default:
      return 'Seguimos cuando quieras.';
  }
}

function faqDuringFlow(data, raw, norm, business) {
  const location = faq.isLocationQuery(norm);
  const transport = faq.isTransportQuery(norm);
  if (!location && !transport) return null;
  const hasNumber = /\d/.test(norm);
  const collectingNumber = ['pax', 'attendees', 'date', 'dates', 'reach'].includes(data.stage);
  if (!faq.shouldAnswerNow(raw, norm) || (hasNumber && collectingNumber)) {
    if (transport && ['needs', 'pax', 'attendees'].includes(data.stage)) data.transporte = true;
    return null;
  }
  if (transport) data.transporte = true;
  const body = faq.reply({
    location,
    transport,
    parking: faq.isParkingQuery(norm),
    business,
    inFlow: true,
  });
  if (data.stage === 'hub') {
    return stay(data, [text(body), buttons(HUB_FOLLOWUP, HUB_BUTTONS)]);
  }
  if (data.stage === 'browse') {
    return stay(data, [
      text(body),
      buttons('Cuando quieras, escribe *solicitar* y tomo los datos.', menus.OFFER_BUTTONS),
    ]);
  }
  if (data.stage === 'service') {
    return stay(data, [
      text(body),
      buttons('¿Lo hacéis en comida o en cena?', [
        { id: 'emp_comida', title: 'Comida' },
        { id: 'emp_cena', title: 'Cena' },
      ]),
    ]);
  }
  if (data.stage === 'ceremony') {
    return stay(data, [text(body), buttons('¿La ceremonia sería en la hostería o solo el banquete?', CEREMONY_BUTTONS)]);
  }
  if (data.stage === 'rooms') {
    return stay(data, [text(body), buttons('¿Queréis habitación para los invitados? Hay 21 dobles.', ROOMS_BUTTONS)]);
  }
  if (data.stage === 'visit') {
    return stay(data, [text(body), buttons('¿Queréis venir a ver la casa?', VISIT_BUTTONS)]);
  }
  if (data.stage === 'review') {
    return stay(data, [text(body), buttons(reviewFor(data, business), REVIEW_BUTTONS)]);
  }
  return stay(data, [text(`${body}\n\n${stagePrompt(data)}`)]);
}

function reachPrompt() {
  return text(
    '¿A qué email enviamos el presupuesto? Si lo prefieres por teléfono, escríbeme el número, o *este* para usar este WhatsApp.'
  );
}

function reachPromptFor(data) {
  if (data && data.flow === 'boda') {
    return text('¿Os escribimos por este WhatsApp? El email es opcional. Escribid *este*, o dejad un correo.');
  }
  return reachPrompt();
}

function promptReplies(data, business) {
  if (!data) return [text('Seguimos cuando quieras.')];
  if (data.stage === 'ceremony') {
    return [buttons('¿La ceremonia sería en la hostería o solo el banquete?', CEREMONY_BUTTONS)];
  }
  if (data.stage === 'rooms') {
    return [buttons('¿Queréis habitación para los invitados? Hay 21 dobles.', ROOMS_BUTTONS)];
  }
  if (data.stage === 'visit') {
    return [buttons('¿Queréis venir a ver la casa?', VISIT_BUTTONS)];
  }
  if (data.stage === 'service') {
    return [
      buttons('¿Lo hacéis en comida o en cena?', [
        { id: 'emp_comida', title: 'Comida' },
        { id: 'emp_cena', title: 'Cena' },
      ]),
    ];
  }
  if (data.stage === 'review') return [buttons(reviewFor(data, business), REVIEW_BUTTONS)];
  return [text(stagePrompt(data))];
}

function paxPrompt() {
  return text('¿Para cuántas personas? Espacio privado desde 10. La terraza acristalada acoge de 10 a 50.');
}

module.exports = {
  classifyIncoming,
  isGrupoButton,
  isOtivmQuery: conocimiento.isOtivmQuery,
  startHub,
  startIntent,
  startBoda,
  startCongreso,
  startOverview,
  isCeremonyReply,
  handle,
  promptReplies,
  stampId,
  parseRange,
  parseReach,
  parseNeeds,
  parseFlexibleDate,
  placeholdersText: conocimiento.placeholdersText,
  PLACEHOLDERS: conocimiento.PLACEHOLDERS,
};

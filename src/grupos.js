const { DateTime } = require('luxon');
const { parseDate, normalize } = require('./dateParser');
const menus = require('./menusEmpresa');
const conocimiento = require('./eventosConocimiento');

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
  if (conocimiento.isCongresoTopic(norm)) return { kind: 'congreso' };
  if (menus.isEmpresaTopic(norm)) {
    const menuId = menus.explicitMenuDetail(norm);
    if (menuId) return { kind: 'empresa_detail', menuId };
    return { kind: 'empresa_overview' };
  }
  if (conocimiento.isHubTopic(norm)) return { kind: 'hub' };
  return null;
}

function isGrupoButton(buttonId) {
  return typeof buttonId === 'string' && (buttonId.startsWith('emp_') || buttonId.startsWith('cong_'));
}

function base(flow, stage, extra) {
  return { flow, stage, ...extra };
}

function startOverview(business) {
  return {
    data: base('empresa', 'browse'),
    replies: [buttons(menus.overviewText(business.name), menus.OVERVIEW_BUTTONS)],
  };
}

function startDetail(business, menuId) {
  const body = menus.detailText(menuId);
  if (!body) return startOverview(business);
  return {
    data: base('empresa', 'browse', { menuId }),
    replies: [buttons(body, menus.DETAIL_BUTTONS)],
  };
}

function startCongreso(business) {
  return {
    data: base('congreso', 'company'),
    replies: [text(`${conocimiento.congresoIntro(business.name)}\n\n¿A nombre de qué empresa o entidad lo preparo?`)],
  };
}

function startHub(business) {
  return {
    data: base('hub', 'hub'),
    replies: [
      buttons(
        `🎉 *Eventos en ${business.name}*\n\n` +
          `Puedo ayudarte con dos cosas:\n` +
          `• menús de empresa de diciembre (comida o cena);\n` +
          `• un evento grande o un congreso (la especialidad de la casa: de 500 a 700 personas entre todos los espacios).\n\n` +
          `Ninguna de las dos queda confirmada por aquí: el equipo envía el presupuesto.`,
        [
          { id: 'emp_menus', title: 'Menús de empresa' },
          { id: 'cong_start', title: 'Evento o congreso' },
        ]
      ),
    ],
  };
}

function startIntent(intent, business) {
  if (!intent) return startHub(business);
  if (intent.kind === 'empresa_detail') return startDetail(business, intent.menuId);
  if (intent.kind === 'empresa_overview') return startOverview(business);
  if (intent.kind === 'congreso') return startCongreso(business);
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

function menuChoice(norm, buttonId) {
  const fromButton = menus.menuIdFromButton(buttonId);
  if (fromButton) return fromButton;
  if (/^1$/.test(norm)) return 'mediodia';
  if (/^2$/.test(norm)) return 'navidad';
  if (/^3$/.test(norm)) return 'gran_gala';
  if (/gran gala|^gala$|menu gala/.test(norm)) return 'gran_gala';
  if (/mediodia/.test(norm)) return 'mediodia';
  if (/menu navidad|^navidad$|el navidad/.test(norm)) return 'navidad';
  return null;
}

function flag(value) {
  if (value === true) return 'sí';
  if (value === false) return 'no';
  return 'no indicado';
}

function mentionedMenuLabel(raw) {
  const id = menus.singleMenuId(normalize(raw));
  if (!id) return null;
  return menus.MENU_BY_ID[id].name;
}

function empresaDetails(data, from) {
  const menu = menus.MENU_BY_ID[data.menuId];
  const parts = [
    `Empresa: ${data.company}`,
    `Contacto: ${data.contactName}`,
    `Menú: ${menu.name}`,
    `Precio: ${menu.priceShort}`,
    `Servicio: ${data.service}`,
    `Email: ${data.email || '—'}`,
    `Tel: ${data.phoneContact}`,
    `WhatsApp: ${from}`,
    `Espacio: ${conocimiento.spaceHint(data.partySize)}`,
    'Estado: pendiente de presupuesto',
  ];
  return parts.join(' | ');
}

function congresoDetails(data, from) {
  const fechas = data.dateEndLabel ? `${data.dateLabel} → ${data.dateEndLabel}` : data.dateLabel;
  const menu = mentionedMenuLabel(data.needsRaw || '');
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
    'Estado: pendiente de presupuesto',
  ];
  if (menu) parts.push(`Menú citado: ${menu}`);
  return parts.join(' | ');
}

function reviewEmpresa(data, business) {
  const menu = menus.MENU_BY_ID[data.menuId];
  return (
    `*Solicitud de menú de empresa*\n` +
    `Si la envías, el equipo de ${business.name} prepara el presupuesto. La fecha no queda reservada.\n\n` +
    `🏢 ${data.company}\n` +
    `🙋 ${data.contactName}\n` +
    `📅 ${data.dateLabel} · ${data.service}\n` +
    `👥 ${data.partySize} personas\n` +
    `🎄 ${menu.name} — ${menu.priceShort}\n` +
    `✉️ ${data.email || 'sin email'}\n` +
    `📱 ${data.phoneContact}\n\n` +
    `${conocimiento.spaceHint(data.partySize)}\n` +
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
    `El salón concreto y el audiovisual se detallan en el presupuesto.\n\n` +
    `¿La envío así?`
  );
}

const REVIEW_BUTTONS = [
  { id: 'emp_send', title: 'Enviar solicitud' },
  { id: 'emp_fix', title: 'Corregir datos' },
];

function thanksEmpresa(data, business) {
  const menu = menus.MENU_BY_ID[data.menuId];
  return (
    `Gracias, ${data.contactName}. He anotado la solicitud nº {{id}} de *${data.company}*.\n\n` +
    `📅 ${data.dateLabel} · ${data.service} · ${data.partySize} personas\n` +
    `🎄 ${menu.name} — ${menu.priceShort}\n\n` +
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
  const menu = menus.MENU_BY_ID[data.menuId];
  return (
    `🎄 SOLICITUD EMPRESA pendiente de presupuesto #{{id}}\n` +
    `Empresa: ${data.company}\nContacto: ${data.contactName}\n` +
    `${data.dateLabel} · ${data.service} · ${data.partySize} personas\n` +
    `Menú: ${menu.name} (${menu.priceShort})\n` +
    `Email: ${data.email || '—'}\nTel: ${data.phoneContact}\nWhatsApp: ${from}`
  );
}

function adminCongreso(data, from) {
  const fechas = data.dateEndLabel ? `${data.dateLabel} → ${data.dateEndLabel}` : data.dateLabel;
  return (
    `🏛️ SOLICITUD CONGRESO pendiente de presupuesto #{{id}}\n` +
    `Empresa: ${data.company}\nContacto: ${data.contactName}\nTipo: ${data.eventType}\n` +
    `${fechas} · ${data.partySize} asistentes\n` +
    `Necesidades: ${data.needsRaw}\n` +
    `Email: ${data.email || '—'}\nTel: ${data.phoneContact}\nWhatsApp: ${from}`
  );
}

function reservationFor(data, from) {
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
  };
}

function stay(data, replies) {
  return { data, replies };
}

function sideOr(data, raw, prompt) {
  if (!looksLikeQuestion(raw)) return null;
  const side = conocimiento.answerSideQuestion(normalize(raw));
  if (!side) return null;
  return stay(data, [text(`${side}\n\n${prompt}`)]);
}

function askCompany(data) {
  return stay(
    { ...data, stage: 'company' },
    [text('¿A nombre de qué empresa o entidad lo preparo?')]
  );
}

function handleBrowse(data, raw, norm, buttonId, business) {
  if (buttonId === 'emp_home') return { goHome: true, replies: [] };
  if (buttonId === 'emp_overview' || buttonId === 'emp_menus' || /ver los tres|los tres|volver a los menus/.test(norm)) {
    return startOverview(business);
  }
  if (buttonId === 'cong_start' || conocimiento.isCongresoTopic(norm)) return startCongreso(business);
  const side = looksLikeQuestion(raw) ? conocimiento.answerSideQuestion(norm) : null;
  if (side && !menus.menuIdFromButton(buttonId)) {
    return stay(data, [
      text(side),
      buttons('Cuando quieras, elige un menú o escribe *solicitar*.', menus.OVERVIEW_BUTTONS),
    ]);
  }
  const chosen = menuChoice(norm, buttonId);
  if (chosen && buttonId !== 'emp_book') return startDetail(business, chosen);
  const wantsBook =
    buttonId === 'emp_book' ||
    /^(solicitar|reservar|presupuesto|pedir presupuesto|quiero solicitar|me interesa)$/.test(norm) ||
    /solicitar|pedir presupuesto|quiero este|lo quiero|pedir fecha|\breservar\b/.test(norm);
  if (wantsBook) {
    const next = { ...data, flow: 'empresa', stage: 'company' };
    if (buttonId === 'emp_book' && data.menuId) next.menuId = data.menuId;
    else if (chosen) next.menuId = chosen;
    return stay(next, [text('Qué bien. ¿A nombre de qué empresa lo preparo?')]);
  }
  if (chosen) return startDetail(business, chosen);
  return stay(data, [
    buttons(
      'Puedo detallarte el Menú Mediodía, el Menú Navidad o el Menú Gran Gala. Escribe *solicitar* si ya quieres pedir fecha.',
      menus.OVERVIEW_BUTTONS
    ),
  ]);
}

function handleHub(data, raw, norm, buttonId, business) {
  if (buttonId === 'emp_menus' || menus.isEmpresaTopic(norm)) {
    const detail = menus.explicitMenuDetail(norm);
    if (detail) return startDetail(business, detail);
    return startOverview(business);
  }
  if (buttonId === 'cong_start' || conocimiento.isCongresoTopic(norm)) return startCongreso(business);
  const side = looksLikeQuestion(raw) ? conocimiento.answerSideQuestion(norm) : null;
  if (side) {
    return stay(data, [
      text(side),
      buttons('¿Seguimos con un menú de empresa o con un congreso?', [
        { id: 'emp_menus', title: 'Menús de empresa' },
        { id: 'cong_start', title: 'Evento o congreso' },
      ]),
    ]);
  }
  return startHub(business);
}

function validFuture(dt, zone, yearsAhead) {
  const now = DateTime.now().setZone(zone).startOf('day');
  const limit = now.plus({ years: yearsAhead }).endOf('year');
  return dt >= now && dt <= limit;
}

function handle(ctx) {
  const business = ctx.business;
  const zone = ctx.zone;
  const from = ctx.from;
  const raw = ctx.text || '';
  const norm = normalize(raw);
  const buttonId = ctx.buttonId || null;
  const data = { ...(ctx.data || {}) };

  if (!data.stage) {
    if (buttonId === 'cong_start') return startCongreso(business);
    if (buttonId === 'emp_menus' || buttonId === 'emp_overview') return startOverview(business);
    const picked = menus.menuIdFromButton(buttonId);
    if (picked) return startDetail(business, picked);
    if (buttonId === 'emp_book') return startOverview(business);
    return startHub(business);
  }

  if (data.stage === 'hub') return handleHub(data, raw, norm, buttonId, business);
  if (data.stage === 'browse') return handleBrowse(data, raw, norm, buttonId, business);

  if (buttonId === 'emp_home') return { goHome: true, replies: [] };
  if (buttonId === 'emp_fix' || (data.stage === 'review' && /corregir|repetir|cambiar/.test(norm))) {
    const kept = { flow: data.flow, stage: 'company' };
    if (data.flow === 'empresa' && data.menuId) kept.menuId = data.menuId;
    return stay(kept, [text('De acuerdo, lo repetimos. ¿A nombre de qué empresa o entidad lo preparo?')]);
  }

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
    if (looksLikeQuestion(raw) && conocimiento.answerSideQuestion(norm) && raw.trim().length < 80 && !/,| y /.test(norm)) {
      return stay(data, [text(`${conocimiento.answerSideQuestion(norm)}\n\n${prompt}`)]);
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
    const next = { ...data, partySize: n };
    if (next.menuId && menus.MENU_BY_ID[next.menuId]) {
      next.stage = 'reach';
      return stay(next, [text(`${n} personas. ${conocimiento.spaceHint(n)}`), reachPrompt()]);
    }
    next.stage = 'menu';
    return stay(next, [
      text(`${n} personas. ${conocimiento.spaceHint(n)}`),
      buttons('¿Qué menú os apetece?', menus.OVERVIEW_BUTTONS),
    ]);
  }

  if (data.stage === 'menu') {
    const chosen = menuChoice(norm, buttonId);
    if (!chosen) {
      const side = looksLikeQuestion(raw) ? conocimiento.answerSideQuestion(norm) : null;
      if (side) {
        return stay(data, [text(side), buttons('¿Cuál de los tres menús reservo en la solicitud?', menus.OVERVIEW_BUTTONS)]);
      }
      return stay(data, [buttons('Elige Menú Mediodía, Menú Navidad o Menú Gran Gala.', menus.OVERVIEW_BUTTONS)]);
    }
    return stay({ ...data, menuId: chosen, stage: 'reach' }, [reachPrompt()]);
  }

  if (data.stage === 'reach') {
    const prompt = reachPrompt().body;
    const side = sideOr(data, raw, prompt);
    if (side) return side;
    const reach = parseReach(raw, from);
    if (!reach) {
      return stay(data, [text('Necesito un email o un teléfono. También puedes escribir *este* para usar este WhatsApp.')]);
    }
    const next = {
      ...data,
      email: reach.email,
      phoneContact: reach.phone,
      stage: 'review',
    };
    const body = next.flow === 'congreso' ? reviewCongreso(next, business) : reviewEmpresa(next, business);
    return stay(next, [buttons(body, REVIEW_BUTTONS)]);
  }

  if (data.stage === 'review') {
    const send =
      buttonId === 'emp_send' ||
      ['si', 'sí', 'vale', 'ok', 'enviar', 'envialo', 'enviarlo', 'de acuerdo', 'adelante'].includes(norm) ||
      norm.startsWith('enviar');
    if (send) {
      const replies = [text(data.flow === 'congreso' ? thanksCongreso(data, business) : thanksEmpresa(data, business))];
      return {
        data,
        clear: true,
        replies,
        reservation: reservationFor(data, from),
      };
    }
    const side = looksLikeQuestion(raw) ? conocimiento.answerSideQuestion(norm) : null;
    if (side) {
      const body = data.flow === 'congreso' ? reviewCongreso(data, business) : reviewEmpresa(data, business);
      return stay(data, [text(side), buttons(body, REVIEW_BUTTONS)]);
    }
    return stay(data, [text('Pulsa *Enviar solicitud* si está bien, o *Corregir datos* para repetirlos.')]);
  }

  return startHub(business);
}

function reachPrompt() {
  return text(
    '¿A qué email enviamos el presupuesto? Si lo prefieres por teléfono, escríbeme el número, o *este* para usar este WhatsApp.'
  );
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
  startOverview,
  startDetail,
  startCongreso,
  handle,
  stampId,
  parseRange,
  parseReach,
  parseNeeds,
  parseFlexibleDate,
  placeholdersText: conocimiento.placeholdersText,
  PLACEHOLDERS: conocimiento.PLACEHOLDERS,
};

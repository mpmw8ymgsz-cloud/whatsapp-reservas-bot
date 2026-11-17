const { DateTime } = require('luxon');
const config = require('./config');
const confirmacion = require('./confirmacion');
const { normalize } = require('./dateParser');
const grupos = require('./grupos');
const menusFiesta = require('./menusFiesta');
const faq = require('./faqLlegada');
const fotos = require('./fotos');
const marketing = require('./marketing');
const weddingSources = require('./weddingSources');
const conocimiento = require('./eventosConocimiento');
const tours = require('./turoperadores');

const EMPRESA_TRIGGER = 'Quiero información para la comida de Navidad de empresa';
const ZONE = 'Europe/Madrid';
const MESSAGE_CAP = 20000;
const TRANSCRIPT_CAP = 1000;
const LIST_CAP = 200;

const SPECIFIC_TOPICS = new Set([
  'boda',
  'navidad_empresa',
  'congreso',
  'eventos',
  'restaurante',
  'hotel',
  'menu_fiesta',
  'menu_navidad',
  'menu_nochevieja',
  'menu_anonuevo',
  'turoperador',
]);

const SOURCE_LABELS = {
  navidad_empresa: 'Comida de Navidad de empresa',
  menu_navidad: 'Menú Navidad',
  menu_nochevieja: 'Menú Nochevieja',
  menu_anonuevo: 'Menú Año Nuevo',
  turoperador: 'Turoperador / grupo',
};

function digits(value) {
  if (value == null) return '';
  let raw = String(value).trim().replace(/[\s().-]/g, '');
  if (raw.startsWith('+')) raw = raw.slice(1);
  else if (raw.startsWith('00')) raw = raw.slice(2);
  return raw.replace(/\D/g, '');
}

function tidy(raw) {
  return normalize(raw)
    .replace(/[（]/g, '(')
    .replace(/[）]/g, ')')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[.!?…]+$/g, '')
    .trim();
}

function sourceTag(raw) {
  const portal = weddingSources.portalSource(raw);
  if (portal) return portal;
  const text = tidy(raw);
  if (!text) return null;
  if (text === tidy(conocimiento.WEDDING_TRIGGER)) return weddingSources.DIRECT_SOURCE;
  if (text === tidy(EMPRESA_TRIGGER)) return 'navidad_empresa';
  if (text === tidy(tours.TRIGGER_ES) || text === tidy(tours.TRIGGER_EN)) return 'turoperador';
  for (const menu of menusFiesta.MENUS) {
    if (text === tidy(menu.reserveText)) return `menu_${menu.id}`;
  }
  return null;
}

function sourceLabel(source) {
  if (!source) return null;
  if (SOURCE_LABELS[source]) return SOURCE_LABELS[source];
  return weddingSources.labelFor(source);
}

function topicFromButton(buttonId) {
  if (!buttonId) return '';
  if (buttonId === 'exp_rest') return 'restaurante';
  if (buttonId === 'exp_hotel') return 'hotel';
  if (buttonId === 'exp_eventos') return 'eventos';
  if (buttonId === 'emp_home') return 'menu';
  if (buttonId === 'boda_start' || buttonId.startsWith('boda_')) return 'boda';
  if (buttonId === 'cong_start' || buttonId.startsWith('cong_')) return 'congreso';
  if (buttonId.startsWith('emp_')) return 'navidad_empresa';
  if (buttonId.startsWith('top_')) return 'turoperador';
  if (buttonId === 'ver_fotos') return 'fotos';
  return '';
}

function topicFromText(norm) {
  if (!norm) return '';
  const intent = grupos.classifyIncoming(norm);
  if (intent && intent.kind === 'boda') return 'boda';
  if (tours.isInquiry(norm)) return 'turoperador';
  if (intent && intent.kind === 'congreso') return 'congreso';
  if (intent && intent.kind === 'empresa_overview') return 'navidad_empresa';
  if (intent && intent.kind === 'hub') return 'eventos';
  if (menusFiesta.matchReservation(norm) || menusFiesta.matchRequest(norm)) return 'menu_fiesta';
  if (faq.isLocationQuery(norm) || faq.isTransportQuery(norm)) return 'llegada';
  if (typeof fotos.matchPhotoRequest === 'function' && fotos.matchPhotoRequest(norm)) return 'fotos';
  if (norm.includes('hotel') || norm.includes('habitacion') || norm.includes('dormir') || norm.includes('alojamiento')) {
    return 'hotel';
  }
  if (
    norm.includes('reserv') ||
    norm.includes('mesa') ||
    norm.includes('comer') ||
    norm.includes('cenar') ||
    norm.includes('restaurante')
  ) {
    return 'restaurante';
  }
  return '';
}

function sessionTopic(session) {
  if (!session) return '';
  const data = session.data || {};
  const step = session.step || '';
  if (data.flow === 'turoperador') return 'turoperador';
  if (data.flow === 'boda') return 'boda';
  if (data.flow === 'empresa') return 'navidad_empresa';
  if (data.flow === 'congreso') return 'congreso';
  if (data.flow === 'hub') return 'eventos';
  if (data.menuId) return `menu_${data.menuId}`;
  if (data.type === 'hotel' || step.startsWith('HOTEL')) return 'hotel';
  if (data.type === 'restaurante' || ['DATE', 'TIME', 'PARTY', 'NAME', 'CONFIRM', 'CANCEL_SELECT'].includes(step)) {
    return 'restaurante';
  }
  return '';
}

function detectTopic({ text, buttonId, session, phone } = {}) {
  if (phone && confirmacion.isAdminSender(phone, config.adminPhones || config.adminPhone)) return 'admin';
  const norm = normalize(text || '');
  if (marketing.isOptOut(norm, buttonId)) return 'marketing';
  if (['hola', 'menu', 'inicio', 'buenas', 'empezar', 'volver'].includes(norm)) return 'menu';
  if (norm === 'ayuda' || norm === 'info' || buttonId === 'help') return 'info';
  const step = (session && session.step) || 'IDLE';
  // Dentro de un flujo el bot sigue en ese tema; el botón o el texto de entrada
  // solo clasifican cuando todavía no hay paso abierto.
  if (step && step !== 'IDLE') {
    const active = sessionTopic(session);
    if (active) return active;
  }
  return topicFromButton(buttonId) || topicFromText(norm) || 'general';
}

function nextTopic(previous, detected) {
  const prev = previous || '';
  const next = detected || 'general';
  if (!prev) return next;
  if (SPECIFIC_TOPICS.has(next)) return next;
  if (SPECIFIC_TOPICS.has(prev)) return prev;
  return next;
}

function profileName(value, phone) {
  const contacts = Array.isArray(value && value.contacts) ? value.contacts : [];
  const want = digits(phone);
  const match = contacts.find((contact) => digits(contact && contact.wa_id) === want) || contacts[0];
  const name = match && match.profile && match.profile.name;
  if (name == null) return null;
  const trimmed = String(name).replace(/\s+/g, ' ').trim();
  return trimmed ? trimmed.slice(0, 120) : null;
}

function timestampFrom(message) {
  const ts = message && message.timestamp;
  if (ts != null && /^\d{10,13}$/.test(String(ts))) {
    const raw = String(ts);
    const ms = raw.length >= 13 ? Number(raw) : Number(raw) * 1000;
    if (Number.isFinite(ms)) return new Date(ms).toISOString();
  }
  return new Date().toISOString();
}

function outboundText(payload) {
  if (!payload || typeof payload !== 'object') return '';
  if (payload.type === 'text') return (payload.text && payload.text.body) || '';
  if (payload.type === 'image') return (payload.image && payload.image.caption) || '';
  if (payload.type === 'interactive') {
    const interactive = payload.interactive || {};
    const body = (interactive.body && interactive.body.text) || '';
    const buttons = ((interactive.action && interactive.action.buttons) || [])
      .map((button) => button && button.reply && button.reply.title)
      .filter(Boolean);
    const rows = [];
    for (const section of (interactive.action && interactive.action.sections) || []) {
      for (const row of (section && section.rows) || []) {
        if (row && row.title) rows.push(row.title);
      }
    }
    const options = buttons.length ? buttons : rows;
    return options.length ? `${body}\n${options.join(' | ')}` : body;
  }
  if (payload.type === 'template') {
    const name = (payload.template && payload.template.name) || 'plantilla';
    const params = [];
    for (const component of (payload.template && payload.template.components) || []) {
      for (const param of (component && component.parameters) || []) {
        if (param && param.text) params.push(param.text);
      }
    }
    return params.length ? `Plantilla ${name}: ${params.join(' · ')}` : `Plantilla ${name}`;
  }
  return '';
}

function badRange(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}

function resolveRange(from, to, zone = ZONE) {
  const hasFrom = from != null && String(from).trim() !== '';
  const hasTo = to != null && String(to).trim() !== '';
  if (!hasFrom && !hasTo) {
    const end = DateTime.now().setZone(zone).startOf('day');
    const start = end.minus({ days: 29 });
    return {
      from: start.toFormat('yyyy-MM-dd'),
      to: end.toFormat('yyyy-MM-dd'),
      start: start.toUTC().toISO(),
      end: end.endOf('day').toUTC().toISO(),
      zone,
    };
  }
  if (!hasFrom || !hasTo) {
    throw badRange('Indica from y to como YYYY-MM-DD, o ninguno para los últimos 30 días.');
  }
  const bounds = weddingSources.dateBounds(String(from).trim(), String(to).trim(), zone);
  if (!bounds) throw badRange('Indica from y to como YYYY-MM-DD, con from anterior o igual a to.');
  return { from: String(from).trim(), to: String(to).trim(), start: bounds.start, end: bounds.end, zone };
}

function madridDay(iso, zone) {
  const dt = DateTime.fromISO(String(iso), { setZone: true }).setZone(zone);
  if (!dt.isValid) return null;
  return dt.toFormat('yyyy-MM-dd');
}

function shapeList(messages, conversations, range) {
  const byPhone = new Map((conversations || []).map((row) => [row.phone, row]));
  const grouped = new Map();
  for (const message of messages || []) {
    let item = grouped.get(message.phone);
    if (!item) {
      item = { phone: message.phone, firstAt: message.at, lastAt: message.at, messageCount: 0 };
      grouped.set(message.phone, item);
    }
    item.messageCount += 1;
    if (message.at < item.firstAt) item.firstAt = message.at;
    if (message.at > item.lastAt) item.lastAt = message.at;
  }
  const conversationsOut = [...grouped.values()]
    .sort((a, b) => (a.lastAt < b.lastAt ? 1 : a.lastAt > b.lastAt ? -1 : a.phone < b.phone ? -1 : 1))
    .slice(0, LIST_CAP)
    .map((item) => {
      const row = byPhone.get(item.phone) || {};
      const source = row.source || null;
      return {
        phone: item.phone,
        profileName: row.profile_name || null,
        firstAt: item.firstAt,
        lastAt: item.lastAt,
        messageCount: item.messageCount,
        topic: row.topic || 'general',
        source,
        sourceLabel: sourceLabel(source),
        outcome: row.outcome || 'abierta',
      };
    });
  return {
    timezone: range.zone,
    from: range.from,
    to: range.to,
    truncated: grouped.size > LIST_CAP || (messages || []).length >= MESSAGE_CAP,
    conversations: conversationsOut,
  };
}

function countBy(items, key) {
  const counts = new Map();
  for (const item of items) {
    const value = item[key] == null || item[key] === '' ? null : item[key];
    counts.set(value, (counts.get(value) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([value, count]) => ({ [key]: value, conversations: count }))
    .sort((a, b) => b.conversations - a.conversations || String(a[key]).localeCompare(String(b[key])));
}

function shapeStats(messages, conversations, range) {
  const byPhone = new Map((conversations || []).map((row) => [row.phone, row]));
  const days = new Map();
  const phones = new Map();
  let inbound = 0;
  let outbound = 0;
  for (const message of messages || []) {
    if (message.direction === 'out') outbound += 1;
    else inbound += 1;
    const day = madridDay(message.at, range.zone);
    if (!day) continue;
    let bucket = days.get(day);
    if (!bucket) {
      bucket = { day, messages: 0, inbound: 0, outbound: 0, phones: new Set() };
      days.set(day, bucket);
    }
    bucket.messages += 1;
    if (message.direction === 'out') bucket.outbound += 1;
    else bucket.inbound += 1;
    bucket.phones.add(message.phone);
    phones.set(message.phone, true);
  }
  const summaries = [...phones.keys()].map((phone) => {
    const row = byPhone.get(phone) || {};
    return {
      topic: row.topic || 'general',
      source: row.source || null,
      outcome: row.outcome || 'abierta',
    };
  });
  return {
    timezone: range.zone,
    from: range.from,
    to: range.to,
    truncated: (messages || []).length >= MESSAGE_CAP,
    totals: {
      conversations: phones.size,
      messages: (messages || []).length,
      inbound,
      outbound,
    },
    byDay: [...days.values()]
      .sort((a, b) => (a.day < b.day ? -1 : 1))
      .map((bucket) => ({
        day: bucket.day,
        conversations: bucket.phones.size,
        messages: bucket.messages,
        inbound: bucket.inbound,
        outbound: bucket.outbound,
      })),
    byTopic: countBy(summaries, 'topic'),
    bySource: countBy(summaries, 'source').map((row) => ({
      ...row,
      label: sourceLabel(row.source),
    })),
    byOutcome: countBy(summaries, 'outcome'),
  };
}

function database() {
  return require('./db');
}

async function readSession(phone) {
  const db = database();
  if (typeof db.getSession !== 'function') return null;
  try {
    return await db.getSession(phone);
  } catch (err) {
    return null;
  }
}

async function recordInbound(entry) {
  const phone = digits(entry && entry.phone);
  if (!phone) return;
  const db = database();
  const session = await readSession(phone);
  const messageTopic = detectTopic({
    text: entry.body,
    buttonId: entry.buttonId,
    session,
    phone,
  });
  const existing = typeof db.getConversation === 'function' ? await db.getConversation(phone) : null;
  await db.saveConversationTurn({
    phone,
    direction: 'in',
    body: entry.body,
    msgType: entry.msgType,
    messageTopic,
    conversationTopic: nextTopic(existing && existing.topic, messageTopic),
    profileName: entry.profileName,
    at: entry.at,
    sourceCandidate: sourceTag(entry.body),
  });
}

async function recordOutbound({ phone, body, msgType, at }) {
  const id = digits(phone);
  if (!id) return;
  const db = database();
  const existing = typeof db.getConversation === 'function' ? await db.getConversation(id) : null;
  const topic = (existing && existing.topic) || 'general';
  await db.saveConversationTurn({
    phone: id,
    direction: 'out',
    body,
    msgType,
    messageTopic: topic,
    conversationTopic: topic,
    profileName: null,
    at: at || new Date().toISOString(),
    sourceCandidate: null,
  });
}

async function syncAfterTurn(phone, text, buttonId) {
  const id = digits(phone);
  if (!id) return;
  const db = database();
  if (typeof db.getConversation !== 'function' || typeof db.setConversationTopic !== 'function') return;
  const session = await readSession(id);
  const detected = detectTopic({ text, buttonId, session, phone: id });
  const existing = await db.getConversation(id);
  if (!existing) return;
  const topic = nextTopic(existing.topic, detected);
  if (topic !== existing.topic) await db.setConversationTopic(id, topic);
}

async function listForAdmin({ from, to } = {}) {
  const range = resolveRange(from, to, config.business.timezone || ZONE);
  const db = database();
  const messages = await db.listConversationMessagesBetween(range.start, range.end, MESSAGE_CAP);
  const phones = [...new Set(messages.map((message) => message.phone))];
  const conversations = await db.getConversationsByPhones(phones);
  return shapeList(messages, conversations, range);
}

async function statsForAdmin({ from, to } = {}) {
  const range = resolveRange(from, to, config.business.timezone || ZONE);
  const db = database();
  const messages = await db.listConversationMessagesBetween(range.start, range.end, MESSAGE_CAP);
  const phones = [...new Set(messages.map((message) => message.phone))];
  const conversations = await db.getConversationsByPhones(phones);
  return shapeStats(messages, conversations, range);
}

async function transcriptForAdmin(phone) {
  const id = digits(phone);
  if (!id) throw badRange('El teléfono no es válido.');
  const db = database();
  const conversation = await db.getConversation(id);
  const messages = await db.listConversationTranscript(id, TRANSCRIPT_CAP);
  const source = conversation && conversation.source ? conversation.source : null;
  return {
    phone: id,
    profileName: (conversation && conversation.profile_name) || null,
    topic: (conversation && conversation.topic) || 'general',
    source,
    sourceLabel: sourceLabel(source),
    outcome: (conversation && conversation.outcome) || 'abierta',
    firstAt: (conversation && conversation.first_at) || null,
    lastAt: (conversation && conversation.last_at) || null,
    messageCount: conversation ? Number(conversation.message_count) || messages.length : messages.length,
    truncated: messages.length >= TRANSCRIPT_CAP,
    messages: messages.map((message) => ({
      id: message.id,
      at: message.at,
      direction: message.direction,
      type: message.msg_type,
      text: message.body || '',
      topic: message.topic || null,
      profileName: message.profile_name || null,
    })),
  };
}

module.exports = {
  EMPRESA_TRIGGER,
  SPECIFIC_TOPICS,
  sourceTag,
  sourceLabel,
  detectTopic,
  nextTopic,
  profileName,
  timestampFrom,
  outboundText,
  resolveRange,
  shapeList,
  shapeStats,
  recordInbound,
  recordOutbound,
  syncAfterTurn,
  listForAdmin,
  statsForAdmin,
  transcriptForAdmin,
};

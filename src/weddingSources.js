const { DateTime } = require('luxon');
const { normalize } = require('./dateParser');
const conocimiento = require('./eventosConocimiento');
const fotos = require('./fotos');
const faq = require('./faqLlegada');

const { WEDDING_TRIGGER } = conocimiento;

// Un portal nuevo: una línea aquí. El id es el que se guarda y el que sale en las estadísticas.
const WEDDING_SOURCES = [
  { id: 'bodas_net', label: 'Bodas.net' },
  { id: 'bodalia', label: 'Bodalia' },
  { id: 'loggiata', label: 'Loggiata' },
  { id: 'todoboda', label: 'TodoBoda' },
  { id: 'web', label: 'Web' },
  { id: 'instagram', label: 'Instagram' },
  { id: 'email', label: 'Email' },
];

const DIRECT_SOURCE = 'directo';
const WHATSAPP_NUMBER = '34923370076';

const COUNT_KEYS = [
  'leads',
  'sawPhotos',
  'askedMorePhotos',
  'gaveDate',
  'gaveGuests',
  'gaveCeremony',
  'gaveAccommodation',
  'gaveName',
  'visitRequests',
  'visitsConfirmed',
  'visitsRejected',
];

const STEP_FLAGS = {
  wdate: 'gaveDate',
  guests: 'gaveGuests',
  ceremony: 'gaveCeremony',
  rooms: 'gaveAccommodation',
  couple: 'gaveName',
};

function prepare(raw) {
  return normalize(raw)
    .replace(/[（]/g, '(')
    .replace(/[）]/g, ')')
    .replace(/\s+/g, ' ')
    .trim();
}

function canonicalToken(value) {
  return prepare(value).replace(/[^a-z0-9]+/g, '');
}

const SOURCE_BY_TOKEN = new Map();
for (const source of WEDDING_SOURCES) {
  SOURCE_BY_TOKEN.set(canonicalToken(source.label), source.id);
  SOURCE_BY_TOKEN.set(canonicalToken(source.id), source.id);
}

const TRIGGER = prepare(WEDDING_TRIGGER);

function portalSource(raw) {
  const text = prepare(raw);
  const at = text.indexOf(TRIGGER);
  if (at === -1) return null;
  const rest = text.slice(at + TRIGGER.length).trim().replace(/^[.!?…,:;\-]+/, '').trim();
  if (!rest) return null;
  const paren = rest.match(/^\(\s*([^)]*?)\s*\)\s*[.!?…]*\s*$/);
  const label = paren ? paren[1] : rest.replace(/[.!?…]+$/g, '').trim();
  if (!paren && /\s/.test(label) && !SOURCE_BY_TOKEN.has(canonicalToken(label))) return null;
  return SOURCE_BY_TOKEN.get(canonicalToken(label)) || null;
}

function sourceForWeddingStart(raw) {
  return portalSource(raw) || DIRECT_SOURCE;
}

function triggerText(sourceId) {
  const source = WEDDING_SOURCES.find((item) => item.id === sourceId);
  if (!source) return WEDDING_TRIGGER;
  return `${WEDDING_TRIGGER} (${source.label})`;
}

function waMeLink(sourceId) {
  return `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(triggerText(sourceId))}`;
}

function labelFor(sourceId) {
  if (sourceId === DIRECT_SOURCE) return 'Directo';
  const source = WEDDING_SOURCES.find((item) => item.id === sourceId);
  return source ? source.label : String(sourceId || DIRECT_SOURCE);
}

function emptyCounts() {
  const counts = {};
  for (const key of COUNT_KEYS) counts[key] = 0;
  return counts;
}

function publicQuestion(text) {
  return String(text || '')
    .replace(/\+?\d(?:[\s().-]*\d){8,}/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 500);
}

function dateBounds(from, to, zone = 'Europe/Madrid') {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from || '') || !/^\d{4}-\d{2}-\d{2}$/.test(to || '')) return null;
  const start = DateTime.fromISO(from, { zone });
  const end = DateTime.fromISO(to, { zone });
  if (!start.isValid || !end.isValid) return null;
  if (start.toFormat('yyyy-MM-dd') !== from || end.toFormat('yyyy-MM-dd') !== to) return null;
  if (end.startOf('day') < start.startOf('day')) return null;
  return {
    start: new Date(start.startOf('day').toUTC().toISO()).toISOString(),
    end: new Date(end.endOf('day').toUTC().toISO()).toISOString(),
  };
}

function countsFromRow(row) {
  const counts = emptyCounts();
  counts.leads = Number(row.leads) || 0;
  counts.sawPhotos = Number(row.saw_photos) || 0;
  counts.askedMorePhotos = Number(row.asked_more_photos) || 0;
  counts.gaveDate = Number(row.gave_date) || 0;
  counts.gaveGuests = Number(row.gave_guests) || 0;
  counts.gaveCeremony = Number(row.gave_ceremony) || 0;
  counts.gaveAccommodation = Number(row.gave_accommodation) || 0;
  counts.gaveName = Number(row.gave_name) || 0;
  counts.visitRequests = Number(row.visit_requests) || 0;
  counts.visitsConfirmed = Number(row.visits_confirmed) || 0;
  counts.visitsRejected = Number(row.visits_rejected) || 0;
  return counts;
}

function shapeWeddingStats({ from, to, rows, questions }) {
  const byId = new Map();
  for (const row of rows || []) byId.set(row.source || DIRECT_SOURCE, countsFromRow(row));
  const ids = [...WEDDING_SOURCES.map((source) => source.id), DIRECT_SOURCE];
  for (const id of byId.keys()) {
    if (!ids.includes(id)) ids.push(id);
  }
  const bySource = ids.map((id) => ({
    source: id,
    label: labelFor(id),
    ...(byId.get(id) || emptyCounts()),
  }));
  const totals = emptyCounts();
  for (const row of bySource) {
    for (const key of COUNT_KEYS) totals[key] += row[key];
  }
  const cleaned = [];
  for (const row of questions || []) {
    const text = publicQuestion(row.question);
    if (!text) continue;
    cleaned.push({ text, at: row.asked_at });
  }
  return { from, to, bySource, totals, questions: cleaned };
}

function weddingQuestionText({ text, buttonId, beforeData, afterData, result }) {
  if (buttonId) return '';
  const raw = String(text || '').replace(/\s+/g, ' ').trim();
  if (!raw || beforeData.flow !== 'boda') return '';
  if (result && result.reservation) return '';
  const norm = prepare(raw);
  if (fotos.isMoreWeddingPhotos(norm)) return '';
  if (afterData.stage && beforeData.stage && afterData.stage !== beforeData.stage) return '';
  if (/\?/.test(raw)) return raw.slice(0, 500);
  if (conocimiento.answerSideQuestion(norm, 'boda')) return raw.slice(0, 500);
  if (/^(que |cual |cuanto |cuanta |teneis |hay |podeis |puede |poneis |donde |como )/.test(norm)) return raw.slice(0, 500);
  if ((faq.isLocationQuery(norm) || faq.isTransportQuery(norm)) && faq.shouldAnswerNow(raw, norm)) {
    return raw.slice(0, 500);
  }
  return '';
}

function visitRequestedInDetails(details) {
  const parts = String(details || '').split('|').map((part) => part.trim());
  const hit = parts.find((part) => part.toLowerCase().startsWith('visita:'));
  if (!hit) return false;
  const value = hit.slice(hit.indexOf(':') + 1).trim();
  if (!value || /^(no|aún no|aun no)$/i.test(value)) return false;
  return true;
}

// Qué hay que guardar de este turno. No incluye el teléfono: lo pone quien llama.
function turnUpdate({ text, buttonId, before, result, sawPhotos, askedMorePhotos } = {}) {
  const beforeData = (before && before.data) || {};
  const afterData = (result && result.data) || {};
  const beforeBoda = beforeData.flow === 'boda';
  const afterBoda = afterData.flow === 'boda';
  const record = result && result.reservation && result.reservation.record;
  const submitted = !!(record && record.type === 'evento_boda');
  const more = !!askedMorePhotos || (beforeBoda && fotos.isMoreWeddingPhotos(prepare(text)));
  if (!beforeBoda && !afterBoda && !submitted && !more) return {};

  const steps = {};
  if (sawPhotos || more) steps.sawPhotos = true;
  if (more) steps.askedMorePhotos = true;
  const replies = (result && result.replies) || [];
  if ((afterBoda || beforeBoda || submitted) && replies.some((reply) => reply && reply.kind === 'image')) {
    steps.sawPhotos = true;
  }
  if (beforeBoda && afterBoda && afterData.stage && afterData.stage !== beforeData.stage) {
    const flag = STEP_FLAGS[beforeData.stage];
    if (flag) steps[flag] = true;
    if (beforeData.stage === 'visit' && afterData.visit === 'sí') steps.visitRequested = true;
  }
  if (submitted) {
    steps.gaveDate = true;
    steps.gaveGuests = true;
    steps.gaveCeremony = true;
    steps.gaveAccommodation = true;
    steps.gaveName = true;
    if (visitRequestedInDetails(record.details)) steps.visitRequested = true;
  }

  const question = weddingQuestionText({ text, buttonId, beforeData, afterData, result });
  const hasSteps = Object.values(steps).some(Boolean);
  const starting = afterBoda && !beforeBoda;
  const source = (afterBoda && afterData.source) || beforeData.source || sourceForWeddingStart(text);
  return {
    lead: starting || hasSteps || submitted ? { source, steps } : null,
    question: question || null,
  };
}

module.exports = {
  WEDDING_SOURCES,
  DIRECT_SOURCE,
  WHATSAPP_NUMBER,
  COUNT_KEYS,
  portalSource,
  sourceForWeddingStart,
  triggerText,
  waMeLink,
  labelFor,
  emptyCounts,
  publicQuestion,
  dateBounds,
  shapeWeddingStats,
  turnUpdate,
  visitRequestedInDetails,
};

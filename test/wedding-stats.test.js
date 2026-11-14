const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { Settings } = require('luxon');

process.env.ADMIN_PHONE = '34699999999';
process.env.ADMIN_KEY = 'test-key';
process.env.WHATSAPP_PROVIDER = 'meta';
process.env.TURSO_DATABASE_URL = 'libsql://example.turso.io';
process.env.TURSO_AUTH_TOKEN = 'test';
process.env.VERIFY_TOKEN = 'verify-test';

const axios = require('axios');

const leads = new Map();
const questions = [];
const sessions = new Map();
const reservations = [];
const customers = new Map();
const sqlLog = [];
let nextReservationId = 1;
let nextQuestionId = 1;

function argToJs(arg) {
  if (!arg || arg.type === 'null') return null;
  if (arg.type === 'integer') return Number(arg.value);
  return arg.value;
}

function cell(value) {
  if (value == null) return { type: 'null' };
  if (typeof value === 'number') return { type: 'integer', value: String(value) };
  return { type: 'text', value: String(value) };
}

function pipelineOk(result) {
  return { data: { results: [{ type: 'ok', response: { result } }] } };
}

function emptyResult() {
  return pipelineOk({ cols: [], rows: [], affected_row_count: 0, last_insert_rowid: 0 });
}

function rowsResult(cols, list) {
  return pipelineOk({
    cols: cols.map((name) => ({ name })),
    rows: list.map((row) => cols.map((name) => cell(row[name]))),
  });
}

const LEAD_COLS = [
  'phone',
  'source',
  'first_contact_at',
  'saw_photos',
  'asked_more_photos',
  'gave_date',
  'gave_guests',
  'gave_ceremony',
  'gave_accommodation',
  'gave_name',
  'visit_requested',
  'visit_decision',
  'updated_at',
];

function blankLead(phone, source, at) {
  return {
    phone,
    source,
    first_contact_at: at,
    saw_photos: 0,
    asked_more_photos: 0,
    gave_date: 0,
    gave_guests: 0,
    gave_ceremony: 0,
    gave_accommodation: 0,
    gave_name: 0,
    visit_requested: 0,
    visit_decision: null,
    updated_at: at,
  };
}

axios.post = async (url, body) => {
  const stmt = body?.requests?.[0]?.stmt;
  const sql = stmt?.sql || '';
  const args = (stmt?.args || []).map(argToJs);
  sqlLog.push(sql);
  if (/^\s*(CREATE|ALTER)\b/i.test(sql)) return emptyResult();

  if (/INSERT INTO sessions/i.test(sql)) {
    sessions.set(String(args[0]), { step: args[1], data: args[2] });
    return pipelineOk({ cols: [], rows: [], affected_row_count: 1 });
  }
  if (/SELECT step, data FROM sessions/i.test(sql)) {
    const row = sessions.get(String(args[0]));
    if (!row) return emptyResult();
    return rowsResult(['step', 'data'], [row]);
  }
  if (/DELETE FROM sessions/i.test(sql)) {
    sessions.delete(String(args[0]));
    return pipelineOk({ cols: [], rows: [], affected_row_count: 1 });
  }

  if (/INSERT INTO customers/i.test(sql) && /last_inbound_at/i.test(sql)) {
    const phone = String(args[0]);
    const prev = customers.get(phone) || {};
    customers.set(phone, { ...prev, phone, updated_at: args[1], last_inbound_at: args[2] });
    return pipelineOk({ cols: [], rows: [], affected_row_count: 1 });
  }
  if (/SELECT last_inbound_at FROM customers/i.test(sql)) {
    const row = customers.get(String(args[0]));
    if (!row) return emptyResult();
    return rowsResult(['last_inbound_at'], [row]);
  }

  if (/INSERT INTO reservations/i.test(sql)) {
    const row = {
      id: nextReservationId++,
      phone: args[0],
      name: args[1],
      party_size: args[2],
      date: args[3],
      time: args[4],
      type: args[5],
      details: args[6],
      status: args[7],
      created_at: args[8],
      reject_reason: null,
      customer_notice: null,
      decided_at: null,
    };
    reservations.push(row);
    return pipelineOk({ cols: [], rows: [], last_insert_rowid: row.id, affected_row_count: 1 });
  }
  if (/UPDATE reservations SET customer_notice/i.test(sql)) {
    const row = reservations.find((item) => item.id === Number(args[1]));
    if (row) row.customer_notice = args[0];
    return pipelineOk({ cols: [], rows: [], affected_row_count: row ? 1 : 0 });
  }
  if (/UPDATE reservations/i.test(sql) && /status = \?/i.test(sql)) {
    const [status, reason, notice, decidedAt, id] = args;
    const row = reservations.find((item) => item.id === Number(id) && item.status === 'pending');
    if (!row) return pipelineOk({ cols: [], rows: [], affected_row_count: 0 });
    row.status = status;
    row.reject_reason = reason;
    row.customer_notice = notice;
    row.decided_at = decidedAt;
    return pipelineOk({ cols: [], rows: [], affected_row_count: 1 });
  }
  if (/FROM reservations/i.test(sql)) {
    if (/WHERE id = \?/i.test(sql)) {
      const row = reservations.find((item) => item.id === Number(args[0]));
      if (!row) return emptyResult();
      return rowsResult(Object.keys(row), [row]);
    }
    return emptyResult();
  }

  if (/INSERT INTO wedding_leads/i.test(sql) && /MAX\(wedding_leads\.saw_photos/.test(sql)) {
    const [phone, source, first, saw, more, date, guests, ceremony, stay, name, visit, updated] = args;
    const existing = leads.get(phone);
    if (!existing) {
      leads.set(phone, {
        ...blankLead(phone, source, first),
        saw_photos: saw,
        asked_more_photos: more,
        gave_date: date,
        gave_guests: guests,
        gave_ceremony: ceremony,
        gave_accommodation: stay,
        gave_name: name,
        visit_requested: visit,
        updated_at: updated,
      });
    } else {
      existing.updated_at = updated;
      existing.saw_photos = Math.max(existing.saw_photos, saw);
      existing.asked_more_photos = Math.max(existing.asked_more_photos, more);
      existing.gave_date = Math.max(existing.gave_date, date);
      existing.gave_guests = Math.max(existing.gave_guests, guests);
      existing.gave_ceremony = Math.max(existing.gave_ceremony, ceremony);
      existing.gave_accommodation = Math.max(existing.gave_accommodation, stay);
      existing.gave_name = Math.max(existing.gave_name, name);
      existing.visit_requested = Math.max(existing.visit_requested, visit);
    }
    return pipelineOk({ cols: [], rows: [], affected_row_count: 1 });
  }
  if (/INSERT INTO wedding_leads/i.test(sql) && /visit_decision = excluded\.visit_decision/.test(sql)) {
    const [phone, first, decision, updated] = args;
    const existing = leads.get(phone);
    if (!existing) {
      leads.set(phone, {
        ...blankLead(phone, 'directo', first),
        visit_requested: 1,
        visit_decision: decision,
        updated_at: updated,
      });
    } else {
      existing.visit_decision = decision;
      existing.visit_requested = 1;
      existing.updated_at = updated;
    }
    return pipelineOk({ cols: [], rows: [], affected_row_count: 1 });
  }
  if (/SELECT \* FROM wedding_leads WHERE phone/i.test(sql)) {
    const row = leads.get(String(args[0]));
    if (!row) return emptyResult();
    return rowsResult(LEAD_COLS, [row]);
  }
  if (/FROM wedding_leads/i.test(sql) && /GROUP BY source/i.test(sql)) {
    const [start, end] = args;
    const grouped = new Map();
    for (const lead of leads.values()) {
      if (lead.first_contact_at < start || lead.first_contact_at > end) continue;
      const row = grouped.get(lead.source) || {
        source: lead.source,
        leads: 0,
        saw_photos: 0,
        asked_more_photos: 0,
        gave_date: 0,
        gave_guests: 0,
        gave_ceremony: 0,
        gave_accommodation: 0,
        gave_name: 0,
        visit_requests: 0,
        visits_confirmed: 0,
        visits_rejected: 0,
      };
      row.leads += 1;
      row.saw_photos += lead.saw_photos;
      row.asked_more_photos += lead.asked_more_photos;
      row.gave_date += lead.gave_date;
      row.gave_guests += lead.gave_guests;
      row.gave_ceremony += lead.gave_ceremony;
      row.gave_accommodation += lead.gave_accommodation;
      row.gave_name += lead.gave_name;
      row.visit_requests += lead.visit_requested;
      if (lead.visit_decision === 'confirmed') row.visits_confirmed += 1;
      if (lead.visit_decision === 'rejected') row.visits_rejected += 1;
      grouped.set(lead.source, row);
    }
    return rowsResult(
      [
        'source',
        'leads',
        'saw_photos',
        'asked_more_photos',
        'gave_date',
        'gave_guests',
        'gave_ceremony',
        'gave_accommodation',
        'gave_name',
        'visit_requests',
        'visits_confirmed',
        'visits_rejected',
      ],
      [...grouped.values()]
    );
  }
  if (/INSERT INTO wedding_questions/i.test(sql)) {
    questions.push({
      id: nextQuestionId++,
      phone: String(args[0]),
      question: args[1],
      asked_at: args[2],
    });
    return pipelineOk({ cols: [], rows: [], last_insert_rowid: nextQuestionId - 1, affected_row_count: 1 });
  }
  if (/FROM wedding_questions/i.test(sql)) {
    const [start, end] = args;
    const list = questions
      .filter((row) => row.asked_at >= start && row.asked_at <= end)
      .sort((a, b) => b.id - a.id)
      .slice(0, 50);
    return rowsResult(['question', 'asked_at'], list);
  }

  if (/^\s*(INSERT|UPDATE|DELETE)\b/i.test(sql)) {
    return pipelineOk({ cols: [], rows: [], affected_row_count: 1 });
  }
  return emptyResult();
};

const sent = [];
const mockWa = {
  async sendText(to, body) {
    sent.push({ to, kind: 'text', body });
  },
  async sendButtons(to, body, buttons) {
    sent.push({ to, kind: 'buttons', body, buttons });
  },
  async sendList(to, body, buttonText, rows) {
    sent.push({ to, kind: 'list', body, buttonText, rows });
  },
  async sendTemplate(to, options) {
    sent.push({ to, kind: 'template', body: (options.bodyParameters || []).join(' '), options });
  },
  async sendImage(to, image) {
    sent.push({ to, kind: 'image', body: image.caption || '', link: image.link || '' });
  },
};

const Module = require('module');
const originalRequire = Module.prototype.require;
Module.prototype.require = function (id) {
  if (id === './wa' || id === '../wa') return mockWa;
  if (id === './hotelApi' || id === '../hotelApi') {
    return {
      async confirmReservation() {
        return { ok: true };
      },
      async deleteReservation() {
        return { ok: true };
      },
    };
  }
  return originalRequire.apply(this, arguments);
};

const db = require('../src/db');
const weddingSources = require('../src/weddingSources');
const grupos = require('../src/grupos');
const { normalize } = require('../src/dateParser');
const { handleIncoming } = require('../src/conversation');
const { applyDecision } = require('../src/reservasDecision');
const { createApp, renderAdminPage } = require('../src/server-meta');

function snapshot(messages) {
  return messages.map((message) => ({ kind: message.kind, body: message.body }));
}

async function say(phone, text, buttonId = null) {
  const before = sent.length;
  await handleIncoming(phone, text, buttonId, null);
  return sent.slice(before).filter((message) => message.to === phone);
}

const BUSINESS = { name: 'Hostería Don Fadrique', phone: '923 37 00 76', email: 'reservas@donfadrique.com' };

describe('origen del portal de bodas', () => {
  const portals = [
    ['Bodas.net', 'bodas_net'],
    ['Bodalia', 'bodalia'],
    ['Loggiata', 'loggiata'],
    ['TodoBoda', 'todoboda'],
    ['Web', 'web'],
    ['Instagram', 'instagram'],
    ['Email', 'email'],
  ];

  it('deja el mapa en una sola constante, fácil de ampliar', () => {
    assert.deepEqual(
      weddingSources.WEDDING_SOURCES.map((source) => [source.label, source.id]),
      portals
    );
    assert.equal(weddingSources.DIRECT_SOURCE, 'directo');
    assert.equal(weddingSources.WHATSAPP_NUMBER, '34923370076');
  });

  for (const [label, id] of portals) {
    it(`«${label}» es ${id}, con mayúsculas, espacios y paréntesis de sobra`, () => {
      const exact = `Quiero información para mi boda (${label})`;
      const messy = `  QUIERO   información   PARA mi boda  (  ${label}  ) . `;
      assert.equal(weddingSources.portalSource(exact), id);
      assert.equal(weddingSources.portalSource(messy), id);
      assert.equal(weddingSources.sourceForWeddingStart(exact), id);
      assert.equal(weddingSources.triggerText(id), exact);
      assert.equal(
        weddingSources.waMeLink(id),
        `https://wa.me/34923370076?text=${encodeURIComponent(exact)}`
      );
    });
  }

  it('codifica el enlace de Bodas.net con los paréntesis y la tilde', () => {
    assert.equal(
      weddingSources.waMeLink('bodas_net'),
      'https://wa.me/34923370076?text=Quiero%20informaci%C3%B3n%20para%20mi%20boda%20(Bodas.net)'
    );
    assert.equal(
      weddingSources.waMeLink('directo'),
      'https://wa.me/34923370076?text=Quiero%20informaci%C3%B3n%20para%20mi%20boda'
    );
  });

  it('el disparador solo, otra entrada o un portal desconocido son directo', () => {
    for (const phrase of [
      'Quiero información para mi boda',
      'quiero   informacion   para mi boda',
      'quiero una boda',
      'boda',
      'preboda',
      'Quiero información para mi boda (Facebook)',
      'Quiero información para mi boda por favor',
    ]) {
      assert.equal(weddingSources.sourceForWeddingStart(phrase), 'directo', phrase);
    }
    assert.equal(weddingSources.portalSource('Quiero información para mi boda'), null);
    assert.equal(weddingSources.portalSource('Quiero información para mi boda (Facebook)'), null);
    assert.equal(grupos.classifyIncoming(normalize('Quiero   información   para mi boda (Bodas.net)')).kind, 'boda');
  });

  it('al corregir la solicitud conserva el origen', () => {
    const result = grupos.handle({
      data: { flow: 'boda', stage: 'review', source: 'web', contactName: 'Ana' },
      text: 'corregir',
      buttonId: 'emp_fix',
      from: '34610000011',
      zone: 'Europe/Madrid',
      business: BUSINESS,
    });
    assert.equal(result.data.flow, 'boda');
    assert.equal(result.data.stage, 'wdate');
    assert.equal(result.data.source, 'web');
    assert.doesNotMatch(result.replies.map((reply) => reply.body).join('\n'), /web|bodas_net/i);
  });
});

describe('persistencia y estadísticas de bodas', { concurrency: 1 }, () => {
  const RealDate = Date;
  before(async () => {
    class FixedDate extends RealDate {
      constructor(...args) {
        if (args.length === 0) super('2026-11-14T09:00:00.000Z');
        else super(...args);
      }
      static now() {
        return new RealDate('2026-11-14T09:00:00.000Z').getTime();
      }
    }
    global.Date = FixedDate;
    Settings.now = () => new RealDate('2026-11-14T10:00:00+01:00').getTime();
    await db.ready;
  });

  after(() => {
    global.Date = RealDate;
  });

  it('crea las tablas y no pisa el origen ni la hora del primer contacto', async () => {
    const createLead = sqlLog.find((sql) => /CREATE TABLE IF NOT EXISTS wedding_leads/i.test(sql));
    const createQuestion = sqlLog.find((sql) => /CREATE TABLE IF NOT EXISTS wedding_questions/i.test(sql));
    assert.ok(createLead);
    for (const column of [
      'phone',
      'source',
      'first_contact_at',
      'saw_photos',
      'asked_more_photos',
      'gave_date',
      'gave_guests',
      'gave_ceremony',
      'gave_accommodation',
      'gave_name',
      'visit_requested',
      'visit_decision',
    ]) {
      assert.match(createLead, new RegExp(`\\b${column}\\b`));
    }
    assert.match(createQuestion, /phone/);
    assert.match(createQuestion, /question/);
    assert.match(createQuestion, /asked_at/);

    await db.touchWeddingLead('+34 600-111-222', {
      source: 'bodalia',
      steps: { sawPhotos: true },
      at: '2026-10-01T10:00:00.000Z',
    });
    await db.touchWeddingLead('0034 600 111 222', {
      source: 'instagram',
      steps: { gaveDate: true },
      at: '2026-12-01T10:00:00.000Z',
    });
    const lead = await db.getWeddingLead('34600111222');
    assert.equal(lead.phone, '34600111222');
    assert.equal(lead.source, 'bodalia');
    assert.equal(lead.first_contact_at, '2026-10-01T10:00:00.000Z');
    assert.equal(lead.saw_photos, 1);
    assert.equal(lead.gave_date, 1);
    assert.equal(lead.visit_decision, null);

    const insert = sqlLog.find((sql) => /INSERT INTO wedding_leads/i.test(sql) && /MAX\(wedding_leads\.saw_photos/.test(sql));
    assert.match(insert, /ON CONFLICT\(phone\) DO UPDATE/);
    assert.doesNotMatch(insert, /source = excluded\.source/);
    assert.doesNotMatch(insert, /first_contact_at = excluded/);
  });

  it('el enlace con portal abre el mismo flujo, sin devolver la etiqueta, y guarda los pasos', async () => {
    const plainPhone = '34610000001';
    const portalPhone = '34610000002';
    const plain = snapshot(await say(plainPhone, 'Quiero información para mi boda'));
    const tagged = snapshot(
      await say(portalPhone, '  Quiero   información   para mi boda  (  Bodas.net  ) ')
    );
    assert.deepEqual(tagged, plain);
    assert.equal(plain.filter((message) => message.kind === 'image').length, 3);
    const joined = tagged.map((message) => message.body).join('\n');
    assert.doesNotMatch(joined, /bodas_net|Bodas\.net|Bodalia|Loggiata|TodoBoda|Instagram/i);
    assert.equal(sessions.get(portalPhone) && JSON.parse(sessions.get(portalPhone).data).source, 'bodas_net');
    assert.equal(JSON.parse(sessions.get(plainPhone).data).source, 'directo');

    await say(portalPhone, 'más fotos');
    await say(portalPhone, '¿podemos llevar nuestro wedding planner?');
    await say(portalPhone, '¿me llamáis al 34600999888?');
    await say(portalPhone, '12/06/2027');
    await say(portalPhone, 'unas 120');
    await say(portalPhone, 'sí', 'boda_si');
    await say(portalPhone, 'sí', 'boda_hab_si');
    await say(portalPhone, 'Ana y Luis');
    await say(portalPhone, 'ana@example.com');
    await say(portalPhone, 'sí', 'boda_vis_si');
    await say(portalPhone, '20/06/2027 a las 12');
    const done = await say(portalPhone, 'enviar', 'emp_send');
    assert.match(done.map((message) => message.body).join('\n'), /pendiente de presupuesto/i);
    assert.doesNotMatch(done.map((message) => message.body).join('\n'), /bodas_net|Bodas\.net/);

    const lead = await db.getWeddingLead(portalPhone);
    assert.equal(lead.source, 'bodas_net');
    assert.equal(lead.saw_photos, 1);
    assert.equal(lead.asked_more_photos, 1);
    assert.equal(lead.gave_date, 1);
    assert.equal(lead.gave_guests, 1);
    assert.equal(lead.gave_ceremony, 1);
    assert.equal(lead.gave_accommodation, 1);
    assert.equal(lead.gave_name, 1);
    assert.equal(lead.visit_requested, 1);
    assert.equal(lead.visit_decision, null);
    assert.equal(lead.phone, portalPhone);

    const direct = await db.getWeddingLead(plainPhone);
    assert.equal(direct.source, 'directo');
    assert.equal(direct.saw_photos, 1);
    assert.equal(direct.asked_more_photos, 0);

    const storedQuestion = questions.find((row) => row.phone === portalPhone && /34600999888/.test(row.question));
    assert.ok(storedQuestion, 'la pregunta se guarda con el teléfono, para no perder el texto');
    const planner = questions.find((row) => row.phone === portalPhone && /wedding planner/i.test(row.question));
    assert.ok(planner);

    const saved = reservations.find((row) => row.phone === portalPhone);
    assert.equal(saved.type, 'evento_boda');
    assert.match(saved.details, /Visita:/);
    const decision = await applyDecision({ id: saved.id, action: 'confirm' });
    assert.equal(decision.httpStatus, 200);
    const confirmed = await db.getWeddingLead(portalPhone);
    assert.equal(confirmed.visit_decision, 'confirmed');
    assert.equal(confirmed.source, 'bodas_net');
    const customer = sent.filter((message) => message.to === portalPhone).at(-1).body;
    assert.match(customer, /confirmada/i);
    assert.doesNotMatch(customer, /bodas_net|Bodas\.net/);
  });

  it('una visita rechazada cuenta como rechazada, y un OK sin visita no', async () => {
    await db.touchWeddingLead('34610000003', {
      source: 'instagram',
      steps: { sawPhotos: true, visitRequested: true },
      at: '2026-11-02T11:00:00.000Z',
    });
    const rejectedId = await db.createReservation({
      phone: '34610000003',
      name: 'Marta y Leo',
      partySize: 80,
      date: '2027-09-04',
      time: 'boda',
      type: 'evento_boda',
      details: 'Pareja/contacto: Marta y Leo | Visita: por concretar | Tel: 34610000003',
      status: 'pending',
    });
    const rejected = await applyDecision({ id: rejectedId, action: 'reject', reason: 'ese día no podemos' });
    assert.equal(rejected.httpStatus, 200);
    assert.equal((await db.getWeddingLead('34610000003')).visit_decision, 'rejected');

    await db.touchWeddingLead('34610000004', {
      source: 'directo',
      steps: { sawPhotos: true, gaveName: true },
      at: '2026-11-03T11:00:00.000Z',
    });
    const plainId = await db.createReservation({
      phone: '34610000004',
      name: 'Nuria',
      partySize: 40,
      date: '2027-08-08',
      time: 'boda',
      type: 'evento_boda',
      details: 'Pareja/contacto: Nuria | Visita: no | Tel: 34610000004',
      status: 'pending',
    });
    await applyDecision({ id: plainId, action: 'confirm' });
    const plain = await db.getWeddingLead('34610000004');
    assert.equal(plain.visit_decision, null);
    assert.equal(plain.visit_requested, 0);
    assert.equal(plain.source, 'directo');
  });

  it('el endpoint agrupa por origen, recorta a 50 preguntas y no devuelve teléfonos', async () => {
    const oldQuestion = '¿hay piscina en invierno?';
    await db.addWeddingQuestion('34610000002', oldQuestion, '2020-01-02T10:00:00.000Z');
    for (let i = 0; i < 55; i += 1) {
      await db.addWeddingQuestion(
        '34610000002',
        `pregunta número ${i} sobre la boda`,
        `2026-11-10T10:00:${String(i).padStart(2, '0')}.000Z`
      );
    }

    const limited = await db.weddingStats({ from: '2026-11-10', to: '2026-11-10' });
    assert.equal(limited.questions.length, 50);
    assert.match(limited.questions[0].text, /pregunta número 54/);
    assert.equal(JSON.stringify(limited).includes('34610000002'), false);

    const narrow = await db.weddingStats({ from: '2026-11-14', to: '2026-11-14' });
    const portal = narrow.bySource.find((row) => row.source === 'bodas_net');
    const direct = narrow.bySource.find((row) => row.source === 'directo');
    assert.equal(portal.leads, 1);
    assert.equal(portal.sawPhotos, 1);
    assert.equal(portal.askedMorePhotos, 1);
    assert.equal(portal.gaveDate, 1);
    assert.equal(portal.gaveGuests, 1);
    assert.equal(portal.gaveCeremony, 1);
    assert.equal(portal.gaveAccommodation, 1);
    assert.equal(portal.gaveName, 1);
    assert.equal(portal.visitRequests, 1);
    assert.equal(portal.visitsConfirmed, 1);
    assert.equal(portal.visitsRejected, 0);
    assert.equal(portal.label, 'Bodas.net');
    assert.ok(direct.leads >= 1);
    assert.equal(narrow.bySource.map((row) => row.source).slice(0, 8).join(','), [
      'bodas_net',
      'bodalia',
      'loggiata',
      'todoboda',
      'web',
      'instagram',
      'email',
      'directo',
    ].join(','));
    assert.ok(narrow.questions.some((question) => /wedding planner/i.test(question.text)));
    assert.ok(narrow.questions.length < 50);
    assert.ok(narrow.questions.every((question) => !('phone' in question)));
    const dumped = JSON.stringify(narrow);
    assert.equal(dumped.includes('34610000002'), false);
    assert.equal(dumped.includes('34600999888'), false);
    assert.doesNotMatch(dumped, /piscina en invierno/);

    const outside = await db.weddingStats({ from: '2026-10-01', to: '2026-10-31' });
    assert.equal(outside.bySource.find((row) => row.source === 'bodalia').leads, 1);
    assert.equal(outside.bySource.find((row) => row.source === 'bodas_net').leads, 0);
    assert.equal(outside.totals.leads, 1);

    const questionSql = sqlLog.find((sql) => /FROM wedding_questions/i.test(sql) && /SELECT/i.test(sql));
    assert.match(questionSql, /SELECT question, asked_at/);
    assert.doesNotMatch(questionSql, /SELECT[\s\S]*\bphone\b/i);

    const app = createApp(() => {});
    const server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const port = server.address().port;
    try {
      const denied = await fetch(`http://127.0.0.1:${port}/admin/wedding-stats?from=2026-11-01&to=2026-11-14`);
      assert.equal(denied.status, 403);
      const wrong = await fetch(`http://127.0.0.1:${port}/admin/wedding-stats?from=2026-11-01&to=2026-11-14`, {
        headers: { 'x-admin-key': 'no-vale' },
      });
      assert.equal(wrong.status, 403);
      const bad = await fetch(`http://127.0.0.1:${port}/admin/wedding-stats?key=test-key&from=2026-11-20&to=2026-11-01`);
      assert.equal(bad.status, 400);
      const missing = await fetch(`http://127.0.0.1:${port}/admin/wedding-stats?key=test-key`);
      assert.equal(missing.status, 400);

      const response = await fetch(
        `http://127.0.0.1:${port}/admin/wedding-stats?key=test-key&from=2026-11-01&to=2026-11-30`,
        { headers: { 'x-admin-key': 'test-key' } }
      );
      assert.equal(response.status, 200);
      const body = await response.json();
      assert.equal(body.ok, true);
      assert.equal(body.from, '2026-11-01');
      assert.equal(body.to, '2026-11-30');
      const instagram = body.bySource.find((row) => row.source === 'instagram');
      assert.equal(instagram.leads, 1);
      assert.equal(instagram.visitRequests, 1);
      assert.equal(instagram.visitsRejected, 1);
      assert.equal(body.totals.visitsConfirmed, 1);
      assert.equal(body.totals.visitsRejected, 1);
      assert.equal(JSON.stringify(body).includes('34610000003'), false);
      assert.ok(body.questions.length <= 50);
      assert.ok(body.questions.every((question) => Object.keys(question).every((key) => key === 'text' || key === 'at')));

      const panel = await fetch(`http://127.0.0.1:${port}/admin?key=test-key`);
      assert.equal(panel.status, 200);
      const html = await panel.text();
      assert.match(html, /Bodas por origen/);
      assert.match(html, /Últimos 7 días/);
      assert.match(html, /Últimos 30 días/);
      assert.match(html, /Bodas\.net/);
      assert.match(html, /Instagram/);
      assert.match(html, /pregunta número/);
      const questionsHtml = html.split('<h3>Últimas preguntas</h3>')[1];
      assert.ok(questionsHtml);
      assert.doesNotMatch(questionsHtml, /34610000002|34600999888|34610000003/);
    } finally {
      server.close();
      await once(server, 'close');
    }
  });

  it('el panel pinta los dos periodos y escapa la pregunta', () => {
    const html = renderAdminPage({
      businessName: 'Hostería Don Fadrique',
      confirmed: [],
      pending: [],
      statuses: [],
      adminKey: 'test-key',
      wedding: {
        week: {
          from: '2026-11-08',
          to: '2026-11-14',
          bySource: [{ source: 'web', label: 'Web', ...weddingSources.emptyCounts(), leads: 2, sawPhotos: 2 }],
          totals: { ...weddingSources.emptyCounts(), leads: 2, sawPhotos: 2 },
          questions: [],
        },
        month: {
          from: '2026-10-16',
          to: '2026-11-14',
          bySource: [{ source: 'web', label: 'Web', ...weddingSources.emptyCounts(), leads: 4, visitsConfirmed: 1 }],
          totals: { ...weddingSources.emptyCounts(), leads: 4, visitsConfirmed: 1 },
          questions: [{ text: '¿hay <script> y el 34600111000?', at: '2026-11-01T10:00:00.000Z' }],
        },
      },
    });
    assert.match(html, /2026-11-08 a 2026-11-14/);
    assert.match(html, /2026-10-16 a 2026-11-14/);
    assert.match(html, />Web</);
    assert.match(html, /&lt;script&gt;/);
    assert.doesNotMatch(html, /<script>/);
    const questionsHtml = html.split('<h3>Últimas preguntas</h3>')[1];
    assert.doesNotMatch(questionsHtml, /34600111000/);
  });
});

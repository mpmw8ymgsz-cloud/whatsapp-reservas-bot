const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { Settings } = require('luxon');

process.env.ADMIN_PHONE = '34699999999';
delete process.env.ADMIN_ALERT_TEMPLATE;
process.env.WHATSAPP_PROVIDER = 'meta';
process.env.TURSO_DATABASE_URL = 'libsql://example.turso.io';
process.env.TURSO_AUTH_TOKEN = 'test';
process.env.ADMIN_KEY = 'test-key';

const sent = [];
const sessions = new Map();
const reservations = [];
const optouts = new Map();
let failAdminText = false;
let failAdminTemplate = false;
let failImages = false;
let failWindowFor = null;
const hotelCalls = [];
const inboundAt = new Map();

function metaSendError(message, code) {
  const err = new Error(message);
  err.response = { data: { error: { message, code } } };
  return err;
}

const mockDb = {
  ready: Promise.resolve(),
  async getSession(phone) {
    return sessions.get(phone) || null;
  },
  async setSession(phone, step, data) {
    sessions.set(phone, { step, data: JSON.parse(JSON.stringify(data)) });
  },
  async clearSession(phone) {
    sessions.delete(phone);
  },
  async getCustomerName() {
    return null;
  },
  async upsertCustomerName() {},
  async createReservation(record) {
    const id = reservations.length + 1;
    reservations.push({
      ...record,
      id,
      party_size: record.partySize,
      customer_notice: null,
      reject_reason: null,
      decided_at: null,
    });
    return id;
  },
  async listPendingReservations() {
    return reservations.filter((row) => row.status === 'pending');
  },
  async getReservation(id) {
    return reservations.find((row) => row.id === Number(id)) || null;
  },
  async updateReservationDecision(id, { status, reason, customerNotice }) {
    const row = reservations.find((item) => item.id === Number(id) && item.status === 'pending');
    if (!row) return false;
    row.status = status;
    row.reject_reason = reason || null;
    row.customer_notice = customerNotice || null;
    row.decided_at = new Date().toISOString();
    return true;
  },
  async setCustomerNotice(id, notice) {
    const row = reservations.find((item) => item.id === Number(id));
    if (row) row.customer_notice = notice;
  },
  async listDeferredNotices(phone) {
    return reservations.filter((row) => {
      if (row.phone !== phone) return false;
      if (row.status !== 'confirmed' && row.status !== 'rejected') return false;
      if (row.customer_notice === 'deferred') return true;
      return row.customer_notice == null && row.decided_at;
    });
  },
  async touchLastInbound(phone, at) {
    inboundAt.set(phone, at || new Date().toISOString());
  },
  async getLastInbound(phone) {
    return inboundAt.has(phone) ? inboundAt.get(phone) : null;
  },
  async countReservations() {
    return 0;
  },
  async getUpcomingReservations() {
    return [];
  },
  async getReservationsByDateRange() {
    return [];
  },
  async getPendingEventRequests() {
    return [];
  },
  async getReservationById() {
    return null;
  },
  async cancelReservation() {
    return false;
  },
  async markAdminAlertFailed(id) {
    const row = reservations[id - 1];
    if (!row) return;
    row.admin_alert = 'failed';
    const note = 'Aviso admin: no enviado';
    if (!row.details) row.details = note;
    else if (!row.details.includes(note)) row.details = `${row.details} | ${note}`;
  },
  async markMarketingOptOut(phone, reason) {
    optouts.set(phone, reason || 'baja');
  },
  async isMarketingOptOut(phone) {
    return optouts.has(phone);
  },
};

const mockWa = {
  async sendText(to, body) {
    if (failAdminText && to === '34699999999') {
      throw metaSendError('Re-engagement message', 131047);
    }
    if (failWindowFor && to === failWindowFor) {
      throw metaSendError('Re-engagement message', 131047);
    }
    sent.push({ to, kind: 'text', body });
  },
  async sendButtons(to, body, buttons) {
    sent.push({ to, kind: 'buttons', body, buttons });
  },
  async sendList(to, body, buttonText, rows) {
    sent.push({ to, kind: 'list', body, buttonText, rows });
  },
  async sendTemplate(to, options) {
    if (failAdminTemplate) throw metaSendError('template not found', 132001);
    sent.push({ to, kind: 'template', body: options.bodyParameters.join(' '), options });
  },
  async sendImage(to, image) {
    if (failImages) throw metaSendError('Media download error', 131053);
    sent.push({
      to,
      kind: 'image',
      body: image.caption || '',
      link: image.link || '',
      id: image.id || '',
    });
  },
};

const mockHotel = {
  async confirmReservation(id) {
    hotelCalls.push({ action: 'confirm', id: String(id) });
    return { ok: true };
  },
  async deleteReservation(id) {
    hotelCalls.push({ action: 'delete', id: String(id) });
    return { ok: true };
  },
};

const Module = require('module');
const originalRequire = Module.prototype.require;
Module.prototype.require = function (id) {
  if (id === './db' || id === '../db') return mockDb;
  if (id === './wa' || id === '../wa') return mockWa;
  if (id === './hotelApi' || id === '../hotelApi') return mockHotel;
  return originalRequire.apply(this, arguments);
};

const { handleIncoming } = require('../src/conversation');
const menus = require('../src/menusEmpresa');
const grupos = require('../src/grupos');
const fiesta = require('../src/menusFiesta');
const { normalize } = require('../src/dateParser');
const conocimiento = require('../src/eventosConocimiento');
const faq = require('../src/faqLlegada');
const { renderAdminPage } = require('../src/server-meta');

const FORBIDDEN = /d[ií]scolo|moscato|\baula\b|proyector|microfon[ií]a|sal[oó]n real|sal[oó]n goya|incluido el iva|35\s*€/i;

function joined(messages) {
  return messages.map((m) => m.body).join('\n');
}

function assertWhatsApp(messages) {
  for (const m of messages) {
    assert.ok(m.body.length <= 4096, `mensaje demasiado largo (${m.body.length})`);
    if (m.kind === 'buttons') {
      assert.ok(m.body.length <= 1024, `cuerpo de botones demasiado largo (${m.body.length})`);
      assert.ok(m.buttons.length >= 1 && m.buttons.length <= 3);
      for (const b of m.buttons) {
        assert.ok([...b.title].length <= 20, `título de botón demasiado largo: ${b.title}`);
      }
    }
  }
}

async function say(phone, text, buttonId = null, rawMessage = null) {
  const before = sent.length;
  await handleIncoming(phone, text, buttonId, rawMessage);
  const messages = sent.slice(before).filter((m) => m.to === phone);
  assertWhatsApp(messages);
  return messages;
}

beforeEach(() => {
  sent.length = 0;
  reservations.length = 0;
  sessions.clear();
  optouts.clear();
  failAdminText = false;
  failAdminTemplate = false;
  failImages = false;
  failWindowFor = null;
  hotelCalls.length = 0;
  inboundAt.clear();
  Settings.now = () => new Date('2026-10-22T10:00:00+02:00').getTime();
});

const OLD_OFFER = /menú mediodía|menú navidad|menú gran gala|65\s*€|110\s*€|precio a consultar|stracciatella|pistacho|wellington|capuccino|mazapán|cochinillo|lubina/i;

describe('comidas de Navidad para empresas', () => {
  it('ofrece un menú a medida desde 55 € + IVA y no carta tipificada', () => {
    const text = menus.overviewText('Hostería Don Fadrique');
    assert.match(text, /Comidas de Navidad para empresas/);
    assert.match(text, /menú a medida/);
    assert.match(text, /desde 55 € \+ IVA por persona/);
    assert.deepEqual(text.match(/\d+\s*€/g), ['55 €']);
    assert.match(text, /desde 10 personas/);
    assert.match(text, /10 a 50/);
    assert.match(text, /500 a 700/);
    assert.match(text, /se detallan en el presupuesto/);
    assert.doesNotMatch(text, OLD_OFFER);
    assert.doesNotMatch(text, FORBIDDEN);
  });

  it('deja por escrito los datos de sala y audiovisual que no existen', () => {
    const ids = conocimiento.PLACEHOLDERS.map((p) => p.id);
    assert.deepEqual(ids, ['nombre_salones', 'aforo_por_salon', 'equipamiento_av']);
    const listed = conocimiento.placeholdersText();
    assert.match(listed, /\[PENDIENTE\]/);
    assert.match(listed, /Nombre de cada salón/);
    assert.match(listed, /Capacidad de cada salón/);
    assert.match(listed, /Equipamiento audiovisual/);
    const intro = conocimiento.congresoIntro('Hostería Don Fadrique');
    assert.match(intro, /500 a 700/);
    assert.match(intro, /10 a 50/);
    assert.match(intro, /21 habitaciones dobles/);
    assert.match(intro, /nombre ni el aforo de cada uno/);
    assert.match(intro, /audiovisual/);
    assert.doesNotMatch(intro, FORBIDDEN);
    const vinos = conocimiento.answerSideQuestion('que vinos incluye el gran gala');
    assert.match(vinos, /se detallan en el presupuesto/);
    assert.match(vinos, /desde 55 € \+ IVA/);
    assert.doesNotMatch(vinos, OLD_OFFER);
    assert.doesNotMatch(vinos, FORBIDDEN);
    const platos = conocimiento.answerSideQuestion('que platos lleva el menu navidad');
    assert.match(platos, /menú a medida/);
    assert.match(platos, /presupuesto/);
    assert.doesNotMatch(platos, OLD_OFFER);
  });
});

describe('conversación', () => {
  it('el menú inicial ofrece restaurante, hotel y eventos, y no OTIVM', async () => {
    const messages = await say('34600000001', 'hola');
    const body = joined(messages);
    assert.match(body, /Hostería Don Fadrique/);
    assert.doesNotMatch(body, /OTIVM|otivm|piscina|brunch/i);
    const buttons = messages[0].buttons.map((b) => b.id);
    assert.deepEqual(buttons, ['exp_rest', 'exp_hotel', 'exp_eventos']);
  });

  it('info mantiene restaurante y hotel y no vende OTIVM', async () => {
    const body = joined(await say('34600000001', 'info'));
    assert.match(body, /13:30-15:30/);
    assert.match(body, /20:30-22:30/);
    assert.match(body, /martes y miércoles/);
    assert.match(body, /comidas de Navidad para empresas/);
    assert.match(body, /desde 55 € \+ IVA/);
    assert.match(body, /congreso/i);
    assert.doesNotMatch(body, /OTIVM|35/);
  });

  it('quien pide OTIVM, piscina o brunch no entra en una reserva', async () => {
    const messages = await say('34600000001', 'quiero reservar brunch en la piscina');
    const body = joined(messages);
    assert.match(body, /cerrado/);
    assert.match(body, /cocina/);
    assert.equal(reservations.length, 0);
    assert.deepEqual(messages[0].buttons.map((b) => b.id), ['exp_rest', 'exp_hotel', 'exp_eventos']);
    assert.doesNotMatch(body, /35|¿Qué día/);
  });

  it('la reserva de mesa queda pendiente hasta que administración la confirme', async () => {
    let body = joined(await say('34600000002', 'quiero una mesa'));
    assert.match(body, /Restaurante Don Fadrique/);
    assert.match(body, /qué día/i);

    body = joined(await say('34600000002', 'martes'));
    assert.match(body, /no abrimos/);
    assert.match(body, /martes y miércoles/);
    assert.equal(reservations.length, 0);

    await say('34600000002', 'menu');
    await say('34600000002', 'quiero una mesa');
    body = joined(await say('34600000002', '15/11'));
    assert.match(body, /qué hora/i);
    await say('34600000002', '14:00');
    await say('34600000002', '4');
    await say('34600000002', 'Ana Ruiz');
    body = joined(await say('34600000002', 'sí', 'confirm_yes'));
    assert.match(body, /solicitud nº 1/i);
    assert.match(body, /pendiente de confirmación/);
    assert.doesNotMatch(body, /Mesa confirmada|queda \*confirmada\*/);
    assert.equal(reservations.length, 1);
    assert.equal(reservations[0].type, 'restaurante');
    assert.equal(reservations[0].status, 'pending');
    assert.equal(reservations[0].partySize, 4);
    assert.equal(reservations[0].time, '14:00');
    const admin = sent.filter((message) => message.to === '34699999999');
    assert.equal(admin.length, 1);
    assert.match(admin[0].body, /OK 1/);
    assert.match(admin[0].body, /NO 1/);
    assert.match(admin[0].body, /14:00/);
    assert.match(admin[0].body, /Ana Ruiz/);
  });

  it('el hotel sigue pidiendo la fecha de entrada', async () => {
    const body = joined(await say('34600000003', 'quiero una habitación'));
    assert.match(body, /entrar/);
    assert.match(body, /check-in/i);
    assert.equal(reservations.length, 0);
  });

  it('comidas de Navidad ofrecen menú a medida y no la carta antigua', async () => {
    let body = joined(await say('34600000004', 'menús de Navidad'));
    assert.match(body, /Comidas de Navidad para empresas/);
    assert.match(body, /menú a medida/);
    assert.match(body, /desde 55 € \+ IVA por persona/);
    assert.doesNotMatch(body, OLD_OFFER);

    body = joined(await say('34600000004', 'qué incluye el menú gran gala'));
    assert.match(body, /menú a medida/);
    assert.match(body, /desde 55 € \+ IVA/);
    assert.match(body, /presupuesto/);
    assert.doesNotMatch(body, OLD_OFFER);
    assert.doesNotMatch(body, /confirmad/i);
  });

  it('guarda la comida de empresa como pendiente, también en martes y a final de mes', async () => {
    const phone = '34600000005';
    await say(phone, 'comida o cena de empresa');
    await say(phone, 'detalle del menú navidad');
    let body = joined(await say(phone, 'solicitar'));
    assert.match(body, /empresa/i);

    await say(phone, 'Talleres Alba SL');
    await say(phone, 'Lucía Fernández');
    body = joined(await say(phone, '01/12/2026'));
    assert.match(body, /Comida|Cena|comida/);
    assert.doesNotMatch(body, /no abrimos|60 días/);

    await say(phone, 'cena', 'emp_cena');
    await say(phone, '30');
    body = joined(await say(phone, 'lucia@talleresalba.es'));
    assert.match(body, /Talleres Alba SL/);
    assert.match(body, /menú a medida/);
    assert.match(body, /desde 55 € \+ IVA/);
    assert.match(body, /no queda reservada|pendiente/i);
    assert.doesNotMatch(body, /confirmad/i);
    assert.doesNotMatch(body, OLD_OFFER);

    body = joined(await say(phone, 'enviar', 'emp_send'));
    assert.match(body, /pendiente de presupuesto/);
    assert.match(body, /solicitud nº 1/i);
    assert.doesNotMatch(body, /confirmad/i);
    assert.equal(reservations.length, 1);
    const saved = reservations[0];
    assert.equal(saved.type, 'evento_empresa');
    assert.equal(saved.status, 'pending');
    assert.equal(saved.date, '2026-12-01');
    assert.equal(saved.time, 'cena');
    assert.equal(saved.partySize, 30);
    assert.equal(saved.name, 'Lucía Fernández');
    assert.equal(saved.phone, phone);
    assert.match(saved.details, /Talleres Alba SL/);
    assert.match(saved.details, /Comidas de Navidad para empresas/);
    assert.match(saved.details, /menú a medida/);
    assert.match(saved.details, /desde 55 € \+ IVA por persona/);
    assert.match(saved.details, /lucia@talleresalba\.es/);
    assert.doesNotMatch(saved.details, OLD_OFFER);
    assert.doesNotMatch(saved.details, FORBIDDEN);

    const admin = sent.filter((m) => m.to === '34699999999').map((m) => m.body).join('\n');
    assert.match(admin, /pendiente de presupuesto/);
    assert.match(admin, /Talleres Alba SL/);
    assert.doesNotMatch(admin, /CONFIRMADA|confirmada/);
  });

  it('rechaza un grupo pequeño, un día fuera de diciembre y avisa del 31 de diciembre', async () => {
    const phone = '34600000006';
    await say(phone, 'menús de navidad');
    await say(phone, 'solicitar');
    await say(phone, 'Bodegas del Tormes');
    await say(phone, 'Pedro');
    let body = joined(await say(phone, '15/11/2026'));
    assert.match(body, /diciembre de 2026/);
    assert.equal(reservations.length, 0);

    body = joined(await say(phone, '31/12/2026'));
    assert.doesNotMatch(body, /60 días|no abrimos/);
    assert.match(body, /Comida|Cena|comida/);
    await say(phone, 'comida', 'emp_comida');
    body = joined(await say(phone, '8'));
    assert.match(body, /10/);
    assert.equal(reservations.length, 0);
    body = joined(await say(phone, '40'));
    assert.match(body, /email|teléfono|WhatsApp/i);
    await say(phone, 'este');
    body = joined(await say(phone, 'enviar', 'emp_send'));
    assert.match(body, /pendiente de presupuesto/);
    assert.match(body, /desde 55 € \+ IVA/);
    assert.doesNotMatch(body, OLD_OFFER);
    assert.equal(reservations.at(-1).date, '2026-12-31');
    assert.equal(reservations.at(-1).time, 'comida');
    assert.match(reservations.at(-1).details, /menú a medida/);
    assert.equal(reservations.at(-1).status, 'pending');
    assert.equal(reservations.at(-1).type, 'evento_empresa');
  });

  it('anota un congreso como pendiente sin inventar salas ni equipos', async () => {
    const phone = '34600000007';
    let body = joined(await say(phone, 'queremos organizar un congreso'));
    assert.match(body, /500 a 700/);
    assert.match(body, /10 a 50/);
    assert.match(body, /21 habitaciones dobles/);
    assert.match(body, /no tengo el nombre ni el aforo/);
    assert.doesNotMatch(body, FORBIDDEN);

    await say(phone, 'Clínica del Tormes');
    await say(phone, 'Andrés Ruiz');
    await say(phone, 'congreso médico');
    body = joined(await say(phone, '10/03/2027 al 12/03/2027'));
    assert.match(body, /180|asist/i);
    await say(phone, '180');
    await say(phone, 'comidas, habitaciones para los asistentes y audiovisual');
    body = joined(await say(phone, 'andres@clinica.es'));
    assert.match(body, /Clínica del Tormes/);
    assert.match(body, /congreso médico/);
    assert.match(body, /180/);
    assert.doesNotMatch(body, /confirmad/i);
    assert.doesNotMatch(body, FORBIDDEN);

    body = joined(await say(phone, 'enviar', 'emp_send'));
    assert.match(body, /pendiente de presupuesto/);
    assert.doesNotMatch(body, /confirmad/i);
    const saved = reservations.at(-1);
    assert.equal(saved.type, 'evento_congreso');
    assert.equal(saved.status, 'pending');
    assert.equal(saved.date, '2027-03-10');
    assert.equal(saved.time, 'evento');
    assert.equal(saved.partySize, 180);
    assert.equal(saved.name, 'Andrés Ruiz');
    assert.match(saved.details, /Clínica del Tormes/);
    assert.match(saved.details, /congreso médico/);
    assert.match(saved.details, /andres@clinica\.es/);
    assert.match(saved.details, /audiovisual/i);
    assert.match(saved.details, /nombre y aforo de cada salón/);
    assert.match(saved.details, /equipamiento audiovisual/);
    assert.doesNotMatch(saved.details, FORBIDDEN);
  });

  it('el botón de eventos deja elegir boda, menú o congreso', async () => {
    const messages = await say('34600000008', 'eventos', 'exp_eventos');
    assert.deepEqual(messages[0].buttons.map((b) => b.id), ['boda_start', 'emp_menus', 'cong_start']);
    const body = joined(await say('34600000008', 'menús', 'emp_menus'));
    assert.match(body, /Comidas de Navidad para empresas/);
    assert.match(body, /desde 55 € \+ IVA/);
    assert.doesNotMatch(body, OLD_OFFER);
  });
});

describe('bodas, empresa y avisos', () => {
  function assertBodaIntro(body) {
    assert.match(body, /exclusiv/);
    assert.match(body, /[Jj]ardines/);
    assert.match(body, /terraza acristalada/);
    assert.match(body, /ceremonia puede celebrarse en el jardín/);
    assert.match(body, /Guía Michelin/);
    assert.match(body, /1 Sol Repsol/);
    assert.match(body, /21 habitaciones dobles/);
    assert.match(body, /a medida/);
    assert.match(body, /500 a 700/);
    assert.match(body, /caso por caso/);
    assert.match(body, /no queda reservada/);
    assert.doesNotMatch(body, /\d+\s*€/);
    assert.doesNotMatch(body, /siempre|nunca/i);
    assert.doesNotMatch(body, /quieres la mesa|Restaurante Don Fadrique/);
  }

  async function completarBoda(phone) {
    await say(phone, 'quiero una boda');
    await say(phone, 'Ana y Luis');
    await say(phone, '12/06/2027');
    await say(phone, 'unas 120');
    await say(phone, 'sí', 'boda_si');
    const review = joined(await say(phone, 'habitaciones y autobús para los invitados'));
    assert.match(review, /email|teléfono|WhatsApp/i);
    const shown = joined(await say(phone, 'ana@example.com'));
    assert.match(shown, /Ana y Luis/);
    assert.match(shown, /120/);
    assert.match(shown, /Ceremonia en la finca: sí/);
    assert.match(shown, /no queda reservada/);
    assert.match(shown, /Traslado/);
    assert.doesNotMatch(shown, /\d+\s*€/);
    return say(phone, 'enviar', 'emp_send');
  }

  it('quiero una boda y quiero reservar una boda abren el presupuesto, no el restaurante', async () => {
    for (const [phone, phrase] of [
      ['34600000031', 'quiero una boda'],
      ['34600000032', 'quiero reservar una boda'],
      ['34600000033', 'información para bodas'],
      ['34600000034', 'banquete de boda'],
      ['34600000035', 'nos queremos casar'],
    ]) {
      const messages = await say(phone, phrase);
      assert.equal(sessions.get(phone).step, 'GRUPO');
      assert.equal(sessions.get(phone).data.flow, 'boda');
      assert.equal(sessions.get(phone).data.stage, 'couple');
      assertBodaIntro(joined(messages));
      assert.equal(reservations.length, 0);
    }
  });

  it('el botón Boda del menú de eventos abre el mismo flujo', async () => {
    await say('34600000036', 'eventos', 'exp_eventos');
    const messages = await say('34600000036', 'Boda', 'boda_start');
    assert.equal(sessions.get('34600000036').data.flow, 'boda');
    assertBodaIntro(joined(messages));
  });

  it('guarda la boda como solicitud pendiente y avisa con el texto de sesión', async () => {
    const phone = '34600000037';
    const messages = await completarBoda(phone);
    assert.match(joined(messages), /pendiente de presupuesto/);
    assert.match(joined(messages), /solicitud nº 1/i);
    assert.doesNotMatch(joined(messages), /confirmad/i);
    assert.equal(reservations.length, 1);
    const saved = reservations[0];
    assert.equal(saved.type, 'evento_boda');
    assert.equal(saved.status, 'pending');
    assert.equal(saved.date, '2027-06-12');
    assert.equal(saved.time, 'boda');
    assert.equal(saved.partySize, 120);
    assert.equal(saved.name, 'Ana y Luis');
    assert.match(saved.details, /Ceremonia en la finca: sí/);
    assert.match(saved.details, /ana@example\.com/);
    assert.match(saved.details, /Traslado: interesado/);
    assert.equal(saved.admin_alert, undefined);
    const admin = sent.filter((m) => m.to === '34699999999');
    assert.equal(admin.length, 1);
    assert.equal(admin[0].kind, 'text');
    assert.match(admin[0].body, /SOLICITUD BODA/);
    assert.match(admin[0].body, /#1/);
    assert.match(admin[0].body, /Ana y Luis/);
  });

  it('mesa para 4 mañana sigue siendo el restaurante', async () => {
    const messages = await say('34600000038', 'mesa para 4 mañana');
    const body = joined(messages);
    assert.match(body, /Restaurante Don Fadrique/);
    assert.match(body, /qué día/i);
    assert.equal(sessions.get('34600000038').step, 'DATE');
    assert.notEqual(sessions.get('34600000038').data.flow, 'boda');
    assert.equal(reservations.length, 0);
  });

  it('comida de navidad para empresa sigue en el menú de Navidad', async () => {
    const messages = await say('34600000039', 'comida de navidad para empresa');
    const body = joined(messages);
    assert.match(body, /Comidas de Navidad para empresas/);
    assert.match(body, /desde 55 € \+ IVA/);
    assert.match(body, /diciembre/);
    assert.equal(sessions.get('34600000039').data.flow, 'empresa');
    assert.doesNotMatch(body, /empresa o entidad lo preparo/);
  });

  it('evento de empresa va al presupuesto de evento, no a la comida de Navidad', async () => {
    const messages = await say('34600000041', 'evento de empresa');
    const body = joined(messages);
    assert.match(body, /500 a 700/);
    assert.match(body, /empresa o entidad/);
    assert.equal(sessions.get('34600000041').data.flow, 'congreso');
    assert.doesNotMatch(body, /Comidas de Navidad|desde 55 €|diciembre de 2026/);
  });

  it('congreso de 300 personas sigue en el flujo de congreso', async () => {
    const messages = await say('34600000042', 'congreso de 300 personas');
    const body = joined(messages);
    assert.match(body, /500 a 700/);
    assert.match(body, /empresa o entidad/);
    assert.equal(sessions.get('34600000042').data.flow, 'congreso');
    assert.doesNotMatch(body, /Comidas de Navidad|desde 55 €/);
    assert.equal(reservations.length, 0);
  });

  it('si el texto a administración falla, avisa con la plantilla y no pierde la solicitud', async () => {
    failAdminText = true;
    const phone = '34600000043';
    const messages = await completarBoda(phone);
    assert.match(joined(messages), /pendiente de presupuesto/);
    assert.equal(reservations[0].type, 'evento_boda');
    assert.equal(reservations[0].admin_alert, undefined);
    const templates = sent.filter((m) => m.kind === 'template' && m.to === '34699999999');
    assert.equal(templates.length, 1);
    assert.equal(templates[0].options.name, 'aviso_solicitud_presupuesto');
    assert.equal(templates[0].options.language, 'es');
    assert.equal(templates[0].options.bodyParameters.length, 1);
    const line = templates[0].options.bodyParameters[0];
    assert.doesNotMatch(line, /\n|\t| {5,}/);
    assert.match(line, /^Boda · Ana y Luis · /);
    assert.match(line, /120 invitados/);
    assert.match(line, /ana@example\.com/);
    assert.match(line, /#1$/);
    assert.equal(sent.filter((m) => m.to === '34699999999' && m.kind === 'text').length, 0);
  });

  it('si texto y plantilla fallan, la solicitud queda marcada en el panel', async () => {
    failAdminText = true;
    failAdminTemplate = true;
    const messages = await completarBoda('34600000044');
    assert.match(joined(messages), /solicitud nº 1/i);
    assert.equal(reservations[0].status, 'pending');
    assert.equal(reservations[0].type, 'evento_boda');
    assert.equal(reservations[0].admin_alert, 'failed');
    assert.match(reservations[0].details, /Aviso admin: no enviado/);
    assert.equal(sent.filter((m) => m.to === '34699999999').length, 0);
  });
});

describe('panel de administración', () => {
  it('muestra las solicitudes pendientes aunque la fecha caiga fuera de 30 días', () => {
    const html = renderAdminPage({
      businessName: 'Hostería Don Fadrique',
      confirmed: [
        {
          id: 3,
          date: '2026-11-02',
          time: '14:00',
          type: 'restaurante',
          name: 'Ana',
          party_size: 2,
          details: '',
          phone: '34600000000',
        },
      ],
      pending: [
        {
          id: 9,
          date: '2026-12-18',
          time: 'cena',
          type: 'evento_empresa',
          name: 'Lucía',
          party_size: 30,
          details: 'Empresa: Talleres <Alba>',
          phone: '34600000005',
        },
        {
          id: 10,
          date: '2027-03-10',
          time: 'evento',
          type: 'evento_congreso',
          name: 'Andrés',
          party_size: 180,
          details: 'Tipo: congreso médico',
          phone: '34600000007',
        },
        {
          id: 11,
          date: '2027-06-12',
          time: 'boda',
          type: 'evento_boda',
          name: 'Ana y Luis',
          party_size: 120,
          details: 'Ceremonia en la finca: sí',
          phone: '34600000031',
          admin_alert: 'failed',
        },
      ],
    });
    assert.match(html, /1 reserva confirmada/);
    assert.match(html, /Ana/);
    assert.match(html, /Solicitudes de boda, empresa y congresos/);
    assert.match(html, /3 solicitudes sin confirmar/);
    assert.match(html, /Boda/);
    assert.match(html, /Ana y Luis/);
    assert.match(html, /aviso no enviado/);
    assert.match(html, /alert-failed/);
    assert.match(html, /1 solicitud no llegó a administración por WhatsApp/);
    assert.match(html, /Talleres &lt;Alba&gt;/);
    assert.match(html, /Pendiente de presupuesto/);
    assert.match(html, /Congreso/);
    assert.match(html, /2026-12-18/);
    assert.match(html, /2027-03-10/);
    assert.match(html, /wa\.me\/34600000005/);
    const src = fs.readFileSync(path.join(__dirname, '../src/server-meta.js'), 'utf8');
    assert.match(src, /getPendingEventRequests\(\)/);
  });
});

describe('cómo llegar y traslado', () => {
  const business = {
    name: 'Hostería Don Fadrique',
    phone: '923 37 00 76',
    web: 'https://www.donfadrique.com/',
  };

  it('da la dirección y un enlace al GPS, sin inventar aparcamiento ni líneas', () => {
    const body = faq.reply({ location: true, parking: true, business, inFlow: false });
    assert.match(body, /Ctra\. de Salamanca – Alba de Tormes km 17, 37800 Alba de Tormes \(Salamanca\)/);
    assert.match(body, /923 37 00 76/);
    assert.match(body, /https:\/\/www\.donfadrique\.com\//);
    assert.match(body, /google\.com\/maps\/search/);
    assert.match(body, /no lo tengo detallado/);
    assert.doesNotMatch(body, /gratuito|plazas de|línea \d|minutos|autocar siempre|siempre hay/i);
  });

  it('el traslado se estudia según grupo y fecha, sin prometerlo ni negarlo', () => {
    const body = faq.transportReply({ inFlow: false });
    assert.match(body, /se estudia según el tamaño del grupo y la fecha/);
    assert.match(body, /presupuest/);
    assert.doesNotMatch(body, /siempre (tenemos|hay|ponemos|disponemos|inclu)/i);
    assert.doesNotMatch(body, /nunca|no hacemos traslado|no hay autobús|no tenemos bus/i);
  });

  it('responde a cómo llegar, dónde estáis y al autobús', async () => {
    let body = joined(await say('34600000021', 'dónde estáis'));
    assert.match(body, /Alba de Tormes km 17/);
    assert.match(body, /Google Maps/);

    body = joined(await say('34600000022', 'cómo se va'));
    assert.match(body, /GPS/);
    assert.doesNotMatch(body, /65 €|110 €/);

    body = joined(await say('34600000023', 'hay bus para el grupo'));
    assert.match(body, /se estudia según el tamaño del grupo y la fecha/);
    assert.doesNotMatch(body, /siempre tenemos|nunca/);

    body = joined(await say('34600000024', 'ponéis autocar'));
    assert.match(body, /presupuest/);

    body = joined(await say('34600000025', 'transporte desde Salamanca'));
    assert.match(body, /se estudia según el tamaño del grupo y la fecha/);

    body = joined(await say('34600000026', 'shuttle'));
    assert.match(body, /traslado o el autobús/i);
  });

  it('si lo piden en una comida de empresa, sigue el lead y anota el traslado', async () => {
    const phone = '34600000027';
    await say(phone, 'comida de empresa');
    await say(phone, 'solicitar');
    let body = joined(await say(phone, '¿ponéis autocar?'));
    assert.match(body, /se estudia según el tamaño del grupo y la fecha/);
    assert.match(body, /qué empresa/i);
    assert.equal(reservations.length, 0);

    await say(phone, 'Talleres Alba SL');
    await say(phone, 'Lucía Fernández');
    await say(phone, '01/12/2026');
    await say(phone, 'cena', 'emp_cena');
    await say(phone, '30');
    body = joined(await say(phone, 'lucia@talleresalba.es'));
    assert.match(body, /Traslado/);
    assert.match(body, /desde 55 € \+ IVA/);
    await say(phone, 'enviar', 'emp_send');
    assert.equal(reservations.at(-1).type, 'evento_empresa');
    assert.equal(reservations.at(-1).status, 'pending');
    assert.match(reservations.at(-1).details, /Traslado: interesado/);
    assert.match(reservations.at(-1).details, /menú a medida/);
  });
});

describe('fotos de la hostería', () => {
  function imagesOf(messages) {
    return messages.filter((m) => m.kind === 'image');
  }

  it('el menú menciona ver fotos y mantiene los tres botones', async () => {
    const messages = await say('34600000080', 'hola');
    assert.match(joined(messages), /ver fotos/);
    assert.equal(imagesOf(messages).length, 0);
    assert.deepEqual(messages[0].buttons.map((b) => b.id), ['exp_rest', 'exp_hotel', 'exp_eventos']);
  });

  it('quien pide fotos recibe el álbum y después el menú', async () => {
    const messages = await say('34600000081', 'ver fotos');
    const images = imagesOf(messages);
    assert.ok(images.length >= 2 && images.length <= 4);
    for (const image of images) {
      assert.match(image.body, /[A-Za-zÁÉÍÓÚáéíóúñÑ]/);
      assert.match(image.link, /\/fotos\/.+\.jpg$/);
      assert.ok(image.body.length <= 1024);
    }
    assert.equal(messages.at(-1).kind, 'buttons');
    assert.deepEqual(messages.at(-1).buttons.map((b) => b.id), ['exp_rest', 'exp_hotel', 'exp_eventos']);
    assert.equal(sessions.has('34600000081'), false);
  });

  it('fotos de bodas abre el presupuesto después de las fotos, sin repetir el álbum', async () => {
    const messages = await say('34600000082', 'fotos de bodas');
    const images = imagesOf(messages);
    assert.ok(images.length >= 2 && images.length <= 4);
    assert.match(images.map((m) => m.body).join('\n'), /jardín/i);
    assert.match(joined(messages), /Bodas en/);
    assert.match(joined(messages), /novios/);
    assert.equal(sessions.get('34600000082').data.flow, 'boda');
    assert.equal(sessions.get('34600000082').data.stage, 'couple');
    assert.equal(reservations.length, 0);
  });

  it('la presentación de boda manda una o dos fotos después del texto', async () => {
    const messages = await say('34600000083', 'quiero una boda');
    assert.equal(messages[0].kind, 'text');
    assert.match(messages[0].body, /Bodas en/);
    const images = imagesOf(messages);
    assert.ok(images.length >= 1 && images.length <= 2);
    assert.ok(messages.slice(1, 1 + images.length).every((m) => m.kind === 'image'));
    assert.match(messages.at(-1).body, /novios/);
    assert.equal(sessions.get('34600000083').data.flow, 'boda');
  });

  it('la presentación de congreso manda una o dos fotos y no la carta de Navidad', async () => {
    const messages = await say('34600000084', 'queremos un congreso');
    const images = imagesOf(messages);
    assert.equal(messages[0].kind, 'text');
    assert.match(messages[0].body, /500 a 700/);
    assert.ok(images.length >= 1 && images.length <= 2);
    assert.match(joined(messages), /empresa o entidad/);
    assert.doesNotMatch(joined(messages), /Comidas de Navidad|desde 55 €/);
    assert.equal(sessions.get('34600000084').data.flow, 'congreso');
  });

  it('restaurante, Navidad y mesa no se convierten en un álbum', async () => {
    let messages = await say('34600000085', 'restaurante');
    assert.equal(imagesOf(messages).length, 0);
    assert.match(joined(messages), /Restaurante Don Fadrique/);
    assert.match(joined(messages), /qué día/i);
    assert.equal(sessions.get('34600000085').step, 'DATE');

    messages = await say('34600000086', 'menús de Navidad');
    assert.equal(imagesOf(messages).length, 0);
    assert.match(joined(messages), /Comidas de Navidad para empresas/);
    assert.match(joined(messages), /desde 55 € \+ IVA/);
    assert.equal(sessions.get('34600000086').data.flow, 'empresa');

    messages = await say('34600000087', 'quiero una mesa');
    assert.equal(imagesOf(messages).length, 0);
    assert.match(joined(messages), /qué día/i);
  });

  it('en el jardín, durante la boda, sigue siendo la respuesta de la ceremonia', async () => {
    const phone = '34600000088';
    await say(phone, 'quiero una boda');
    await say(phone, 'Ana y Luis');
    await say(phone, '12/06/2027');
    await say(phone, '120');
    const messages = await say(phone, 'en el jardin');
    assert.equal(imagesOf(messages).length, 0);
    assert.equal(sessions.get(phone).data.stage, 'wneeds');
    assert.equal(sessions.get(phone).data.ceremony, 'sí');
  });

  it('pedir fotos a mitad de la boda no abandona la solicitud', async () => {
    const phone = '34600000089';
    await say(phone, 'quiero una boda');
    await say(phone, 'Ana y Luis');
    const messages = await say(phone, 'fotos del jardin');
    assert.ok(imagesOf(messages).length >= 2);
    assert.match(joined(messages), /seguimos/);
    assert.equal(sessions.get(phone).data.flow, 'boda');
    assert.equal(sessions.get(phone).data.stage, 'wdate');
  });

  it('si el envío de la imagen falla, el cliente sigue recibiendo el texto', async () => {
    failImages = true;
    const errors = [];
    const original = console.error;
    console.error = (...args) => errors.push(args.map(String).join(' '));
    try {
      const messages = await say('34600000090', 'enséñame');
      assert.equal(imagesOf(messages).length, 0);
      assert.equal(messages.at(-1).kind, 'buttons');
      assert.match(joined(messages), /Hostería Don Fadrique/);
      assert.ok(errors.some((line) => /\[fotos\]/.test(line)));
    } finally {
      console.error = original;
    }
  });

  it('una foto sin texto se agradece y, si hay solicitud, se anota', async () => {
    const idle = await say('34600000091', '', null, { type: 'image', image: { id: 'media-idle' } });
    assert.match(joined(idle), /Gracias por la foto/);
    assert.match(joined(idle), /texto/);
    assert.ok(idle.some((m) => m.kind === 'buttons'));

    const phone = '34600000092';
    await say(phone, 'quiero una mesa');
    const during = await say(phone, '', null, { type: 'image', image: { id: 'media-mesa' } });
    assert.match(joined(during), /Gracias por la foto/);
    assert.match(joined(during), /texto/);
    assert.equal(sessions.get(phone).step, 'DATE');
    assert.equal(during.some((m) => m.kind === 'buttons'), false);

    const wedding = '34600000093';
    await say(wedding, 'quiero una boda');
    const noted = await say(wedding, '', null, { type: 'image', image: { id: 'media-boda' } });
    assert.match(joined(noted), /solicitud/);
    assert.equal(sessions.get(wedding).data.stage, 'couple');
    assert.equal(sessions.get(wedding).data.fotosCliente, 1);
    await say(wedding, 'Ana y Luis');
    await say(wedding, '12/06/2027');
    await say(wedding, '80');
    await say(wedding, 'sí', 'boda_si');
    await say(wedding, 'nada');
    await say(wedding, 'ana@example.com');
    await say(wedding, 'enviar', 'emp_send');
    assert.match(reservations.at(-1).details, /El cliente envió 1 foto por WhatsApp/);
    const admin = sent.filter((m) => m.to === '34699999999').at(-1);
    assert.match(admin.body, /El cliente envió 1 foto por WhatsApp/);
  });
});

describe('plantilla de Navidad: respuestas', () => {
  it('BAJA confirma la baja y la guarda', async () => {
    const messages = await say('34655500001', 'BAJA');
    assert.match(joined(messages), /No te enviaremos más mensajes de este tipo/);
    assert.equal(optouts.get('34655500001'), 'baja');
    assert.equal(sessions.has('34655500001'), false);
  });

  it('el botón No me interesa (payload de la plantilla) es una baja', async () => {
    const messages = await say('34655500002', 'No me interesa', 'mkt_optout');
    assert.match(joined(messages), /No te enviaremos más mensajes de este tipo/);
    assert.equal(optouts.get('34655500002'), 'mkt_optout');
  });

  it('si Meta devuelve el texto del botón como payload, también es una baja', async () => {
    const messages = await say('34655500003', 'No me interesa', 'No me interesa');
    assert.equal(optouts.get('34655500003'), 'mkt_optout');
    assert.match(joined(messages), /menu/);
  });

  it('Pedir presupuesto con id emp_book abre la comida de Navidad de empresa', async () => {
    const messages = await say('34655500004', 'Pedir presupuesto', 'emp_book');
    assert.equal(sessions.get('34655500004').step, 'GRUPO');
    assert.equal(sessions.get('34655500004').data.flow, 'empresa');
    assert.match(joined(messages), /Comidas de Navidad para empresas/);
    assert.equal(optouts.has('34655500004'), false);
  });

  it('el texto del botón Pedir presupuesto, si viene como payload, usa emp_book', async () => {
    const messages = await say('34655500005', 'Pedir presupuesto', 'Pedir presupuesto');
    assert.equal(sessions.get('34655500005').step, 'GRUPO');
    assert.equal(sessions.get('34655500005').data.flow, 'empresa');
    assert.match(joined(messages), /menú a medida/);
  });

  it('escribir Pedir presupuesto también abre el flujo de empresa', async () => {
    const messages = await say('34655500006', 'Pedir presupuesto');
    assert.equal(sessions.get('34655500006').step, 'GRUPO');
    assert.match(joined(messages), /Comidas de Navidad para empresas/);
  });
});

describe('menús oficiales de Navidad, Nochevieja y Año Nuevo', () => {
  const PERSONAL = /650\s*488\s*113|661\s*724\s*158|650488113|661724158|34650488113|34661724158/;

  function imagesOf(messages) {
    return messages.filter((message) => message.kind === 'image');
  }

  it('la comida de empresa cita los menús oficiales como referencia y no cambia el precio', () => {
    const text = menus.overviewText('Hostería Don Fadrique');
    assert.match(text, /menús oficiales de Navidad, Nochevieja y Año Nuevo/);
    assert.match(text, /como referencia/);
    assert.match(text, /Escribe \*menús\* y te los envío/);
    assert.match(text, /menú a medida/);
    assert.match(text, /desde 55 € \+ IVA por persona/);
    assert.deepEqual(text.match(/\d+\s*€/g), ['55 €']);
    assert.doesNotMatch(text, OLD_OFFER);
    assert.doesNotMatch(text, PERSONAL);
  });

  it('el enlace «Quiero ver los menús de Navidad» manda las tres cartas y el cochinillo', async () => {
    const phone = '34600000101';
    const messages = await say(phone, 'Quiero ver los menús de Navidad');
    const body = joined(messages);
    assert.match(messages[0].body, /Menús de las fiestas/);
    assert.match(body, /jamón y lomo; gamba blanca Don Fadrique; paté de pato y fiambres navideños/);
    assert.match(body, /capuchino de lentejas con perdiz/);
    assert.match(body, /stracciatella artesana/);
    assert.match(body, /65 € por persona/);
    assert.match(body, /110 € por persona/);
    assert.match(body, /Todos nuestros menús se pueden adaptar a alergias e intolerancias/);
    assert.doesNotMatch(body, /\bIVA\b/);
    assert.doesNotMatch(body, /55 €/);
    assert.doesNotMatch(body, PERSONAL);
    assert.doesNotMatch(body, /@/);
    const images = imagesOf(messages);
    assert.deepEqual(
      images.map((image) => image.link),
      [
        'https://whatsapp-reservas-bot.onrender.com/menus/menu-navidad-25dic.jpg',
        'https://whatsapp-reservas-bot.onrender.com/menus/menu-nochevieja-31dic.jpg',
        'https://whatsapp-reservas-bot.onrender.com/menus/menu-anonuevo-1ene.jpg',
        'https://whatsapp-reservas-bot.onrender.com/fotos/cochinillo.jpg',
      ]
    );
    assert.match(images.at(-1).body, /Cochinillo/);
    const tail = messages.at(-1);
    assert.equal(tail.kind, 'buttons');
    assert.match(tail.body, /reservar/);
    assert.match(tail.body, /presupuesto/);
    assert.deepEqual(
      tail.buttons.map((button) => button.id),
      ['exp_rest', 'emp_book']
    );
    assert.equal(sessions.has(phone), false);
  });

  it('reservar abre el restaurante y pedir presupuesto abre la comida de empresa', async () => {
    const phone = '34600000102';
    await say(phone, 'ver los menús');
    let messages = await say(phone, 'Reservar', 'exp_rest');
    assert.match(joined(messages), /Restaurante Don Fadrique/);
    assert.match(joined(messages), /qué día/i);
    assert.equal(sessions.get(phone).step, 'DATE');

    messages = await say('34600000103', 'carta');
    messages = await say('34600000103', 'Pedir presupuesto', 'emp_book');
    assert.equal(sessions.get('34600000103').data.flow, 'empresa');
    assert.match(joined(messages), /Comidas de Navidad para empresas/);
    assert.match(joined(messages), /menús oficiales/);
    assert.match(joined(messages), /desde 55 € \+ IVA/);
  });

  it('«Quiero ver el menú de Navidad» manda solo ese menú', async () => {
    const messages = await say('34600000104', 'Quiero ver el menú de Navidad');
    assert.deepEqual(
      messages.map((message) => message.kind),
      ['text', 'image']
    );
    const body = joined(messages);
    assert.match(body, /Menú Navidad/);
    assert.match(body, /25 de diciembre de 2026/);
    assert.match(body, /65 € por persona/);
    assert.match(body, /mazapán carmelita/);
    assert.match(body, /\*Asado:\*/);
    assert.doesNotMatch(body, /110 € por persona|churros|stracciatella|Menú Nochevieja|Menú Año Nuevo/);
    assert.match(messages[1].link, /\/menus\/menu-navidad-25dic\.jpg$/);
    assert.match(messages[1].body, /65 € por persona/);
    assert.doesNotMatch(body, PERSONAL);
  });

  it('«Quiero ver el menú de Nochevieja» manda solo ese menú', async () => {
    const messages = await say('34600000105', 'Quiero ver el menú de Nochevieja');
    assert.deepEqual(
      messages.map((message) => message.kind),
      ['text', 'image']
    );
    const body = joined(messages);
    assert.match(body, /110 € por persona/);
    assert.match(body, /capuchino de lentejas con perdiz/);
    assert.match(body, /las 12 uvas de la suerte y churros/);
    assert.match(body, /\*A medianoche:\*/);
    assert.doesNotMatch(body, /65 € por persona|mazapán carmelita|stracciatella/);
    assert.doesNotMatch(body, /\bIVA\b/);
    assert.match(messages[1].link, /\/menus\/menu-nochevieja-31dic\.jpg$/);
  });

  it('Año Nuevo manda solo el menú del 1 de enero', async () => {
    const messages = await say('34600000106', 'Quiero ver el menú de Año Nuevo');
    const body = joined(messages);
    assert.match(body, /1 de enero de 2027/);
    assert.match(body, /65 € por persona/);
    assert.match(body, /lubina con ajada/);
    assert.match(body, /cochinillo asado tradicional/);
    assert.match(body, /\*Pescado del día:\*/);
    assert.doesNotMatch(body, /110 € por persona|mazapán carmelita/);
    assert.equal(imagesOf(messages).length, 1);
    assert.match(messages[1].link, /\/menus\/menu-anonuevo-1ene\.jpg$/);
    assert.equal(sessions.has('34600000106'), false);
  });

  it('menús, escrito desde la comida de empresa, enseña la carta y sigue el presupuesto', async () => {
    const phone = '34600000107';
    const offer = await say(phone, 'menús de Navidad');
    assert.equal(imagesOf(offer).length, 0);
    assert.match(joined(offer), /Comidas de Navidad para empresas/);
    assert.match(joined(offer), /Escribe \*menús\* y te los envío/);
    assert.doesNotMatch(joined(offer), OLD_OFFER);

    const shown = await say(phone, 'menús');
    assert.equal(imagesOf(shown).length, 4);
    assert.match(joined(shown), /mazapán carmelita/);
    assert.match(joined(shown), /seguimos/);
    assert.equal(sessions.get(phone).data.flow, 'empresa');
    assert.equal(sessions.get(phone).data.stage, 'browse');

    const next = await say(phone, 'solicitar');
    assert.match(joined(next), /empresa/i);
    assert.equal(sessions.get(phone).data.stage, 'company');
  });

  it('menu, la habitación, la boda, el congreso y cómo llegar siguen igual', async () => {
    let messages = await say('34600000108', 'menú');
    assert.deepEqual(
      messages[0].buttons.map((button) => button.id),
      ['exp_rest', 'exp_hotel', 'exp_eventos']
    );
    assert.equal(imagesOf(messages).length, 0);

    messages = await say('34600000109', 'quiero una habitación');
    assert.match(joined(messages), /entrar/);
    assert.equal(imagesOf(messages).length, 0);

    messages = await say('34600000110', 'quiero una boda');
    assert.match(joined(messages), /Bodas en/);
    assert.equal(imagesOf(messages).some((image) => /\/menus\//.test(image.link)), false);
    assert.doesNotMatch(joined(messages), /65 € por persona|110 € por persona/);

    messages = await say('34600000111', 'queremos un congreso');
    assert.match(joined(messages), /500 a 700/);
    assert.equal(imagesOf(messages).some((image) => /\/menus\//.test(image.link)), false);

    messages = await say('34600000112', 'cómo llegar');
    assert.match(joined(messages), /Cómo llegar/);
    assert.equal(imagesOf(messages).length, 0);
  });

  it('«menú nochevieja» no cae en la comida de empresa', async () => {
    for (const phrase of ['menú nochevieja', 'Menú Nochevieja', 'menú de Navidad']) {
      assert.equal(menus.isEmpresaTopic(normalize(phrase)), false, phrase);
      assert.equal(grupos.classifyIncoming(normalize(phrase)), null, phrase);
    }
    assert.equal(grupos.classifyIncoming(normalize('menús de Navidad')).kind, 'empresa_overview');

    const messages = await say('34600000120', 'menú nochevieja');
    const body = joined(messages);
    assert.match(body, /Menú Nochevieja/);
    assert.match(body, /110 € por persona/);
    assert.match(body, /capuchino de lentejas con perdiz/);
    assert.doesNotMatch(body, /Comidas de Navidad para empresas|menú a medida|desde 55/);
    assert.doesNotMatch(body, /cuántas personas/i);
    assert.equal(imagesOf(messages).length, 1);
    assert.match(imagesOf(messages)[0].link, /menu-nochevieja-31dic\.jpg$/);
    assert.equal(sessions.has('34600000120'), false);
  });

  it('«Quiero reservar el menú de Nochevieja (31 de diciembre)» pide personas, nombre y avisa', async () => {
    const phone = '34600000121';
    const phrase = 'Quiero reservar el menú de Nochevieja (31 de diciembre)';
    assert.equal(fiesta.matchReservation(normalize(phrase)), 'nochevieja');
    assert.equal(menus.isEmpresaTopic(normalize(phrase)), false);

    let messages = await say(phone, phrase);
    assert.equal(messages[0].kind, 'image');
    assert.match(messages[0].body, /Menú Nochevieja/);
    assert.match(messages[0].body, /31 de diciembre de 2026/);
    assert.match(messages[0].body, /110 € por persona/);
    assert.match(messages[0].link, /\/menus\/menu-nochevieja-31dic\.jpg$/);
    assert.equal(messages[1].kind, 'text');
    assert.match(messages[1].body, /capuchino de lentejas con perdiz/);
    assert.match(messages[1].body, /110 € por persona/);
    assert.doesNotMatch(joined(messages), /\bIVA\b|Comidas de Navidad para empresas/);
    assert.match(messages.at(-1).body, /cuántas personas/i);
    assert.equal(sessions.get(phone).step, 'PARTY');
    assert.equal(reservations.length, 0);

    messages = await say(phone, '4');
    assert.match(joined(messages), /nombre/i);
    assert.equal(sessions.get(phone).step, 'NAME');

    messages = await say(phone, 'Ana Ruiz');
    assert.equal(messages[0].kind, 'buttons');
    assert.match(messages[0].body, /Menú Nochevieja/);
    assert.match(messages[0].body, /110 € por persona/);
    assert.match(messages[0].body, /4 personas/);
    assert.match(messages[0].body, /Ana Ruiz/);
    assert.equal(reservations.length, 0);
    assert.equal(sent.filter((message) => message.to === '34699999999').length, 0);

    messages = await say(phone, 'sí', 'confirm_yes');
    assert.match(joined(messages), /pendiente de confirmación/);
    assert.match(joined(messages), /solicitud nº 1/i);
    assert.doesNotMatch(joined(messages), /queda \*confirmada\*/);
    assert.match(joined(messages), /Menú Nochevieja/);
    assert.match(joined(messages), /31 de diciembre de 2026/);
    assert.doesNotMatch(joined(messages), PERSONAL);
    assert.equal(reservations.length, 1);
    const saved = reservations[0];
    assert.equal(saved.type, 'restaurante');
    assert.equal(saved.status, 'pending');
    assert.equal(saved.date, '2026-12-31');
    assert.equal(saved.partySize, 4);
    assert.equal(saved.name, 'Ana Ruiz');
    assert.equal(saved.phone, phone);
    assert.match(saved.details, /Menú Nochevieja/);
    assert.match(saved.details, /110 € por persona/);
    assert.doesNotMatch(saved.details, /\bIVA\b/);
    assert.doesNotMatch(saved.details, PERSONAL);

    const admin = sent.filter((message) => message.to === '34699999999');
    assert.equal(admin.length, 1);
    assert.match(admin[0].body, /RESTAURANTE — solicitud #1/);
    assert.match(admin[0].body, /OK 1/);
    assert.match(admin[0].body, /NO 1/);
    assert.match(admin[0].body, /Menú Nochevieja/);
    assert.match(admin[0].body, /110 € por persona/);
    assert.match(admin[0].body, /Ana Ruiz/);
    assert.match(admin[0].body, /4 personas/);
    assert.doesNotMatch(admin[0].body, PERSONAL);
    assert.equal(sessions.has(phone), false);
  });

  it('si la imagen no sale, el texto del menú sí llega', async () => {
    failImages = true;
    const errors = [];
    const original = console.error;
    console.error = (...args) => errors.push(args.map(String).join(' '));
    try {
      const messages = await say('34600000113', 'Quiero ver el menú de Nochevieja');
      assert.equal(imagesOf(messages).length, 0);
      assert.match(joined(messages), /110 € por persona/);
      assert.match(joined(messages), /granizado de champagne/);
      assert.ok(errors.some((line) => /\[fotos\]/.test(line)));
    } finally {
      console.error = original;
    }
  });
});

describe('confirmación de Nico', () => {
  const ADMIN = '34699999999';
  const ADDRESS = 'Ctra. Salamanca–Alba de Tormes km 17';
  const PERSONAL = /650\s*488\s*113|661\s*724\s*158|650488113|661724158|34650488113|34661724158/;

  function seed(overrides = {}) {
    const id = reservations.length + 1;
    const row = {
      id,
      phone: '34600000999',
      name: 'Ana Ruiz',
      partySize: 4,
      party_size: 4,
      date: '2026-12-31',
      time: 'menú',
      type: 'restaurante',
      status: 'pending',
      details: 'Menú Nochevieja · 110 € por persona',
      customer_notice: null,
      reject_reason: null,
      decided_at: null,
      ...overrides,
    };
    if (overrides.partySize != null && overrides.party_size == null) row.party_size = overrides.partySize;
    reservations.push(row);
    return row;
  }

  function toCustomer(phone) {
    return sent.filter((message) => message.to === phone);
  }

  it('el WhatsApp de administración no entra en el flujo del cliente', async () => {
    let messages = await say(ADMIN, 'quiero una mesa');
    assert.match(joined(messages), /OK 123/);
    assert.match(joined(messages), /NO 123/);
    assert.doesNotMatch(joined(messages), /qué día/i);
    assert.equal(sessions.has(ADMIN), false);
    assert.equal(reservations.length, 0);

    messages = await say('+34 699 999 999', 'hola');
    assert.match(joined(messages), /administración/);
    assert.equal(messages.some((message) => message.kind === 'buttons'), false);
  });

  it('OK con el código confirma y avisa al cliente dentro de las 24 h', async () => {
    const phone = '34600000999';
    seed();
    inboundAt.set(phone, new Date().toISOString());
    const admin = await say(ADMIN, 'OK 1');
    assert.match(joined(admin), /Solicitud #1 confirmada/);
    assert.match(joined(admin), /He avisado a Ana Ruiz/);
    const customer = toCustomer(phone);
    assert.equal(customer.length, 1);
    const body = customer[0].body;
    assert.match(body, /queda \*confirmada\*/);
    assert.match(body, /Menú Nochevieja/);
    assert.match(body, /110 € por persona/);
    assert.match(body, /31 de diciembre de 2026/);
    assert.match(body, /4 personas/);
    assert.match(body, /Ana Ruiz/);
    assert.ok(body.includes(ADDRESS));
    assert.match(body, /923 37 00 76/);
    assert.match(body, /reservas@donfadrique\.com/);
    assert.doesNotMatch(body, new RegExp(phone));
    assert.doesNotMatch(body, PERSONAL);
    assert.equal(reservations[0].status, 'confirmed');
    assert.equal(reservations[0].customer_notice, 'sent');
    assert.equal(sent.filter((message) => message.kind === 'template').length, 0);

    const again = await say(ADMIN, 'OK 1');
    assert.match(joined(again), /ya está confirmada/);
    assert.equal(toCustomer(phone).length, 1);
  });

  it('OK a secas confirma la única pendiente y NO lleva el motivo', async () => {
    const phone = '34600000991';
    seed({ phone, name: 'Luis' });
    inboundAt.set(phone, new Date().toISOString());
    let admin = await say(ADMIN, 'ok');
    assert.match(joined(admin), /confirmada/);
    assert.equal(reservations[0].status, 'confirmed');

    seed({ phone: '34600000992', name: 'Marta' });
    seed({ phone: '34600000993', name: 'Pedro' });
    const before = reservations.filter((row) => row.status === 'pending').length;
    admin = await say(ADMIN, 'OK');
    assert.match(joined(admin), /Hay 2 solicitudes pendientes/);
    assert.match(joined(admin), /#2/);
    assert.match(joined(admin), /#3/);
    assert.equal(reservations.filter((row) => row.status === 'pending').length, before);

    admin = await say(ADMIN, 'NO 3 no hay hueco esa noche');
    assert.match(joined(admin), /rechazada/);
    assert.match(joined(admin), /He avisado a Pedro/);
    const customer = toCustomer('34600000993').at(-1).body;
    assert.match(customer, /sentimos no poder aceptar/);
    assert.match(customer, /no hay hueco esa noche/);
    assert.match(customer, /923 37 00 76/);
    assert.match(customer, /reservas@donfadrique\.com/);
    assert.match(customer, /otra fecha/);
    assert.doesNotMatch(customer, /34600000993/);
    assert.doesNotMatch(customer, PERSONAL);
    assert.equal(reservations[2].status, 'rejected');
    assert.equal(reservations[1].status, 'pending');
  });

  it('fuera de 24 h no manda plantilla y lo cuenta cuando el cliente vuelve a escribir', async () => {
    const phone = '34600000994';
    seed({ phone, name: 'Nuria' });
    inboundAt.set(phone, new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString());
    const templatesBefore = sent.filter((message) => message.kind === 'template').length;
    const admin = await say(ADMIN, 'OK 1');
    assert.match(joined(admin), /no le he escrito por WhatsApp/);
    assert.match(joined(admin), /24 h/);
    assert.match(joined(admin), /plantillas de pago/);
    assert.match(joined(admin), /otro medio/);
    assert.match(joined(admin), /vuelva a escribir/);
    assert.equal(toCustomer(phone).length, 0);
    assert.equal(reservations[0].status, 'confirmed');
    assert.equal(reservations[0].customer_notice, 'deferred');
    assert.equal(sent.filter((message) => message.kind === 'template').length, templatesBefore);

    const later = await say(phone, 'hola');
    assert.match(joined(later), /queda \*confirmada\*/);
    assert.ok(joined(later).includes(ADDRESS));
    assert.equal(later.at(-1).kind, 'buttons');
    assert.equal(reservations[0].customer_notice, 'sent');

    const again = await say(phone, 'hola');
    assert.doesNotMatch(joined(again), /queda \*confirmada\*/);
  });

  it('si Meta rechaza el mensaje de sesión, tampoco usa plantilla', async () => {
    const phone = '34600000995';
    seed({ phone });
    inboundAt.set(phone, new Date().toISOString());
    failWindowFor = phone;
    const admin = await say(ADMIN, 'OK #1');
    assert.match(joined(admin), /plantillas de pago/);
    assert.equal(toCustomer(phone).length, 0);
    assert.equal(reservations[0].customer_notice, 'deferred');
    assert.equal(sent.filter((message) => message.kind === 'template' && message.to === phone).length, 0);
  });

  it('confirmar una habitación actualiza el PMS y rechazarla la libera', async () => {
    seed({
      phone: '34600000996',
      name: 'Clara',
      type: 'hotel',
      time: '--:--',
      date: '2026-11-15',
      partySize: 2,
      party_size: 2,
      details: 'Entrada 2026-11-15, Salida 2026-11-17, 2 noche(s), 2 pers. | Hab 4 | 180 EUR | PMS 55',
    });
    inboundAt.set('34600000996', new Date().toISOString());
    await say(ADMIN, 'confirmar 1');
    assert.deepEqual(hotelCalls, [{ action: 'confirm', id: '55' }]);
    assert.match(toCustomer('34600000996')[0].body, /Habitación/);
    assert.match(toCustomer('34600000996')[0].body, /15 de noviembre de 2026/);
    assert.match(toCustomer('34600000996')[0].body, /17 de noviembre de 2026/);
    assert.doesNotMatch(toCustomer('34600000996')[0].body, /PMS|34600000996/);

    seed({
      phone: '34600000997',
      name: 'Diego',
      type: 'hotel',
      details: 'Entrada 2026-12-01, Salida 2026-12-03, 2 noche(s) | PMS 77',
    });
    inboundAt.set('34600000997', new Date().toISOString());
    await say(ADMIN, 'NO 2 llama al 34611222333');
    assert.deepEqual(hotelCalls.at(-1), { action: 'delete', id: '77' });
    const body = toCustomer('34600000997')[0].body;
    assert.match(body, /sentimos no poder aceptar/);
    assert.doesNotMatch(body, /34611222333|34600000997/);
    assert.match(body, /otra fecha/);
  });
});

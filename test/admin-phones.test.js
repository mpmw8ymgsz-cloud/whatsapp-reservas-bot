const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { Settings } = require('luxon');

delete process.env.ADMIN_PHONE;
process.env.ADMIN_PHONES = '34611111111, 34622222222';
delete process.env.ADMIN_ALERT_TEMPLATE;
process.env.WHATSAPP_PROVIDER = 'meta';
process.env.TURSO_DATABASE_URL = 'libsql://example.turso.io';
process.env.TURSO_AUTH_TOKEN = 'test';
process.env.ADMIN_KEY = 'test-key';

const OPEN = '34611111111';
const OTHER = '34622222222';

const sent = [];
const emails = [];
const sessions = new Map();
const reservations = [];
const inboundAt = new Map();
let failAdminText = false;

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
      status: record.status || 'confirmed',
      customer_notice: null,
      reject_reason: null,
      decided_at: null,
    });
    return id;
  },
  async getReservation(id) {
    return reservations.find((row) => row.id === Number(id)) || null;
  },
  async listPendingReservations() {
    return reservations.filter((row) => row.status === 'pending');
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
  async listDeferredNotices() {
    return [];
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
  async markAdminAlertFailed(id) {
    const row = reservations.find((item) => item.id === Number(id));
    if (!row) return;
    row.admin_alert = 'failed';
  },
  async getUpcomingReservations() {
    return [];
  },
  async cancelReservation() {
    return false;
  },
};

const mockWa = {
  async sendText(to, body) {
    if (failAdminText && (to === OPEN || to === OTHER)) {
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
    sent.push({ to, kind: 'template', body: (options.bodyParameters || []).join(' '), options });
  },
  async sendImage(to, image) {
    sent.push({ to, kind: 'image', body: image.caption || '' });
  },
};

const mockMailer = {
  async sendRequestAlert(alert) {
    emails.push(JSON.parse(JSON.stringify(alert)));
    return { ok: true };
  },
};

const mockHotel = {
  async confirmReservation() {
    return { ok: true };
  },
  async deleteReservation() {
    return { ok: true };
  },
};

const Module = require('module');
const originalRequire = Module.prototype.require;
Module.prototype.require = function (id) {
  if (id === './db' || id === '../db') return mockDb;
  if (id === './wa' || id === '../wa') return mockWa;
  if (id === './hotelApi' || id === '../hotelApi') return mockHotel;
  if (id === './mailer' || id === '../mailer') return mockMailer;
  return originalRequire.apply(this, arguments);
};

const { handleIncoming } = require('../src/conversation');
const log = require('../src/conversationLog');

function joined(messages) {
  return messages.map((message) => message.body).join('\n');
}

async function say(phone, text, buttonId = null) {
  const before = sent.length;
  await handleIncoming(phone, text, buttonId, { timestamp: String(Math.floor(Date.now() / 1000)) });
  return sent.slice(before).filter((message) => message.to === phone);
}

async function bookTable(phone) {
  await say(phone, 'quiero una mesa');
  await say(phone, '15/11');
  await say(phone, '14:00');
  await say(phone, '2');
  await say(phone, 'Ana Ruiz');
  await say(phone, 'sí', 'confirm_yes');
}

function toAdmin(phone, kind) {
  return sent.filter((message) => message.to === phone && (!kind || message.kind === kind));
}

beforeEach(() => {
  sent.length = 0;
  emails.length = 0;
  reservations.length = 0;
  sessions.clear();
  inboundAt.clear();
  failAdminText = false;
  Settings.now = () => new Date('2026-10-22T10:00:00+02:00').getTime();
});

describe('varios teléfonos de administración', () => {
  it('avisa a cada administrador con la ventana abierta', async () => {
    inboundAt.set(OPEN, new Date().toISOString());
    inboundAt.set(OTHER, new Date().toISOString());
    await bookTable('34600000071');
    assert.equal(toAdmin(OPEN, 'text').length, 1);
    assert.equal(toAdmin(OTHER, 'text').length, 1);
    assert.match(toAdmin(OPEN, 'text')[0].body, /Ana Ruiz/);
    assert.match(toAdmin(OTHER, 'text')[0].body, /OK 1/);
    assert.equal(emails.length, 1);
    assert.equal(emails[0].whatsappOk, true);
    assert.equal(sent.some((message) => message.kind === 'template'), false);
  });

  it('no escribe al administrador cuya ventana de 24 h está cerrada', async () => {
    inboundAt.set(OPEN, new Date().toISOString());
    inboundAt.set(OTHER, new Date(Date.now() - 30 * 60 * 60 * 1000).toISOString());
    await bookTable('34600000072');
    assert.equal(toAdmin(OPEN, 'text').length, 1);
    assert.equal(toAdmin(OTHER).length, 0);
    assert.equal(emails[0].whatsappOk, true);
    assert.equal(sent.some((message) => message.kind === 'template'), false);
  });

  it('cualquiera de los dos puede confirmar, aunque el aviso no le llegara', async () => {
    inboundAt.set(OPEN, new Date().toISOString());
    inboundAt.set(OTHER, new Date(Date.now() - 30 * 60 * 60 * 1000).toISOString());
    await bookTable('34600000073');
    assert.equal(reservations[0].status, 'pending');
    const reply = await say(OTHER, 'OK 1');
    assert.match(joined(reply), /confirmada/);
    assert.equal(reservations[0].status, 'confirmed');
    assert.equal(log.detectTopic({ text: 'OK 1', phone: OTHER }), 'admin');
    assert.equal(log.detectTopic({ text: 'hola', phone: '34600000073' }), 'menu');
  });

  it('si el texto falla y no hay marca de ventana, la plantilla sale a cada uno', async () => {
    failAdminText = true;
    const phone = '34600000074';
    await say(phone, 'comida de navidad de empresa');
    await say(phone, 'solicitar');
    await say(phone, 'Agencia Sol');
    await say(phone, 'Lucía');
    await say(phone, '01/12/2026');
    await say(phone, 'cena', 'emp_cena');
    await say(phone, '30');
    await say(phone, 'lucia@agencia.es');
    await say(phone, 'enviar', 'emp_send');
    assert.equal(reservations[0].type, 'evento_empresa');
    assert.equal(toAdmin(OPEN, 'template').length, 1);
    assert.equal(toAdmin(OTHER, 'template').length, 1);
    assert.equal(toAdmin(OPEN, 'text').length, 0);
    assert.equal(emails[0].whatsappOk, true);
    assert.equal(emails[0].type, 'evento_empresa');
  });
});

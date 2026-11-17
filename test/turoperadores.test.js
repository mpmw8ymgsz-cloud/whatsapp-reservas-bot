const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

process.env.ADMIN_PHONE = '34699999999';
delete process.env.ADMIN_ALERT_TEMPLATE;
process.env.WHATSAPP_PROVIDER = 'meta';
process.env.TURSO_DATABASE_URL = 'libsql://example.turso.io';
process.env.TURSO_AUTH_TOKEN = 'test';
process.env.ADMIN_KEY = 'test-key';
delete process.env.BREVO_API_KEY;

const { buildRequestEmail } = require('../src/mailer');
const tours = require('../src/turoperadores');
const log = require('../src/conversationLog');
const { normalize } = require('../src/dateParser');
const config = require('../src/config');

const sent = [];
const emails = [];
const sessions = new Map();
const reservations = [];

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
    reservations.push({ ...record, id });
    return id;
  },
  async touchLastInbound() {},
  async getLastInbound() {
    return new Date().toISOString();
  },
  async listDeferredNotices() {
    return [];
  },
  async markAdminAlertFailed() {},
};

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

const PERSONAL = /661|724\s*158|34661724158/;
const INVENTED = /€|%\s*de comisión|commission of \d|room for (?:a |the )?coach|cabe el autocar|el autocar cabe|coaches can park|plaza gratuita|free of charge/i;

function joined(messages) {
  return messages.map((message) => message.body).join('\n');
}

function assertWhatsApp(messages) {
  for (const message of messages) {
    assert.ok(message.body.length <= 4096, `mensaje demasiado largo (${message.body.length})`);
    if (message.kind === 'buttons') {
      assert.ok(message.body.length <= 1024, `cuerpo de botones demasiado largo (${message.body.length})`);
      assert.ok(message.buttons.length >= 1 && message.buttons.length <= 3);
      for (const button of message.buttons) {
        assert.ok([...button.title].length <= 20, `título de botón demasiado largo: ${button.title}`);
      }
    }
  }
}

async function say(phone, text, buttonId = null) {
  const before = sent.length;
  await handleIncoming(phone, text, buttonId, null);
  const messages = sent.slice(before).filter((message) => message.to === phone);
  assertWhatsApp(messages);
  assert.doesNotMatch(joined(messages), PERSONAL);
  return messages;
}

beforeEach(() => {
  sent.length = 0;
  emails.length = 0;
  reservations.length = 0;
  sessions.clear();
});

describe('detección de turoperador', () => {
  const cases = [
    ['somos una agencia de viajes', true],
    ['we are a tour operator', true],
    ['Hello, we are 206 Tours and we would like group lunches for our 2027 tours', true],
    ['DMC looking for lunch', true],
    ['I am a tour leader', true],
    ['soy guía turístico', true],
    ['our group arrives by coach', true],
    ['quiero una boda', false],
    ['comidas de Navidad para empresas', false],
    ['estáis en la guía Michelin', false],
    ['hay bus para el grupo', false],
    ['quiero una mesa', false],
    ['congreso de 300 personas', false],
    ['congress for 200 people', false],
  ];

  for (const [phrase, expected] of cases) {
    it(`${expected ? 'abre' : 'no abre'} «${phrase}»`, () => {
      assert.equal(tours.isInquiry(normalize(phrase)), expected, phrase);
    });
  }

  it('responde en el idioma del mensaje y no cambia con un número', () => {
    assert.equal(tours.detectLang('Hello, we are a tour operator looking for lunch', 'es'), 'en');
    assert.equal(tours.detectLang('Hola, somos una agencia de viajes', 'en'), 'es');
    assert.equal(tours.detectLang('travel agency', 'es'), 'en');
    assert.equal(tours.detectLang('40', 'en'), 'en');
    assert.equal(tours.detectLang('42', 'es'), 'es');
  });

  it('no dice que el autocar quepa y no inventa un precio', () => {
    const parking = tours.answerFact('can the coach park there?', 'en');
    assert.match(parking, /private parking/i);
    assert.match(parking, /proposal/i);
    assert.doesNotMatch(parking, /room for|can park|fits/i);
    const price = tours.answerFact('¿cuánto cuesta y hay comisión o plaza para el guía?', 'es');
    assert.match(price, /propuesta a medida para 2027/);
    assert.doesNotMatch(price, INVENTED);
    assert.doesNotMatch(price, PERSONAL);
  });

  it('clasifica la conversación como turoperador', () => {
    assert.equal(log.detectTopic({ text: 'We are a DMC and we need lunch for our groups' }), 'turoperador');
    assert.equal(
      log.detectTopic({ text: '40', session: { step: 'GRUPO', data: { flow: 'turoperador', stage: 'pax' } } }),
      'turoperador'
    );
    assert.equal(log.detectTopic({ text: 'quiero una boda' }), 'boda');
    assert.equal(log.detectTopic({ text: 'comidas de Navidad para empresas' }), 'navidad_empresa');
    assert.equal(log.nextTopic('turoperador', 'menu'), 'turoperador');
    assert.equal(log.sourceTag(tours.TRIGGER_ES), 'turoperador');
    assert.equal(log.sourceTag(tours.TRIGGER_EN), 'turoperador');
    assert.equal(log.sourceLabel('turoperador'), 'Turoperador / grupo');
    assert.equal(config.adminAlertTemplate, 'aviso_solicitud_presupuesto');
  });
});

describe('solicitud de turoperador', () => {
  it('en español recoge los datos, los guarda y avisa con la etiqueta', async () => {
    let body = joined(
      await say('34600000081', 'Hola, somos una agencia de viajes y queremos comida de grupo para nuestros tours de 2027')
    );
    assert.match(body, /Turoperador \/ grupo/);
    assert.match(body, /21 habitaciones dobles/);
    assert.match(body, /aparcamiento privado/);
    assert.match(body, /10 a 50/);
    assert.match(body, /masa madre/);
    assert.match(body, /morucha/i);
    assert.match(body, /Tormes/);
    assert.match(body, /propuesta a medida para 2027/);
    assert.match(body, /empresa o la agencia/);
    assert.doesNotMatch(body, /What is the company/);
    assert.doesNotMatch(body, INVENTED);

    await say('34600000081', 'Agencia Sol');
    await say('34600000081', 'Lucía Martín');
    await say('34600000081', 'lucia@agenciasol.es');
    await say('34600000081', 'España');
    await say('34600000081', 'primavera de 2027');
    await say('34600000081', '42');
    await say('34600000081', '6 salidas');
    await say('34600000081', 'español');
    body = joined(await say('34600000081', 'Comida', 'top_lunch'));
    assert.match(body, /dormir|hotel/i);
    await say('34600000081', 'También hotel', 'top_also');
    await say('34600000081', 'dos vegetarianos');
    await say('34600000081', 'En autocar', 'top_coach_yes');
    body = joined(await say('34600000081', 'Enviar solicitud', 'top_send'));
    assert.match(body, /He anotado la solicitud/);
    assert.match(body, /\+34 923 37 00 76/);
    assert.match(body, /reservas@donfadrique.com/);
    assert.doesNotMatch(body, INVENTED);

    const saved = reservations.at(-1);
    assert.equal(saved.type, 'evento_turoperador');
    assert.equal(saved.name, 'Lucía Martín');
    assert.equal(saved.partySize, 42);
    assert.equal(saved.date, 'primavera de 2027');
    assert.equal(saved.time, 'comida y hotel');
    assert.match(saved.details, /Empresa: Agencia Sol/);
    assert.match(saved.details, /Email: lucia@agenciasol.es/);
    assert.match(saved.details, /País: España/);
    assert.match(saved.details, /Grupos\/salidas: 6 salidas/);
    assert.match(saved.details, /Idioma del grupo: español/);
    assert.match(saved.details, /Dietas: dos vegetarianos/);
    assert.match(saved.details, /Llegada en autocar: sí/);
    assert.match(saved.details, /pendiente de propuesta 2027/);

    const admin = sent.filter((message) => message.to === '34699999999').at(-1);
    assert.equal(admin.kind, 'text');
    assert.match(admin.body, /Turoperador \/ grupo/);
    assert.match(admin.body, /Agencia Sol/);
    assert.match(admin.body, /lucia@agenciasol.es/);
    assert.match(admin.body, /6 salidas/);
    assert.equal(sent.some((message) => message.kind === 'template'), false);

    assert.equal(emails.length, 1);
    assert.equal(emails[0].type, 'evento_turoperador');
    assert.equal(emails[0].company, 'Agencia Sol');
    assert.equal(emails[0].whatsappOk, true);
    const email = buildRequestEmail(emails[0]);
    assert.match(email.subject, /Turoperador \/ grupo/);
    assert.match(email.subject, /Agencia Sol/);
    assert.match(email.text, /Pasajeros por grupo: 42/);
    assert.match(email.text, /Llegada en autocar: sí/);
    assert.match(email.text, /dos vegetarianos/);
    assert.doesNotMatch(email.text, PERSONAL);
  });

  it('en inglés responde con naturalidad y no cierra un precio a mitad del flujo', async () => {
    let body = joined(
      await say('34600000082', 'Hello, we are a tour operator from the United States and we would like group lunches for our 2027 tours')
    );
    assert.match(body, /Tour operators and groups/);
    assert.match(body, /about 17 km from Salamanca/);
    assert.match(body, /21 double rooms/);
    assert.match(body, /private parking/);
    assert.match(body, /glazed terrace/);
    assert.match(body, /10 to 50/);
    assert.match(body, /Iberian pork/);
    assert.match(body, /Morucha beef/);
    assert.match(body, /river Tormes/);
    assert.match(body, /sourdough/);
    assert.match(body, /wood-fired oven/);
    assert.match(body, /tailored 2027 proposal/);
    assert.match(body, /What is the company or agency name/);
    assert.doesNotMatch(body, /¿Cómo se llama|He anotado|propuesta/);
    assert.doesNotMatch(body, INVENTED);

    body = joined(await say('34600000082', 'How much is the group lunch, and is the guide free?'));
    assert.match(body, /tailored 2027 proposal/);
    assert.match(body, /What is the company or agency name/);
    assert.equal(reservations.length, 0);

    await say('34600000082', '206 Tours');
    await say('34600000082', 'Sarah Johnson');
    await say('34600000082', 'sarah@206tours.com');
    await say('34600000082', 'United States');
    await say('34600000082', 'spring 2027');
    await say('34600000082', '40');
    await say('34600000082', '8 departures');
    await say('34600000082', 'English');
    body = joined(await say('34600000082', 'both, lunch'));
    assert.match(body, /allergies or special diets/i);
    await say('34600000082', 'two gluten-free');
    body = joined(await say('34600000082', 'yes, by coach'));
    assert.match(body, /Shall I send it like this/);
    assert.match(body, /206 Tours/);
    assert.match(body, /lunch and an overnight stay/);
    body = joined(await say('34600000082', 'send'));
    assert.match(body, /I.ve logged request/);
    assert.match(body, /\+34 923 37 00 76/);
    assert.match(body, /reservas@donfadrique.com/);
    assert.doesNotMatch(body, /He anotado/);
    assert.doesNotMatch(body, INVENTED);

    const saved = reservations.at(-1);
    assert.equal(saved.type, 'evento_turoperador');
    assert.equal(saved.partySize, 40);
    assert.equal(saved.time, 'comida y hotel');
    assert.match(saved.details, /Empresa: 206 Tours/);
    assert.match(saved.details, /Email: sarah@206tours.com/);
    assert.match(saved.details, /País: United States/);
    assert.match(saved.details, /Fechas: spring 2027/);
    assert.match(saved.details, /Grupos\/salidas: 8 departures/);
    assert.match(saved.details, /Idioma del grupo: English/);
    assert.match(saved.details, /Idioma del chat: inglés/);
    assert.match(saved.details, /Dietas: two gluten-free/);
    assert.match(saved.details, /Llegada en autocar: sí/);

    const admin = sent.filter((message) => message.to === '34699999999').at(-1);
    assert.match(admin.body, /Turoperador \/ grupo/);
    assert.match(admin.body, /sarah@206tours.com/);
    assert.match(admin.body, /8 departures/);
    const email = buildRequestEmail(emails.at(-1));
    assert.match(email.subject, /Turoperador \/ grupo · 206 Tours/);
    assert.match(email.text, /two gluten-free/);
    assert.match(email.text, /spring 2027/);
  });

  it('no desvía una boda, una comida de Navidad ni una mesa', async () => {
    let body = joined(await say('34600000083', 'quiero una boda'));
    assert.match(body, /Bodas en/);
    body = joined(await say('34600000083', 'somos un turoperador y queremos comida'));
    assert.doesNotMatch(body, /pase frío|sharing meal|What is the company/);

    body = joined(await say('34600000084', 'comidas de Navidad para empresas'));
    assert.match(body, /Comidas de Navidad para empresas/);
    assert.match(body, /55 € \+ IVA/);
    assert.doesNotMatch(body, /sharing meal|pase frío/);

    body = joined(await say('34600000085', 'quiero una mesa'));
    assert.match(body, /Restaurante Don Fadrique/);

    body = joined(await say('34600000086', '¿Estáis en la guía Michelin?'));
    assert.doesNotMatch(body, /empresa o la agencia|What is the company|tailored 2027/);
  });
});

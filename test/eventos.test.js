const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { Settings } = require('luxon');

process.env.ADMIN_PHONE = '34699999999';
process.env.WHATSAPP_PROVIDER = 'meta';
process.env.TURSO_DATABASE_URL = 'libsql://example.turso.io';
process.env.TURSO_AUTH_TOKEN = 'test';
process.env.ADMIN_KEY = 'test-key';

const sent = [];
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
    reservations.push({ ...record });
    return reservations.length;
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
};

const Module = require('module');
const originalRequire = Module.prototype.require;
Module.prototype.require = function (id) {
  if (id === './db' || id === '../db') return mockDb;
  if (id === './wa' || id === '../wa') return mockWa;
  return originalRequire.apply(this, arguments);
};

const { handleIncoming } = require('../src/conversation');
const menus = require('../src/menusEmpresa');
const conocimiento = require('../src/eventosConocimiento');
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

async function say(phone, text, buttonId = null) {
  const before = sent.length;
  await handleIncoming(phone, text, buttonId);
  const messages = sent.slice(before).filter((m) => m.to === phone);
  assertWhatsApp(messages);
  return messages;
}

beforeEach(() => {
  sent.length = 0;
  reservations.length = 0;
  sessions.clear();
  Settings.now = () => new Date('2026-10-22T10:00:00+02:00').getTime();
});

describe('menús de empresa, solo platos del documento', () => {
  it('resume los tres menús con su precio y sin platos', () => {
    const text = menus.overviewText('Hostería Don Fadrique');
    assert.match(text, /Menú Mediodía/);
    assert.match(text, /Precio a consultar \(\+ IVA\)/);
    assert.match(text, /Menú Navidad/);
    assert.match(text, /65 € \+ IVA por persona/);
    assert.match(text, /Menú Gran Gala/);
    assert.match(text, /110 € \+ IVA por persona, vinos incluidos/);
    assert.deepEqual(text.match(/\d+\s*€/g), ['65 €', '110 €']);
    assert.doesNotMatch(text, /stracciatella|pistacho|wellington|capuccino|mazapán/i);
    assert.doesNotMatch(text, FORBIDDEN);
  });

  it('detalla cada menú con sus platos y no con los de otro', () => {
    const mediodia = menus.detailText('mediodia');
    const navidad = menus.detailText('navidad');
    const gala = menus.detailText('gran_gala');

    assert.match(mediodia, /fiambres navideños \(pastrami ibérico, paté navideño, croqueta de jamón\)/);
    assert.match(mediodia, /ensalada de rúcula con nueces, granada y stracciatella artesana/);
    assert.match(mediodia, /consomé de faisán con su albóndiga/);
    assert.match(mediodia, /cochinillo asado tradicional/);
    assert.match(mediodia, /lubina con ajada/);
    assert.match(mediodia, /chocolate de Navidad/);
    assert.match(mediodia, /a elegir uno para todo el grupo/);
    assert.doesNotMatch(mediodia, /pistacho|mazapán|wellington|capuccino|granizado/);

    assert.match(navidad, /jamón, gambas, paté de pato y fiambres navideños/);
    assert.match(navidad, /alcachofa con pistacho y café/);
    assert.match(navidad, /lubina/);
    assert.match(navidad, /cochinillo de Navidad \(alternativa posible: tostón a la leña\)/);
    assert.match(navidad, /mazapán carmelita/);
    assert.match(navidad, /65 € \+ IVA/);
    assert.doesNotMatch(navidad, /stracciatella|wellington|capuccino|ajada/);

    assert.match(gala, /jamón, gambas y anchoa/);
    assert.match(gala, /capuccino de lentejas con perdiz/);
    assert.match(gala, /buñuelo de gambas con jugo de sus cabezas/);
    assert.match(gala, /ahumado nórdico de trucha con sus huevas/);
    assert.match(gala, /lubina o besugo, según mercado/);
    assert.match(gala, /granizado de champán/);
    assert.match(gala, /venado de Navidad con ragú de setas/);
    assert.match(gala, /solomillo Wellington/);
    assert.match(gala, /tatin de manzana con helado de mango/);
    assert.match(gala, /cremoso de queso con almendra amarga y helado de turrón/);
    assert.match(gala, /110 € \+ IVA por persona, vinos incluidos/);
    assert.doesNotMatch(gala, /stracciatella|mazapán|ajada|paté de pato/);
    assert.doesNotMatch(`${mediodia}\n${navidad}\n${gala}`, FORBIDDEN);
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
    assert.match(vinos, /vinos van incluidos/);
    assert.doesNotMatch(vinos, FORBIDDEN);
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
    assert.match(body, /menús de Navidad|congreso/i);
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

  it('la reserva de mesa del restaurante sigue confirmándose', async () => {
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
    assert.match(body, /Mesa confirmada/);
    assert.equal(reservations.length, 1);
    assert.equal(reservations[0].type, 'restaurante');
    assert.equal(reservations[0].status, undefined);
    assert.equal(reservations[0].partySize, 4);
    assert.equal(reservations[0].time, '14:00');
  });

  it('el hotel sigue pidiendo la fecha de entrada', async () => {
    const body = joined(await say('34600000003', 'quiero una habitación'));
    assert.match(body, /entrar/);
    assert.match(body, /check-in/i);
    assert.equal(reservations.length, 0);
  });

  it('menús de Navidad enseña el resumen y el detalle solo si lo piden', async () => {
    let messages = await say('34600000004', 'menús de Navidad');
    let body = joined(messages);
    assert.match(body, /Menú Mediodía/);
    assert.match(body, /Menú Navidad/);
    assert.match(body, /Menú Gran Gala/);
    assert.match(body, /65 €/);
    assert.match(body, /110 €/);
    assert.match(body, /Precio a consultar/);
    assert.doesNotMatch(body, /pistacho|stracciatella|wellington/i);

    messages = await say('34600000004', 'qué incluye el menú gran gala');
    body = joined(messages);
    assert.match(body, /capuccino de lentejas con perdiz/);
    assert.match(body, /solomillo Wellington/);
    assert.doesNotMatch(body, FORBIDDEN);
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
    assert.match(body, /Menú Navidad/);
    assert.match(body, /no queda reservada|pendiente/i);
    assert.doesNotMatch(body, /confirmad/i);

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
    assert.match(saved.details, /Menú Navidad/);
    assert.match(saved.details, /lucia@talleresalba\.es/);
    assert.match(saved.details, /65 € \+ IVA/);
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
    assert.match(body, /menú/i);
    await say(phone, 'mediodía', 'emp_mediodia');
    await say(phone, 'este');
    body = joined(await say(phone, 'enviar', 'emp_send'));
    assert.match(body, /pendiente de presupuesto/);
    assert.match(body, /Precio a consultar/);
    assert.equal(reservations.at(-1).date, '2026-12-31');
    assert.equal(reservations.at(-1).time, 'comida');
    assert.equal(reservations.at(-1).menuId, undefined);
    assert.match(reservations.at(-1).details, /Menú Mediodía/);
    assert.equal(reservations.at(-1).status, 'pending');
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

  it('el botón de eventos deja elegir menú o congreso', async () => {
    const messages = await say('34600000008', 'eventos', 'exp_eventos');
    assert.deepEqual(messages[0].buttons.map((b) => b.id), ['emp_menus', 'cong_start']);
    const body = joined(await say('34600000008', 'menús', 'emp_menus'));
    assert.match(body, /Menú Navidad/);
    assert.match(body, /65 €/);
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
      ],
    });
    assert.match(html, /1 reserva confirmada/);
    assert.match(html, /Ana/);
    assert.match(html, /Solicitudes de empresa y congresos/);
    assert.match(html, /2 solicitudes sin confirmar/);
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

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');

process.env.ADMIN_KEY = 'test-key';
process.env.ADMIN_PHONE = '34699999999';
process.env.TURSO_DATABASE_URL = process.env.TURSO_DATABASE_URL || 'libsql://example.turso.io';
process.env.TURSO_AUTH_TOKEN = process.env.TURSO_AUTH_TOKEN || 'test';
process.env.VERIFY_TOKEN = process.env.VERIFY_TOKEN || 'verify-test';

const {
  ADDRESS,
  PHONE,
  EMAIL,
  WINDOW_MS,
  parseAdminDecision,
  isWindowOpen,
  isSessionWindowError,
  isAdminSender,
  sanitizeReason,
  customerPending,
  customerConfirmed,
  customerRejected,
  adminInstructions,
  adminNotDelivered,
} = require('../src/confirmacion');
const { createApp, renderAdminPage } = require('../src/server-meta');

const PERSONAL = /650\s*488\s*113|661\s*724\s*158|650488113|661724158|34650488113|34661724158/;

describe('órdenes de Nico', () => {
  const cases = [
    ['OK 123', { action: 'confirm', id: 123, reason: '' }],
    ['ok', { action: 'confirm', id: null, reason: '' }],
    ['OK #12', { action: 'confirm', id: 12, reason: '' }],
    ['ok#8', { action: 'confirm', id: 8, reason: '' }],
    ['«OK 8»', { action: 'confirm', id: 8, reason: '' }],
    ['OK!', { action: 'confirm', id: null, reason: '' }],
    ['confirmar 3', { action: 'confirm', id: 3, reason: '' }],
    ['sí', { action: 'confirm', id: null, reason: '' }],
    ['vale 2', { action: 'confirm', id: 2, reason: '' }],
    ['OK nº 3', { action: 'confirm', id: 3, reason: '' }],
    ['NO 123', { action: 'reject', id: 123, reason: '' }],
    ['no', { action: 'reject', id: null, reason: '' }],
    ['NO 123 no hay hueco', { action: 'reject', id: 123, reason: 'no hay hueco' }],
    ['NO 12.', { action: 'reject', id: 12, reason: '' }],
    ['NO 12 no hay.', { action: 'reject', id: 12, reason: 'no hay' }],
    ['rechazar 15 lleno', { action: 'reject', id: 15, reason: 'lleno' }],
    ['NO #9 sin mesa', { action: 'reject', id: 9, reason: 'sin mesa' }],
  ];

  for (const [text, expected] of cases) {
    it(`entiende «${text}»`, () => {
      assert.deepEqual(parseAdminDecision(text), expected);
    });
  }

  for (const text of ['', 'hola', 'hoy', 'no hay mesa', 'ok 12 gracias', 'notable', 'okay']) {
    it(`no toma «${text}» como una orden`, () => {
      assert.equal(parseAdminDecision(text), null);
    });
  }

  it('reconoce el teléfono de administración con espacios o prefijo', () => {
    assert.equal(isAdminSender('+34 661 724 158', '34661724158'), true);
    assert.equal(isAdminSender('0034661724158', '34661724158'), true);
    assert.equal(isAdminSender('34600000000', '34661724158'), false);
    assert.equal(isAdminSender('', '34661724158'), false);
  });
});

describe('ventana de 24 h', () => {
  const now = Date.parse('2026-11-13T12:00:00.000Z');

  it('está abierta justo antes de 24 h y cerrada al cumplirse', () => {
    assert.equal(isWindowOpen(new Date(now - WINDOW_MS + 1).toISOString(), now), true);
    assert.equal(isWindowOpen(new Date(now - WINDOW_MS).toISOString(), now), false);
    assert.equal(isWindowOpen(new Date(now - WINDOW_MS - 1000).toISOString(), now), false);
    assert.equal(isWindowOpen(null, now), null);
    assert.equal(isWindowOpen('   ', now), null);
    assert.equal(isWindowOpen('ayer', now), null);
    assert.equal(isWindowOpen(new Date(now + 60_000).toISOString(), now), true);
  });

  it('detecta el rechazo de Meta por la ventana y no cualquier otro fallo', () => {
    const err = new Error('fallo');
    err.response = { data: { error: { code: 131047, message: 'Re-engagement message' } } };
    assert.equal(isSessionWindowError(err), true);
    const other = new Error('pago');
    other.response = { data: { error: { code: 131042, message: 'payment' } } };
    assert.equal(isSessionWindowError(other), false);
  });
});

describe('mensajes al cliente', () => {
  const menu = {
    id: 12,
    phone: '34611222333',
    name: 'Ana Ruiz',
    party_size: 4,
    date: '2026-12-31',
    time: 'menú',
    type: 'restaurante',
    details: 'Menú Nochevieja · 110 € por persona',
  };

  function assertPublicContact(text) {
    assert.ok(text.includes(ADDRESS));
    assert.ok(text.includes(PHONE));
    assert.ok(text.includes(EMAIL));
    assert.equal(ADDRESS, 'Ctra. Salamanca–Alba de Tormes km 17');
    assert.equal(PHONE, '923 37 00 76');
    assert.equal(EMAIL, 'reservas@donfadrique.com');
    assert.doesNotMatch(text, /34611222333/);
    assert.doesNotMatch(text, PERSONAL);
  }

  it('la confirmación lleva fecha, menú, personas, nombre y el contacto del hotel', () => {
    const text = customerConfirmed(menu);
    assert.match(text, /queda \*confirmada\*/);
    assert.match(text, /Solicitud nº 12/);
    assert.match(text, /Menú Nochevieja/);
    assert.match(text, /110 € por persona/);
    assert.match(text, /31 de diciembre de 2026/);
    assert.match(text, /4 personas/);
    assert.match(text, /Ana Ruiz/);
    assertPublicContact(text);
  });

  it('el rechazo ofrece otra opción y quita teléfonos del motivo', () => {
    const text = customerRejected({ ...menu, reject_reason: 'llama al 34611222333 porfa' });
    assert.match(text, /sentimos no poder aceptar/);
    assert.match(text, /solicitud nº 12/i);
    assert.match(text, /otra fecha/);
    assert.match(text, /923 37 00 76/);
    assert.doesNotMatch(text, /34611222333/);
    assert.doesNotMatch(text, PERSONAL);
    assert.equal(sanitizeReason('llama al +34 611 222 333'), 'llama al');
  });

  it('la habitación muestra la estancia y no el id del PMS', () => {
    const text = customerConfirmed({
      id: 4,
      phone: '34600000003',
      name: 'Clara',
      party_size: 2,
      date: '2026-11-15',
      time: '--:--',
      type: 'hotel',
      details: 'Entrada 2026-11-15, Salida 2026-11-17, 2 noche(s) | Hab 4 | 180 EUR | PMS 55',
    });
    assert.match(text, /Habitación/);
    assert.match(text, /15 de noviembre de 2026/);
    assert.match(text, /17 de noviembre de 2026/);
    assert.match(text, /2 personas/);
    assert.doesNotMatch(text, /PMS|34600000003/);
    assertPublicContact(text);
  });

  it('la comida de empresa no reenvía el teléfono que dejó el cliente', () => {
    const text = customerConfirmed({
      id: 9,
      phone: '34600000005',
      name: 'Lucía',
      party_size: 30,
      date: '2026-12-01',
      time: 'cena',
      type: 'evento_empresa',
      details: 'Empresa: Talleres Alba SL | Menú: menú a medida | Tel: 34611111111 | WhatsApp: 34600000005',
    });
    assert.match(text, /Comida de empresa/);
    assert.match(text, /Talleres Alba SL/);
    assert.match(text, /menú a medida/);
    assert.match(text, /Cena/);
    assert.match(text, /30 personas/);
    assert.doesNotMatch(text, /34611111111|34600000005/);
  });

  it('el acuse inicial no da la reserva por confirmada', () => {
    const text = customerPending({
      id: 3,
      businessName: 'Hostería Don Fadrique',
      lines: ['Mesa en el restaurante', '4 personas', 'Ana Ruiz'],
    });
    assert.match(text, /solicitud nº 3/i);
    assert.match(text, /pendiente de confirmación/);
    assert.match(text, /Ana Ruiz/);
    assert.doesNotMatch(text, /queda \*confirmada\*/);
  });

  it('el aviso a Nico cuando la ventana está cerrada no lleva el móvil del cliente', () => {
    const text = adminNotDelivered({ id: 3, name: 'Ana Ruiz', phone: '34611222333' }, 'confirmed');
    assert.match(text, /no le he escrito por WhatsApp/);
    assert.match(text, /24 h/);
    assert.match(text, /plantillas de pago/);
    assert.match(text, /otro medio/);
    assert.match(text, /vuelva a escribir/);
    assert.doesNotMatch(text, /34611222333/);
    assert.match(adminInstructions(3), /OK 3/);
    assert.match(adminInstructions(3), /NO 3/);
    assert.doesNotMatch(adminInstructions(3), /confirmada/);
  });
});

describe('panel y endpoints', () => {
  it('el panel enseña los botones solo con la clave y mantiene las solicitudes de presupuesto', () => {
    const pending = [
      {
        id: 9,
        date: '2026-12-18',
        time: 'cena',
        type: 'evento_empresa',
        name: 'Lucía',
        party_size: 30,
        details: 'Empresa: Talleres',
        phone: '34600000005',
      },
    ];
    const plain = renderAdminPage({
      businessName: 'Hostería Don Fadrique',
      confirmed: [],
      pending,
      statuses: [],
    });
    assert.match(plain, /Solicitudes de boda, empresa y congresos/);
    assert.match(plain, /Pendiente de presupuesto/);
    assert.match(plain, /OK 123/);
    assert.match(plain, /NO 123 motivo/);
    assert.doesNotMatch(plain, /<form/);

    const withKey = renderAdminPage({
      businessName: 'Hostería Don Fadrique',
      confirmed: [],
      pending,
      statuses: [],
      adminKey: 'test-key',
    });
    assert.match(withKey, /action="\/admin\/reservations\/9\/confirm\?key=test-key"/);
    assert.match(withKey, /action="\/admin\/reservations\/9\/reject\?key=test-key"/);
    assert.match(withKey, /Confirmar/);
    assert.match(withKey, /Rechazar/);
    assert.match(withKey, /name="reason"/);
  });

  describe('HTTP', () => {
    let server;
    let port;
    const calls = [];
    const adminTexts = [];

    before(async () => {
      calls.length = 0;
      const app = createApp(() => {}, {
        decideReservation: async (args) => {
          calls.push(args);
          if (args.id === 404) {
            return { httpStatus: 404, adminText: 'No encuentro la solicitud #404.', body: { ok: false, message: 'no' } };
          }
          return {
            httpStatus: 200,
            adminText: `Solicitud #${args.id} ${args.action === 'reject' ? 'rechazada' : 'confirmada'}.`,
            body: {
              ok: true,
              id: args.id,
              code: String(args.id),
              status: args.action === 'reject' ? 'rejected' : 'confirmed',
              estado: args.action === 'reject' ? 'rechazada' : 'confirmada',
              customerNotified: true,
              message: 'hecho',
            },
          };
        },
        sendAdminText: async (to, body) => {
          adminTexts.push({ to, body });
        },
      });
      server = app.listen(0, '127.0.0.1');
      await once(server, 'listening');
      port = server.address().port;
    });

    after(async () => {
      server.close();
      await once(server, 'close');
    });

    async function post(path, { key, body, json = true, redirect } = {}) {
      const headers = {};
      if (key) headers['x-admin-key'] = key;
      if (json) headers['content-type'] = 'application/json';
      const response = await fetch(`http://127.0.0.1:${port}${path}`, {
        method: 'POST',
        headers,
        body: json ? JSON.stringify(body || {}) : body,
        redirect: redirect || 'follow',
      });
      const text = await response.text();
      let payload = null;
      try {
        payload = JSON.parse(text);
      } catch (err) {
        payload = text;
      }
      return { status: response.status, json: payload, headers: response.headers };
    }

    it('exige la clave y un id válido', async () => {
      const before = calls.length;
      const denied = await post('/admin/reservations/5/confirm', { body: {} });
      assert.equal(denied.status, 403);
      const bad = await post('/admin/reservations/nope/confirm', { key: 'test-key', body: {} });
      assert.equal(bad.status, 400);
      assert.equal(calls.length, before);
    });

    it('confirma y rechaza, y avisa a Nico solo si la decisión se aplicó', async () => {
      const ok = await post('/admin/reservations/12/confirm', { key: 'test-key', body: {} });
      assert.equal(ok.status, 200);
      assert.equal(ok.json.ok, true);
      assert.equal(ok.json.code, '12');
      assert.equal(ok.json.estado, 'confirmada');
      assert.equal(calls.at(-1).action, 'confirm');
      assert.equal(calls.at(-1).id, 12);
      assert.equal(adminTexts.at(-1).to, '34699999999');
      assert.match(adminTexts.at(-1).body, /confirmada/);

      const rejected = await post('/admin/reservations/13/reject', {
        key: 'test-key',
        body: { reason: 'no hay mesa' },
      });
      assert.equal(rejected.status, 200);
      assert.equal(rejected.json.estado, 'rechazada');
      assert.equal(calls.at(-1).reason, 'no hay mesa');

      const missing = await post('/admin/reservations/404/confirm', { key: 'test-key', body: {} });
      assert.equal(missing.status, 404);
      assert.equal(adminTexts.filter((message) => /404/.test(message.body)).length, 0);
    });

    it('el formulario vuelve al panel', async () => {
      const response = await fetch(`http://127.0.0.1:${port}/admin/reservations/8/reject?key=test-key`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: 'reason=ocupado',
        redirect: 'manual',
      });
      assert.equal(response.status, 303);
      assert.match(response.headers.get('location'), /^\/admin\?key=test-key$/);
      assert.equal(calls.at(-1).action, 'reject');
      assert.equal(calls.at(-1).reason, 'ocupado');
    });
  });
});

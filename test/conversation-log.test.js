const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { Settings } = require('luxon');

process.env.ADMIN_KEY = 'test-key';
process.env.ADMIN_PHONE = '34699999999';
process.env.TURSO_DATABASE_URL = 'libsql://example.turso.io';
process.env.TURSO_AUTH_TOKEN = 'test-token';
process.env.VERIFY_TOKEN = 'verify-test';

const axios = require('axios');

const conversations = new Map();
const messages = [];
let nextMessageId = 1;

function argToJs(arg) {
  if (!arg || arg.type === 'null') return null;
  if (arg.type === 'integer') return Number(arg.value);
  return arg.value;
}

function ok(result) {
  return { data: { results: [{ type: 'ok', response: { result } }] } };
}

function table(cols, rows) {
  return ok({
    cols: cols.map((name) => ({ name })),
    rows: rows.map((row) =>
      cols.map((name) => {
        const value = row[name];
        if (value == null) return { type: 'null' };
        if (typeof value === 'number') return { type: 'integer', value: String(value) };
        return { type: 'text', value: String(value) };
      })
    ),
  });
}

const CONV_COLS = [
  'phone',
  'profile_name',
  'source',
  'source_locked',
  'topic',
  'outcome',
  'first_at',
  'last_at',
  'message_count',
];

axios.post = async (url, body) => {
  const stmt = body?.requests?.[0]?.stmt;
  const sql = stmt?.sql || '';
  const args = (stmt?.args || []).map(argToJs);
  if (/^\s*(CREATE|ALTER)\b/i.test(sql)) return ok({ cols: [], rows: [] });
  if (/INSERT INTO conversations/i.test(sql)) {
    conversations.set(args[0], {
      phone: args[0],
      profile_name: args[1],
      source: args[2],
      source_locked: Number(args[3]) || 0,
      topic: args[4],
      outcome: args[5],
      first_at: args[6],
      last_at: args[7],
      message_count: Number(args[8]) || 0,
    });
    return ok({ cols: [], rows: [], affected_row_count: 1 });
  }
  if (/UPDATE conversations\s+SET profile_name/i.test(sql)) {
    const row = conversations.get(args[6]);
    if (row) {
      row.profile_name = args[0];
      row.source = args[1];
      row.source_locked = Number(args[2]) || 0;
      row.topic = args[3];
      row.last_at = args[4];
      row.message_count = Number(args[5]) || 0;
    }
    return ok({ cols: [], rows: [], affected_row_count: row ? 1 : 0 });
  }
  if (/UPDATE conversations SET outcome/i.test(sql)) {
    const row = conversations.get(args[1]);
    if (row) row.outcome = args[0];
    return ok({ cols: [], rows: [] });
  }
  if (/UPDATE conversations SET topic/i.test(sql)) {
    const row = conversations.get(args[1]);
    if (row) row.topic = args[0];
    return ok({ cols: [], rows: [] });
  }
  if (/INSERT INTO conversation_messages/i.test(sql)) {
    messages.push({
      id: nextMessageId++,
      phone: args[0],
      direction: args[1],
      body: args[2],
      msg_type: args[3],
      topic: args[4],
      profile_name: args[5],
      at: args[6],
    });
    return ok({ cols: [], rows: [] });
  }
  if (/SELECT \* FROM conversations WHERE phone = \?/i.test(sql)) {
    const row = conversations.get(args[0]);
    return table(CONV_COLS, row ? [row] : []);
  }
  if (/SELECT \* FROM conversations WHERE phone IN/i.test(sql)) {
    return table(
      CONV_COLS,
      args.map((phone) => conversations.get(phone)).filter(Boolean)
    );
  }
  if (/FROM conversation_messages\s+WHERE at >=/i.test(sql)) {
    const rows = messages
      .filter((message) => message.at >= args[0] && message.at <= args[1])
      .sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.id - b.id))
      .slice(0, args[2]);
    return table(['phone', 'direction', 'at', 'topic'], rows);
  }
  if (/FROM conversation_messages\s+WHERE phone = \?/i.test(sql)) {
    const rows = messages
      .filter((message) => message.phone === args[0])
      .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : b.id - a.id))
      .slice(0, args[1]);
    return table(['id', 'direction', 'body', 'msg_type', 'topic', 'profile_name', 'at'], rows);
  }
  if (/FROM sessions/i.test(sql)) return table(['step', 'data'], []);
  throw new Error(`SQL no esperada: ${sql}`);
};

const db = require('../src/db');
const log = require('../src/conversationLog');
const { createApp, processWebhook, renderAdminPage } = require('../src/server-meta');

describe('origen y tema de la conversación', () => {
  const portals = [
    ['Bodas.net', 'bodas_net'],
    ['Bodalia', 'bodalia'],
    ['Loggiata', 'loggiata'],
    ['TodoBoda', 'todoboda'],
    ['Web', 'web'],
    ['Instagram', 'instagram'],
    ['Email', 'email'],
  ];

  for (const [label, id] of portals) {
    it(`el wa.me de ${label} queda como ${id}`, () => {
      assert.equal(log.sourceTag(`Quiero información para mi boda (${label})`), id);
      assert.equal(log.sourceTag(`  QUIERO   información para mi boda ( ${label} ) .`), id);
    });
  }

  it('el enlace de boda sin portal es directo, y un portal desconocido no cuenta', () => {
    assert.equal(log.sourceTag('Quiero información para mi boda'), 'directo');
    assert.equal(log.sourceTag('quiero informacion para mi boda.'), 'directo');
    assert.equal(log.sourceTag('Quiero información para mi boda (Facebook)'), null);
    assert.equal(log.sourceTag('quiero una boda'), null);
    assert.equal(log.sourceTag('hola'), null);
  });

  it('reconoce la comida de Navidad de empresa y los menús de wa.me', () => {
    assert.equal(log.sourceTag(log.EMPRESA_TRIGGER), 'navidad_empresa');
    assert.equal(log.sourceTag('Quiero reservar el menú de Navidad (25 de diciembre)'), 'menu_navidad');
    assert.equal(log.sourceTag('Quiero reservar el menú de Nochevieja (31 de diciembre)'), 'menu_nochevieja');
    assert.equal(log.sourceTag('Quiero reservar el menú de Año Nuevo (1 de enero)'), 'menu_anonuevo');
    assert.equal(log.sourceLabel('navidad_empresa'), 'Comida de Navidad de empresa');
    assert.equal(log.sourceLabel('bodas_net'), 'Bodas.net');
  });

  it('detecta el tema sin cambiar el flujo en el que ya está el cliente', () => {
    assert.equal(log.detectTopic({ text: 'Quiero información para mi boda (Bodas.net)' }), 'boda');
    assert.equal(log.detectTopic({ text: log.EMPRESA_TRIGGER }), 'navidad_empresa');
    assert.equal(log.detectTopic({ text: 'quiero una mesa' }), 'restaurante');
    assert.equal(log.detectTopic({ text: 'quiero una habitación' }), 'hotel');
    assert.equal(log.detectTopic({ text: 'congreso de 300 personas' }), 'congreso');
    assert.equal(log.detectTopic({ text: '15/08', session: { step: 'HOTEL_ENTRADA', data: { type: 'hotel' } } }), 'hotel');
    assert.equal(
      log.detectTopic({ text: 'alojamiento', session: { step: 'GRUPO', data: { flow: 'boda' } } }),
      'boda'
    );
    assert.equal(log.detectTopic({ text: 'hola', session: { step: 'GRUPO', data: { flow: 'boda' } } }), 'menu');
    assert.equal(log.detectTopic({ text: 'hola', phone: '34699999999' }), 'admin');
    assert.equal(log.nextTopic('boda', 'menu'), 'boda');
    assert.equal(log.nextTopic('hotel', 'boda'), 'boda');
  });

  it('el texto de salida incluye los botones y no el cuerpo de una plantilla vacía', () => {
    const text = log.outboundText({
      type: 'interactive',
      interactive: {
        type: 'button',
        body: { text: '¿Qué te apetece?' },
        action: { buttons: [{ reply: { id: 'exp_rest', title: 'Restaurante' } }] },
      },
    });
    assert.match(text, /¿Qué te apetece\?/);
    assert.match(text, /Restaurante/);
    assert.equal(log.outboundText({ type: 'template', template: { name: 'aviso_solicitud_presupuesto' } }), 'Plantilla aviso_solicitud_presupuesto');
  });
});

describe('resúmenes por fecha de Madrid', () => {
  const range = { from: '2026-11-14', to: '2026-11-15', zone: 'Europe/Madrid' };
  const messages = [
    { phone: '34600000001', direction: 'in', at: '2026-11-14T22:30:00.000Z', topic: 'boda' },
    { phone: '34600000001', direction: 'out', at: '2026-11-14T23:30:00.000Z', topic: 'boda' },
    { phone: '34600000002', direction: 'in', at: '2026-11-14T10:00:00.000Z', topic: 'general' },
  ];
  const stored = [
    { phone: '34600000001', profile_name: 'Ana', source: 'bodas_net', topic: 'boda', outcome: 'solicitud' },
    { phone: '34600000002', profile_name: null, source: null, topic: 'general', outcome: 'abierta' },
  ];

  it('agrupa el día siguiente cuando en Madrid ya es medianoche', () => {
    const stats = log.shapeStats(messages, stored, range);
    assert.equal(stats.timezone, 'Europe/Madrid');
    assert.equal(stats.totals.conversations, 2);
    assert.equal(stats.totals.messages, 3);
    assert.equal(stats.totals.inbound, 2);
    assert.equal(stats.totals.outbound, 1);
    assert.deepEqual(
      stats.byDay.map((day) => [day.day, day.conversations, day.messages]),
      [
        ['2026-11-14', 2, 2],
        ['2026-11-15', 1, 1],
      ]
    );
    assert.deepEqual(stats.byTopic, [
      { topic: 'boda', conversations: 1 },
      { topic: 'general', conversations: 1 },
    ]);
    assert.equal(stats.bySource.find((row) => row.source === 'bodas_net').label, 'Bodas.net');
    assert.equal(stats.bySource.find((row) => row.source === null).conversations, 1);
    assert.deepEqual(stats.byOutcome, [
      { outcome: 'abierta', conversations: 1 },
      { outcome: 'solicitud', conversations: 1 },
    ]);
  });

  it('el listado resume cada chat del intervalo', () => {
    const list = log.shapeList(messages, stored, range);
    assert.equal(list.conversations.length, 2);
    assert.equal(list.conversations[0].phone, '34600000001');
    assert.equal(list.conversations[0].messageCount, 2);
    assert.equal(list.conversations[0].source, 'bodas_net');
    assert.equal(list.conversations[0].outcome, 'solicitud');
    assert.equal(list.conversations[0].profileName, 'Ana');
    assert.equal(list.conversations[1].messageCount, 1);
    assert.equal(list.conversations[1].source, null);
  });

  it('rechaza un intervalo a medias o invertido', () => {
    assert.throws(() => log.resolveRange('2026-11-01', ''), /from y to/);
    assert.throws(() => log.resolveRange('2026-11-16', '2026-11-01'), /from y to/);
    Settings.now = () => new Date('2026-11-16T12:00:00Z').getTime();
    const open = log.resolveRange('', '');
    assert.equal(open.to, '2026-11-16');
    assert.equal(open.from, '2026-10-18');
    assert.equal(open.zone, 'Europe/Madrid');
  });
});

describe('persistencia y rutas de administración', () => {
  let server;
  let port;

  before(async () => {
    await db.ready;
    const app = createApp(async () => {});
    server = app.listen(0);
    await once(server, 'listening');
    port = server.address().port;
  });

  after(() => {
    if (server) server.close();
  });

  async function get(path, key) {
    const headers = key ? { 'x-admin-key': key } : {};
    const response = await fetch(`http://127.0.0.1:${port}${path}`, { headers });
    const body = await response.json();
    return { status: response.status, body };
  }

  it('guarda entrada, origen, perfil y no pisa el origen después', async () => {
    await log.recordInbound({
      phone: '+34 600 000 001',
      body: 'Quiero información para mi boda (Bodas.net)',
      msgType: 'text',
      profileName: 'Ana y Luis',
      at: '2026-11-14T22:30:00.000Z',
    });
    await log.recordOutbound({
      phone: '34600000001',
      body: 'Os mando unas fotos',
      msgType: 'text',
      at: '2026-11-14T22:31:00.000Z',
    });
    await log.recordInbound({
      phone: '34600000001',
      body: 'hola',
      msgType: 'text',
      at: '2026-11-14T23:40:00.000Z',
    });
    await db.markConversationOutcome('34600000001', 'solicitud');
    await db.markConversationOutcome('34600000001', 'escalacion');

    const row = await db.getConversation('34600000001');
    assert.equal(row.source, 'bodas_net');
    assert.equal(row.source_locked, 1);
    assert.equal(row.topic, 'boda');
    assert.equal(row.outcome, 'solicitud');
    assert.equal(row.profile_name, 'Ana y Luis');
    assert.equal(row.message_count, 3);

    const transcript = await log.transcriptForAdmin('0034 600 000 001');
    assert.equal(transcript.messages.length, 3);
    assert.deepEqual(
      transcript.messages.map((message) => message.direction),
      ['in', 'out', 'in']
    );
    assert.equal(transcript.messages[0].text, 'Quiero información para mi boda (Bodas.net)');
    assert.equal(transcript.messages[0].topic, 'boda');
    assert.equal(transcript.messages[1].text, 'Os mando unas fotos');
    assert.equal(transcript.messages[2].topic, 'menu');
    assert.equal(transcript.outcome, 'solicitud');
    assert.equal(transcript.sourceLabel, 'Bodas.net');
  });

  it('una escalación no tapa una solicitud, y al revés sí la sustituye', async () => {
    await log.recordInbound({
      phone: '34600000009',
      body: 'quiero una habitación',
      msgType: 'text',
      at: '2026-11-14T10:00:00.000Z',
    });
    await db.markConversationOutcome('34600000009', 'escalacion');
    await db.markConversationOutcome('34600000009', 'solicitud');
    const row = await db.getConversation('34600000009');
    assert.equal(row.topic, 'hotel');
    assert.equal(row.outcome, 'solicitud');
    assert.equal(row.source, null);
  });

  it('las rutas exigen la clave y devuelven el intervalo', async () => {
    const denied = await get('/admin/conversations?from=2026-11-14&to=2026-11-15');
    assert.equal(denied.status, 403);
    assert.equal(denied.body.ok, false);

    const list = await get('/admin/conversations?from=2026-11-14&to=2026-11-15&key=test-key');
    assert.equal(list.status, 200);
    assert.equal(list.body.ok, true);
    assert.equal(list.body.conversations.length, 2);
    assert.equal(list.body.conversations[0].source, 'bodas_net');

    const stats = await get('/admin/conversation-stats?from=2026-11-14&to=2026-11-15', 'test-key');
    assert.equal(stats.status, 200);
    assert.equal(stats.body.totals.conversations, 2);
    assert.ok(stats.body.byDay.some((day) => day.day === '2026-11-15'));

    const one = await get('/admin/conversations/34600000001', 'test-key');
    assert.equal(one.status, 200);
    assert.equal(one.body.messages.length, 3);
    assert.equal(one.body.profileName, 'Ana y Luis');

    const bad = await get('/admin/conversation-stats?from=ayer&to=2026-11-15', 'test-key');
    assert.equal(bad.status, 400);
    const phone = await get('/admin/conversations/no-es-un-telefono', 'test-key');
    assert.equal(phone.status, 400);
  });

  it('si guardar el mensaje falla, el cliente sigue recibiendo la respuesta', async () => {
    const replies = [];
    await processWebhook(
      {
        entry: [
          {
            changes: [
              {
                value: {
                  contacts: [{ wa_id: '34622222222', profile: { name: 'Lucía' } }],
                  messages: [
                    {
                      from: '34622222222',
                      id: 'wamid.in',
                      timestamp: '1763161800',
                      type: 'text',
                      text: { body: 'quiero una mesa' },
                    },
                  ],
                },
              },
            ],
          },
        ],
      },
      {
        onMessage: async (from, text, buttonId) => {
          replies.push({ from, text, buttonId });
        },
        markRead: async () => {},
        recordInbound: async () => {
          throw new Error('turso caído');
        },
        syncConversation: async () => {
          throw new Error('turso caído');
        },
      }
    );
    assert.deepEqual(replies, [{ from: '34622222222', text: 'quiero una mesa', buttonId: null }]);
  });

  it('el panel solo enlaza el historial, no lo publica', () => {
    const html = renderAdminPage({
      businessName: 'Hostería Don Fadrique',
      confirmed: [],
      pending: [],
      adminKey: 'test-key',
    });
    assert.match(html, /href="\/admin\/conversations\?key=test-key"/);
    assert.doesNotMatch(html, /34600000001/);
  });
});

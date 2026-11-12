const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { DateTime } = require('luxon');

process.env.ADMIN_KEY = 'test-key';
process.env.TURSO_DATABASE_URL = 'libsql://example.turso.io';
process.env.TURSO_AUTH_TOKEN = 'test-token';
process.env.VERIFY_TOKEN = process.env.VERIFY_TOKEN || 'verify-test';

const axios = require('axios');

const stored = [];
let nextId = 1;
const pipelineCalls = [];

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
  return pipelineOk({ cols: [], rows: [] });
}

const STATUS_COLS = ['id', 'wamid', 'recipient', 'status', 'error_code', 'error_title', 'error_detail', 'ts'];

function listStatuses(sql, args) {
  let list = stored.slice();
  let index = 0;
  if (sql.includes('wamid = ?')) {
    const wamid = args[index++];
    list = list.filter((row) => row.wamid === wamid);
  }
  if (sql.includes('recipient = ?')) {
    const recipient = args[index++];
    list = list.filter((row) => row.recipient === recipient);
  }
  const limit = Number(args[index]);
  list.sort((a, b) => b.id - a.id);
  list = list.slice(0, Number.isFinite(limit) ? limit : list.length);
  return pipelineOk({
    cols: STATUS_COLS.map((name) => ({ name })),
    rows: list.map((row) => STATUS_COLS.map((name) => cell(row[name]))),
  });
}

axios.post = async (url, body) => {
  const stmt = body?.requests?.[0]?.stmt;
  const sql = stmt?.sql || '';
  const args = (stmt?.args || []).map(argToJs);
  pipelineCalls.push({ url, sql, args });
  if (/^\s*(CREATE|ALTER)\b/i.test(sql)) return emptyResult();
  if (/INSERT INTO message_status/i.test(sql)) {
    const row = {
      id: nextId++,
      wamid: args[0],
      recipient: args[1],
      status: args[2],
      error_code: args[3],
      error_title: args[4],
      error_detail: args[5],
      ts: args[6],
    };
    stored.push(row);
    return pipelineOk({ cols: [], rows: [], last_insert_rowid: row.id, affected_row_count: 1 });
  }
  if (/FROM message_status/i.test(sql)) return listStatuses(sql, args);
  if (/FROM reservations/i.test(sql)) return emptyResult();
  const error = new Error(`SQL no esperada en el mock de Turso: ${sql}`);
  throw error;
};

const db = require('../src/db');
const { createApp, processWebhook, renderAdminPage, statusRecord } = require('../src/server-meta');

function statusPayload(statuses, extraValue = {}) {
  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: 'waba',
        changes: [
          {
            field: 'messages',
            value: {
              messaging_product: 'whatsapp',
              metadata: { phone_number_id: '1' },
              contacts: [{ wa_id: '34635401007' }],
              ...extraValue,
              statuses,
            },
          },
        ],
      },
    ],
  };
}

function failedStatus(overrides = {}) {
  return {
    id: 'wamid.fail',
    status: 'failed',
    timestamp: '1710000000',
    recipient_id: '34635401007',
    errors: [
      {
        code: 131042,
        title: 'Business eligibility payment issue',
        message: 'Business eligibility payment issue',
        error_data: {
          details: 'Message failed to send because there were one or more errors related to your payment method.',
        },
      },
    ],
    ...overrides,
  };
}

async function waitUntil(fn, timeoutMs = 1000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (fn()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('timeout esperando el webhook');
}

function captureLogs(run) {
  const logs = [];
  const errors = [];
  const originalLog = console.log;
  const originalError = console.error;
  console.log = (...args) => {
    logs.push(args.map((part) => (typeof part === 'string' ? part : JSON.stringify(part))).join(' '));
  };
  console.error = (...args) => {
    errors.push(args.map(String).join(' '));
  };
  return Promise.resolve()
    .then(run)
    .finally(() => {
      console.log = originalLog;
      console.error = originalError;
    })
    .then(() => ({ logs, errors }));
}

describe('estados de entrega de Meta', { concurrency: 1 }, () => {
  before(async () => {
    await db.ready;
  });

  it('crea message_status al arrancar Turso', () => {
    const create = pipelineCalls.find((call) => /CREATE TABLE IF NOT EXISTS message_status/i.test(call.sql));
    assert.ok(create, 'falta CREATE TABLE message_status');
    for (const column of ['wamid', 'recipient', 'status', 'error_code', 'error_title', 'error_detail', 'ts']) {
      assert.match(create.sql, new RegExp(`\\b${column}\\b`));
    }
    assert.match(create.url, /^https:\/\/example\.turso\.io\/v2\/pipeline$/);
  });

  it('guarda el fallo y lo lista por wamid o teléfono, los últimos primero', async () => {
    stored.length = 0;
    nextId = 1;
    await db.saveMessageStatus(
      statusRecord(
        failedStatus({
          recipient_id: '+34 635 401 007',
        })
      )
    );
    await db.saveMessageStatus(
      statusRecord({
        id: 'wamid.sent',
        status: 'sent',
        timestamp: '1710000001',
        recipient_id: '34635401007',
      })
    );
    await db.saveMessageStatus(
      statusRecord({
        id: 'wamid.other',
        status: 'delivered',
        timestamp: '1710000002',
        recipient_id: '34600000000',
      })
    );

    const insert = pipelineCalls.filter((call) => /INSERT INTO message_status/i.test(call.sql)).at(-3);
    assert.match(
      insert.sql,
      /INSERT INTO message_status \(wamid, recipient, status, error_code, error_title, error_detail, ts\)/
    );
    assert.deepEqual(insert.args, [
      'wamid.fail',
      '34635401007',
      'failed',
      '131042',
      'Business eligibility payment issue',
      'Message failed to send because there were one or more errors related to your payment method.',
      '1710000000',
    ]);

    const latest = await db.listMessageStatuses();
    assert.deepEqual(
      latest.map((row) => row.wamid),
      ['wamid.other', 'wamid.sent', 'wamid.fail']
    );
    assert.equal(latest[2].error_code, '131042');
    assert.equal(latest[1].error_code, null);
    assert.equal(latest[1].error_detail, null);

    const byPhone = await db.listMessageStatuses({ phone: '0034 635-401-007', limit: 1000 });
    assert.deepEqual(
      byPhone.map((row) => row.status),
      ['sent', 'failed']
    );
    const phoneCall = pipelineCalls.filter((call) => /FROM message_status/i.test(call.sql)).at(-1);
    assert.match(phoneCall.sql, /ORDER BY id DESC/);
    assert.match(phoneCall.sql, /LIMIT \?/);
    assert.equal(phoneCall.args.at(-1), 50);
    assert.equal(phoneCall.args[0], '34635401007');

    const byWamid = await db.listMessageStatuses({ wamid: ' wamid.fail ', phone: '34635401007' });
    assert.equal(byWamid.length, 1);
    assert.equal(byWamid[0].status, 'failed');
    assert.equal(byWamid[0].recipient, '34635401007');
  });

  it('recorta la lista a 50 aunque se pidan más', async () => {
    stored.length = 0;
    nextId = 1;
    for (let i = 0; i < 55; i += 1) {
      stored.push({
        id: nextId++,
        wamid: `wamid.${i}`,
        recipient: '34600000000',
        status: 'sent',
        error_code: null,
        error_title: null,
        error_detail: null,
        ts: String(1700000000 + i),
      });
    }
    const rows = await db.listMessageStatuses({ limit: 80 });
    assert.equal(rows.length, 50);
    assert.equal(rows[0].wamid, 'wamid.54');
    assert.equal(rows.at(-1).wamid, 'wamid.5');
  });

  it('traduce códigos 131042, 131049 y 131026 y no llama a la conversación', async () => {
    const saved = [];
    const replies = [];
    const body = {
      entry: [
        {
          changes: [
            {
              value: {
                contacts: [{ wa_id: '34635401007' }],
                messages: [],
                statuses: [
                  failedStatus(),
                  {
                    id: 'wamid.limit',
                    status: 'failed',
                    timestamp: '1710000010',
                    recipient_id: '34635401007',
                    errors: [
                      {
                        code: 131049,
                        title: 'This message was not delivered to maintain healthy ecosystem engagement.',
                        message: 'This message was not delivered to maintain healthy ecosystem engagement.',
                        error_data: {
                          details: 'In order to maintain a healthy ecosystem engagement, the message failed to be delivered.',
                        },
                      },
                    ],
                  },
                ],
              },
            },
            {
              value: {
                statuses: [
                  {
                    id: 'wamid.undeliverable',
                    status: 'failed',
                    timestamp: '1710000020',
                    recipient_id: '34600000099',
                    errors: [
                      {
                        code: 131026,
                        title: 'Message undeliverable',
                        message: 'Message undeliverable',
                        error_data: { details: 'Message Undeliverable.' },
                      },
                    ],
                  },
                ],
              },
            },
          ],
        },
        {
          changes: [
            {
              value: {
                statuses: [
                  {
                    id: 'wamid.read',
                    status: 'read',
                    timestamp: '1710000030',
                    recipient_id: '34635401007',
                  },
                ],
              },
            },
          ],
        },
      ],
    };

    const { logs } = await captureLogs(() =>
      processWebhook(body, {
        onMessage: async () => {
          replies.push('reply');
        },
        saveMessageStatus: async (row) => {
          saved.push(row);
        },
        markRead: async () => {
          throw new Error('un status no se marca como leído');
        },
      })
    );

    assert.deepEqual(replies, []);
    assert.deepEqual(
      saved.map((row) => [row.wamid, row.status, row.error_code, row.recipient]),
      [
        ['wamid.fail', 'failed', '131042', '34635401007'],
        ['wamid.limit', 'failed', '131049', '34635401007'],
        ['wamid.undeliverable', 'failed', '131026', '34600000099'],
        ['wamid.read', 'read', null, '34635401007'],
      ]
    );
    assert.equal(
      saved[0].error_detail,
      'Message failed to send because there were one or more errors related to your payment method.'
    );
    assert.equal(
      saved[1].error_detail,
      'In order to maintain a healthy ecosystem engagement, the message failed to be delivered.'
    );
    assert.equal(saved[2].error_title, 'Message undeliverable');
    assert.equal(saved[2].error_detail, 'Message Undeliverable.');
    assert.equal(saved[0].ts, '1710000000');

    const statusLogs = logs.filter((line) => line.startsWith('[webhook] status '));
    assert.equal(statusLogs.length, 4);
    const parsed = statusLogs.map((line) => JSON.parse(line.slice('[webhook] status '.length)));
    assert.deepEqual(parsed[0], {
      id: 'wamid.fail',
      recipient_id: '34635401007',
      status: 'failed',
      timestamp: '1710000000',
      errors: [
        {
          code: 131042,
          title: 'Business eligibility payment issue',
          message: 'Business eligibility payment issue',
          error_data: {
            details:
              'Message failed to send because there were one or more errors related to your payment method.',
          },
        },
      ],
    });
    assert.equal(parsed[3].status, 'read');
    assert.deepEqual(parsed[3].errors, []);
    assert.equal(logs.some((line) => /ignorado/.test(line)), false);
  });

  it('si falta error_data usa el message y junta varios errores', () => {
    const row = statusRecord({
      id: 'wamid.multi',
      status: 'failed',
      timestamp: '1710000099',
      recipient_id: '34635401007',
      errors: [
        { code: 131000, title: 'Algo', message: 'solo el mensaje' },
        {
          code: 131026,
          title: 'Message undeliverable',
          message: 'Message undeliverable',
          error_data: { details: 'Message Undeliverable.' },
        },
      ],
    });
    assert.equal(row.error_code, '131000 | 131026');
    assert.equal(row.error_title, 'Algo | Message undeliverable');
    assert.equal(row.error_detail, 'solo el mensaje | Message Undeliverable.');
  });

  it('un fallo al guardar no corta el resto ni dispara una respuesta', async () => {
    const saved = [];
    const { errors } = await captureLogs(() =>
      processWebhook(statusPayload([failedStatus(), { id: 'wamid.next', status: 'sent', timestamp: '2', recipient_id: '34600000001' }]), {
        onMessage: async () => {
          throw new Error('no debería responder');
        },
        saveMessageStatus: async (row) => {
          if (row.wamid === 'wamid.fail') throw new Error('turso caído');
          saved.push(row.wamid);
        },
      })
    );
    assert.deepEqual(saved, ['wamid.next']);
    assert.match(errors.join('\n'), /turso caído/);
  });

  it('un mensaje entrante sigue respondiendo y un status en el mismo aviso no lo impide', async () => {
    const replies = [];
    let readId = null;
    const saved = [];
    const body = {
      entry: [
        {
          changes: [
            {
              value: {
                messages: [
                  {
                    from: '34611111111',
                    id: 'wamid.incoming',
                    type: 'button',
                    button: { text: 'Pedir presupuesto', payload: 'emp_book' },
                  },
                ],
                statuses: [failedStatus()],
              },
            },
          ],
        },
      ],
    };
    await processWebhook(body, {
      onMessage: async (from, text, buttonId, raw) => {
        replies.push({ from, text, buttonId, type: raw.type });
      },
      saveMessageStatus: async (row) => {
        saved.push(row.wamid);
      },
      markRead: async (id) => {
        readId = id;
      },
    });
    assert.deepEqual(saved, ['wamid.fail']);
    assert.deepEqual(replies, [
      { from: '34611111111', text: 'Pedir presupuesto', buttonId: 'emp_book', type: 'button' },
    ]);
    assert.equal(readId, 'wamid.incoming');
  });

  it('si marcar como leído falla, el mensaje igual se responde', async () => {
    const replies = [];
    await processWebhook(
      {
        entry: [
          {
            changes: [
              {
                value: {
                  messages: [
                    { from: '34600000000', id: 'wamid.in', type: 'text', text: { body: 'hola' } },
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
        markRead: async () => {
          throw new Error('meta down');
        },
      }
    );
    assert.deepEqual(replies, [{ from: '34600000000', text: 'hola', buttonId: null }]);
  });

  it('un aviso vacío no responde', async () => {
    let called = false;
    const { logs } = await captureLogs(() =>
      processWebhook(
        {},
        {
          onMessage: async () => {
            called = true;
          },
          saveMessageStatus: async () => {
            called = true;
          },
        }
      )
    );
    assert.equal(called, false);
    assert.equal(logs.some((line) => /Sin campo messages/.test(line)), true);
  });

  it('el panel marca en rojo los fallos y escapa el texto de Meta', () => {
    const when = DateTime.fromSeconds(1710000000, { zone: 'Europe/Madrid' }).toFormat('dd/MM/yyyy HH:mm');
    const html = renderAdminPage({
      businessName: 'Hostería',
      confirmed: [],
      pending: [],
      statuses: [
        {
          wamid: 'wamid.<script>',
          recipient: '34635401007',
          status: 'failed',
          error_code: '131042',
          error_title: '<img src=x onerror=alert(1)>',
          error_detail: 'pago',
          ts: '1710000000',
        },
        {
          wamid: 'wamid.ok',
          recipient: '34600000000',
          status: 'delivered',
          error_code: null,
          error_title: null,
          error_detail: null,
          ts: '1710000001',
        },
      ],
    });
    assert.match(html, /Últimos estados de envío/);
    assert.match(html, /131042 \(pago\)/);
    assert.match(html, /131049 \(límite de marketing\)/);
    assert.match(html, /131026 \(no entregable\)/);
    assert.match(html, new RegExp(when.replace(/\//g, '\\/')));
    const rows = html.split('<tr').slice(1);
    const failed = rows.find((row) => row.includes('wamid.&lt;script&gt;'));
    const delivered = rows.find((row) => row.includes('wamid.ok'));
    assert.ok(failed);
    assert.match(failed, /^ class="alert-failed"/);
    assert.match(failed, /fallido \(failed\)/);
    assert.match(failed, /131042/);
    assert.match(failed, /wa\.me\/34635401007/);
    assert.match(failed, /&lt;img src=x onerror=alert\(1\)&gt;/);
    assert.ok(delivered);
    assert.doesNotMatch(delivered, /alert-failed/);
    assert.match(delivered, /entregado \(delivered\)/);
    assert.doesNotMatch(html, /<script>/);
    assert.doesNotMatch(html, /<img/);

    const empty = renderAdminPage({ businessName: 'Hostería', confirmed: [], pending: [], statuses: [] });
    assert.match(empty, /Sin estados de envío/);
  });

  describe('HTTP', () => {
    let server;
    let port;
    const replies = [];

    before(async () => {
      stored.length = 0;
      nextId = 1;
      const app = createApp(
        async (from, text, buttonId) => {
          replies.push({ from, text, buttonId });
        },
        { markRead: async () => {} }
      );
      server = app.listen(0, '127.0.0.1');
      await once(server, 'listening');
      port = server.address().port;
    });

    after(async () => {
      server.close();
      await once(server, 'close');
    });

    async function postWebhook(body) {
      const response = await fetch(`http://127.0.0.1:${port}/webhook`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      return { status: response.status, text: await response.text() };
    }

    it('POST /webhook con statuses devuelve 200, persiste y no responde al chat', async () => {
      replies.length = 0;
      const before = stored.length;
      const response = await postWebhook(
        statusPayload([
          failedStatus(),
          {
            id: 'wamid.sent',
            status: 'sent',
            timestamp: '1710000001',
            recipient_id: '34635401007',
          },
        ])
      );
      assert.equal(response.status, 200);
      assert.equal(response.text, 'OK');
      await waitUntil(() => stored.length === before + 2);
      assert.equal(replies.length, 0);
      assert.equal(stored.at(-2).error_code, '131042');
      assert.equal(stored.at(-1).status, 'sent');
      assert.equal(stored.at(-1).error_code, null);
    });

    it('POST /webhook con un mensaje sigue respondiendo', async () => {
      replies.length = 0;
      const before = stored.length;
      const response = await postWebhook({
        entry: [
          {
            changes: [
              {
                value: {
                  messages: [
                    { from: '34622222222', id: 'wamid.in', type: 'text', text: { body: 'hola' } },
                  ],
                },
              },
            ],
          },
        ],
      });
      assert.equal(response.status, 200);
      await waitUntil(() => replies.length === 1);
      assert.deepEqual(replies, [{ from: '34622222222', text: 'hola', buttonId: null }]);
      assert.equal(stored.length, before);
    });

    it('GET /admin/message-status exige la clave y filtra por wamid o teléfono', async () => {
      const denied = await fetch(`http://127.0.0.1:${port}/admin/message-status`);
      assert.equal(denied.status, 403);
      const deniedJson = await denied.json();
      assert.equal(deniedJson.ok, false);

      const wrong = await fetch(`http://127.0.0.1:${port}/admin/message-status`, {
        headers: { 'x-admin-key': 'no-vale' },
      });
      assert.equal(wrong.status, 403);

      const byPhone = await fetch(
        `http://127.0.0.1:${port}/admin/message-status?key=test-key&phone=${encodeURIComponent('0034 635 401 007')}`
      );
      assert.equal(byPhone.status, 200);
      const phoneJson = await byPhone.json();
      assert.equal(phoneJson.ok, true);
      assert.deepEqual(
        phoneJson.statuses.map((row) => row.status),
        ['sent', 'failed']
      );
      assert.equal(phoneJson.statuses[0].error_code, null);
      assert.equal(phoneJson.statuses[1].error_code, '131042');

      const byHeader = await fetch(
        `http://127.0.0.1:${port}/admin/message-status?wamid=${encodeURIComponent('wamid.fail')}`,
        { headers: { 'x-admin-key': 'test-key' } }
      );
      assert.equal(byHeader.status, 200);
      const headerJson = await byHeader.json();
      assert.equal(headerJson.statuses.length, 1);
      assert.equal(headerJson.statuses[0].wamid, 'wamid.fail');
      assert.equal(headerJson.statuses[0].recipient, '34635401007');

      const nonsense = await fetch(`http://127.0.0.1:${port}/admin/message-status?key=test-key&phone=abc`);
      assert.equal(nonsense.status, 200);
      const nonsenseJson = await nonsense.json();
      assert.deepEqual(nonsenseJson.statuses, []);
    });

    it('GET /admin muestra los fallos de envío en rojo', async () => {
      const denied = await fetch(`http://127.0.0.1:${port}/admin`);
      assert.equal(denied.status, 403);

      const response = await fetch(`http://127.0.0.1:${port}/admin?key=test-key`);
      assert.equal(response.status, 200);
      const html = await response.text();
      assert.match(html, /Últimos estados de envío/);
      assert.match(html, /<tr class="alert-failed">[\s\S]*?wamid\.fail[\s\S]*?<\/tr>/);
      assert.match(html, /131042/);
      assert.match(html, /fallido \(failed\)/);
      const delivered = html.match(/<tr><td>[\s\S]*?wamid\.sent[\s\S]*?<\/tr>/);
      assert.ok(delivered);
      assert.doesNotMatch(delivered[0], /alert-failed/);
    });
  });
});

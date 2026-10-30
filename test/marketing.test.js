const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { once } = require('node:events');
const { spawnSync } = require('node:child_process');

process.env.ADMIN_KEY = 'test-key';
process.env.TURSO_DATABASE_URL = process.env.TURSO_DATABASE_URL || 'libsql://example.turso.io';
process.env.TURSO_AUTH_TOKEN = process.env.TURSO_AUTH_TOKEN || 'test';

const { buildTemplatePayload } = require('../src/whatsapp');
const marketing = require('../src/marketing');
const { createApp, extractText, extractButtonId } = require('../src/server-meta');

const root = path.join(__dirname, '..');

function readMarketing(overrides = {}) {
  const env = { ...process.env };
  for (const key of [
    'MARKETING_TEMPLATE_NAME',
    'MARKETING_TEMPLATE_LANG',
    'MARKETING_TEMPLATE_HEADER_MEDIA_ID',
    'MARKETING_TEMPLATE_HEADER_IMAGE_URL',
    'HEADER_IMAGE_URL',
  ]) {
    delete env[key];
  }
  Object.assign(env, overrides);
  const result = spawnSync(
    process.execPath,
    ['-e', "process.stdout.write(JSON.stringify(require('./src/config').marketing))"],
    { cwd: root, env, encoding: 'utf8' }
  );
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

function metaError(message, code) {
  const err = new Error('Request failed with status code 400');
  err.response = {
    data: { error: { message, code, error_subcode: 2494073, fbtrace_id: 'trace-1' } },
  };
  return err;
}

function campaignTemplate(extra = {}) {
  return marketing.templateOptions({
    marketing: {
      templateName: 'comida_navidad_empresas_2026',
      templateLang: 'es',
      headerMediaId: null,
      headerImageUrl: null,
      ...extra,
    },
  });
}

describe('payload de la plantilla', () => {
  it('arma messaging_product, nombre, idioma, imagen por enlace y payloads de botón', () => {
    const payload = buildTemplatePayload(
      '34600000000',
      campaignTemplate({ headerImageUrl: 'https://example.com/navidad.jpg' })
    );
    assert.deepEqual(payload, {
      messaging_product: 'whatsapp',
      to: '34600000000',
      type: 'template',
      template: {
        name: 'comida_navidad_empresas_2026',
        language: { code: 'es' },
        components: [
          {
            type: 'header',
            parameters: [{ type: 'image', image: { link: 'https://example.com/navidad.jpg' } }],
          },
          {
            type: 'button',
            sub_type: 'quick_reply',
            index: '0',
            parameters: [{ type: 'payload', payload: 'emp_book' }],
          },
          {
            type: 'button',
            sub_type: 'quick_reply',
            index: '1',
            parameters: [{ type: 'payload', payload: 'mkt_optout' }],
          },
        ],
      },
    });
  });

  it('si hay media id, la cabecera usa id y no el enlace', () => {
    const payload = buildTemplatePayload(
      '34600000000',
      campaignTemplate({
        headerMediaId: '999',
        headerImageUrl: 'https://example.com/navidad.jpg',
      })
    );
    assert.deepEqual(payload.template.components[0], {
      type: 'header',
      parameters: [{ type: 'image', image: { id: '999' } }],
    });
  });

  it('sin cabecera no manda componente header', () => {
    const payload = buildTemplatePayload('34600000000', {
      name: 'comida_navidad_empresas_2026',
      language: 'es',
    });
    assert.equal(payload.template.components, undefined);
    assert.equal(payload.template.name, 'comida_navidad_empresas_2026');
    assert.deepEqual(payload.template.language, { code: 'es' });
  });
});

describe('config de la plantilla', () => {
  it('usa el nombre y el idioma por defecto', () => {
    const marketingConfig = readMarketing();
    assert.equal(marketingConfig.templateName, 'comida_navidad_empresas_2026');
    assert.equal(marketingConfig.templateLang, 'es');
    assert.equal(marketingConfig.headerMediaId, null);
    assert.equal(marketingConfig.headerImageUrl, null);
  });

  it('acepta el media id y HEADER_IMAGE_URL', () => {
    const withMedia = readMarketing({ MARKETING_TEMPLATE_HEADER_MEDIA_ID: ' 555 ' });
    assert.equal(withMedia.headerMediaId, '555');
    const withUrl = readMarketing({ HEADER_IMAGE_URL: ' https://cdn.example/a.jpg ' });
    assert.equal(withUrl.headerImageUrl, 'https://cdn.example/a.jpg');
    const namespaced = readMarketing({
      MARKETING_TEMPLATE_HEADER_IMAGE_URL: 'https://cdn.example/b.jpg',
      HEADER_IMAGE_URL: 'https://cdn.example/a.jpg',
    });
    assert.equal(namespaced.headerImageUrl, 'https://cdn.example/b.jpg');
  });
});

describe('envío manual', () => {
  const template = campaignTemplate({ headerImageUrl: 'https://example.com/navidad.jpg' });

  it('manda de uno en uno, con pausa, y devuelve el id', async () => {
    const sent = [];
    const sleeps = [];
    const result = await marketing.sendCampaign(
      { phones: ['+34 600 000 001', '0034600000002'] },
      {
        template,
        delayMs: 1000,
        sleep: async (ms) => sleeps.push(ms),
        isOptedOut: async () => false,
        sendOne: async (phone, options) => {
          sent.push({ phone, options });
          return { messages: [{ id: `wamid.${phone}` }] };
        },
      }
    );
    assert.equal(result.status, 200);
    assert.equal(result.body.ok, true);
    assert.equal(result.body.header, 'link');
    assert.deepEqual(
      sent.map((item) => item.phone),
      ['34600000001', '34600000002']
    );
    assert.equal(sent[0].options.buttons[0].payload, 'emp_book');
    assert.equal(sent[0].options.buttons[1].payload, 'mkt_optout');
    assert.deepEqual(sleeps, [1000]);
    assert.deepEqual(
      result.body.results.map((item) => item.id),
      ['wamid.34600000001', 'wamid.34600000002']
    );
  });

  it('no manda a quien pidió la baja y sigue con el resto', async () => {
    const sent = [];
    const result = await marketing.sendCampaign(
      { phones: ['34600000001', '34600000002'] },
      {
        template,
        delayMs: 1000,
        sleep: async () => {
          throw new Error('no debería esperar si el primero se omite');
        },
        isOptedOut: async (phone) => phone === '34600000001',
        sendOne: async (phone) => {
          sent.push(phone);
          return { messages: [{ id: 'wamid.ok' }] };
        },
      }
    );
    assert.equal(result.status, 200);
    assert.equal(result.body.ok, false);
    assert.deepEqual(sent, ['34600000002']);
    assert.equal(result.body.results[0].skipped, true);
    assert.match(result.body.results[0].error, /opt-out/);
    assert.equal(result.body.results[1].ok, true);
  });

  it('devuelve el error de Meta (plantilla no aprobada) y no corta el lote', async () => {
    const sent = [];
    const result = await marketing.sendCampaign(
      { phone: '34600000009', phones: ['34600000010'] },
      {
        template,
        delayMs: 250,
        sleep: async () => {},
        isOptedOut: async () => false,
        sendOne: async (phone) => {
          sent.push(phone);
          if (phone === '34600000009') {
            throw metaError('Template is not approved', 132001);
          }
          return { messages: [{ id: 'wamid.ok' }] };
        },
      }
    );
    assert.deepEqual(sent, ['34600000009', '34600000010']);
    assert.equal(result.status, 207);
    assert.match(result.body.results[0].error, /not approved/);
    assert.match(result.body.results[0].error, /code 132001/);
    assert.match(result.body.results[0].error, /APPROVED/);
    assert.equal(result.body.results[1].ok, true);
  });

  it('rechaza una lista larga sin llamar a Meta', async () => {
    let calls = 0;
    const phones = Array.from({ length: marketing.MAX_BATCH + 1 }, (_, i) => `34600000${String(i).padStart(3, '0')}`);
    const result = await marketing.sendCampaign(
      { phones },
      {
        template,
        isOptedOut: async () => false,
        sendOne: async () => {
          calls += 1;
          return { messages: [{ id: 'wamid.x' }] };
        },
      }
    );
    assert.equal(calls, 0);
    assert.equal(result.status, 400);
    assert.match(result.body.error, /máximo 20/);
    assert.deepEqual(result.body.results, []);
  });

  it('si no se puede comprobar la baja, no envía', async () => {
    let calls = 0;
    const result = await marketing.sendCampaign(
      { phone: '34600000008' },
      {
        template,
        isOptedOut: async () => {
          throw new Error('turso caído');
        },
        sendOne: async () => {
          calls += 1;
          return { messages: [{ id: 'wamid.x' }] };
        },
      }
    );
    assert.equal(calls, 0);
    assert.equal(result.status, 502);
    assert.match(result.body.results[0].error, /opt-out/);
  });
});

describe('webhook de botones de plantilla', () => {
  it('lee el payload quick-reply que devuelve Meta', () => {
    const message = {
      type: 'button',
      button: { text: 'Pedir presupuesto', payload: 'emp_book' },
    };
    assert.equal(extractText(message), 'Pedir presupuesto');
    assert.equal(extractButtonId(message), 'emp_book');
  });

  it('si no hay payload propio, usa el texto del botón', () => {
    const message = {
      type: 'button',
      button: { text: 'No me interesa', payload: 'No me interesa' },
    };
    assert.equal(extractButtonId(message), 'No me interesa');
    assert.equal(marketing.routeButtonId(extractButtonId(message)), 'mkt_optout');
    assert.equal(marketing.routeButtonId('Pedir presupuesto'), 'emp_book');
  });
});

describe('POST /admin/marketing/send', { concurrency: 1 }, () => {
  let server;
  let port;
  const sent = [];

  before(async () => {
    process.env.ADMIN_KEY = 'test-key';
    const app = createApp(async () => {}, {
      delayMs: 0,
      isMarketingOptOut: async (phone) => phone === '34600000099',
      sendTemplate: async (phone, options) => {
        sent.push({ phone, options });
        if (phone === '34600000077') throw metaError('(#132001) Template name does not exist in the translation', 132001);
        return { messages: [{ id: `wamid.${phone}` }] };
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

  async function post(url, body, headers = {}) {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });
    const json = await response.json();
    return { status: response.status, json };
  }

  it('exige ADMIN_KEY y no envía si falta', async () => {
    const before = sent.length;
    const denied = await post(`http://127.0.0.1:${port}/admin/marketing/send`, { phone: '34600000001' });
    assert.equal(denied.status, 403);
    assert.equal(sent.length, before);
  });

  it('envía un número con la clave y devuelve el resultado por número', async () => {
    const ok = await post(
      `http://127.0.0.1:${port}/admin/marketing/send`,
      { phone: '34600000001' },
      { 'x-admin-key': 'test-key' }
    );
    assert.equal(ok.status, 200);
    assert.equal(ok.json.results[0].ok, true);
    assert.equal(ok.json.results[0].id, 'wamid.34600000001');
    assert.equal(sent.at(-1).options.buttons[0].payload, 'emp_book');

    const skipped = await post(
      `http://127.0.0.1:${port}/admin/marketing/send?key=test-key`,
      { phones: ['34600000099', '34600000077'] }
    );
    assert.equal(skipped.status, 207);
    assert.equal(skipped.json.results[0].skipped, true);
    assert.match(skipped.json.results[1].error, /132001/);
  });
});

describe('no se envía solo', () => {
  it('el arranque no llama a la plantilla ni define un cron', () => {
    const indexSrc = fs.readFileSync(path.join(root, 'src/index.js'), 'utf8');
    assert.doesNotMatch(indexSrc, /sendTemplate|sendCampaign|marketing/);
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    assert.equal(pkg.scripts.start, 'node src/index.js');
    assert.equal(pkg.scripts.cron, undefined);
  });
});

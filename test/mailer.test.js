const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

delete process.env.BREVO_API_KEY;
delete process.env.ALERT_EMAIL;
delete process.env.ALERT_EMAIL_FROM;
delete process.env.ALERT_EMAIL_FROM_NAME;

const { buildRequestEmail, sendRequestAlert, BREVO_URL } = require('../src/mailer');

function baseAlert(overrides = {}) {
  return {
    id: 22,
    kind: 'solicitud',
    type: 'evento_boda',
    name: 'Ana y Luis',
    company: '',
    phone: '34600000037',
    phoneContact: 'este WhatsApp',
    date: '2027-06-12',
    time: 'boda',
    partySize: 120,
    details: 'Pareja/contacto: Ana y Luis | Email: ana@example.com | Ceremonia: en la hostería',
    source: 'bodas_net',
    whatsappOk: false,
    whatsappSkipped: false,
    ...overrides,
  };
}

describe('correo de aviso a reservas', () => {
  it('redacta en español la solicitud, el origen y el fallo de WhatsApp', () => {
    const email = buildRequestEmail(baseAlert(), {
      adminUrl: 'https://whatsapp-reservas-bot.onrender.com/admin',
    });
    assert.match(email.subject, /Nueva solicitud #22 · Boda · Ana y Luis · WhatsApp no enviado/);
    assert.match(email.text, /Nueva solicitud en Hostería Don Fadrique/);
    assert.match(email.text, /Número: #22/);
    assert.match(email.text, /Tipo: Boda/);
    assert.match(email.text, /Nombre: Ana y Luis/);
    assert.match(email.text, /WhatsApp: 34600000037/);
    assert.match(email.text, /Fecha: sábado 12 de junio de 2027/);
    assert.match(email.text, /Servicio: boda/);
    assert.match(email.text, /Personas: 120/);
    assert.match(email.text, /Origen: Bodas\.net/);
    assert.match(email.text, /ana@example.com/);
    assert.match(email.text, /Ceremonia: en la hostería/);
    assert.match(email.text, /aviso por WhatsApp a Nico no se ha enviado/);
    assert.match(email.text, /131047/);
    assert.match(email.text, /https:\/\/whatsapp-reservas-bot\.onrender\.com\/admin/);
    assert.doesNotMatch(email.text, /Empresa:/);
    assert.doesNotMatch(email.text, /Teléfono de contacto/);
    assert.doesNotMatch(email.text, /[?&]key=/);
    assert.match(email.html, /Bodas\.net/);
    assert.match(email.html, /href="https:\/\/whatsapp-reservas-bot\.onrender\.com\/admin"/);
  });

  it('incluye empresa y teléfono de contacto, y dice si WhatsApp sí salió', () => {
    const email = buildRequestEmail(
      baseAlert({
        type: 'evento_empresa',
        name: 'Lucía Fernández',
        company: 'Talleres Alba SL',
        phoneContact: '923000000',
        date: '2026-12-01',
        time: '21:30',
        partySize: 30,
        source: null,
        whatsappOk: true,
        details: 'Menú a medida',
      })
    );
    assert.match(email.subject, /^Nueva solicitud #22 · Comida de Navidad de empresa · Talleres Alba SL$/);
    assert.doesNotMatch(email.subject, /WhatsApp no enviado/);
    assert.match(email.text, /Empresa: Talleres Alba SL/);
    assert.match(email.text, /Teléfono de contacto: 923000000/);
    assert.match(email.text, /Hora: 21:30/);
    assert.match(email.text, /Personas: 30/);
    assert.match(email.text, /aviso por WhatsApp a Nico también se ha enviado/);
    assert.doesNotMatch(email.text, /Origen:/);
    assert.doesNotMatch(email.text, /131047/);
  });

  it('saca la empresa de los detalles y no inventa un origen', () => {
    const email = buildRequestEmail(
      baseAlert({
        type: 'evento_congreso',
        company: null,
        source: '',
        partySize: null,
        details: 'Empresa: Clínica del Tormes | Tipo: congreso médico',
      })
    );
    assert.match(email.text, /Empresa: Clínica del Tormes/);
    assert.match(email.text, /Personas: sin indicar/);
    assert.match(email.subject, /Clínica del Tormes/);
    assert.doesNotMatch(email.text, /Origen:/);
  });

  it('escapa el HTML y no el texto', () => {
    const email = buildRequestEmail(baseAlert({ name: 'Ana <script>', details: 'nota <b>roja</b>' }));
    assert.match(email.html, /Ana &lt;script&gt;/);
    assert.match(email.html, /nota &lt;b&gt;roja&lt;\/b&gt;/);
    assert.doesNotMatch(email.html, /<script>/);
    assert.match(email.text, /Ana <script>/);
  });

  it('avisa de una cancelación sin tratarla como solicitud nueva', () => {
    const email = buildRequestEmail(
      baseAlert({
        kind: 'cancelacion',
        type: 'restaurante',
        name: 'Ana Ruiz',
        source: null,
        whatsappOk: false,
        details: 'El cliente ha cancelado esta reserva por WhatsApp.',
      })
    );
    assert.match(email.subject, /Cancelación #22 · Restaurante · Ana Ruiz · WhatsApp no enviado/);
    assert.match(email.text, /Cancelación en Hostería Don Fadrique/);
    assert.match(email.text, /La cancelación sí está guardada/);
  });

  it('no llama a Brevo si falta la clave', async () => {
    let called = false;
    const result = await sendRequestAlert(baseAlert(), {
      apiKey: '',
      post: async () => {
        called = true;
        return { status: 201, data: {} };
      },
    });
    assert.equal(result.ok, false);
    assert.equal(result.skipped, true);
    assert.equal(called, false);
  });

  it('envía a reservas@donfadrique.com por la API de Brevo', async () => {
    const calls = [];
    const result = await sendRequestAlert(baseAlert({ whatsappOk: true }), {
      apiKey: 'xkeysib-test',
      post: async (url, body, headers) => {
        calls.push({ url, body, headers });
        return { status: 201, data: { messageId: '<id@brevo>' } };
      },
    });
    assert.equal(result.ok, true);
    assert.equal(result.id, '<id@brevo>');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, BREVO_URL);
    assert.equal(calls[0].headers['api-key'], 'xkeysib-test');
    assert.equal(calls[0].body.sender.email, 'reservas@donfadrique.com');
    assert.equal(calls[0].body.sender.name, 'Hostería Don Fadrique');
    assert.equal(calls[0].body.to[0].email, 'reservas@donfadrique.com');
    assert.match(calls[0].body.subject, /Nueva solicitud #22/);
    assert.match(calls[0].body.textContent, /Bodas\.net/);
    assert.match(calls[0].body.htmlContent, /Bodas\.net/);
    assert.doesNotMatch(JSON.stringify(calls[0].body), /xkeysib-test/);
  });

  it('registra el rechazo de Brevo y un fallo de red sin lanzar', async () => {
    const rejected = await sendRequestAlert(baseAlert(), {
      apiKey: 'xkeysib-test',
      post: async () => ({ status: 401, data: { message: 'Key not found', code: 'unauthorized' } }),
    });
    assert.equal(rejected.ok, false);
    assert.match(rejected.error, /401/);
    assert.match(rejected.error, /unauthorized/);

    const down = await sendRequestAlert(baseAlert(), {
      apiKey: 'xkeysib-test',
      post: async () => {
        throw new Error('socket hang up');
      },
    });
    assert.equal(down.ok, false);
    assert.match(down.error, /socket hang up/);
  });
});

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { buildAdminAlertEmail, sendAdminAlertEmail } = require('../src/adminEmail');

const PANEL = 'https://whatsapp-reservas-bot.onrender.com/admin';

function sample(overrides = {}) {
  return {
    kind: 'request',
    id: 22,
    type: 'evento_boda',
    name: 'Ana y Luis',
    phone: '34600000037',
    date: '2027-06-12',
    time: 'boda',
    partySize: 120,
    details: 'Ceremonia: en la hostería | Email: ana@example.com | Aviso admin: no enviado',
    source: 'bodas_net',
    whatsapp: { ok: true, via: 'session', error: null },
    ...overrides,
  };
}

function built(alert, options = {}) {
  return buildAdminAlertEmail(alert, {
    panelUrl: 'https://whatsapp-reservas-bot.onrender.com',
    to: 'reservas@donfadrique.com',
    from: 'Hostería Don Fadrique <avisos@donfadrique.com>',
    ...options,
  });
}

describe('correo de aviso a administración', () => {
  it('redacta en español la solicitud, el origen y el enlace al panel', () => {
    const message = built(sample());
    assert.match(message.subject, /Solicitud #22 · Boda · Ana y Luis/);
    assert.equal(message.to, 'reservas@donfadrique.com');
    assert.equal(message.replyTo, 'reservas@donfadrique.com');
    assert.match(message.from, /avisos@donfadrique.com/);
    assert.match(message.text, /Nueva solicitud en Hostería Don Fadrique/);
    assert.match(message.text, /Número: #22/);
    assert.match(message.text, /Tipo: Boda/);
    assert.match(message.text, /Nombre: Ana y Luis/);
    assert.match(message.text, /Teléfono: \+34600000037/);
    assert.match(message.text, /12 de junio de 2027/);
    assert.match(message.text, /boda/);
    assert.match(message.text, /Invitados: 120/);
    assert.match(message.text, /Origen: Bodas\.net/);
    assert.match(message.text, /Ceremonia: en la hostería/);
    assert.match(message.text, /ana@example.com/);
    assert.doesNotMatch(message.text, /Aviso admin: no enviado/);
    assert.match(message.text, /El aviso por WhatsApp a Nico se ha enviado/);
    assert.match(message.text, /OK 22/);
    assert.match(message.text, /NO 22/);
    assert.match(message.text, new RegExp(PANEL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.doesNotMatch(message.text, /key=/);
    assert.match(message.html, new RegExp(`href="${PANEL}"`));
    assert.match(message.html, /Bodas\.net/);
  });

  it('saca la empresa del detalle y escapa el HTML', () => {
    const message = built(
      sample({
        id: 8,
        type: 'evento_empresa',
        name: 'Lucía',
        company: '',
        date: '2026-12-01',
        time: 'cena',
        partySize: 30,
        source: null,
        details: 'Empresa: Talleres <Alba> | Contacto: Lucía | Servicio: cena',
      })
    );
    assert.match(message.subject, /Solicitud #8 · Comida de Navidad para empresa · Talleres <Alba>/);
    assert.match(message.text, /Empresa: Talleres <Alba>/);
    assert.match(message.text, /Contacto: Lucía/);
    assert.match(message.text, /Personas: 30/);
    assert.match(message.text, /1 de diciembre de 2026/);
    assert.match(message.text, /cena/);
    assert.doesNotMatch(message.text, /Origen:/);
    assert.match(message.html, /Talleres &lt;Alba&gt;/);
    assert.doesNotMatch(message.html, /Talleres <Alba>/);
  });

  it('dice que el WhatsApp a Nico falló y lo pone en el asunto', () => {
    const message = built(
      sample({
        whatsapp: { ok: false, via: null, error: 'Re-engagement message code 131047; plantilla: template not found code 132001' },
      })
    );
    assert.match(message.subject, /^WhatsApp no enviado · Solicitud #22/);
    assert.match(message.text, /El aviso por WhatsApp a Nico no se ha enviado/);
    assert.match(message.text, /ventana de 24 horas/);
    assert.match(message.text, /131047/);
    assert.match(message.text, /marcada en el panel/);
    assert.match(message.html, /no se ha enviado/);
  });

  it('explica la plantilla cuando el WhatsApp salió por ahí', () => {
    const message = built(sample({ whatsapp: { ok: true, via: 'template' } }));
    assert.doesNotMatch(message.subject, /WhatsApp no enviado/);
    assert.match(message.text, /se envió con la plantilla/);
    assert.match(message.text, /ventana de 24 horas/);
  });

  it('la cancelación y el error de hotel no piden OK', () => {
    const cancel = built(
      sample({
        kind: 'cancel',
        id: 4,
        type: 'restaurante',
        name: 'Ana Ruiz',
        whatsapp: { ok: false, error: 'Re-engagement message code 131047' },
      })
    );
    assert.match(cancel.subject, /WhatsApp no enviado · Cancelación #4 · Reserva de restaurante · Ana Ruiz/);
    assert.match(cancel.text, /Cancelación en Hostería Don Fadrique/);
    assert.doesNotMatch(cancel.text, /OK 4/);
    assert.doesNotMatch(cancel.text, /marcada en el panel/);

    const hotel = built(
      sample({
        kind: 'hotel_error',
        id: null,
        type: 'hotel',
        name: 'Pedro',
        date: '2026-08-10 → 2026-08-12',
        time: '',
        partySize: 2,
        source: null,
        details: 'No se pudo crear la reserva en el hotel. timeout',
        whatsapp: { ok: true, via: 'session' },
      })
    );
    assert.match(hotel.subject, /^Error al reservar hotel · Pedro$/);
    assert.match(hotel.text, /llamar por teléfono/);
    assert.match(hotel.text, /2026-08-10 → 2026-08-12/);
    assert.doesNotMatch(hotel.text, /Nueva solicitud/);
    assert.doesNotMatch(hotel.text, /\bOK\b/);
  });

  it('no llama a Resend si falta la clave o el correo, y no revienta si la API falla', async () => {
    let calls = 0;
    const post = async () => {
      calls += 1;
    };
    const skipped = await sendAdminAlertEmail(sample(), { apiKey: '', post });
    assert.equal(skipped.ok, false);
    assert.equal(skipped.skipped, true);
    assert.equal(calls, 0);

    const invalid = await sendAdminAlertEmail(sample(), { apiKey: 're_test', to: 'no-es-un-correo', post });
    assert.equal(invalid.skipped, true);
    assert.equal(calls, 0);

    const sent = [];
    const ok = await sendAdminAlertEmail(sample(), {
      apiKey: 're_test',
      to: 'reservas@donfadrique.com',
      from: 'Hostería Don Fadrique <avisos@donfadrique.com>',
      panelUrl: 'https://whatsapp-reservas-bot.onrender.com',
      post: async (message, apiKey) => {
        sent.push({ message, apiKey });
      },
    });
    assert.equal(ok.ok, true);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].apiKey, 're_test');
    assert.equal(sent[0].message.to, 'reservas@donfadrique.com');
    assert.match(sent[0].message.subject, /Solicitud #22/);
    assert.doesNotMatch(sent[0].message.text, /re_test/);
    assert.doesNotMatch(sent[0].message.html, /key=/);

    const err = new Error('Request failed');
    err.response = { status: 403, data: { message: 'The domain is not verified' } };
    const failed = await sendAdminAlertEmail(sample(), {
      apiKey: 're_test',
      to: 'reservas@donfadrique.com',
      from: 'avisos@donfadrique.com',
      post: async () => {
        throw err;
      },
    });
    assert.equal(failed.ok, false);
    assert.equal(failed.skipped, undefined);
    assert.match(failed.error, /403/);
    assert.match(failed.error, /not verified/);
  });
});

const express = require('express');
const config = require('./config');
const wa = require('./whatsapp');
const { privacyHtml } = require('./privacyPage');

function extractText(message) {
  if (message.type === 'text') return message.text.body;
  if (message.type === 'interactive' && message.interactive.type === 'button_reply') {
    return message.interactive.button_reply.title;
  }
  if (message.type === 'interactive' && message.interactive.type === 'list_reply') {
    return message.interactive.list_reply.title;
  }
  return '';
}

function extractButtonId(message) {
  if (message.type === 'interactive' && message.interactive.type === 'button_reply') {
    return message.interactive.button_reply.id;
  }
  if (message.type === 'interactive' && message.interactive.type === 'list_reply') {
    return message.interactive.list_reply.id;
  }
  return null;
}

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function waLink(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (!digits) return esc(phone);
  return `<a href="https://wa.me/${digits}">${esc(phone)}</a>`;
}

function typeLabel(type) {
  if (type === 'evento_empresa') return '🎄 Empresa';
  if (type === 'evento_congreso') return '🏛️ Congreso';
  if (type === 'hotel') return '🛏️ Hotel';
  if (type === 'otivm') return 'OTIVM (histórico)';
  return '🍽️ Restaurante';
}

function renderAdminPage({ businessName, confirmed, pending }) {
  const confirmedRows = confirmed
    .map(
      (r) =>
        `<tr><td>#${esc(r.id)}</td><td>${esc(r.date)}</td><td>${esc(r.time)}</td><td>${typeLabel(r.type)}</td>` +
        `<td>${esc(r.name)}</td><td>${esc(r.party_size || '-')}</td><td>${esc(r.details || '')}</td>` +
        `<td>${waLink(r.phone)}</td></tr>`
    )
    .join('');

  const pendingRows = pending
    .map(
      (r) =>
        `<tr><td>#${esc(r.id)}</td><td>${esc(r.date)}</td><td>${esc(r.time)}</td><td>${typeLabel(r.type)}</td>` +
        `<td>${esc(r.name)}</td><td>${esc(r.party_size || '-')}</td><td>${esc(r.details || '')}</td>` +
        `<td>${waLink(r.phone)}</td><td>Pendiente de presupuesto</td></tr>`
    )
    .join('');

  const confirmedLabel =
    confirmed.length === 1 ? '1 reserva confirmada' : `${confirmed.length} reservas confirmadas`;
  const pendingLabel =
    pending.length === 1 ? '1 solicitud sin confirmar' : `${pending.length} solicitudes sin confirmar`;

  return `<!DOCTYPE html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Reservas - ${esc(businessName)}</title>
<style>
  body{font-family:sans-serif;margin:20px;background:#f6f5f0;color:#333}
  h1,h2{color:#4a5233}
  table{border-collapse:collapse;width:100%;background:#fff;box-shadow:0 1px 4px rgba(0,0,0,.1);margin-bottom:28px}
  th,td{padding:10px 12px;border-bottom:1px solid #e5e2d9;text-align:left;font-size:14px;vertical-align:top}
  th{background:#4a5233;color:#fff}
  tr:hover{background:#f0eee6}
  td.details{word-break:break-word;max-width:420px}
  a{color:#4a5233}
</style></head>
<body>
  <h1>Reservas próximos 30 días · ${esc(businessName)}</h1>
  <p>${confirmedLabel}. Actualiza la página para refrescar.</p>
  <table>
    <tr><th>Nº</th><th>Fecha</th><th>Hora</th><th>Tipo</th><th>Nombre</th><th>Pers.</th><th>Detalles</th><th>WhatsApp</th></tr>
    ${confirmedRows || '<tr><td colspan="8">Sin reservas próximas</td></tr>'}
  </table>
  <h2>Solicitudes de empresa y congresos · pendientes de presupuesto</h2>
  <p>${pendingLabel}, también fuera de los 30 días.</p>
  <table>
    <tr><th>Nº</th><th>Fecha</th><th>Servicio</th><th>Tipo</th><th>Contacto</th><th>Pers.</th><th>Detalles</th><th>WhatsApp</th><th>Estado</th></tr>
    ${pendingRows || '<tr><td colspan="9">Sin solicitudes pendientes</td></tr>'}
  </table>
</body></html>`;
}

function start(onMessage) {
  const app = express();
  app.use(express.json());

  app.get('/webhook', (req, res) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode === 'subscribe' && token === config.verifyToken) {
      return res.status(200).send(challenge);
    }
    return res.sendStatus(403);
  });

  app.post('/webhook', async (req, res) => {
    res.sendStatus(200);

    console.log('[webhook] POST recibido:', JSON.stringify(req.body));

    try {
      const value = req.body.entry?.[0]?.changes?.[0]?.value;
      const message = value?.messages?.[0];
      if (!message) {
        console.log('[webhook] Sin campo messages (probablemente una notificación de status), ignorado');
        return;
      }

      const from = message.from;
      console.log(`[webhook] Mensaje de ${from}, tipo ${message.type}`);
      wa.markRead(message.id).catch((err) => console.error('Error marcando como leído:', err.message));
      await onMessage(from, extractText(message), extractButtonId(message));
      console.log(`[webhook] Procesado y respondido a ${from}`);
    } catch (err) {
      console.error('Error procesando webhook:', err?.response?.data || err);
    }
  });

  app.get('/', (req, res) => res.send('Bot de reservas activo (modo Meta Cloud API)'));
  app.get('/privacy', (req, res) => res.type('html').send(privacyHtml()));

  // Panel de reservas para el equipo (protegido con clave: /admin?key=...)
  app.get('/admin', async (req, res) => {
    const adminKey = process.env.ADMIN_KEY;
    if (!adminKey || req.query.key !== adminKey) {
      return res.status(403).send('Acceso denegado. Falta la clave (?key=...)');
    }
    try {
      const db = require('./db');
      const { DateTime } = require('luxon');
      const today = DateTime.now().setZone(config.business.timezone).startOf('day');
      const fromDate = today.toFormat('yyyy-MM-dd');
      const toDate = today.plus({ days: 30 }).toFormat('yyyy-MM-dd');
      const list = await db.getReservationsByDateRange(fromDate, toDate);
      const pending = await db.getPendingEventRequests();
      res.type('html').send(
        renderAdminPage({ businessName: config.business.name, confirmed: list, pending })
      );
    } catch (err) {
      console.error('Error en /admin:', err);
      res.status(500).send('Error cargando reservas');
    }
  });

  app.listen(config.port, () => {
    console.log(`Servidor escuchando en el puerto ${config.port} (proveedor: meta)`);
  });
}

module.exports = { start, renderAdminPage };

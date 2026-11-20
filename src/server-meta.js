const crypto = require('crypto');
const path = require('path');
const express = require('express');
const config = require('./config');
const wa = require('./whatsapp');
const marketing = require('./marketing');
const { privacyHtml } = require('./privacyPage');
const menusPaginas = require('./menusPaginas');
const weddingSources = require('./weddingSources');
const conversationLog = require('./conversationLog');
const confirmacion = require('./confirmacion');

function extractText(message) {
  if (message.type === 'image') return (message.image && message.image.caption) || '';
  if (message.type === 'text') return message.text.body;
  // Respuesta a un botón de plantilla (quick reply): type "button", no "interactive".
  if (message.type === 'button' && message.button) {
    return message.button.text || message.button.payload || '';
  }
  if (message.type === 'interactive' && message.interactive.type === 'button_reply') {
    return message.interactive.button_reply.title;
  }
  if (message.type === 'interactive' && message.interactive.type === 'list_reply') {
    return message.interactive.list_reply.title;
  }
  return '';
}

function extractButtonId(message) {
  if (message.type === 'button' && message.button) {
    return message.button.payload || message.button.text || null;
  }
  if (message.type === 'interactive' && message.interactive.type === 'button_reply') {
    return message.interactive.button_reply.id;
  }
  if (message.type === 'interactive' && message.interactive.type === 'list_reply') {
    return message.interactive.list_reply.id;
  }
  return null;
}

function adminAuthorized(req) {
  const adminKey = process.env.ADMIN_KEY;
  if (!adminKey) return false;
  const provided = req.get('x-admin-key') || req.query.key;
  if (!provided) return false;
  const left = Buffer.from(String(provided));
  const right = Buffer.from(String(adminKey));
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
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
  if (type === 'evento_boda') return '💍 Boda';
  if (type === 'evento_turoperador') return '🚌 Turoperador / grupo';
  if (type === 'hotel') return '🛏️ Hotel';
  if (type === 'otivm') return 'OTIVM (histórico)';
  return '🍽️ Restaurante';
}

function alertFailed(row) {
  return row.admin_alert === 'failed' || /Aviso admin: no enviado/.test(row.details || '');
}

function isBudgetEvent(type) {
  return type === 'evento_empresa' || type === 'evento_congreso' || type === 'evento_boda' || type === 'evento_turoperador';
}

function pendingStatusText(row) {
  const base = isBudgetEvent(row.type) ? 'Pendiente de presupuesto' : 'Pendiente de confirmación';
  return alertFailed(row) ? `${base} · aviso de WhatsApp no enviado` : base;
}

function deferredNote(row) {
  return row && row.customer_notice === 'deferred' ? ' (el cliente se entera al volver a escribir)' : '';
}

function actionCell(row, adminKey) {
  if (!adminKey) return '';
  const id = encodeURIComponent(row.id);
  const key = esc(encodeURIComponent(adminKey));
  return (
    `<td class="actions">` +
    `<form method="post" action="/admin/reservations/${id}/confirm?key=${key}">` +
    `<button type="submit">Confirmar</button></form>` +
    `<form method="post" action="/admin/reservations/${id}/reject?key=${key}">` +
    `<input name="reason" placeholder="Motivo opcional" maxlength="300">` +
    `<button type="submit">Rechazar</button></form></td>`
  );
}

function collectStatuses(body) {
  const entries = Array.isArray(body?.entry) ? body.entry : [];
  const statuses = [];
  for (const entry of entries) {
    const changes = Array.isArray(entry?.changes) ? entry.changes : [];
    for (const change of changes) {
      const list = change?.value?.statuses;
      if (!Array.isArray(list)) continue;
      for (const status of list) {
        if (status && typeof status === 'object') statuses.push(status);
      }
    }
  }
  return statuses;
}

function statusLogFields(status) {
  const errors = Array.isArray(status?.errors) ? status.errors : [];
  return {
    id: status?.id ?? null,
    recipient_id: status?.recipient_id ?? null,
    status: status?.status ?? null,
    timestamp: status?.timestamp ?? null,
    errors: errors.map((error) => ({
      code: error?.code ?? null,
      title: error?.title ?? null,
      message: error?.message ?? null,
      error_data: { details: error?.error_data?.details ?? null },
    })),
  };
}

function phoneDigits(value) {
  if (value == null) return '';
  let digits = String(value).trim().replace(/[\s().-]/g, '');
  if (digits.startsWith('+')) digits = digits.slice(1);
  else if (digits.startsWith('00')) digits = digits.slice(2);
  return digits.replace(/\D/g, '');
}

function joinPresent(values) {
  const parts = values.filter((value) => value != null && String(value) !== '').map((value) => String(value));
  return parts.length ? parts.join(' | ') : null;
}

function statusRecord(status) {
  const logged = statusLogFields(status);
  const recipient = phoneDigits(status?.recipient_id);
  const rawRecipient = status?.recipient_id != null ? String(status.recipient_id).trim() : '';
  return {
    wamid: status?.id != null ? String(status.id) : '',
    recipient: recipient || rawRecipient || null,
    status: status?.status != null ? String(status.status) : null,
    error_code: joinPresent(logged.errors.map((error) => error.code)),
    error_title: joinPresent(logged.errors.map((error) => error.title)),
    error_detail: joinPresent(
      logged.errors.map((error) => {
        const details = error.error_data?.details;
        if (details != null && String(details) !== '') return String(details);
        if (error.message != null && String(error.message) !== '') return String(error.message);
        return null;
      })
    ),
    ts: status?.timestamp != null && String(status.timestamp) !== '' ? String(status.timestamp) : null,
  };
}

function formatStatusTime(ts) {
  if (ts == null || ts === '') return '';
  const raw = String(ts);
  if (!/^\d{10,13}$/.test(raw)) return raw;
  const { DateTime } = require('luxon');
  const ms = raw.length >= 13 ? Number(raw) : Number(raw) * 1000;
  const dt = DateTime.fromMillis(ms, { zone: config.business.timezone });
  if (!dt.isValid) return raw;
  return dt.toFormat('dd/MM/yyyy HH:mm');
}

function statusLabel(status) {
  const raw = status == null ? '' : String(status);
  const labels = {
    sent: 'enviado',
    delivered: 'entregado',
    read: 'leído',
    failed: 'fallido',
  };
  const label = labels[raw.toLowerCase()];
  return label ? `${label} (${raw})` : raw;
}

function statusErrorText(row) {
  return [row.error_code, row.error_title, row.error_detail]
    .filter((value) => value != null && String(value) !== '')
    .join(' · ');
}

async function processWebhook(body, deps) {
  const statuses = collectStatuses(body);
  const saveMessageStatus = deps.saveMessageStatus;
  const markRead = deps.markRead || ((id) => wa.markRead(id));

  for (const status of statuses) {
    console.log('[webhook] status ' + JSON.stringify(statusLogFields(status)));
    if (!saveMessageStatus) continue;
    try {
      await saveMessageStatus(statusRecord(status));
    } catch (err) {
      console.error('[webhook] No se pudo guardar el estado:', err?.message || err);
    }
  }

  const value = body?.entry?.[0]?.changes?.[0]?.value;
  const message = value?.messages?.[0];
  if (!message) {
    if (statuses.length === 0) {
      console.log('[webhook] Sin campo messages (probablemente una notificación de status), ignorado');
    }
    return;
  }

  const from = message.from;
  const text = extractText(message);
  const buttonId = extractButtonId(message);
  console.log(`[webhook] Mensaje de ${from}, tipo ${message.type}`);
  try {
    Promise.resolve(markRead(message.id)).catch((err) =>
      console.error('Error marcando como leído:', err.message)
    );
  } catch (err) {
    console.error('Error marcando como leído:', err.message);
  }
  const recordInbound = deps.recordInbound || ((entry) => conversationLog.recordInbound(entry));
  const syncConversation = deps.syncConversation || ((phone, body, id) => conversationLog.syncAfterTurn(phone, body, id));
  try {
    await recordInbound({
      phone: from,
      body: text,
      msgType: message.type || 'unknown',
      buttonId,
      profileName: conversationLog.profileName(value, from),
      at: conversationLog.timestampFrom(message),
    });
  } catch (err) {
    console.error('[conversacion] no se pudo guardar la entrada:', err?.message || err);
  }
  await deps.onMessage(from, text, buttonId, message);
  try {
    await syncConversation(from, text, buttonId);
  } catch (err) {
    console.error('[conversacion] no se pudo actualizar el tema:', err?.message || err);
  }
  console.log(`[webhook] Procesado y respondido a ${from}`);
}

async function loadAdminPageData() {
  const db = require('./db');
  const { DateTime } = require('luxon');
  const today = DateTime.now().setZone(config.business.timezone).startOf('day');
  const fromDate = today.toFormat('yyyy-MM-dd');
  const toDate = today.plus({ days: 30 }).toFormat('yyyy-MM-dd');
  const confirmed = await db.getReservationsByDateRange(fromDate, toDate);
  const pendingEvents = await db.getPendingEventRequests();
  let pending = pendingEvents;
  if (typeof db.listPendingReservations === 'function') {
    const allPending = await db.listPendingReservations();
    const seen = new Set(pendingEvents.map((row) => row.id));
    pending = pendingEvents.concat(allPending.filter((row) => !seen.has(row.id)));
  }
  let rejected = [];
  if (typeof db.listRejectedReservations === 'function') {
    try {
      rejected = await db.listRejectedReservations();
    } catch (err) {
      console.error('Error cargando solicitudes rechazadas:', err);
    }
  }
  let statuses = [];
  try {
    statuses = await db.listMessageStatuses({ limit: 50 });
  } catch (err) {
    console.error('Error cargando estados de envío:', err);
  }
  let wedding = null;
  try {
    if (typeof db.weddingStats === 'function') {
      const zone = config.business.timezone || 'Europe/Madrid';
      const today = DateTime.now().setZone(zone).startOf('day');
      const to = today.toFormat('yyyy-MM-dd');
      wedding = {
        week: await db.weddingStats({ from: today.minus({ days: 6 }).toFormat('yyyy-MM-dd'), to, zone }),
        month: await db.weddingStats({ from: today.minus({ days: 29 }).toFormat('yyyy-MM-dd'), to, zone }),
      };
    }
  } catch (err) {
    console.error('Error cargando estadísticas de bodas:', err.message || err);
  }
  return { confirmed, pending, rejected, statuses, wedding };
}

function weddingCountCells(row) {
  return weddingSources.COUNT_KEYS.map((key) => `<td>${esc(row[key])}</td>`).join('');
}

function weddingTable(stats) {
  if (!stats) return '';
  const head =
    '<tr><th>Origen</th><th>Leads</th><th>Fotos</th><th>Más fotos</th><th>Fecha</th><th>Invitados</th>' +
    '<th>Ceremonia</th><th>Alojamiento</th><th>Nombre</th><th>Piden visita</th><th>Confirmadas</th><th>Rechazadas</th></tr>';
  const body = (stats.bySource || [])
    .map((row) => `<tr><td>${esc(row.label || weddingSources.labelFor(row.source))}</td>${weddingCountCells(row)}</tr>`)
    .join('');
  const totals = stats.totals || {};
  return (
    `<table>${head}${body}` +
    `<tr><td><strong>Total</strong></td>${weddingCountCells(totals)}</tr></table>`
  );
}

function weddingSection(wedding) {
  if (!wedding || !wedding.week || !wedding.month) return '';
  const questions = (wedding.month.questions || []).slice(0, 10);
  const items = questions
    .map((question) => weddingSources.publicQuestion(question.text))
    .filter(Boolean)
    .map((text) => `<li>${esc(text)}</li>`)
    .join('');
  return (
    `<h2>Bodas por origen</h2>` +
    `<p>Cada pareja cuenta en el portal del primer mensaje, y aquí se ve hasta dónde llegó. La etiqueta no se le enseña al cliente.</p>` +
    `<h3>Últimos 7 días · ${esc(wedding.week.from)} a ${esc(wedding.week.to)}</h3>` +
    weddingTable(wedding.week) +
    `<h3>Últimos 30 días · ${esc(wedding.month.from)} a ${esc(wedding.month.to)}</h3>` +
    weddingTable(wedding.month) +
    `<h3>Últimas preguntas</h3>` +
    `<p>Las de los últimos 30 días, sin teléfonos. El listado completo está en /admin/wedding-stats.</p>` +
    (items ? `<ul>${items}</ul>` : '<p>Sin preguntas en los últimos 30 días.</p>')
  );
}

function renderAdminPage({ businessName, confirmed, pending, rejected, statuses, adminKey, wedding }) {
  const confirmedRows = confirmed
    .map(
      (r) =>
        `<tr><td>#${esc(r.id)}</td><td>${esc(r.date)}</td><td>${esc(r.time)}</td><td>${typeLabel(r.type)}</td>` +
        `<td>${esc(r.name)}</td><td>${esc(r.party_size || '-')}</td><td>${esc((r.details || '') + deferredNote(r))}</td>` +
        `<td>${waLink(r.phone)}</td></tr>`
    )
    .join('');

  const pendingList = Array.isArray(pending) ? pending : [];
  const rejectedList = Array.isArray(rejected) ? rejected : [];
  const actionHeader = adminKey ? '<th>Acción</th>' : '';
  const pendingCols = adminKey ? 10 : 9;
  const pendingRows = pendingList
    .map((r) => {
      const failed = alertFailed(r);
      const status = pendingStatusText(r);
      return (
        `<tr class="${failed ? 'alert-failed' : ''}"><td>#${esc(r.id)}</td><td>${esc(r.date)}</td><td>${esc(r.time)}</td><td>${typeLabel(r.type)}</td>` +
        `<td>${esc(r.name)}</td><td>${esc(r.party_size || '-')}</td><td>${esc(r.details || '')}</td>` +
        `<td>${waLink(r.phone)}</td><td>${status}</td>${actionCell(r, adminKey)}</tr>`
      );
    })
    .join('');

  const rejectedRows = rejectedList
    .map(
      (r) =>
        `<tr><td>#${esc(r.id)}</td><td>${esc(r.date)}</td><td>${esc(r.time)}</td><td>${typeLabel(r.type)}</td>` +
        `<td>${esc(r.name)}</td><td>${esc(r.party_size || '-')}</td><td>${esc(r.reject_reason || '')}</td>` +
        `<td>${esc(deferredNote(r) || 'avisado')}</td></tr>`
    )
    .join('');
  const rejectedSection = rejectedList.length
    ? `<h2>Solicitudes rechazadas</h2>
  <table>
    <tr><th>Nº</th><th>Fecha</th><th>Servicio</th><th>Tipo</th><th>Contacto</th><th>Pers.</th><th>Motivo</th><th>Aviso</th></tr>
    ${rejectedRows}
  </table>`
    : '';

  const confirmedLabel =
    confirmed.length === 1 ? '1 reserva confirmada' : `${confirmed.length} reservas confirmadas`;
  const pendingLabel =
    pendingList.length === 1 ? '1 solicitud sin confirmar' : `${pendingList.length} solicitudes sin confirmar`;
  const statusRows = (Array.isArray(statuses) ? statuses : [])
    .map((row) => {
      const failed = String(row.status || '').toLowerCase() === 'failed';
      const errorText = statusErrorText(row);
      return (
        `<tr${failed ? ' class="alert-failed"' : ''}>` +
        `<td>${esc(formatStatusTime(row.ts))}</td>` +
        `<td>${waLink(row.recipient)}</td>` +
        `<td>${esc(statusLabel(row.status))}</td>` +
        `<td class="details">${errorText ? esc(errorText) : '—'}</td>` +
        `<td class="details">${esc(row.wamid)}</td></tr>`
      );
    })
    .join('');

  const failedCount = pendingList.filter(alertFailed).length;
  const failedNote = failedCount
    ? `<p class="alert-banner"><strong>Aviso de WhatsApp no enviado:</strong> ${
        failedCount === 1
          ? '1 solicitud no llegó a administración por WhatsApp.'
          : `${failedCount} solicitudes no llegaron a administración por WhatsApp.`
      } Siguen guardadas en esta lista.</p>`
    : '';

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
  tr.alert-failed,tr.alert-failed:hover{background:#fff1f0}
  tr.alert-failed td{color:#7a1f1f}
  td.details{word-break:break-word;max-width:420px}
  a{color:#4a5233}
  .alert-banner{background:#fff1f0;border:1px solid #e7b2b2;padding:10px 12px;border-radius:6px}
</style></head>
<body>
  <h1>Reservas próximos 30 días · ${esc(businessName)}</h1>
  <p>${confirmedLabel}. Actualiza la página para refrescar.</p>
  <p>El historial de chats (solo con esta clave) está en <a href="/admin/conversations${adminKey ? `?key=${esc(encodeURIComponent(adminKey))}` : ''}">/admin/conversations</a>.</p>
  <table>
    <tr><th>Nº</th><th>Fecha</th><th>Hora</th><th>Tipo</th><th>Nombre</th><th>Pers.</th><th>Detalles</th><th>WhatsApp</th></tr>
    ${confirmedRows || '<tr><td colspan="8">Sin reservas próximas</td></tr>'}
  </table>
  <h2>Solicitudes de boda, empresa y congresos · pendientes de presupuesto</h2>
  <p>${pendingLabel}, también fuera de los 30 días. Aquí salen también las mesas, menús y habitaciones que aún no has confirmado.</p>
  <p>${esc(confirmacion.pendingCommandText(pendingList)).replace(/\n/g, '<br>')}</p>
  <p>Si solo hay una pendiente, basta con OK o NO.</p>
  ${failedNote}
  <table>
    <tr><th>Nº</th><th>Fecha</th><th>Servicio</th><th>Tipo</th><th>Contacto</th><th>Pers.</th><th>Detalles</th><th>WhatsApp</th><th>Estado</th>${actionHeader}</tr>
    ${pendingRows || `<tr><td colspan="${pendingCols}">Sin solicitudes pendientes</td></tr>`}
  </table>
  ${rejectedSection}
  <h2>Últimos estados de envío</h2>
  <p>Meta avisa después si el mensaje salió, llegó, se leyó o falló. Un fallo en rojo trae el código: 131042 (pago), 131049 (límite de marketing) o 131026 (no entregable).</p>
  <table>
    <tr><th>Cuándo</th><th>Destinatario</th><th>Estado</th><th>Error</th><th>Id</th></tr>
    ${statusRows || '<tr><td colspan="5">Sin estados de envío</td></tr>'}
  </table>
  ${weddingSection(wedding)}
</body></html>`;
}

function createApp(onMessage, deps = {}) {
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));
  app.get(['/menus', '/menus/'], (req, res) => {
    res.type('html').send(menusPaginas.indexHtml());
  });
  app.get('/menus/:slug', (req, res, next) => {
    const html = menusPaginas.menuHtml(req.params.slug);
    if (!html) return next();
    res.type('html').send(html);
  });
  app.use(
    '/fotos',
    express.static(path.join(__dirname, '..', 'public', 'fotos'), {
      index: false,
      maxAge: '7d',
    })
  );
  app.use(
    '/galeria',
    express.static(path.join(__dirname, '..', 'public', 'galeria'), {
      index: false,
      maxAge: '7d',
    })
  );
  app.use(
    '/menus',
    express.static(path.join(__dirname, '..', 'public', 'menus'), {
      index: false,
      maxAge: '7d',
    })
  );
  app.get('/carta_barra_navidad_2026.pdf', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'carta_barra_navidad_2026.pdf'));
  });
  const sendTemplate = deps.sendTemplate || ((to, options) => wa.sendTemplate(to, options));
  const isMarketingOptOut =
    deps.isMarketingOptOut || ((phone) => require('./db').isMarketingOptOut(phone));
  const delayMs = Object.prototype.hasOwnProperty.call(deps, 'delayMs')
    ? deps.delayMs
    : marketing.DEFAULT_DELAY_MS;
  const sleep = deps.sleep || marketing.sleep;
  const saveMessageStatus =
    deps.saveMessageStatus || ((row) => require('./db').saveMessageStatus(row));
  const listMessageStatuses =
    deps.listMessageStatuses || ((filters) => require('./db').listMessageStatuses(filters));
  const markRead = deps.markRead || ((id) => wa.markRead(id));
  const sendAdminText = deps.sendAdminText || ((to, body) => wa.sendText(to, body));
  const decideReservation =
    deps.decideReservation || ((args) => require('./reservasDecision').applyDecision(args));
  const loadAdmin = deps.loadAdmin;
  const conversationAdmin = deps.conversationAdmin || {
    list: (query) => conversationLog.listForAdmin(query),
    stats: (query) => conversationLog.statsForAdmin(query),
    transcript: (phone) => conversationLog.transcriptForAdmin(phone),
  };
  let campaignInFlight = false;

  function denyAdmin(res) {
    return res.status(403).json({
      ok: false,
      error: 'Acceso denegado. Falta la clave (cabecera x-admin-key o ?key=).',
    });
  }

  function conversationError(res, err, fallback) {
    const status = err && err.statusCode === 400 ? 400 : 500;
    if (status === 500) console.error(`[conversacion] ${fallback}:`, err?.message || err);
    return res.status(status).json({
      ok: false,
      error: status === 400 ? err.message : fallback,
    });
  }

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
      await processWebhook(req.body, { onMessage, saveMessageStatus, markRead });
    } catch (err) {
      console.error('Error procesando webhook:', err?.response?.data || err);
    }
  });

  app.get('/admin/conversations', async (req, res) => {
    if (!adminAuthorized(req)) return denyAdmin(res);
    try {
      const data = await conversationAdmin.list({ from: req.query.from, to: req.query.to });
      res.json({ ok: true, ...data });
    } catch (err) {
      conversationError(res, err, 'Error cargando las conversaciones');
    }
  });

  app.get('/admin/conversation-stats', async (req, res) => {
    if (!adminAuthorized(req)) return denyAdmin(res);
    try {
      const data = await conversationAdmin.stats({ from: req.query.from, to: req.query.to });
      res.json({ ok: true, ...data });
    } catch (err) {
      conversationError(res, err, 'Error cargando las estadísticas');
    }
  });

  app.get('/admin/conversations/:phone', async (req, res) => {
    if (!adminAuthorized(req)) return denyAdmin(res);
    try {
      const data = await conversationAdmin.transcript(req.params.phone);
      res.json({ ok: true, ...data });
    } catch (err) {
      conversationError(res, err, 'Error cargando la conversación');
    }
  });

  app.get('/admin/wedding-stats', async (req, res) => {
    if (!adminAuthorized(req)) {
      return res.status(403).json({
        ok: false,
        error: 'Acceso denegado. Falta la clave (cabecera x-admin-key o ?key=).',
      });
    }
    const from = req.query.from == null ? '' : String(req.query.from);
    const to = req.query.to == null ? '' : String(req.query.to);
    try {
      const stats = await require('./db').weddingStats({
        from,
        to,
        zone: config.business.timezone || 'Europe/Madrid',
      });
      res.json({ ok: true, ...stats });
    } catch (err) {
      const status = err.statusCode === 400 ? 400 : 500;
      if (status === 500) console.error('Error en /admin/wedding-stats:', err);
      res.status(status).json({
        ok: false,
        error: status === 400 ? err.message : 'Error cargando las estadísticas de bodas',
      });
    }
  });

  app.get('/admin/message-status', async (req, res) => {
    if (!adminAuthorized(req)) {
      return res.status(403).json({
        ok: false,
        error: 'Acceso denegado. Falta la clave (cabecera x-admin-key o ?key=).',
      });
    }
    try {
      const filters = { limit: 50 };
      if (req.query.wamid != null && String(req.query.wamid).trim() !== '') {
        filters.wamid = String(req.query.wamid).trim();
      }
      if (req.query.phone != null && String(req.query.phone).trim() !== '') {
        const phone = phoneDigits(req.query.phone);
        if (!phone) return res.json({ ok: true, statuses: [] });
        filters.phone = phone;
      }
      const statuses = await listMessageStatuses(filters);
      res.json({ ok: true, statuses });
    } catch (err) {
      console.error('Error en /admin/message-status:', err);
      res.status(500).json({ ok: false, error: 'Error cargando estados' });
    }
  });

  app.get('/', (req, res) => res.send('Bot de reservas activo (modo Meta Cloud API)'));
  app.get('/privacy', (req, res) => res.type('html').send(privacyHtml()));

  // Envío manual de la plantilla de marketing. No hay cron ni disparo al arrancar.
  app.post('/admin/marketing/send', async (req, res) => {
    if (!adminAuthorized(req)) {
      return res.status(403).json({
        ok: false,
        error: 'Acceso denegado. Falta la clave (cabecera x-admin-key o ?key=).',
      });
    }
    if (campaignInFlight) {
      return res.status(429).json({ ok: false, error: 'Ya hay un envío en curso. Espera a que termine.' });
    }
    campaignInFlight = true;
    try {
      const result = await marketing.sendCampaign(req.body || {}, {
        template: marketing.templateOptions(),
        sendOne: sendTemplate,
        isOptedOut: isMarketingOptOut,
        delayMs,
        sleep,
      });
      res.status(result.status).json(result.body);
    } catch (err) {
      console.error('[marketing] Error en el envío:', err?.message || err);
      res.status(500).json({ ok: false, error: 'Error enviando la plantilla' });
    } finally {
      campaignInFlight = false;
    }
  });

  function wantsJson(req) {
    const type = String(req.get('content-type') || '');
    if (type.includes('application/json')) return true;
    return String(req.get('accept') || '').includes('application/json');
  }

  async function decideFromPanel(req, res, action) {
    if (!adminAuthorized(req)) {
      return res.status(403).json({
        ok: false,
        error: 'Acceso denegado. Falta la clave (cabecera x-admin-key o ?key=).',
      });
    }
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ ok: false, error: 'El número de solicitud no es válido.' });
    }
    const rawReason = req.body && (req.body.reason || req.body.motivo);
    const reason = rawReason == null ? '' : String(rawReason);
    try {
      const result = await decideReservation({ id, action, reason });
      const adminPhones =
        Array.isArray(config.adminPhones) && config.adminPhones.length
          ? config.adminPhones
          : config.adminPhone
            ? [config.adminPhone]
            : [];
      if (result.httpStatus === 200 && result.adminText && adminPhones.length) {
        for (const phone of adminPhones) {
          try {
            await sendAdminText(phone, result.adminText);
          } catch (err) {
            console.error(`[decision] no se pudo avisar a ${phone}:`, err.message);
          }
        }
      }
      if (wantsJson(req)) return res.status(result.httpStatus).json(result.body);
      const key = req.get('x-admin-key') || req.query.key || (req.body && req.body.key) || '';
      return res.redirect(303, `/admin?key=${encodeURIComponent(String(key))}`);
    } catch (err) {
      console.error('[decision] error en el panel:', err.message);
      if (wantsJson(req)) return res.status(500).json({ ok: false, error: 'No se pudo actualizar la solicitud' });
      return res.status(500).send('No se pudo actualizar la solicitud');
    }
  }

  app.post('/admin/reservations/:id/confirm', (req, res) => decideFromPanel(req, res, 'confirm'));
  app.post('/admin/reservations/:id/reject', (req, res) => decideFromPanel(req, res, 'reject'));

  // Panel de reservas para el equipo (protegido con clave: /admin?key=...)
  app.get('/admin', async (req, res) => {
    const adminKey = process.env.ADMIN_KEY;
    if (!adminKey || req.query.key !== adminKey) {
      return res.status(403).send('Acceso denegado. Falta la clave (?key=...)');
    }
    try {
      const data = loadAdmin ? await loadAdmin() : await loadAdminPageData();
      res.type('html').send(
        renderAdminPage({ businessName: config.business.name, adminKey: req.query.key, ...data })
      );
    } catch (err) {
      console.error('Error en /admin:', err);
      res.status(500).send('Error cargando reservas');
    }
  });

  return app;
}

function start(onMessage) {
  const app = createApp(onMessage);
  app.listen(config.port, '0.0.0.0', () => {
    console.log(`Servidor escuchando en el puerto ${config.port} (proveedor: meta)`);
  });
}

module.exports = {
  start,
  createApp,
  renderAdminPage,
  extractText,
  extractButtonId,
  adminAuthorized,
  processWebhook,
  statusRecord,
  phoneDigits,
};

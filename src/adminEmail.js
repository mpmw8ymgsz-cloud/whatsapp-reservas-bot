const axios = require('axios');
const config = require('./config');
const confirmacion = require('./confirmacion');
const weddingSources = require('./weddingSources');

// Render gratis bloquea el SMTP (puertos 25, 465 y 587). El correo sale por
// HTTPS a la API de Resend, que tiene capa gratuita. Sin API key no se envía
// nada y el bot sigue igual.

const TYPE_LABEL = {
  restaurante: 'Reserva de restaurante',
  hotel: 'Reserva de hotel',
  evento_empresa: 'Comida de Navidad para empresa',
  evento_congreso: 'Congreso o evento',
  evento_boda: 'Boda',
  otivm: 'OTIVM',
};

const FAILURE_NOTE = 'Aviso admin: no enviado';

function oneLine(value) {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();
}

function clip(value, max) {
  const text = oneLine(value);
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function emailAddress(value) {
  const raw = String(value || '').trim();
  const wrapped = raw.match(/<([^<>\s]+@[^<>\s]+)>/);
  const address = (wrapped ? wrapped[1] : raw).trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) return '';
  return address;
}

function typeLabel(type) {
  if (!type) return 'Solicitud';
  return TYPE_LABEL[type] || String(type);
}

function visibleDetails(details) {
  return String(details || '')
    .replace(new RegExp(`\\s*\\|\\s*${FAILURE_NOTE}`, 'g'), '')
    .replace(new RegExp(`${FAILURE_NOTE}\\s*\\|?\\s*`, 'g'), '')
    .trim();
}

function companyOf(alert) {
  if (alert && alert.company && oneLine(alert.company)) return oneLine(alert.company);
  const match = visibleDetails(alert && alert.details).match(/(?:^|\|)\s*Empresa:\s*([^|]+)/i);
  return match ? oneLine(match[1]) : '';
}

function sourceLabel(source) {
  if (source == null || oneLine(source) === '') return '';
  return weddingSources.labelFor(oneLine(source));
}

function formatPhone(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (!digits) return 'no indicado';
  return `+${digits}`;
}

function whenLine(alert) {
  const formatted = confirmacion.formatDate(alert && alert.date);
  const date = formatted || (alert && alert.date ? String(alert.date) : 'no indicada');
  const time = oneLine(alert && alert.time);
  if (!time || time === '--:--') return date;
  return `${date} · ${time}`;
}

function peopleLine(alert) {
  const value = alert && alert.partySize;
  if (value == null || value === '') return 'no indicado';
  return String(value);
}

function detailParts(alert) {
  const clean = visibleDetails(alert && alert.details);
  if (!clean) return [];
  return clean
    .split('|')
    .map((part) => oneLine(part))
    .filter(Boolean);
}

function windowClosed(error) {
  return /131047|re-engagement|24\s*h|ventana de 24/i.test(String(error || ''));
}

function whatsappText(alert) {
  const wa = (alert && alert.whatsapp) || {};
  if (wa.ok && wa.via === 'template') {
    return (
      'El aviso por WhatsApp a Nico se envió con la plantilla, porque el mensaje de sesión no pudo salir. ' +
      'Suele pasar cuando la ventana de 24 horas está cerrada.'
    );
  }
  if (wa.ok) return 'El aviso por WhatsApp a Nico se ha enviado.';
  const parts = ['El aviso por WhatsApp a Nico no se ha enviado.'];
  if (windowClosed(wa.error)) parts.push('La ventana de 24 horas con Nico estaba cerrada.');
  if (wa.error) parts.push(`Detalle: ${oneLine(wa.error)}.`);
  if (!alert || !alert.kind || alert.kind === 'request') {
    parts.push('Queda marcada en el panel de administración.');
  }
  return parts.join(' ');
}

function intro(alert, business) {
  if (alert && alert.kind === 'cancel') {
    return `Cancelación en ${business}. El cliente la ha pedido por WhatsApp.`;
  }
  if (alert && alert.kind === 'hotel_error') {
    return `No se ha podido crear una reserva de hotel en ${business}. El cliente ya tiene el aviso de llamar por teléfono.`;
  }
  return `Nueva solicitud en ${business}.`;
}

function subjectOf(alert) {
  const who = companyOf(alert) || oneLine(alert && alert.name) || 'sin nombre';
  const tipo = typeLabel(alert && alert.type);
  const fail = alert && alert.whatsapp && alert.whatsapp.ok === false ? 'WhatsApp no enviado · ' : '';
  if (alert && alert.kind === 'cancel') {
    const id = alert.id != null ? ` #${alert.id}` : '';
    return clip(`${fail}Cancelación${id} · ${tipo} · ${who}`, 180);
  }
  if (alert && alert.kind === 'hotel_error') {
    return clip(`${fail}Error al reservar hotel · ${who}`, 180);
  }
  const id = alert && alert.id != null ? `#${alert.id}` : 'sin número';
  return clip(`${fail}Solicitud ${id} · ${tipo} · ${who}`, 180);
}

function instructions(alert) {
  if (alert && alert.kind && alert.kind !== 'request') return '';
  if (!alert || alert.id == null) return '';
  return [
    `Para confirmar, responde por WhatsApp: OK ${alert.id}`,
    `Para rechazar: NO ${alert.id} y, si quieres, un motivo.`,
  ].join('\n');
}

function adminPanelUrl(base) {
  const value = String(base || '').trim().replace(/\/$/, '');
  if (!/^https?:\/\//i.test(value)) return 'https://whatsapp-reservas-bot.onrender.com/admin';
  if (/\/admin$/i.test(value)) return value;
  return `${value}/admin`;
}

function fieldRows(alert) {
  const company = companyOf(alert);
  const source = sourceLabel(alert && alert.source);
  const peopleLabel = alert && alert.type === 'evento_boda' ? 'Invitados' : 'Personas';
  const rows = [
    ['Número', alert && alert.id != null ? `#${alert.id}` : 'sin número (no se guardó una solicitud)'],
    ['Tipo', typeLabel(alert && alert.type)],
  ];
  if (company) rows.push(['Empresa', company]);
  rows.push([company ? 'Contacto' : 'Nombre', oneLine(alert && alert.name) || 'no indicado']);
  rows.push(['Teléfono', formatPhone(alert && alert.phone)]);
  rows.push(['Fecha', whenLine(alert)]);
  rows.push([peopleLabel, peopleLine(alert)]);
  if (source) rows.push(['Origen', source]);
  return rows;
}

function buildAdminAlertEmail(alert, options = {}) {
  const business = options.businessName || (config.business && config.business.name) || 'Hostería Don Fadrique';
  const panelUrl = adminPanelUrl(options.panelUrl || config.publicBaseUrl);
  const toAddress = emailAddress(options.to || config.adminAlertEmail);
  const from = options.from || config.alertFromEmail;
  const rows = fieldRows(alert || {});
  const details = detailParts(alert);
  const status = whatsappText(alert);
  const howTo = instructions(alert);
  const lead = intro(alert, business);

  const text = [
    lead,
    '',
    ...rows.map(([label, value]) => `${label}: ${value}`),
    '',
    'Detalles:',
    ...(details.length ? details.map((part) => `- ${part}`) : ['- Sin más detalles.']),
    '',
    status,
    ...(howTo ? ['', howTo] : []),
    '',
    `Panel de administración: ${panelUrl}`,
    'Entra con la clave de administración.',
  ].join('\n');

  const detailHtml = details.length
    ? `<ul>${details.map((part) => `<li>${esc(part)}</li>`).join('')}</ul>`
    : '<p>Sin más detalles.</p>';
  const failed = !(alert && alert.whatsapp && alert.whatsapp.ok);
  const statusHtml = failed
    ? `<p style="background:#fff1f0;border:1px solid #e7b2b2;padding:10px 12px;">${esc(status)}</p>`
    : `<p>${esc(status)}</p>`;
  const howHtml = howTo
    ? `<p>${esc(howTo).replace(/\n/g, '<br>')}</p>`
    : '';
  const table = rows
    .map(([label, value]) => `<tr><th align="left">${esc(label)}</th><td>${esc(value)}</td></tr>`)
    .join('');

  const html = [
    `<p>${esc(lead)}</p>`,
    `<table>${table}</table>`,
    '<p><strong>Detalles</strong></p>',
    detailHtml,
    statusHtml,
    howHtml,
    `<p>Panel de administración: <a href="${esc(panelUrl)}">${esc(panelUrl)}</a><br>Entra con la clave de administración.</p>`,
  ].join('');

  return {
    from,
    to: toAddress,
    replyTo: toAddress,
    subject: subjectOf(alert),
    text,
    html,
  };
}

function formatHttpError(err) {
  const data = err && err.response && err.response.data;
  const status = err && err.response && err.response.status;
  let message = err && err.message ? err.message : String(err);
  if (data && typeof data === 'object') {
    message = data.message || data.error || data.name || JSON.stringify(data);
  } else if (typeof data === 'string' && data.trim()) {
    message = data.trim();
  }
  return status ? `${status} ${message}` : String(message);
}

async function postResend(message, apiKey) {
  const body = {
    from: message.from,
    to: [message.to],
    subject: message.subject,
    text: message.text,
    html: message.html,
  };
  if (message.replyTo) body.reply_to = message.replyTo;
  await axios.post('https://api.resend.com/emails', body, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    timeout: 15000,
  });
}

async function sendAdminAlertEmail(alert, deps = {}) {
  const apiKey = deps.apiKey != null ? String(deps.apiKey).trim() : config.resendApiKey;
  const to = deps.to != null ? deps.to : config.adminAlertEmail;
  const from = deps.from != null ? deps.from : config.alertFromEmail;
  const idLabel = alert && alert.id != null ? `#${alert.id}` : (alert && alert.kind) || 'aviso';

  if (!apiKey) {
    console.warn(`[admin-email] sin RESEND_API_KEY; no se envía ${idLabel}`);
    return { ok: false, skipped: true };
  }
  if (!emailAddress(to) || !emailAddress(from)) {
    console.error(`[admin-email] falta un correo válido; no se envía ${idLabel}`);
    return { ok: false, skipped: true, error: 'dirección no válida' };
  }

  const message = buildAdminAlertEmail(alert, {
    panelUrl: deps.panelUrl,
    businessName: deps.businessName,
    from,
    to,
  });
  const post = deps.post || postResend;
  try {
    await post(message, apiKey);
    console.log(`[admin-email] enviado ${idLabel} a ${message.to}`);
    return { ok: true };
  } catch (err) {
    const error = formatHttpError(err);
    console.error(`[admin-email] no enviado ${idLabel}: ${error}`);
    return { ok: false, error };
  }
}

module.exports = {
  buildAdminAlertEmail,
  sendAdminAlertEmail,
  emailAddress,
  TYPE_LABEL,
};

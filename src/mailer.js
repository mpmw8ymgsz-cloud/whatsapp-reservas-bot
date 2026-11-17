const axios = require('axios');
const { DateTime } = require('luxon');
const config = require('./config');
const weddingSources = require('./weddingSources');

const BREVO_URL = 'https://api.brevo.com/v3/smtp/email';

function oneLine(value) {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();
}

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function typeLabel(type) {
  if (type === 'evento_empresa') return 'Comida de Navidad de empresa';
  if (type === 'evento_congreso') return 'Congreso o evento';
  if (type === 'evento_boda') return 'Boda';
  if (type === 'evento_turoperador') return 'Turoperador / grupo';
  if (type === 'hotel') return 'Hotel';
  if (type === 'otivm') return 'OTIVM';
  return 'Restaurante';
}

function formatDay(value) {
  const raw = oneLine(value);
  if (!raw) return '';
  const zone = (config.business && config.business.timezone) || 'Europe/Madrid';
  const dt = DateTime.fromISO(raw, { zone }).setLocale('es');
  if (!dt.isValid) return raw;
  return dt.toFormat("cccc d 'de' LLLL 'de' yyyy");
}

function companyOf(alert) {
  const explicit = oneLine(alert.company);
  if (explicit) return explicit;
  const match = String(alert.details || '').match(/(?:^|\|)\s*Empresa:\s*([^|]+)/i);
  return match ? oneLine(match[1]) : '';
}

function sourceLabel(source) {
  const raw = oneLine(source);
  if (!raw) return '';
  if (raw === 'turoperador') return 'Turoperador / grupo';
  return weddingSources.labelFor(raw);
}

function contactPhone(alert) {
  const contact = oneLine(alert.phoneContact);
  if (!contact || /este whatsapp/i.test(contact)) return '';
  const digits = contact.replace(/\D/g, '');
  const whatsapp = String(alert.phone || '').replace(/\D/g, '');
  if (digits && whatsapp && digits === whatsapp) return '';
  return contact;
}

function peopleLabel(value) {
  if (value == null || value === '') return 'sin indicar';
  const num = Number(value);
  return Number.isFinite(num) ? String(num) : oneLine(value);
}

function serviceLabel(time) {
  const raw = oneLine(time);
  if (!raw || raw === '--:--') return '';
  return raw;
}

function detailLines(details) {
  return String(details || '')
    .split('|')
    .map((part) => part.trim())
    .filter(Boolean);
}

function whatsappNote(alert) {
  if (alert.whatsappOk) return 'El aviso por WhatsApp a Nico también se ha enviado.';
  if (alert.whatsappSkipped) {
    return 'El aviso por WhatsApp a Nico no se ha enviado: no hay un teléfono de administración configurado.';
  }
  const why =
    'El aviso por WhatsApp a Nico no se ha enviado. Meta lo rechaza con el error 131047 cuando han pasado más de 24 horas desde el último mensaje de Nico al WhatsApp del hotel.';
  if (alert.kind === 'error') return `${why} Este correo es el aviso que queda por escrito.`;
  if (alert.kind === 'cancelacion') return `${why} La cancelación sí está guardada.`;
  return `${why} La solicitud sigue guardada en el panel.`;
}

function intro(alert) {
  const name = (config.business && config.business.name) || 'Hostería Don Fadrique';
  if (alert.kind === 'cancelacion') return `Cancelación en ${name}`;
  if (alert.kind === 'error') return `Aviso del bot de ${name}`;
  return `Nueva solicitud en ${name}`;
}

function subjectFor(alert) {
  const who = oneLine(companyOf(alert) || alert.name || 'sin nombre');
  const type = typeLabel(alert.type);
  const id = alert.id != null && alert.id !== '' ? ` #${alert.id}` : '';
  let head = 'Nueva solicitud';
  if (alert.kind === 'cancelacion') head = 'Cancelación';
  else if (alert.kind === 'error') head = 'Error del bot';
  const parts = [`${head}${id}`, type, who];
  let subject = parts.filter((part) => oneLine(part)).join(' · ');
  if (!alert.whatsappOk) subject += ' · WhatsApp no enviado';
  return subject.slice(0, 180);
}

function fieldRows(alert) {
  const rows = [];
  if (alert.id != null && alert.id !== '') rows.push(['Número', `#${alert.id}`]);
  rows.push(['Tipo', typeLabel(alert.type)]);
  rows.push(['Nombre', oneLine(alert.name) || 'sin indicar']);
  const company = companyOf(alert);
  if (company) rows.push(['Empresa', company]);
  rows.push(['WhatsApp', oneLine(alert.phone) || 'sin indicar']);
  const phone = contactPhone(alert);
  if (phone) rows.push(['Teléfono de contacto', phone]);
  rows.push(['Fecha', formatDay(alert.date) || 'sin indicar']);
  const service = serviceLabel(alert.time);
  if (service) rows.push([/^\d{2}:\d{2}$/.test(service) ? 'Hora' : 'Servicio', service]);
  rows.push(['Personas', peopleLabel(alert.partySize)]);
  const source = sourceLabel(alert.source);
  if (source) rows.push(['Origen', source]);
  return rows;
}

function adminUrl(explicit) {
  if (explicit) return String(explicit).replace(/\/$/, '');
  const base = oneLine(config.publicBaseUrl) || 'https://whatsapp-reservas-bot.onrender.com';
  return `${base.replace(/\/$/, '')}/admin`;
}

function buildRequestEmail(alert, options = {}) {
  const input = alert || {};
  const url = adminUrl(options.adminUrl);
  const rows = fieldRows(input);
  const details = detailLines(input.details);
  const note = whatsappNote(input);
  const heading = intro(input);

  const text = [
    heading,
    '',
    ...rows.map(([label, value]) => `${label}: ${value}`),
    '',
    'Detalles:',
    details.length ? details.map((line) => `- ${line}`).join('\n') : '- sin detalles',
    '',
    note,
    '',
    `Panel de administración: ${url}`,
  ].join('\n');

  const htmlRows = rows
    .map(
      ([label, value]) =>
        `<tr><th align="left" style="padding:4px 12px 4px 0;vertical-align:top">${esc(label)}</th><td style="padding:4px 0">${esc(value)}</td></tr>`
    )
    .join('');
  const htmlDetails = details.length
    ? details.map((line) => `<li>${esc(line)}</li>`).join('')
    : '<li>sin detalles</li>';
  const html = [
    `<p><strong>${esc(heading)}</strong></p>`,
    `<table>${htmlRows}</table>`,
    '<p><strong>Detalles</strong></p>',
    `<ul>${htmlDetails}</ul>`,
    `<p>${esc(note)}</p>`,
    `<p>Panel de administración: <a href="${esc(url)}">${esc(url)}</a></p>`,
  ].join('');

  return { subject: subjectFor(input), text, html };
}

async function defaultPost(url, body, headers) {
  const response = await axios.post(url, body, {
    headers,
    timeout: 15000,
    validateStatus: () => true,
  });
  return { status: response.status, data: response.data };
}

function errorDetail(status, data) {
  const body = data && typeof data === 'object' ? JSON.stringify(data) : String(data || '');
  return `HTTP ${status} ${body}`.slice(0, 500);
}

async function sendRequestAlert(alert, deps = {}) {
  const id = alert && alert.id != null ? alert.id : '?';
  const email = buildRequestEmail(alert, { adminUrl: deps.adminUrl });
  const apiKey = deps.apiKey != null ? deps.apiKey : config.brevoApiKey;
  const to = oneLine(deps.to != null ? deps.to : config.alertEmail);
  const from = oneLine(deps.from != null ? deps.from : config.alertEmailFrom);
  const fromName = oneLine(deps.fromName != null ? deps.fromName : config.alertEmailFromName) || 'Hostería Don Fadrique';

  if (!apiKey) {
    console.error(
      `[email-alert] BREVO_API_KEY no está configurada; no se envía el correo de #${id} a ${to || 'sin destinatario'}`
    );
    return { ok: false, skipped: true };
  }
  if (!to || !from) {
    console.error(`[email-alert] falta destinatario o remitente; no se envía el correo de #${id}`);
    return { ok: false, skipped: true };
  }

  const post = deps.post || defaultPost;
  try {
    const result = await post(
      BREVO_URL,
      {
        sender: { name: fromName, email: from },
        to: [{ email: to, name: 'Reservas Don Fadrique' }],
        subject: email.subject,
        htmlContent: email.html,
        textContent: email.text,
      },
      {
        'api-key': apiKey,
        accept: 'application/json',
        'content-type': 'application/json',
      }
    );
    const status = result && result.status;
    if (status && status >= 200 && status < 300) {
      const messageId = result.data && (result.data.messageId || result.data.messageIds);
      console.log(`[email-alert] enviado #${id} a ${to} (${messageId || 'sin id'})`);
      return { ok: true, id: messageId || null };
    }
    const detail = errorDetail(status || 0, result && result.data);
    console.error(`[email-alert] Brevo rechazó #${id}: ${detail}`);
    return { ok: false, error: detail };
  } catch (err) {
    const detail = err && err.message ? err.message : String(err);
    console.error(`[email-alert] no se pudo enviar #${id}: ${detail}`);
    return { ok: false, error: detail };
  }
}

module.exports = {
  BREVO_URL,
  buildRequestEmail,
  sendRequestAlert,
  typeLabel,
};

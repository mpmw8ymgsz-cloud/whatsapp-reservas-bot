const { DateTime } = require('luxon');
const config = require('./config');

// Textos que ve el cliente. La dirección corta es la que pidió el equipo;
// el teléfono y el correo son los de la hostería, nunca un móvil personal.
const ADDRESS = 'Ctra. Salamanca–Alba de Tormes km 17';
const PHONE = '923 37 00 76';
const EMAIL = 'reservas@donfadrique.com';
const WINDOW_MS = 24 * 60 * 60 * 1000;

const ESTADO = {
  pending: 'pendiente',
  confirmed: 'confirmada',
  rejected: 'rechazada',
  cancelled: 'cancelada',
};

const TYPE_LABEL = {
  restaurante: 'Mesa en el restaurante',
  hotel: 'Habitación',
  evento_empresa: 'Comida de empresa',
  evento_congreso: 'Congreso',
  evento_boda: 'Boda',
};

function businessName() {
  return (config.business && config.business.name) || 'Hostería Don Fadrique';
}

function estadoOf(status) {
  return ESTADO[status] || String(status || '');
}

function phoneDigits(value) {
  if (value == null) return '';
  let digits = String(value).trim().replace(/[\s().-]/g, '');
  if (digits.startsWith('+')) digits = digits.slice(1);
  else if (digits.startsWith('00')) digits = digits.slice(2);
  return digits.replace(/\D/g, '');
}

function isAdminSender(from, adminPhone) {
  const left = phoneDigits(from);
  const right = phoneDigits(adminPhone);
  return left !== '' && left === right;
}

function scrubCustomerPhone(text, phone) {
  const digits = phoneDigits(phone);
  if (digits.length < 9) return String(text || '');
  return String(text || '').split(digits).join('');
}

function sanitizeReason(reason) {
  return String(reason || '')
    .replace(/\s+/g, ' ')
    .replace(/\+?\d(?:[\s().-]*\d){8,}/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 300);
}

function parseAdminDecision(text) {
  let raw = String(text || '')
    .replace(/[«»“”"]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[.!¡¿?]+$/g, '')
    .trim();
  if (!raw) return null;
  raw = raw.replace(
    /^(ok|vale|sí|si|confirmar|confirmo|no|rechazar|rechazo)\s*(?:#|n[ºo°.]|núm(?:ero)?|num(?:ero)?)\s*/i,
    '$1 '
  );
  raw = raw.replace(/\s+/g, ' ').trim();
  const folded = raw.normalize('NFD').replace(/[\u0300-\u036f]/g, '');

  const confirm = folded.match(/^(?:ok|vale|si|confirmar|confirmo)\s*(\d+)?\s*$/i);
  if (confirm) {
    return { action: 'confirm', id: confirm[1] ? Number(confirm[1]) : null, reason: '' };
  }

  const withReason = raw.match(/^(?:no|rechazar|rechazo)\s*(\d+)\s+(.+)$/i);
  if (withReason) {
    return { action: 'reject', id: Number(withReason[1]), reason: withReason[2].trim() };
  }

  const reject = folded.match(/^(?:no|rechazar|rechazo)\s*(\d+)?\s*$/i);
  if (reject) {
    return { action: 'reject', id: reject[1] ? Number(reject[1]) : null, reason: '' };
  }

  return null;
}

// null = no hay marca de tiempo (se puede intentar un mensaje de sesión, nunca una plantilla).
// true = dentro de las 24 h. false = ventana cerrada.
function isWindowOpen(lastInboundIso, nowMs = Date.now()) {
  if (lastInboundIso == null || String(lastInboundIso).trim() === '') return null;
  const at = Date.parse(lastInboundIso);
  if (!Number.isFinite(at)) return null;
  const age = nowMs - at;
  if (age < 0) return true;
  return age < WINDOW_MS;
}

function isSessionWindowError(err) {
  const code = Number(err?.response?.data?.error?.code);
  if (code === 131047) return true;
  const msg = `${err?.response?.data?.error?.message || ''} ${err?.message || ''}`;
  return /re-engagement|131047|fuera de (?:las )?24|24\s*h/i.test(msg);
}

function formatDate(iso) {
  if (!iso) return '';
  const dt = DateTime.fromISO(String(iso), { zone: config.business.timezone || 'Europe/Madrid' }).setLocale('es');
  if (!dt.isValid) return String(iso);
  return dt.toFormat("cccc d 'de' LLLL 'de' yyyy");
}

function detailField(details, label) {
  const parts = String(details || '').split('|').map((part) => part.trim());
  const prefix = `${label.toLowerCase()}:`;
  const hit = parts.find((part) => part.toLowerCase().startsWith(prefix));
  if (!hit) return '';
  if (/^(tel|whatsapp|teléfono|telefono|móvil|movil)\b/i.test(hit)) return '';
  const value = hit.slice(label.length + 1).trim();
  if (phoneDigits(value).length >= 9) return '';
  return value;
}

function menuLine(details) {
  const named = detailField(details, 'Menú');
  if (named) return named;
  const first = String(details || '').split('|')[0].trim();
  if (/^men[uú]/i.test(first) && phoneDigits(first).length < 9) return first;
  return '';
}

function kindLines(row) {
  const menu = menuLine(row.details);
  const label = TYPE_LABEL[row.type] || 'Reserva';
  if (menu && row.type && row.type !== 'restaurante') return [label, menu];
  if (menu) return [menu];
  return [label];
}

function whenLines(row) {
  const stay = String(row.details || '').match(/Entrada\s+(\d{4}-\d{2}-\d{2}).{0,80}Salida\s+(\d{4}-\d{2}-\d{2})/i);
  if (stay) {
    return [`Entrada: ${formatDate(stay[1])}`, `Salida: ${formatDate(stay[2])}`];
  }
  const date = formatDate(row.date);
  const clock = /^\d{2}:\d{2}$/.test(row.time || '') ? row.time : '';
  const service =
    { cena: 'Cena', comida: 'Comida', boda: 'Boda', evento: 'Evento' }[String(row.time || '').toLowerCase()] || '';
  const when = [date, clock || service].filter(Boolean).join(' · ');
  return when ? [when] : [];
}

function peopleLine(row) {
  const count = row.party_size != null ? row.party_size : row.partySize;
  const n = Number(count);
  if (!Number.isFinite(n) || n <= 0) return '';
  const noun = row.type === 'evento_boda' ? (n === 1 ? 'invitado' : 'invitados') : n === 1 ? 'persona' : 'personas';
  return `${n} ${noun}`;
}

function summaryLines(row) {
  const lines = [...kindLines(row)];
  const company = detailField(row.details, 'Empresa');
  if (company) lines.push(company);
  lines.push(...whenLines(row));
  const people = peopleLine(row);
  if (people) lines.push(people);
  if (row.name) lines.push(String(row.name).trim());
  return lines.filter(Boolean);
}

function contactBlock() {
  return ['Te esperamos en:', `📍 ${ADDRESS}`, `📞 ${PHONE}`, `✉️ ${EMAIL}`].join('\n');
}

function alternatives(type) {
  if (type === 'hotel') {
    return `Si te encaja otra fecha, escríbenos y miramos habitación. También puedes llamar al ${PHONE} o escribir a ${EMAIL}.`;
  }
  if (type === 'evento_empresa' || type === 'evento_congreso' || type === 'evento_boda') {
    return `Si quieres, preparamos otra fecha o un formato distinto. Escríbenos por aquí, llama al ${PHONE} o escribe a ${EMAIL}.`;
  }
  return `Si quieres, miramos otra fecha, otro horario u otro menú. Escríbenos por aquí, llama al ${PHONE} o escribe a ${EMAIL}.`;
}

function customerPending({ id, businessName: name, lines }) {
  const extra = (Array.isArray(lines) ? lines : []).map((line) => String(line || '').trim()).filter(Boolean);
  const head = `He anotado tu solicitud nº ${id}. Queda *pendiente de confirmación* por el equipo de ${
    name || businessName()
  }. Te escribo por aquí en cuanto haya respuesta.`;
  return extra.length ? `${head}\n\n${extra.join('\n')}` : head;
}

function customerConfirmed(row) {
  const hello = row.name ? `¡Hola ${String(row.name).trim()}!` : '¡Hola!';
  const text = [
    `${hello} Tu reserva en ${businessName()} queda *confirmada*. 🎉`,
    '',
    `Solicitud nº ${row.id}`,
    ...summaryLines(row),
    '',
    contactBlock(),
  ].join('\n');
  return scrubCustomerPhone(text, row.phone);
}

function customerRejected(row) {
  const reason = sanitizeReason(row.reject_reason || row.rejectReason || '');
  const hello = row.name ? `Hola ${String(row.name).trim()}` : 'Hola';
  const what = summaryLines(row).join(', ');
  const why = reason ? `\n\n${reason}` : '';
  const text = `${hello}, sentimos no poder aceptar la solicitud nº ${row.id} (${what}).${why}\n\n${alternatives(row.type)}`;
  return scrubCustomerPhone(text, row.phone);
}

function adminInstructions(id) {
  return [
    `Para confirmar responde OK ${id}`,
    `Para rechazar responde NO ${id} y, si quieres, un motivo. Ejemplo: NO ${id} no hay hueco`,
    'Si solo hay una solicitud pendiente, basta con OK o con NO.',
  ].join('\n');
}

function adminHelp() {
  return [
    'Este número es el de administración. No entra en el flujo de reservas.',
    '',
    'OK 123 — confirmar la solicitud 123',
    'NO 123 motivo — rechazarla (el motivo es opcional)',
    'OK o NO — si solo hay una pendiente',
    'hoy, mañana, semana — ver la lista',
  ].join('\n');
}

function adminDelivered(row, status) {
  const estado = status === 'rejected' ? 'rechazada' : 'confirmada';
  const who = row.name ? String(row.name).trim() : 'el cliente';
  return `Solicitud #${row.id} ${estado}. He avisado a ${who} por WhatsApp.`;
}

function adminNotDelivered(row, status) {
  const estado = status === 'rejected' ? 'rechazada' : 'confirmada';
  const who = row.name ? String(row.name).trim() : 'el cliente';
  return (
    `Solicitud #${row.id} de ${who} queda ${estado}, pero no le he escrito por WhatsApp: ` +
    'la ventana de 24 h está cerrada o WhatsApp no ha aceptado el mensaje. No envío plantillas de pago.\n\n' +
    `Contáctale por otro medio. Cuando vuelva a escribir, le diré que está ${estado}.`
  );
}

function decisionResult(httpStatus, adminText, extra = {}) {
  return {
    httpStatus,
    adminText,
    body: {
      ok: httpStatus === 200,
      message: adminText,
      ...extra,
    },
  };
}

module.exports = {
  ADDRESS,
  PHONE,
  EMAIL,
  WINDOW_MS,
  ESTADO,
  estadoOf,
  phoneDigits,
  isAdminSender,
  sanitizeReason,
  scrubCustomerPhone,
  parseAdminDecision,
  isWindowOpen,
  isSessionWindowError,
  formatDate,
  summaryLines,
  customerPending,
  customerConfirmed,
  customerRejected,
  adminInstructions,
  adminHelp,
  adminDelivered,
  adminNotDelivered,
  decisionResult,
};

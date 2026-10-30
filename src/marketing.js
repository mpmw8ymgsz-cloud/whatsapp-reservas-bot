const config = require('./config');
const { normalize } = require('./dateParser');

// Botones de la plantilla comida_navidad_empresas_2026, en este orden.
// Al enviar, la Cloud API adjunta estos payloads. Si la plantilla se manda
// desde el administrador de Meta (sin payload), el webhook trae el texto del
// botón y routeButtonId lo traduce al mismo id.
//
//   índice 0  "Pedir presupuesto"  → emp_book
//       Arranca el flujo de grupos / comida de Navidad de empresa
//       (el mismo id que el botón del chat).
//   índice 1  "No me interesa"     → mkt_optout
//       Baja de este tipo de mensajes.
const TEMPLATE_BUTTONS = [
  { index: 0, title: 'Pedir presupuesto', payload: 'emp_book' },
  { index: 1, title: 'No me interesa', payload: 'mkt_optout' },
];

const OPT_OUT_ACK =
  'De acuerdo. No te enviaremos más mensajes de este tipo. Si más adelante quieres una reserva, escribe *menu*.';

const DEFAULT_DELAY_MS = 1000;
const MAX_BATCH = 20;

const OPT_OUT_TEXTS = new Set(['baja', 'no me interesa', 'darme de baja', 'quiero darme de baja']);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function templateOptions(cfg = config) {
  const marketing = cfg.marketing || {};
  return {
    name: marketing.templateName,
    language: marketing.templateLang,
    headerMediaId: marketing.headerMediaId || null,
    headerImageUrl: marketing.headerImageUrl || null,
    buttons: TEMPLATE_BUTTONS.map((button) => ({ ...button })),
  };
}

function routeButtonId(buttonId) {
  if (buttonId == null || buttonId === '') return buttonId ?? null;
  const raw = String(buttonId).trim();
  const norm = normalize(raw);
  if (raw === 'emp_book' || norm === 'pedir presupuesto') return 'emp_book';
  if (raw === 'mkt_optout' || norm === 'no me interesa') return 'mkt_optout';
  return raw;
}

function optOutText(normText) {
  return (normText || '').replace(/[.!]+$/g, '').trim();
}

function isOptOut(normText, buttonId) {
  if (buttonId === 'mkt_optout') return true;
  return OPT_OUT_TEXTS.has(optOutText(normalize(normText)));
}

function optOutReason(normText, buttonId) {
  if (buttonId === 'mkt_optout') return 'mkt_optout';
  const text = optOutText(normalize(normText));
  if (text === 'no me interesa') return 'no me interesa';
  if (text === 'darme de baja' || text === 'quiero darme de baja') return text;
  return 'baja';
}

function isPresupuestoText(normText) {
  return normalize(normText) === 'pedir presupuesto';
}

function normalizePhone(value) {
  const original = String(value ?? '').trim();
  if (!original) return { error: 'número vacío' };
  let digits = original.replace(/[\s().-]/g, '');
  if (digits.startsWith('+')) digits = digits.slice(1);
  else if (digits.startsWith('00')) digits = digits.slice(2);
  if (!/^\d{8,15}$/.test(digits)) {
    return { error: 'usa el número en formato internacional, sin +, solo dígitos (8-15)' };
  }
  return { phone: digits };
}

function collectPhones(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { error: 'el cuerpo debe ser un JSON con phone o phones' };
  }
  if (body.phones != null && !Array.isArray(body.phones)) {
    return { error: 'phones debe ser una lista de números' };
  }
  const list = [];
  if (body.phone != null && String(body.phone).trim() !== '') list.push(body.phone);
  if (Array.isArray(body.phones)) list.push(...body.phones);
  if (list.length === 0) return { error: 'indica phone o phones' };
  if (list.length > MAX_BATCH) {
    return { error: `máximo ${MAX_BATCH} números por llamada. No se ha enviado ninguno.` };
  }
  return { phones: list };
}

function formatMetaError(err) {
  const meta = err?.response?.data?.error;
  if (!meta) {
    if (typeof err?.response?.data === 'string' && err.response.data) return err.response.data;
    return err?.message || 'error desconocido';
  }
  const parts = [];
  if (meta.message) parts.push(meta.message);
  if (meta.code != null) parts.push(`code ${meta.code}`);
  if (meta.error_subcode != null) parts.push(`subcode ${meta.error_subcode}`);
  if (meta.error_user_msg) parts.push(meta.error_user_msg);
  if (meta.fbtrace_id) parts.push(`trace ${meta.fbtrace_id}`);
  const text = parts.join(' · ') || 'error de Meta';
  if (/not approved|pending approval|no está aprobada|no esta aprobada|is not approved/i.test(text)) {
    return `${text} · La plantilla tiene que estar APPROVED en Meta antes de enviarla.`;
  }
  return text;
}

function headerKind(template) {
  if (template.headerMediaId) return 'media_id';
  if (template.headerImageUrl) return 'link';
  return null;
}

function httpStatus(results) {
  const hardFailures = results.filter((result) => !result.ok && !result.skipped);
  if (hardFailures.length === 0) return 200;
  const metaFailures = hardFailures.some((result) => !result.invalid);
  if (results.some((result) => result.ok || result.skipped)) return 207;
  if (!metaFailures) return 400;
  return 502;
}

// Envía la plantilla de uno en uno. No se llama sola: solo desde el endpoint
// de administración. Los números en opt-out no se mandan.
async function sendCampaign(body, deps) {
  const collected = collectPhones(body);
  if (collected.error) {
    return { status: 400, body: { ok: false, error: collected.error, results: [] } };
  }

  const template = deps.template;
  if (!template?.name || !template?.language) {
    return {
      status: 400,
      body: { ok: false, error: 'falta el nombre o el idioma de la plantilla', results: [] },
    };
  }

  const delayMs = deps.delayMs ?? DEFAULT_DELAY_MS;
  const pause = deps.sleep || sleep;
  const seen = new Set();
  const results = [];
  let attempted = false;

  for (const raw of collected.phones) {
    const parsed = normalizePhone(raw);
    if (!parsed.phone) {
      results.push({ phone: String(raw ?? ''), ok: false, invalid: true, error: parsed.error });
      continue;
    }
    if (seen.has(parsed.phone)) continue;
    seen.add(parsed.phone);

    let optedOut = false;
    try {
      optedOut = await deps.isOptedOut(parsed.phone);
    } catch (err) {
      console.error(`[marketing] no se pudo comprobar el opt-out de ${parsed.phone}:`, err.message);
      results.push({
        phone: parsed.phone,
        ok: false,
        error: 'no se pudo comprobar el opt-out; no se ha enviado',
      });
      continue;
    }
    if (optedOut) {
      console.log(`[marketing] omitido ${parsed.phone}: opt-out`);
      results.push({
        phone: parsed.phone,
        ok: false,
        skipped: true,
        error: 'opt-out: este número pidió no recibir estos mensajes',
      });
      continue;
    }

    if (attempted && delayMs > 0) await pause(delayMs);
    attempted = true;
    try {
      console.log(`[marketing] enviando plantilla ${template.name} (${template.language}) a ${parsed.phone}`);
      const data = await deps.sendOne(parsed.phone, template);
      const id = data?.messages?.[0]?.id || null;
      console.log(`[marketing] OK ${parsed.phone} id=${id || '-'}`);
      results.push({ phone: parsed.phone, ok: true, id });
    } catch (err) {
      const error = formatMetaError(err);
      console.error(`[marketing] ERROR ${parsed.phone}: ${error}`);
      results.push({ phone: parsed.phone, ok: false, error });
    }
  }

  const ok = results.length > 0 && results.every((result) => result.ok);
  return {
    status: httpStatus(results),
    body: {
      ok,
      template: template.name,
      language: template.language,
      header: headerKind(template),
      results,
    },
  };
}

module.exports = {
  TEMPLATE_BUTTONS,
  OPT_OUT_ACK,
  DEFAULT_DELAY_MS,
  MAX_BATCH,
  sleep,
  templateOptions,
  routeButtonId,
  isOptOut,
  optOutReason,
  isPresupuestoText,
  normalizePhone,
  collectPhones,
  formatMetaError,
  sendCampaign,
};

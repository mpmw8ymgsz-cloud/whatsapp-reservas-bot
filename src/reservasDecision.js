const db = require('./db');
const wa = require('./wa');
const {
  estadoOf,
  sanitizeReason,
  isWindowOpen,
  isSessionWindowError,
  customerConfirmed,
  customerRejected,
  adminDelivered,
  adminNotDelivered,
  decisionResult,
} = require('./confirmacion');

function customerText(row, status) {
  return status === 'rejected' ? customerRejected(row) : customerConfirmed(row);
}

async function syncHotel(row, action) {
  if (row.type !== 'hotel') return '';
  const match = String(row.details || '').match(/\bPMS\s+([A-Za-z0-9_-]+)/);
  if (!match) return '';
  const hotelApi = require('./hotelApi');
  const pmsId = match[1];
  const result =
    action === 'reject' ? await hotelApi.deleteReservation(pmsId) : await hotelApi.confirmReservation(pmsId);
  if (result && result.ok === false) {
    return `\n⚠️ No se pudo actualizar el PMS (${pmsId}): ${result.msg || 'error'}`;
  }
  return '';
}

function withNote(text, note) {
  return note ? `${text}${note}` : text;
}

async function applyDecision({ id, action, reason } = {}) {
  const verb = action === 'reject' ? 'reject' : 'confirm';
  const status = verb === 'reject' ? 'rejected' : 'confirmed';
  const cleanReason = verb === 'reject' ? sanitizeReason(reason) : '';
  let targetId = id == null || id === '' ? null : Number(id);

  if (targetId != null && (!Number.isInteger(targetId) || targetId <= 0)) {
    return decisionResult(400, 'El número de solicitud no es válido.');
  }

  if (targetId == null) {
    const pending = await db.listPendingReservations();
    if (pending.length === 0) {
      return decisionResult(404, 'No hay solicitudes pendientes.');
    }
    if (pending.length > 1) {
      const sample = pending
        .slice(0, 12)
        .map((row) => `#${row.id} · ${row.name || 'sin nombre'} · ${row.date || ''}`.trim())
        .join('\n');
      const example = verb === 'reject' ? 'NO' : 'OK';
      return decisionResult(
        409,
        `Hay ${pending.length} solicitudes pendientes. Indica el número:\n${sample}\n\nEjemplo: ${example} ${pending[0].id}`
      );
    }
    targetId = Number(pending[0].id);
  }

  const row = await db.getReservation(targetId);
  if (!row) {
    return decisionResult(404, `No encuentro la solicitud #${targetId}.`, { id: targetId, code: String(targetId) });
  }
  if (row.status !== 'pending') {
    const estado = estadoOf(row.status);
    return decisionResult(409, `La solicitud #${targetId} ya está ${estado}. No la he vuelto a cambiar.`, {
      id: targetId,
      code: String(targetId),
      status: row.status,
      estado,
    });
  }

  const windowState = isWindowOpen(await db.getLastInbound(row.phone));
  const knownClosed = windowState === false;
  const updated = await db.updateReservationDecision(targetId, {
    status,
    reason: cleanReason || null,
    customerNotice: knownClosed ? 'deferred' : null,
  });
  if (!updated) {
    return decisionResult(409, `La solicitud #${targetId} ya no estaba pendiente.`, {
      id: targetId,
      code: String(targetId),
    });
  }

  const view = {
    ...row,
    id: targetId,
    status,
    reject_reason: cleanReason,
  };

  let hotelNote = '';
  try {
    hotelNote = await syncHotel(view, verb);
  } catch (err) {
    hotelNote = `\n⚠️ No se pudo actualizar el PMS: ${err.message}`;
  }

  let customerNotified = false;
  let notice = knownClosed ? 'deferred' : null;

  if (!knownClosed) {
    try {
      await wa.sendText(row.phone, customerText(view, status));
      customerNotified = true;
      notice = 'sent';
      await db.setCustomerNotice(targetId, 'sent');
    } catch (err) {
      notice = 'deferred';
      try {
        await db.setCustomerNotice(targetId, 'deferred');
      } catch (markErr) {
        console.error(`[decision] no se pudo dejar pendiente el aviso #${targetId}: ${markErr.message}`);
      }
      const why = isSessionWindowError(err) ? 'ventana cerrada' : 'envío fallido';
      console.error(`[decision] #${targetId} ${status} sin aviso al cliente (${why})`);
      const adminText = withNote(adminNotDelivered(view, status), hotelNote);
      return decisionResult(200, adminText, {
        id: targetId,
        code: String(targetId),
        status,
        estado: estadoOf(status),
        customerNotified: false,
        windowOpen: false,
        notice,
      });
    }
  }

  const adminText = withNote(
    notice === 'sent' ? adminDelivered(view, status) : adminNotDelivered(view, status),
    hotelNote
  );
  console.log(`[decision] #${targetId} ${status} aviso=${notice}`);
  return decisionResult(200, adminText, {
    id: targetId,
    code: String(targetId),
    status,
    estado: estadoOf(status),
    customerNotified,
    windowOpen: windowState === true,
    notice,
  });
}

module.exports = { applyDecision, customerText };

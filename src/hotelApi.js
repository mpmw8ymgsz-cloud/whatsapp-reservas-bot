const axios = require('axios');

// API del PMS del hotel (app de reservas de Don Fadrique). Endpoints públicos sin auth.
const BASE = 'https://hotel.palaciocondealdana.com';

async function getRooms() {
  const { data } = await axios.get(`${BASE}/api/habitaciones`, { timeout: 15000 });
  return data.filter((h) => h.activa);
}

async function getReservations() {
  const { data } = await axios.get(`${BASE}/api/reservas`, { timeout: 15000 });
  return data;
}

// ¿Se solapan [aEntrada, aSalida) y [bEntrada, bSalida)?  (fechas ISO yyyy-mm-dd)
function overlaps(aEntrada, aSalida, bEntrada, bSalida) {
  return aEntrada < bSalida && aSalida > bEntrada;
}

// Capacidad estimada de una habitación por su tipo
function roomCapacity(room) {
  let cap = room.tipo === 'individual' ? 1 : 2;
  if (room.supletoria) cap += 1;
  return cap;
}

// Busca una habitación libre para el rango dado, adecuada al nº de personas.
// Devuelve el id de habitación o null si no hay ninguna.
async function findFreeRoom(fechaEntrada, fechaSalida, pax) {
  const [rooms, reservas] = await Promise.all([getRooms(), getReservations()]);

  const ocupadas = new Set();
  for (const r of reservas) {
    if (r.estado === 'cancelada') continue;
    if (overlaps(fechaEntrada, fechaSalida, r.fecha_entrada, r.fecha_salida)) {
      ocupadas.add(r.habitacion_id);
    }
  }

  const libres = rooms.filter((h) => !ocupadas.has(h.id) && roomCapacity(h) >= pax);
  if (libres.length === 0) {
    // Sin habitación con capacidad suficiente: probar cualquiera libre como último recurso
    const cualquiera = rooms.filter((h) => !ocupadas.has(h.id));
    if (cualquiera.length === 0) return null;
    cualquiera.sort((a, b) => roomCapacity(b) - roomCapacity(a));
    return cualquiera[0].id;
  }

  // Preferir la habitación más ajustada al nº de personas (no malgastar una triple para 1)
  libres.sort((a, b) => roomCapacity(a) - roomCapacity(b));
  return libres[0].id;
}

// Crea la reserva en el PMS del hotel. Devuelve { ok, id } o { ok:false, msg }.
async function createReservation({ habitacionId, fechaEntrada, fechaSalida, nombre, apellidos, telefono, email, pax, obs }) {
  const datos = {
    habitacion_id: habitacionId,
    fecha_entrada: fechaEntrada,
    fecha_salida: fechaSalida,
    nombre: nombre,
    apellidos: apellidos || '',
    dni: '',
    telefono: telefono || '',
    email: email || '',
    pax: pax,
    tratamiento: 'alojamiento',
    supletoria: 0,
    precio_noche: null,
    precio_desayuno: 12,
    obs: obs || 'Reserva recibida por WhatsApp (bot). Pendiente de confirmar por recepción.',
    estado: 'pendiente',
  };

  try {
    const { data } = await axios.post(`${BASE}/api/reservas`, datos, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 15000,
    });
    return {
      ok: true,
      id: data && data.id ? data.id : null,
      habitacionId,
      precioNoche: data ? parseFloat(data.precio_noche) || 0 : 0,
      precioTotal: data ? parseFloat(data.precio_total) || 0 : 0,
    };
  } catch (err) {
    if (err.response && err.response.status === 409) {
      return { ok: false, msg: (err.response.data && err.response.data.msg) || 'Habitación ocupada' };
    }
    return { ok: false, msg: err.message };
  }
}

// Pasa una reserva existente a 'confirmada' (el PMS espera el objeto completo en el PUT)
async function confirmReservation(id) {
  try {
    const todas = await getReservations();
    const res = todas.find((r) => r.id === id);
    if (!res) return { ok: false, msg: 'Reserva no encontrada en el PMS' };
    res.estado = 'confirmada';
    const { data } = await axios.put(`${BASE}/api/reservas/${id}`, res, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 15000,
    });
    return { ok: true, data };
  } catch (err) {
    return { ok: false, msg: err.message };
  }
}

// Elimina una reserva (se usa si el cliente rechaza el precio, para liberar la habitación)
async function deleteReservation(id) {
  try {
    await axios.delete(`${BASE}/api/reservas/${id}`, { timeout: 15000 });
    return { ok: true };
  } catch (err) {
    return { ok: false, msg: err.message };
  }
}

module.exports = {
  getRooms,
  getReservations,
  findFreeRoom,
  createReservation,
  confirmReservation,
  deleteReservation,
};

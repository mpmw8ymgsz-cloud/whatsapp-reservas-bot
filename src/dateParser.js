const { DateTime } = require('luxon');

const WEEKDAYS = {
  domingo: 7,
  lunes: 1,
  martes: 2,
  miercoles: 3,
  jueves: 4,
  viernes: 5,
  sabado: 6,
};

const COMBINING_MARKS = new RegExp(
  '[' + String.fromCharCode(0x0300) + '-' + String.fromCharCode(0x036f) + ']',
  'g'
);

function normalize(text) {
  return (text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(COMBINING_MARKS, '')
    .trim();
}

// Convierte texto libre en español a una fecha (DateTime al inicio del día, en la zona del restaurante)
function parseDate(text, zone) {
  const now = DateTime.now().setZone(zone).startOf('day');
  const t = normalize(text);
  if (!t) return null;

  if (t === 'hoy') return now;
  if (t.includes('pasado manana') || t.includes('pasadomanana')) return now.plus({ days: 2 });
  if (t === 'manana') return now.plus({ days: 1 });

  // yyyy-mm-dd
  let m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) {
    const dt = DateTime.fromObject(
      { year: +m[1], month: +m[2], day: +m[3] },
      { zone }
    ).startOf('day');
    return dt.isValid ? dt : null;
  }

  // dd/mm o dd-mm, con año opcional
  m = t.match(/^(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?$/);
  if (m) {
    const day = parseInt(m[1], 10);
    const month = parseInt(m[2], 10);
    let year = m[3] ? parseInt(m[3], 10) : now.year;
    if (year < 100) year += 2000;
    let dt = DateTime.fromObject({ day, month, year }, { zone }).startOf('day');
    if (!dt.isValid) return null;
    if (!m[3] && dt < now) dt = dt.plus({ years: 1 });
    return dt;
  }

  // día de la semana, con "proximo/que viene" opcional
  for (const [name, weekday] of Object.entries(WEEKDAYS)) {
    if (t.includes(name)) {
      let dt = now.set({ weekday });
      if (dt < now) dt = dt.plus({ weeks: 1 });
      if ((t.includes('proximo') || t.includes('que viene')) && dt.hasSame(now, 'day')) {
        dt = dt.plus({ weeks: 1 });
      }
      return dt;
    }
  }

  return null;
}

// Devuelve una lista de horas candidatas {hour, minute} a partir de texto libre
function parseTimeCandidates(text) {
  const t = normalize(text).replace(/\s+/g, ' ').trim();
  if (!t) return [];

  let m = t.match(/^(\d{1,2})[:h.](\d{2})\s*(am|pm)?$/);
  if (m) {
    let hour = parseInt(m[1], 10);
    const minute = parseInt(m[2], 10);
    if (m[3] === 'pm' && hour < 12) hour += 12;
    if (m[3] === 'am' && hour === 12) hour = 0;
    return [{ hour, minute }];
  }

  m = t.match(/^(\d{1,2})\s*(am|pm)$/);
  if (m) {
    let hour = parseInt(m[1], 10);
    if (m[2] === 'pm' && hour < 12) hour += 12;
    if (m[2] === 'am' && hour === 12) hour = 0;
    return [{ hour, minute: 0 }];
  }

  m = t.match(/^(\d{1,2})$/);
  if (m) {
    const hour = parseInt(m[1], 10);
    if (hour >= 0 && hour <= 23) {
      const candidates = [{ hour, minute: 0 }];
      if (hour <= 11) candidates.push({ hour: hour + 12, minute: 0 });
      return candidates;
    }
  }

  return [];
}

function hmToObj(hm) {
  const [hour, minute] = hm.split(':').map(Number);
  return { hour, minute, second: 0, millisecond: 0 };
}

// Genera la lista de horarios "HH:mm" disponibles para una fecha, según la configuración del restaurante
function getSlotsForDate(dt, restaurantConfig) {
  const key = dt.weekday % 7; // luxon: 1=lunes..7=domingo -> aquí 0=domingo..6=sabado
  const ranges = restaurantConfig.schedule[key];
  if (!ranges) return [];

  const slots = [];
  for (const [start, end] of ranges) {
    let cursor = dt.set(hmToObj(start));
    let endDt = dt.set(hmToObj(end));
    if (endDt <= cursor) endDt = endDt.plus({ days: 1 }); // franja que cruza medianoche
    while (cursor < endDt) {
      slots.push(cursor.toFormat('HH:mm'));
      cursor = cursor.plus({ minutes: restaurantConfig.slotMinutes });
    }
  }
  return slots;
}

module.exports = { parseDate, parseTimeCandidates, getSlotsForDate, normalize };

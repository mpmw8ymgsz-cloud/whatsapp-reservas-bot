const axios = require('axios');
const config = require('./config');

const baseUrl = config.tursoUrl.replace(/^libsql:\/\//, 'https://');

function toHranaArg(v) {
  if (v === null || v === undefined) return { type: 'null' };
  if (typeof v === 'number') {
    return Number.isInteger(v) ? { type: 'integer', value: String(v) } : { type: 'float', value: v };
  }
  return { type: 'text', value: String(v) };
}

function cellToValue(cell) {
  if (!cell || cell.type === 'null') return null;
  if (cell.type === 'integer') return Number(cell.value);
  return cell.value;
}

function rowsToObjects(result) {
  const names = result.cols.map((c) => c.name);
  return result.rows.map((row) => {
    const obj = {};
    row.forEach((cell, i) => {
      obj[names[i]] = cellToValue(cell);
    });
    return obj;
  });
}

async function execute(sql, args = []) {
  const { data } = await axios.post(
    `${baseUrl}/v2/pipeline`,
    {
      requests: [
        { type: 'execute', stmt: { sql, args: args.map(toHranaArg) } },
        { type: 'close' },
      ],
    },
    { headers: { Authorization: `Bearer ${config.tursoAuthToken}` } }
  );
  const result = data.results[0];
  if (result.type === 'error') {
    throw new Error(result.error.message);
  }
  return result.response.result;
}

const ready = (async () => {
  await execute(`CREATE TABLE IF NOT EXISTS reservations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    phone TEXT NOT NULL,
    name TEXT NOT NULL,
    party_size INTEGER NOT NULL,
    date TEXT NOT NULL,
    time TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'confirmed',
    created_at TEXT NOT NULL
  )`);
  await execute(`CREATE TABLE IF NOT EXISTS sessions (
    phone TEXT PRIMARY KEY,
    step TEXT NOT NULL,
    data TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`);
  await execute(`CREATE TABLE IF NOT EXISTS customers (
    phone TEXT PRIMARY KEY,
    name TEXT,
    updated_at TEXT NOT NULL
  )`);
  // Migraciones sobre tablas ya existentes (ignorar error si la columna ya existe)
  try { await execute(`ALTER TABLE reservations ADD COLUMN type TEXT DEFAULT 'restaurante'`); } catch (e) {}
  try { await execute(`ALTER TABLE reservations ADD COLUMN details TEXT`); } catch (e) {}
})().catch((err) => {
  console.error('Error inicializando la base de datos en Turso:', err.message);
  throw err;
});

module.exports = {
  ready,

  async getSession(phone) {
    await ready;
    const result = await execute('SELECT step, data FROM sessions WHERE phone = ?', [phone]);
    const rows = rowsToObjects(result);
    if (!rows[0]) return null;
    return { step: rows[0].step, data: JSON.parse(rows[0].data) };
  },

  async setSession(phone, step, data) {
    await ready;
    await execute(
      `INSERT INTO sessions (phone, step, data, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(phone) DO UPDATE SET step = excluded.step, data = excluded.data, updated_at = excluded.updated_at`,
      [phone, step, JSON.stringify(data), new Date().toISOString()]
    );
  },

  async clearSession(phone) {
    await ready;
    await execute('DELETE FROM sessions WHERE phone = ?', [phone]);
  },

  async countReservations(date, time, type) {
    await ready;
    const result = await execute(
      `SELECT COUNT(*) as c FROM reservations WHERE date = ? AND time = ? AND type = ? AND status = 'confirmed'`,
      [date, time, type]
    );
    return Number(rowsToObjects(result)[0].c);
  },

  async createReservation({ phone, name, partySize, date, time, type, details }) {
    await ready;
    const result = await execute(
      `INSERT INTO reservations (phone, name, party_size, date, time, type, details, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'confirmed', ?)`,
      [phone, name, partySize, date, time, type || 'restaurante', details || null, new Date().toISOString()]
    );
    return Number(result.last_insert_rowid);
  },

  async getUpcomingReservations(phone) {
    await ready;
    const today = new Date().toISOString().slice(0, 10);
    const result = await execute(
      `SELECT * FROM reservations WHERE phone = ? AND status = 'confirmed' AND date >= ? ORDER BY date, time`,
      [phone, today]
    );
    return rowsToObjects(result);
  },

  async cancelReservation(id, phone) {
    await ready;
    const result = await execute(
      `UPDATE reservations SET status = 'cancelled' WHERE id = ? AND phone = ?`,
      [id, phone]
    );
    return result.affected_row_count > 0;
  },

  async upsertCustomerName(phone, name) {
    await ready;
    await execute(
      `INSERT INTO customers (phone, name, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(phone) DO UPDATE SET name = excluded.name, updated_at = excluded.updated_at`,
      [phone, name, new Date().toISOString()]
    );
  },

  async getCustomerName(phone) {
    await ready;
    const result = await execute('SELECT name FROM customers WHERE phone = ?', [phone]);
    const rows = rowsToObjects(result);
    return rows[0] ? rows[0].name : null;
  },
};

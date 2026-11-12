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

function phoneDigits(value) {
  if (value == null) return '';
  let digits = String(value).trim().replace(/[\s().-]/g, '');
  if (digits.startsWith('+')) digits = digits.slice(1);
  else if (digits.startsWith('00')) digits = digits.slice(2);
  return digits.replace(/\D/g, '');
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

const PENDING_EVENT_TYPES = ['evento_empresa', 'evento_congreso', 'evento_boda'];

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
  try { await execute(`ALTER TABLE reservations ADD COLUMN admin_alert TEXT`); } catch (e) {}
  await execute(`CREATE TABLE IF NOT EXISTS marketing_optouts (
    phone TEXT PRIMARY KEY,
    reason TEXT,
    created_at TEXT NOT NULL
  )`);
  // Meta avisa después del envío (sent, delivered, read, failed). Una fila por aviso.
  await execute(`CREATE TABLE IF NOT EXISTS message_status (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    wamid TEXT NOT NULL,
    recipient TEXT,
    status TEXT,
    error_code TEXT,
    error_title TEXT,
    error_detail TEXT,
    ts TEXT
  )`);
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

  async createReservation({ phone, name, partySize, date, time, type, details, status }) {
    await ready;
    const statusValue = status === 'pending' ? 'pending' : 'confirmed';
    const result = await execute(
      `INSERT INTO reservations (phone, name, party_size, date, time, type, details, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [phone, name, partySize, date, time, type || 'restaurante', details || null, statusValue, new Date().toISOString()]
    );
    return Number(result.last_insert_rowid);
  },

  async getReservationsByDateRange(fromDate, toDate) {
    await ready;
    const result = await execute(
      `SELECT * FROM reservations WHERE status = 'confirmed' AND date >= ? AND date <= ? ORDER BY date, time`,
      [fromDate, toDate]
    );
    return rowsToObjects(result);
  },

  async getUpcomingReservations(phone) {
    await ready;
    const today = new Date().toISOString().slice(0, 10);
    const typeSlots = PENDING_EVENT_TYPES.map(() => '?').join(', ');
    const result = await execute(
      `SELECT * FROM reservations
       WHERE phone = ? AND date >= ?
         AND (status = 'confirmed' OR (status = 'pending' AND type IN (${typeSlots})))
       ORDER BY date, time`,
      [phone, today, ...PENDING_EVENT_TYPES]
    );
    return rowsToObjects(result);
  },

  async getPendingEventRequests() {
    await ready;
    const typeSlots = PENDING_EVENT_TYPES.map(() => '?').join(', ');
    const result = await execute(
      `SELECT * FROM reservations
       WHERE status = 'pending' AND type IN (${typeSlots})
       ORDER BY date, time, id`,
      PENDING_EVENT_TYPES
    );
    return rowsToObjects(result);
  },

  async getReservationById(id, phone) {
    await ready;
    const result = await execute('SELECT * FROM reservations WHERE id = ? AND phone = ?', [id, phone]);
    return rowsToObjects(result)[0] || null;
  },

  async cancelReservation(id, phone) {
    await ready;
    const result = await execute(
      `UPDATE reservations SET status = 'cancelled' WHERE id = ? AND phone = ?`,
      [id, phone]
    );
    return result.affected_row_count > 0;
  },

  async markAdminAlertFailed(id) {
    await ready;
    await execute(
      `UPDATE reservations
       SET admin_alert = 'failed',
           details = CASE
             WHEN details IS NULL OR TRIM(details) = '' THEN 'Aviso admin: no enviado'
             WHEN INSTR(details, 'Aviso admin: no enviado') > 0 THEN details
             ELSE details || ' | Aviso admin: no enviado'
           END
       WHERE id = ?`,
      [id]
    );
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

  async markMarketingOptOut(phone, reason) {
    await ready;
    await execute(
      `INSERT INTO marketing_optouts (phone, reason, created_at) VALUES (?, ?, ?)
       ON CONFLICT(phone) DO UPDATE SET reason = excluded.reason, created_at = excluded.created_at`,
      [phone, reason || 'baja', new Date().toISOString()]
    );
  },

  async isMarketingOptOut(phone) {
    await ready;
    const result = await execute('SELECT phone FROM marketing_optouts WHERE phone = ?', [phone]);
    return rowsToObjects(result).length > 0;
  },

  async saveMessageStatus({ wamid, recipient, status, error_code, error_title, error_detail, ts }) {
    await ready;
    await execute(
      `INSERT INTO message_status (wamid, recipient, status, error_code, error_title, error_detail, ts)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        wamid != null ? String(wamid) : '',
        recipient != null ? String(recipient) : null,
        status != null ? String(status) : null,
        error_code != null && error_code !== '' ? String(error_code) : null,
        error_title != null && error_title !== '' ? String(error_title) : null,
        error_detail != null && error_detail !== '' ? String(error_detail) : null,
        ts != null && ts !== '' ? String(ts) : null,
      ]
    );
  },

  async listMessageStatuses({ wamid, phone, limit = 50 } = {}) {
    await ready;
    const filters = [];
    const args = [];
    const wamidFilter = wamid != null && String(wamid).trim() !== '' ? String(wamid).trim() : '';
    const phoneFilter = phoneDigits(phone);
    if (wamidFilter) {
      filters.push('wamid = ?');
      args.push(wamidFilter);
    }
    if (phoneFilter) {
      filters.push('recipient = ?');
      args.push(phoneFilter);
    }
    const requested = Number(limit);
    const cap = Math.min(Number.isFinite(requested) && requested > 0 ? Math.floor(requested) : 50, 50);
    args.push(cap);
    const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
    const result = await execute(
      `SELECT id, wamid, recipient, status, error_code, error_title, error_detail, ts
       FROM message_status
       ${where}
       ORDER BY id DESC
       LIMIT ?`,
      args
    );
    return rowsToObjects(result);
  },
};

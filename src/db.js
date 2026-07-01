const { createClient } = require('@libsql/client');
const config = require('./config');

const client = createClient({
  url: config.tursoUrl,
  authToken: config.tursoAuthToken,
});

const ready = client.batch(
  [
    `CREATE TABLE IF NOT EXISTS reservations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      phone TEXT NOT NULL,
      name TEXT NOT NULL,
      party_size INTEGER NOT NULL,
      date TEXT NOT NULL,
      time TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'confirmed',
      created_at TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS sessions (
      phone TEXT PRIMARY KEY,
      step TEXT NOT NULL,
      data TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS customers (
      phone TEXT PRIMARY KEY,
      name TEXT,
      updated_at TEXT NOT NULL
    )`,
  ],
  'write'
);

module.exports = {
  ready,

  async getSession(phone) {
    await ready;
    const result = await client.execute({
      sql: 'SELECT step, data FROM sessions WHERE phone = ?',
      args: [phone],
    });
    const row = result.rows[0];
    if (!row) return null;
    return { step: row.step, data: JSON.parse(row.data) };
  },

  async setSession(phone, step, data) {
    await ready;
    await client.execute({
      sql: `INSERT INTO sessions (phone, step, data, updated_at) VALUES (?, ?, ?, ?)
            ON CONFLICT(phone) DO UPDATE SET step = excluded.step, data = excluded.data, updated_at = excluded.updated_at`,
      args: [phone, step, JSON.stringify(data), new Date().toISOString()],
    });
  },

  async clearSession(phone) {
    await ready;
    await client.execute({ sql: 'DELETE FROM sessions WHERE phone = ?', args: [phone] });
  },

  async countReservations(date, time) {
    await ready;
    const result = await client.execute({
      sql: `SELECT COUNT(*) as c FROM reservations WHERE date = ? AND time = ? AND status = 'confirmed'`,
      args: [date, time],
    });
    return Number(result.rows[0].c);
  },

  async createReservation({ phone, name, partySize, date, time }) {
    await ready;
    const result = await client.execute({
      sql: `INSERT INTO reservations (phone, name, party_size, date, time, status, created_at)
            VALUES (?, ?, ?, ?, ?, 'confirmed', ?)`,
      args: [phone, name, partySize, date, time, new Date().toISOString()],
    });
    return Number(result.lastInsertRowid);
  },

  async getUpcomingReservations(phone) {
    await ready;
    const today = new Date().toISOString().slice(0, 10);
    const result = await client.execute({
      sql: `SELECT * FROM reservations WHERE phone = ? AND status = 'confirmed' AND date >= ? ORDER BY date, time`,
      args: [phone, today],
    });
    return result.rows;
  },

  async cancelReservation(id, phone) {
    await ready;
    const result = await client.execute({
      sql: `UPDATE reservations SET status = 'cancelled' WHERE id = ? AND phone = ?`,
      args: [id, phone],
    });
    return result.rowsAffected > 0;
  },

  async upsertCustomerName(phone, name) {
    await ready;
    await client.execute({
      sql: `INSERT INTO customers (phone, name, updated_at) VALUES (?, ?, ?)
            ON CONFLICT(phone) DO UPDATE SET name = excluded.name, updated_at = excluded.updated_at`,
      args: [phone, name, new Date().toISOString()],
    });
  },

  async getCustomerName(phone) {
    await ready;
    const result = await client.execute({
      sql: 'SELECT name FROM customers WHERE phone = ?',
      args: [phone],
    });
    return result.rows[0] ? result.rows[0].name : null;
  },
};

const QRCode = require('qrcode');

let sock = null;
let latestQr = null;
let connectionStatus = 'iniciando';
const pendingMenus = new Map(); // phone -> [{id, title}]

function toJid(phone) {
  return `${phone}@s.whatsapp.net`;
}

function fromJid(jid) {
  return (jid || '').split('@')[0];
}

async function start(onMessage) {
  const {
    default: makeWASocket,
    DisconnectReason,
    useMultiFileAuthState,
    fetchLatestBaileysVersion,
  } = require('@whiskeysockets/baileys');

  const pino = require('pino');
  const logger = pino({ level: 'silent' });

  const { state, saveCreds } = await useMultiFileAuthState('./baileys_auth');
  const { version } = await fetchLatestBaileysVersion();

  sock = makeWASocket({ version, auth: state, printQRInTerminal: false, logger });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', (update) => {
    const { connection, qr, lastDisconnect } = update;
    if (qr) {
      latestQr = qr;
      connectionStatus = 'esperando_qr';
      console.log('Nuevo código QR disponible en /qr');
    }
    if (connection === 'open') {
      latestQr = null;
      connectionStatus = 'conectado';
      console.log('Baileys conectado a WhatsApp correctamente');
    }
    if (connection === 'close') {
      connectionStatus = 'desconectado';
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const loggedOut = statusCode === DisconnectReason.loggedOut;
      console.log('Conexión de Baileys cerrada. ¿Sesión cerrada?', loggedOut);
      if (!loggedOut) {
        start(onMessage).catch((err) => console.error('Error reconectando Baileys:', err));
      }
    }
  });

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;
    for (const msg of messages) {
      if (!msg.message || msg.key.fromMe) continue;
      const from = fromJid(msg.key.remoteJid);
      let text =
        msg.message.conversation ||
        msg.message.extendedTextMessage?.text ||
        msg.message.buttonsResponseMessage?.selectedDisplayText ||
        msg.message.listResponseMessage?.title ||
        '';
      let buttonId = null;

      const pending = pendingMenus.get(from);
      if (pending && /^\d+$/.test(text.trim())) {
        const idx = parseInt(text.trim(), 10) - 1;
        if (pending[idx]) {
          buttonId = pending[idx].id;
          text = pending[idx].title;
        }
      }
      pendingMenus.delete(from);

      try {
        await sock.readMessages([msg.key]);
      } catch (err) {
        console.error('Error marcando como leído (Baileys):', err.message);
      }

      await onMessage(from, text, buttonId);
    }
  });
}

async function sendText(to, body) {
  await sock.sendMessage(toJid(to), { text: body });
}

async function sendButtons(to, bodyText, buttons) {
  pendingMenus.set(to, buttons);
  const list = buttons.map((b, i) => `${i + 1}. ${b.title}`).join('\n');
  await sock.sendMessage(toJid(to), { text: `${bodyText}\n\n${list}\n\n_(Responde con el número de la opción)_` });
}

async function sendList(to, bodyText, buttonText, rows) {
  pendingMenus.set(to, rows);
  const list = rows
    .map((r, i) => `${i + 1}. ${r.title}${r.description ? ' - ' + r.description : ''}`)
    .join('\n');
  await sock.sendMessage(toJid(to), { text: `${bodyText}\n\n${list}\n\n_(Responde con el número de la opción)_` });
}

async function markRead() {
  // el marcado como leído se hace dentro del propio listener de mensajes
}

async function getQrDataUrl() {
  if (!latestQr) return null;
  return QRCode.toDataURL(latestQr);
}

function getStatus() {
  return connectionStatus;
}

module.exports = { start, sendText, sendButtons, sendList, markRead, getQrDataUrl, getStatus };

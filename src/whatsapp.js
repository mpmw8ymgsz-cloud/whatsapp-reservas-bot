const axios = require('axios');
const config = require('./config');

function client() {
  return axios.create({
    baseURL: `https://graph.facebook.com/v20.0/${config.phoneNumberId}/messages`,
    headers: {
      Authorization: `Bearer ${config.metaToken}`,
      'Content-Type': 'application/json',
    },
  });
}

async function send(payload, label) {
  try {
    const { data } = await client().post('', payload);
    console.log(`[send:${label}] OK ->`, JSON.stringify(data));
    return data;
  } catch (err) {
    console.error(`[send:${label}] ERROR ->`, JSON.stringify(err?.response?.data || err.message));
    throw err;
  }
}

async function sendText(to, body) {
  await send({
    messaging_product: 'whatsapp',
    to,
    type: 'text',
    text: { body },
  }, 'text');
}

// buttons: [{ id, title }] - máximo 3 botones, título máx. 20 caracteres
async function sendButtons(to, bodyText, buttons) {
  await send({
    messaging_product: 'whatsapp',
    to,
    type: 'interactive',
    interactive: {
      type: 'button',
      body: { text: bodyText },
      action: {
        buttons: buttons.map((b) => ({
          type: 'reply',
          reply: { id: b.id, title: b.title },
        })),
      },
    },
  }, 'buttons');
}

// rows: [{ id, title, description? }] - máximo 10 filas
async function sendList(to, bodyText, buttonText, rows) {
  await send({
    messaging_product: 'whatsapp',
    to,
    type: 'interactive',
    interactive: {
      type: 'list',
      body: { text: bodyText },
      action: {
        button: buttonText,
        sections: [{ title: 'Opciones', rows }],
      },
    },
  }, 'list');
}

async function markRead(messageId) {
  await client().post('', {
    messaging_product: 'whatsapp',
    status: 'read',
    message_id: messageId,
  });
}

module.exports = { sendText, sendButtons, sendList, markRead };

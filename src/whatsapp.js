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

// Plantilla de la Cloud API. La cabecera IMAGE y los payloads de botones
// solo se incluyen si se piden: el texto del body vive en la plantilla de Meta.
function buildTemplatePayload(to, options = {}) {
  if (!to) throw new Error('falta el teléfono de destino');
  if (!options.name) throw new Error('falta el nombre de la plantilla');
  if (!options.language) throw new Error('falta el idioma de la plantilla');

  const components = [];
  if (options.headerMediaId) {
    components.push({
      type: 'header',
      parameters: [{ type: 'image', image: { id: String(options.headerMediaId) } }],
    });
  } else if (options.headerImageUrl) {
    components.push({
      type: 'header',
      parameters: [{ type: 'image', image: { link: String(options.headerImageUrl) } }],
    });
  }

  const buttons = Array.isArray(options.buttons) ? options.buttons : [];
  buttons.forEach((button, index) => {
    if (!button || button.payload == null || button.payload === '') return;
    components.push({
      type: 'button',
      sub_type: 'quick_reply',
      index: String(button.index ?? index),
      parameters: [{ type: 'payload', payload: String(button.payload) }],
    });
  });

  const template = {
    name: options.name,
    language: { code: options.language },
  };
  if (components.length) template.components = components;

  return {
    messaging_product: 'whatsapp',
    to,
    type: 'template',
    template,
  };
}

async function sendTemplate(to, options) {
  return send(buildTemplatePayload(to, options), 'template');
}

module.exports = { sendText, sendButtons, sendList, markRead, buildTemplatePayload, sendTemplate };

const express = require('express');
const config = require('./config');
const wa = require('./whatsapp');
const { privacyHtml } = require('./privacyPage');

function extractText(message) {
  if (message.type === 'text') return message.text.body;
  if (message.type === 'interactive' && message.interactive.type === 'button_reply') {
    return message.interactive.button_reply.title;
  }
  if (message.type === 'interactive' && message.interactive.type === 'list_reply') {
    return message.interactive.list_reply.title;
  }
  return '';
}

function extractButtonId(message) {
  if (message.type === 'interactive' && message.interactive.type === 'button_reply') {
    return message.interactive.button_reply.id;
  }
  if (message.type === 'interactive' && message.interactive.type === 'list_reply') {
    return message.interactive.list_reply.id;
  }
  return null;
}

function start(onMessage) {
  const app = express();
  app.use(express.json());

  app.get('/webhook', (req, res) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode === 'subscribe' && token === config.verifyToken) {
      return res.status(200).send(challenge);
    }
    return res.sendStatus(403);
  });

  app.post('/webhook', async (req, res) => {
    res.sendStatus(200);

    try {
      const value = req.body.entry?.[0]?.changes?.[0]?.value;
      const message = value?.messages?.[0];
      if (!message) return;

      const from = message.from;
      wa.markRead(message.id).catch((err) => console.error('Error marcando como leído:', err.message));
      await onMessage(from, extractText(message), extractButtonId(message));
    } catch (err) {
      console.error('Error procesando webhook:', err);
    }
  });

  app.get('/', (req, res) => res.send('Bot de reservas activo (modo Meta Cloud API)'));
  app.get('/privacy', (req, res) => res.type('html').send(privacyHtml()));

  app.listen(config.port, () => {
    console.log(`Servidor escuchando en el puerto ${config.port} (proveedor: meta)`);
  });
}

module.exports = { start };

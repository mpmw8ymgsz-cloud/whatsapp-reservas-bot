const express = require('express');
const config = require('./config');
const wa = require('./whatsapp');
const { handleIncoming } = require('./conversation');

const app = express();
app.use(express.json());

// Verificación del webhook (Meta hace un GET la primera vez que configuras la URL)
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === config.verifyToken) {
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

// Recepción de mensajes entrantes
app.post('/webhook', async (req, res) => {
  res.sendStatus(200); // responder rápido, Meta reintenta si tarda demasiado

  try {
    const value = req.body.entry?.[0]?.changes?.[0]?.value;
    const message = value?.messages?.[0];
    if (!message) return; // puede ser una notificación de "status" (entregado/leído), no un mensaje

    const from = message.from;
    wa.markRead(message.id).catch((err) => console.error('Error marcando como leído:', err.message));
    await handleIncoming(from, message);
  } catch (err) {
    console.error('Error procesando webhook:', err);
  }
});

app.get('/', (req, res) => res.send('Bot de reservas activo'));

app.listen(config.port, () => {
  console.log(`Servidor escuchando en el puerto ${config.port}`);
});

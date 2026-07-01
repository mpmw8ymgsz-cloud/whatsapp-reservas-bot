const express = require('express');
const config = require('./config');
const wa = require('./whatsapp');
const { handleIncoming } = require('./conversation');

process.on('unhandledRejection', (err) => {
  console.error('Promesa no controlada:', err);
});
process.on('uncaughtException', (err) => {
  console.error('Excepción no controlada:', err);
});

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

app.get('/privacy', (req, res) => {
  res.type('html').send(`<!DOCTYPE html>
<html lang="es">
<head><meta charset="utf-8"><title>Política de privacidad - ${config.restaurant.name}</title></head>
<body style="font-family: sans-serif; max-width: 700px; margin: 40px auto; line-height: 1.6;">
  <h1>Política de privacidad</h1>
  <p>Este servicio es un asistente automatizado de WhatsApp para gestionar reservas de mesa en ${config.restaurant.name}.</p>

  <h2>Datos que recogemos</h2>
  <p>Cuando escribes a nuestro número de WhatsApp, recogemos: tu número de teléfono, tu nombre (si nos lo indicas), y los detalles de la reserva (fecha, hora, número de personas).</p>

  <h2>Uso de los datos</h2>
  <p>Estos datos se usan únicamente para gestionar tu reserva y para poder contactarte en relación con ella. No se comparten con terceros ni se usan con fines publicitarios.</p>

  <h2>Almacenamiento</h2>
  <p>Los datos se guardan en una base de datos segura y se conservan mientras sean necesarios para la gestión de reservas del restaurante.</p>

  <h2>Tus derechos</h2>
  <p>Puedes solicitar la eliminación de tus datos o de tus reservas escribiendo directamente a este mismo número de WhatsApp.</p>

  <h2>Contacto</h2>
  <p>Para cualquier consulta sobre esta política, contacta con nosotros a través de WhatsApp.</p>
</body>
</html>`);
});

app.listen(config.port, () => {
  console.log(`Servidor escuchando en el puerto ${config.port}`);
});

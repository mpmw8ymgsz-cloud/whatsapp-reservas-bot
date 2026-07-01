const express = require('express');
const config = require('./config');
const wa = require('./whatsapp-baileys');
const { privacyHtml } = require('./privacyPage');

async function start(onMessage) {
  const app = express();

  app.get('/', (req, res) => res.send(`Bot de reservas activo (modo Baileys). Estado: ${wa.getStatus()}`));
  app.get('/privacy', (req, res) => res.type('html').send(privacyHtml()));

  app.get('/qr', async (req, res) => {
    const dataUrl = await wa.getQrDataUrl();
    if (!dataUrl) {
      return res.send(
        `<h2>Estado: ${wa.getStatus()}</h2><p>No hay un código QR pendiente ahora mismo. Si ya está "conectado", no hace falta escanear nada. Si quieres uno nuevo, recarga esta página en unos segundos.</p>`
      );
    }
    res.send(
      `<h2>Escanea este código con WhatsApp (Ajustes → Dispositivos vinculados → Vincular dispositivo)</h2><img src="${dataUrl}" style="width:300px;height:300px" /><p>Esta página se actualiza sola cada 5 segundos.</p><script>setTimeout(() => location.reload(), 5000)</script>`
    );
  });

  app.listen(config.port, () => {
    console.log(`Servidor escuchando en el puerto ${config.port} (proveedor: baileys)`);
  });

  await wa.start(onMessage);
}

module.exports = { start };

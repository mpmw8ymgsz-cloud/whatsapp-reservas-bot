const config = require('./config');

function privacyHtml() {
  return `<!DOCTYPE html>
<html lang="es">
<head><meta charset="utf-8"><title>Política de privacidad - ${config.business.name}</title></head>
<body style="font-family: sans-serif; max-width: 700px; margin: 40px auto; line-height: 1.6;">
  <h1>Política de privacidad</h1>
  <p>Este servicio es un asistente automatizado de WhatsApp para gestionar reservas en ${config.business.name}.</p>

  <h2>Datos que recogemos</h2>
  <p>Cuando escribes a nuestro número de WhatsApp, recogemos: tu número de teléfono, tu nombre (si nos lo indicas), y los detalles de la reserva (fecha, hora, número de personas).</p>

  <h2>Uso de los datos</h2>
  <p>Estos datos se usan únicamente para gestionar tu reserva y para poder contactarte en relación con ella. No se comparten con terceros ni se usan con fines publicitarios.</p>

  <h2>Almacenamiento</h2>
  <p>Los datos se guardan en una base de datos segura y se conservan mientras sean necesarios para la gestión de reservas del negocio.</p>

  <h2>Tus derechos</h2>
  <p>Puedes solicitar la eliminación de tus datos o de tus reservas escribiendo directamente a este mismo número de WhatsApp.</p>

  <h2>Contacto</h2>
  <p>Para cualquier consulta sobre esta política, contacta con nosotros a través de WhatsApp.</p>
</body>
</html>`;
}

module.exports = { privacyHtml };

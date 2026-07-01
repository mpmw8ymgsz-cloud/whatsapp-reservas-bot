# Bot de reservas por WhatsApp

Chatbot para WhatsApp que toma reservas de mesa para un restaurante: pregunta fecha, hora
y número de personas, valida disponibilidad contra el horario configurado, confirma la
reserva y permite consultarla o cancelarla. Usa la **WhatsApp Cloud API oficial de Meta**
(gratuita hasta cierto volumen de mensajes al mes).

Esta guía está pensada para desplegarlo **100% desde el navegador**, sin instalar nada en
tu ordenador ni necesitar permisos de administrador:

- **GitHub** guarda el código.
- **Render** ejecuta el bot 24/7 (capa gratuita, sin tarjeta).
- **Turso** guarda las reservas en una base de datos en la nube (capa gratuita, sin tarjeta,
  no se borra nunca).
- **Meta for Developers** conecta todo con WhatsApp.

## Importante: "Canal" vs "WhatsApp Business Platform"

Si en la app de WhatsApp creaste un **Canal de difusión** (el icono de altavoz, con
"seguidores"), eso **no sirve** para esto: es de un solo sentido, tú publicas y la gente
solo puede reaccionar, no escribirte en privado dentro del canal. Lo que necesitamos es
crear una **app de WhatsApp Business Platform** en developers.facebook.com (pasos abajo),
que es algo completamente distinto y permite conversaciones de ida y vuelta con un bot.

## Paso 1 — Subir el código a GitHub

1. Crea una cuenta gratuita en [github.com](https://github.com) si no tienes una.
2. Crea un repositorio nuevo, vacío, por ejemplo `whatsapp-reservas-bot` (puede ser privado).
3. Sigue las instrucciones que te da GitHub para "push an existing repository" desde esta
   carpeta (`whatsapp-reservas-bot`), usando `git` (ya está instalado en tu PC):

   ```bash
   git init
   git add .
   git commit -m "Bot de reservas inicial"
   git branch -M main
   git remote add origin https://github.com/TU-USUARIO/whatsapp-reservas-bot.git
   git push -u origin main
   ```

## Paso 2 — Crear la base de datos en Turso (gratis, sin tarjeta)

1. Ve a [turso.tech](https://turso.tech) y crea una cuenta gratuita.
2. En el panel web, crea una base de datos nueva (por ejemplo `reservas`).
3. Desde el panel, genera:
   - La **Database URL** (empieza por `libsql://...`).
   - Un **Auth Token** (token de acceso con permisos de lectura/escritura).
4. Guarda ambos datos, los necesitarás en el paso 4.

## Paso 3 — Configurar WhatsApp Cloud API en Meta

1. Entra en [developers.facebook.com](https://developers.facebook.com) y crea una app de
   tipo **Negocio** (Business).
2. Dentro de la app, añade el producto **WhatsApp**.
3. En "API Setup" verás un **número de prueba** gratuito y un **token temporal**. Copia:
   - `Phone number ID`.
   - `Temporary access token` (dura 24h; más abajo se explica cómo tener uno permanente).
4. Añade tu propio número de WhatsApp como "destinatario de prueba" para poder chatear con
   el bot antes de salir a producción.
5. Inventa un texto secreto cualquiera (ej. `mi-restaurante-2026`): lo usarás como
   `VERIFY_TOKEN` en el paso 4 y también al configurar el webhook en el paso 5.

### Token permanente (recomendado para producción)

El token temporal caduca cada 24h. Para uno que no caduque:

1. Ve a **Meta Business Suite → Configuración del negocio → Usuarios del sistema**.
2. Crea un "Usuario del sistema" con rol Admin.
3. Genera un token para ese usuario con el permiso `whatsapp_business_messaging`,
   seleccionando tu app, y marca que no caduque ("Never").

## Paso 4 — Desplegar en Render (gratis, sin tarjeta)

1. Crea una cuenta en [render.com](https://render.com) (puedes entrar con tu GitHub).
2. **New → Web Service** y selecciona el repositorio `whatsapp-reservas-bot` que subiste.
3. Configura:
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Instance Type**: Free
4. En "Environment Variables" añade:
   - `META_TOKEN` (el token de Meta del paso 3)
   - `PHONE_NUMBER_ID` (del paso 3)
   - `VERIFY_TOKEN` (el texto secreto que inventaste)
   - `ADMIN_PHONE` (tu número, formato internacional sin `+`, ej. `34600000000`)
   - `TURSO_DATABASE_URL` (del paso 2)
   - `TURSO_AUTH_TOKEN` (del paso 2)
5. Dale a **Create Web Service**. Render construirá y arrancará el bot; al terminar te da
   una URL pública tipo `https://whatsapp-reservas-bot.onrender.com`.

> Nota: en la capa gratuita, Render "duerme" el servicio tras ~15 min sin tráfico y tarda
> unos 30-60 segundos en despertar con el primer mensaje. Es normal que el primer mensaje
> del día tarde un poco más en responder.

## Paso 5 — Conectar el webhook de Meta con tu bot desplegado

1. En tu app de Meta, ve a **WhatsApp → Configuration**.
2. En "Webhook", pon la URL: `https://tu-app.onrender.com/webhook` y el "Verify token" que
   inventaste en el paso 3 (debe coincidir exactamente con `VERIFY_TOKEN`).
3. Haz clic en "Verify and save".
4. En "Webhook fields", suscríbete al campo `messages`.

A partir de aquí, cualquier mensaje que le escribas al número de prueba llegará al bot.

## Paso 6 — Personalizar tu restaurante

Edita [src/config.js](src/config.js), haz commit y push (Render vuelve a desplegar solo):

- `name`: nombre del restaurante.
- `timezone`: zona horaria (ej. `Europe/Madrid`).
- `schedule`: horario de apertura por día de la semana (0=domingo … 6=sábado). Pon `null`
  en los días cerrados.
- `slotMinutes`: cada cuántos minutos se puede reservar (ej. 30).
- `maxReservationsPerSlot`: cuántas reservas admites como máximo en el mismo horario.
- `maxPartySize`: tamaño máximo de grupo que acepta el bot.
- `advanceBookingDays`: con cuánta antelación se puede reservar.

## Cómo funciona el flujo de conversación

- El usuario escribe **"hola"** o **"menu"** → el bot muestra 3 botones: Reservar, Mis
  reservas, Ayuda.
- **Reservar**: pregunta fecha → hora → nº de personas → nombre (solo la primera vez) →
  resumen y confirmación.
- Si la hora pedida no está disponible o está completa, el bot ofrece una lista con los
  horarios libres más cercanos.
- **Mis reservas**: muestra las reservas futuras del número que escribe, y permite
  cancelarlas seleccionando una de una lista.
- El estado de la conversación y las reservas se guardan en Turso, así que sobreviven a
  reinicios y redeploys del servicio.

## Límites de las capas gratuitas

- **Meta Cloud API**: gratis hasta 1.000 conversaciones de servicio al mes (cada
  conversación es una ventana de 24h con un mismo usuario). Ver
  [precios actualizados](https://developers.facebook.com/docs/whatsapp/pricing).
- **Render Free**: 750 horas/mes, se duerme tras inactividad, sin tarjeta.
- **Turso Free**: 5GB de almacenamiento, 500M lecturas/mes, sin tarjeta, no caduca.

## Próximas mejoras posibles (opcionales)

- Recordatorio automático el día de la reserva.
- Panel web sencillo para que el dueño vea/gestione las reservas sin entrar a Turso.
- Límite de reservas por franja basado en nº de comensales (aforo) en lugar de nº de reservas.
- Multi-idioma si el negocio recibe clientes que no hablan español.

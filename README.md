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
   - `BREVO_API_KEY`, `ALERT_EMAIL`, `ALERT_EMAIL_FROM` y `ALERT_EMAIL_FROM_NAME`
     (el correo de aviso a reservas; sin la clave el bot arranca igual y no envía correo).
     El alta de la cuenta está en la sección [Aviso por correo](#aviso-por-correo-cuando-whatsapp-no-llega-a-nico).
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

- El usuario escribe **"hola"** o **"menu"** → el bot muestra 3 botones: Restaurante,
  Hotel y Eventos.
- **Restaurante**: pregunta fecha → hora → nº de personas → nombre (solo la primera vez) →
  resumen y confirmación. Cerrado martes y miércoles.
- **Hotel**: pregunta entrada, salida y personas, comprueba el PMS y confirma solo si el
  cliente acepta el precio.
- **Eventos**: comidas de Navidad para empresas (menú a medida, desde 55 € + IVA por
  persona, todo diciembre) y solicitudes de congreso o evento grande. Esas solicitudes
  se guardan como *pendientes de presupuesto* (no quedan confirmadas) y salen en `/admin`.
- OTIVM no se ofrece: es un espacio de la zona de cocina y está cerrado fuera de temporada.
- **Cómo llegar**: dirección y enlace para el GPS. El traslado o el autobús de grupos se
  estudia según tamaño y fecha, y se confirma en el presupuesto.
- Si la hora pedida en el restaurante no está disponible o está completa, el bot ofrece
  una lista con los horarios libres más cercanos.
- **Mis reservas**: muestra las reservas futuras del número que escribe, y permite
  cancelarlas seleccionando una de una lista.
- El estado de la conversación y las reservas se guardan en Turso, así que sobreviven a
  reinicios y redeploys del servicio.
- El panel del equipo está en `/admin?key=ADMIN_KEY`.

## Plantilla de Navidad para empresas (envío manual)

El bot puede mandar la plantilla de marketing de la comida de Navidad **solo cuando tú lo pides**.
Desplegar, reiniciar o el cron no envían nada: no hay cron. Cada llamada manda como mucho 20
números, de uno en uno, con una pausa de 1 segundo, y se salta quien haya pedido la baja.

### 1. Crear la plantilla en Meta y esperar a APPROVED

En el administrador de WhatsApp (plantillas de mensaje), crea una plantilla antes de enviar:

- **Nombre:** `comida_navidad_empresas_2026` (o el valor de `MARKETING_TEMPLATE_NAME`)
- **Categoría:** Marketing
- **Idioma:** Spanish (`es`)
- **Cabecera:** Image
- **Cuerpo** (sin variables):

  Hola, os escribimos desde Hostería Don Fadrique (Alba de Tormes) por si este año queréis la comida de Navidad de empresa con nosotros: menú a medida desde 55 € + IVA, espacios para grupos y congresos. Si os interesa, respondéis a este WhatsApp y os preparamos un presupuesto sin compromiso.

- **Pie** (el borrador lleva esta errata, a propósito): `Para no recibir más mensajes de este tipo, responded BAJA.`
- **Botones de respuesta rápida**, en este orden:
  1. `Pedir presupuesto`
  2. `No me interesa`

El envío desde el bot adjunta estos payloads, que son los ids que entiende la conversación:

| Botón | Payload | Qué hace |
| --- | --- | --- |
| Pedir presupuesto | `emp_book` | Abre el flujo de grupos de la comida de Navidad de empresa (el mismo botón que en el chat). |
| No me interesa | `mkt_optout` | Confirma la baja y la guarda. No vuelve a recibir esta plantilla. |

Si la plantilla se manda desde el administrador de Meta y el webhook trae el texto del botón
como payload (`Pedir presupuesto` o `No me interesa`), el bot lo traduce a esos mismos ids.
Quien escriba **BAJA** (o "No me interesa") también queda dado de baja.

### 2. Variables de entorno

- `MARKETING_TEMPLATE_NAME` (por defecto `comida_navidad_empresas_2026`)
- `MARKETING_TEMPLATE_LANG` (por defecto `es`)
- `MARKETING_TEMPLATE_HEADER_MEDIA_ID` o `MARKETING_TEMPLATE_HEADER_IMAGE_URL` (también vale `HEADER_IMAGE_URL`)

Si no defines ninguna, el envío usa la imagen del repositorio
(`assets/marketing/header_banquete.jpg`). Con los dos definidos se usa el media id.
`ADMIN_KEY` es la misma clave que `/admin`.

### 3. Enviar (solo a mano, con la clave)

Cuando el estado en Meta sea **APPROVED**. La cabecera `x-admin-key` no deja la clave en la URL:

```bash
curl -X POST "https://tu-app.onrender.com/admin/marketing/send" \
  -H "Content-Type: application/json" \
  -H "x-admin-key: TU_ADMIN_KEY" \
  -d '{"phone":"34600000000"}'
```

Una lista corta (máximo 20). No es un envío masivo:

```bash
curl -X POST "https://tu-app.onrender.com/admin/marketing/send?key=TU_ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d '{"phones":["34600000000","34600000001"]}'
```

El número va en formato internacional, sin `+` (si lo trae, se quita). Un número repetido
en la misma llamada se manda una sola vez. La respuesta trae `ok` y el id de Meta, o el
error de Meta (plantilla inexistente, aún no aprobada, parámetros que no cuadran), por cada
número. Quien esté en la tabla `marketing_optouts` se omite.

## Aviso por correo cuando WhatsApp no llega a Nico

Cada solicitud terminada (mesa, menú, hotel, comida de Navidad de empresa, boda, congreso)
y cada aviso de cancelación o de error al crear la reserva de hotel se lo manda el bot a Nico
por WhatsApp. Ese mensaje falla con el error **131047** de Meta cuando han pasado más de 24 h
desde el último mensaje de Nico al número del hotel: la solicitud se guarda, pero él no la ve.

Por eso el mismo aviso sale **también por correo**, haya funcionado el WhatsApp o no. El correo
está en español e incluye el número de solicitud, el tipo, el nombre y la empresa, el teléfono,
la fecha, las personas, los detalles, el origen (en las bodas, si consta) y un enlace al panel
`/admin`. Si el WhatsApp no ha salido, el asunto y el texto lo dicen. En el panel, esa solicitud
queda en rojo con el estado «aviso de WhatsApp no enviado».

El cliente no nota nada de esto: sus mensajes no cambian.

### Por qué no el SMTP del hotel

El servicio está en el plan gratuito de Render. Desde el 26 de septiembre de 2025 ese plan
**no deja salir** a los puertos SMTP `25`, `465` ni `587`. El puerto `25` está cerrado en
todos los planes. El correo de `donfadrique.com` (Roundcube, en `mail.donfadrique.com`)
habla SMTP, así que desde este servicio no se alcanza. Brevo envía por HTTPS
(`https://api.brevo.com`, puerto 443), que Render sí deja pasar. El plan Free de Brevo
incluye 300 correos al día, de sobra para los avisos del hotel.

Si `BREVO_API_KEY` no está puesta, el bot escribe en el log
`[email-alert] BREVO_API_KEY no está configurada` y sigue. No se cae la conversación.

### Qué hay que configurar para que el correo empiece a llegar

1. Crea una cuenta en [Brevo](https://www.brevo.com) (plan Free).
2. En **Ajustes → SMTP y API → API keys**, genera una clave v3. En Render, variable
   `BREVO_API_KEY` con ese valor. No la subas a GitHub.
3. En **Ajustes → Remitentes, dominios e IP → Remitentes**, añade un remitente:
   - Nombre: `Hostería Don Fadrique` (o el valor de `ALERT_EMAIL_FROM_NAME`)
   - Correo: `reservas@donfadrique.com` (tiene que ser el mismo que `ALERT_EMAIL_FROM`)
4. Brevo manda un código de 6 cifras a ese buzón. Ábrelo en el Roundcube de
   `donfadrique.com` y confírmalo. Sin este paso la API responde 401/400 y el bot solo lo
   anota en el log.
5. Variables opcionales (estos son los valores por defecto):
   - `ALERT_EMAIL` = `reservas@donfadrique.com` (quién recibe el aviso)
   - `ALERT_EMAIL_FROM` = `reservas@donfadrique.com` (el remitente verificado en Brevo)
   - `ALERT_EMAIL_FROM_NAME` = `Hostería Don Fadrique`
6. Redespliega el servicio en Render después de guardar las variables.

El enlace del correo es `https://whatsapp-reservas-bot.onrender.com/admin` (o
`PUBLIC_BASE_URL` + `/admin`). No incluye la clave: hay que abrirla con `?key=ADMIN_KEY`,
como siempre.

### Si el correo no aparece en Roundcube

El SPF de `donfadrique.com` termina en `-all` y el DMARC está en `p=none`. Brevo acepta el
envío en cuanto el remitente está verificado, pero el servidor del hotel puede dejar el
mensaje en spam, o desconfiar de un correo que dice ser de `@donfadrique.com` y no sale de
`mail.donfadrique.com`.

Para que llegue con fiabilidad, en Brevo autentica el dominio `donfadrique.com` (o un
subdominio, por ejemplo `avisos.donfadrique.com`) y copia en el DNS los registros DKIM y SPF
que muestra Brevo. No borres el SPF que ya existe (`include:_spf.furanet.com`): añade el
`include` de Brevo en ese mismo registro. Cuando el dominio esté autenticado, puedes dejar
`ALERT_EMAIL_FROM` en `reservas@donfadrique.com` o pasarlo a una dirección del subdominio
verificado.

Hasta entonces, mira también la carpeta de spam de `reservas@donfadrique.com` y los logs del
servicio: un envío bueno deja `[email-alert] enviado`.

## Historial de conversaciones

El bot guarda **todos** los mensajes de WhatsApp, no solo las solicitudes terminadas: los que entran
y los que él envía. Si Turso falla al guardar, lo anota en el log y la conversación con el cliente
sigue igual.

Cada mensaje lleva hora, teléfono, nombre de perfil (si Meta lo manda), dirección (`in` o `out`),
texto, tipo (texto, imagen, botones, plantilla…) y el tema detectado (`boda`, `navidad_empresa`,
`congreso`, `eventos`, `restaurante`, `hotel`, `menu_fiesta`, `llegada`, `fotos`, `menu`,
`marketing`, `admin`, `general`…).

El **origen** se anota solo si el primer mensaje del cliente es uno de los textos prefijados de
`wa.me`:

| Primer mensaje | `source` |
| --- | --- |
| `Quiero información para mi boda` | `directo` |
| `Quiero información para mi boda (Bodas.net)` y lo mismo con Bodalia, Loggiata, TodoBoda, Web, Instagram o Email | `bodas_net`, `bodalia`, `loggiata`, `todoboda`, `web`, `instagram`, `email` |
| `Quiero información para la comida de Navidad de empresa` | `navidad_empresa` |
| `Quiero reservar el menú de Navidad (25 de diciembre)` | `menu_navidad` |
| `Quiero reservar el menú de Nochevieja (31 de diciembre)` | `menu_nochevieja` |
| `Quiero reservar el menú de Año Nuevo (1 de enero)` | `menu_anonuevo` |

Un «hola» o un «quiero una boda» no llevan origen. El origen no cambia con los mensajes siguientes.

El **cierre** (`outcome`) del chat queda en `abierta` hasta que hay una solicitud guardada
(`solicitud`: mesa, hotel, menú, boda, comida de empresa o congreso) o un aviso al equipo sin
solicitud (`escalacion`, por ejemplo un error del PMS). Una solicitud no vuelve a `abierta`.

Las tres rutas son de solo lectura y piden la misma clave que el panel (`x-admin-key` o `?key=`).
Sin la clave responden 403. No salen en la web pública. Las horas de las estadísticas se cuentan
en `Europe/Madrid`. Si omites `from` y `to`, el intervalo son los últimos 30 días. Si pones solo
una de las dos, o el formato no es `YYYY-MM-DD`, responden 400.

```bash
curl "https://tu-app.onrender.com/admin/conversations?from=2026-11-01&to=2026-11-16" \
  -H "x-admin-key: TU_ADMIN_KEY"

curl "https://tu-app.onrender.com/admin/conversations/34600000000" \
  -H "x-admin-key: TU_ADMIN_KEY"

curl "https://tu-app.onrender.com/admin/conversation-stats?from=2026-11-01&to=2026-11-16" \
  -H "x-admin-key: TU_ADMIN_KEY"
```

`/admin/conversations` devuelve un resumen por chat con actividad en esas fechas: primer y último
mensaje del intervalo, cuántos mensajes hay, tema, origen y cierre. `/admin/conversations/:phone`
devuelve la transcripción completa (hasta 1000 mensajes). `/admin/conversation-stats` cuenta por
día, tema, origen y cierre.

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

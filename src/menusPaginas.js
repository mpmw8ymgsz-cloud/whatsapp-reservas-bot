// Páginas públicas de los menús oficiales. El PDF se genera desde la imagen
// ya limpia (sin teléfonos personales). El botón abre WhatsApp con el texto
// de reserva de ese menú.

const menus = require('./menusFiesta');

const WA_PHONE = '34923370076';
const PUBLIC_PHONE = '923 37 00 76';
const PUBLIC_EMAIL = 'reservas@donfadrique.com';

function esc(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function waReserveUrl(menu) {
  return `https://wa.me/${WA_PHONE}?text=${encodeURIComponent(menu.reserveText)}`;
}

function layout(title, body) {
  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(title)}</title>
  <style>
    :root { color-scheme: light; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: #f6f1e8;
      color: #3a241c;
      font-family: Georgia, "Palatino Linotype", Palatino, serif;
    }
    header, main, footer { width: min(680px, calc(100% - 32px)); margin: 0 auto; }
    header { padding: 28px 0 8px; text-align: center; }
    .kicker {
      margin: 0;
      letter-spacing: 0.22em;
      text-transform: uppercase;
      font-size: 0.72rem;
      color: #8a6230;
    }
    h1 { margin: 8px 0 0; font-weight: normal; font-size: 2.1rem; color: #6b1d2a; }
    .lead { margin: 8px 0 0; color: #6b5344; }
    .grid { display: grid; gap: 18px; padding: 18px 0 8px; }
    article {
      background: #fffdf8;
      border: 1px solid #eadfce;
      border-radius: 18px;
      padding: 22px 18px 26px;
      text-align: center;
    }
    article h2, article h1 { margin: 0; color: #6b1d2a; font-weight: normal; }
    .when, .price { margin: 6px 0; }
    .price { font-size: 1.25rem; }
    img { width: min(100%, 420px); height: auto; margin: 14px 0; border-radius: 8px; }
    .courses { text-align: left; max-width: 460px; margin: 0 auto 12px; line-height: 1.45; }
    .courses p { margin: 0 0 8px; }
    .allergy { font-style: italic; color: #6b5344; }
    a { color: #6b1d2a; }
    .pdf { display: inline-block; margin: 8px 0 18px; }
    .reserve {
      display: block;
      margin: 8px auto 0;
      padding: 16px 20px;
      max-width: 420px;
      background: #6b1d2a;
      color: #fff;
      text-decoration: none;
      font-size: 1.15rem;
      border-radius: 999px;
    }
    footer { padding: 8px 0 32px; text-align: center; color: #6b5344; font-size: 0.95rem; }
  </style>
</head>
<body>
  <header>
    <p class="kicker">Hostería Don Fadrique</p>
    ${body.startsWith('<article') ? '' : `<h1>${esc(title.replace(' · Hostería Don Fadrique', ''))}</h1>`}
  </header>
  <main>
    ${body}
  </main>
  <footer>
    <p>WhatsApp ${esc(PUBLIC_PHONE)} · ${esc(PUBLIC_EMAIL)}</p>
  </footer>
</body>
</html>`;
}

function coursesHtml(menu) {
  return menu.courses
    .map((course) => `<p><strong>${esc(course.name)}.</strong> ${esc(course.detail)}</p>`)
    .join('\n');
}

function menuArticle(menu, { linkedTitle }) {
  const title = linkedTitle
    ? `<h2><a href="/menus/${esc(menu.id)}">${esc(menu.title)}</a></h2>`
    : `<h1>${esc(menu.title)}</h1>`;
  const image = linkedTitle
    ? `<a href="/menus/${esc(menu.id)}"><img src="/menus/${esc(menu.file)}" alt="${esc(menu.caption)}"></a>`
    : `<img src="/menus/${esc(menu.file)}" alt="${esc(menu.caption)}">`;
  return `<article>
    ${title}
    <p class="when">${esc(menu.date)}</p>
    <p class="price">${esc(menu.price)}</p>
    ${image}
    ${linkedTitle ? '' : `<div class="courses">${coursesHtml(menu)}</div>`}
    <p class="allergy">${esc(menus.ALLERGY)}</p>
    <p><a class="pdf" href="/menus/${esc(menu.pdf)}">Descargar PDF</a></p>
    <a class="reserve" href="${esc(waReserveUrl(menu))}">Reservar este menú por WhatsApp</a>
  </article>`;
}

function indexHtml() {
  const cards = menus.MENUS.map((menu) => menuArticle(menu, { linkedTitle: true })).join('\n');
  return layout('Menús de las fiestas · Hostería Don Fadrique', `<p class="lead">Navidad, Nochevieja y Año Nuevo.</p><div class="grid">${cards}</div>`);
}

function menuHtml(slug) {
  const menu = menus.BY_ID[slug];
  if (!menu) return null;
  return layout(`${menu.title} · Hostería Don Fadrique`, menuArticle(menu, { linkedTitle: false }));
}

module.exports = {
  WA_PHONE,
  PUBLIC_PHONE,
  PUBLIC_EMAIL,
  waReserveUrl,
  indexHtml,
  menuHtml,
};

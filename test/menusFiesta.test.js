const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const http = require('http');
const path = require('path');

const menus = require('../src/menusFiesta');
const empresa = require('../src/menusEmpresa');
const paginas = require('../src/menusPaginas');
const fotos = require('../src/fotos');
const { normalize } = require('../src/dateParser');
const { createApp } = require('../src/server-meta');

const MENUS_DIR = path.join(__dirname, '..', 'public', 'menus');
const PERSONAL =
  /650\s*488\s*113|661\s*724\s*158|650488113|661724158|34650488113|34661724158/i;

function norm(text) {
  return normalize(text);
}

describe('intención de los menús de fiesta', () => {
  const general = [
    'Quiero ver los menús de Navidad',
    'ver los menús',
    'ver el menú',
    'menús',
    'los menús',
    'carta',
    'la carta',
    'ver la carta',
    'enséñame los menús',
    'muéstrame el menú',
    'envíame la carta',
    'cómo es el menú',
    'los menús de las fiestas',
  ];

  for (const phrase of general) {
    it(`«${phrase}» pide los tres menús`, () => {
      assert.equal(menus.matchRequest(norm(phrase)), 'all');
    });
  }

  const navidad = ['Quiero ver el menú de Navidad', 'menú de Navidad', 'el menú de Navidad', 'carta de Navidad'];
  for (const phrase of navidad) {
    it(`«${phrase}» pide solo Navidad`, () => {
      assert.equal(menus.matchRequest(norm(phrase)), 'navidad');
    });
  }

  const nochevieja = [
    'Quiero ver el menú de Nochevieja',
    'menú de Nochevieja',
    'menú nochevieja',
    'Menú Nochevieja',
    'Nochevieja',
    'carta de nochevieja',
    'menú de fin de año',
  ];
  for (const phrase of nochevieja) {
    it(`«${phrase}» pide solo Nochevieja`, () => {
      assert.equal(menus.matchRequest(norm(phrase)), 'nochevieja');
    });
  }

  const anonuevo = ['Quiero ver el menú de Año Nuevo', 'menú de Año Nuevo', 'Año Nuevo', 'carta de año nuevo'];
  for (const phrase of anonuevo) {
    it(`«${phrase}» pide solo Año Nuevo`, () => {
      assert.equal(menus.matchRequest(norm(phrase)), 'anonuevo');
    });
  }

  const keeps = [
    'menu',
    'menú',
    'menús de Navidad',
    'menús de navidad',
    'comida de navidad para empresa',
    'comidas de Navidad',
    'quiero una boda',
    'banquete de boda',
    'congreso',
    'evento de empresa',
    'quiero una habitación',
    'quiero una mesa',
    'cómo llegar',
    'qué incluye el menú gran gala',
    'detalle del menú navidad',
    'que platos lleva el menu navidad',
    'ver fotos',
    'ver la terraza',
    'hola',
    'reservar',
  ];

  for (const phrase of keeps) {
    it(`«${phrase}» no pide la carta de las fiestas`, () => {
      assert.equal(menus.matchRequest(norm(phrase)), null);
    });
  }

  it('«menú nochevieja» y el menú de Navidad no son la comida de empresa', () => {
    for (const phrase of ['menú nochevieja', 'Menú Nochevieja', 'nochevieja', 'menú de Navidad', 'menu navidad']) {
      assert.equal(empresa.isEmpresaTopic(norm(phrase)), false, phrase);
    }
    assert.equal(empresa.isEmpresaTopic(norm('menús de Navidad')), true);
    assert.equal(empresa.isEmpresaTopic(norm('comida de navidad para empresa')), true);
    assert.equal(empresa.isEmpresaTopic(norm('nochevieja para la empresa')), true);
  });

  const reserves = [
    ['Quiero reservar el menú de Navidad (25 de diciembre)', 'navidad'],
    ['Quiero reservar el menú de Nochevieja (31 de diciembre)', 'nochevieja'],
    ['Quiero reservar el menú de Año Nuevo (1 de enero)', 'anonuevo'],
  ];
  for (const [phrase, id] of reserves) {
    it(`«${phrase}» es una reserva de ${id}`, () => {
      assert.equal(menus.matchReservation(norm(phrase)), id);
      assert.equal(empresa.isEmpresaTopic(norm(phrase)), false);
      assert.equal(menus.BY_ID[id].reserveText, phrase);
    });
  }
});

describe('textos de los menús oficiales', () => {
  const dishes = {
    navidad: [
      'jamón y lomo; gamba blanca Don Fadrique; paté de pato y fiambres navideños.',
      'alcachofa con pistacho y café.',
      'lomo de lubina con cítricos.',
      'cochinillo de Navidad.',
      'mazapán carmelita.',
    ],
    nochevieja: [
      'jamón, gamba blanca Don Fadrique y anchoa.',
      'capuchino de lentejas con perdiz.',
      'sopa tradicional marinera.',
      'lubina o besugo de fin de año, según mercado.',
      'granizado de champagne.',
      'venado de Navidad con ragú de setas.',
      'tarta tatin de manzana con helado de mango.',
      'las 12 uvas de la suerte y churros.',
    ],
    anonuevo: [
      'pastrami ibérico, paté navideño, croqueta de jamón.',
      'ensalada de rúcula con nueces, granada y stracciatella artesana; consomé de faisán con su albóndiga.',
      'lubina con ajada.',
      'cochinillo asado tradicional.',
      'chocolate de Navidad.',
    ],
  };

  const courses = {
    navidad: ['Aperitivo', 'Entrante individual', 'Pescado', 'Asado', 'Postre'],
    nochevieja: ['Aperitivo', 'Aperitivo sentado', 'Entrante', 'Pescado', 'Sorbete', 'Carne', 'Postre', 'A medianoche'],
    anonuevo: ['Aperitivo', 'Entrantes', 'Pescado del día', 'Plato principal', 'Postre'],
  };

  for (const menu of menus.MENUS) {
    it(`${menu.title} lleva sus platos, el precio y la nota de alergias`, () => {
      const text = menus.menuText(menu);
      assert.match(text, new RegExp(menu.price.replace('€', '\\€')));
      assert.equal(text.match(new RegExp(menu.price.replace('€', '\\€'), 'g')).length, 1);
      assert.match(text, new RegExp(menu.date.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
      for (const dish of dishes[menu.id]) assert.ok(text.includes(dish), dish);
      for (const course of courses[menu.id]) assert.ok(text.includes(`*${course}:*`), course);
      assert.ok(text.includes(menus.ALLERGY));
      assert.equal(menus.ALLERGY, 'Todos nuestros menús se pueden adaptar a alergias e intolerancias.');
      assert.doesNotMatch(text, /\bIVA\b/i);
      assert.doesNotMatch(text, PERSONAL);
      assert.doesNotMatch(text, /@/);
    });
  }

  it('Nochevieja son 110 € y los otros dos, 65 €, siempre por persona', () => {
    assert.equal(menus.BY_ID.navidad.price, '65 € por persona');
    assert.equal(menus.BY_ID.nochevieja.price, '110 € por persona');
    assert.equal(menus.BY_ID.anonuevo.price, '65 € por persona');
    assert.doesNotMatch(menus.menuText(menus.BY_ID.nochevieja), /65 €|cappuccino|capuccino/i);
    assert.match(menus.menuText(menus.BY_ID.nochevieja), /capuchino de lentejas con perdiz/);
  });

  it('la petición general manda intro, tres cartas, el cochinillo y la salida a reservar', () => {
    const replies = menus.replies('all');
    assert.equal(replies[0].kind, 'text');
    assert.match(replies[0].body, /Menús de las fiestas/);
    assert.match(replies[0].body, /Hostería Don Fadrique/);
    const texts = replies.filter((reply) => reply.kind === 'text').map((reply) => reply.body);
    assert.match(texts.join('\n'), /Menú Navidad/);
    assert.match(texts.join('\n'), /Menú Nochevieja/);
    assert.match(texts.join('\n'), /Menú Año Nuevo/);
    const images = replies.filter((reply) => reply.kind === 'image');
    assert.deepEqual(
      images.map((image) => image.file),
      ['menu-navidad-25dic.jpg', 'menu-nochevieja-31dic.jpg', 'menu-anonuevo-1ene.jpg', 'cochinillo.jpg']
    );
    assert.equal(images[3].source, fotos.CATALOG.cochinillo.source);
    assert.match(images[3].caption, /Cochinillo/);
    for (const image of images.slice(0, 3)) {
      assert.equal(image.folder, 'menus');
      assert.ok(image.caption.length > 0 && image.caption.length <= 80);
      assert.match(image.caption, /€ por persona/);
    }
    const tail = replies.at(-1);
    assert.equal(tail.kind, 'buttons');
    assert.match(tail.body, /reservar/);
    assert.match(tail.body, /presupuesto/);
    assert.doesNotMatch(tail.body, /\bIVA\b|65 €|110 €|55 €/);
    assert.doesNotMatch(replies.map((reply) => reply.body).join('\n'), PERSONAL);
    assert.deepEqual(
      tail.buttons.map((button) => button.title),
      ['Reservar', 'Pedir presupuesto']
    );
  });

  it('un menú concreto manda solo su texto y su imagen', () => {
    for (const id of ['navidad', 'nochevieja', 'anonuevo']) {
      const replies = menus.replies(id);
      assert.deepEqual(
        replies.map((reply) => reply.kind),
        ['text', 'image']
      );
      assert.equal(replies[1].file, menus.BY_ID[id].file);
      assert.doesNotMatch(replies.map((reply) => reply.body).join('\n'), PERSONAL);
    }
    const only = menus.replies('nochevieja').map((reply) => reply.body).join('\n');
    assert.match(only, /110 € por persona/);
    assert.doesNotMatch(only, /65 € por persona|mazapán carmelita|stracciatella/);
  });
});

describe('archivos de los menús', () => {
  it('son JPEG servidos en /menus, y el cochinillo está en el catálogo de fotos', () => {
    const photo = fotos.CATALOG.cochinillo;
    assert.equal(
      photo.source,
      'https://www.donfadrique.com/wp-content/uploads/COCHINILLO-AHUMADO-CARRASCAL-705x705.jpg'
    );
    const cochinillo = fs.readFileSync(path.join(__dirname, '..', 'public', 'fotos', photo.file));
    assert.equal(cochinillo[0], 0xff);
    assert.equal(cochinillo[1], 0xd8);
    for (const menu of menus.MENUS) {
      const buf = fs.readFileSync(path.join(MENUS_DIR, menu.file));
      assert.ok(buf.length > 1000 && buf.length < 5 * 1024 * 1024, menu.file);
      assert.equal(buf[0], 0xff);
      assert.equal(buf[1], 0xd8);
    }
  });

  it('la URL pública de un menú usa la base del servicio', () => {
    const previous = process.env.PUBLIC_BASE_URL;
    try {
      delete process.env.PUBLIC_BASE_URL;
      assert.equal(
        menus.publicUrl('menu-navidad-25dic.jpg'),
        'https://whatsapp-reservas-bot.onrender.com/menus/menu-navidad-25dic.jpg'
      );
      process.env.PUBLIC_BASE_URL = 'https://example.com/';
      assert.equal(menus.publicUrl('menu-nochevieja-31dic.jpg'), 'https://example.com/menus/menu-nochevieja-31dic.jpg');
    } finally {
      if (previous === undefined) delete process.env.PUBLIC_BASE_URL;
      else process.env.PUBLIC_BASE_URL = previous;
    }
  });

  it('la reserva manda primero la imagen, con nombre, fecha y precio', () => {
    const replies = menus.reservationReplies('nochevieja');
    assert.deepEqual(
      replies.map((reply) => reply.kind),
      ['image', 'text']
    );
    assert.match(replies[0].caption, /Menú Nochevieja/);
    assert.match(replies[0].caption, /31 de diciembre de 2026/);
    assert.match(replies[0].caption, /110 € por persona/);
    assert.match(replies[1].body, /capuchino de lentejas con perdiz/);
  });

  it('express responde 200 con content-type image/jpeg', async () => {
    const app = createApp(() => {});
    const server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address();
    try {
      for (const menu of menus.MENUS) {
        const res = await fetch(`http://127.0.0.1:${port}/menus/${menu.file}`);
        assert.equal(res.status, 200, menu.file);
        assert.match(res.headers.get('content-type') || '', /^image\/jpeg\b/);
        const buf = Buffer.from(await res.arrayBuffer());
        assert.equal(buf[0], 0xff);
        assert.equal(buf[1], 0xd8);
      }
      const missing = await fetch(`http://127.0.0.1:${port}/menus/no-existe.jpg`);
      assert.equal(missing.status, 404);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});

describe('páginas públicas de los menús', () => {
  const PERSONAL = /650\s*488\s*113|661\s*724\s*158|650488113|661724158/;

  it('el índice y cada menú enlazan el PDF limpio y WhatsApp', async () => {
    const app = createApp(() => {});
    const server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;
    try {
      const index = await fetch(`${base}/menus`);
      assert.equal(index.status, 200);
      assert.match(index.headers.get('content-type') || '', /text\/html/);
      const indexHtml = await index.text();
      assert.match(indexHtml, /Menús de las fiestas/);
      for (const menu of menus.MENUS) {
        assert.match(indexHtml, new RegExp(`/menus/${menu.id}`));
        assert.doesNotMatch(indexHtml, PERSONAL);
      }
      const indexLinks = [...indexHtml.matchAll(/href="(https:\/\/wa\.me\/[^"]+)"/g)].map((match) =>
        new URL(match[1].replace(/&amp;/g, '&')).searchParams.get('text')
      );
      assert.deepEqual(
        indexLinks,
        menus.MENUS.map((menu) => menu.reserveText)
      );

      for (const menu of menus.MENUS) {
        const page = await fetch(`${base}/menus/${menu.id}`);
        assert.equal(page.status, 200, menu.id);
        const html = await page.text();
        assert.match(html, /Reservar este menú por WhatsApp/);
        assert.match(html, /Descargar PDF/);
        assert.match(html, new RegExp(`/menus/${menu.pdf}`));
        assert.match(html, new RegExp(`/menus/${menu.file}`));
        assert.ok(html.includes(menu.price), menu.price);
        assert.doesNotMatch(html, PERSONAL);
        assert.match(html, /923 37 00 76/);
        assert.match(html, /reservas@donfadrique\.com/);
        const href = html.match(/href="(https:\/\/wa\.me\/[^"]+)"/);
        assert.ok(href, menu.id);
        const url = new URL(href[1].replace(/&amp;/g, '&'));
        assert.equal(url.origin + url.pathname, 'https://wa.me/34923370076');
        assert.equal(url.searchParams.get('text'), menu.reserveText);

        const pdf = await fetch(`${base}/menus/${menu.pdf}`);
        assert.equal(pdf.status, 200, menu.pdf);
        assert.match(pdf.headers.get('content-type') || '', /application\/pdf/);
        const buf = Buffer.from(await pdf.arrayBuffer());
        assert.equal(buf.subarray(0, 5).toString(), '%PDF-');
        const raw = buf.toString('latin1');
        assert.doesNotMatch(raw, PERSONAL);
      }
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it('el texto del botón de WhatsApp es el de cada menú', () => {
    assert.equal(paginas.waReserveUrl(menus.BY_ID.navidad),
      'https://wa.me/34923370076?text=' + encodeURIComponent('Quiero reservar el menú de Navidad (25 de diciembre)'));
    assert.equal(paginas.waReserveUrl(menus.BY_ID.nochevieja),
      'https://wa.me/34923370076?text=' + encodeURIComponent('Quiero reservar el menú de Nochevieja (31 de diciembre)'));
    assert.equal(paginas.waReserveUrl(menus.BY_ID.anonuevo),
      'https://wa.me/34923370076?text=' + encodeURIComponent('Quiero reservar el menú de Año Nuevo (1 de enero)'));
  });
});

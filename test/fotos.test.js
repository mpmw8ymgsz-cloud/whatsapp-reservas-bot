const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const http = require('http');
const path = require('path');

const fotos = require('../src/fotos');
const { normalize } = require('../src/dateParser');
const { buildImagePayload } = require('../src/whatsapp');
const { createApp, extractText } = require('../src/server-meta');

const FOTOS_DIR = path.join(__dirname, '..', 'public', 'fotos');
const MAX_BYTES = 5 * 1024 * 1024;

function norm(text) {
  return normalize(text);
}

describe('intención de fotos', () => {
  const wants = [
    ['fotos', 'general'],
    ['foto', 'general'],
    ['imágenes', 'general'],
    ['ver el sitio', 'general'],
    ['cómo es', 'general'],
    ['enséñame', 'general'],
    ['habitaciones fotos', 'habitaciones'],
    ['fotos de las habitaciones', 'habitaciones'],
    ['fotos de bodas', 'bodas'],
    ['jardín', 'bodas'],
    ['el jardín', 'bodas'],
    ['fotos del restaurante', 'restaurante'],
    ['ver la terraza', 'terraza'],
    ['fotos del congreso', 'eventos'],
  ];

  for (const [phrase, category] of wants) {
    it(`«${phrase}» pide fotos de ${category}`, () => {
      assert.equal(fotos.matchPhotoRequest(norm(phrase)), category);
    });
  }

  const keeps = [
    'restaurante',
    'quiero una mesa',
    'menús de Navidad',
    'comida de navidad para empresa',
    'quiero una boda',
    'banquete de boda',
    'congreso',
    'evento de empresa',
    'en el jardín',
    'cómo es el menú',
    'qué incluye el menú gran gala',
  ];

  for (const phrase of keeps) {
    it(`«${phrase}» no es una petición de fotos`, () => {
      assert.equal(fotos.matchPhotoRequest(norm(phrase)), null);
    });
  }
});

describe('álbumes', () => {
  it('cada categoría manda entre 2 y 4 fotos con pie en español', () => {
    for (const category of Object.keys(fotos.ALBUMS)) {
      const album = fotos.album(category);
      assert.ok(album.length >= 2 && album.length <= 4, category);
      for (const photo of album) {
        assert.equal(photo.kind, 'image');
        assert.match(photo.file, /\.jpg$/);
        assert.ok(photo.caption.length > 0 && photo.caption.length <= 80);
        assert.match(photo.caption, /[a-záéíóúñ]/i);
        assert.doesNotMatch(photo.caption, /\d+\s*€/);
      }
    }
  });

  it('la presentación de boda manda 2 o 3 fotos y la de congreso 1 o 2', () => {
    const boda = fotos.presentationReplies('boda');
    assert.ok(boda.length >= 2 && boda.length <= 3, 'boda');
    const more = fotos.moreWeddingReplies();
    assert.ok(more.length >= 2 && more.length <= 3, 'más fotos');
    const files = new Set([...boda, ...more].map((photo) => photo.file));
    assert.equal(files.size, boda.length + more.length);
    for (const photo of [...boda, ...more]) {
      assert.match(photo.source, /^https:\/\/www\.donfadrique\.com\/wp-content\/uploads\/.+\.jpg$/);
      assert.match(photo.caption, /[a-záéíóúñ]/i);
    }
    const congreso = fotos.presentationReplies('congreso');
    assert.ok(congreso.length >= 1 && congreso.length <= 2, 'congreso');
  });
});

describe('archivos publicados', () => {
  it('son JPEG de la web oficial, por debajo de 5 MB', () => {
    const files = new Set();
    for (const photo of fotos.catalog()) {
      assert.match(photo.source, /^https:\/\/www\.donfadrique\.com\/wp-content\/uploads\/.+\.jpg$/);
      const full = path.join(FOTOS_DIR, photo.file);
      const buf = fs.readFileSync(full);
      assert.ok(buf.length > 1000 && buf.length < MAX_BYTES, photo.file);
      assert.equal(buf[0], 0xff);
      assert.equal(buf[1], 0xd8);
      files.add(photo.file);
    }
    assert.ok(files.size >= 8);
  });

  it('la URL pública usa PUBLIC_BASE_URL y, si falta, el servicio de Render', () => {
    const previous = process.env.PUBLIC_BASE_URL;
    try {
      delete process.env.PUBLIC_BASE_URL;
      assert.equal(
        fotos.publicUrl('ceremonia-jardin.jpg'),
        'https://whatsapp-reservas-bot.onrender.com/fotos/ceremonia-jardin.jpg'
      );
      process.env.PUBLIC_BASE_URL = 'https://example.com/';
      assert.equal(fotos.publicUrl('ceremonia-jardin.jpg'), 'https://example.com/fotos/ceremonia-jardin.jpg');
      assert.equal(
        fotos.publicUrl('menu-navidad-25dic.jpg', 'menus'),
        'https://example.com/menus/menu-navidad-25dic.jpg'
      );
    } finally {
      if (previous === undefined) delete process.env.PUBLIC_BASE_URL;
      else process.env.PUBLIC_BASE_URL = previous;
    }
  });

  it('express responde 200 con content-type image/jpeg', async () => {
    const app = createApp(() => {});
    const server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address();
    try {
      for (const photo of fotos.catalog()) {
        const res = await fetch(`http://127.0.0.1:${port}/fotos/${photo.file}`);
        assert.equal(res.status, 200, photo.file);
        assert.match(res.headers.get('content-type') || '', /^image\/jpeg\b/);
        const buf = Buffer.from(await res.arrayBuffer());
        assert.equal(buf[0], 0xff);
        assert.equal(buf[1], 0xd8);
        assert.ok(buf.length < MAX_BYTES);
      }
      const missing = await fetch(`http://127.0.0.1:${port}/fotos/no-existe.jpg`);
      assert.equal(missing.status, 404);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});

describe('payload de imagen de la Cloud API', () => {
  it('arma type image con link y pie', () => {
    assert.deepEqual(
      buildImagePayload('34600000000', {
        link: 'https://whatsapp-reservas-bot.onrender.com/fotos/ceremonia-jardin.jpg',
        caption: 'Ceremonia en el jardín.',
      }),
      {
        messaging_product: 'whatsapp',
        to: '34600000000',
        type: 'image',
        image: {
          link: 'https://whatsapp-reservas-bot.onrender.com/fotos/ceremonia-jardin.jpg',
          caption: 'Ceremonia en el jardín.',
        },
      }
    );
  });

  it('si hay id, no manda el enlace', () => {
    const payload = buildImagePayload('34600000000', {
      id: 'media-1',
      link: 'https://example.com/a.jpg',
      caption: '  Hola  ',
    });
    assert.deepEqual(payload.image, { id: 'media-1', caption: 'Hola' });
  });

  it('rechaza una imagen sin link ni id', () => {
    assert.throws(() => buildImagePayload('34600000000', { caption: 'sin archivo' }), /link o id/);
  });
});

describe('mensaje entrante de tipo image', () => {
  it('usa el pie como texto y, si no hay, deja el texto vacío', () => {
    assert.equal(extractText({ type: 'image', image: { id: '1', caption: 'el jardín' } }), 'el jardín');
    assert.equal(extractText({ type: 'image', image: { id: '1' } }), '');
    assert.equal(extractText({ type: 'text', text: { body: 'hola' } }), 'hola');
  });
});

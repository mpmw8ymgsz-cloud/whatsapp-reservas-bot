const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const { normalize } = require('../src/dateParser');
const galeria = require('../src/galeriaCatering');
const { createApp } = require('../src/server-meta');

const DIR = path.join(__dirname, '..', 'public', 'galeria', 'catering');

test('la petición de la carta del correo y las fotos de catering abren la galería', () => {
  assert.equal(galeria.isRequest(normalize('Quiero ver la galería de catering')), true);
  assert.equal(galeria.isRequest(normalize('quiero fotos del catering')), true);
  assert.equal(galeria.isRequest(normalize('enséñame la galería de cátering')), true);
  assert.equal(galeria.isRequest(normalize('show me the catering gallery')), true);
  assert.equal(galeria.isRequest(normalize('photos of the catering')), true);
  assert.equal(galeria.isRequest(normalize('queremos un congreso')), false);
  assert.equal(galeria.isRequest(normalize('ver fotos')), false);
  assert.equal(galeria.isRequest(normalize('necesitamos el catering')), false);
  assert.equal(galeria.isRequest(normalize('menú de navidad')), false);
});

test('galeria.json trae 11 pies y el disco tiene también las fotos del correo', () => {
  const photos = galeria.photos();
  assert.equal(photos.length, 11);
  assert.deepEqual(
    photos.map((photo) => photo.file),
    [
      '01_mesas_y_coctel.jpg',
      '02_jamon_al_corte.jpg',
      '03_servicio_caliente.jpg',
      '04_fruta_zumos.jpg',
      '05_buffet_invitados.jpg',
      '06_comensales.jpg',
      '07_mesas_altas.jpg',
      '08_emplatado_embutidos.jpg',
      '09_carne_conos.jpg',
      '10_comida_jardin.jpg',
      '11_quesos_y_panes.jpg',
    ]
  );
  assert.equal(photos[10].caption, 'Mesa de quesos y panes');
  for (const photo of photos) {
    assert.ok(photo.caption.length > 3, photo.file);
    assert.match(photo.link, new RegExp(`/galeria/catering/${photo.file}$`));
    const buf = fs.readFileSync(path.join(DIR, photo.file));
    assert.equal(buf[0], 0xff);
    assert.equal(buf[1], 0xd8);
  }
  for (const file of [
    'hero_v5.jpg',
    'grid_1_jamon.jpg',
    'grid_2_servicio.jpg',
    'grid_3_fruta.jpg',
    'grid_4_comensales.jpg',
    'opcion_catering_v5.jpg',
    'opcion_hosteria.jpg',
  ]) {
    assert.equal(fs.readFileSync(path.join(DIR, file))[0], 0xff, file);
  }
});

test('hay una pausa pequeña entre fotos y los tests pueden quitarla', async () => {
  const previous = process.env.GALERIA_PHOTO_DELAY_MS;
  try {
    delete process.env.GALERIA_PHOTO_DELAY_MS;
    assert.equal(galeria.delayMs(), 400);
    process.env.GALERIA_PHOTO_DELAY_MS = '30';
    const started = Date.now();
    await galeria.waitTurn(0);
    await galeria.waitTurn(1);
    await galeria.waitTurn(2);
    assert.ok(Date.now() - started >= 50);
  } finally {
    if (previous === undefined) delete process.env.GALERIA_PHOTO_DELAY_MS;
    else process.env.GALERIA_PHOTO_DELAY_MS = previous;
  }
});

test('express sirve la galería y las imágenes del correo', async () => {
  const app = createApp(() => {});
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    for (const file of ['01_mesas_y_coctel.jpg', 'hero_v5.jpg', 'opcion_catering_v5.jpg', 'opcion_hosteria.jpg']) {
      const res = await fetch(`http://127.0.0.1:${port}/galeria/catering/${file}`);
      assert.equal(res.status, 200, file);
      assert.match(res.headers.get('content-type') || '', /^image\/jpeg\b/);
    }
    const missing = await fetch(`http://127.0.0.1:${port}/galeria/catering/no-existe.jpg`);
    assert.equal(missing.status, 404);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

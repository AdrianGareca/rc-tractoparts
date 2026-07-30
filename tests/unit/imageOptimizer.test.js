// =============================================================================
// tests/unit/imageOptimizer.test.js
// El codec PNG casero de scripts/optimize-images.js, y el presupuesto de peso
// de los assets.
//
// POR QUÉ IMPORTA
// PDFKit embebe los PNG con sus píxeles originales — no los reescala al tamaño
// en que se dibujan. Los logos venían a resolución 4K y sumaban ~1,3 MB dentro
// de CADA proforma. Escribir un codec a mano para arreglarlo sólo se justifica
// si es demostrablemente correcto: un bug acá no rompe un test, corrompe el
// logo de la empresa en todos los documentos que salen a clientes.
//
// El último bloque es el que da valor a futuro: vigila que nadie vuelva a subir
// un logo de 4K sin darse cuenta.
// =============================================================================

'use strict';

const fs   = require('fs');
const path = require('path');
const zlib = require('zlib');

const {
  decodificar, codificar, redimensionar, optimizar, PRESUPUESTO,
} = require('../../scripts/optimize-images');

const IMAGENES = path.resolve(__dirname, '../../src/assets/images');

// ---------------------------------------------------------------------------
/** PNG RGBA de referencia, construido a mano para no depender de un asset. */
function pngDePrueba(ancho, alto, pintar) {
  const rgba = Buffer.alloc(ancho * alto * 4);
  for (let y = 0; y < alto; y++) {
    for (let x = 0; x < ancho; x++) {
      const [r, g, b, a] = pintar(x, y);
      const i = (y * ancho + x) * 4;
      rgba[i] = r; rgba[i + 1] = g; rgba[i + 2] = b; rgba[i + 3] = a;
    }
  }
  return { rgba, buffer: codificar(rgba, ancho, alto), ancho, alto };
}

// ===========================================================================
describe('el codec es exacto (ida y vuelta sin pérdida)', () => {
  test('un degradado RGBA sobrevive encode → decode píxel por píxel', () => {
    const { rgba, buffer, ancho, alto } = pngDePrueba(64, 48,
      (x, y) => [x * 4, y * 5, (x + y) % 256, (x * y) % 256]);

    const vuelta = decodificar(buffer);

    expect(vuelta.ancho).toBe(ancho);
    expect(vuelta.alto).toBe(alto);
    expect(Buffer.compare(vuelta.rgba, rgba)).toBe(0);
  });

  test('una imagen totalmente opaca se guarda como RGB, no RGBA', () => {
    const { buffer } = pngDePrueba(20, 20, (x, y) => [x * 10, y * 10, 128, 255]);
    // colorType vive en el byte 25 del PNG (IHDR + 9).
    expect(buffer[25]).toBe(2);            // 2 = RGB
  });

  test('una imagen con transparencia conserva el canal alfa', () => {
    const { buffer, rgba } = pngDePrueba(20, 20, (x) => [255, 0, 0, x < 10 ? 0 : 255]);
    expect(buffer[25]).toBe(6);            // 6 = RGBA
    expect(Buffer.compare(decodificar(buffer).rgba, rgba)).toBe(0);
  });

  test('una imagen de un solo píxel no rompe nada', () => {
    const { buffer, rgba } = pngDePrueba(1, 1, () => [12, 34, 56, 255]);
    const v = decodificar(buffer);
    expect([v.ancho, v.alto]).toEqual([1, 1]);
    expect(Buffer.compare(v.rgba, rgba)).toBe(0);
  });

  test('el PNG generado lleva firma, IHDR e IEND en su lugar', () => {
    const { buffer } = pngDePrueba(8, 8, () => [1, 2, 3, 255]);
    expect(buffer.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
    expect(buffer.toString('ascii', 12, 16)).toBe('IHDR');
    // IEND ocupa 12 bytes al final: largo(4) + tipo(4) + CRC(4).
    expect(buffer.subarray(-12).toString('ascii', 4, 8)).toBe('IEND');
  });

  test('los CRC de cada chunk son correctos (si no, el visor lo rechaza)', () => {
    const { buffer } = pngDePrueba(16, 16, (x, y) => [x, y, 0, 255]);
    let off = 8;
    let revisados = 0;
    while (off < buffer.length) {
      const len = buffer.readUInt32BE(off);
      const cuerpo = buffer.subarray(off + 4, off + 8 + len);
      const crcGuardado = buffer.readUInt32BE(off + 8 + len);
      expect(crcGuardado).toBe(zlib.crc32(cuerpo) >>> 0);
      revisados++;
      off += 12 + len;
    }
    expect(revisados).toBe(3);             // IHDR + IDAT + IEND
  });
});

// ===========================================================================
describe('el decodificador entiende los cinco filtros de PNG', () => {
  // El codificador elige el filtro por línea según una heurística, así que con
  // una imagen bastante variada se ejercitan varios caminos. Para asegurarnos
  // de cubrir los cinco, se fuerza cada uno a mano.
  test.each([0, 1, 2, 3, 4])('filtro %i', (filtro) => {
    const ancho = 12, alto = 6, canales = 4;
    const anchoBytes = ancho * canales;

    const plano = Buffer.alloc(alto * anchoBytes);
    for (let i = 0; i < plano.length; i++) plano[i] = (i * 7 + 13) % 256;

    // Aplicar el filtro elegido a cada scanline.
    const filtrado = Buffer.alloc(alto * (anchoBytes + 1));
    const paeth = (a, b, c) => {
      const p = a + b - c;
      const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
      if (pa <= pb && pa <= pc) return a;
      return pb <= pc ? b : c;
    };
    for (let y = 0; y < alto; y++) {
      filtrado[y * (anchoBytes + 1)] = filtro;
      for (let x = 0; x < anchoBytes; x++) {
        const izq    = x >= canales ? plano[y * anchoBytes + x - canales] : 0;
        const arr    = y > 0 ? plano[(y - 1) * anchoBytes + x] : 0;
        const arrIzq = (y > 0 && x >= canales) ? plano[(y - 1) * anchoBytes + x - canales] : 0;
        const v = plano[y * anchoBytes + x];
        let f;
        switch (filtro) {
          case 0: f = v; break;
          case 1: f = v - izq; break;
          case 2: f = v - arr; break;
          case 3: f = v - ((izq + arr) >> 1); break;
          default: f = v - paeth(izq, arr, arrIzq);
        }
        filtrado[y * (anchoBytes + 1) + 1 + x] = f & 0xff;
      }
    }

    // Armar el PNG a mano con ese IDAT.
    const chunk = (tipo, datos) => {
      const len = Buffer.alloc(4); len.writeUInt32BE(datos.length);
      const cuerpo = Buffer.concat([Buffer.from(tipo, 'ascii'), datos]);
      const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(cuerpo) >>> 0);
      return Buffer.concat([len, cuerpo, crc]);
    };
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(ancho, 0); ihdr.writeUInt32BE(alto, 4);
    ihdr[8] = 8; ihdr[9] = 6;
    const png = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk('IHDR', ihdr),
      chunk('IDAT', zlib.deflateSync(filtrado)),
      chunk('IEND', Buffer.alloc(0)),
    ]);

    expect(Buffer.compare(decodificar(png).rgba, plano)).toBe(0);
  });
});

// ===========================================================================
describe('el redimensionado', () => {
  test('un color plano sigue siendo el mismo color plano', () => {
    const { rgba } = pngDePrueba(100, 100, () => [200, 100, 50, 255]);
    const chico = redimensionar(rgba, 100, 100, 10, 10);
    for (let i = 0; i < chico.length; i += 4) {
      expect([chico[i], chico[i + 1], chico[i + 2], chico[i + 3]])
        .toEqual([200, 100, 50, 255]);
    }
  });

  test('promedia por área en vez de quedarse con un píxel suelto', () => {
    // Tablero de 2x2 blanco/negro: reducido a 1x1 tiene que dar gris medio.
    // Con vecino más cercano daría 0 o 255 según qué esquina toque.
    const rgba = Buffer.from([
      0, 0, 0, 255,       255, 255, 255, 255,
      255, 255, 255, 255, 0, 0, 0, 255,
    ]);
    const chico = redimensionar(rgba, 2, 2, 1, 1);
    expect(chico[0]).toBeGreaterThan(120);
    expect(chico[0]).toBeLessThan(136);
  });

  // El detalle sutil: si el promedio de color ignorara el alfa, los píxeles
  // transparentes (casi siempre negros) arrastrarían el borde del logo hacia
  // el oscuro y dejarían un halo sucio alrededor.
  test('los píxeles transparentes no ensucian el color del borde', () => {
    // Mitad izquierda: rojo opaco. Mitad derecha: negro totalmente transparente.
    const rgba = Buffer.from([
      255, 0, 0, 255,  0, 0, 0, 0,
      255, 0, 0, 255,  0, 0, 0, 0,
    ]);
    const chico = redimensionar(rgba, 2, 2, 1, 1);

    // El color tiene que seguir siendo rojo puro, no un rojo oscurecido.
    expect(chico[0]).toBe(255);
    expect(chico[1]).toBe(0);
    expect(chico[2]).toBe(0);
    // Y el alfa, el promedio real de cobertura.
    expect(chico[3]).toBe(128);
  });

  test('respeta la proporción al reducir', () => {
    const { buffer } = pngDePrueba(400, 100, (x, y) => [x % 256, y % 256, 0, 255]);
    const r = optimizar(buffer, 200);
    expect([r.ancho, r.alto]).toEqual([200, 50]);
    expect(r.redimensionado).toBe(true);
  });

  test('no agranda una imagen que ya está dentro del presupuesto', () => {
    const { buffer } = pngDePrueba(50, 50, (x) => [x * 5, 0, 0, 255]);
    const r = optimizar(buffer, 320);
    expect([r.ancho, r.alto]).toEqual([50, 50]);
    expect(r.redimensionado).toBe(false);
  });
});

// ===========================================================================
describe('los assets reales se decodifican', () => {
  const assets = [
    'rc_logo.png',
    ...fs.readdirSync(path.join(IMAGENES, 'brands'))
      .filter((f) => f.toLowerCase().endsWith('.png'))
      .map((f) => path.join('brands', f)),
  ];

  test('hay assets que revisar', () => {
    expect(assets.length).toBeGreaterThan(3);
  });

  test.each(assets)('%s — se decodifica y coincide con su cabecera', (rel) => {
    const buf = fs.readFileSync(path.join(IMAGENES, rel));
    const img = decodificar(buf);

    // El IHDR está en un offset fijo: sirve de verificación independiente.
    expect(img.ancho).toBe(buf.readUInt32BE(16));
    expect(img.alto).toBe(buf.readUInt32BE(20));
    expect(img.rgba.length).toBe(img.ancho * img.alto * 4);
  });
});

// ===========================================================================
// El guardián a futuro. Un logo nuevo a resolución de cámara se suma al peso de
// CADA proforma generada, y nadie lo nota hasta que los PDFs pesan megas.
// ===========================================================================
describe('presupuesto de los assets embebidos en el PDF', () => {
  const marcas = fs.readdirSync(path.join(IMAGENES, 'brands'))
    .filter((f) => f.toLowerCase().endsWith('.png'));

  test.each(marcas)('brands/%s no supera los %i px de lado', (archivo) => {
    const buf = fs.readFileSync(path.join(IMAGENES, 'brands', archivo));
    const mayor = Math.max(buf.readUInt32BE(16), buf.readUInt32BE(20));

    if (mayor > PRESUPUESTO.marcas) {
      throw new Error(
        `brands/${archivo} mide ${buf.readUInt32BE(16)}x${buf.readUInt32BE(20)} px ` +
        `(máximo ${PRESUPUESTO.marcas}). La franja de marcas lo dibuja a 30 pt de alto, ` +
        `así que el resto son bytes muertos dentro de cada proforma. ` +
        `Corregilo con: node scripts/optimize-images.js --write`
      );
    }
    expect(mayor).toBeLessThanOrEqual(PRESUPUESTO.marcas);
  });

  test(`rc_logo.png no supera los ${PRESUPUESTO.rcLogo} px de lado`, () => {
    const buf = fs.readFileSync(path.join(IMAGENES, 'rc_logo.png'));
    expect(Math.max(buf.readUInt32BE(16), buf.readUInt32BE(20)))
      .toBeLessThanOrEqual(PRESUPUESTO.rcLogo);
  });

  test('todos los logos juntos pesan menos de 200 KB', () => {
    const total = [
      path.join(IMAGENES, 'rc_logo.png'),
      ...marcas.map((f) => path.join(IMAGENES, 'brands', f)),
    ].reduce((suma, p) => suma + fs.statSync(p).size, 0);

    // Este número va dentro de cada PDF. Antes de optimizar eran 1360 KB.
    expect(total).toBeLessThan(200 * 1024);
  });
});

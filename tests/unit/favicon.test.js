// =============================================================================
// tests/unit/favicon.test.js
// El ícono de la pestaña existe, está enlazado, y es del amarillo de la marca.
//
// POR QUÉ EXISTE
// Hasta el 2026-09-02 la aplicación no tenía favicon: la pestaña mostraba el
// globo gris genérico del navegador. Es lo primero que ve alguien que tiene
// varias pestañas abiertas, y era lo único de la interfaz que no decía nada.
//
// Tres maneras silenciosas de romperlo:
//
//   1. QUE LOS ARCHIVOS DESAPAREZCAN pero los <link> se queden. El navegador
//      pide el ícono, recibe un 404, y muestra el globo gris — sin ningún error
//      visible para quien despliega.
//
//   2. QUE EL AMARILLO SE DESVÍE. El ícono se genera leyendo --clr-marca de
//      tokens.css. Si alguien lo regenera con otro token, o edita el PNG a
//      mano, la pestaña queda de un amarillo distinto al de la aplicación. Y no
//      se nota, porque las dos cosas nunca se ven juntas.
//
//   3. QUE SE AGREGUE UNA PÁGINA SIN ÍCONO. Una pantalla nueva que copie otro
//      HTML como base y se saltee los <link> vuelve al globo gris sólo en esa.
//
// El punto 2 se comprueba decodificando el PNG y mirando el color real de una
// esquina, no confiando en que el script se haya corrido.
// =============================================================================

'use strict';

const fs   = require('fs');
const path = require('path');
const zlib = require('zlib');

const RAIZ   = path.resolve(__dirname, '../..');
const PUBLIC = path.join(RAIZ, 'public');

const ARCHIVOS = ['favicon.svg', 'favicon-16.png', 'favicon-32.png', 'favicon-180.png'];
const PAGINAS  = ['index.html', 'dashboard.html', '404.html'];

const leer = (f) => fs.readFileSync(path.join(PUBLIC, f), 'utf8');

/** El valor de un token de color en tokens.css. */
function token(nombre) {
  const css = leer('css/tokens.css');
  const m = css.match(new RegExp(`^\\s*${nombre}\\s*:\\s*(#[0-9A-Fa-f]{6})\\s*;`, 'm'));
  return m ? m[1].toUpperCase() : null;
}

/**
 * El color de un píxel de un PNG RGBA de 8 bits sin entrelazar.
 * Se recorre hasta la fila pedida aplicando los filtros; para un ícono de 180
 * de lado es instantáneo y evita traer una dependencia de imágenes.
 */
function pixel(rutaPng, px, py) {
  const d = fs.readFileSync(rutaPng);
  let i = 8, w = 0, tipo = 0;
  const trozos = [];
  while (i < d.length) {
    const largo = d.readUInt32BE(i);
    const nombre = d.toString('ascii', i + 4, i + 8);
    const datos = d.subarray(i + 8, i + 8 + largo);
    if (nombre === 'IHDR') { w = datos.readUInt32BE(0); tipo = datos[9]; }
    else if (nombre === 'IDAT') trozos.push(datos);
    else if (nombre === 'IEND') break;
    i += 12 + largo;
  }
  if (tipo !== 6) throw new Error(`Se esperaba un PNG RGBA, vino tipo ${tipo}`);

  const canales = 4;
  const anchoLinea = w * canales;
  const crudo = zlib.inflateSync(Buffer.concat(trozos));

  let prev = Buffer.alloc(anchoLinea);
  let pos = 0, linea = null;
  for (let y = 0; y <= py; y++) {
    const filtro = crudo[pos++];
    linea = Buffer.from(crudo.subarray(pos, pos + anchoLinea));
    pos += anchoLinea;
    for (let x = 0; x < anchoLinea; x++) {
      const a = x >= canales ? linea[x - canales] : 0;
      const b = prev[x];
      const c = x >= canales ? prev[x - canales] : 0;
      if (filtro === 1) linea[x] = (linea[x] + a) & 255;
      else if (filtro === 2) linea[x] = (linea[x] + b) & 255;
      else if (filtro === 3) linea[x] = (linea[x] + ((a + b) >> 1)) & 255;
      else if (filtro === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        linea[x] = (linea[x] + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 255;
      }
    }
    prev = linea;
  }

  const o = px * canales;
  return {
    hex: '#' + [linea[o], linea[o + 1], linea[o + 2]]
      .map((v) => v.toString(16).toUpperCase().padStart(2, '0')).join(''),
    alfa: linea[o + 3],
  };
}

describe('el ícono de la pestaña', () => {
  test.each(ARCHIVOS)('%s existe y no está vacío', (f) => {
    const ruta = path.join(PUBLIC, f);
    expect(fs.existsSync(ruta)).toBe(true);
    expect(fs.statSync(ruta).size).toBeGreaterThan(100);
  });

  test.each(PAGINAS)('%s enlaza el ícono', (pagina) => {
    const html = leer(pagina);
    expect(html).toMatch(/<link[^>]+rel="icon"[^>]+favicon\.svg/);
    expect(html).toMatch(/<link[^>]+rel="apple-touch-icon"[^>]+favicon-180\.png/);
  });

  test('cada archivo que los HTML nombran existe en disco', () => {
    const faltan = [];
    for (const pagina of PAGINAS) {
      const nombrados = [...leer(pagina).matchAll(/href="\/(favicon[\w.-]*)\?/g)].map((m) => m[1]);
      expect(nombrados.length).toBeGreaterThan(0);
      for (const f of nombrados) {
        if (!fs.existsSync(path.join(PUBLIC, f))) faltan.push(`${pagina} → /${f}`);
      }
    }

    if (faltan.length) {
      throw new Error(
        'Estas páginas piden un ícono que no está en disco:\n  ' + faltan.join('\n  ') +
        '\n\nEl navegador recibe un 404 y muestra el globo gris genérico. No hay ' +
        'ningún error visible al desplegar: la pestaña simplemente queda sin marca.'
      );
    }
  });
});

describe('el ícono es del amarillo de la marca', () => {
  // La esquina 3,3 del ícono de 180: bien dentro del fondo amarillo y lejos
  // tanto del redondeo de la esquina como de las puntas del engranaje.
  const MUESTRA = { x: 14, y: 14 };

  test('el fondo del PNG coincide con --clr-marca', () => {
    const esperado = token('--clr-marca');
    expect(esperado).toMatch(/^#[0-9A-F]{6}$/);

    const p = pixel(path.join(PUBLIC, 'favicon-180.png'), MUESTRA.x, MUESTRA.y);

    expect(p.alfa).toBe(255);
    if (p.hex !== esperado) {
      throw new Error(
        `El ícono tiene el fondo ${p.hex} pero --clr-marca es ${esperado}.\n\n` +
        'El ícono se genera leyendo ese token: si no coinciden, o se editó el ' +
        'PNG a mano o el token cambió sin volver a correr ' +
        '`node scripts/generar-favicon.js`. La pestaña quedaría de un amarillo ' +
        'distinto al de la aplicación, y eso nadie lo nota porque las dos cosas ' +
        'nunca se ven juntas.'
      );
    }
  });

  test('el SVG usa los dos colores de la marca', () => {
    const svg = leer('favicon.svg');
    expect(svg).toContain(token('--clr-marca'));
    expect(svg).toContain(token('--text-sobre-marca'));
  });

  test('el script generador está versionado', () => {
    // Sin el script, el ícono se vuelve un binario que nadie sabe rehacer.
    expect(fs.existsSync(path.join(RAIZ, 'scripts/generar-favicon.js'))).toBe(true);
  });
});

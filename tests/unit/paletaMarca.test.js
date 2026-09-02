// =============================================================================
// tests/unit/paletaMarca.test.js
// La identidad visual no puede desviarse del logo, y el amarillo no puede
// llevar texto blanco encima.
//
// POR QUÉ EXISTE
// El 2026-09-02 la paleta pasó a construirse sobre el amarillo de la marca. Ese
// cambio trae dos maneras silenciosas de romperse:
//
//   1. QUE EL COLOR SE DESVÍE DEL LOGO. `--clr-marca` no se eligió a ojo: se
//      midió del archivo del logo. Si alguien lo «ajusta un poquito», la
//      pantalla y el logo dejan de ser el mismo amarillo y nadie se entera,
//      porque nunca se ven pegados. Este archivo vuelve a medir el PNG y
//      compara.
//
//   2. QUE ALGO ESCRIBA EN BLANCO SOBRE EL AMARILLO. Es el bug concreto que
//      este cambio estuvo a punto de introducir: `.btn-primary` era
//      `background: var(--clr-blue); color: var(--clr-white)`. Al volver
//      amarillo el fondo sin tocar el texto, el rótulo del botón más usado de
//      la aplicación quedaba ilegible. Blanco sobre #FCCC24 da un contraste de
//      ~1.4:1 — el mínimo legible es 4.5:1.
//
// La regla, entonces: encima del amarillo va --text-sobre-marca, nunca blanco.
// =============================================================================

'use strict';

const fs   = require('fs');
const path = require('path');
const zlib = require('zlib');

const RAIZ = path.resolve(__dirname, '../..');
const CSS_DIR = path.join(RAIZ, 'public/css');
const LOGO = path.join(RAIZ, 'src/assets/images/rc_logo.png');

// Se normalizan los saltos de línea: los archivos están en CRLF en Windows y
// los patrones de más abajo buscan `\n}` — con CRLF no matchean y el test
// pasaría por no encontrar nada que revisar, que es la peor forma de pasar.
const leerCss = (f) =>
  fs.readFileSync(path.join(CSS_DIR, f), 'utf8').replace(/\r\n/g, '\n');
const TOKENS  = leerCss('tokens.css');
const TODO_EL_CSS = fs.readdirSync(CSS_DIR)
  .filter((f) => f.endsWith('.css'))
  .map((f) => ({ archivo: f, texto: leerCss(f) }));

/** El valor literal de un token en tokens.css. */
function valorToken(nombre) {
  const m = TOKENS.match(new RegExp(`^\\s*${nombre}\\s*:\\s*([^;]+);`, 'm'));
  return m ? m[1].trim() : null;
}

// ---------------------------------------------------------------------------
// Lectura mínima de PNG. Sin dependencias: sólo zlib, que viene con Node.
// Soporta color tipo 2 (RGB) y 6 (RGBA) a 8 bits, que es lo que es el logo.
// ---------------------------------------------------------------------------
function colorDominante(rutaPng) {
  const d = fs.readFileSync(rutaPng);
  let i = 8, w = 0, h = 0, tipo = 0;
  const trozos = [];

  while (i < d.length) {
    const largo = d.readUInt32BE(i);
    const nombre = d.toString('ascii', i + 4, i + 8);
    const datos = d.subarray(i + 8, i + 8 + largo);
    if (nombre === 'IHDR') { w = datos.readUInt32BE(0); h = datos.readUInt32BE(4); tipo = datos[9]; }
    else if (nombre === 'IDAT') trozos.push(datos);
    else if (nombre === 'IEND') break;
    i += 12 + largo;
  }

  const canales = tipo === 6 ? 4 : 3;
  const bpp = canales;
  const anchoLinea = w * canales;
  const crudo = zlib.inflateSync(Buffer.concat(trozos));

  const cuenta = new Map();
  let prev = Buffer.alloc(anchoLinea);
  let pos = 0;

  for (let y = 0; y < h; y++) {
    const filtro = crudo[pos++];
    const linea = Buffer.from(crudo.subarray(pos, pos + anchoLinea));
    pos += anchoLinea;

    for (let x = 0; x < anchoLinea; x++) {
      const a = x >= bpp ? linea[x - bpp] : 0;
      const b = prev[x];
      const c = x >= bpp ? prev[x - bpp] : 0;
      if (filtro === 1) linea[x] = (linea[x] + a) & 255;
      else if (filtro === 2) linea[x] = (linea[x] + b) & 255;
      else if (filtro === 3) linea[x] = (linea[x] + ((a + b) >> 1)) & 255;
      else if (filtro === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        linea[x] = (linea[x] + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 255;
      }
    }

    for (let x = 0; x < anchoLinea; x += canales) {
      const clave = (linea[x] << 16) | (linea[x + 1] << 8) | linea[x + 2];
      cuenta.set(clave, (cuenta.get(clave) || 0) + 1);
    }
    prev = linea;
  }

  let mejor = 0, mejorN = -1;
  for (const [clave, n] of cuenta) if (n > mejorN) { mejorN = n; mejor = clave; }
  return '#' + mejor.toString(16).toUpperCase().padStart(6, '0');
}

// ---------------------------------------------------------------------------
// Contraste WCAG. Se calcula acá y no se copia una tabla: así el umbral es una
// regla, no un número que alguien anotó una vez.
// ---------------------------------------------------------------------------
function luminancia(hex) {
  const v = [1, 3, 5].map((i) => {
    const c = parseInt(hex.substr(i, 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
}

function contraste(hexA, hexB) {
  const a = luminancia(hexA), b = luminancia(hexB);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

// ---------------------------------------------------------------------------
describe('el amarillo de la marca sale del logo', () => {
  test('el archivo del logo existe', () => {
    expect(fs.existsSync(LOGO)).toBe(true);
  });

  test('--clr-marca es el color dominante de rc_logo.png', () => {
    const delLogo = colorDominante(LOGO);
    const delCss  = (valorToken('--clr-marca') || '').toUpperCase();

    if (delCss !== delLogo) {
      throw new Error(
        `--clr-marca vale ${delCss} pero el logo es ${delLogo}.\n\n` +
        'Ese color no se elige a ojo: se mide de src/assets/images/rc_logo.png. ' +
        'Si el logo cambió, actualizá el token; si el token se "ajustó", la ' +
        'pantalla y el logo dejaron de ser el mismo amarillo — y nadie lo nota, ' +
        'porque nunca se ven pegados.'
      );
    }
  });
});

describe('nada se escribe en blanco sobre el amarillo', () => {
  const MARCA  = valorToken('--clr-marca');
  const ENCIMA = valorToken('--text-sobre-marca');

  test('los dos tokens existen', () => {
    expect(MARCA).toMatch(/^#[0-9A-Fa-f]{6}$/);
    expect(ENCIMA).toMatch(/^#[0-9A-Fa-f]{6}$/);
  });

  test('--text-sobre-marca es legible sobre --clr-marca (>= 4.5:1)', () => {
    const r = contraste(MARCA, ENCIMA);
    expect(r).toBeGreaterThanOrEqual(4.5);
  });

  test('el blanco NO sería legible — por eso existe la regla', () => {
    // No es una curiosidad: documenta por qué --text-sobre-marca tiene que
    // usarse. Si algún día este número supera 4.5, la regla puede relajarse.
    expect(contraste(MARCA, '#FFFFFF')).toBeLessThan(3);
  });

  test('ninguna regla pone --clr-white sobre un fondo de marca', () => {
    const culpables = [];

    for (const { archivo, texto } of TODO_EL_CSS) {
      // Cada bloque `selector { … }` por separado.
      const bloques = texto.match(/\{[^{}]*\}/g) || [];
      for (const bloque of bloques) {
        const fondoDeMarca =
          /background(?:-color)?\s*:\s*var\(--clr-marca(?:-fuerte)?\)/.test(bloque);
        const textoBlanco =
          /(?:^|[^-])color\s*:\s*(var\(--clr-white\)|#fff\b|#ffffff\b|white)/i.test(bloque);
        if (fondoDeMarca && textoBlanco) {
          culpables.push(`${archivo}: ${bloque.replace(/\s+/g, ' ').slice(0, 110)}`);
        }
      }
    }

    if (culpables.length) {
      throw new Error(
        'Texto blanco sobre el amarillo de la marca:\n  ' + culpables.join('\n  ') +
        `\n\nEl contraste es ~${contraste(MARCA, '#FFFFFF').toFixed(2)}:1 y el mínimo ` +
        'legible es 4.5:1. Encima del amarillo va var(--text-sobre-marca).'
      );
    }
  });

  test('.btn-primary usa la marca y su tinta oscura', () => {
    const botones = leerCss('buttons.css');
    const regla = botones.match(/^\.btn-primary\s*\{[^}]*\}/m);
    expect(regla).not.toBeNull();
    expect(regla[0]).toContain('var(--clr-marca)');
    expect(regla[0]).toContain('var(--text-sobre-marca)');
    expect(regla[0]).not.toContain('--clr-white');
  });
});

describe('el tema claro cubre todo lo que el oscuro define', () => {
  // Un token que el tema oscuro define y el claro no vuelve a mapear se queda
  // con el valor OSCURO sobre fondo de papel. Es el modo clásico de que el modo
  // claro salga «casi bien»: un texto ilegible acá y allá, sin ningún error.
  test('cada --light-* se usa en los DOS bloques de tema claro', () => {
    const declarados = [...TOKENS.matchAll(/^\s*(--light-[a-z-]+)\s*:/gm)].map((m) => m[1]);
    expect(declarados.length).toBeGreaterThan(10);

    // Se ancla en la llave de apertura para no empezar a matchear en el
    // comentario del encabezado, que también nombra la media query. Y el cierre
    // admite indentación: el bloque termina en «\n  }\n}», no en «\n}\n}».
    const media     = TOKENS.match(/@media \(prefers-color-scheme: light\)\s*\{[\s\S]*?\n\s*\}\n\}/);
    const explicito = TOKENS.match(/:root\[data-theme="light"\]\s*\{[\s\S]*?\n\}/);
    expect(media).not.toBeNull();
    expect(explicito).not.toBeNull();

    const faltan = [];
    for (const t of declarados) {
      if (!media[0].includes(`var(${t})`))     faltan.push(`${t} — falta en @media`);
      if (!explicito[0].includes(`var(${t})`)) faltan.push(`${t} — falta en [data-theme="light"]`);
    }

    if (faltan.length) {
      throw new Error(
        'Tokens del tema claro declarados pero no mapeados:\n  ' + faltan.join('\n  ') +
        '\n\nSi falta en uno de los dos bloques, el modo claro se ve distinto ' +
        'según se haya elegido a mano o venga de la preferencia del sistema — y ' +
        'el token conserva su valor OSCURO sobre fondo de papel.'
      );
    }
  });
});

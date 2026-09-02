#!/usr/bin/env node
// =============================================================================
// scripts/generar-favicon.js
// Genera el ícono de la pestaña a partir de la identidad de la marca.
//
// QUÉ DIBUJA
// El engranaje negro del logo sobre el amarillo del logo. Son los dos únicos
// elementos de `src/assets/images/rc_logo.png` que sobreviven a 16 píxeles: el
// texto «RC TRACTOPARTS» a ese tamaño es una mancha.
//
// POR QUÉ SE GENERA Y NO SE RECORTA EL LOGO
// El logo es de 640×339 y el engranaje ocupa una parte pequeña y descentrada.
// Recortarlo y reducirlo daría un engranaje sucio, con el antialias del PNG
// original encima del propio. Dibujarlo de cero da bordes limpios en cada
// tamaño — y, sobre todo, deja la geometría en el código: cambiar los dientes o
// el grosor es cambiar un número acá, no volver a abrir un editor de imágenes.
//
// EL AMARILLO NO ESTÁ ESCRITO ACÁ
// Se lee de public/css/tokens.css (--clr-marca), que a su vez está verificado
// contra el PNG del logo por tests/unit/paletaMarca.test.js. Así el ícono no
// puede quedar de un amarillo distinto al del resto de la aplicación.
//
// SIN DEPENDENCIAS
// El PNG se escribe a mano con zlib, que viene con Node. Agregar una librería
// de imágenes para generar dos archivos que casi nunca cambian sería
// desproporcionado.
//
// USO
//   node scripts/generar-favicon.js
// Escribe public/favicon-32.png, public/favicon-180.png y public/favicon.svg.
// =============================================================================

'use strict';

const fs   = require('fs');
const path = require('path');
const zlib = require('zlib');

const RAIZ   = path.resolve(__dirname, '..');
const TOKENS = path.join(RAIZ, 'public/css/tokens.css');
const SALIDA = path.join(RAIZ, 'public');

// ── La geometría del engranaje, en fracciones del lado ──────────────────────
// Todo relativo, para que el dibujo sea idéntico en 32 y en 180 píxeles.
// El hueco es GRANDE a propósito. Con uno chico, a 16 píxeles —el tamaño real
// de una pestaña— el engranaje se empasta y queda una mancha oscura con un
// punto. Abriendo el centro se lee como anillo dentado incluso ahí, que es
// además la proporción que tiene el engranaje del logo.
const DIENTES      = 8;
const R_PUNTA      = 0.445;  // hasta dónde llega la punta de un diente
const R_CUERPO     = 0.330;  // el borde exterior del anillo
const R_HUECO      = 0.195;  // el agujero del centro
const ANCHO_DIENTE = 0.50;   // fracción del paso que ocupa cada diente
const REDONDEO     = 0.16;   // esquinas del cuadrado de fondo
const MUESTREO     = 4;      // submuestreo por eje para suavizar bordes

/** El valor de un token leído de tokens.css. */
function token(nombre) {
  const css = fs.readFileSync(TOKENS, 'utf8');
  const m = css.match(new RegExp(`^\\s*${nombre}\\s*:\\s*(#[0-9A-Fa-f]{6})\\s*;`, 'm'));
  if (!m) throw new Error(`No se encontró ${nombre} en public/css/tokens.css`);
  return m[1].toUpperCase();
}

const aRgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.substr(i, 2), 16));

/** ¿Este punto cae dentro del engranaje? */
function enEngranaje(x, y, lado) {
  const c = lado / 2;
  const dx = x - c, dy = y - c;
  const d = Math.hypot(dx, dy) / lado;

  if (d < R_HUECO) return false;          // el agujero del centro
  if (d <= R_CUERPO) return true;         // el anillo macizo
  if (d > R_PUNTA) return false;          // más allá de las puntas

  // Zona de dientes: se mira en qué parte del paso angular cae.
  const paso = (Math.PI * 2) / DIENTES;
  let a = Math.atan2(dy, dx);
  if (a < 0) a += Math.PI * 2;
  const dentro = ((a % paso) / paso);
  return Math.abs(dentro - 0.5) < ANCHO_DIENTE / 2;
}

/** ¿Cae dentro del cuadrado de esquinas redondeadas? */
function enFondo(x, y, lado) {
  const r = lado * REDONDEO;
  const cx = Math.min(Math.max(x, r), lado - r);
  const cy = Math.min(Math.max(y, r), lado - r);
  return Math.hypot(x - cx, y - cy) <= r;
}

/** Píxeles RGBA del ícono, con bordes suavizados por submuestreo. */
function pintar(lado, amarillo, negro) {
  const [ar, ag, ab] = aRgb(amarillo);
  const [nr, ng, nb] = aRgb(negro);
  const px = Buffer.alloc(lado * lado * 4);
  const sub = MUESTREO * MUESTREO;

  for (let y = 0; y < lado; y++) {
    for (let x = 0; x < lado; x++) {
      let fondo = 0, engranaje = 0;
      for (let sy = 0; sy < MUESTREO; sy++) {
        for (let sx = 0; sx < MUESTREO; sx++) {
          const px2 = x + (sx + 0.5) / MUESTREO;
          const py2 = y + (sy + 0.5) / MUESTREO;
          if (!enFondo(px2, py2, lado)) continue;
          fondo++;
          if (enEngranaje(px2, py2, lado)) engranaje++;
        }
      }

      const i = (y * lado + x) * 4;
      if (fondo === 0) { px[i + 3] = 0; continue; }   // fuera del ícono
      const t = engranaje / fondo;                    // cuánto hay de engranaje
      px[i]     = Math.round(ar + (nr - ar) * t);
      px[i + 1] = Math.round(ag + (ng - ag) * t);
      px[i + 2] = Math.round(ab + (nb - ab) * t);
      px[i + 3] = Math.round(255 * (fondo / sub));    // borde del cuadrado
    }
  }
  return px;
}

// ── Escritura del PNG ───────────────────────────────────────────────────────
function crc32(buf) {
  let c, crc = 0xFFFFFFFF;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xFF;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    crc = c ^ (crc >>> 8);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function trozo(nombre, datos) {
  const largo = Buffer.alloc(4);
  largo.writeUInt32BE(datos.length);
  const cuerpo = Buffer.concat([Buffer.from(nombre, 'ascii'), datos]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(cuerpo));
  return Buffer.concat([largo, cuerpo, crc]);
}

function escribirPng(ruta, lado, px) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(lado, 0);
  ihdr.writeUInt32BE(lado, 4);
  ihdr[8] = 8;    // bits por canal
  ihdr[9] = 6;    // RGBA
  // 10, 11, 12 quedan en 0: compresión, filtro e interlazado estándar.

  // Cada línea va precedida por su byte de filtro. Se usa 0 (sin filtro): el
  // ícono es chico y ahorrar unos bytes no compensa la complejidad.
  const crudo = Buffer.alloc(lado * (lado * 4 + 1));
  for (let y = 0; y < lado; y++) {
    crudo[y * (lado * 4 + 1)] = 0;
    px.copy(crudo, y * (lado * 4 + 1) + 1, y * lado * 4, (y + 1) * lado * 4);
  }

  fs.writeFileSync(ruta, Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    trozo('IHDR', ihdr),
    trozo('IDAT', zlib.deflateSync(crudo, { level: 9 })),
    trozo('IEND', Buffer.alloc(0)),
  ]));
}

/** El mismo dibujo en SVG: nítido en cualquier tamaño y pesa nada. */
function escribirSvg(ruta, amarillo, negro) {
  const L = 64, c = L / 2;
  const dientes = [];
  for (let i = 0; i < DIENTES; i++) {
    const ang = (360 / DIENTES) * i;
    const ancho = L * (Math.PI * 2 * R_PUNTA) * (ANCHO_DIENTE / DIENTES);
    const alto = L * (R_PUNTA - R_CUERPO) + 2;
    dientes.push(
      `<rect x="${(c - ancho / 2).toFixed(2)}" y="${(c - L * R_PUNTA).toFixed(2)}" ` +
      `width="${ancho.toFixed(2)}" height="${alto.toFixed(2)}" rx="${(ancho * 0.22).toFixed(2)}" ` +
      `transform="rotate(${ang} ${c} ${c})"/>`
    );
  }

  fs.writeFileSync(ruta,
`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${L} ${L}" role="img" aria-label="RC Tractoparts">
  <rect width="${L}" height="${L}" rx="${(L * REDONDEO).toFixed(1)}" fill="${amarillo}"/>
  <g fill="${negro}">
    ${dientes.join('\n    ')}
    <circle cx="${c}" cy="${c}" r="${(L * R_CUERPO).toFixed(2)}"/>
  </g>
  <circle cx="${c}" cy="${c}" r="${(L * R_HUECO).toFixed(2)}" fill="${amarillo}"/>
</svg>
`);
}

// ── Ejecución ───────────────────────────────────────────────────────────────
const amarillo = token('--clr-marca');
const negro    = token('--text-sobre-marca');

for (const lado of [16, 32, 180]) {
  const destino = path.join(SALIDA, `favicon-${lado}.png`);
  escribirPng(destino, lado, pintar(lado, amarillo, negro));
  console.log(`  ${path.relative(RAIZ, destino)}  (${lado}x${lado}, ${fs.statSync(destino).size} bytes)`);
}

const svg = path.join(SALIDA, 'favicon.svg');
escribirSvg(svg, amarillo, negro);
console.log(`  ${path.relative(RAIZ, svg)}  (${fs.statSync(svg).size} bytes)`);
console.log(`\nAmarillo ${amarillo} y tinta ${negro}, leídos de tokens.css.`);

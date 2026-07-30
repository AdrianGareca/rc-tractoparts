#!/usr/bin/env node
// =============================================================================
// scripts/optimize-images.js
// Reduce los logos a la resolución que la proforma realmente usa.
//
// EL PROBLEMA
// PDFKit embebe los PNG con sus píxeles originales: no los reescala al tamaño
// en que se dibujan. La franja de marcas dibuja cada logo a 30 pt de alto —
// unos 125 px a 300 DPI — pero john_deere.png medía 3840x2160 y pesaba 897 KB.
// Los seis logos más el de RC sumaban ~1,3 MB metidos en CADA proforma
// generada, sin importar su contenido. Con 105 cotizaciones eso eran 141 MB de
// uploads, respaldos más lentos y PDFs de 1,3 MB que en una conexión de Santa
// Cruz tardan una eternidad en abrirse desde el celular.
//
// POR QUÉ SIN DEPENDENCIAS
// sharp resolvería esto en tres líneas, pero son ~30 MB de binario nativo para
// una tarea que se corre cuando alguien agrega un logo — o sea, casi nunca.
// El proyecto no tiene build step y la lista de dependencias es corta a
// propósito. PNG sin entrelazado es un formato simple y Node ya trae zlib y
// crc32, así que el codec entra en un archivo y no le debe nada a nadie.
//
// USO
//   node scripts/optimize-images.js            # informe, no toca nada
//   node scripts/optimize-images.js --write    # aplica los cambios
//
// Cubierto por tests/unit/imageOptimizer.test.js, que además vigila que ningún
// asset nuevo se pase del presupuesto.
// =============================================================================

'use strict';

const fs   = require('fs');
const path = require('path');
const zlib = require('zlib');

const FIRMA_PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// ── Presupuesto ──────────────────────────────────────────────────────────────
// Lado mayor máximo, en píxeles. Los valores salen del tamaño de dibujo real
// multiplicado con holgura para impresión:
//   marcas  — 30 pt de alto = 125 px a 300 DPI → 320 da margen de sobra
//   rc_logo — caja de 155x72 pt = 300 px de alto a 300 DPI → 640 de lado mayor
const PRESUPUESTO = {
  marcas:  320,
  rcLogo:  640,
};

// =============================================================================
// Lectura de chunks
// =============================================================================

/** Recorre los chunks del PNG: { tipo, datos }. */
function leerChunks(buf) {
  if (!buf.subarray(0, 8).equals(FIRMA_PNG)) throw new Error('No es un PNG.');
  const chunks = [];
  let off = 8;
  while (off < buf.length) {
    const len  = buf.readUInt32BE(off);
    const tipo = buf.toString('ascii', off + 4, off + 8);
    chunks.push({ tipo, datos: buf.subarray(off + 8, off + 8 + len) });
    off += 12 + len;                       // len + tipo + datos + crc
    if (tipo === 'IEND') break;
  }
  return chunks;
}

/** Predictor Paeth (RFC 2083 §6.6). */
function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

// =============================================================================
// decodificar — devuelve SIEMPRE RGBA de 8 bits, sea cual sea el color type
// =============================================================================

function decodificar(buf) {
  const chunks = leerChunks(buf);
  const ihdr   = chunks.find((c) => c.tipo === 'IHDR');
  if (!ihdr) throw new Error('Falta el chunk IHDR.');

  const ancho     = ihdr.datos.readUInt32BE(0);
  const alto      = ihdr.datos.readUInt32BE(4);
  const bits      = ihdr.datos[8];
  const colorType = ihdr.datos[9];
  const entrelazado = ihdr.datos[12];

  // Adam7 y los bit depths raros no aparecen en estos assets; si alguna vez
  // aparecen, es mejor fallar fuerte que escribir un PNG corrupto en silencio.
  if (bits !== 8)        throw new Error(`bitDepth ${bits} no soportado (sólo 8).`);
  if (entrelazado !== 0) throw new Error('PNG entrelazado (Adam7) no soportado.');

  const CANALES = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };
  const canales = CANALES[colorType];
  if (!canales) throw new Error(`colorType ${colorType} no soportado.`);

  const paleta = chunks.find((c) => c.tipo === 'PLTE')?.datos ?? null;
  const trns   = chunks.find((c) => c.tipo === 'tRNS')?.datos ?? null;
  if (colorType === 3 && !paleta) throw new Error('colorType 3 sin PLTE.');

  // Los IDAT pueden venir partidos en varios chunks: hay que concatenarlos
  // ANTES de inflar, porque el stream zlib es uno solo repartido entre ellos.
  const comprimido = Buffer.concat(chunks.filter((c) => c.tipo === 'IDAT').map((c) => c.datos));
  const crudo      = zlib.inflateSync(comprimido);

  const bpp     = canales;                 // bytes por píxel (bitDepth 8)
  const anchoBytes = ancho * bpp;
  const salida  = Buffer.alloc(alto * anchoBytes);

  // Deshacer el filtro de cada scanline. Cada línea viene precedida por un byte
  // que dice con qué filtro se codificó.
  let pos = 0;
  for (let y = 0; y < alto; y++) {
    const filtro = crudo[pos++];
    const linea  = crudo.subarray(pos, pos + anchoBytes);
    pos += anchoBytes;

    const destino = salida.subarray(y * anchoBytes, (y + 1) * anchoBytes);
    const previa  = y > 0 ? salida.subarray((y - 1) * anchoBytes, y * anchoBytes) : null;

    for (let x = 0; x < anchoBytes; x++) {
      const izq   = x >= bpp ? destino[x - bpp] : 0;
      const arr   = previa ? previa[x] : 0;
      const arrIzq = (previa && x >= bpp) ? previa[x - bpp] : 0;
      let v = linea[x];

      switch (filtro) {
        case 0: break;                                       // None
        case 1: v += izq;                             break;  // Sub
        case 2: v += arr;                             break;  // Up
        case 3: v += (izq + arr) >> 1;                break;  // Average
        case 4: v += paeth(izq, arr, arrIzq);         break;  // Paeth
        default: throw new Error(`Filtro ${filtro} desconocido en la línea ${y}.`);
      }
      destino[x] = v & 0xff;
    }
  }

  // Normalizar a RGBA para que el resto del script trabaje con un solo formato.
  const rgba = Buffer.alloc(ancho * alto * 4);
  for (let i = 0, n = ancho * alto; i < n; i++) {
    const s = i * bpp, d = i * 4;
    switch (colorType) {
      case 0:  // gris
        rgba[d] = rgba[d + 1] = rgba[d + 2] = salida[s]; rgba[d + 3] = 255; break;
      case 2:  // RGB
        rgba[d] = salida[s]; rgba[d + 1] = salida[s + 1]; rgba[d + 2] = salida[s + 2]; rgba[d + 3] = 255; break;
      case 3: { // indexado
        const idx = salida[s];
        rgba[d] = paleta[idx * 3]; rgba[d + 1] = paleta[idx * 3 + 1]; rgba[d + 2] = paleta[idx * 3 + 2];
        rgba[d + 3] = trns && idx < trns.length ? trns[idx] : 255;
        break;
      }
      case 4:  // gris + alfa
        rgba[d] = rgba[d + 1] = rgba[d + 2] = salida[s]; rgba[d + 3] = salida[s + 1]; break;
      case 6:  // RGBA
        rgba[d] = salida[s]; rgba[d + 1] = salida[s + 1]; rgba[d + 2] = salida[s + 2]; rgba[d + 3] = salida[s + 3]; break;
    }
  }

  return { ancho, alto, rgba, colorType };
}

// =============================================================================
// redimensionar — promedio por área
// =============================================================================
// Para reducciones grandes (aquí son de 7x a 13x) el promedio de área es la
// opción correcta: cada píxel de salida es la media de TODOS los de entrada que
// le corresponden, así que no se pierde detalle entre muestras como pasaría con
// un muestreo por vecino más cercano, que en un logo con bordes finos produce
// dientes de sierra.
//
// El color se promedia PONDERADO POR ALFA: promediar RGB ignorando la
// transparencia arrastra el color de los píxeles invisibles (normalmente negro)
// hacia los bordes y deja un halo oscuro alrededor del logo.
// =============================================================================

function redimensionar(rgba, ancho, alto, nuevoAncho, nuevoAlto) {
  const salida = Buffer.alloc(nuevoAncho * nuevoAlto * 4);
  const escalaX = ancho / nuevoAncho;
  const escalaY = alto / nuevoAlto;

  for (let y = 0; y < nuevoAlto; y++) {
    const y0 = Math.floor(y * escalaY);
    const y1 = Math.min(alto, Math.ceil((y + 1) * escalaY));

    for (let x = 0; x < nuevoAncho; x++) {
      const x0 = Math.floor(x * escalaX);
      const x1 = Math.min(ancho, Math.ceil((x + 1) * escalaX));

      let r = 0, g = 0, b = 0, a = 0, pesoColor = 0, n = 0;

      for (let sy = y0; sy < y1; sy++) {
        for (let sx = x0; sx < x1; sx++) {
          const i = (sy * ancho + sx) * 4;
          const alfa = rgba[i + 3];
          r += rgba[i] * alfa; g += rgba[i + 1] * alfa; b += rgba[i + 2] * alfa;
          pesoColor += alfa;
          a += alfa;
          n++;
        }
      }

      const d = (y * nuevoAncho + x) * 4;
      if (pesoColor > 0) {
        salida[d]     = Math.round(r / pesoColor);
        salida[d + 1] = Math.round(g / pesoColor);
        salida[d + 2] = Math.round(b / pesoColor);
      }
      salida[d + 3] = n > 0 ? Math.round(a / n) : 0;
    }
  }

  return salida;
}

// =============================================================================
// codificar
// =============================================================================

function chunk(tipo, datos) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(datos.length);
  const cuerpo = Buffer.concat([Buffer.from(tipo, 'ascii'), datos]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(zlib.crc32(cuerpo) >>> 0);
  return Buffer.concat([len, cuerpo, crc]);
}

function codificar(rgba, ancho, alto) {
  // Si ningún píxel es transparente, el canal alfa es un cuarto del peso tirado
  // a la basura: se guarda como RGB.
  let opaca = true;
  for (let i = 3; i < rgba.length; i += 4) {
    if (rgba[i] !== 255) { opaca = false; break; }
  }
  const canales   = opaca ? 3 : 4;
  const colorType = opaca ? 2 : 6;
  const anchoBytes = ancho * canales;

  // Datos sin filtrar, ya en el número de canales final.
  const plano = Buffer.alloc(alto * anchoBytes);
  for (let i = 0, n = ancho * alto; i < n; i++) {
    const s = i * 4, d = i * canales;
    plano[d] = rgba[s]; plano[d + 1] = rgba[s + 1]; plano[d + 2] = rgba[s + 2];
    if (!opaca) plano[d + 3] = rgba[s + 3];
  }

  // Se prueban los cinco filtros por scanline y se elige el de menor suma de
  // valores absolutos (la heurística que recomienda la propia especificación):
  // deja al deflate una entrada mucho más comprimible que un filtro fijo.
  const filtrado = Buffer.alloc(alto * (anchoBytes + 1));
  const candidato = Buffer.alloc(anchoBytes);
  let mejorLinea  = Buffer.alloc(anchoBytes);

  for (let y = 0; y < alto; y++) {
    const linea  = plano.subarray(y * anchoBytes, (y + 1) * anchoBytes);
    const previa = y > 0 ? plano.subarray((y - 1) * anchoBytes, y * anchoBytes) : null;

    let mejorFiltro = 0, mejorCosto = Infinity;

    for (let f = 0; f <= 4; f++) {
      let costo = 0;
      for (let x = 0; x < anchoBytes; x++) {
        const izq    = x >= canales ? linea[x - canales] : 0;
        const arr    = previa ? previa[x] : 0;
        const arrIzq = (previa && x >= canales) ? previa[x - canales] : 0;
        let v;
        switch (f) {
          case 0: v = linea[x]; break;
          case 1: v = linea[x] - izq; break;
          case 2: v = linea[x] - arr; break;
          case 3: v = linea[x] - ((izq + arr) >> 1); break;
          default: v = linea[x] - paeth(izq, arr, arrIzq);
        }
        v &= 0xff;
        candidato[x] = v;
        costo += v < 128 ? v : 256 - v;    // suma de valores con signo
      }
      if (costo < mejorCosto) {
        mejorCosto = costo;
        mejorFiltro = f;
        candidato.copy(mejorLinea);
      }
    }

    filtrado[y * (anchoBytes + 1)] = mejorFiltro;
    mejorLinea.copy(filtrado, y * (anchoBytes + 1) + 1);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(ancho, 0);
  ihdr.writeUInt32BE(alto, 4);
  ihdr[8] = 8;              // bit depth
  ihdr[9] = colorType;
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;   // deflate / filtro adaptativo / sin entrelazar

  const idat = zlib.deflateSync(filtrado, { level: 9, memLevel: 9, strategy: zlib.constants.Z_DEFAULT_STRATEGY });

  return Buffer.concat([
    FIRMA_PNG,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// =============================================================================
// optimizar un archivo
// =============================================================================

/**
 * @param {Buffer} buf      PNG original
 * @param {number} ladoMax  lado mayor permitido, en píxeles
 * @returns {{buffer: Buffer, ancho: number, alto: number, redimensionado: boolean}}
 */
function optimizar(buf, ladoMax) {
  const img = decodificar(buf);
  const mayor = Math.max(img.ancho, img.alto);

  let { ancho, alto, rgba } = img;
  let redimensionado = false;

  if (mayor > ladoMax) {
    const factor = ladoMax / mayor;
    const nuevoAncho = Math.max(1, Math.round(ancho * factor));
    const nuevoAlto  = Math.max(1, Math.round(alto  * factor));
    rgba  = redimensionar(rgba, ancho, alto, nuevoAncho, nuevoAlto);
    ancho = nuevoAncho;
    alto  = nuevoAlto;
    redimensionado = true;
  }

  return { buffer: codificar(rgba, ancho, alto), ancho, alto, redimensionado };
}

module.exports = { decodificar, codificar, redimensionar, optimizar, PRESUPUESTO };

// =============================================================================
// CLI
// =============================================================================

if (require.main === module) {
  const escribir = process.argv.includes('--write');
  const BASE     = path.join(__dirname, '..', 'src', 'assets', 'images');

  const objetivos = [
    { ruta: path.join(BASE, 'rc_logo.png'), ladoMax: PRESUPUESTO.rcLogo },
    ...fs.readdirSync(path.join(BASE, 'brands'))
      .filter((f) => f.toLowerCase().endsWith('.png'))
      .map((f) => ({ ruta: path.join(BASE, 'brands', f), ladoMax: PRESUPUESTO.marcas })),
  ];

  const kb = (n) => (n / 1024).toFixed(1).padStart(7) + ' KB';
  let antesTotal = 0, despuesTotal = 0;

  console.log(escribir ? 'Optimizando…\n' : 'Informe (no se escribe nada — usá --write para aplicar)\n');
  console.log('archivo                    antes      después   dimensiones');
  console.log('─'.repeat(70));

  for (const { ruta, ladoMax } of objetivos) {
    const original = fs.readFileSync(ruta);
    let resultado;
    try {
      resultado = optimizar(original, ladoMax);
    } catch (err) {
      console.log(`${path.basename(ruta).padEnd(20)} ⚠️  ${err.message}`);
      continue;
    }

    antesTotal += original.length;

    // Nunca se empeora un archivo: si el "optimizado" pesa más (pasa con PNGs
    // ya bien comprimidos que no había que redimensionar), se deja el original.
    const mejora = resultado.buffer.length < original.length;
    const finalBuf = mejora ? resultado.buffer : original;
    despuesTotal += finalBuf.length;

    const marca = mejora ? (resultado.redimensionado ? '↓' : '·') : '=';
    console.log(
      `${path.basename(ruta).padEnd(20)} ${kb(original.length)} ${marca} ${kb(finalBuf.length)}   ${resultado.ancho}x${resultado.alto}`
    );

    if (escribir && mejora) fs.writeFileSync(ruta, finalBuf);
  }

  console.log('─'.repeat(70));
  const ahorro = antesTotal - despuesTotal;
  console.log(
    `TOTAL                ${kb(antesTotal)}   ${kb(despuesTotal)}   ` +
    `— ahorro ${kb(ahorro)} (${((ahorro / antesTotal) * 100).toFixed(1)} %)`
  );
  console.log(
    `\nEsos bytes van embebidos en CADA proforma generada.` +
    (escribir ? '' : '\nEjecutá con --write para aplicar.')
  );
}

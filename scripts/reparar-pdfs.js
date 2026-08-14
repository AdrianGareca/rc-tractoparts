#!/usr/bin/env node
// =============================================================================
// scripts/reparar-pdfs.js
// Vuelve a generar los PDF de cotización que quedaron mal maquetados.
//
// PARA QUÉ SIRVE
// El PDF de una cotización NO se arma cuando alguien lo descarga: se genera una
// vez —al crear, editar o cambiar de estado— se guarda en disco y su ruta queda
// en cotizaciones.pdf_ruta. La descarga sirve ese archivo tal cual.
//
// Por eso, cuando se corrige un error de maquetado en el generador, los PDF que
// ya estaban en disco NO cambian solos: siguen mostrando el defecto para siempre.
// Este script los vuelve a generar con el código actual.
//
// QUÉ NUNCA TOCA
// Algunas cotizaciones no tienen un PDF generado sino uno SUBIDO A MANO: la
// proforma con membrete que alguien armó aparte y cargó al sistema. Borrar uno
// de esos destruiría un documento que no se puede rehacer.
//
// Se distinguen por el nombre del archivo. Los subidos los nombra
// buildUploadFilename() y terminan en un sufijo hexadecimal aleatorio:
//
//     subido     COT-57-1754923011000-a3f9b2c1.pdf
//     generado   SC-2026_000706-1754923011000.pdf
//                                             ^^^ sin sufijo: lo hizo PDFKit
//
// Todo lo que tenga ese sufijo se saltea y se informa.
//
// CÓMO SE USA (dentro del contenedor, que es donde están la base y los archivos)
//
//     # 1. Ver qué haría, SIN tocar nada. Siempre empezá por acá.
//     docker compose exec app node scripts/reparar-pdfs.js --desde=2026-08-12
//
//     # 2. Aplicarlo de verdad
//     docker compose exec app node scripts/reparar-pdfs.js --desde=2026-08-12 --aplicar
//
//     # Una sola cotización, por su número o por su id
//     docker compose exec app node scripts/reparar-pdfs.js --correlativo=SC-2026/000706 --aplicar
//     docker compose exec app node scripts/reparar-pdfs.js --id=706 --aplicar
//
// SIN --aplicar NO ESCRIBE NADA. Es la opción por defecto a propósito.
// =============================================================================

'use strict';

require('dotenv').config();

const fs   = require('fs');
const path = require('path');

const { pool } = require('../src/config/db');
const QuotationModel = require('../src/models/QuotationModel');
const { regenerateQuotationPdf } = require('../src/controllers/quotation/pdfRegeneration');

// ---------------------------------------------------------------------------
// Un PDF SUBIDO A MANO termina en "-<13 dígitos>-<8 hexadecimales>.pdf".
// El sufijo aleatorio lo agrega buildUploadFilename() y el generador no lo pone.
// ---------------------------------------------------------------------------
const SUBIDO_A_MANO = /-\d{13}-[0-9a-f]{8}\.pdf$/i;

const esSubidoAMano = (ruta) => SUBIDO_A_MANO.test(String(ruta || ''));

// ---------------------------------------------------------------------------
function leerArgumentos(argv) {
  const args = { aplicar: false, desde: null, id: null, correlativo: null };

  for (const a of argv.slice(2)) {
    if (a === '--aplicar')            args.aplicar = true;
    else if (a.startsWith('--desde='))       args.desde = a.slice(8);
    else if (a.startsWith('--id='))          args.id = parseInt(a.slice(5), 10);
    else if (a.startsWith('--correlativo=')) args.correlativo = a.slice(14);
    else if (a === '--todos')                args.desde = '1900-01-01';
    else {
      console.error(`Opción desconocida: ${a}`);
      process.exit(2);
    }
  }

  if (!args.desde && !args.id && !args.correlativo) {
    console.error('Falta indicar qué reparar. Usá --desde=AAAA-MM-DD, --id=N, --correlativo=X o --todos.');
    console.error('Mirá la cabecera del archivo para los ejemplos.');
    process.exit(2);
  }

  return args;
}

// ---------------------------------------------------------------------------
async function buscarCotizaciones(args) {
  if (args.id) {
    const [filas] = await pool.execute(
      'SELECT id, numero_correlativo, pdf_ruta, estado FROM cotizaciones WHERE id = ?',
      [args.id]
    );
    return filas;
  }

  if (args.correlativo) {
    const [filas] = await pool.execute(
      'SELECT id, numero_correlativo, pdf_ruta, estado FROM cotizaciones WHERE numero_correlativo = ?',
      [args.correlativo]
    );
    return filas;
  }

  // Sólo las que TIENEN un PDF guardado: las que no lo tienen se generan solas
  // en cada descarga, así que ya salen bien con el código nuevo.
  const [filas] = await pool.execute(
    `SELECT id, numero_correlativo, pdf_ruta, estado
       FROM cotizaciones
      WHERE pdf_ruta IS NOT NULL
      ORDER BY id`
  );

  // El corte por fecha se hace sobre el ARCHIVO, no sobre creado_en.
  //
  // Esto NO es un detalle: el PDF se regenera al crear, al editar y al cambiar
  // de estado. Una cotización de hace tres semanas que alguien editó hoy tiene
  // un PDF escrito hoy —y por lo tanto con el defecto— pero su creado_en es de
  // hace tres semanas. Filtrar por creado_en la dejaba afuera.
  //
  // La fecha del archivo dice exactamente lo que importa: cuándo se dibujó ese
  // PDF, y por lo tanto con qué versión del código.
  const desde = new Date(`${args.desde}T00:00:00`);
  const conFecha = [];

  for (const fila of filas) {
    const abs = path.resolve(process.cwd(), fila.pdf_ruta);
    try {
      const stat = await fs.promises.stat(abs);
      if (stat.mtime >= desde) conFecha.push({ ...fila, escritoEn: stat.mtime });
    } catch {
      // El archivo ya no está en disco. La descarga cae al camino de generación
      // en vivo, así que sale bien sin hacer nada.
    }
  }

  return conFecha;
}

// ---------------------------------------------------------------------------
async function main() {
  const args = leerArgumentos(process.argv);

  console.log('');
  console.log(args.aplicar
    ? '=== REPARACIÓN DE PDF — MODO REAL, se van a reescribir archivos ==='
    : '=== REPARACIÓN DE PDF — SIMULACRO, no se toca nada ===');
  console.log('');

  const filas = await buscarCotizaciones(args);

  if (filas.length === 0) {
    console.log('No se encontró ninguna cotización con esos criterios.');
    return;
  }

  console.log(`Cotizaciones encontradas: ${filas.length}`);
  console.log('');

  let reparadas = 0, salteadas = 0, sinPdf = 0, fallidas = 0;

  for (const fila of filas) {
    const etiqueta = `${fila.numero_correlativo ?? '(sin número)'} (id ${fila.id}, ${fila.estado})`;

    if (!fila.pdf_ruta) {
      console.log(`  —  ${etiqueta}: no tiene PDF guardado; se genera solo al descargar.`);
      sinPdf += 1;
      continue;
    }

    if (esSubidoAMano(fila.pdf_ruta)) {
      console.log(`  ⨯  ${etiqueta}: PDF SUBIDO A MANO — no se toca.`);
      console.log(`     ${fila.pdf_ruta}`);
      salteadas += 1;
      continue;
    }

    if (!args.aplicar) {
      console.log(`  ✓  ${etiqueta}: se regeneraría.`);
      reparadas += 1;
      continue;
    }

    try {
      // Se relee completa: el generador necesita los detalles, el cliente y todo
      // lo que la consulta de arriba no trae.
      const completa = await QuotationModel.findById(fila.id);
      if (!completa) {
        console.log(`  !  ${etiqueta}: desapareció entre la consulta y la relectura.`);
        fallidas += 1;
        continue;
      }

      const nueva = await regenerateQuotationPdf(completa, {
        purge: true,
        label: 'reparar-pdfs',
      });

      if (nueva) {
        console.log(`  ✓  ${etiqueta}: regenerado.`);
        console.log(`     ${nueva}`);
        reparadas += 1;
      } else {
        console.log(`  !  ${etiqueta}: la regeneración falló (ver el aviso de arriba).`);
        fallidas += 1;
      }
    } catch (err) {
      console.log(`  !  ${etiqueta}: ${err.message}`);
      fallidas += 1;
    }
  }

  console.log('');
  console.log('─────────────────────────────────────────────');
  console.log(args.aplicar ? `Regenerados:        ${reparadas}` : `Se regenerarían:    ${reparadas}`);
  console.log(`Subidos a mano:     ${salteadas}  (intactos)`);
  console.log(`Sin PDF guardado:   ${sinPdf}`);
  if (fallidas > 0) console.log(`CON ERROR:          ${fallidas}`);
  console.log('─────────────────────────────────────────────');

  if (!args.aplicar && reparadas > 0) {
    console.log('');
    console.log('Esto fue un simulacro. Para aplicarlo, repetí el comando con --aplicar');
  }
}

main()
  .catch((err) => {
    console.error('');
    console.error('El script falló:', err.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end().catch(() => {});
  });

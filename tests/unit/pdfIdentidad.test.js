// =============================================================================
// tests/unit/pdfIdentidad.test.js
// Los tres documentos que salen del sistema tienen que leerse como papeles de
// la misma empresa.
//
// EL PROBLEMA QUE RESUELVE
// Cada generador de PDF se escribió por separado y cada uno resolvió lo mismo
// de forma distinta: la proforma con títulos en marino sobre blanco y filete
// naranja; el reporte con bandas marinas rellenas y texto blanco; el expediente
// con una banda a todo lo ancho y el logo sobre un chip. Puestos uno al lado
// del otro no parecían de la misma empresa — y el cliente los recibe juntos.
//
// Este test no juzga si se ven lindos: verifica que compartan las decisiones
// concretas que los hacen familia. Es análisis estático del fuente, porque el
// contenido del PDF va comprimido y no se puede inspeccionar sin descomprimir.
// =============================================================================

'use strict';

const fs   = require('fs');
const path = require('path');

const SERVICIOS = path.resolve(__dirname, '../../src/services');

// La proforma no lleva los hex escritos en sus dibujantes: los importa de
// pdf/constants.js, que es donde vive la paleta. Ese archivo es la referencia.
const GENERADORES = [
  ['proforma (referencia)', path.join(SERVICIOS, 'pdf', 'constants.js')],
  ['reporte',               path.join(SERVICIOS, 'reportePdfService.js')],
  ['expediente',            path.join(SERVICIOS, 'licitacionPdfService.js')],
];

const leer = (p) => fs.readFileSync(p, 'utf8');

// ---------------------------------------------------------------------------
describe('la paleta es la misma en los tres', () => {
  test.each(GENERADORES)('%s usa el marino y el naranja de la proforma', (_n, file) => {
    const src = leer(file);
    // Los dos colores que definen la identidad impresa de RC Tractoparts.
    expect(src).toMatch(/#1B2B4B/i);   // marino
    expect(src).toMatch(/#C85A0F/i);   // naranja
  });
});

// ---------------------------------------------------------------------------
// El filete naranja bajo el título de sección es LA marca del documento
// impreso — infoGrid.js lo llama "physical proforma aesthetic". Un título con
// banda rellena en su lugar es lenguaje de tablero web.
// ---------------------------------------------------------------------------
describe('los títulos de sección llevan el filete naranja', () => {
  test.each([
    ['reporte',    path.join(SERVICIOS, 'reportePdfService.js')],
    ['expediente', path.join(SERVICIOS, 'licitacionPdfService.js')],
  ])('%s', (_n, file) => {
    const src = leer(file);

    // La firma del patrón: un stroke naranja inmediatamente después de dibujar
    // el texto del título.
    expect(src).toMatch(/strokeColor\(C\.ORANGE\)/);
  });

  test('ninguno vuelve a la banda marina rellena para los títulos', () => {
    for (const [nombre, file] of [
      ['reporte',    path.join(SERVICIOS, 'reportePdfService.js')],
      ['expediente', path.join(SERVICIOS, 'licitacionPdfService.js')],
    ]) {
      const src = leer(file);
      const fn = /function sectionTitle[\s\S]*?\n\}/.exec(src)?.[0] ?? '';

      if (/\.fill\(C\.NAVY\)/.test(fn)) {
        throw new Error(
          `${nombre}: sectionTitle volvió a pintar una banda marina rellena. ` +
          'La proforma resuelve sus títulos con texto marino sobre blanco y un ' +
          'filete naranja debajo; una banda rellena se lee como tablero web y ' +
          'rompe la familia con el documento que recibe el cliente.'
        );
      }
    }
  });
});

// ---------------------------------------------------------------------------
describe('la franja de marcas se comparte, no se copia', () => {
  test.each([
    ['reporte',    path.join(SERVICIOS, 'reportePdfService.js')],
    ['expediente', path.join(SERVICIOS, 'licitacionPdfService.js')],
  ])('%s importa el dibujante compartido', (_n, file) => {
    const src = leer(file);

    expect(src).toMatch(/require\(['"]\.\/pdf\/drawers\/brandStrip['"]\)/);
    expect(src).toMatch(/\bdrawBrandStrip\s*\(/);
  });

  // Si cada documento tuviera su propia copia, agregar una marca obligaría a
  // acordarse de los tres — y siempre se olvida uno.
  test('ninguno redibuja la franja por su cuenta', () => {
    for (const [nombre, file] of [
      ['reporte',    path.join(SERVICIOS, 'reportePdfService.js')],
      ['expediente', path.join(SERVICIOS, 'licitacionPdfService.js')],
    ]) {
      const src = leer(file);
      if (/BRAND_DEFS|brands\//.test(src)) {
        throw new Error(
          `${nombre} referencia los logos de marca directamente en vez de usar ` +
          'drawBrandStrip. Si cada documento tiene su copia, agregar una marca ' +
          'obliga a acordarse de los tres.'
        );
      }
    }
  });
});

// ---------------------------------------------------------------------------
describe('los tres generan un PDF válido', () => {
  test('el reporte', async () => {
    const svc = require('../../src/services/reportePdfService');
    const pdf = await svc.generateReportePdf({
      mode: 'individual', periodo: '01/07/2026 al 31/07/2026',
      rol: 'Ejecutivo', nombreUsuario: 'Ana Pérez',
      topClientes: [], leaderboard: [], metricas: null,
    });
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
  }, 30000);

  test('el expediente de licitación', async () => {
    const svc = require('../../src/services/licitacionPdfService');
    const lic = {
      id: 1, codigo: 'LIC-2026-014', nombre: 'Repuestos flota municipal',
      estado: 'Cotizando', moneda: 'BOB', cliente_nombre: 'GAM Santa Cruz',
      responsable_nombre: 'Ana Pérez', fecha_limite: '2026-08-30',
      cotizaciones: [], gastos: [], documentos: [], historial: [],
    };

    const doc = svc.createDoc(lic);
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    const fin = new Promise((r) => doc.on('end', r));
    svc.renderExpediente(doc, lic);
    doc.end();
    await fin;

    expect(Buffer.concat(chunks).subarray(0, 5).toString()).toBe('%PDF-');
  }, 30000);
});

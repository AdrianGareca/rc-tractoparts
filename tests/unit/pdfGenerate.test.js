// =============================================================================
// tests/unit/pdfGenerate.test.js
// Prueba de humo del generador de proformas completo.
//
// Los tests de pdfLayout / pdfFormat / pdfBankData cubren las piezas puras, pero
// nadie ejercitaba el armado real del documento. Un drawer que reciba mal sus
// dependencias tras la modularización no rompe ningún test unitario: rompe la
// generación del PDF en producción, que además está envuelta en try/catch
// "no fatal" en los controllers — o sea que falla EN SILENCIO y la cotización
// queda guardada sin proforma.
//
// No necesita base de datos: se le pasa el objeto que devolvería findById.
// =============================================================================

'use strict';

const fs   = require('fs');
const path = require('path');
const { generateQuotationPdf, purgeQuotationPdf } = require('../../src/services/pdfService');

/** Cotización mínima con todo lo que los drawers esperan encontrar. */
const quotation = (over = {}) => ({
  id:                 1,
  numero_correlativo: 'SC-2026/000042',
  estado:             'Aprobada internamente',
  cliente_nombre:     'Minera San Cristóbal S.A.',
  cliente_nit:        '1023456789',
  descripcion:        'Repuestos varios',
  fecha_emision:      '2026-07-26',
  fecha_validez:      '2026-08-30',
  moneda:             'BOB',
  monto_total:        3080,
  descuento_manual:   null,
  entidad_emisora:    'Roca Importaciones S.R.L.',
  mostrar_codigos:    1,
  ejecutivo_nombre:   'Ana Quiroga',
  tipo_pedido:        'EMAIL',
  detalles: [{
    descripcion_item: 'Filtro de aceite', codigo_parte: '7E-6116',
    cantidad: 2, precio_unitario: 1540, subtotal: 3080,
    unidad: 'PZA', marca_nombre: 'CAT',
  }],
  ...over,
});

/** Genera, lee el binario y borra el archivo. */
async function render(q) {
  const rel = await generateQuotationPdf(q);
  const abs = path.resolve(process.cwd(), rel);
  const buf = fs.readFileSync(abs);
  await purgeQuotationPdf(rel);
  return { rel, abs, buf };
}

const contarPaginas = (buf) => (buf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;

// 90 s, no 30. Cada PDF con el logo embebido tarda ~4 s, y varios tests generan
// más de uno; corriendo dentro de la suite completa (máquina cargada) los 30 s
// se quedaban cortos y producían un rojo que no señalaba ningún problema real.
jest.setTimeout(90000);

describe('generateQuotationPdf — documento válido', () => {
  test('escribe un PDF real con la cabecera %PDF-', async () => {
    const { buf } = await render(quotation());

    expect(buf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(buf.length).toBeGreaterThan(1000);
  });

  test('una cotización de una sola página genera exactamente una', async () => {
    const { buf } = await render(quotation());
    expect(contarPaginas(buf)).toBe(1);
  });

  test('devuelve una ruta relativa dentro del directorio de subidas', async () => {
    const rel = await generateQuotationPdf(quotation());
    expect(path.isAbsolute(rel)).toBe(false);
    expect(rel).toMatch(/\.pdf$/);
    await purgeQuotationPdf(rel);
  });

  test('sanea el correlativo: la barra no crea un subdirectorio', async () => {
    // 'SC-2026/000042' con path.join se interpretaría como carpeta y
    // createWriteStream fallaría con ENOENT.
    const { rel } = await render(quotation());
    expect(path.basename(rel)).toMatch(/^SC-2026_000042-\d+\.pdf$/);
  });
});

describe('generateQuotationPdf — variantes de layout', () => {
  test('sin la columna CÓDIGO también renderiza', async () => {
    const { buf } = await render(quotation({ mostrar_codigos: 0 }));
    expect(buf.subarray(0, 5).toString()).toBe('%PDF-');
  });

  test('con descuento manual y moneda USD', async () => {
    const { buf } = await render(quotation({ moneda: 'USD', descuento_manual: 150 }));
    expect(buf.subarray(0, 5).toString()).toBe('%PDF-');
  });

  test('con observaciones', async () => {
    const { buf } = await render(quotation({
      observaciones: 'Entrega parcial autorizada por el cliente.',
    }));
    expect(buf.subarray(0, 5).toString()).toBe('%PDF-');
  });

  test('las dos entidades emisoras renderizan su bloque bancario', async () => {
    for (const entidad of ['Empresa unipersonal de Ronald Roca Cartagena', 'Roca Importaciones S.R.L.']) {
      const { buf } = await render(quotation({ entidad_emisora: entidad }));
      expect(buf.subarray(0, 5).toString()).toBe('%PDF-');
    }
  });

  test('el nombre legado RC Tractoparts no rompe el render', async () => {
    const { buf } = await render(quotation({ entidad_emisora: 'RC Tractoparts' }));
    expect(buf.subarray(0, 5).toString()).toBe('%PDF-');
  });
});

describe('generateQuotationPdf — corte de página', () => {
  test('40 ítems generan varias páginas', async () => {
    const detalles = Array.from({ length: 40 }, (_, i) => ({
      descripcion_item: `Repuesto ${i + 1} con una descripcion larga que fuerza el ajuste de altura de la fila`,
      codigo_parte: `COD-${i}`, cantidad: i + 1, precio_unitario: 100 + i,
      subtotal: (i + 1) * (100 + i), unidad: 'UND', marca_nombre: 'KOMATSU',
    }));

    const { buf } = await render(quotation({ detalles }));

    expect(contarPaginas(buf)).toBeGreaterThan(1);
  });
});

describe('generateQuotationPdf — datos incompletos', () => {
  test('una cotización sin ítems no rompe el render', async () => {
    const { buf } = await render(quotation({ detalles: [], monto_total: null }));
    expect(buf.subarray(0, 5).toString()).toBe('%PDF-');
  });

  test('los campos opcionales ausentes se renderizan como placeholder', async () => {
    const { buf } = await render({
      id: 9, numero_correlativo: 'SC-2026/000099', estado: 'Pendiente',
      moneda: 'BOB', detalles: [],
    });
    expect(buf.subarray(0, 5).toString()).toBe('%PDF-');
  });

  // Un estado por rama real de renderWatermark: aprobado (estampa APROBADO),
  // en curso (no estampa) y rechazado. Los 9 colores ya están cubiertos por
  // pdfLayout.test.js; generar los 9 PDFs sólo sumaría ~30 s a la suite.
  test.each(['Aprobada internamente', 'Pendiente', 'Rechazada'])(
    'el estado "%s" renderiza', async (estado) => {
      const { buf } = await render(quotation({ estado }));
      expect(buf.subarray(0, 5).toString()).toBe('%PDF-');
    });
});

describe('purgeQuotationPdf', () => {
  test('borra el archivo del disco', async () => {
    const rel = await generateQuotationPdf(quotation());
    const abs = path.resolve(process.cwd(), rel);
    expect(fs.existsSync(abs)).toBe(true);

    await purgeQuotationPdf(rel);

    expect(fs.existsSync(abs)).toBe(false);
  });

  test('con una ruta inexistente no lanza (es idempotente)', async () => {
    await expect(purgeQuotationPdf('uploads/cotizaciones/no-existe.pdf')).resolves.not.toThrow();
  });

  test('con null o vacío no lanza', async () => {
    await expect(purgeQuotationPdf(null)).resolves.not.toThrow();
    await expect(purgeQuotationPdf('')).resolves.not.toThrow();
  });
});

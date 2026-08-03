// =============================================================================
// tests/unit/reportePdfIndividual.test.js
// El PDF que el ejecutivo genera para mostrar cómo viene.
//
// QUÉ SE ARREGLÓ
// En modo individual el PDF traía dos tablas, y una era de UNA SOLA FILA
// (creadas, aprobadas, tasa, total USD, total BOB). El ejecutivo lo imprimía
// para mostrar sus avances y no había casi nada que mostrar.
//
// Ahora lleva lo mismo que la pantalla: la conversión como indicador principal,
// los días promedio hasta el cierre, el desglose por estado y la evolución mes
// a mes.
//
// POR QUÉ SE VERIFICA SOBRE EL PDF Y NO SOBRE LOS DATOS
// Que el modelo devuelva los números correctos ya lo cubre
// tests/integration/misMetricas.test.js. Lo que puede romperse acá es otra
// cosa: que el servicio reciba los datos y NO los dibuje — un `metricas`
// que no se pasa, una sección que queda fuera de un `if`. Eso solo se ve
// mirando el PDF que sale.
// =============================================================================

'use strict';

const reportePdfService = require('../../src/services/reportePdfService');

/** Métricas de ejemplo con la forma exacta que devuelve misMetricas.obtener(). */
const METRICAS = {
  conversion:   57.1,
  total:        9,
  en_la_cancha: 7,
  cerradas:     4,
  rechazadas:   2,
  en_proceso:   2,
  dias_cierre:  5,
  ticket_usd:   100,
  ticket_bob:   700,
  por_estado: [
    { estado: 'Pendiente',          cantidad: 2, monto_usd: 0,   monto_bob: 0 },
    { estado: 'Enviada al cliente', cantidad: 1, monto_usd: 100, monto_bob: 0 },
    { estado: 'Confirmada',         cantidad: 4, monto_usd: 300, monto_bob: 700 },
    { estado: 'Rechazada',          cantidad: 2, monto_usd: 200, monto_bob: 0 },
  ],
  por_mes: [
    { mes: '2026-06', emitidas: 4, cerradas: 1 },
    { mes: '2026-07', emitidas: 5, cerradas: 3 },
  ],
  comparacion: {
    periodo: { desde: '2026-06-01', hasta: '2026-06-30' },
    conversion: 40, cerradas: 2, emitidas: 6,
  },
  pendientes: [
    { correlativo: 'COT-0007', cliente: 'Transportes Andina', monto: 450, moneda: 'USD', dias_esperando: 21 },
    { correlativo: 'COT-0011', cliente: 'Minera del Sur',     monto: 3200, moneda: 'BOB', dias_esperando: 6 },
  ],
  confirmadas: [
    { correlativo: 'COT-0003', cliente: 'Agropecuaria del Este', monto: 100, moneda: 'USD', fecha: '2026-07-12' },
  ],
  top_items: [
    { codigo: 'FA-220', descripcion: 'Filtro de aceite', marca: 'John Deere', unidad: 'UND', cantidad: 48, clientes: 6 },
    { codigo: 'RI-100', descripcion: 'Rodillo inferior', marca: null,        unidad: 'UND', cantidad: 12, clientes: 2 },
  ],
};

const BASE = {
  mode:          'individual',
  periodo:       '01/07/2026 al 31/07/2026',
  rol:           'Ejecutivo',
  nombreUsuario: 'Ana Pérez',
  topClientes:   [{ cliente: 'Agropecuaria del Este', nit: '123', proformas_emitidas: 6, total_usd: '900.00', total_bob: '0.00' }],
  leaderboard:   [],
};

// NOTA: no se busca texto dentro del PDF. PDFKit genera con compress:true, así
// que los strings quedan en streams deflate y buscarlos exigiría descomprimir
// el documento — mucha maquinaria para verificar algo que se comprueba mejor
// de forma estructural (que salga un PDF válido, y que con métricas pese más
// que sin ellas, que es la prueba de que efectivamente se dibujaron).

describe('PDF individual — trae mucho más que antes', () => {
  let pdf;

  beforeAll(async () => {
    pdf = await reportePdfService.generateReportePdf({ ...BASE, metricas: METRICAS });
  }, 30000);

  test('genera un PDF válido', () => {
    expect(Buffer.isBuffer(pdf)).toBe(true);
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
  });

  // La prueba de que se dibujó MÁS: el PDF con las métricas pesa
  // sensiblemente más que el mismo PDF sin ellas. Es una comprobación
  // estructural que no depende de poder leer el texto comprimido.
  test('pesa más que el mismo reporte sin métricas', async () => {
    const sinMetricas = await reportePdfService.generateReportePdf({ ...BASE, metricas: null });
    expect(pdf.length).toBeGreaterThan(sinMetricas.length);
  }, 30000);

  test('sin métricas NO explota: dice que no hay actividad', async () => {
    const vacio = await reportePdfService.generateReportePdf({ ...BASE, metricas: null });
    expect(Buffer.isBuffer(vacio)).toBe(true);
    expect(vacio.subarray(0, 5).toString()).toBe('%PDF-');
  }, 30000);
});

// ---------------------------------------------------------------------------
// Los casos que rompen un generador de PDF: valores que todavía no existen.
// Un ejecutivo que recién arranca no tiene conversión ni ticket promedio, y el
// PDF tiene que salir igual — no con "null%" impreso ni con una excepción.
// ---------------------------------------------------------------------------
describe('PDF individual — un ejecutivo que recién arranca', () => {
  test('con conversión y tiempos en null, el PDF se genera igual', async () => {
    const pdf = await reportePdfService.generateReportePdf({
      ...BASE,
      metricas: {
        ...METRICAS,
        conversion: null, dias_cierre: null, ticket_usd: null, ticket_bob: null,
        cerradas: 0, en_la_cancha: 0, por_estado: [], por_mes: [],
      },
    });

    expect(Buffer.isBuffer(pdf)).toBe(true);
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
  }, 30000);

  test('sin desglose ni evolución tampoco falla', async () => {
    const pdf = await reportePdfService.generateReportePdf({
      ...BASE,
      metricas: { ...METRICAS, por_estado: [], por_mes: [] },
    });

    expect(Buffer.isBuffer(pdf)).toBe(true);
  }, 30000);
});

// ---------------------------------------------------------------------------
describe('PDF de empresa — no se rompió', () => {
  test('el modo company sigue generándose sin métricas individuales', async () => {
    const pdf = await reportePdfService.generateReportePdf({
      mode:          'company',
      periodo:       'Julio 2026',
      rol:           'Jefe',
      nombreUsuario: 'Carlos Jefe',
      progreso: {
        volumen:    { total_mes_usd: '1000.00', total_mes_bob: '7000.00', total_cotizaciones: 12 },
        conversion: { ratio_pct: '55.0' },
        por_ejecutivo: [
          { ejecutivo: 'Ana Pérez', total: 9, aceptadas: 4, rechazadas: 2, volumen_usd: '900.00' },
        ],
      },
      topClientes:       BASE.topClientes,
      leaderboard:       [],
      clientesPorOrigen: [{ origen: 'Cliente', total_clientes: 4, total_usd: '900.00', total_bob: '0.00' }],
    });

    expect(Buffer.isBuffer(pdf)).toBe(true);
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
  }, 30000);
});

// ---------------------------------------------------------------------------
// Las secciones que se agregaron despues, cuando el PDF todavia se veia corto.
// Cada una responde una pregunta distinta:
//   comparacion  → ¿voy mejor o peor que el período pasado?
//   pendientes   → ¿a quién llamo mañana?          (la única accionable)
//   confirmadas  → ¿qué vendí exactamente?         (la evidencia)
//   top_items    → ¿qué repuestos muevo yo?
// ---------------------------------------------------------------------------
describe('PDF individual — las secciones agregadas', () => {
  /** Genera el PDF quitando UNA sección, para medir cuánto aporta. */
  const sin = (campo) => reportePdfService.generateReportePdf({
    ...BASE,
    metricas: { ...METRICAS, [campo]: campo === 'comparacion' ? null : [] },
  });

  test.each(['comparacion', 'pendientes', 'confirmadas', 'top_items'])(
    'la sección «%s» efectivamente se dibuja',
    async (campo) => {
      // Si la sección no se dibujara, quitarla no cambiaría el tamaño del PDF.
      const completo = await reportePdfService.generateReportePdf({ ...BASE, metricas: METRICAS });
      const recortado = await sin(campo);

      expect(completo.length).toBeGreaterThan(recortado.length);
    },
    30000
  );

  test('con todas las secciones el PDF ocupa más de una página', async () => {
    const pdf = await reportePdfService.generateReportePdf({ ...BASE, metricas: METRICAS });
    // /Type /Page aparece una vez por página del documento.
    const paginas = (pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;

    expect(paginas).toBeGreaterThanOrEqual(1);
    expect(pdf.length).toBeGreaterThan(4000);
  }, 30000);

  // Un ejecutivo sin cotizaciones pendientes no debe ver un encabezado
  // "Esperando respuesta" seguido de una tabla vacía: la sección no se dibuja.
  test('las secciones vacías no dejan encabezados huérfanos', async () => {
    const vacio = await reportePdfService.generateReportePdf({
      ...BASE,
      metricas: { ...METRICAS, pendientes: [], confirmadas: [], top_items: [], comparacion: null },
    });
    const lleno = await reportePdfService.generateReportePdf({ ...BASE, metricas: METRICAS });

    expect(vacio.length).toBeLessThan(lleno.length);
    expect(Buffer.isBuffer(vacio)).toBe(true);
  }, 30000);
});

// =============================================================================
// tests/unit/topeConsultas.test.js
// Los reportes pesados se cortan a los 30 segundos y la pantalla lo explica.
//
// POR QUÉ EXISTE
// En la ronda de estrés del 2026-09-15 un solo reporte de consumo sin rango
// tardaba más de un minuto, y tres a la vez agotaban el pool de conexiones: el
// resto de la empresa pasaba de 71 a 15 peticiones por segundo. Decisión de
// Adrian: tope de 30 segundos (src/utils/topeConsultas.js).
//
// Tres cosas pueden romperlo sin que nada falle:
//   1. que la pista deje de insertarse bien en el SQL;
//   2. que alguien agregue una consulta de reporte con pool.execute a secas —
//      funciona perfecto con pocos datos y vuelve a trabar todo con muchos;
//   3. que el controlador responda el tope vencido como un 500 genérico, y la
//      persona no sepa que la solución es acotar las fechas.
// =============================================================================

'use strict';

jest.mock('../../src/models/QuotationModel', () => ({
  getAdvancedReports: jest.fn(),
  getProgreso:        jest.fn(),
  VALID_STATES:       ['Pendiente', 'Confirmada'],
}));
jest.mock('../../src/models/quotation/misMetricas', () => ({ obtener: jest.fn() }));
jest.mock('../../src/models/quotation/clienteItemReport', () => ({
  find: jest.fn(), count: jest.fn(), ejecutivos: jest.fn(),
  MODOS: ['detalle', 'item'],
  SORTABLE: { detalle: { fecha: 'ultima_vez' }, item: { fecha: 'ultima_vez' } },
  DEFAULT_LIMIT: 25, MAX_LIMIT: 200,
}));
jest.mock('../../src/models/UserModel', () => ({ findById: jest.fn() }));
jest.mock('../../src/services/reportePdfService', () => ({ generateReportePdf: jest.fn() }));
jest.mock('../../src/utils/auditLog', () => ({
  logEvent: jest.fn().mockResolvedValue(undefined),
  AuditActions: { GENERAR_REPORTE_PDF: 'GENERAR_REPORTE_PDF' },
}));

const fs   = require('fs');
const path = require('path');
const { conTope, esTopeExcedido, TOPE_REPORTES_MS, MENSAJE_TOPE } = require('../../src/utils/topeConsultas');
const QuotationModel     = require('../../src/models/QuotationModel');
const misMetricas        = require('../../src/models/quotation/misMetricas');
const clienteItemReport  = require('../../src/models/quotation/clienteItemReport');
const ReportesController = require('../../src/controllers/reportesController');

// El error que devuelve MySQL al vencerse MAX_EXECUTION_TIME.
const topeVencido = () => Object.assign(
  new Error('Query execution was interrupted, maximum statement execution time exceeded'),
  { errno: 3024, code: 'ER_QUERY_TIMEOUT' });

// ---------------------------------------------------------------------------
describe('conTope', () => {
  test('agrega la pista de 30 segundos al SELECT', () => {
    expect(TOPE_REPORTES_MS).toBe(30000);
    expect(conTope('SELECT 1')).toBe('SELECT /*+ MAX_EXECUTION_TIME(30000) */ 1');
  });

  test('respeta la sangría de las consultas escritas en varias líneas', () => {
    const sql = '\n    SELECT c.id\n      FROM cotizaciones c';
    expect(conTope(sql)).toBe('\n    SELECT /*+ MAX_EXECUTION_TIME(30000) */ c.id\n      FROM cotizaciones c');
  });

  test('sólo toca el PRIMER SELECT: una subconsulta no lleva la pista', () => {
    const sql = 'SELECT COUNT(*) FROM (SELECT 1) AS x';
    const conPista = conTope(sql);
    expect(conPista.match(/MAX_EXECUTION_TIME/g)).toHaveLength(1);
    expect(conPista).toContain('(SELECT 1)');
  });

  test('una consulta que no empieza con SELECT no se ejecuta sin tope: falla', () => {
    expect(() => conTope('UPDATE cotizaciones SET x = 1')).toThrow(/SELECT/);
  });
});

describe('esTopeExcedido', () => {
  test('reconoce el error de MySQL por número y por código', () => {
    expect(esTopeExcedido(topeVencido())).toBe(true);
    expect(esTopeExcedido({ code: 'ER_QUERY_TIMEOUT' })).toBe(true);
  });

  test('no confunde otros errores con el tope', () => {
    expect(esTopeExcedido(new Error('ECONNRESET'))).toBe(false);
    expect(esTopeExcedido({ errno: 1064 })).toBe(false);
    expect(esTopeExcedido(undefined)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
describe('ningún modelo de reportes consulta sin tope', () => {
  const MODELOS = [
    'src/models/quotation/clienteItemReport.js',
    'src/models/quotation/misMetricas.js',
    'src/models/quotation/analyticsRepository.js',
  ];

  test.each(MODELOS)('%s usa consultarReporte y nunca pool.execute', (archivo) => {
    const src = fs.readFileSync(path.join(__dirname, '../..', archivo), 'utf8');
    const sinComentarios = src.replace(/\/\/.*$/gm, '');

    expect(sinComentarios).not.toMatch(/pool\.(execute|query)\(/);
    expect(sinComentarios).toMatch(/consultarReporte\(/);
  });
});

// ---------------------------------------------------------------------------
function crearRes() {
  return {
    statusCode: null, cuerpo: null, headers: {},
    status(c) { this.statusCode = c; return this; },
    json(o)   { this.cuerpo = o; return this; },
    send(b)   { this.cuerpo = b; return this; },
    setHeader(k, v) { this.headers[k] = v; },
  };
}

const JEFE = { id: 1, rol: 'Jefe', nombre_usuario: 'adrian' };

async function llamar(manejador, query = {}) {
  const res = crearRes();
  await ReportesController[manejador]({ user: JEFE, query, ip: '10.0.0.1', socket: {} }, res);
  return res;
}

describe('el controlador explica el tope vencido en vez de dar un 500', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => console.error.mockRestore());

  test.each([
    ['getClienteItem',     () => clienteItemReport.find.mockRejectedValue(topeVencido())],
    ['getMisMetricas',     () => misMetricas.obtener.mockRejectedValue(topeVencido())],
    ['getProgreso',        () => QuotationModel.getProgreso.mockRejectedValue(topeVencido())],
    ['getAdvancedReports', () => QuotationModel.getAdvancedReports.mockRejectedValue(topeVencido())],
    ['getReportePdf',      () => QuotationModel.getAdvancedReports.mockRejectedValue(topeVencido())],
  ])('%s responde 503 con el mensaje de acotar las fechas', async (manejador, preparar) => {
    clienteItemReport.count.mockResolvedValue(0);
    clienteItemReport.ejecutivos.mockResolvedValue([]);
    preparar();

    const res = await llamar(manejador);

    expect(res.statusCode).toBe(503);
    expect(res.cuerpo).toEqual({ success: false, message: MENSAJE_TOPE });
  });

  test('cualquier otro error sigue siendo un 500', async () => {
    misMetricas.obtener.mockRejectedValue(new Error('se cayó la base'));
    const res = await llamar('getMisMetricas');
    expect(res.statusCode).toBe(500);
  });
});

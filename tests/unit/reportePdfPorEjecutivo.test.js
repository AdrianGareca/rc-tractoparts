// =============================================================================
// tests/unit/reportePdfPorEjecutivo.test.js
// El PDF de reportes respeta el ejecutivo elegido en la pantalla.
//
// EL BUG (encontrado el 2026-09-14, mostrándole los reportes al Jefe)
// En la pantalla de Reportes se elige un ejecutivo y los números se filtran
// bien. Pero al apretar «PDF» salía SIEMPRE el reporte de toda la empresa:
// getReportePdf decidía el alcance con `isManager ? null : req.user.id` y no
// miraba el filtro. El Jefe creía estar imprimiendo el reporte de una persona
// y estaba imprimiendo el de todos, con los datos de los demás adentro.
//
// POR QUÉ NO LO ATAJÓ EL GUARDIA QUE YA EXISTÍA
// tests/unit/reportesAlcance.test.js vigila lo contrario: que nadie lea
// `req.query.id_ejecutivo` por su cuenta y se salte el helper de permisos. Un
// manejador que IGNORA el filtro no lee nada, así que pasaba limpio. Ese
// guardia protege de una fuga; éste protege de un documento que miente.
// =============================================================================

'use strict';

jest.mock('../../src/models/QuotationModel', () => ({
  getAdvancedReports: jest.fn(),
  getProgreso:        jest.fn(),
}));
jest.mock('../../src/models/quotation/misMetricas', () => ({ obtener: jest.fn() }));
jest.mock('../../src/models/quotation/clienteItemReport', () => ({}));
jest.mock('../../src/models/UserModel', () => ({ findById: jest.fn() }));
jest.mock('../../src/services/reportePdfService', () => ({ generateReportePdf: jest.fn() }));
jest.mock('../../src/utils/auditLog', () => ({
  logEvent:     jest.fn().mockResolvedValue(undefined),
  AuditActions: { GENERAR_REPORTE_PDF: 'GENERAR_REPORTE_PDF' },
}));

const QuotationModel     = require('../../src/models/QuotationModel');
const misMetricas        = require('../../src/models/quotation/misMetricas');
const UserModel          = require('../../src/models/UserModel');
const reportePdfService  = require('../../src/services/reportePdfService');
const { logEvent }       = require('../../src/utils/auditLog');
const ReportesController = require('../../src/controllers/reportesController');

const AVANZADO = { top_clientes: [], leaderboard: [], clientes_por_origen: [] };
const RANGO    = { fecha_desde: '2026-09-01', fecha_hasta: '2026-09-30' };

const JEFE      = { id: 1, rol: 'Jefe',      nombre_usuario: 'adrian' };
const EJECUTIVO = { id: 5, rol: 'Ejecutivo', nombre_usuario: 'hilda' };
const ANDRES    = { id: 7, nombre_completo: 'Andrés Pérez', nombre_usuario: 'andres' };

function crearRes() {
  return {
    statusCode: null,
    headers:    {},
    cuerpo:     null,
    status(c) { this.statusCode = c; return this; },
    json(o)   { this.cuerpo = o; return this; },
    send(b)   { this.cuerpo = b; return this; },
    setHeader(k, v) { this.headers[k] = v; },
  };
}

/** Llama al manejador como lo haría Express y devuelve la respuesta. */
async function pedirPdf(user, query = {}) {
  const req = { user, query, ip: '10.0.0.1', socket: {} };
  const res = crearRes();
  await ReportesController.getReportePdf(req, res);
  return res;
}

/** Lo que recibió el generador de PDF en la última llamada. */
const datosDelPdf = () => reportePdfService.generateReportePdf.mock.calls.at(-1)[0];

beforeEach(() => {
  jest.clearAllMocks();
  QuotationModel.getAdvancedReports.mockResolvedValue(AVANZADO);
  QuotationModel.getProgreso.mockResolvedValue({ total: 0 });
  misMetricas.obtener.mockResolvedValue({ conversion: 0, por_estado: [], por_mes: [] });
  UserModel.findById.mockResolvedValue(ANDRES);
  reportePdfService.generateReportePdf.mockResolvedValue(Buffer.from('%PDF-falso'));
});

describe('el Jefe elige UN ejecutivo y pide el PDF', () => {
  test('los datos se piden SOLO de ese ejecutivo', async () => {
    await pedirPdf(JEFE, { ...RANGO, id_ejecutivo: '7' });

    expect(QuotationModel.getAdvancedReports).toHaveBeenCalledWith(7, '2026-09-01', '2026-09-30');
  });

  test('no se mezclan los totales de la empresa', async () => {
    await pedirPdf(JEFE, { ...RANGO, id_ejecutivo: '7' });

    // El cuadro de estadísticas generales y el corte por origen son de empresa:
    // en el reporte de una persona no tienen por qué estar.
    expect(QuotationModel.getProgreso).not.toHaveBeenCalled();
    expect(datosDelPdf().mode).toBe('individual');
    expect(datosDelPdf().progreso).toBeNull();
  });

  test('el PDF lleva las métricas de ESE ejecutivo, no las de quien lo genera', async () => {
    await pedirPdf(JEFE, { ...RANGO, id_ejecutivo: '7' });

    expect(misMetricas.obtener).toHaveBeenCalledWith(
      expect.objectContaining({ idEjecutivo: 7 })
    );
    expect(datosDelPdf().metricas).not.toBeNull();
  });

  test('el documento dice de quién es', async () => {
    // Sin esto, el Jefe se queda con un «REPORTE INDIVIDUAL» que en el
    // encabezado sólo lleva SU nombre (el de quien lo generó): tres PDF de
    // tres ejecutivos distintos se ven iguales y no hay forma de saber cuál
    // es cuál.
    const res = await pedirPdf(JEFE, { ...RANGO, id_ejecutivo: '7' });

    expect(datosDelPdf().ejecutivoNombre).toBe('Andrés Pérez');
    expect(res.headers['Content-Disposition']).toContain('Andres_Perez');
  });

  test('queda en la bitácora de quién era el reporte', async () => {
    await pedirPdf(JEFE, { ...RANGO, id_ejecutivo: '7' });

    expect(logEvent).toHaveBeenCalledWith(
      expect.objectContaining({ detalle: expect.objectContaining({ id_ejecutivo: 7 }) })
    );
  });

  test('un ejecutivo que no existe se rechaza, en vez de dar un PDF vacío', async () => {
    UserModel.findById.mockResolvedValue(null);

    const res = await pedirPdf(JEFE, { ...RANGO, id_ejecutivo: '999' });

    expect(res.statusCode).toBe(404);
    expect(reportePdfService.generateReportePdf).not.toHaveBeenCalled();
  });

  test('un id_ejecutivo inválido se rechaza con 422', async () => {
    const res = await pedirPdf(JEFE, { ...RANGO, id_ejecutivo: 'abc' });

    expect(res.statusCode).toBe(422);
    expect(reportePdfService.generateReportePdf).not.toHaveBeenCalled();
  });
});

describe('el Jefe sin elegir a nadie', () => {
  test('sigue saliendo el reporte de toda la empresa', async () => {
    await pedirPdf(JEFE, RANGO);

    expect(QuotationModel.getAdvancedReports).toHaveBeenCalledWith(null, '2026-09-01', '2026-09-30');
    expect(QuotationModel.getProgreso).toHaveBeenCalled();
    expect(datosDelPdf().mode).toBe('company');
    expect(datosDelPdf().ejecutivoNombre).toBeFalsy();
  });

  test('el nombre del archivo lo distingue del individual', async () => {
    const res = await pedirPdf(JEFE, RANGO);

    expect(res.headers['Content-Disposition']).toContain('Reporte_General');
  });
});

describe('un ejecutivo sigue viendo SOLO lo suyo', () => {
  test('pedir el id de un compañero no cambia nada: recibe el propio', async () => {
    await pedirPdf(EJECUTIVO, { ...RANGO, id_ejecutivo: '7' });

    expect(QuotationModel.getAdvancedReports).toHaveBeenCalledWith(5, '2026-09-01', '2026-09-30');
    expect(misMetricas.obtener).toHaveBeenCalledWith(expect.objectContaining({ idEjecutivo: 5 }));
    expect(datosDelPdf().mode).toBe('individual');
  });

  test('su propio reporte no necesita anunciar de quién es', async () => {
    await pedirPdf(EJECUTIVO, RANGO);

    expect(datosDelPdf().ejecutivoNombre).toBeFalsy();
    expect(QuotationModel.getProgreso).not.toHaveBeenCalled();
  });
});

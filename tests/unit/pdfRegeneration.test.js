// =============================================================================
// tests/unit/pdfRegeneration.test.js
// El invariante de UN SOLO PDF por cotización, y que fallar generándolo nunca
// tumbe la operación que ya se confirmó en la base.
//
// POR QUÉ ESTE ARCHIVO EXISTE
// El encabezado de src/controllers/quotation/pdfRegeneration.js decía «Cubierto
// por tests/unit/pdfRegeneration.test.js» y ese archivo NO existía. El módulo
// mentía sobre su propia cobertura: cero pruebas para el bloque que llaman las
// CUATRO operaciones principales de cotizaciones (createQuotation,
// updateQuotation, updateStatus y approveQuotation).
//
// QUÉ SE PROTEGE ACÁ
//
//   1. EL ORDEN. Primero se borra el archivo viejo, DESPUÉS se genera el nuevo.
//      Invertirlo deja huérfano al recién generado (se purgaría la ruta que en
//      ese momento ya apunta al archivo nuevo, o quedarían dos en disco según
//      cómo se lea `pdf_ruta`). Una aserción de "se llamó a purge" no alcanza:
//      hay que afirmar la SECUENCIA.
//
//   2. QUE NO PURGUE CUANDO NO CORRESPONDE. En una creación (`purge:false`) no
//      hay archivo anterior; y aunque `purge` sea true, sin `pdf_ruta` previo no
//      hay nada que borrar. Purgar de más significa borrar el archivo de OTRA
//      cotización si alguna vez llega una ruta equivocada.
//
//   3. QUE NO SEA FATAL. La regeneración corre DESPUÉS del commit. Si propagara
//      la excepción, un PDF que no se pudo escribir haría fallar con 500 una
//      aprobación que en la base ya está aprobada: la pantalla diría "error" y
//      el estado habría cambiado igual. Ese es el peor desenlace posible.
//
//   4. QUE EL OBJETO EN MEMORIA QUEDE AL DÍA. Los controladores responden con el
//      mismo objeto que le pasaron a esta función; si no se le refresca
//      `pdf_ruta`, el cliente recibe la ruta VIEJA — de un archivo que esta
//      misma función acaba de borrar del disco. Botón de descarga roto.
//
// Todo se prueba con `pdfService` y `QuotationModel` mockeados: el módulo no
// tiene lógica propia más allá de a quién llama, en qué orden y qué hace cuando
// alguno falla — justamente lo que un mock deja afirmar sin tocar disco ni MySQL.
// =============================================================================

'use strict';

// --- Dobles de las dos dependencias del módulo -------------------------------
// Se declaran ANTES del require del sujeto: jest.mock se iza, pero las variables
// que la fábrica captura tienen que llamarse `mock*` para que Jest lo permita.
const mockPdfService = {
  purgeQuotationPdf:    jest.fn(),
  generateQuotationPdf: jest.fn(),
};
const mockQuotationModel = {
  updatePdfPath: jest.fn(),
};

jest.mock('../../src/services/pdfService',      () => mockPdfService);
jest.mock('../../src/models/QuotationModel',    () => mockQuotationModel);

const { regenerateQuotationPdf } =
  require('../../src/controllers/quotation/pdfRegeneration');

const RUTA_VIEJA = 'uploads/cotizaciones/COT-2026-0007-vieja.pdf';
const RUTA_NUEVA = 'uploads/cotizaciones/COT-2026-0007-nueva.pdf';

/** Una cotización como la devuelve findById, en lo que a esta función le importa. */
const cotizacion = (extra = {}) => ({
  id:              7,
  numero_correlativo: 'COT-2026-0007',
  pdf_ruta:        RUTA_VIEJA,
  ...extra,
});

/**
 * Registra la secuencia real de llamadas. jest.fn() sabe CUÁNTAS veces se llamó
 * a cada mock, pero el orden ENTRE mocks distintos hay que anotarlo a mano.
 */
let orden;

beforeEach(() => {
  orden = [];

  mockPdfService.purgeQuotationPdf.mockReset();
  mockPdfService.generateQuotationPdf.mockReset();
  mockQuotationModel.updatePdfPath.mockReset();

  mockPdfService.purgeQuotationPdf.mockImplementation(async (ruta) => {
    orden.push(`purge:${ruta}`);
  });
  mockPdfService.generateQuotationPdf.mockImplementation(async () => {
    orden.push('generate');
    return RUTA_NUEVA;
  });
  mockQuotationModel.updatePdfPath.mockImplementation(async (id, ruta) => {
    orden.push(`update:${id}:${ruta}`);
  });

  // El camino no-fatal loguea con console.warn: se silencia para no ensuciar la
  // salida de la corrida, pero se mantiene espiable para afirmar sobre él.
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => jest.restoreAllMocks());

// ---------------------------------------------------------------------------
describe('camino normal — purgar, generar, guardar (EN ESE ORDEN)', () => {
  test('con purge por defecto y pdf_ruta previo, borra el viejo ANTES de generar', async () => {
    const q = cotizacion();

    const r = await regenerateQuotationPdf(q);

    // La secuencia completa, no sólo que cada cosa ocurrió.
    expect(orden).toEqual([
      `purge:${RUTA_VIEJA}`,
      'generate',
      `update:7:${RUTA_NUEVA}`,
    ]);
    expect(r).toBe(RUTA_NUEVA);
  });

  test('purga exactamente la ruta VIEJA, no la nueva', async () => {
    // Si alguien reordenara el bloque, purge recibiría la ruta recién generada
    // y borraría el archivo que se acaba de escribir.
    await regenerateQuotationPdf(cotizacion());

    expect(mockPdfService.purgeQuotationPdf).toHaveBeenCalledTimes(1);
    expect(mockPdfService.purgeQuotationPdf).toHaveBeenCalledWith(RUTA_VIEJA);
    expect(mockPdfService.purgeQuotationPdf).not.toHaveBeenCalledWith(RUTA_NUEVA);
  });

  test('le pasa a generateQuotationPdf la cotización entera (no sólo el id)', async () => {
    // El PDF necesita cliente, ítems y totales: si sólo recibiera el id saldría
    // un documento vacío sin que nada falle.
    const q = cotizacion();

    await regenerateQuotationPdf(q);

    expect(mockPdfService.generateQuotationPdf).toHaveBeenCalledWith(q);
  });

  test('guarda la ruta nueva contra el id de ESA cotización', async () => {
    await regenerateQuotationPdf(cotizacion({ id: 41 }));

    expect(mockQuotationModel.updatePdfPath).toHaveBeenCalledWith(41, RUTA_NUEVA);
  });

  test('devuelve la ruta que generó el servicio, sea cual sea', async () => {
    mockPdfService.generateQuotationPdf.mockResolvedValue('uploads/cotizaciones/otra.pdf');

    const r = await regenerateQuotationPdf(cotizacion());

    expect(r).toBe('uploads/cotizaciones/otra.pdf');
  });

  test('un objeto de opciones vacío se comporta igual que el default (purga)', async () => {
    await regenerateQuotationPdf(cotizacion(), {});

    expect(mockPdfService.purgeQuotationPdf).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
describe('cuándo NO se purga', () => {
  test('creación (purge:false): no hay archivo anterior, no se borra nada', async () => {
    // createQuotation llama así. Purgar acá sería borrar un archivo ajeno o
    // fallar contra una ruta que todavía no existe.
    const q = cotizacion();       // trae pdf_ruta a propósito: ni así debe purgar

    const r = await regenerateQuotationPdf(q, { purge: false });

    expect(mockPdfService.purgeQuotationPdf).not.toHaveBeenCalled();
    expect(orden).toEqual(['generate', `update:7:${RUTA_NUEVA}`]);
    expect(r).toBe(RUTA_NUEVA);
  });

  test('sin pdf_ruta previo no se purga, aunque purge sea true', async () => {
    const q = cotizacion({ pdf_ruta: null });

    await regenerateQuotationPdf(q, { purge: true });

    expect(mockPdfService.purgeQuotationPdf).not.toHaveBeenCalled();
    expect(mockPdfService.generateQuotationPdf).toHaveBeenCalledTimes(1);
    expect(q.pdf_ruta).toBe(RUTA_NUEVA);
  });

  test('pdf_ruta vacío o ausente tampoco dispara la purga', async () => {
    // Una fila vieja puede tener '' en vez de NULL. purgeQuotationPdf con ''
    // resolvería una ruta al directorio de uploads: mejor ni llamarla.
    await regenerateQuotationPdf(cotizacion({ pdf_ruta: '' }));
    await regenerateQuotationPdf(cotizacion({ pdf_ruta: undefined }));

    expect(mockPdfService.purgeQuotationPdf).not.toHaveBeenCalled();
    expect(mockPdfService.generateQuotationPdf).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
describe('el objeto en memoria queda con la ruta nueva', () => {
  test('pdf_ruta se reemplaza tras regenerar', async () => {
    const q = cotizacion();

    await regenerateQuotationPdf(q);

    expect(q.pdf_ruta).toBe(RUTA_NUEVA);
  });

  test('el refresco ocurre DESPUÉS de guardar en la base', async () => {
    // Si se asignara antes del updatePdfPath y ese INSERT fallara, el cliente
    // recibiría una ruta que la base no conoce.
    let rutaAlGuardar;
    const q = cotizacion();
    mockQuotationModel.updatePdfPath.mockImplementation(async () => {
      rutaAlGuardar = q.pdf_ruta;
    });

    await regenerateQuotationPdf(q);

    expect(rutaAlGuardar).toBe(RUTA_VIEJA);   // todavía sin tocar
    expect(q.pdf_ruta).toBe(RUTA_NUEVA);      // ya refrescado
  });

  test('no toca ningún otro campo de la cotización', async () => {
    const q = cotizacion({ estado: 'Aprobada', total: '1234.56' });

    await regenerateQuotationPdf(q);

    expect(q.estado).toBe('Aprobada');
    expect(q.total).toBe('1234.56');
    expect(q.id).toBe(7);
  });
});

// ---------------------------------------------------------------------------
describe('NO FATAL — un PDF que falla nunca tumba la operación ya confirmada', () => {
  test('si generateQuotationPdf explota, no propaga: devuelve null', async () => {
    mockPdfService.generateQuotationPdf.mockRejectedValue(new Error('disco lleno'));

    // Que NO rechace es el punto entero del test.
    await expect(regenerateQuotationPdf(cotizacion())).resolves.toBeNull();
  });

  test('si generateQuotationPdf explota, no se guarda ninguna ruta en la base', async () => {
    mockPdfService.generateQuotationPdf.mockRejectedValue(new Error('disco lleno'));
    const q = cotizacion();

    await regenerateQuotationPdf(q);

    expect(mockQuotationModel.updatePdfPath).not.toHaveBeenCalled();
    expect(q.pdf_ruta).toBe(RUTA_VIEJA);   // el objeto en memoria queda como estaba
  });

  test('la falla se loguea con el label del llamador, para saber cuál de las cuatro fue', async () => {
    mockPdfService.generateQuotationPdf.mockRejectedValue(new Error('pdfkit murió'));

    await regenerateQuotationPdf(cotizacion(), {
      label: 'QuotationStateController.approveQuotation (approval)',
    });

    expect(console.warn).toHaveBeenCalledTimes(1);
    const [texto, mensaje] = console.warn.mock.calls[0];
    expect(texto).toContain('QuotationStateController.approveQuotation (approval)');
    expect(texto).toContain('non-fatal');
    expect(mensaje).toBe('pdfkit murió');
  });

  test('sin label usa el rótulo genérico por defecto', async () => {
    mockPdfService.generateQuotationPdf.mockRejectedValue(new Error('x'));

    await regenerateQuotationPdf(cotizacion());

    expect(console.warn.mock.calls[0][0]).toContain('[PDF regeneration]');
  });

  test('si falla la purga tampoco propaga — pero se corta antes de generar', async () => {
    // OJO: la purga está DENTRO del mismo try y ANTES del generate, así que un
    // rechazo suyo aborta la regeneración completa. En la práctica no pasa
    // porque pdfService.purgeQuotationPdf ya se traga sus propios errores de
    // disco; se deja afirmado para que un cambio allá se note acá.
    mockPdfService.purgeQuotationPdf.mockRejectedValue(new Error('EACCES'));

    const r = await regenerateQuotationPdf(cotizacion());

    expect(r).toBeNull();
    expect(mockPdfService.generateQuotationPdf).not.toHaveBeenCalled();
    expect(mockQuotationModel.updatePdfPath).not.toHaveBeenCalled();
  });

  test('si falla el UPDATE de la base tampoco propaga', async () => {
    // El archivo nuevo ya está en disco y el viejo ya se borró: la fila queda
    // apuntando a un PDF inexistente, pero el estado confirmado NO se deshace.
    mockQuotationModel.updatePdfPath.mockRejectedValue(new Error('conexión perdida'));
    const q = cotizacion();

    await expect(regenerateQuotationPdf(q)).resolves.toBeNull();
    expect(q.pdf_ruta).toBe(RUTA_VIEJA);   // no se refresca si no se guardó
  });

  test('un fallo no deja el proceso a medias en silencio: siempre loguea', async () => {
    mockPdfService.generateQuotationPdf.mockRejectedValue(new Error('boom'));

    await regenerateQuotationPdf(cotizacion());

    expect(console.warn).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
describe('guarda temprana — sin cotización usable no hace nada', () => {
  test.each([
    ['null',            null],
    ['undefined',       undefined],
    ['objeto sin id',   {}],
    ['id null',         { id: null, pdf_ruta: RUTA_VIEJA }],
    ['id 0',            { id: 0,    pdf_ruta: RUTA_VIEJA }],
  ])('con %s devuelve null y no toca disco ni base', async (_rotulo, entrada) => {
    const r = await regenerateQuotationPdf(entrada);

    expect(r).toBeNull();
    expect(orden).toEqual([]);
    expect(console.warn).not.toHaveBeenCalled();   // no es un error: es un no-op
  });

  test('la guarda corre incluso con opciones explícitas', async () => {
    const r = await regenerateQuotationPdf(null, { purge: true, label: 'X' });

    expect(r).toBeNull();
    expect(mockPdfService.purgeQuotationPdf).not.toHaveBeenCalled();
  });
});

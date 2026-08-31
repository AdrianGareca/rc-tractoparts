// =============================================================================
// tests/unit/pdfGeometriaReporte.test.js
// El reporte de gestión: qué cae encima de qué.
//
// POR QUÉ ESTE DOCUMENTO
// generateReportePdf es, después del expediente, el generador con menos red
// abajo: su única prueba (pdfIdentidad.test.js) verifica que el buffer empiece
// con «%PDF-». Un reporte con las secciones impresas una sobre otra pasa esa
// prueba igual de bien que uno correcto — el mismo agujero por el que se coló
// el bug de la franja «SON:» en la proforma del cliente (ver
// tests/unit/pdfBloqueDeCierre.test.js).
//
// Es un documento INTERNO: no lo recibe el cliente, lo imprime el jefe o el
// ejecutivo para mirar cómo viene el período. Eso baja la urgencia, no la
// necesidad: un reporte ilegible se tira igual.
//
// LO QUE HACE FRÁGIL A ESTE ARCHIVO
// El reporte encadena secciones pasándose una `y` de una función a la otra —
// sectionTitle, statBox, simpleTable, los siete bloques de drawMisMetricas—
// y cada una decide por su cuenta si necesita saltar de página. Las que NO
// deciden nada (statBox y el bloque de tarjetas de _drawStatBoxes) dibujan
// donde les digan, aunque eso quede debajo del pie. Es la misma familia de
// error que el `y += SON_H + 8` perdido: nadie mira el total.
//
// CÓMO SE MIDE
// generateReportePdf construye su propio PDFDocument adentro, así que el arnés
// no se le puede pasar por parámetro: se sustituye el módulo 'pdfkit' entero
// por una fábrica que devuelve el doc de mentira y lo guarda para que el test
// lo mida después. El arnés está en tests/helpers/docFalso.js.
// =============================================================================

'use strict';

// Prefijo `mock` obligatorio: babel-plugin-jest-hoist sube el jest.mock() por
// encima de los require() del archivo y sólo deja que la fábrica toque
// variables del scope externo cuando se llaman así.
const mockDocsCreados = [];

jest.mock('pdfkit', () => function PDFDocumentFalso(opciones = {}) {
  // El require va ADENTRO de la fábrica: afuera se ejecutaría antes de que
  // Jest termine de armar el registro de módulos.
  const { docFalso } = require('../helpers/docFalso');
  // Los márgenes reales del reporte (bottom = MARGIN + 34, que es el alto del
  // pie). drawFooter los pone en 0 y los restaura, así que el objeto tiene que
  // existir y ser escribible.
  const doc = docFalso({ margenes: opciones.margins });
  mockDocsCreados.push(doc);
  return doc;
});

const { generateReportePdf } = require('../../src/services/reportePdfService');
const { textosQueSePisan, describirChoques } = require('../helpers/docFalso');

// Misma geometría que declara reportePdfService.js. Se repite acá a propósito:
// el servicio no la exporta, y una copia desactualizada hace fallar el test
// (ruidoso) en vez de dejar pasar un PDF roto (silencioso).
const PW = 595.28, PH = 841.89, MARGIN = 40;

// La banda del pie: barra marina de 34 pt con un filete naranja 3 pt encima.
// Nada del contenido puede bajar de acá sin quedar impreso sobre el pie.
const Y_TOPE_PIE = PH - 34 - 3;

beforeEach(() => { mockDocsCreados.length = 0; });

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** El resultado de getProgreso(), que sólo se usa en modo company. */
const progreso = (filas = 6) => ({
  volumen: {
    total_mes_usd: 128450.75,
    total_mes_bob: 894120.4,
    total_cotizaciones: 143,
  },
  conversion: { ratio_pct: '38.5' },
  por_ejecutivo: Array.from({ length: filas }, (_, i) => ({
    ejecutivo: `Ejecutivo ${i + 1}`,
    total: 20 + i,
    aceptadas: 8 + i,
    rechazadas: 3,
    volumen_usd: 15400.25 + i * 900,
  })),
});

const clientes = (n) =>
  Array.from({ length: n }, (_, i) => ({
    cliente: `Constructora y Servicios Generales del Oriente ${i + 1} S.R.L.`,
    nit: `102345${String(i).padStart(4, '0')}`,
    proformas_emitidas: 12 - (i % 7),
    total_usd: 8400.5 + i * 130,
    total_bob: 58200.75 + i * 910,
  }));

const porOrigen = (n) =>
  Array.from({ length: n }, (_, i) => ({
    origen: `Referido por cliente existente ${i + 1}`,
    total_clientes: 9 - (i % 5),
    total_usd: 3300.4 + i * 210,
    total_bob: 22900.1 + i * 1400,
  }));

/** El resultado de misMetricas.obtener(), que sólo se usa en modo individual. */
const metricas = (over = {}) => ({
  conversion: 42,
  dias_cierre: 11,
  en_proceso: 7,
  rechazadas: 4,
  cerradas: 19,
  en_la_cancha: 45,
  ticket_usd: 6420.35,
  ticket_bob: 44700.9,
  por_estado: [
    { estado: 'En preparación',     cantidad: 7,  monto_usd: 0,        monto_bob: 51200.5 },
    { estado: 'Enviada al cliente', cantidad: 19, monto_usd: 88400.25, monto_bob: 0 },
    { estado: 'Confirmada',         cantidad: 19, monto_usd: 61200.1,  monto_bob: 122300.75 },
  ],
  comparacion: {
    conversion: 35,
    cerradas: 14,
    emitidas: 40,
    periodo: { desde: '2026-06-01', hasta: '2026-06-30' },
  },
  pendientes: [
    { correlativo: 'SC-2026/000112', cliente: 'GAM Santa Cruz', monto: 42100.5, moneda: 'BOB', dias_esperando: 21 },
    { correlativo: 'SC-2026/000118', cliente: 'Agroindustrias del Este S.A.', monto: 9800.25, moneda: 'USD', dias_esperando: 14 },
  ],
  confirmadas: [
    { correlativo: 'SC-2026/000090', cliente: 'Transportes Yapacaní SRL', fecha: '2026-07-14', monto: 31200.4, moneda: 'BOB' },
  ],
  top_items: [
    { codigo: 'RE522688', marca: 'JOHN DEERE', descripcion: 'Filtro de combustible primario', cantidad: 24, unidad: 'UND', clientes: 6 },
  ],
  por_mes: [
    { mes: '2026-05', emitidas: 30, cerradas: 9 },
    { mes: '2026-06', emitidas: 40, cerradas: 14 },
    { mes: '2026-07', emitidas: 45, cerradas: 19 },
  ],
  ...over,
});

/** Los datos mínimos que el controlador le pasa al servicio. */
const datos = (over = {}) => ({
  mode: 'company',
  periodo: '01/07/2026 al 31/07/2026',
  rol: 'Jefe',
  nombreUsuario: 'Ronald Roca',
  progreso: progreso(),
  topClientes: clientes(8),
  leaderboard: [],
  clientesPorOrigen: porOrigen(4),
  metricas: null,
  ...over,
});

/** Genera el reporte y devuelve el doc de mentira sobre el que se dibujó. */
async function reporte(over) {
  await generateReportePdf(datos(over));
  expect(mockDocsCreados).toHaveLength(1);
  return mockDocsCreados[0];
}

// ---------------------------------------------------------------------------
// Separar el pie del contenido.
//
// El pie se dibuja al final, en una pasada aparte por todas las páginas, así
// que alcanza con encontrar dónde arranca esa pasada: todo lo anterior es
// contenido. Se corta por índice y no por coordenada porque un texto del cuerpo
// que se DERRAME sobre el pie tiene que seguir contando como contenido — si se
// filtrara por «está abajo de todo», el derrame se autoexcluiría y el test que
// lo busca nunca fallaría.
// ---------------------------------------------------------------------------
function partirEnCuerpoYPie(doc) {
  const i = doc.textos.findIndex((t) => t.contenido.startsWith('Generado:'));
  expect(i).toBeGreaterThan(0);

  const pie = doc.textos.slice(i);
  // Tres textos por página (la leyenda «Generado:», la marca centrada y los
  // contactos a la derecha). Si mañana el pie suma o saca uno, esta cuenta se
  // rompe y obliga a revisar el corte, en vez de dejar que medio pie pase por
  // contenido y ensucie todas las mediciones.
  expect(pie).toHaveLength(doc.paginas * 3);

  return { cuerpo: doc.textos.slice(0, i), pie };
}

// ---------------------------------------------------------------------------
// Los dos modos, con datos cómodos. La base: si esto ya se pisa, no hace falta
// buscar casos raros.
// ---------------------------------------------------------------------------
describe('las secciones no se pisan entre sí', () => {
  const CASOS = {
    'company — datos típicos': {},
    'company — sin clientes ni orígenes (secciones vacías)': {
      topClientes: [], clientesPorOrigen: [], progreso: progreso(0),
    },
    'company — sin progreso (la mitad del reporte no se dibuja)': {
      progreso: null,
    },
    'individual — datos típicos': {
      mode: 'individual', rol: 'Ejecutivo', nombreUsuario: 'Ana Quiroga',
      progreso: null, clientesPorOrigen: [],
      topClientes: clientes(5), metricas: metricas(),
    },
    'individual — sin métricas todavía': {
      mode: 'individual', rol: 'Ejecutivo', nombreUsuario: 'Ana Quiroga',
      progreso: null, clientesPorOrigen: [], topClientes: [], metricas: null,
    },
    'individual — métricas con todas las listas vacías': {
      mode: 'individual', rol: 'Ejecutivo', nombreUsuario: 'Ana Quiroga',
      progreso: null, clientesPorOrigen: [], topClientes: [],
      metricas: metricas({
        conversion: null, dias_cierre: null, ticket_usd: null, ticket_bob: null,
        por_estado: [], comparacion: null, pendientes: [], confirmadas: [],
        top_items: [], por_mes: [],
      }),
    },
  };

  for (const [nombre, over] of Object.entries(CASOS)) {
    test(nombre, async () => {
      const doc = await reporte(over);
      const choques = textosQueSePisan(doc);
      if (choques.length > 0) {
        throw new Error(`Textos superpuestos en el reporte:\n  ${describirChoques(choques)}`);
      }
    });
  }
});

// ---------------------------------------------------------------------------
// Datos incómodos. Los tres largos que el reporte no controla: el nombre de
// quien lo genera (usuarios.nombre_usuario), el nombre del ejecutivo en la
// tabla por ejecutivo, y la descripción de repuesto en «Los repuestos que más
// cotizo» — las tres son columnas de texto libre.
// ---------------------------------------------------------------------------
describe('datos incómodos: nombres y descripciones largas', () => {
  const NOMBRE_LARGO = 'María Fernanda de la Cruz Villarroel Aguirre Montenegro';

  test('un nombre largo en GENERADO POR no se pisa con la fila FECHA', async () => {
    // Ya mordió una vez: el alto de fila de la caja de cabecera era fijo en
    // 13 pt y la continuación del nombre caía sobre la fila de abajo (ronda de
    // estrés del 2026-08-26). Este es el guardia de ese arreglo.
    const doc = await reporte({ nombreUsuario: NOMBRE_LARGO });

    const choques = textosQueSePisan(doc);
    if (choques.length > 0) {
      throw new Error(`Textos superpuestos en el reporte:\n  ${describirChoques(choques)}`);
    }
  });

  test('la caja de cabecera CRECE con el nombre, no queda del alto de siempre', async () => {
    // Que no se pisen no distingue el código arreglado del roto: con saltos
    // fijos tampoco «se pisan» si el mock sólo anota dónde empieza cada texto.
    // Lo que distingue es que la caja RESERVE el alto real — y eso se ve en
    // dónde queda el divisor marino que va debajo de ella.
    const corto = await reporte({ nombreUsuario: 'Ana Quiroga' });
    mockDocsCreados.length = 0;
    const largo = await reporte({ nombreUsuario: NOMBRE_LARGO });

    const divisor = (doc) => {
      // El divisor del encabezado va de margen a margen y es lo único que se
      // dibuja así antes de la franja de marcas.
      const anchoCompleto = doc.lineas.filter(
        (l) => Math.round(l.x1) === MARGIN && Math.round(l.x2) === Math.round(PW - MARGIN)
      );
      expect(anchoCompleto.length).toBeGreaterThan(0);
      return anchoCompleto[0].y1;
    };

    expect(divisor(largo)).toBeGreaterThan(divisor(corto));
  });

  test('un ejecutivo de nombre largo no derrama sobre la fila siguiente', async () => {
    const doc = await reporte({
      progreso: {
        ...progreso(3),
        por_ejecutivo: [
          { ejecutivo: NOMBRE_LARGO, total: 22, aceptadas: 9, rechazadas: 3, volumen_usd: 18400.5 },
          { ejecutivo: 'Ana Quiroga', total: 14, aceptadas: 5, rechazadas: 2, volumen_usd: 9100.25 },
        ],
      },
    });

    const largo = doc.textos.find((t) => t.contenido === NOMBRE_LARGO);
    const siguiente = doc.textos.find((t) => t.contenido === 'Ana Quiroga');

    expect(largo).toBeDefined();
    expect(siguiente).toBeDefined();
    // Que envuelva a más de una línea es la condición del caso: si entrara en
    // una sola, el test no estaría probando nada.
    expect(largo.lineas).toBeGreaterThan(1);
    expect(siguiente.arriba).toBeGreaterThanOrEqual(largo.abajo);
  });

  test('una descripción de repuesto larga no derrama sobre la fila siguiente', async () => {
    // Ya mordió: el alto de fila de simpleTable era fijo en 16 pt (ver el
    // comentario de _calcTableRowHeight). Este caso vigila que siga medido.
    const DESCRIPCION = 'Filtro de combustible primario con separador de agua para motor '
      + 'diésel de seis cilindros, equivalente original de fábrica, presentación por unidad';

    const doc = await reporte({
      mode: 'individual', rol: 'Ejecutivo', progreso: null, clientesPorOrigen: [],
      topClientes: clientes(3),
      metricas: metricas({
        top_items: [
          { codigo: 'RE522688', marca: 'JOHN DEERE', descripcion: DESCRIPCION, cantidad: 24, unidad: 'UND', clientes: 6 },
          { codigo: 'AT310640', marca: 'CAT', descripcion: 'Empaquetadura de tapa de válvulas', cantidad: 8, unidad: 'UND', clientes: 2 },
        ],
      }),
    });

    const larga = doc.textos.find((t) => t.contenido === DESCRIPCION);
    const siguiente = doc.textos.find((t) => t.contenido === 'AT310640');

    expect(larga).toBeDefined();
    expect(larga.lineas).toBeGreaterThan(1);
    expect(siguiente).toBeDefined();
    expect(siguiente.arriba).toBeGreaterThanOrEqual(larga.abajo);
  });
});

// ---------------------------------------------------------------------------
// Muchas filas: el reporte tiene que cortar de página solo, y el corte tiene
// que caer arriba del pie en TODAS las páginas, no sólo en la última.
// ---------------------------------------------------------------------------
describe('el pie de página no se monta sobre la última fila de contenido', () => {
  const CASOS = {
    'company — típico': {},
    'company — secciones vacías': { topClientes: [], clientesPorOrigen: [], progreso: progreso(0) },
    'company — 60 ejecutivos': { progreso: progreso(60) },
    'company — 60 clientes': { topClientes: clientes(60) },
    'company — 60 orígenes': { clientesPorOrigen: porOrigen(60) },
    'company — las tres tablas largas a la vez': {
      progreso: progreso(40), topClientes: clientes(40), clientesPorOrigen: porOrigen(40),
    },
    'individual — típico': {
      mode: 'individual', rol: 'Ejecutivo', progreso: null, clientesPorOrigen: [],
      topClientes: clientes(6), metricas: metricas(),
    },
    'individual — muchos pendientes y confirmadas': {
      mode: 'individual', rol: 'Ejecutivo', progreso: null, clientesPorOrigen: [],
      topClientes: clientes(10),
      metricas: metricas({
        pendientes: Array.from({ length: 30 }, (_, i) => ({
          correlativo: `SC-2026/${String(i + 100).padStart(6, '0')}`,
          cliente: `Constructora del Oriente ${i + 1} S.R.L.`,
          monto: 12000 + i * 350, moneda: i % 2 ? 'USD' : 'BOB', dias_esperando: 30 - i,
        })),
        confirmadas: Array.from({ length: 30 }, (_, i) => ({
          correlativo: `SC-2026/${String(i + 200).padStart(6, '0')}`,
          cliente: `Agroindustrias del Este ${i + 1} S.A.`,
          fecha: '2026-07-14', monto: 20000 + i * 410, moneda: i % 2 ? 'USD' : 'BOB',
        })),
      }),
    },
  };

  for (const [nombre, over] of Object.entries(CASOS)) {
    test(nombre, async () => {
      const doc = await reporte(over);
      const { cuerpo } = partirEnCuerpoYPie(doc);

      const derrames = cuerpo
        .filter((t) => t.abajo > Y_TOPE_PIE)
        .map((t) => `«${t.contenido.slice(0, 40)}» (pág. ${t.pagina + 1}) baja hasta `
          + `${t.abajo.toFixed(1)}, la barra del pie empieza en ${Y_TOPE_PIE.toFixed(1)}`);

      if (derrames.length > 0) {
        throw new Error(`Contenido impreso sobre el pie de página:\n  ${derrames.join('\n  ')}`);
      }
    });
  }

  test('el pie se repite en TODAS las páginas, no sólo en la primera', async () => {
    const doc = await reporte({ topClientes: clientes(60) });
    expect(doc.paginas).toBeGreaterThan(1);

    const { pie } = partirEnCuerpoYPie(doc);
    const paginasConPie = new Set(pie.map((t) => t.pagina));
    expect(paginasConPie.size).toBe(doc.paginas);
  });

  test('las tablas largas se reparten en varias páginas y no se pisan', async () => {
    const doc = await reporte({
      progreso: progreso(40), topClientes: clientes(40), clientesPorOrigen: porOrigen(40),
    });

    expect(doc.paginas).toBeGreaterThan(1);
    const choques = textosQueSePisan(doc);
    if (choques.length > 0) {
      throw new Error(`Textos superpuestos en el reporte:\n  ${describirChoques(choques)}`);
    }
  });

  test('cada página larga repite el encabezado marino de la tabla', async () => {
    // simpleTable redibuja la fila de encabezado al saltar de página. Si no lo
    // hiciera, las páginas 2 en adelante serían columnas de números sin rótulo
    // — legible sólo para quien ya sabe qué es cada una.
    const doc = await reporte({ topClientes: clientes(60) });
    const encabezados = doc.textos.filter((t) => t.contenido === 'CLIENTE');

    expect(encabezados.length).toBeGreaterThan(1);
    const paginas = new Set(encabezados.map((t) => t.pagina));
    expect(paginas.size).toBe(encabezados.length); // uno por página, sin repetir
  });
});

// ---------------------------------------------------------------------------
describe('los dos modos dibujan lo suyo y nada del otro', () => {
  // No es geometría, pero es la condición previa: si el modo individual
  // imprimiera la tabla por ejecutivo, la superposición sería el menor de los
  // problemas (el ejecutivo vería datos de toda la empresa).
  test('company trae el resumen general y los clientes por origen', async () => {
    const doc = await reporte();
    const contenidos = doc.textos.map((t) => t.contenido);

    expect(contenidos).toContain('RESUMEN GENERAL');
    expect(contenidos).toContain('RENDIMIENTO POR EJECUTIVO');
    expect(contenidos).toContain('CLIENTES POR ORIGEN');
    expect(contenidos).not.toContain('MI RENDIMIENTO');
  });

  test('individual trae Mi Rendimiento y nada de la empresa', async () => {
    const doc = await reporte({
      mode: 'individual', rol: 'Ejecutivo', progreso: null,
      clientesPorOrigen: [], topClientes: clientes(4), metricas: metricas(),
    });
    const contenidos = doc.textos.map((t) => t.contenido);

    expect(contenidos).toContain('MI RENDIMIENTO');
    expect(contenidos).toContain('MIS CLIENTES PRINCIPALES');
    expect(contenidos).not.toContain('RESUMEN GENERAL');
    expect(contenidos).not.toContain('RENDIMIENTO POR EJECUTIVO');
    expect(contenidos).not.toContain('CLIENTES POR ORIGEN');
  });
});

// ---------------------------------------------------------------------------
// HALLAZGO ABIERTO — BUG REAL, NO SE ARREGLA ACÁ.
//
// El bloque de tarjetas de «Mi Rendimiento» (_drawStatBoxes, modo individual)
// se imprime SOBRE la barra marina del pie de página cuando la sección arranca
// cerca del final de la hoja.
//
// LA CUENTA, sacada del propio fuente (no del modelo del arnés, así que estos
// números valen para el PDF de verdad):
//
//   sectionTitle sólo salta de página si `y > PH - MARGIN - 90`, o sea que
//   RESERVA 90 pt. En el peor caso que deja pasar arranca en y = 711,9 y
//   devuelve 731,9. Desde ahí _drawStatBoxes dibuja, sin volver a mirar nada:
//
//     fila 1 de tarjetas   731,9 → 773,9   (42 pt de alto)
//     y += 50              → 781,9
//     nota del denominador 781,9 → ~801    (una o dos líneas)
//     y += 18              → 799,9
//     fila 2 de tarjetas   799,9 → 841,9   ← TICKET PROMEDIO USD / BOB
//
//   La barra marina del pie empieza en 807,9 y el filete naranja en 804,9. La
//   segunda fila de tarjetas —las de ticket promedio— cae entera adentro del
//   pie: el rectángulo blanco se dibuja encima de la barra y el monto sale en
//   verde petróleo (#0F766E) sobre marino, ilegible.
//
//   Ni statBox ni _drawStatBoxes llaman a ensureSpace ni a addPage: dibujan
//   donde se les diga. El bloque necesita ~150 pt y sectionTitle reserva 90.
//
// MEDIDO CON EL ARNÉS: con 25 filas en «Mis Clientes Principales», los montos
// de ticket se dibujan en y = 807,8 y terminan en 824,6 — dentro de la barra
// del pie, que empieza en 807,9. Las tarjetas van de 785,8 a 827,8.
//
// CÓMO REPRODUCIRLO EN LA APP
// Entrar como Ejecutivo y descargar el reporte individual de un período donde
// «Mis Clientes Principales» tenga la cantidad justa de filas para dejar el
// cursor entre ~690 y 712 pt (con los anchos reales de Helvetica el número
// exacto de filas no es el mismo que en el arnés, porque el arnés modela la
// tipografía; el rango de Y sí es real). Es un documento INTERNO, así que no lo
// ve el cliente — pero el ejecutivo lo imprime para mostrar cómo viene, y los
// dos números de ticket promedio son justamente los que no se leen.
//
// POR QUÉ ESTÁ EN skip Y NO EN ROJO
// Arreglarlo obliga a tocar src/services/reportePdfService.js (subir la reserva
// de sectionTitle, o hacer que _drawStatBoxes pida espacio antes de cada fila
// de tarjetas) y esta tanda de trabajo es sólo de tests. La decisión es de
// Adrian. Para verlo, sacarle el .skip.
// ---------------------------------------------------------------------------
describe('tarjetas de «Mi Rendimiento» al pie de la hoja (hallazgo abierto)', () => {
  // Nombres CORTOS a propósito: lo que hay que controlar es dónde queda el
  // cursor después de la tabla, y con razones sociales largas cada fila crece
  // de a saltos y el ajuste fino se vuelve imposible. Con 25 filas de una línea
  // la sección «Mi Rendimiento» arranca en y ≈ 698, adentro de la ventana que
  // sectionTitle deja pasar (hasta 711,9).
  const clientesCortos = (n) => Array.from({ length: n }, (_, i) => ({
    cliente: `Cliente ${i + 1}`,
    nit: `10234${String(i).padStart(5, '0')}`,
    proformas_emitidas: 3,
    total_usd: 1200.5,
    total_bob: 8400.25,
  }));

  const AL_FILO = {
    mode: 'individual', rol: 'Ejecutivo', nombreUsuario: 'Ana Quiroga',
    progreso: null, clientesPorOrigen: [],
    topClientes: clientesCortos(25),
    metricas: metricas({
      por_estado: [], comparacion: null, pendientes: [],
      confirmadas: [], top_items: [], por_mes: [],
    }),
  };

  test('la sección todavía arranca al final de la primera página', async () => {
    // El guardia del propio hallazgo: si mañana alguien sube la reserva de
    // sectionTitle o le agrega un ensureSpace a _drawStatBoxes, la sección se
    // va a la página siguiente, este test se pone en rojo y obliga a revisar
    // el skip de abajo en vez de dejarlo protegiendo un caso que ya no existe.
    const doc = await reporte(AL_FILO);
    const titulo = doc.textos.find((t) => t.contenido === 'MI RENDIMIENTO');

    expect(titulo).toBeDefined();
    expect(titulo.pagina).toBe(0);
    expect(titulo.y).toBeGreaterThan(650);
  });

  test('los tickets promedio no se imprimen sobre la barra del pie', async () => {
    const doc = await reporte(AL_FILO);
    const { cuerpo } = partirEnCuerpoYPie(doc);

    const derrames = cuerpo.filter((t) => t.abajo > Y_TOPE_PIE);
    expect(derrames.map((t) => t.contenido)).toEqual([]);
  });

  test('tampoco las tarjetas blancas que las contienen', async () => {
    // El rectángulo tapa la barra marina aunque el texto entrara: es lo que se
    // ve primero al abrir el PDF.
    const doc = await reporte(AL_FILO);
    const tarjetas = doc.formas.filter((f) => f.tipo === 'rect' && f.alto === 42);

    expect(tarjetas.length).toBeGreaterThan(0);
    for (const t of tarjetas) expect(t.abajo).toBeLessThanOrEqual(Y_TOPE_PIE);
  });
});

// ---------------------------------------------------------------------------
describe('nada se sale de la hoja', () => {
  test('todo el texto entra en el ancho de la página', async () => {
    for (const over of [
      {},
      { topClientes: clientes(30) },
      { progreso: progreso(30) },
      {
        mode: 'individual', rol: 'Ejecutivo', progreso: null, clientesPorOrigen: [],
        topClientes: clientes(6), metricas: metricas(),
      },
    ]) {
      mockDocsCreados.length = 0;
      const doc = await reporte(over);

      for (const t of doc.textos) {
        // La cota es el borde de la hoja y no el margen: la franja de marcas
        // se dibuja con el margen de la proforma (36 pt, de pdf/constants.js)
        // y no con el 40 local del reporte, y esa diferencia histórica no es
        // lo que este test vigila.
        expect(t.izquierda).toBeGreaterThanOrEqual(0);
        expect(t.derecha).toBeLessThanOrEqual(PW);
      }
    }
  });

  test('un monto de ocho cifras no parte la tarjeta en dos líneas', async () => {
    // statBox achica la letra hasta que el número entre en una sola línea (ver
    // el comentario del propio statBox). Sin eso, el monto salía cortado a la
    // mitad dentro de una caja de 42 pt.
    const doc = await reporte({
      progreso: {
        ...progreso(2),
        volumen: { total_mes_usd: 123456789.55, total_mes_bob: 987654321.99, total_cotizaciones: 4210 },
      },
    });

    const monto = doc.textos.find((t) => t.contenido.startsWith('$ 123'));
    expect(monto).toBeDefined();
    expect(monto.lineas).toBe(1);
  });
});

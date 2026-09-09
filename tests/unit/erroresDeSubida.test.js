// =============================================================================
// tests/unit/erroresDeSubida.test.js
// Lo que se le responde a quien sube un archivo que no entra.
//
// POR QUÉ EXISTE
// Este manejador estaba escrito dos veces, y las dos copias ya se habían
// separado en el idioma del mensaje: inglés desde cotizaciones, castellano
// desde licitaciones. Ahora hay uno solo, y estas pruebas fijan las dos
// decisiones que estaban repartidas y podían volver a divergir:
//
//   • el archivo demasiado grande responde 413, no 422 — el mismo motivo de
//     rechazo devolvía códigos distintos según por qué pantalla entrara;
//   • el mensaje va en castellano, que es la política del proyecto.
//
// Se le pasan un `err` y un `res` de mentira: lo que se prueba es la decisión,
// no multer.
// =============================================================================

'use strict';

const multer = require('multer');
const { erroresDeSubida } = require('../../src/middlewares/erroresDeSubida');

/** Un `res` que anota lo que se le pidió responder. */
function resFalso() {
  const r = { statusCode: null, cuerpo: null };
  r.status = (c) => { r.statusCode = c; return r; };
  r.json   = (b) => { r.cuerpo = b; return r; };
  return r;
}

/** Corre el middleware y devuelve { res, siguio } — siguio = llamó a next(err). */
function correr(manejador, err) {
  const res = resFalso();
  let siguio = false;
  manejador(err, {}, res, () => { siguio = true; });
  return { res, siguio };
}

const errorDeMulter = (code) => new multer.MulterError(code);

describe('el archivo demasiado grande responde 413', () => {
  test('LIMIT_FILE_SIZE da 413, no 422', () => {
    const { res, siguio } = correr(erroresDeSubida(), errorDeMulter('LIMIT_FILE_SIZE'));

    if (res.statusCode !== 413) {
      throw new Error(
        `Un archivo demasiado grande respondió ${res.statusCode} y debe responder 413.\n\n` +
        'El manejador global de src/app.js ya usa 413 para ese mismo error. Cuando ' +
        'los routers lo interceptaban con 422, el MISMO motivo de rechazo devolvía ' +
        'un código distinto según por qué pantalla hubiera entrado el archivo.'
      );
    }
    expect(siguio).toBe(false);
    expect(res.cuerpo.success).toBe(false);
  });

  test.each([
    ['LIMIT_UNEXPECTED_FILE'],
    ['LIMIT_FILE_COUNT'],
    ['LIMIT_PART_COUNT'],
  ])('%s sigue siendo 422', (code) => {
    // No son problemas de tamaño: son peticiones mal formadas.
    const { res } = correr(erroresDeSubida(), errorDeMulter(code));
    expect(res.statusCode).toBe(422);
  });
});

describe('el mensaje va en castellano', () => {
  test.each([
    ['LIMIT_FILE_SIZE'],
    ['LIMIT_UNEXPECTED_FILE'],
  ])('%s no responde en inglés', (code) => {
    const { res } = correr(erroresDeSubida(), errorDeMulter(code));

    expect(res.cuerpo.message).toContain('Error al subir el archivo');
    // El texto que tenía la copia de cotizaciones.
    expect(res.cuerpo.message).not.toContain('File upload error');
  });
});

describe('los rechazos propios del router', () => {
  const conFiltro = () => erroresDeSubida({
    prefijosDeCliente: ['Tipo de archivo no permitido'],
  });

  test('un tipo de archivo no permitido responde 422 con su propio texto', () => {
    const err = new Error('Tipo de archivo no permitido: ".exe". Permitidos: PDF, Word…');
    const { res, siguio } = correr(conFiltro(), err);

    expect(res.statusCode).toBe(422);
    expect(res.cuerpo.message).toBe(err.message);
    expect(siguio).toBe(false);
  });

  test('sin declarar el prefijo, ese mismo error pasa de largo', () => {
    // Cotizaciones no tiene filtro de extensión —verifica el contenido después
    // de escribir, por número mágico— así que su manejador NO debe inventarse
    // un 422 para un error que no reconoce.
    const err = new Error('Tipo de archivo no permitido: ".exe".');
    const { res, siguio } = correr(erroresDeSubida(), err);

    expect(siguio).toBe(true);
    expect(res.statusCode).toBeNull();
  });
});

describe('lo que no es de subida no se lo queda', () => {
  test.each([
    ['un error cualquiera',   new Error('ECONNREFUSED')],
    ['sin mensaje',           new Error()],
    ['un objeto pelado',      { code: 'RARO' }],
    ['null',                  null],
  ])('%s se pasa al manejador global', (_nombre, err) => {
    // Quedárselo lo convertiría en un 422 y escondería una caída real detrás
    // de «error al subir el archivo».
    const { res, siguio } = correr(erroresDeSubida({ prefijosDeCliente: ['X'] }), err);
    expect(siguio).toBe(true);
    expect(res.statusCode).toBeNull();
  });
});

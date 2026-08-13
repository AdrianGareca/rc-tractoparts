// =============================================================================
// tests/unit/subidaParcialDocumentos.test.js
// Una subida que falla a la mitad no deja documentos fantasma.
//
// EL BUG
// uploadDocumentos guardaba los archivos en un bucle, una fila por archivo, sin
// transacción. Su `catch` de cierre llamaba a cleanupAll(), que borra del disco
// TODOS los archivos de la petición.
//
// Con cinco archivos y una falla al guardar el tercero, el resultado era:
//
//     filas en la base    1, 2        (ya insertadas, quedan)
//     archivos en disco   ninguno     (cleanupAll borró los cinco)
//
// O sea: dos documentos que aparecen en la pantalla de la licitación, con su
// nombre y su tamaño, y que al apretar "Descargar" contestan «El archivo ya no
// está disponible en el servidor». Para siempre. Nadie puede saber qué pasó, y
// el único arreglo es que alguien entre a la base a borrar las filas a mano.
//
// Y la persona que subió recibió un 500, así que va a volver a subir los cinco:
// ahora hay dos filas rotas y cinco buenas, con nombres repetidos.
//
// LA REGLA
// O quedan los cinco, o no queda ninguno. Si algo falla, se deshace lo que se
// haya alcanzado a escribir —filas Y archivos— y recién ahí se informa el error.
//
// POR QUÉ SE PUEDE PROBAR ACÁ Y NO CON LA BASE DE VERDAD
// Para provocar el fallo del tercer INSERT contra MySQL habría que romper la
// tabla a propósito en medio de la petición. Al sacar el bucle a su propia
// función con el modelo INYECTADO, el fallo se pide y ya está.
// =============================================================================

'use strict';

const { persistirDocumentos } = require('../../src/controllers/licitacion/persistirDocumentos');

/** Cinco archivos como los deja multer. */
const archivos = () => [1, 2, 3, 4, 5].map((n) => ({
  originalname: `Pliego ${n}.pdf`,
  filename:     `LICDOC-7-abc${n}.pdf`,
  path:         `storage/licitaciones/LICDOC-7-abc${n}.pdf`,
  size:         1000 * n,
}));

const USUARIO = { id: 3, nombre_usuario: 'proyectos1' };

/**
 * Un modelo de mentira que puede fallar en el INSERT que se le pida.
 * Anota todo lo que se le hizo, que es lo que después se afirma.
 */
function modeloFalso({ fallarEnLaFila = null } = {}) {
  const creados = [], borrados = [];
  let n = 0;
  return {
    creados, borrados,
    create: jest.fn(async () => {
      n += 1;
      if (n === fallarEnLaFila) throw new Error('Duplicate entry / conexión perdida');
      creados.push(n);
      return 100 + n;               // el id que devolvería MySQL
    }),
    deleteById: jest.fn(async (id) => { borrados.push(id); }),
  };
}

// ---------------------------------------------------------------------------
describe('cuando todo sale bien', () => {
  test('guarda una fila por archivo y no borra nada', async () => {
    const modelo = modeloFalso();
    const borrarDeDisco = jest.fn(async () => {});

    const creados = await persistirDocumentos({
      files: archivos(), idLicitacion: 7, usuario: USUARIO, modelo, borrarDeDisco,
    });

    expect(creados).toHaveLength(5);
    expect(modelo.deleteById).not.toHaveBeenCalled();
    expect(borrarDeDisco).not.toHaveBeenCalled();
  });

  test('devuelve el id que asignó la base, no el índice del bucle', async () => {
    // La pantalla usa ese id para armar el enlace de descarga. Devolver el
    // índice haría que los botones apunten a documentos ajenos.
    const modelo = modeloFalso();
    const creados = await persistirDocumentos({
      files: archivos().slice(0, 2), idLicitacion: 7, usuario: USUARIO,
      modelo, borrarDeDisco: async () => {},
    });

    expect(creados.map((c) => c.id)).toEqual([101, 102]);
  });
});

// ---------------------------------------------------------------------------
describe('cuando falla a la mitad', () => {
  test('deshace las filas que alcanzó a insertar', async () => {
    const modelo = modeloFalso({ fallarEnLaFila: 3 });

    await expect(persistirDocumentos({
      files: archivos(), idLicitacion: 7, usuario: USUARIO,
      modelo, borrarDeDisco: async () => {},
    })).rejects.toThrow();

    // Las dos que entraron antes del fallo tienen que salir. Sin esto quedan
    // dos documentos en la pantalla que no se pueden descargar nunca.
    expect(modelo.borrados).toEqual([101, 102]);
  });

  test('deja pasar el error para que el controlador responda 500', async () => {
    const modelo = modeloFalso({ fallarEnLaFila: 1 });

    await expect(persistirDocumentos({
      files: archivos(), idLicitacion: 7, usuario: USUARIO,
      modelo, borrarDeDisco: async () => {},
    })).rejects.toThrow(/Duplicate entry|conexión/);
  });

  test('no intenta guardar los que venían después', async () => {
    const modelo = modeloFalso({ fallarEnLaFila: 2 });

    await expect(persistirDocumentos({
      files: archivos(), idLicitacion: 7, usuario: USUARIO,
      modelo, borrarDeDisco: async () => {},
    })).rejects.toThrow();

    // Cinco archivos, falla el segundo: se intentaron dos, no cinco.
    expect(modelo.create).toHaveBeenCalledTimes(2);
  });

  test('si tampoco se puede deshacer, gana el error original', async () => {
    // El caso feo: se cayó la base, así que el DELETE de la vuelta atrás
    // también falla. El error que le sirve a quien lee el log es el PRIMERO —
    // el que dice qué se rompió—, no el segundo, que es una consecuencia.
    const modelo = modeloFalso({ fallarEnLaFila: 3 });
    modelo.deleteById = jest.fn(async () => { throw new Error('la base sigue caída'); });

    await expect(persistirDocumentos({
      files: archivos(), idLicitacion: 7, usuario: USUARIO,
      modelo, borrarDeDisco: async () => {},
    })).rejects.toThrow(/Duplicate entry|conexión/);
  });
});

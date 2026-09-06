// =============================================================================
// tests/unit/bcryptCompatibilidad.test.js
// Las contraseñas que ya están guardadas tienen que seguir validando.
//
// POR QUÉ EXISTE
// `bcryptjs` es lo que verifica el ingreso de todas las personas que usan la
// aplicación. Si una actualización cambiara el formato de hash o dejara de
// entender el viejo, el efecto no sería un error visible: sería que **nadie
// puede entrar**, con la contraseña correcta escrita bien.
//
// Y no se arregla volviendo atrás: las contraseñas en claro no existen en
// ningún lado, así que la única salida sería resetearlas todas a mano.
//
// Se descubrió al actualizar bcryptjs 2.4.3 → 3.0.3 (2026-09-06). Se comprobó
// a mano antes de aplicarlo; esto lo deja hecho para la próxima.
//
// LO QUE CAMBIÓ EN LA 3, Y POR QUÉ NO IMPORTA
// Los hashes nuevos salen con prefijo `$2b$` en vez de `$2a$`. Es el prefijo
// moderno del algoritmo, y la misma librería entiende los dos — por eso las
// contraseñas viejas siguen funcionando mientras conviven con las nuevas.
//
// NO SE USAN CONTRASEÑAS REALES
// Los hashes de más abajo son de una clave inventada, generados a mano con la
// versión 2.4.3 y pegados ací como constantes. Ninguno sale de la base: lo que
// se verifica es el FORMATO, y el formato es el mismo que el de producción.
//
// Que estén FIJOS es el punto. Generarlos en cada corrida con la librería
// actual haría que la prueba se compare contra sí misma y no detecte nada.
// =============================================================================

'use strict';

const bcrypt = require('bcryptjs');
const fs     = require('fs');
const path   = require('path');

const CLAVE   = 'UnaClaveDePrueba2026*';
const RONDAS  = 12;   // el valor por defecto de userController (BCRYPT_ROUNDS)

// Hashes REALES, producidos por bcryptjs 2.4.3 —la versión que creó las
// contraseñas que hoy están en la base— antes de actualizar. Quedan escritos
// como constantes a propósito: si se regeneraran en cada corrida con la
// librería actual, la prueba compararía la versión nueva contra sí misma y no
// probaría nada. Corresponden a la constante CLAVE de más arriba.
const HASHES_VIEJOS = {
  'creado por bcryptjs 2.4.3':
    '$2a$12$6evPry2/0T0dT5Sxj1Q8jOV090gj0sHa5/tOp/f4dH/mCs6uRUTtO',
  'otro de la misma versión, con distinta sal':
    '$2a$12$LKzNPMTF7Hm8fZFG.wNzEeEaRUqEz2feHXsXV8iU.dcp6sFtpOnLK',
};

describe('las contraseñas ya guardadas siguen validando', () => {
  // El caso central: un hash creado por la versión ANTERIOR tiene que seguir
  // aceptando su contraseña con la versión actual.
  test('un hash $2a$ recién creado valida y rechaza correctamente', async () => {
    // Se genera con la librería actual pero se fuerza el prefijo viejo, que es
    // el que tienen las cuentas creadas antes de la actualización.
    const salt = bcrypt.genSaltSync(RONDAS).replace(/^\$2[aby]\$/, '$2a$');
    const hash = bcrypt.hashSync(CLAVE, salt);

    expect(hash.startsWith('$2a$')).toBe(true);
    expect(await bcrypt.compare(CLAVE, hash)).toBe(true);
    expect(await bcrypt.compare('ClaveEquivocada', hash)).toBe(false);
  });

  test.each(Object.entries(HASHES_VIEJOS))('%s', async (_nombre, hash) => {
    const acepta  = await bcrypt.compare(CLAVE, hash);
    const rechaza = await bcrypt.compare('otra cosa', hash);

    if (!acepta) {
      throw new Error(
        `Este hash dejó de validar su contraseña:\n  ${hash}\n\n` +
        'Es el formato que tienen las contraseñas ya guardadas en la base. Si la ' +
        'librería dejó de entenderlo, NADIE puede iniciar sesión — y no se ' +
        'arregla volviendo atrás, porque las contraseñas en claro no existen en ' +
        'ningún lado. Habría que resetearlas todas a mano.\n\n' +
        'NO actualizar bcryptjs hasta resolver esto.'
      );
    }
    expect(rechaza).toBe(false);
  });
});

describe('las contraseñas nuevas se crean bien', () => {
  test('hash + compare, en la forma asíncrona que usa la aplicación', async () => {
    // authController y userController usan `await`, no las variantes Sync.
    const hash = await bcrypt.hash(CLAVE, RONDAS);
    expect(hash).toHaveLength(60);
    expect(await bcrypt.compare(CLAVE, hash)).toBe(true);
    expect(await bcrypt.compare(CLAVE + 'x', hash)).toBe(false);
  });

  test('el costo configurado queda escrito en el hash', async () => {
    // El número de rondas viaja dentro del propio hash. Si una actualización lo
    // bajara en silencio, las contraseñas quedarían más fáciles de romper sin
    // que nada lo indique.
    const hash = await bcrypt.hash(CLAVE, RONDAS);
    const m = hash.match(/^\$2[aby]\$(\d{2})\$/);
    expect(m).not.toBeNull();
    expect(Number(m[1])).toBe(RONDAS);
  });

  test('el mínimo de rondas del proyecto no bajó', () => {
    // userController usa `BCRYPT_ROUNDS || 12`. Menos de 10 se considera débil
    // hoy; se vigila el valor por defecto del código, no el del entorno.
    const src = fs.readFileSync(
      path.resolve(__dirname, '../../src/controllers/userController.js'), 'utf8');
    const m = src.match(/BCRYPT_ROUNDS,\s*10\)\s*\|\|\s*(\d+)/);
    expect(m).not.toBeNull();
    expect(Number(m[1])).toBeGreaterThanOrEqual(10);
  });
});

describe('el hash fijo que iguala los tiempos de respuesta', () => {
  // authController compara contra un hash inventado cuando el usuario no
  // existe, para que una cuenta inexistente tarde lo mismo que una con la
  // contraseña equivocada. Sin eso, el tiempo de respuesta delata qué nombres
  // de usuario son reales.
  const RUTA = path.resolve(__dirname, '../../src/controllers/authController.js');

  test('sigue estando y la librería lo entiende', async () => {
    const src = fs.readFileSync(RUTA, 'utf8');
    const m = src.match(/DUMMY_BCRYPT_HASH\s*=\s*'([^']+)'/);

    if (!m) {
      throw new Error(
        'Desapareció DUMMY_BCRYPT_HASH de authController.js.\n\n' +
        'Sin esa comparación, una cuenta que no existe responde más rápido que ' +
        'una con la contraseña equivocada, y ese tiempo revela qué nombres de ' +
        'usuario son reales.'
      );
    }

    const hash = m[1];
    expect(hash).toHaveLength(60);
    // Lo importante no es que acepte nada — es que NO lance. Si la librería no
    // entendiera el formato, ese compare tiraría y el login devolvería 500 para
    // cualquier usuario inexistente.
    await expect(bcrypt.compare('cualquier cosa', hash)).resolves.toBe(false);
  });
});

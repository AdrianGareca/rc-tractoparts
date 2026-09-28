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

describe('el hash senuelo que iguala los tiempos de respuesta', () => {
  // authController compara contra un hash inventado cuando el usuario no
  // existe, para que una cuenta inexistente tarde lo mismo que una con la
  // contrasena equivocada. Sin eso, el tiempo de respuesta delata que nombres
  // de usuario son reales.
  //
  // ANTES ESTO VIGILABA UN LITERAL, Y NO ALCANZABA
  // El senuelo era una constante escrita a mano con costo 12. El costo va
  // grabado DENTRO del hash, asi que al bajar BCRYPT_ROUNDS a 10 los usuarios
  // reales pasaban a ~150 ms y el senuelo se quedaba en ~990 ms: un hueco de 6x
  // que reabria el canal de tiempos que este hash existe para cerrar. Medido en
  // el estres local del 2026-09-23. Ahora se calcula a partir de las rondas
  // configuradas, y lo que se vigila es exactamente eso.
  const ARCHIVO = path.resolve(__dirname, '../../src/controllers/authController.js');
  const fuente  = () => fs.readFileSync(ARCHIVO, 'utf8');

  test('sigue existiendo la comparacion contra el senuelo', () => {
    const usos = (fuente().match(/bcrypt\.compare\(password, dummyBcryptHash\(\)\)/g) || []).length;
    if (usos < 2) {
      throw new Error(
        'Falta la comparacion contra el hash senuelo en authController.js.\n\n' +
        'Sin ella, una cuenta que no existe responde mas rapido que una con la ' +
        'contrasena equivocada, y ese tiempo revela que nombres de usuario son reales.'
      );
    }
  });

  test('el senuelo se calcula con las MISMAS rondas que los hashes reales', () => {
    const src = fuente();
    expect(src).toMatch(/const ROUNDS = parseInt\(process\.env\.BCRYPT_ROUNDS, 10\)/);
    expect(src).toMatch(/bcrypt\.hashSync\([^)]*, ROUNDS\)/);
    // Volver a un literal fijo seria justamente la regresion que esto vigila.
    expect(src).not.toMatch(/DUMMY_BCRYPT_HASH\s*=\s*'\$2/);
  });

  test('un senuelo hecho asi es valido y la libreria lo entiende', async () => {
    // Lo importante no es que acepte algo: es que NO lance. Si la libreria no
    // entendiera el formato, ese compare tiraria y el login devolveria 500 para
    // cualquier usuario inexistente.
    const senuelo = bcrypt.hashSync('ninguna-cuenta-tiene-esta-contrasena', 10);
    expect(senuelo).toHaveLength(60);
    await expect(bcrypt.compare('cualquier cosa', senuelo)).resolves.toBe(false);
    expect(bcrypt.getRounds(senuelo)).toBe(10);
  });
});

describe('el re-hasheo al iniciar sesion', () => {
  // Cambiar BCRYPT_ROUNDS no toca las contrasenas YA guardadas: el costo va
  // grabado dentro del hash. Sin re-hasheo, bajar el valor no mejora nada para
  // quien ya tiene cuenta — medido: 10 personas entrando seguian tardando 5,6 s
  // con el servidor puesto en 10 rondas. Ver authController.login, paso 6.
  const ARCHIVO = path.resolve(__dirname, '../../src/controllers/authController.js');

  test('login migra el hash cuando el costo guardado no es el configurado', () => {
    const src = fs.readFileSync(ARCHIVO, 'utf8');
    expect(src).toMatch(/bcrypt\.getRounds\(storedHash\) !== ROUNDS/);
    expect(src).toMatch(/UserModel\.update\(user\.id, \{ password_hash: hashMigrado \}\)/);
  });

  test('un fallo al migrar NO puede tumbar el login', () => {
    const src = fs.readFileSync(ARCHIVO, 'utf8');
    const i = src.indexOf('bcrypt.getRounds(storedHash)');
    const bloque = src.slice(Math.max(0, i - 500), i + 600);
    expect(bloque).toMatch(/try \{/);
    expect(bloque).toMatch(/catch \(rehashErr\)/);
  });

  test('bcrypt.getRounds lee el costo de un hash real', async () => {
    const h10 = await bcrypt.hash('x', 10);
    const h12 = await bcrypt.hash('x', 12);
    expect(bcrypt.getRounds(h10)).toBe(10);
    expect(bcrypt.getRounds(h12)).toBe(12);
  });
});

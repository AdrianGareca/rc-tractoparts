// =============================================================================
// tests/unit/verificarEntorno.test.js
// La aplicación no debe arrancar con un secreto de sesión que no sirve.
//
// POR QUÉ EXISTE
// JWT_SECRET firma la sesión de cada persona. Si falta, el primer login revienta
// y alguien se entera. Si es DÉBIL, no pasa nada visible: la gente entra, trabaja,
// no hay error en los registros — y cualquiera que conozca ese valor se fabrica
// un token de Jefe.
//
// EL CASO QUE MOTIVA EL ARCHIVO
// El placeholder del .env.example es
// «replace_with_a_long_random_secret_at_least_64_chars»: 51 caracteres. Un
// control de «al menos 32» lo deja pasar. O sea que el chequeo obvio falla
// justo en el escenario más probable: alguien copió el ejemplo, cambió la base
// de datos y se olvidó del secreto. La prueba de más abajo fija ese caso con el
// texto literal.
// =============================================================================

'use strict';

const { revisarEntorno, informarEntorno, MINIMO_SECRETO } =
  require('../../src/config/verificarEntorno');

/** Un entorno válido, sobre el que cada prueba cambia una sola cosa. */
const entornoBueno = (over = {}) => ({
  JWT_SECRET:  'k7Qw2ZrT9vBn4XsL1yHc6MdE8fPa0GjU3iOx5RtY',   // 40, mezclado
  DB_USER:     'rc_app',
  DB_PASSWORD: 'una-contraseña-de-verdad-2026',
  DB_NAME:     'rc_tractoparts',
  NODE_ENV:    'production',
  BCRYPT_ROUNDS: '12',
  ...over,
});

const sinErrores = (env) => revisarEntorno(env).errores.length === 0;

describe('un entorno completo arranca', () => {
  test('no encuentra errores ni avisos', () => {
    const { errores, avisos } = revisarEntorno(entornoBueno());
    expect(errores).toEqual([]);
    expect(avisos).toEqual([]);
  });
});

describe('lo que falta impide arrancar', () => {
  test.each([
    ['JWT_SECRET'],
    ['DB_USER'],
    ['DB_PASSWORD'],
    ['DB_NAME'],
  ])('sin %s no arranca', (variable) => {
    const env = entornoBueno();
    delete env[variable];

    const { errores } = revisarEntorno(env);
    expect(errores.length).toBeGreaterThan(0);
    expect(errores.join(' ')).toContain(variable);
  });

  test.each([
    ['vacío',           ''],
    ['sólo espacios',   '   '],
  ])('un JWT_SECRET %s tampoco', (_nombre, valor) => {
    expect(sinErrores(entornoBueno({ JWT_SECRET: valor }))).toBe(false);
  });
});

describe('el secreto de ejemplo NO pasa, aunque sea largo', () => {
  // EL CASO CENTRAL de este archivo.
  const DEL_EJEMPLO = 'replace_with_a_long_random_secret_at_least_64_chars';

  test('el placeholder del .env.example mide más que el mínimo', () => {
    // Se afirma para dejar constancia de POR QUÉ el largo no alcanza como
    // control: si mañana el placeholder se acorta, esta prueba avisa que el
    // razonamiento del archivo cambió.
    expect(DEL_EJEMPLO.length).toBeGreaterThan(MINIMO_SECRETO);
  });

  test('y aun así se rechaza', () => {
    const { errores } = revisarEntorno(entornoBueno({ JWT_SECRET: DEL_EJEMPLO }));

    if (errores.length === 0) {
      throw new Error(
        'El secreto de ejemplo del .env.example pasó la revisión.\n\n' +
        `Mide ${DEL_EJEMPLO.length} caracteres, así que un control de largo no lo ` +
        'detiene. Ese valor está escrito en el repositorio: lo conoce cualquiera ' +
        'que vea el código, y con él se fabrica un token de Jefe.'
      );
    }
    expect(errores.join(' ')).toMatch(/ejemplo/i);
  });

  test.each([
    ['change_me_please_this_is_long_enough_to_pass'],
    ['CHANGEME-with-a-lot-of-extra-characters-here'],
    ['your_secret_key_goes_right_here_and_is_long'],
    ['placeholder-value-that-is-quite-long-indeed'],
    ['replace_with_a_long_random_secret_SUFIJO'],
  ])('«%s» se rechaza', (secreto) => {
    // Todos superan el mínimo de largo: lo que los delata es el CONTENIDO.
    expect(secreto.length).toBeGreaterThanOrEqual(MINIMO_SECRETO);
    expect(sinErrores(entornoBueno({ JWT_SECRET: secreto }))).toBe(false);
  });

  test('la contraseña de la base de ejemplo también se rechaza', () => {
    expect(sinErrores(entornoBueno({ DB_PASSWORD: 'change_me_use_a_strong_db_password' }))).toBe(false);
  });
});

describe('el secreto corto no pasa', () => {
  test.each([
    ['secret'],
    ['rc-tractoparts'],
    ['abc123'],
    ['x'.repeat(MINIMO_SECRETO - 1)],
  ])('«%s» es demasiado corto', (secreto) => {
    const { errores } = revisarEntorno(entornoBueno({ JWT_SECRET: secreto }));
    expect(errores.length).toBeGreaterThan(0);
  });

  test(`exactamente ${MINIMO_SECRETO} caracteres sí pasa`, () => {
    // El límite se comprueba en los dos sentidos: si sólo se probara «corto
    // falla», un control mal escrito con > en vez de >= pasaría igual.
    const justo = 'aB3$'.repeat(MINIMO_SECRETO / 4).slice(0, MINIMO_SECRETO);
    expect(justo).toHaveLength(MINIMO_SECRETO);
    expect(sinErrores(entornoBueno({ JWT_SECRET: justo }))).toBe(true);
  });
});

describe('los avisos no impiden arrancar', () => {
  test('BCRYPT_ROUNDS bajo avisa pero deja pasar', () => {
    const { errores, avisos } = revisarEntorno(entornoBueno({ BCRYPT_ROUNDS: '6' }));
    expect(errores).toEqual([]);
    expect(avisos.join(' ')).toContain('BCRYPT_ROUNDS');
  });

  test('sin NODE_ENV avisa pero deja pasar', () => {
    const env = entornoBueno();
    delete env.NODE_ENV;

    const { errores, avisos } = revisarEntorno(env);
    expect(errores).toEqual([]);
    expect(avisos.join(' ')).toContain('NODE_ENV');
  });

  test('un secreto de una sola clase de caracteres avisa', () => {
    const { errores, avisos } = revisarEntorno(
      entornoBueno({ JWT_SECRET: 'abcdefghijklmnopqrstuvwxyzabcdefghij' })
    );
    expect(errores).toEqual([]);
    expect(avisos.length).toBeGreaterThan(0);
  });
});

describe('informarEntorno decide si se arranca', () => {
  const logFalso = () => {
    const lineas = { warn: [], error: [] };
    return {
      registro: lineas,
      log: { warn: (m) => lineas.warn.push(m), error: (m) => lineas.error.push(m) },
    };
  };

  test('sin errores devuelve true', () => {
    const { log } = logFalso();
    expect(informarEntorno({ errores: [], avisos: [] }, log)).toBe(true);
  });

  test('con errores devuelve false y los enumera', () => {
    const { registro, log } = logFalso();
    const ok = informarEntorno({ errores: ['Falta JWT_SECRET — x.'], avisos: [] }, log);

    expect(ok).toBe(false);
    expect(registro.error.join('\n')).toContain('Falta JWT_SECRET');
  });

  test('dice CÓMO generar un secreto nuevo', () => {
    // Un error que sólo dice «está mal» obliga a buscar en internet cómo se
    // arregla. El mensaje trae el comando listo para copiar.
    const { registro, log } = logFalso();
    informarEntorno({ errores: ['x'], avisos: [] }, log);
    expect(registro.error.join('\n')).toContain('randomBytes');
  });

  test('los avisos se imprimen aunque todo esté bien', () => {
    const { registro, log } = logFalso();
    informarEntorno({ errores: [], avisos: ['algo menor'] }, log);
    expect(registro.warn.join('\n')).toContain('algo menor');
  });
});

describe('el entorno REAL de esta máquina', () => {
  test('pasa la revisión', () => {
    // No es una prueba del módulo: es una prueba de que el .env con el que se
    // trabaja acá sirve. Si esto falla, el servidor tampoco arrancaría.
    require('dotenv').config();
    const { errores } = revisarEntorno(process.env);

    if (errores.length) {
      throw new Error(
        'El .env de esta máquina no pasaría la revisión de arranque:\n  ' +
        errores.join('\n  ')
      );
    }
  });
});

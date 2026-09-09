// =============================================================================
// tests/unit/fechaLocal.test.js
// Las fechas se leen con el reloj de acá, no con el de Greenwich.
//
// POR QUÉ EXISTE
// Bolivia es UTC−4 todo el año, así que entre las 20:00 y la medianoche el día
// en UTC ya es el siguiente. `toISOString().slice(0,10)` —la forma corta y
// obvia— devuelve mañana durante cuatro horas de cada día, sin error y sólo
// para quien trabaje de noche.
//
// Este proyecto ya tropezó con eso tres veces: el bloqueo por intentos
// fallidos, el filtro de fechas de cotizaciones, y el aviso de seguimientos
// del día. Las pruebas de abajo fijan la hora del sistema a las 21:00 de
// Bolivia para que la diferencia sea visible en vez de teórica.
// =============================================================================

'use strict';

const { ymd, parseYmd, hoyYmd } = require('../../public/js/shared/fechaLocal.js');

describe('ymd — la fecha que ve el usuario', () => {
  test.each([
    ['2026-09-08', 2026, 8,  8],
    ['2026-01-01', 2026, 0,  1],
    ['2026-12-31', 2026, 11, 31],
    ['2026-02-29', 2026, 1,  29],   // 2026 no es bisiesto: cae en el 1 de marzo
  ])('%s', (_esperado, anio, mes, dia) => {
    const d = new Date(anio, mes, dia);
    expect(ymd(d)).toBe(
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    );
  });

  test('rellena con cero el mes y el día de una cifra', () => {
    expect(ymd(new Date(2026, 2, 5))).toBe('2026-03-05');
  });
});

describe('la diferencia con toISOString, medida', () => {
  // 8 de septiembre de 2026, 21:00 en Bolivia (UTC−4) = 9 de septiembre 01:00 UTC.
  const NOCHE_EN_BOLIVIA = new Date(Date.UTC(2026, 8, 9, 1, 0, 0));

  test('a las 21:00 de Bolivia, toISOString ya dice mañana', () => {
    // La prueba de que el problema es real y no una precaución teórica.
    expect(NOCHE_EN_BOLIVIA.toISOString().slice(0, 10)).toBe('2026-09-09');
  });

  test('ymd devuelve el día que muestra el reloj de la pantalla', () => {
    // Se compara contra los getters locales, que es lo que ve el usuario.
    // (El resultado exacto depende de la zona donde corran las pruebas; lo que
    //  se afirma es que ymd sigue al reloj local y toISOString no.)
    const local = `${NOCHE_EN_BOLIVIA.getFullYear()}-` +
                  `${String(NOCHE_EN_BOLIVIA.getMonth() + 1).padStart(2, '0')}-` +
                  `${String(NOCHE_EN_BOLIVIA.getDate()).padStart(2, '0')}`;
    expect(ymd(NOCHE_EN_BOLIVIA)).toBe(local);
  });
});

describe('parseYmd — leer una fecha sin perder un día', () => {
  test('«2026-09-08» es el 8 de septiembre, no el 7', () => {
    const d = parseYmd('2026-09-08');
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(8);        // 0-indexado: 8 = septiembre
    expect(d.getDate()).toBe(8);
  });

  test('new Date() a secas es lo que NO hay que usar', () => {
    // Documenta el motivo por el que parseYmd existe. En cualquier zona al
    // oeste de Greenwich, new Date('YYYY-MM-DD') cae en el día anterior.
    const conParse = parseYmd('2026-09-08');
    const crudo    = new Date('2026-09-08');
    const desfase  = crudo.getTimezoneOffset();   // minutos; positivo al oeste

    if (desfase > 0) {
      expect(crudo.getDate()).not.toBe(conParse.getDate());
    } else {
      expect(crudo.getDate()).toBe(conParse.getDate());
    }
  });

  test('ida y vuelta: ymd(parseYmd(x)) devuelve x', () => {
    for (const s of ['2026-01-01', '2026-06-15', '2026-12-31', '2027-03-09']) {
      expect(ymd(parseYmd(s))).toBe(s);
    }
  });
});

describe('hoyYmd', () => {
  test('tiene el formato de fecha y coincide con el reloj local', () => {
    const hoy = hoyYmd();
    expect(hoy).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(hoy).toBe(ymd(new Date()));
  });
});

// =============================================================================
// EL TRINQUETE
// =============================================================================
describe('la fecha de hoy no vuelve a sacarse de UTC', () => {
  // Mismo criterio que los otros trinquetes del proyecto: puede bajar, nunca
  // subir. Está en CERO, así que la primera reaparición lo pone en rojo.
  //
  // Se vigila `new Date().toISOString()` seguido de un recorte — es decir,
  // «la fecha de AHORA» — y no toISOString() en general: guardar una marca de
  // tiempo completa en UTC está bien y es lo que hace autosaveDraft.js.
  const TOPE = 0;

  const fs   = require('fs');
  const path = require('path');
  const RAIZ = path.resolve(__dirname, '../../public/js');

  const listarJs = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    return e.isDirectory() ? listarJs(full) : (e.name.endsWith('.js') ? [full] : []);
  });

  const rel = (p) => path.relative(RAIZ, p).split(path.sep).join('/');

  const buscar = () => {
    const hallados = [];
    for (const f of listarJs(RAIZ)) {
      // El propio módulo se saltea: ahí la expresión aparece en el comentario
      // que explica por qué no hay que usarla.
      if (rel(f) === 'shared/fechaLocal.js') continue;

      fs.readFileSync(f, 'utf8').split(String.fromCharCode(10)).forEach((linea, i) => {
        const t = linea.trim();
        if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) return;
        if (/new Date\(\s*\)\.toISOString\(\s*\)\.(slice|substring|split)/.test(t)) {
          hallados.push(`${rel(f)}:${i + 1}`);
        }
      });
    }
    return hallados;
  };

  test(`no hay más de ${TOPE} fechas de hoy sacadas de UTC`, () => {
    const hallados = buscar();

    if (hallados.length > TOPE) {
      throw new Error(
        `«new Date().toISOString().slice(...)» aparece en:\n  ${hallados.join('\n  ')}\n\n` +
        'Bolivia es UTC−4: entre las 20:00 y la medianoche eso devuelve la fecha ' +
        'de MAÑANA, sin error y sólo para quien trabaje de noche.\n\n' +
        "Usá hoyYmd() de public/js/shared/fechaLocal.js."
      );
    }
    expect(hallados.length).toBeLessThanOrEqual(TOPE);
  });

  test('el buscador busca algo', () => {
    // Sin esto, un error en la expresión regular dejaría el trinquete siempre
    // en verde y nadie se enteraría — el mismo problema que un comparador vacío.
    const linea = "const hoy = new Date().toISOString().slice(0, 10);";
    expect(/new Date\(\s*\)\.toISOString\(\s*\)\.(slice|substring|split)/.test(linea)).toBe(true);
  });
});

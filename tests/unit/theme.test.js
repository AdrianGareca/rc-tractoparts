// =============================================================================
// tests/unit/theme.test.js
// Red de seguridad del selector de tema claro / oscuro.
//
// Dos cosas se rompen fácil acá y las dos son invisibles hasta que un usuario
// se queja:
//   1. El modo 'auto' NO debe escribir data-theme. Si escribiera
//      data-theme="auto", ninguna regla del CSS lo matchearía y la preferencia
//      del sistema dejaría de funcionar en silencio.
//   2. theme-boot.js duplica la lógica a propósito (corre antes que todo lo
//      demás, sin módulos). Si las claves se desincronizan, vuelve el flash del
//      tema equivocado al cargar. Acá se verifica que sigan coincidiendo.
// =============================================================================

'use strict';

import {
  THEME_KEY,
  THEME_MODES,
  getThemeMode,
  applyTheme,
  cycleTheme,
  resolvedTheme,
  themeButtonLabel,
  initTheme,
} from '../../public/js/services/theme.js';

/** <html> falso que registra el atributo. */
function fakeDoc() {
  const attrs = {};
  return {
    attrs,
    documentElement: {
      setAttribute: (k, v) => { attrs[k] = v; },
      removeAttribute: (k) => { delete attrs[k]; },
      getAttribute: (k) => attrs[k] ?? null,
    },
  };
}

/** localStorage falso, instalado como global. */
function installStorage(inicial = {}) {
  const store = { ...inicial };
  global.localStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
  };
  return store;
}

describe('getThemeMode', () => {
  test('sin nada guardado devuelve auto', () => {
    installStorage();
    expect(getThemeMode()).toBe('auto');
  });

  test('devuelve el modo guardado', () => {
    installStorage({ [THEME_KEY]: 'light' });
    expect(getThemeMode()).toBe('light');
  });

  test('un valor basura cae a auto', () => {
    installStorage({ [THEME_KEY]: 'neon' });
    expect(getThemeMode()).toBe('auto');
  });

  test('si localStorage falla, cae a auto sin lanzar', () => {
    global.localStorage = {
      getItem: () => { throw new Error('modo privado'); },
      setItem: () => {},
    };
    expect(() => getThemeMode()).not.toThrow();
    expect(getThemeMode()).toBe('auto');
  });
});

describe('applyTheme', () => {
  test('light y dark escriben el atributo', () => {
    installStorage();
    const doc = fakeDoc();

    applyTheme('light', doc);
    expect(doc.attrs['data-theme']).toBe('light');

    applyTheme('dark', doc);
    expect(doc.attrs['data-theme']).toBe('dark');
  });

  test('auto QUITA el atributo en vez de escribir "auto"', () => {
    // Con data-theme="auto" ninguna regla del CSS matchearía y se perdería la
    // preferencia del sistema.
    installStorage();
    const doc = fakeDoc();

    applyTheme('dark', doc);
    applyTheme('auto', doc);

    expect(doc.attrs['data-theme']).toBeUndefined();
  });

  test('persiste la elección', () => {
    const store = installStorage();
    applyTheme('light', fakeDoc());
    expect(store[THEME_KEY]).toBe('light');
  });

  test('un modo inválido cae a auto', () => {
    installStorage();
    const doc = fakeDoc();
    expect(applyTheme('arcoiris', doc)).toBe('auto');
    expect(doc.attrs['data-theme']).toBeUndefined();
  });

  test('si no se puede persistir, igual aplica el tema', () => {
    global.localStorage = {
      getItem: () => null,
      setItem: () => { throw new Error('cuota excedida'); },
    };
    const doc = fakeDoc();

    expect(() => applyTheme('light', doc)).not.toThrow();
    expect(doc.attrs['data-theme']).toBe('light');
  });
});

describe('cycleTheme', () => {
  test('rota auto → light → dark → auto', () => {
    installStorage();
    const doc = fakeDoc();

    expect(cycleTheme(doc)).toBe('light');
    expect(cycleTheme(doc)).toBe('dark');
    expect(cycleTheme(doc)).toBe('auto');
  });

  test('el ciclo vuelve al punto de partida en 3 pasos', () => {
    installStorage({ [THEME_KEY]: 'dark' });
    const doc = fakeDoc();

    cycleTheme(doc); cycleTheme(doc); cycleTheme(doc);

    expect(getThemeMode()).toBe('dark');
  });
});

describe('resolvedTheme', () => {
  const win = (esClaro) => ({ matchMedia: () => ({ matches: esClaro }) });

  test('un modo explícito se devuelve tal cual', () => {
    expect(resolvedTheme('light', win(false))).toBe('light');
    expect(resolvedTheme('dark', win(true))).toBe('dark');
  });

  test('auto consulta la preferencia del sistema', () => {
    expect(resolvedTheme('auto', win(true))).toBe('light');
    expect(resolvedTheme('auto', win(false))).toBe('dark');
  });

  test('sin matchMedia cae a oscuro', () => {
    expect(resolvedTheme('auto', {})).toBe('dark');
  });
});

describe('themeButtonLabel', () => {
  test.each(THEME_MODES)('%s tiene icono y etiqueta', (mode) => {
    const { icon, label } = themeButtonLabel(mode);
    expect(icon).toBeTruthy();
    expect(label).toMatch(/Tema/);
  });

  test('un modo desconocido no rompe el botón', () => {
    expect(themeButtonLabel('inexistente').icon).toBeTruthy();
  });
});

describe('initTheme', () => {
  test('aplica el modo guardado al arrancar', () => {
    installStorage({ [THEME_KEY]: 'light' });
    const doc = fakeDoc();

    expect(initTheme(doc)).toBe('light');
    expect(doc.attrs['data-theme']).toBe('light');
  });
});

describe('sincronía con theme-boot.js', () => {
  const fs = require('fs');
  const path = require('path');
  const boot = fs.readFileSync(
    path.resolve(__dirname, '../../public/js/theme-boot.js'), 'utf8');

  test('usa la MISMA clave de localStorage', () => {
    // theme-boot.js corre antes que los módulos y no puede importar: duplica la
    // clave a mano. Si se desincronizan, vuelve el flash del tema equivocado.
    expect(boot).toContain(`'${THEME_KEY}'`);
  });

  test('sólo escribe el atributo para light y dark, nunca para auto', () => {
    expect(boot).toContain("=== 'light'");
    expect(boot).toContain("=== 'dark'");
    expect(boot).not.toMatch(/setAttribute\([^)]*'auto'/);
  });

  test('NO es un módulo ES: debe correr antes del primer pintado', () => {
    expect(boot).not.toMatch(/^\s*(import|export)\s/m);
  });

  test('tolera que localStorage falle', () => {
    expect(boot).toMatch(/try\s*\{[\s\S]*catch/);
  });
});

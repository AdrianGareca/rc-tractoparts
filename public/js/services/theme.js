// =============================================================================
// public/js/services/theme.js
// Tema claro / oscuro.
//
// Tres estados posibles, no dos:
//   'auto'  — seguir la preferencia del sistema operativo (por defecto)
//   'dark'  — forzado oscuro
//   'light' — forzado claro
//
// 'auto' importa: si sólo hubiera dos opciones, un usuario que tiene el sistema
// en claro y entra por primera vez vería la app oscura sin entender por qué, y
// alguien que alterna entre día y noche tendría que cambiarlo a mano.
//
// La resolución vive en el CSS (tokens.css): acá sólo se escribe el atributo
// data-theme en <html> y se persiste la elección.
//
// Cubierto por tests/unit/theme.test.js.
// =============================================================================

/** Clave de localStorage. */
export const THEME_KEY = 'rc_theme';

/** Los tres modos válidos, en el orden en que rota el botón. */
export const THEME_MODES = ['auto', 'light', 'dark'];

/**
 * Modo guardado, o 'auto' si no hay nada (o hay basura) almacenado.
 * @returns {'auto'|'light'|'dark'}
 */
export function getThemeMode() {
  try {
    const saved = localStorage.getItem(THEME_KEY);
    return THEME_MODES.includes(saved) ? saved : 'auto';
  } catch {
    // localStorage puede fallar en modo privado o con cookies bloqueadas: el
    // tema es una preferencia, nunca debe impedir que la app cargue.
    return 'auto';
  }
}

/**
 * Aplica un modo al documento y lo guarda.
 *
 * En 'auto' se QUITA el atributo en vez de escribir un valor: así manda la
 * media query prefers-color-scheme del CSS. Escribir data-theme="auto" dejaría
 * al documento sin ninguna regla que lo matchee.
 *
 * @param {'auto'|'light'|'dark'} mode
 * @param {Document} [doc] — inyectable para los tests
 * @returns {string} el modo efectivamente aplicado
 */
export function applyTheme(mode, doc = document) {
  const safe = THEME_MODES.includes(mode) ? mode : 'auto';

  if (safe === 'auto') doc.documentElement.removeAttribute('data-theme');
  else                 doc.documentElement.setAttribute('data-theme', safe);

  try {
    localStorage.setItem(THEME_KEY, safe);
  } catch { /* preferencia no persistible — la sesión actual igual funciona */ }

  return safe;
}

/**
 * Rota al siguiente modo del ciclo auto → light → dark → auto.
 * @returns {string} el nuevo modo
 */
export function cycleTheme(doc = document) {
  const actual = getThemeMode();
  const siguiente = THEME_MODES[(THEME_MODES.indexOf(actual) + 1) % THEME_MODES.length];
  return applyTheme(siguiente, doc);
}

/**
 * Qué tema se ve realmente en pantalla (resuelve 'auto' contra el sistema).
 * @returns {'light'|'dark'}
 */
export function resolvedTheme(mode = getThemeMode(), win = window) {
  if (mode !== 'auto') return mode;
  return win.matchMedia?.('(prefers-color-scheme: light)')?.matches ? 'light' : 'dark';
}

/** Icono y etiqueta del botón, según el modo elegido. */
export function themeButtonLabel(mode = getThemeMode()) {
  return {
    auto:  { icon: '🌗', label: 'Tema: automático (según el sistema)' },
    light: { icon: '☀️', label: 'Tema: claro' },
    dark:  { icon: '🌙', label: 'Tema: oscuro' },
  }[mode] ?? { icon: '🌗', label: 'Tema: automático' };
}

/**
 * Aplica el tema guardado. Se llama al arrancar cada página.
 * @returns {string} el modo aplicado
 */
export function initTheme(doc = document) {
  return applyTheme(getThemeMode(), doc);
}

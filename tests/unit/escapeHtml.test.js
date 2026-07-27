// =============================================================================
// tests/unit/escapeHtml.test.js
// Red de seguridad del escapador HTML — la única defensa contra XSS almacenado
// del frontend.
//
// Todo el markup se arma con innerHTML e interpolación de strings, así que esta
// función es literalmente lo que separa un nombre de cliente de un <script>
// ejecutándose en la sesión de otro usuario.
//
// Verifica además que los dos nombres históricos (escHtml en el dashboard,
// escText en el formulario) apunten a la MISMA implementación: eran copias
// separadas, y un refuerzo aplicado a una sola habría dejado la otra expuesta.
// =============================================================================

'use strict';

import { escapeHtml } from '../../public/js/shared/escapeHtml.js';
import { escHtml }    from '../../public/js/views/dashboard/helpers.js';
import { escText }    from '../../public/js/views/quotationForm/helpers.js';

describe('escapeHtml — los cinco caracteres peligrosos', () => {
  test.each([
    ['&', '&amp;'],
    ['<', '&lt;'],
    ['>', '&gt;'],
    ['"', '&quot;'],
    ["'", '&#39;'],
  ])('escapa %s', (entrada, esperado) => {
    expect(escapeHtml(entrada)).toBe(esperado);
  });
});

describe('escapeHtml — vectores de ataque reales', () => {
  test('neutraliza una etiqueta script', () => {
    expect(escapeHtml('<script>alert(document.cookie)</script>'))
      .toBe('&lt;script&gt;alert(document.cookie)&lt;/script&gt;');
  });

  test('neutraliza un manejador onerror en una imagen', () => {
    const out = escapeHtml('<img src=x onerror=alert(1)>');
    expect(out).not.toContain('<img');
    expect(out).not.toContain('>');
  });

  test('neutraliza el escape de un atributo entre comillas dobles', () => {
    // value="<AQUI>" — cerrar la comilla permitiría inyectar onfocus=…
    const out = escapeHtml('" onfocus="alert(1)');
    expect(out).not.toContain('"');
    expect(out).toBe('&quot; onfocus=&quot;alert(1)');
  });

  test('neutraliza el escape de un atributo entre comillas simples', () => {
    expect(escapeHtml("' onmouseover='alert(1)")).not.toContain("'");
  });

  test('neutraliza el cierre de una etiqueta', () => {
    expect(escapeHtml('</textarea><script>alert(1)</script>')).not.toContain('<');
  });
});

describe('escapeHtml — el ampersand va primero', () => {
  test('no re-escapa los & que introducen los otros reemplazos', () => {
    // Si < se escapara antes que &, el &lt; resultante se convertiría en
    // &amp;lt; y el texto saldría roto en pantalla.
    expect(escapeHtml('<')).toBe('&lt;');
  });

  test('un & literal del usuario se escapa una sola vez', () => {
    expect(escapeHtml('Repuestos & Servicios')).toBe('Repuestos &amp; Servicios');
  });

  test('una entidad ya escapada se vuelve a escapar (es texto, no markup)', () => {
    expect(escapeHtml('&lt;b&gt;')).toBe('&amp;lt;b&amp;gt;');
  });
});

describe('escapeHtml — entradas no string', () => {
  test('null y undefined dan string vacío', () => {
    expect(escapeHtml(null)).toBe('');
    expect(escapeHtml(undefined)).toBe('');
  });

  test('los números se convierten, incluido el 0', () => {
    expect(escapeHtml(0)).toBe('0');
    expect(escapeHtml(42)).toBe('42');
  });

  test('false se convierte (no se confunde con ausente)', () => {
    expect(escapeHtml(false)).toBe('false');
  });

  test('el texto inofensivo pasa intacto', () => {
    expect(escapeHtml('Minera San Cristóbal S.A.')).toBe('Minera San Cristóbal S.A.');
  });
});

describe('una sola implementación para los dos nombres históricos', () => {
  test('escHtml y escText son la MISMA función', () => {
    expect(escHtml).toBe(escapeHtml);
    expect(escText).toBe(escapeHtml);
  });

  test('los tres nombres dan el mismo resultado', () => {
    const payload = '<img src=x onerror=alert(1)>&"\'';
    expect(escHtml(payload)).toBe(escapeHtml(payload));
    expect(escText(payload)).toBe(escapeHtml(payload));
  });
});

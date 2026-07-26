// =============================================================================
// tests/unit/badgeHtmlEscape.test.js
// Bug 5.4 — badgeHtml() and roleBadgeHtml() interpolated their text into
// innerHTML WITHOUT escHtml(), unlike their sibling licitacionBadgeHtml().
// Today estado/rol come from a fixed enum so it is not exploitable, but it is a
// defense-in-depth gap: any future free-text state/role turns it into stored XSS.
// These tests pin the escaping.
// =============================================================================

import { badgeHtml, roleBadgeHtml, licitacionBadgeHtml } from '../../public/js/views/dashboard/helpers.js';

describe('badge helpers escape their text content', () => {
  test('badgeHtml escapes an unknown/hostile estado', () => {
    const html = badgeHtml('<img src=x onerror=alert(1)>');
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
  });

  test('roleBadgeHtml escapes an unknown/hostile rol', () => {
    const html = roleBadgeHtml('<script>alert(1)</script>');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  test('known values still render inside a span with the mapped class', () => {
    expect(badgeHtml('Pendiente')).toBe('<span class="badge badge-pendiente">Pendiente</span>');
    expect(roleBadgeHtml('Jefe')).toBe('<span class="badge badge-role-jefe">Jefe</span>');
  });

  test('consistent with licitacionBadgeHtml (which already escaped)', () => {
    expect(licitacionBadgeHtml('<b>x</b>')).toContain('&lt;b&gt;');
  });
});

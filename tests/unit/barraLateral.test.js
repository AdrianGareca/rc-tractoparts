/**
 * @jest-environment jsdom
 */
// =============================================================================
// tests/unit/barraLateral.test.js
// El menú lateral: qué ve cada rol.
//
// POR QUÉ ESTA PRUEBA NO EXISTÍA ANTES
// Las cuatro plantillas del menú vivían dentro de `_renderSidebar`, un método
// de una clase que el archivo NO exporta (`class DashboardController` a secas).
// Para probar el menú había que montar el dashboard entero — así que nadie lo
// probaba. Al sacar las plantillas a `enlacesDeBarraLateral(role)`, que es una
// función pura (entra un rol, sale un string), se puede verificar sola.
//
// QUÉ SE PROTEGE ACÁ
// Que cada rol vea SUS secciones y no las de otro. Es control de acceso visible:
// el permiso real lo aplica el backend, pero un menú que le ofrece "Gestión de
// usuarios" a un Ejecutivo lo manda a chocarse contra un 403, y uno que se la
// esconde al Jefe le rompe el trabajo. El caso de SysAdmin tiene además un bug
// propio en la historia del archivo: la condición leía `role === 'Jefe'` a
// secas, así que un SysAdmin caía en el menú de Ejecutivo y no tenía forma de
// llegar a ninguna pestaña de gestión.
// =============================================================================

'use strict';

jest.mock('../../public/js/services/apiClient.js', () => ({
  __esModule: true,
  default: { get: jest.fn() },
  showToast: jest.fn(),
}));

// dashboardView.js arranca el dashboard al importarse (`new
// DashboardController().init()` al final del archivo). `isAuthenticated: false`
// hace que init() corte en su primera guarda y no monte nada — lo único que se
// quiere de este módulo es la función pura de abajo.
jest.mock('../../public/js/services/authSession.js', () => ({
  __esModule: true,
  default: {
    isAuthenticated: () => false,
    getRole:      () => 'Jefe',
    getUser:      () => ({ id: 1 }),
    clearSession: jest.fn(),
  },
}));

import { enlacesDeBarraLateral } from '../../public/js/views/dashboardView.js';

/** Los `data-section` que ofrece el menú de ese rol. */
function seccionesDe(role) {
  const nav = document.createElement('nav');
  nav.innerHTML = enlacesDeBarraLateral(role);
  return [...nav.querySelectorAll('[data-section]')].map((b) => b.dataset.section);
}

function idsDe(role) {
  const nav = document.createElement('nav');
  nav.innerHTML = enlacesDeBarraLateral(role);
  return [...nav.querySelectorAll('[id]')].map((b) => b.id);
}

describe('barra lateral — cada rol ve lo suyo', () => {
  test.each([
    ['Jefe',           ['approvals', 'quotations', 'users', 'audit']],
    ['SysAdmin',       ['approvals', 'quotations', 'users', 'audit']],
    ['Administracion', ['review', 'quotations', 'users', 'audit']],
    ['Proyectos',      ['licitaciones', 'clientes']],
    ['Ejecutivo',      ['quotations', 'new']],
  ])('%s ve exactamente %p', (role, esperadas) => {
    expect(seccionesDe(role)).toEqual(esperadas);
  });

  test('SysAdmin ve el mismo menú que Jefe, no el de Ejecutivo', () => {
    // El bug que ya pasó: la condición leía `role === 'Jefe'` a secas y el
    // SysAdmin caía en el `else` final, sin acceso a ninguna pestaña de gestión.
    expect(enlacesDeBarraLateral('SysAdmin')).toBe(enlacesDeBarraLateral('Jefe'));
  });

  test('un rol desconocido cae en el menú mínimo, nunca en uno de gestión', () => {
    // Defensa en profundidad: si mañana aparece un rol nuevo y nadie toca esta
    // función, que no herede por accidente la gestión de usuarios.
    const secciones = seccionesDe('RolQueNoExiste');
    expect(secciones).not.toContain('users');
    expect(secciones).not.toContain('audit');
  });

  test.each(['Jefe', 'SysAdmin', 'Administracion', 'Proyectos', 'Ejecutivo'])(
    '%s siempre tiene por dónde cerrar sesión',
    (role) => {
      expect(idsDe(role)).toContain('btn-logout-sidebar');
    }
  );

  test('la Documentación API es sólo para Jefe y SysAdmin', () => {
    // Es el enlace que abre Swagger con un token de vida corta; el endpoint que
    // emite ese token también está restringido a esos dos roles.
    expect(idsDe('Jefe')).toContain('sidebar-api-docs');
    expect(idsDe('SysAdmin')).toContain('sidebar-api-docs');

    for (const role of ['Administracion', 'Proyectos', 'Ejecutivo']) {
      expect(idsDe(role)).not.toContain('sidebar-api-docs');
    }
  });

  test('el menú de cada rol arranca con una sección ya marcada como activa', () => {
    // Sin esto, el panel se dibuja pero ningún botón se ve seleccionado y la
    // pantalla parece a medio cargar.
    for (const role of ['Jefe', 'SysAdmin', 'Administracion', 'Proyectos', 'Ejecutivo']) {
      const nav = document.createElement('nav');
      nav.innerHTML = enlacesDeBarraLateral(role);
      expect(nav.querySelectorAll('.sidebar-link.active')).toHaveLength(1);
    }
  });
});

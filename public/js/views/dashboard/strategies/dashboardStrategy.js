// =============================================================================
// public/js/views/dashboard/strategies/dashboardStrategy.js
// STRATEGY PATTERN — abstract interface implemented by ExecutiveStrategy,
// ManagerStrategy, and AdminStrategy.
//
//   DashboardStrategy  (abstract interface)
//     ├─ ExecutiveStrategy  — Ejecutivo
//     ├─ ManagerStrategy    — Jefe / SysAdmin
//     └─ AdminStrategy      — Administracion
//
// Extracted verbatim from dashboardView.js as part of the file-size cleanup
// — no behavioral change.
// =============================================================================

export class DashboardStrategy {
  /** @param {HTMLElement} container */
  // eslint-disable-next-line no-unused-vars
  async render(container) {
    throw new Error('DashboardStrategy.render() must be implemented.');
  }

  /** Called after a mutation to reload the current view */
  async refresh() {}
}

/**
 * Engancha la barra de pestañas de un tablero.
 *
 * POR QUÉ ES UNA FUNCIÓN SUELTA Y NO UN MÉTODO DE LA CLASE
 * Estaba escrita IGUAL en las tres estrategias que tienen pestañas —Jefe,
 * Administración y Proyectos—, así que el lugar obvio parecía la clase base.
 * Pero las tres guardan la pestaña activa en `#activeTab`, un campo PRIVADO:
 * desde la clase base no se puede escribir, y volverlo público sólo para poder
 * compartir seis líneas sería aflojar el encapsulamiento por comodidad.
 *
 * Con un callback cada estrategia sigue siendo dueña de su propio estado, y lo
 * único que se comparte es lo que de verdad era idéntico: apagar la anterior,
 * encender la nueva, avisar.
 *
 * @param {HTMLElement} container    — dónde están los .tab-btn
 * @param {Function}    onTabChange  — (nombreDePestaña) => void
 */
export function wireTabs(container, onTabChange) {
  const botones = container.querySelectorAll('.tab-btn');

  botones.forEach((btn) => {
    btn.addEventListener('click', () => {
      // Se apagan TODAS y después se enciende la elegida, en vez de apagar sólo
      // la que estaba activa. Es un recorrido de más sobre cuatro botones, y a
      // cambio el estado no puede quedar con dos encendidas si algo externo
      // tocó las clases.
      botones.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');

      // El nombre viaja en data-tab. La estrategia decide qué hacer con él:
      // guardarlo en su campo privado y redibujar su panel.
      onTabChange(btn.dataset.tab);
    });
  });
}

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

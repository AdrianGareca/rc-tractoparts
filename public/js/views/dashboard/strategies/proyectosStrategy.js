// =============================================================================
// public/js/views/dashboard/strategies/proyectosStrategy.js
// STRATEGY: ProyectosStrategy (Proyectos role — tenders/licitaciones executive)
//
// Tabs: Licitaciones (default) + Gestión de clientes.
// Proyectos NEVER creates cotizaciones — there is no "Nueva cotización" action
// anywhere in this strategy. They build the licitación, hand it to the
// commercial executive (moving it to 'Cotizando'), and track the contest.
//
// Mirrors the AdminStrategy tab/_renderPanel shape so DashboardController's
// sidebar dispatch (which calls strategy._renderPanel(section)) works uniformly.
// =============================================================================

import { mountClientsTab }        from '../modules/clientsView.js';
import { mountLicitacionesTab }   from '../modules/licitacionesView.js';
import { DashboardStrategy, wireTabs } from './dashboardStrategy.js';

export class ProyectosStrategy extends DashboardStrategy {
  #container;
  #user;
  #activeTab = 'licitaciones';
  // La limpieza del panel montado, para llamarla ANTES de montar el
  // siguiente. Sin esto cada cambio de pestana dejaba dos escuchas
  // huerfanas en document (las del menu de paginacion), cada una
  // reteniendo por closure una tabla que ya no esta en el DOM.
  #limpiarPanel = null;

  constructor(user) { super(); this.#user = user; }

  async render(container) {
    this.#container = container;

    container.innerHTML = `
      <div class="tab-bar" id="proyectos-tabs">
        <button class="tab-btn active" data-tab="licitaciones">Licitaciones</button>
        <button class="tab-btn" data-tab="clientes">Gestión de clientes</button>
      </div>
      <div id="proyectos-panel"></div>
    `;

    // El apagar/encender de las pestañas vive en dashboardStrategy.js: era
    // idéntico en las tres estrategias que las tienen. El estado se queda acá
    // porque #activeTab es privado de esta clase.
    wireTabs(container, (tab) => {
      this.#activeTab = tab;
      this._renderPanel(tab);
    });

    await this._renderPanel(this.#activeTab);
  }

  async refresh() {
    if (this.#container) await this._renderPanel(this.#activeTab);
  }

  async _renderPanel(tab) {
    // Se desmonta lo anterior antes de pisar el innerHTML: los montadores
    // devuelven su limpieza justamente para esto.
    this.#limpiarPanel?.();
    this.#limpiarPanel = null;

    const panel = document.getElementById('proyectos-panel');
    if (!panel) return;
    switch (tab) {
      case 'licitaciones':
        // Proyectos can create and manage their own licitaciones.
        this.#limpiarPanel = await mountLicitacionesTab(panel, { canCreate: true });
        break;
      case 'clientes':
        this.#limpiarPanel = await mountClientsTab(panel);
        break;
    }
  }
}

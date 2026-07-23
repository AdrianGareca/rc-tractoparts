// =============================================================================
// public/js/views/dashboard/strategies/proyectosStrategy.js
// STRATEGY: ProyectosStrategy (Proyectos role — tenders/licitaciones executive)
//
// Tabs: Licitaciones (default) + Gestión de Clientes.
// Proyectos NEVER creates cotizaciones — there is no "Nueva Cotización" action
// anywhere in this strategy. They build the licitación, hand it to the
// commercial executive (moving it to 'Cotizando'), and track the contest.
//
// Mirrors the AdminStrategy tab/_renderPanel shape so DashboardController's
// sidebar dispatch (which calls strategy._renderPanel(section)) works uniformly.
// =============================================================================

import { mountClientsTab }        from '../modules/clientsView.js';
import { mountLicitacionesTab }   from '../modules/licitacionesView.js';
import { DashboardStrategy }      from './dashboardStrategy.js';

export class ProyectosStrategy extends DashboardStrategy {
  #container;
  #user;
  #activeTab = 'licitaciones';

  constructor(user) { super(); this.#user = user; }

  async render(container) {
    this.#container = container;

    container.innerHTML = `
      <div class="tab-bar" id="proyectos-tabs">
        <button class="tab-btn active" data-tab="licitaciones">📑 Licitaciones</button>
        <button class="tab-btn" data-tab="clientes">🏢 Gestión de Clientes</button>
      </div>
      <div id="proyectos-panel"></div>
    `;

    container.querySelectorAll('.tab-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        container.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        this.#activeTab = btn.dataset.tab;
        this._renderPanel(btn.dataset.tab);
      });
    });

    await this._renderPanel(this.#activeTab);
  }

  async refresh() {
    if (this.#container) await this._renderPanel(this.#activeTab);
  }

  async _renderPanel(tab) {
    const panel = document.getElementById('proyectos-panel');
    if (!panel) return;
    switch (tab) {
      case 'licitaciones':
        // Proyectos can create and manage their own licitaciones.
        await mountLicitacionesTab(panel, { canCreate: true });
        break;
      case 'clientes':
        await mountClientsTab(panel);
        break;
    }
  }
}

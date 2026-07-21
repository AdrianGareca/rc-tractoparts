// =============================================================================
// public/js/views/dashboardView.js
// Main Dashboard Controller
//
// BEHAVIORAL PATTERN: STRATEGY
//   Role-based rendering is delegated to concrete Strategy objects.
//   The DashboardController selects a strategy at startup and stores it;
//   all subsequent renders/refreshes go through the strategy interface.
//
//     DashboardStrategy  (abstract interface — dashboard/strategies/dashboardStrategy.js)
//       ├─ ExecutiveStrategy  — Ejecutivo  (dashboard/strategies/executiveStrategy.js)
//       │    • Summary stats, own quotation table, "Nueva Cotización" action
//       ├─ ManagerStrategy    — Jefe / SysAdmin  (dashboard/strategies/managerStrategy.js)
//       │    • Global overview, pending-approval queue, all quotations,
//       │      User CRUD panel, Audit Logs workspace
//       └─ AdminStrategy      — Administracion  (dashboard/strategies/adminStrategy.js)
//            • Review queue (hold + comment, no approve/reject), same CRUD access as Jefe
//
// This file now only owns the DashboardController (bootstrap, role→strategy
// selection, sidebar, logout, notification polling wiring). Everything else
// that used to live here — the proforma template, the Command pattern, the
// modal UI singleton, and each Strategy — was split into dashboard/ modules
// for readability (see imports below). No behavioral change from that split.
// =============================================================================

import AuthSession           from '../services/authSession.js';
import api, { showToast }   from '../services/apiClient.js';
import { mountQuotationForm } from './quotationForm.js';

// ── Dashboard sub-modules ─────────────────────────────────────────────────────
import { ROLE_BADGE } from './dashboard/helpers.js';
import { refreshNotifBadge, requestNotifPermission, startNotifPolling } from './dashboard/modules/notificationsView.js';
import { UI } from './dashboard/modalUI.js';
import { DISCARD_QUOTATION_MSG } from './dashboard/constants.js';
import { ExecutiveStrategy } from './dashboard/strategies/executiveStrategy.js';
import { ManagerStrategy }   from './dashboard/strategies/managerStrategy.js';
import { AdminStrategy }     from './dashboard/strategies/adminStrategy.js';

// =============================================================================
// DASHBOARD CONTROLLER
// Bootstraps the page, selects the Strategy based on the user's role,
// renders sidebar navigation, and wires global interactions.
// =============================================================================
class DashboardController {
  #strategy = null;

  async init() {
    // Guard — redirect to login if session is absent or expired
    if (!AuthSession.isAuthenticated()) {
      window.location.href = '/';
      return;
    }

    const user = AuthSession.getUser();
    const role = AuthSession.getRole();

    // Guard — user object missing or corrupted (storage eviction / logout race)
    if (!user?.id) {
      AuthSession.clearSession();
      window.location.href = '/';
      return;
    }

    // Populate identity elements
    this._populateIdentity(user, role);

    // STRATEGY SELECTION based on role hierarchy:
    //   Jefe / SysAdmin → ManagerStrategy  (full authority: approve, reject, all tabs)
    //   Administracion  → AdminStrategy    (review + hold + comment; no approve/reject)
    //   Ejecutivo       → ExecutiveStrategy (own quotations only)
    this.#strategy = (role === 'Jefe' || role === 'SysAdmin')
      ? new ManagerStrategy(user)
      : role === 'Administracion'
        ? new AdminStrategy(user)
        : new ExecutiveStrategy(user);

    // Render sidebar
    this._renderSidebar(role);

    // Wire modal close button
    document.getElementById('modal-close')?.addEventListener('click', UI.requestClose);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') UI.requestClose(); });

    // Wire logout button
    this._wireLogout();

    // Wire sidebar mobile toggle
    document.getElementById('sidebar-toggle')?.addEventListener('click', () => {
      document.getElementById('sidebar')?.classList.toggle('sidebar-open');
    });

    // ── Notification badge (Ejecutivo only) ───────────────────────────────
    // Start periodic polling so the badge stays current across soft navigations.
    // startNotifPolling fetches immediately then re-polls every 90 s.
    if (role === 'Ejecutivo') {
      requestNotifPermission();
      startNotifPolling(UI);
    }

    // Render the main content via the selected Strategy
    const container = document.getElementById('page-content');
    await this.#strategy.render(container);
  }

  _populateIdentity(user, role) {
    const displayName = user?.nombre_completo ?? user?.nombre_usuario ?? '—';
    const initials    = displayName.split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase();

    // Topbar
    const tbUser  = document.getElementById('topbar-username');
    const tbBadge = document.getElementById('topbar-role-badge');
    if (tbUser)  tbUser.textContent  = displayName;
    if (tbBadge) { tbBadge.textContent = role ?? ''; tbBadge.className = `badge ${ROLE_BADGE[role] ?? ''}`; }

    // Sidebar footer
    const sbAvatar   = document.getElementById('sidebar-avatar');
    const sbUsername = document.getElementById('sidebar-username');
    const sbRole     = document.getElementById('sidebar-role');
    if (sbAvatar)   sbAvatar.textContent   = initials || '?';
    if (sbUsername) sbUsername.textContent = displayName;
    if (sbRole)     sbRole.textContent     = role ?? '—';
  }

  _renderSidebar(role) {
    const nav = document.getElementById('sidebar-nav');
    if (!nav) return;

    let links = '';

    // NOTE: SysAdmin is intentionally grouped with 'Jefe' here — it already
    // gets the full ManagerStrategy content (see DashboardController strategy
    // selection: role === 'Jefe' || role === 'SysAdmin'), but this sidebar
    // check previously read `role === 'Jefe'` only, so a SysAdmin login fell
    // through to the Ejecutivo-only sidebar (no way to reach any Manager tab
    // via the nav). Fixed as part of adding the Swagger docs link below,
    // which must be visible to SysAdmin — the primary user of this feature.
    if (role === 'Jefe' || role === 'SysAdmin') {
      links = `
        <span class="sidebar-section-label">Panel Principal</span>
        <button class="sidebar-link active" data-section="approvals">
          <span class="link-icon">⏳</span> Cola de Aprobación
        </button>
        <button class="sidebar-link" data-section="quotations">
          <span class="link-icon">📋</span> Todas las Cotizaciones
        </button>
        <span class="sidebar-section-label">Administración</span>
        <button class="sidebar-link" data-section="users">
          <span class="link-icon">👥</span> Gestión de Usuarios
        </button>
        <button class="sidebar-link" data-section="audit">
          <span class="link-icon">🔍</span> Registros de Auditoría
        </button>
        <button class="sidebar-link" id="sidebar-api-docs">
          <span class="link-icon">📘</span> Documentación API
        </button>
        <span class="sidebar-section-label">Cuenta</span>
        <button class="sidebar-link sidebar-link-logout" id="btn-logout-sidebar">
          <span class="link-icon">🚪</span> Cerrar Sesión
        </button>`;
    } else if (role === 'Administracion') {
      links = `
        <span class="sidebar-section-label">Panel Principal</span>
        <button class="sidebar-link active" data-section="review">
          <span class="link-icon">📝</span> Cola de Revisión
        </button>
        <button class="sidebar-link" data-section="quotations">
          <span class="link-icon">📋</span> Todas las Cotizaciones
        </button>
        <span class="sidebar-section-label">Administración</span>
        <button class="sidebar-link" data-section="users">
          <span class="link-icon">👥</span> Gestión de Usuarios
        </button>
        <button class="sidebar-link" data-section="audit">
          <span class="link-icon">🔍</span> Registros de Auditoría
        </button>
        <span class="sidebar-section-label">Cuenta</span>
        <button class="sidebar-link sidebar-link-logout" id="btn-logout-sidebar">
          <span class="link-icon">🚪</span> Cerrar Sesión
        </button>`;
    } else {
      links = `
        <span class="sidebar-section-label">Mi Trabajo</span>
        <button class="sidebar-link active" data-section="quotations">
          <span class="link-icon">📋</span> Mis Cotizaciones
        </button>
        <button class="sidebar-link btn-new-cot" data-section="new">
          <span class="link-icon">➕</span> Nueva Cotización
        </button>
        <span class="sidebar-section-label">Cuenta</span>
        <button class="sidebar-link sidebar-link-logout" id="btn-logout-sidebar">
          <span class="link-icon">🚪</span> Cerrar Sesión
        </button>`;
    }

    nav.innerHTML = links;

    // Wire sidebar logout button (present for both roles)
    nav.querySelector('#btn-logout-sidebar')?.addEventListener('click', () => {
      AuthSession.clearSession();
      window.location.href = '/';
    });

    // Wire "Documentación API" — fetches a short-lived docs-only token (see
    // GET /api/auth/docs-token, Jefe/SysAdmin-only) and opens Swagger UI with
    // it in a new tab. Swagger is browser-navigated and can't carry the
    // normal Authorization header, hence the dedicated token-in-URL flow.
    nav.querySelector('#sidebar-api-docs')?.addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      const original = btn.innerHTML;
      btn.disabled = true;
      btn.innerHTML = '<span class="link-icon">⏳</span> Abriendo…';
      try {
        const { data } = await api.get('/api/auth/docs-token');
        window.open(`/api-docs?token=${encodeURIComponent(data.token)}`, '_blank', 'noopener');
      } catch (err) {
        showToast(err.data?.message || err.message || 'No se pudo abrir la documentación.', 'error');
      } finally {
        btn.disabled = false;
        btn.innerHTML = original;
      }
    });

    // Sidebar link click → update topbar title + call strategy section
    nav.querySelectorAll('.sidebar-link[data-section]').forEach(btn => {
      btn.addEventListener('click', () => {
        // Special shortcut: "new" opens the modal immediately
        if (btn.dataset.section === 'new') {
          UI.openModal('Nueva Cotización', (body) => {
            const destroy = mountQuotationForm(body, {
              onSuccess: (q) => {
                UI.closeModal();
                showToast(`Cotización ${q?.numero_correlativo ?? ''} creada.`, 'success');
                this.#strategy.refresh();
              },
              onCancel: UI.closeModal,
            });
            UI.registerCleanup(destroy);
            UI.registerCloseGuard(() => !destroy.isDirty() || confirm(DISCARD_QUOTATION_MSG));
          }, { wide: true, dismissOnBackdrop: false });
          return;
        }

        nav.querySelectorAll('.sidebar-link').forEach(l => l.classList.remove('active'));
        btn.classList.add('active');

        const title = btn.textContent.trim().replace(/^.{1,3}\s/, '');
        const topbarTitle = document.getElementById('topbar-title');
        if (topbarTitle) topbarTitle.textContent = title;

        // ManagerStrategy and AdminStrategy both have _renderPanel
        if (this.#strategy instanceof ManagerStrategy || this.#strategy instanceof AdminStrategy) {
          this.#strategy._renderPanel(btn.dataset.section);
        }
      });
    });
  }

  _wireLogout() {
    document.getElementById('btn-logout')?.addEventListener('click', async () => {
      try {
        await api.post('/api/auth/logout', {});
      } catch (_) {
        // Even if logout API fails, clear local session
      }
      AuthSession.clearSession();
      window.location.href = '/';
    });
  }

  // ── Notification badge — delegated to notificationsView module ──────────────
  async _refreshNotifBadge() {
    await refreshNotifBadge(UI);
  }
}

// =============================================================================
// Bootstrap — ES modules are deferred; DOM is fully parsed at this point.
// =============================================================================
new DashboardController().init();

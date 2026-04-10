const AdminUI = (() => {
  
  async function renderDashboard() {
    const container = document.getElementById('admin-dashboard');
    if (!container) return;

    const isAdmin = await Auth.isAdmin();
    if (!isAdmin) {
      container.innerHTML = `
        <div class="admin-access-denied">
          <div class="empty-icon">⚠️</div>
          <h3>Erişim Engellendi</h3>
          <p>Bu sayfaya erişim için admin yetkisi gereklidir.</p>
        </div>`;
      return;
    }

    try {
      const stats = await Admin.getStats();
      const regStatus = await Admin.getRegistrationStatus();

      container.innerHTML = `
        <div class="admin-stats-grid">
          <div class="stat-card">
            <div class="stat-icon">👥</div>
            <div class="stat-value">${stats.totalUsers}</div>
            <div class="stat-label">Toplam Kullanıcı</div>
          </div>
          <div class="stat-card">
            <div class="stat-icon">✨</div>
            <div class="stat-value">${stats.activeUsers}</div>
            <div class="stat-label">Aktif (7 gün)</div>
          </div>
          <div class="stat-card">
            <div class="stat-icon">🚫</div>
            <div class="stat-value">${stats.bannedUsers}</div>
            <div class="stat-label">Banlı</div>
          </div>
          <div class="stat-card">
            <div class="stat-icon">👑</div>
            <div class="stat-value">${stats.adminUsers}</div>
            <div class="stat-label">Admin</div>
          </div>
          <div class="stat-card">
            <div class="stat-icon">📊</div>
            <div class="stat-value">${stats.totalProjects}</div>
            <div class="stat-label">Toplam Proje</div>
          </div>
          <div class="stat-card">
            <div class="stat-icon">💎</div>
            <div class="stat-value">${stats.planDistribution.free}/${stats.planDistribution.pro}/${stats.planDistribution.enterprise}</div>
            <div class="stat-label">Free/Pro/Ent</div>
          </div>
        </div>

        <div class="admin-controls">
          <h3>Global Ayarlar</h3>
          <div class="control-row">
            <label>
              <input type="checkbox" id="toggle-registration" ${regStatus ? 'checked' : ''}>
              Kayıt Durdurma (Yeni kullanıcı kabul edilmez)
            </label>
          </div>
        </div>`;

      const toggleReg = document.getElementById('toggle-registration');
      if (toggleReg) {
        toggleReg.addEventListener('change', async (e) => {
          try {
            await Admin.toggleRegistration(e.target.checked);
            App.toast(e.target.checked ? 'Kayıt durduruldu' : 'Kayıt açıldı', 'success');
          } catch (err) {
            App.toast('Hata: ' + err.message, 'error');
            e.target.checked = !e.target.checked;
          }
        });
      }
    } catch (err) {
      container.innerHTML = `<div class="error-message">Hata: ${err.message}</div>`;
    }
  }

  async function renderUsers() {
    const container = document.getElementById('admin-users-list');
    if (!container) return;

    const isAdmin = await Auth.isAdmin();
    if (!isAdmin) return;

    App.setLoading(true, 'Kullanıcılar yükleniyor...');
    try {
      const users = await Admin.getAllUsers();
      
      container.innerHTML = `
        <div class="admin-users-header">
          <h3>Kullanıcı Yönetimi (${users.length})</h3>
          <input type="text" id="admin-user-search" placeholder="Email veya isim ara..." class="search-input">
        </div>
        <div class="admin-users-table">
          <table>
            <thead>
              <tr>
                <th>Email</th>
                <th>İsim</th>
                <th>Kayıt</th>
                <th>Son Giriş</th>
                <th>Plan</th>
                <th>Rol</th>
                <th>Durum</th>
                <th>İşlem</th>
              </tr>
            </thead>
            <tbody id="admin-users-tbody"></tbody>
          </table>
        </div>`;

      const tbody = document.getElementById('admin-users-tbody');
      const searchInput = document.getElementById('admin-user-search');

      function renderUserRows(filteredUsers) {
        tbody.innerHTML = filteredUsers.map(user => {
          const created = user.createdAt?.toDate?.()?.toLocaleDateString('tr-TR') || '-';
          const lastLogin = user.lastLogin?.toDate?.()?.toLocaleDateString('tr-TR') || '-';
          return `
            <tr data-user-id="${user.id}">
              <td>${user.email || '-'}</td>
              <td>${user.displayName || '-'}</td>
              <td>${created}</td>
              <td>${lastLogin}</td>
              <td>
                <select class="plan-select" data-uid="${user.id}">
                  <option value="free" ${user.plan === 'free' ? 'selected' : ''}>Free</option>
                  <option value="pro" ${user.plan === 'pro' ? 'selected' : ''}>Pro</option>
                  <option value="enterprise" ${user.plan === 'enterprise' ? 'selected' : ''}>Enterprise</option>
                </select>
              </td>
              <td>
                <select class="role-select" data-uid="${user.id}">
                  <option value="user" ${user.role === 'user' ? 'selected' : ''}>User</option>
                  <option value="admin" ${user.role === 'admin' ? 'selected' : ''}>Admin</option>
                </select>
              </td>
              <td>
                <span class="status-badge ${user.banned ? 'banned' : 'active'}">
                  ${user.banned ? 'Banlı' : 'Aktif'}
                </span>
              </td>
              <td>
                <button class="btn-xs ${user.banned ? '' : 'danger'}" data-action="ban" data-uid="${user.id}">
                  ${user.banned ? 'Unban' : 'Ban'}
                </button>
                <button class="btn-xs" data-action="projects" data-uid="${user.id}">Projeler</button>
                <button class="btn-xs" data-action="apis" data-uid="${user.id}">API'ler</button>
              </td>
            </tr>`;
        }).join('');

        tbody.querySelectorAll('[data-action="ban"]').forEach(btn => {
          btn.addEventListener('click', async () => {
            const uid = btn.dataset.uid;
            const user = filteredUsers.find(u => u.id === uid);
            const willBan = !user.banned;
            if (confirm(`Bu kullanıcıyı ${willBan ? 'banlamak' : 'banı kaldırmak'} istediğinize emin misiniz?`)) {
              try {
                await Admin.banUser(uid, willBan);
                App.toast(willBan ? 'Kullanıcı banlandı' : 'Ban kaldırıldı', 'success');
                renderUsers();
              } catch (err) {
                App.toast('Hata: ' + err.message, 'error');
              }
            }
          });
        });

        tbody.querySelectorAll('[data-action="projects"]').forEach(btn => {
          btn.addEventListener('click', () => showUserProjects(btn.dataset.uid));
        });

        tbody.querySelectorAll('[data-action="apis"]').forEach(btn => {
          btn.addEventListener('click', () => showUserAPIs(btn.dataset.uid));
        });

        tbody.querySelectorAll('.plan-select').forEach(select => {
          select.addEventListener('change', async (e) => {
            try {
              await Admin.setUserPlan(select.dataset.uid, e.target.value);
              App.toast('Plan güncellendi', 'success');
            } catch (err) {
              App.toast('Hata: ' + err.message, 'error');
            }
          });
        });

        tbody.querySelectorAll('.role-select').forEach(select => {
          select.addEventListener('change', async (e) => {
            try {
              await Admin.setUserRole(select.dataset.uid, e.target.value);
              App.toast('Rol güncellendi', 'success');
            } catch (err) {
              App.toast('Hata: ' + err.message, 'error');
            }
          });
        });
      }

      renderUserRows(users);

      if (searchInput) {
        searchInput.addEventListener('input', (e) => {
          const search = e.target.value.toLowerCase();
          const filtered = users.filter(u => 
            (u.email || '').toLowerCase().includes(search) ||
            (u.displayName || '').toLowerCase().includes(search)
          );
          renderUserRows(filtered);
        });
      }
    } catch (err) {
      container.innerHTML = `<div class="error-message">Hata: ${err.message}</div>`;
    } finally {
      App.setLoading(false);
    }
  }

  async function showUserProjects(uid) {
    const modal = document.getElementById('admin-modal');
    if (!modal) return;

    App.setLoading(true, 'Projeler yükleniyor...');
    try {
      const projects = await Admin.getUserProjects(uid);
      const user = (await Admin.getAllUsers()).find(u => u.id === uid);

      modal.innerHTML = `
        <div class="modal-content admin-modal-content">
          <div class="modal-header">
            <h3>${user?.email || 'Kullanıcı'} - Projeler (${projects.length})</h3>
            <button class="modal-close" onclick="document.getElementById('admin-modal').style.display='none'">×</button>
          </div>
          <div class="modal-body">
            ${projects.length === 0 ? '<p>Proje bulunamadı</p>' : `
              <table>
                <thead>
                  <tr>
                    <th>Proje Adı</th>
                    <th>Oluşturulma</th>
                    <th>Güncelleme</th>
                    <th>Grup Sayısı</th>
                  </tr>
                </thead>
                <tbody>
                  ${projects.map(p => `
                    <tr>
                      <td>${p.name || 'İsimsiz'}</td>
                      <td>${p.createdAt?.toDate?.()?.toLocaleDateString('tr-TR') || '-'}</td>
                      <td>${p.updatedAt?.toDate?.()?.toLocaleDateString('tr-TR') || '-'}</td>
                      <td>${p.groups?.length || 0}</td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            `}
          </div>
        </div>`;
      modal.style.display = 'flex';
    } catch (err) {
      App.toast('Hata: ' + err.message, 'error');
    } finally {
      App.setLoading(false);
    }
  }

  async function showUserAPIs(uid) {
    const modal = document.getElementById('admin-modal');
    if (!modal) return;

    App.setLoading(true, 'API\'ler yükleniyor...');
    try {
      const apis = await Admin.getUserAPIs(uid);
      const user = (await Admin.getAllUsers()).find(u => u.id === uid);

      modal.innerHTML = `
        <div class="modal-content admin-modal-content">
          <div class="modal-header">
            <h3>${user?.email || 'Kullanıcı'} - API Anahtarları (${apis.length})</h3>
            <button class="modal-close" onclick="document.getElementById('admin-modal').style.display='none'">×</button>
          </div>
          <div class="modal-body">
            ${apis.length === 0 ? '<p>API anahtarı bulunamadı</p>' : `
              <table>
                <thead>
                  <tr>
                    <th>Provider</th>
                    <th>Model</th>
                    <th>Kullanım</th>
                    <th>Kota</th>
                    <th>İşlem</th>
                  </tr>
                </thead>
                <tbody>
                  ${apis.map(api => `
                    <tr>
                      <td>${api.provider || '-'}</td>
                      <td>${api.selectedModel || '-'}</td>
                      <td>${api.usageCount || 0}</td>
                      <td>${api.quota || 0}</td>
                      <td>
                        <button class="btn-xs danger" data-delete-api="${api.id}" data-uid="${uid}">Sil</button>
                      </td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            `}
          </div>
        </div>`;
      modal.style.display = 'flex';

      modal.querySelectorAll('[data-delete-api]').forEach(btn => {
        btn.addEventListener('click', async () => {
          if (confirm('Bu API anahtarını silmek istediğinize emin misiniz?')) {
            try {
              await Admin.deleteUserAPI(btn.dataset.uid, btn.dataset.deleteApi);
              App.toast('API anahtarı silindi', 'success');
              showUserAPIs(uid);
            } catch (err) {
              App.toast('Hata: ' + err.message, 'error');
            }
          }
        });
      });
    } catch (err) {
      App.toast('Hata: ' + err.message, 'error');
    } finally {
      App.setLoading(false);
    }
  }

  async function renderAPIs() {
    const container = document.getElementById('admin-apis-list');
    if (!container) return;

    const isAdmin = await Auth.isAdmin();
    if (!isAdmin) return;

    App.setLoading(true, 'API\'ler yükleniyor...');
    try {
      const apis = await Admin.getAllAPIs();

      container.innerHTML = `
        <div class="admin-apis-header">
          <h3>Tüm API Anahtarları (${apis.length})</h3>
        </div>
        <div class="admin-apis-table">
          <table>
            <thead>
              <tr>
                <th>Kullanıcı</th>
                <th>Provider</th>
                <th>Model</th>
                <th>Kullanım</th>
                <th>Kota</th>
                <th>Son Sıfırlama</th>
              </tr>
            </thead>
            <tbody>
              ${apis.map(api => `
                <tr>
                  <td>${api.userEmail || '-'}</td>
                  <td>${api.provider || '-'}</td>
                  <td>${api.selectedModel || '-'}</td>
                  <td>${api.usageCount || 0}</td>
                  <td>${api.quota || 0}</td>
                  <td>${api.lastReset?.toDate?.()?.toLocaleDateString('tr-TR') || '-'}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>`;
    } catch (err) {
      container.innerHTML = `<div class="error-message">Hata: ${err.message}</div>`;
    } finally {
      App.setLoading(false);
    }
  }

  async function init() {
    const isAdmin = await Auth.isAdmin();
    const adminNav = document.querySelector('.nav-item[data-tab="admin"]');
    if (adminNav) {
      adminNav.style.display = isAdmin ? 'flex' : 'none';
    }

    const adminTabSwitchers = document.querySelectorAll('[data-admin-tab]');
    adminTabSwitchers.forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.admin-tab-panel').forEach(p => p.classList.remove('active'));
        document.querySelectorAll('[data-admin-tab]').forEach(b => b.classList.remove('active'));
        
        const tabId = btn.dataset.adminTab;
        const panel = document.getElementById(`admin-tab-${tabId}`);
        if (panel) panel.classList.add('active');
        btn.classList.add('active');

        if (tabId === 'dashboard') renderDashboard();
        if (tabId === 'users') renderUsers();
        if (tabId === 'apis') renderAPIs();
        if (tabId === 'economy') AdminEconomy.renderEconomyDashboard('admin-economy-container');
        if (tabId === 'plans') AdminEconomy.renderPlanEditor('admin-plan-editor-container');
        if (tabId === 'bulk') AdminEconomy.renderBulkAssign('admin-bulk-assign-container');
        if (tabId === 'security') AdminEconomy.renderAdminSecurity('admin-security-container');
      });
    });
  }

  return { init, renderDashboard, renderUsers, renderAPIs };
})();

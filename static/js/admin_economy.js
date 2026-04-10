// ══════════════════════════════════════════════════════════
//  admin_economy.js  —  Admin: ekonomi paneli, plan editörü,
//                        ödeme onay/ret, gelir istatistikleri,
//                        admin güvenlik (IP / 2FA)
// ══════════════════════════════════════════════════════════
const AdminEconomy = (() => {
  const FIREBASE_CDN = 'https://www.gstatic.com/firebasejs/10.12.2';

  async function _getFS() {
    return import(`${FIREBASE_CDN}/firebase-firestore.js`);
  }

  // ════════════════════════════════════════════════════════
  //  GELİR / EKONOMİ DASHBOARD
  // ════════════════════════════════════════════════════════
  async function renderEconomyDashboard(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    container.innerHTML = `<div class="loading-spinner-sm"></div>`;

    try {
      const [stats, payments, plansConfig] = await Promise.all([
        Plans.getRevenueStats(),
        Plans.getAllPayments(200),
        Plans.getPlansConfig()
      ]);

      const pending = payments.filter(p => p.status === 'pending');

      container.innerHTML = `
        <!-- Gelir İstatistikleri -->
        <div class="economy-stats-grid">
          <div class="economy-stat-card primary">
            <div class="economy-stat-icon">₺</div>
            <div class="economy-stat-value">₺${stats.total.toLocaleString('tr-TR')}</div>
            <div class="economy-stat-label">Toplam Gelir</div>
          </div>
          <div class="economy-stat-card">
            <div class="economy-stat-icon">📅</div>
            <div class="economy-stat-value">₺${stats.last30Days.toLocaleString('tr-TR')}</div>
            <div class="economy-stat-label">Son 30 Gün</div>
          </div>
          <div class="economy-stat-card">
            <div class="economy-stat-icon">✓</div>
            <div class="economy-stat-value">${stats.totalTransactions}</div>
            <div class="economy-stat-label">Onaylı İşlem</div>
          </div>
          <div class="economy-stat-card warning">
            <div class="economy-stat-icon">⏳</div>
            <div class="economy-stat-value">${pending.length}</div>
            <div class="economy-stat-label">Bekleyen Ödeme</div>
          </div>
        </div>

        <!-- Plan bazlı gelir -->
        <div class="economy-plan-breakdown">
          <h4>Plan Bazlı Gelir</h4>
          <div class="plan-revenue-bars">
            ${Object.entries(stats.byPlan).map(([planId, data]) => {
              const plan = plansConfig[planId];
              const pct = stats.total > 0 ? Math.round((data.revenue / stats.total) * 100) : 0;
              return `
                <div class="plan-rev-row">
                  <span class="plan-rev-name" style="color:${plan?.color || '#888'}">${plan?.icon || '◇'} ${planId}</span>
                  <div class="plan-rev-bar-wrap">
                    <div class="plan-rev-bar" style="width:${pct}%;background:${plan?.color || '#888'}"></div>
                  </div>
                  <span class="plan-rev-amount">₺${data.revenue.toLocaleString('tr-TR')} (${data.count})</span>
                </div>`;
            }).join('') || '<p class="empty-hint">Henüz veri yok</p>'}
          </div>
        </div>

        <!-- Bekleyen ödemeler -->
        ${pending.length > 0 ? `
        <div class="pending-payments-section">
          <h4>⏳ Onay Bekleyen Ödemeler (${pending.length})</h4>
          <div class="pending-payments-list" id="pending-payments-list">
            ${await renderPendingPaymentRows(pending)}
          </div>
        </div>` : ''}

        <!-- Tüm ödemeler -->
        <div class="all-payments-section">
          <div class="section-header-row">
            <h4>📋 Tüm Ödemeler</h4>
            <input type="text" placeholder="Email veya referans ara..." id="payment-search" class="search-input search-input-sm"/>
          </div>
          <div id="all-payments-table">
            ${renderPaymentsTable(payments)}
          </div>
        </div>`;

      // Bekleyen ödeme butonları
      container.querySelectorAll('[data-confirm-payment]').forEach(btn => {
        btn.addEventListener('click', () => confirmPayment(btn.dataset.confirmPayment, btn.dataset.uid, btn.dataset.plan));
      });
      container.querySelectorAll('[data-reject-payment]').forEach(btn => {
        btn.addEventListener('click', () => rejectPayment(btn.dataset.rejectPayment));
      });

      // Arama
      document.getElementById('payment-search')?.addEventListener('input', e => {
        const q = e.target.value.toLowerCase();
        const filtered = payments.filter(p =>
          (p.uid || '').toLowerCase().includes(q) ||
          (p.reference || '').toLowerCase().includes(q) ||
          (p.planId || '').toLowerCase().includes(q)
        );
        const tableEl = document.getElementById('all-payments-table');
        if (tableEl) tableEl.innerHTML = renderPaymentsTable(filtered);
      });

    } catch (err) {
      container.innerHTML = `<div class="error-message">Hata: ${err.message}</div>`;
    }
  }

  async function renderPendingPaymentRows(payments) {
    // Her ödeme için kullanıcı emailini getir (basit tutmak için uid gösteriyoruz)
    return payments.map(p => `
      <div class="pending-payment-card">
        <div class="pending-payment-info">
          <span class="pending-uid">${p.uid?.slice(0, 12)}...</span>
          <span class="pending-plan">${p.planId}</span>
          <span class="pending-amount">₺${p.amount}</span>
          <span class="pending-ref">${p.reference || '-'}</span>
          <span class="pending-method">${p.method === 'bank_transfer' ? 'Havale' : 'Kart'}</span>
          <span class="pending-date">${p.createdAt?.toDate?.()?.toLocaleDateString('tr-TR') || '-'}</span>
        </div>
        <div class="pending-payment-actions">
          <button class="btn-xs success" data-confirm-payment="${p.id}" data-uid="${p.uid}" data-plan="${p.planId}">
            <i data-lucide="check"></i> Onayla
          </button>
          <button class="btn-xs danger" data-reject-payment="${p.id}">
            <i data-lucide="x"></i> Reddet
          </button>
        </div>
      </div>`).join('');
  }

  function renderPaymentsTable(payments) {
    if (!payments.length) return '<p class="empty-hint">Ödeme bulunamadı</p>';
    const statusMap = { pending: '⏳', confirmed: '✓', failed: '✗', refunded: '↩' };
    const statusClass = { pending: 'warning', confirmed: 'success', failed: 'error', refunded: 'info' };
    return `
      <table class="admin-table">
        <thead><tr><th>Tarih</th><th>UID</th><th>Plan</th><th>Tutar</th><th>Yöntem</th><th>Ref</th><th>Durum</th><th>İşlem</th></tr></thead>
        <tbody>
          ${payments.map(p => `
            <tr>
              <td>${p.createdAt?.toDate?.()?.toLocaleDateString('tr-TR') || '-'}</td>
              <td class="uid-cell">${p.uid?.slice(0, 8)}...</td>
              <td>${p.planId || '-'}</td>
              <td>₺${p.amount || 0}</td>
              <td>${p.method === 'credit_card' ? '💳' : '🏦'}</td>
              <td class="ref-cell">${p.reference || '-'}</td>
              <td><span class="status-badge ${statusClass[p.status] || ''}">${statusMap[p.status] || ''} ${p.status}</span></td>
              <td>
                ${p.status === 'pending' ? `
                  <button class="btn-xs success" data-confirm-payment="${p.id}" data-uid="${p.uid}" data-plan="${p.planId}">Onayla</button>
                  <button class="btn-xs danger" data-reject-payment="${p.id}">Reddet</button>
                ` : p.status === 'confirmed' ? `
                  <button class="btn-xs" data-refund-payment="${p.id}" data-uid="${p.uid}">İade</button>
                ` : '-'}
              </td>
            </tr>`).join('')}
        </tbody>
      </table>`;
  }

  async function confirmPayment(paymentId, uid, planId) {
    if (!confirm(`Bu ödemeyi onaylamak istiyor musunuz? Kullanıcıya ${planId} paketi atanacak.`)) return;
    try {
      await Plans.updatePaymentStatus(paymentId, 'confirmed');
      await Plans.activatePlan(uid, planId, 30);
      App.toast('Ödeme onaylandı, plan aktifleştirildi', 'success');
      renderEconomyDashboard('admin-economy-container');
    } catch (err) {
      App.toast('Hata: ' + err.message, 'error');
    }
  }

  async function rejectPayment(paymentId) {
    if (!confirm('Bu ödemeyi reddetmek istiyor musunuz?')) return;
    try {
      await Plans.updatePaymentStatus(paymentId, 'failed');
      App.toast('Ödeme reddedildi', 'info');
      renderEconomyDashboard('admin-economy-container');
    } catch (err) {
      App.toast('Hata: ' + err.message, 'error');
    }
  }

  // ════════════════════════════════════════════════════════
  //  PLAN EDİTÖRÜ
  // ════════════════════════════════════════════════════════
  async function renderPlanEditor(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const plans = await Plans.getPlansConfig();

    container.innerHTML = `
      <div class="plan-editor-header">
        <h4>Paket Fiyat & Limit Yönetimi</h4>
        <p class="hint-text">Değişiklikler anında tüm kullanıcılara yansır.</p>
      </div>
      <div class="plan-editor-grid" id="plan-editor-grid">
        ${Object.entries(plans).map(([planId, plan]) => `
          <div class="plan-editor-card" data-plan-id="${planId}">
            <div class="plan-editor-card-header" style="border-left:3px solid ${plan.color}">
              <span class="plan-editor-icon">${plan.icon}</span>
              <h5>${plan.name}</h5>
            </div>
            <div class="plan-editor-fields">
              <div class="form-group-sm">
                <label>Fiyat (₺/ay)</label>
                <input type="number" class="fancy-input" data-field="price" value="${plan.price}" min="0" ${planId === 'free' ? 'disabled' : ''}/>
              </div>
              <div class="form-group-sm">
                <label>Günlük AI Sorgu</label>
                <input type="text" class="fancy-input" data-field="aiQueriesPerDay" 
                  value="${plan.limits?.aiQueriesPerDay === Infinity ? 'unlimited' : plan.limits?.aiQueriesPerDay || 10}"
                  placeholder="Sayı veya 'unlimited'"/>
              </div>
              <div class="form-group-sm">
                <label>Maks. Proje</label>
                <input type="text" class="fancy-input" data-field="projects"
                  value="${plan.limits?.projects === Infinity ? 'unlimited' : plan.limits?.projects || 5}"
                  placeholder="Sayı veya 'unlimited'"/>
              </div>
              <div class="form-group-sm">
                <label>Maks. API Bağlantısı</label>
                <input type="text" class="fancy-input" data-field="apis"
                  value="${plan.limits?.apis === Infinity ? 'unlimited' : plan.limits?.apis || 2}"
                  placeholder="Sayı veya 'unlimited'"/>
              </div>
              <div class="form-group-sm">
                <label>Özellikler (virgülle)</label>
                <input type="text" class="fancy-input" data-field="features"
                  value="${(plan.features || []).join(', ')}"/>
              </div>
            </div>
          </div>`).join('')}
      </div>
      <div class="plan-editor-actions">
        <button class="btn-primary" id="btn-save-plans">
          <i data-lucide="save"></i> Paket Ayarlarını Kaydet
        </button>
        <button class="btn-secondary" id="btn-reset-plans">
          <i data-lucide="rotate-ccw"></i> Varsayılanlara Döndür
        </button>
      </div>
      <div id="plan-editor-status"></div>`;

    lucide?.createIcons?.();

    document.getElementById('btn-save-plans')?.addEventListener('click', async () => {
      await savePlanEdits(plans);
    });

    document.getElementById('btn-reset-plans')?.addEventListener('click', async () => {
      if (!confirm('Paket ayarlarını varsayılanlara döndürmek istiyor musunuz?')) return;
      try {
        await Plans.savePlansConfig(Plans.DEFAULT_PLANS);
        App.toast('Varsayılan ayarlar geri yüklendi', 'success');
        renderPlanEditor(containerId);
      } catch (err) {
        App.toast('Hata: ' + err.message, 'error');
      }
    });
  }

  async function savePlanEdits(currentPlans) {
    const statusEl = document.getElementById('plan-editor-status');
    const updatedPlans = JSON.parse(JSON.stringify(currentPlans));

    document.querySelectorAll('.plan-editor-card').forEach(card => {
      const planId = card.dataset.planId;
      if (!updatedPlans[planId]) return;

      const priceInput = card.querySelector('[data-field="price"]');
      if (priceInput && !priceInput.disabled) {
        updatedPlans[planId].price = parseFloat(priceInput.value) || 0;
      }

      const parseLimit = (val) => {
        if (val === 'unlimited' || val === '∞') return Infinity;
        const n = parseInt(val);
        return isNaN(n) ? 0 : n;
      };

      const aiInput = card.querySelector('[data-field="aiQueriesPerDay"]');
      if (aiInput) updatedPlans[planId].limits = { ...updatedPlans[planId].limits, aiQueriesPerDay: parseLimit(aiInput.value) };

      const projInput = card.querySelector('[data-field="projects"]');
      if (projInput) updatedPlans[planId].limits = { ...updatedPlans[planId].limits, projects: parseLimit(projInput.value) };

      const apisInput = card.querySelector('[data-field="apis"]');
      if (apisInput) updatedPlans[planId].limits = { ...updatedPlans[planId].limits, apis: parseLimit(apisInput.value) };

      const featInput = card.querySelector('[data-field="features"]');
      if (featInput) updatedPlans[planId].features = featInput.value.split(',').map(s => s.trim()).filter(Boolean);
    });

    try {
      await Plans.savePlansConfig(updatedPlans);
      if (statusEl) { statusEl.textContent = '✓ Kaydedildi'; statusEl.className = 'save-status success'; setTimeout(() => { statusEl.textContent = ''; }, 3000); }
      App.toast('Paket ayarları kaydedildi', 'success');
    } catch (err) {
      App.toast('Kayıt hatası: ' + err.message, 'error');
    }
  }

  // ════════════════════════════════════════════════════════
  //  ADMİN GÜVENLİK: IP Kısıtlama + 2FA (Email OTP)
  // ════════════════════════════════════════════════════════
  async function renderAdminSecurity(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    // Mevcut güvenlik ayarlarını çek
    let securitySettings = {};
    try {
      const fs = await _getFS();
      const { getFirestore, doc, getDoc } = fs;
      const db = getFirestore(window.__fbApp);
      const snap = await getDoc(doc(db, 'admin_settings', 'security'));
      if (snap.exists()) securitySettings = snap.data();
    } catch {}

    const currentIP = await getCurrentIP();
    const allowedIPs = securitySettings.allowedIPs || [];
    const twoFAEnabled = securitySettings.twoFAEnabled || false;
    const adminEmail = securitySettings.adminEmail || Auth.getUser()?.email || '';

    container.innerHTML = `
      <div class="admin-security-section">
        <h4><i data-lucide="shield"></i> Admin Güvenlik Ayarları</h4>
        <p class="hint-text">Bu ayarlar yalnızca admin paneline erişimi etkiler.</p>

        <!-- 2FA -->
        <div class="security-card">
          <div class="security-card-header">
            <h5>📱 İki Faktörlü Doğrulama (2FA)</h5>
            <label class="toggle-switch">
              <input type="checkbox" id="toggle-2fa" ${twoFAEnabled ? 'checked' : ''}/>
              <span class="toggle-slider"></span>
            </label>
          </div>
          <p class="security-desc">Admin girişinde email veya telefon ile ek doğrulama zorunluluğu.</p>
          <div class="security-2fa-detail ${twoFAEnabled ? '' : 'hidden'}" id="2fa-detail">
            <div class="form-group-sm">
              <label>Doğrulama Email Adresi</label>
              <input type="email" id="admin-2fa-email" class="fancy-input" value="${adminEmail}" placeholder="admin@example.com"/>
            </div>
            <div class="twofa-method-select">
              <label>
                <input type="radio" name="twofa-method" value="email" ${securitySettings.twoFAMethod !== 'phone' ? 'checked' : ''}/> Email OTP
              </label>
              <label>
                <input type="radio" name="twofa-method" value="phone" ${securitySettings.twoFAMethod === 'phone' ? 'checked' : ''}/> SMS (Yakında)
              </label>
            </div>
          </div>
        </div>

        <!-- IP Kısıtlama -->
        <div class="security-card">
          <div class="security-card-header">
            <h5>🌐 IP Kısıtlama</h5>
            <label class="toggle-switch">
              <input type="checkbox" id="toggle-ip-restrict" ${securitySettings.ipRestrictionEnabled ? 'checked' : ''}/>
              <span class="toggle-slider"></span>
            </label>
          </div>
          <p class="security-desc">Yalnızca belirtilen IP adreslerinden admin paneline erişim.</p>
          <div class="ip-restrict-detail ${securitySettings.ipRestrictionEnabled ? '' : 'hidden'}" id="ip-restrict-detail">
            <div class="current-ip-row">
              <span>Mevcut IP'niz:</span>
              <code>${currentIP}</code>
              <button class="btn-xs" id="btn-add-current-ip">+ Ekle</button>
            </div>
            <div class="form-group-sm">
              <label>İzin Verilen IP'ler (her satıra bir tane)</label>
              <textarea id="allowed-ips-input" class="fancy-input" rows="4" placeholder="192.168.1.1&#10;10.0.0.1">${allowedIPs.join('\n')}</textarea>
            </div>
          </div>
        </div>

        <!-- Login Log -->
        <div class="security-card">
          <h5>📜 Son Admin Girişleri</h5>
          <div id="admin-login-log">
            ${(securitySettings.loginLog || []).slice(0, 5).map(log => `
              <div class="login-log-row">
                <span>${log.ip || 'Bilinmiyor'}</span>
                <span>${log.email || '-'}</span>
                <span>${log.time || '-'}</span>
                <span class="status-badge ${log.success ? 'success' : 'error'}">${log.success ? 'Başarılı' : 'Başarısız'}</span>
              </div>`).join('') || '<p class="empty-hint">Giriş kaydı yok</p>'}
          </div>
        </div>

        <div class="security-actions">
          <button class="btn-primary" id="btn-save-security">
            <i data-lucide="save"></i> Güvenlik Ayarlarını Kaydet
          </button>
        </div>
      </div>`;

    lucide?.createIcons?.();

    // Toggle 2FA detail
    document.getElementById('toggle-2fa')?.addEventListener('change', e => {
      document.getElementById('2fa-detail')?.classList.toggle('hidden', !e.target.checked);
    });

    // Toggle IP restrict detail
    document.getElementById('toggle-ip-restrict')?.addEventListener('change', e => {
      document.getElementById('ip-restrict-detail')?.classList.toggle('hidden', !e.target.checked);
    });

    // Add current IP
    document.getElementById('btn-add-current-ip')?.addEventListener('click', () => {
      const textarea = document.getElementById('allowed-ips-input');
      if (!textarea) return;
      const existing = textarea.value.trim();
      textarea.value = existing ? existing + '\n' + currentIP : currentIP;
    });

    // Save security settings
    document.getElementById('btn-save-security')?.addEventListener('click', async () => {
      await saveSecuritySettings();
    });
  }

  async function getCurrentIP() {
    try {
      const res = await fetch('https://api.ipify.org?format=json');
      const data = await res.json();
      return data.ip || 'Bilinmiyor';
    } catch {
      return 'Bilinmiyor';
    }
  }

  async function saveSecuritySettings() {
    const twoFAEnabled = document.getElementById('toggle-2fa')?.checked || false;
    const ipRestrictionEnabled = document.getElementById('toggle-ip-restrict')?.checked || false;
    const adminEmail = document.getElementById('admin-2fa-email')?.value.trim() || '';
    const twoFAMethod = document.querySelector('input[name="twofa-method"]:checked')?.value || 'email';
    const allowedIPsRaw = document.getElementById('allowed-ips-input')?.value || '';
    const allowedIPs = allowedIPsRaw.split('\n').map(s => s.trim()).filter(Boolean);

    try {
      const fs = await _getFS();
      const { getFirestore, doc, setDoc, serverTimestamp } = fs;
      const db = getFirestore(window.__fbApp);
      await setDoc(doc(db, 'admin_settings', 'security'), {
        twoFAEnabled,
        twoFAMethod,
        adminEmail,
        ipRestrictionEnabled,
        allowedIPs,
        updatedAt: serverTimestamp(),
        updatedBy: Auth.getUID()
      }, { merge: true });
      App.toast('Güvenlik ayarları kaydedildi', 'success');
    } catch (err) {
      App.toast('Hata: ' + err.message, 'error');
    }
  }

  // ════════════════════════════════════════════════════════
  //  TOPLU PAKET DAĞITIM
  // ════════════════════════════════════════════════════════
  async function renderBulkAssign(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const users = await Admin.getAllUsers();
    const plans = await Plans.getPlansConfig();

    container.innerHTML = `
      <div class="bulk-assign-section">
        <h4>🎁 Toplu Paket Atama</h4>
        <p class="hint-text">Seçilen kullanıcılara belirtilen paketi ata.</p>

        <div class="bulk-assign-filters">
          <div class="form-group-sm">
            <label>Filtre (hangi kullanıcılar?)</label>
            <select id="bulk-filter" class="fancy-input">
              <option value="all">Tüm kullanıcılar (${users.length})</option>
              <option value="free">Sadece Free planındakiler</option>
              <option value="expired">Süresi dolmuş abonelikler</option>
            </select>
          </div>
          <div class="form-group-sm">
            <label>Atanacak Plan</label>
            <select id="bulk-plan" class="fancy-input">
              ${Object.entries(plans).map(([id, p]) => `<option value="${id}">${p.icon} ${p.name}</option>`).join('')}
            </select>
          </div>
          <div class="form-group-sm">
            <label>Süre (gün)</label>
            <input type="number" id="bulk-duration" class="fancy-input" value="30" min="1" max="3650"/>
          </div>
        </div>

        <div class="bulk-preview" id="bulk-preview">
          <button class="btn-secondary" id="btn-bulk-preview">Önizle</button>
        </div>

        <div id="bulk-preview-result"></div>
      </div>`;

    document.getElementById('btn-bulk-preview')?.addEventListener('click', async () => {
      const filter = document.getElementById('bulk-filter')?.value;
      const planId = document.getElementById('bulk-plan')?.value;
      const duration = parseInt(document.getElementById('bulk-duration')?.value || '30');
      const planName = plans[planId]?.name || planId;

      let filtered = users;
      if (filter === 'free') filtered = users.filter(u => (u.plan || 'free') === 'free');
      else if (filter === 'expired') filtered = users.filter(u => u.subscriptionEnd?.toDate?.() < new Date());

      const resultEl = document.getElementById('bulk-preview-result');
      if (!resultEl) return;
      resultEl.innerHTML = `
        <div class="bulk-preview-card">
          <p><strong>${filtered.length} kullanıcı</strong> → <strong>${planName}</strong> (${duration} gün)</p>
          <div class="bulk-user-list">
            ${filtered.slice(0, 10).map(u => `<span class="bulk-user-tag">${u.email || u.uid?.slice(0, 8)}</span>`).join('')}
            ${filtered.length > 10 ? `<span class="bulk-more">+${filtered.length - 10} daha</span>` : ''}
          </div>
          <button class="btn-primary btn-sm" id="btn-bulk-confirm">
            <i data-lucide="zap"></i> ${filtered.length} Kullanıcıya Ata
          </button>
        </div>`;
      lucide?.createIcons?.();

      document.getElementById('btn-bulk-confirm')?.addEventListener('click', async () => {
        if (!confirm(`${filtered.length} kullanıcıya ${planName} paketi atanacak. Emin misiniz?`)) return;
        App.setLoading(true, 'Paketler atanıyor...');
        try {
          for (const u of filtered) {
            await Plans.activatePlan(u.id, planId, duration);
          }
          App.toast(`${filtered.length} kullanıcıya ${planName} atandı`, 'success');
          resultEl.innerHTML = '<div class="success-msg">✓ İşlem tamamlandı</div>';
        } catch (err) {
          App.toast('Hata: ' + err.message, 'error');
        } finally {
          App.setLoading(false);
        }
      });
    });
  }

  return {
    renderEconomyDashboard,
    renderPlanEditor,
    renderAdminSecurity,
    renderBulkAssign
  };
})();

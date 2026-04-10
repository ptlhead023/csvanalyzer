// ══════════════════════════════════════════════════════════
//  pricing_ui.js  —  Paket sayfası, upgrade modal, ödeme akışı UI
// ══════════════════════════════════════════════════════════
const PricingUI = (() => {

  // ── Paket kartlarını render et ──────────────────────────
  async function renderPricingCards(containerId, options = {}) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const plans = await Plans.getPlansConfig();
    const uid = Auth.getUID();
    let currentPlan = 'free';
    let planData = null;

    if (uid) {
      planData = await Plans.getUserPlanData(uid);
      currentPlan = planData?.isExpired ? 'free' : (planData?.plan || 'free');
    }

    const planOrder = ['free', 'pro', 'enterprise'];
    container.innerHTML = `
      <div class="pricing-grid">
        ${planOrder.map(planId => {
          const plan = plans[planId];
          if (!plan) return '';
          const isCurrent = planId === currentPlan;
          const isPopular = plan.badge === 'Popüler';
          return `
            <div class="pricing-card ${isCurrent ? 'current' : ''} ${isPopular ? 'popular' : ''}">
              ${isPopular ? '<div class="pricing-badge">⭐ Popüler</div>' : ''}
              ${isCurrent ? '<div class="pricing-badge current-badge">✓ Mevcut Paket</div>' : ''}
              <div class="pricing-card-header">
                <span class="pricing-icon" style="color:${plan.color}">${plan.icon}</span>
                <h3 class="pricing-name">${plan.name}</h3>
                <div class="pricing-price">
                  ${plan.price === 0
                    ? '<span class="price-amount">Ücretsiz</span>'
                    : `<span class="price-amount">₺${plan.price}</span><span class="price-period">/ay</span>`
                  }
                </div>
              </div>
              <ul class="pricing-features">
                ${(plan.features || []).map(f => `<li><span class="feature-check">✓</span>${f}</li>`).join('')}
              </ul>
              <div class="pricing-card-footer">
                ${isCurrent
                  ? `<button class="btn-pricing current-plan-btn" disabled>Aktif Plan</button>`
                  : planId === 'free'
                    ? `<button class="btn-pricing btn-pricing-outline" data-downgrade="${planId}">Ücretsiz'e Geç</button>`
                    : `<button class="btn-pricing btn-pricing-primary" data-upgrade="${planId}" style="--plan-color:${plan.color}">
                        <i data-lucide="zap"></i> ${options.adminMode ? 'Atama' : 'Satın Al'}
                      </button>`
                }
              </div>
            </div>`;
        }).join('')}
      </div>`;

    lucide?.createIcons?.();

    // Event listeners
    container.querySelectorAll('[data-upgrade]').forEach(btn => {
      btn.addEventListener('click', () => {
        const planId = btn.dataset.upgrade;
        if (options.adminMode && options.onAdminAssign) {
          options.onAdminAssign(planId);
        } else {
          showUpgradeModal(planId);
        }
      });
    });

    container.querySelectorAll('[data-downgrade]').forEach(btn => {
      btn.addEventListener('click', () => showDowngradeConfirm(btn.dataset.downgrade));
    });
  }

  // ── Upgrade modal ────────────────────────────────────────
  async function showUpgradeModal(planId) {
    const plans = await Plans.getPlansConfig();
    const plan = plans[planId];
    if (!plan) return;

    let modal = document.getElementById('upgrade-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'upgrade-modal';
      modal.className = 'modal-overlay';
      document.body.appendChild(modal);
    }

    modal.innerHTML = `
      <div class="modal upgrade-modal-inner">
        <div class="upgrade-modal-header">
          <div class="upgrade-plan-badge" style="--plan-color:${plan.color}">
            <span class="upgrade-plan-icon">${plan.icon}</span>
            <span>${plan.name} Pakete Geç</span>
          </div>
          <button class="modal-close" id="btn-close-upgrade-modal"><i data-lucide="x"></i></button>
        </div>

        <div class="upgrade-modal-body">
          <div class="upgrade-price-highlight">
            <span class="upgrade-price-amount">₺${plan.price}</span>
            <span class="upgrade-price-period">/ay</span>
          </div>
          <p class="upgrade-desc">30 günlük erişim. İstediğiniz zaman iptal edebilirsiniz.</p>

          <div class="upgrade-features-list">
            ${(plan.features || []).map(f => `<div class="upgrade-feature"><span>✓</span><span>${f}</span></div>`).join('')}
          </div>

          <div class="payment-methods">
            <h4><i data-lucide="credit-card"></i> Ödeme Yöntemi</h4>
            <div class="payment-method-grid">
              <button class="payment-method-btn active" data-method="credit_card">
                <i data-lucide="credit-card"></i>
                <span>Kredi / Banka Kartı</span>
              </button>
              <button class="payment-method-btn" data-method="bank_transfer">
                <i data-lucide="landmark"></i>
                <span>Havale / EFT</span>
              </button>
            </div>
          </div>

          <!-- Kredi kartı formu -->
          <div class="payment-form" id="payment-form-card">
            <div class="form-row">
              <div class="form-group">
                <label>Kart Üzerindeki İsim</label>
                <input type="text" id="card-name" placeholder="AD SOYAD" class="fancy-input" autocomplete="cc-name"/>
              </div>
            </div>
            <div class="form-row">
              <div class="form-group">
                <label>Kart Numarası</label>
                <input type="text" id="card-number" placeholder="0000 0000 0000 0000" maxlength="19" class="fancy-input" autocomplete="cc-number"/>
              </div>
            </div>
            <div class="form-row two-col">
              <div class="form-group">
                <label>Son Kullanma</label>
                <input type="text" id="card-expiry" placeholder="MM/YY" maxlength="5" class="fancy-input" autocomplete="cc-exp"/>
              </div>
              <div class="form-group">
                <label>CVV</label>
                <input type="text" id="card-cvv" placeholder="000" maxlength="4" class="fancy-input" autocomplete="cc-csc"/>
              </div>
            </div>
            <div class="payment-secure-note">
              <i data-lucide="shield-check"></i>
              <span>256-bit SSL ile şifreli ödeme</span>
            </div>
          </div>

          <!-- Havale formu -->
          <div class="payment-form" id="payment-form-transfer" style="display:none">
            <div class="bank-transfer-info">
              <div class="bank-row"><span>Banka</span><strong>Ziraat Bankası</strong></div>
              <div class="bank-row"><span>IBAN</span><code id="bank-iban">TR00 0000 0000 0000 0000 0000 00</code></div>
              <div class="bank-row"><span>Alıcı</span><strong>DataLens Teknoloji A.Ş.</strong></div>
              <div class="bank-row"><span>Tutar</span><strong>₺${plan.price}</strong></div>
              <div class="bank-row"><span>Açıklama</span><code id="transfer-ref">DL-${Date.now().toString(36).toUpperCase()}</code></div>
            </div>
            <p class="transfer-note">⚠️ Havale sonrası lütfen açıklama kodunu ekleyin. Ödemeniz 1-2 iş günü içinde onaylanır.</p>
          </div>

          <div id="payment-error" class="payment-error" style="display:none"></div>
        </div>

        <div class="upgrade-modal-footer">
          <button class="btn-secondary" id="btn-close-upgrade-modal-2">İptal</button>
          <button class="btn-primary btn-payment-submit" id="btn-submit-payment" style="--plan-color:${plan.color}">
            <i data-lucide="lock"></i>
            <span>₺${plan.price} Öde</span>
          </button>
        </div>
      </div>`;

    modal.style.display = 'flex';
    lucide?.createIcons?.();

    // Card number formatting
    document.getElementById('card-number')?.addEventListener('input', e => {
      e.target.value = e.target.value.replace(/\D/g, '').replace(/(.{4})/g, '$1 ').trim().slice(0, 19);
    });
    document.getElementById('card-expiry')?.addEventListener('input', e => {
      let v = e.target.value.replace(/\D/g, '');
      if (v.length >= 2) v = v.slice(0, 2) + '/' + v.slice(2, 4);
      e.target.value = v;
    });

    // Method switch
    modal.querySelectorAll('.payment-method-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        modal.querySelectorAll('.payment-method-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const method = btn.dataset.method;
        document.getElementById('payment-form-card').style.display = method === 'credit_card' ? 'block' : 'none';
        document.getElementById('payment-form-transfer').style.display = method === 'bank_transfer' ? 'block' : 'none';
        const submitBtn = document.getElementById('btn-submit-payment');
        if (submitBtn) submitBtn.querySelector('span').textContent = method === 'bank_transfer' ? 'Ödedim, Bildir' : `₺${plan.price} Öde`;
      });
    });

    // Close
    ['btn-close-upgrade-modal', 'btn-close-upgrade-modal-2'].forEach(id => {
      document.getElementById(id)?.addEventListener('click', () => { modal.style.display = 'none'; });
    });

    // Submit
    document.getElementById('btn-submit-payment')?.addEventListener('click', async () => {
      await handlePaymentSubmit(planId, plan, modal);
    });
  }

  async function handlePaymentSubmit(planId, plan, modal) {
    const uid = Auth.getUID();
    if (!uid) { App.toast('Giriş yapın', 'warning'); return; }

    const activeMethod = modal.querySelector('.payment-method-btn.active')?.dataset.method || 'credit_card';
    const errEl = document.getElementById('payment-error');
    const submitBtn = document.getElementById('btn-submit-payment');

    if (activeMethod === 'credit_card') {
      const name = document.getElementById('card-name')?.value.trim();
      const number = document.getElementById('card-number')?.value.replace(/\s/g, '');
      const expiry = document.getElementById('card-expiry')?.value;
      const cvv = document.getElementById('card-cvv')?.value;

      if (!name || number.length < 13 || !expiry || cvv.length < 3) {
        if (errEl) { errEl.textContent = 'Lütfen tüm kart bilgilerini eksiksiz girin.'; errEl.style.display = 'block'; }
        return;
      }
      if (errEl) errEl.style.display = 'none';
    }

    // Loading state
    if (submitBtn) { submitBtn.disabled = true; submitBtn.innerHTML = '<i data-lucide="loader"></i> İşleniyor...'; lucide?.createIcons?.(); }

    try {
      const ref = `DL-${Date.now().toString(36).toUpperCase()}`;
      const payDoc = await Plans.createPaymentRecord(uid, planId, plan.price, activeMethod, ref);

      if (activeMethod === 'credit_card') {
        // Simüle: gerçek entegrasyonda Iyzico/Stripe webhook ile onaylanır
        // Demo amaçlı 2sn sonra onaylanıyor gibi davranır
        await new Promise(r => setTimeout(r, 1500));
        await Plans.updatePaymentStatus(payDoc.id, 'confirmed');
        await Plans.activatePlan(uid, planId, 30);
        modal.style.display = 'none';
        showPaymentSuccess(plan);
      } else {
        // Havale: pending kalır, admin onaylar
        modal.style.display = 'none';
        showTransferPending(plan, ref);
      }
    } catch (err) {
      if (errEl) { errEl.textContent = 'Ödeme hatası: ' + err.message; errEl.style.display = 'block'; }
      if (submitBtn) { submitBtn.disabled = false; submitBtn.innerHTML = `<i data-lucide="lock"></i> <span>₺${plan.price} Öde</span>`; lucide?.createIcons?.(); }
    }
  }

  function showPaymentSuccess(plan) {
    let modal = document.getElementById('payment-success-modal');
    if (!modal) { modal = document.createElement('div'); modal.id = 'payment-success-modal'; modal.className = 'modal-overlay'; document.body.appendChild(modal); }
    modal.innerHTML = `
      <div class="modal payment-success-inner">
        <div class="payment-success-icon">✓</div>
        <h2>Ödeme Başarılı!</h2>
        <p><strong>${plan.name}</strong> paketiniz aktifleştirildi.</p>
        <p class="success-sub">30 gün boyunca tüm özelliklere erişebilirsiniz.</p>
        <button class="btn-primary" id="btn-success-close">Harika! Devam Et</button>
      </div>`;
    modal.style.display = 'flex';
    document.getElementById('btn-success-close')?.addEventListener('click', () => {
      modal.style.display = 'none';
      // Paket sayfasını yenile
      renderUserPlanSection('user-plan-section');
    });
  }

  function showTransferPending(plan, ref) {
    let modal = document.getElementById('transfer-pending-modal');
    if (!modal) { modal = document.createElement('div'); modal.id = 'transfer-pending-modal'; modal.className = 'modal-overlay'; document.body.appendChild(modal); }
    modal.innerHTML = `
      <div class="modal transfer-pending-inner">
        <div class="payment-pending-icon">⏳</div>
        <h2>Havale Bildiriminiz Alındı</h2>
        <p>Referans kodum: <strong>${ref}</strong></p>
        <p class="pending-sub">Havale açıklamasına bu kodu eklediğinizden emin olun. 1-2 iş günü içinde planınız aktifleştirilecek.</p>
        <button class="btn-primary" id="btn-pending-close">Tamam</button>
      </div>`;
    modal.style.display = 'flex';
    document.getElementById('btn-pending-close')?.addEventListener('click', () => { modal.style.display = 'none'; });
  }

  function showDowngradeConfirm(planId) {
    if (!confirm('Ücretsiz plana geçmek istediğinizden emin misiniz? Mevcut aboneliğiniz iptal edilecek.')) return;
    const uid = Auth.getUID();
    if (!uid) return;
    Plans.activatePlan(uid, 'free', 36500).then(() => {
      App.toast('Ücretsiz plana geçildi', 'info');
      renderUserPlanSection('user-plan-section');
    });
  }

  // ── Kullanıcı paket durumu bölümü (Ayarlar sekmesi) ──────
  async function renderUserPlanSection(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const uid = Auth.getUID();
    if (!uid) { container.innerHTML = '<p>Giriş yapın</p>'; return; }

    const planData = await Plans.getUserPlanData(uid);
    const plans = await Plans.getPlansConfig();
    const effectivePlan = planData?.isExpired ? 'free' : (planData?.plan || 'free');
    const planDef = plans[effectivePlan] || plans.free;
    const usage = await Plans.getTodayUsage(uid);
    const dailyLimit = planDef.limits?.aiQueriesPerDay || 10;
    const usedToday = usage.aiQueries || 0;
    const usagePct = dailyLimit === Infinity ? 0 : Math.min(100, (usedToday / dailyLimit) * 100);

    const subEnd = planData?.subscriptionEnd?.toDate?.();
    const subEndStr = subEnd ? subEnd.toLocaleDateString('tr-TR') : null;

    container.innerHTML = `
      <div class="user-plan-card">
        <div class="user-plan-header">
          <div class="user-plan-badge" style="--plan-color:${planDef.color}">
            <span>${planDef.icon}</span>
            <span>${planDef.name}</span>
          </div>
          ${planData?.isExpired ? '<span class="plan-expired-tag">⚠️ Süresi Doldu</span>' : ''}
          ${subEndStr && effectivePlan !== 'free' ? `<span class="plan-expiry">📅 ${subEndStr}'e kadar</span>` : ''}
        </div>

        <div class="user-plan-usage">
          <div class="usage-row">
            <span>Günlük AI Sorgu</span>
            <span>${usedToday} / ${dailyLimit === Infinity ? '∞' : dailyLimit}</span>
          </div>
          ${dailyLimit !== Infinity ? `
          <div class="usage-bar-wrap">
            <div class="usage-bar" style="width:${usagePct}%; background:${usagePct > 80 ? '#ef4444' : planDef.color}"></div>
          </div>` : ''}
        </div>

        ${effectivePlan !== 'enterprise' ? `
        <div class="user-plan-upgrade-hint">
          <p>Daha fazlası için paket yükseltin</p>
          <button class="btn-primary btn-sm" id="btn-open-pricing">
            <i data-lucide="zap"></i> Paketleri Gör
          </button>
        </div>` : ''}
      </div>

      <!-- Fiyatlandırma kartları -->
      <div id="pricing-cards-container" style="margin-top:1.5rem"></div>

      <!-- Ödeme Geçmişi -->
      <div class="payment-history-section">
        <h4><i data-lucide="receipt"></i> Ödeme Geçmişi</h4>
        <div id="payment-history-list"><div class="loading-spinner-sm"></div></div>
      </div>`;

    lucide?.createIcons?.();

    document.getElementById('btn-open-pricing')?.addEventListener('click', () => {
      renderPricingCards('pricing-cards-container');
    });

    // Ödeme geçmişini yükle
    Plans.getPaymentHistory(uid).then(payments => {
      const histEl = document.getElementById('payment-history-list');
      if (!histEl) return;
      if (!payments.length) {
        histEl.innerHTML = '<p class="empty-hint">Henüz ödeme bulunmuyor</p>';
        return;
      }
      histEl.innerHTML = `
        <table class="payment-history-table">
          <thead><tr><th>Tarih</th><th>Plan</th><th>Tutar</th><th>Yöntem</th><th>Durum</th></tr></thead>
          <tbody>
            ${payments.map(p => {
              const date = p.createdAt?.toDate?.()?.toLocaleDateString('tr-TR') || '-';
              const statusMap = { pending: '⏳ Bekliyor', confirmed: '✓ Onaylandı', failed: '✗ Başarısız', refunded: '↩ İade' };
              const statusClass = { pending: 'pending', confirmed: 'success', failed: 'error', refunded: 'info' };
              return `<tr>
                <td>${date}</td>
                <td>${p.planId || '-'}</td>
                <td>₺${p.amount || 0}</td>
                <td>${p.method === 'credit_card' ? 'Kart' : 'Havale'}</td>
                <td><span class="status-badge ${statusClass[p.status] || ''}">${statusMap[p.status] || p.status}</span></td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>`;
    }).catch(() => {
      const histEl = document.getElementById('payment-history-list');
      if (histEl) histEl.innerHTML = '<p class="empty-hint">Yüklenemedi</p>';
    });
  }

  return { renderPricingCards, renderUserPlanSection, showUpgradeModal };
})();

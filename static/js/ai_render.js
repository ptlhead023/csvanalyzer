// ══════════════════════════════════════════════════════════
//  ai_render.js  —  AI panel UI, API manager, quota modal,
//                   chat assistant, model-selector modal
// ══════════════════════════════════════════════════════════
const AIRender = (() => {

  // ── System prompt: Gemini is a COORDINATOR, not a calculator ──
  const SYSTEM_PROMPT = `Sen DataLens adlı CSV analiz platformunun asistanısın. Adın "Lens".

TEMEL KURALLAR:
1. Hesaplamaları SEN yapma — bunlar Python backend tarafından yapılır.
2. Kullanıcıyla Türkçe sohbet et. Samimi, kısa ve net ol.
3. Kullanıcının amacını anlamak için sorular sor.
4. Analiz parametrelerini (hangi sütunlar, satır aralığı, tahmin dönemi vb.) kullanıcıyla birlikte belirle.
5. Gruplama önerilerinde sütunları mantıksal kategorilere göre sınıflandır.
6. Yorum yaparken tablodaki örüntüleri, anormallikleri ve trendleri anlat.
7. JSON cevabı gereken yerlerde SADECE geçerli JSON döndür, başka açıklama ekleme.

SEN BİR KOORDİNATÖRSÜN: Kullanıcıya hangi analizi yapacağını, hangi sütunları seçeceğini, ne aradığını sormak senin işin. Hesaplamalar Python'a bırakılır.`;

  // ── Chat state ───────────────────────────────────────────
  let _chatHistory = [];
  let _pendingContinuation = null; // işlemi quota dolunca sakla

  function buildDataSummary(headers, rows) {
    const lines = [`Tablo başlıkları: ${headers.join(', ')}`, `Satır sayısı: ${rows.length}`, 'Satırlar (ilk 20):'];
    rows.slice(0, 20).forEach(r => lines.push(headers.map((h, i) => `${h}:${r[i] ?? ''}`).join(' | ')));
    return lines.join('\n');
  }

  function parseJSON(text) {
    try {
      const clean = text.replace(/```json|```/g, '').trim();
      const s = clean.search(/[\[{]/);
      if (s === -1) throw new Error('JSON bulunamadı');
      const isArr = clean[s] === '[';
      const e = isArr ? clean.lastIndexOf(']') : clean.lastIndexOf('}');
      return JSON.parse(clean.slice(s, e + 1));
    } catch { throw new Error('AI yanıtı geçersiz JSON'); }
  }

  // ── Error → modal handler ────────────────────────────────
  function handleAIError(err, continuation) {
    if (err.type === 'no_api') {
      openAddAPIModal();
    } else if (err.type === 'all_quota') {
      _pendingContinuation = continuation || null;
      showQuotaModal(err.apis);
    } else {
      App.toast('AI Hatası: ' + (err.message || String(err)), 'error');
    }
  }

  // ════════════════════════════════════════════════
  //  KOTA MODAL
  // ════════════════════════════════════════════════
  function showQuotaModal(apis) {
    const modal = document.getElementById('quota-exhausted-modal');
    const list  = document.getElementById('quota-api-list');
    if (!modal || !list) return;
    list.innerHTML = '';
    (apis || []).forEach(api => {
      const el = document.createElement('div');
      el.className = 'quota-api-item';
      el.innerHTML = `
        <div class="quota-api-item-dot"></div>
        <div class="quota-api-item-info">
          <div class="quota-api-item-name">${api.name || 'İsimsiz API'}</div>
          <div class="quota-api-item-model">${api.provider} · ${api.model}</div>
        </div>
        <button class="btn-quota-reset-single" data-id="${api.id}">Sıfırla</button>`;
      el.querySelector('[data-id]').addEventListener('click', async (e) => {
        const id = e.currentTarget.dataset.id;
        await AIManager.resetQuota(id);
        App.toast('Kota sıfırlandı', 'success');
        modal.style.display = 'none';
        if (_pendingContinuation) { _pendingContinuation(); _pendingContinuation = null; }
      });
      list.appendChild(el);
    });
    modal.style.display = 'flex';
    lucide.createIcons();
  }

  function closeQuotaModal() {
    const m = document.getElementById('quota-exhausted-modal');
    if (m) m.style.display = 'none';
  }

  // ════════════════════════════════════════════════
  //  API EKLE MODAL — 3 adımlı Gemini akışı
  // ════════════════════════════════════════════════
  let _selectedProvider = 'gemini';
  let _selectedModel    = null;
  let _fetchedModels    = [];

  function openAddAPIModal() {
    const modal = document.getElementById('add-api-modal');
    if (!modal) return;
    // reset
    _selectedProvider = 'gemini';
    _selectedModel    = null;
    _fetchedModels    = [];
    document.getElementById('modal-api-key').value   = '';
    document.getElementById('modal-api-name').value  = '';
    document.getElementById('modal-model-grid').innerHTML = '<div class="model-grid-empty">← Önce API anahtarı girin ve "Modelleri Çek"e tıklayın</div>';
    document.getElementById('modal-step1-status').textContent = '';
    document.getElementById('modal-step1-status').className   = 'api-step-status';
    const testResult = document.getElementById('modal-test-result');
    if (testResult) testResult.style.display = 'none';
    document.getElementById('btn-test-modal-api').disabled  = true;
    document.getElementById('btn-save-modal-api').disabled  = true;
    // step states
    _setStepState(1, 'active');
    _setStepState(2, 'locked');
    _setStepState(3, 'locked');
    modal.style.display = 'flex';
    lucide.createIcons();
  }

  function _setStepState(n, state) {
    const el = document.getElementById(`api-step-${n}`);
    if (!el) return;
    el.classList.remove('api-step-active', 'api-step-locked', 'api-step-done');
    if (state === 'active') el.classList.add('api-step-active');
    else if (state === 'locked') el.classList.add('api-step-locked');
    else if (state === 'done') el.classList.add('api-step-done');
  }

  function _renderModelGrid(models) {
    const grid = document.getElementById('modal-model-grid');
    if (!grid) return;
    grid.innerHTML = '';
    if (!models.length) {
      grid.innerHTML = '<div class="model-grid-empty">Bu API için uyumlu model bulunamadı.</div>';
      return;
    }
    models.forEach(m => {
      const card = document.createElement('div');
      card.className = 'model-card';
      card.dataset.id = m.id;
      const badgeClass = m.thinking ? 'thinking' : m.free ? 'free' : 'paid';
      const badgeText  = m.thinking ? '🧠' : m.free ? 'Ücretsiz' : 'Pro';
      card.innerHTML = `
        <div class="model-card-badge ${badgeClass}">${badgeText}</div>
        <div class="model-card-label">${m.label}</div>
        <div class="model-card-name">${m.id}</div>
        <div class="model-card-note">${m.note || ''}</div>`;
      card.addEventListener('click', () => {
        document.querySelectorAll('.model-card').forEach(c => c.classList.remove('selected'));
        card.classList.add('selected');
        _selectedModel = m.id;
        _setStepState(2, 'done');
        _setStepState(3, 'active');
        document.getElementById('btn-test-modal-api').disabled = false;
        document.getElementById('btn-save-modal-api').disabled = false;
      });
      grid.appendChild(card);
    });
  }

  function _initAddAPIModal() {
    // Provider tabs
    document.querySelectorAll('.provider-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.provider-tab').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        _selectedProvider = btn.dataset.provider;
        _selectedModel    = null;
        _fetchedModels    = [];
        document.getElementById('modal-model-grid').innerHTML = '<div class="model-grid-empty">← API anahtarını girin ve "Modelleri Çek"e tıklayın</div>';
        _setStepState(2, 'locked');
        _setStepState(3, 'locked');
        document.getElementById('btn-test-modal-api').disabled = true;
        document.getElementById('btn-save-modal-api').disabled = true;
        // Update help link
        const helpLink = document.getElementById('api-key-help-link');
        if (helpLink) {
          helpLink.href = _selectedProvider === 'gemini'
            ? 'https://aistudio.google.com/app/apikey'
            : 'https://platform.openai.com/api-keys';
          helpLink.textContent = _selectedProvider === 'gemini'
            ? ' Gemini API anahtarı nasıl alınır?'
            : ' OpenAI API anahtarı nasıl alınır?';
        }
        // OpenAI: no fetch needed, show static models
        if (_selectedProvider === 'openai') {
          document.getElementById('modal-fetch-models-row').style.display = 'none';
          const staticModels = [
            { id: 'gpt-4o-mini', label: 'GPT-4o Mini', free: false, note: 'Hızlı ve ucuz' },
            { id: 'gpt-4o',      label: 'GPT-4o',      free: false, note: 'Güçlü' },
            { id: 'gpt-3.5-turbo', label: 'GPT-3.5 Turbo', free: false, note: 'Eski ama hızlı' }
          ];
          _fetchedModels = staticModels;
          _renderModelGrid(staticModels);
          _setStepState(2, 'active');
        } else {
          document.getElementById('modal-fetch-models-row').style.display = 'flex';
        }
      });
    });

    // Eye toggle
    document.getElementById('btn-toggle-key-visibility')?.addEventListener('click', () => {
      const inp = document.getElementById('modal-api-key');
      inp.type = inp.type === 'password' ? 'text' : 'password';
    });

    // Fetch models
    document.getElementById('btn-fetch-models')?.addEventListener('click', async () => {
      const key = document.getElementById('modal-api-key').value.trim();
      if (!key) {
        _setStatus(1, 'err', '⚠ Önce API anahtarını girin');
        return;
      }
      _setStatus(1, 'loading', '⏳ Modeller yükleniyor...');
      document.getElementById('btn-fetch-models').disabled = true;
      try {
        const models = await AIManager.fetchGeminiModels(key);
        _fetchedModels = models;
        _renderModelGrid(models);
        _setStepState(1, 'done');
        _setStepState(2, 'active');
        _setStatus(1, 'ok', `✓ ${models.length} model bulundu`);
      } catch (e) {
        _setStatus(1, 'err', '✗ ' + e.message);
      } finally {
        document.getElementById('btn-fetch-models').disabled = false;
      }
    });

    // Test
    document.getElementById('btn-test-modal-api')?.addEventListener('click', async () => {
      const key = document.getElementById('modal-api-key').value.trim();
      if (!key || !_selectedModel) return;
      const resultEl = document.getElementById('modal-test-result');
      resultEl.style.display = 'flex';
      resultEl.className = 'test-result';
      resultEl.innerHTML = '<div class="auth-spinner" style="width:14px;height:14px;border-width:1.5px"></div> Test ediliyor...';
      try {
        await AIManager.testAPI(_selectedProvider, key, _selectedModel);
        resultEl.className = 'test-result ok';
        resultEl.innerHTML = '✓ Bağlantı başarılı! Model yanıt veriyor.';
        _setStepState(3, 'done');
      } catch (e) {
        resultEl.className = 'test-result err';
        resultEl.innerHTML = '✗ ' + e.message;
      }
    });

    // Save
    document.getElementById('btn-save-modal-api')?.addEventListener('click', async () => {
      const key  = document.getElementById('modal-api-key').value.trim();
      const name = document.getElementById('modal-api-name').value.trim();
      if (!key || !_selectedModel) return;
      const btn = document.getElementById('btn-save-modal-api');
      btn.disabled = true;
      btn.innerHTML = '<div class="auth-spinner" style="width:14px;height:14px;border-width:1.5px"></div> Kaydediliyor...';
      try {
        await AIManager.addAPI({
          provider: _selectedProvider,
          key,
          model: _selectedModel,
          name: name || `${_selectedProvider === 'gemini' ? 'Gemini' : 'OpenAI'} · ${_selectedModel}`
        });
        document.getElementById('add-api-modal').style.display = 'none';
        App.toast('API bağlantısı eklendi', 'success');
        renderAPIManager();
        if (_pendingContinuation) {
          setTimeout(() => { _pendingContinuation(); _pendingContinuation = null; }, 300);
        }
      } catch (e) {
        App.toast('Kayıt hatası: ' + e.message, 'error');
        btn.disabled = false;
        btn.innerHTML = '<i data-lucide="save"></i> Kaydet ve Aktifleştir';
        lucide.createIcons();
      }
    });

    // Close buttons
    document.getElementById('btn-close-add-api-modal')?.addEventListener('click', () => {
      document.getElementById('add-api-modal').style.display = 'none';
    });
    document.getElementById('btn-cancel-add-api')?.addEventListener('click', () => {
      document.getElementById('add-api-modal').style.display = 'none';
    });
  }

  function _setStatus(step, type, msg) {
    const el = document.getElementById(`modal-step${step}-status`);
    if (!el) return;
    el.textContent = msg;
    el.className = 'api-step-status ' + (type === 'loading' ? 'loading' : type === 'ok' ? 'ok' : 'err');
  }

  // ════════════════════════════════════════════════
  //  API MANAGER (settings panel)
  // ════════════════════════════════════════════════
  async function renderAPIManager() {
    const container = document.getElementById('api-manager-container');
    const footer    = document.getElementById('api-manager-footer');
    const emptyState = document.getElementById('api-empty-state');
    if (!container) return;

    const apis = await AIManager.getAPIs();

    if (!apis.length) {
      if (emptyState) emptyState.style.display = 'flex';
      if (footer) footer.style.display = 'none';
      return;
    }

    if (emptyState) emptyState.style.display = 'none';
    if (footer) footer.style.display = 'flex';

    // Remove old cards (keep empty state div)
    container.querySelectorAll('.api-card').forEach(c => c.remove());

    apis.forEach((api, idx) => {
      const card = document.createElement('div');
      const isQuota = api.quotaExhausted;
      const isFirst = idx === 0 && !isQuota;
      card.className = `api-card${isQuota ? ' quota-exhausted' : ''}${isFirst ? ' active-api' : ''}`;
      const usageStr = api.usageCount ? `${api.usageCount} istek` : '—';
      card.innerHTML = `
        <div class="api-card-header">
          <div class="api-card-info">
            <div class="api-card-name">${api.name || 'İsimsiz API'}</div>
            <div class="api-card-provider">${api.provider} · <span style="font-family:'JetBrains Mono',monospace;font-size:11px">${api.model}</span></div>
          </div>
          <div class="api-card-actions">
            ${isQuota ? `<span class="api-badge warn">Kota Doldu</span>` : isFirst ? `<span class="api-badge next">Aktif</span>` : `<span class="api-badge ok">Hazır</span>`}
            ${isQuota ? `<button class="btn-xs" data-reset="${api.id}"><i data-lucide="refresh-cw"></i></button>` : ''}
            <button class="btn-xs danger" data-del="${api.id}"><i data-lucide="trash-2"></i></button>
          </div>
        </div>
        <div class="api-card-stats">İstek: ${usageStr} · Eklenme: ${api.createdAt?.toDate?.()?.toLocaleDateString('tr-TR') || '—'}</div>`;
      card.querySelector('[data-del]')?.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (!confirm('Bu API bağlantısını silmek istiyor musunuz?')) return;
        await AIManager.removeAPI(api.id);
        renderAPIManager();
        App.toast('API silindi', 'info');
      });
      card.querySelector('[data-reset]')?.addEventListener('click', async (e) => {
        e.stopPropagation();
        await AIManager.resetQuota(api.id);
        renderAPIManager();
        App.toast('Kota sıfırlandı', 'success');
      });
      container.appendChild(card);
    });
    lucide.createIcons();
  }

  // ════════════════════════════════════════════════
  //  AI CHAT PANEL (Gemini asistan)
  // ════════════════════════════════════════════════
  function _buildChatPanel() {
    const existing = document.getElementById('ai-chat-panel');
    if (existing) return;
    const panel = document.getElementById('ai-analysis-panel');
    if (!panel) return;

    // Replace the old two-column input with chat panel
    panel.innerHTML = `
      <div class="ai-panel-header">
        <h3><i data-lucide="brain"></i> AI Asistan</h3>
        <span class="ai-panel-hint">Gemini ile veri üzerine sohbet et</span>
      </div>
      <div class="ai-chat-panel" id="ai-chat-panel">
        <div class="ai-chat-header">
          <i data-lucide="bot"></i>
          <span class="ai-chat-title">Lens</span>
          <span class="ai-chat-model-badge" id="ai-chat-model-badge">—</span>
        </div>
        <div class="ai-chat-messages" id="ai-chat-messages">
          <div class="ai-msg">
            <div class="ai-msg-avatar">◈</div>
            <div class="ai-msg-bubble">Merhaba! Ben Lens. CSV tablonuzu analiz etmeme yardımcı olabilirim. Ne yapmak istersiniz?</div>
          </div>
        </div>
        <div class="ai-chat-suggestions" id="ai-chat-suggestions">
          <button class="ai-suggestion-chip" data-msg="Tablodaki trendleri analiz et">📈 Trendleri analiz et</button>
          <button class="ai-suggestion-chip" data-msg="Sütunları mantıklı gruplara ayır">📂 Gruplar öner</button>
          <button class="ai-suggestion-chip" data-msg="Tabloda anormal değerler var mı?">⚠ Anomali ara</button>
          <button class="ai-suggestion-chip" data-msg="Hangi sütunlar arasında korelasyon var?">🔗 Korelasyon bul</button>
        </div>
        <div class="ai-chat-input-area">
          <textarea class="ai-chat-input" id="ai-chat-input" placeholder="Tablonuz hakkında bir şey sorun..." rows="1"></textarea>
          <button class="btn-chat-send" id="btn-chat-send"><i data-lucide="send"></i></button>
        </div>
      </div>`;
    lucide.createIcons();
    _initChatEvents();
  }

  async function _updateModelBadge() {
    const badge = document.getElementById('ai-chat-model-badge');
    if (!badge) return;
    const apis = await AIManager.getAPIs();
    const active = apis.find(a => !a.quotaExhausted);
    badge.textContent = active ? active.model : 'API yok';
  }

  function _initChatEvents() {
    const input   = document.getElementById('ai-chat-input');
    const sendBtn = document.getElementById('btn-chat-send');

    // Auto-resize textarea
    input?.addEventListener('input', () => {
      input.style.height = '38px';
      input.style.height = Math.min(input.scrollHeight, 100) + 'px';
    });

    input?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); _sendChatMessage(); }
    });

    sendBtn?.addEventListener('click', _sendChatMessage);

    // Suggestion chips
    document.querySelectorAll('.ai-suggestion-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        const msg = chip.dataset.msg;
        if (input) input.value = msg;
        _sendChatMessage();
        // Hide suggestions after first use
        const sug = document.getElementById('ai-chat-suggestions');
        if (sug) sug.style.display = 'none';
      });
    });
  }

  function _appendMessage(role, text) {
    const container = document.getElementById('ai-chat-messages');
    if (!container) return;
    const div = document.createElement('div');
    div.className = 'ai-msg' + (role === 'user' ? ' ai-msg-user' : '');
    const initials = Auth.getUser()?.displayName?.split(' ').map(w => w[0]).join('').slice(0,2).toUpperCase() || 'SN';
    div.innerHTML = `
      <div class="ai-msg-avatar">${role === 'user' ? initials : '◈'}</div>
      <div class="ai-msg-bubble">${text.replace(/\n/g, '<br>')}</div>`;
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
  }

  function _appendTyping() {
    const container = document.getElementById('ai-chat-messages');
    if (!container) return;
    const div = document.createElement('div');
    div.className = 'ai-msg';
    div.id = 'ai-typing-indicator';
    div.innerHTML = `
      <div class="ai-msg-avatar">◈</div>
      <div class="ai-typing">
        <div class="ai-typing-dot"></div>
        <div class="ai-typing-dot"></div>
        <div class="ai-typing-dot"></div>
      </div>`;
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
  }

  function _removeTyping() {
    document.getElementById('ai-typing-indicator')?.remove();
  }

  async function _sendChatMessage() {
    const input = document.getElementById('ai-chat-input');
    if (!input) return;
    const text = input.value.trim();
    if (!text) return;

    const hasAPIs = await AIManager.hasAPIs();
    if (!hasAPIs) { openAddAPIModal(); return; }

    input.value = '';
    input.style.height = '38px';

    // Add table context to first message
    let userContent = text;
    const headers = typeof Editor !== 'undefined' ? Editor.getHeaders() : [];
    const rows    = typeof Editor !== 'undefined' ? Editor.getRows() : [];
    if (_chatHistory.length === 0 && headers.length) {
      userContent = `Tablo bağlamı:\n${buildDataSummary(headers, rows)}\n\nKullanıcı: ${text}`;
    }

    _chatHistory.push({ role: 'user', content: userContent });
    _appendMessage('user', text);
    document.getElementById('btn-chat-send').disabled = true;
    _appendTyping();

    const doCall = async () => {
      try {
        const result = await AIManager.call(_chatHistory, SYSTEM_PROMPT);
        _removeTyping();
        const reply = result.text;
        _chatHistory.push({ role: 'assistant', content: reply });
        _appendMessage('assistant', reply);
        _updateModelBadge();
      } catch (err) {
        _removeTyping();
        handleAIError(err, doCall);
      } finally {
        const btn = document.getElementById('btn-chat-send');
        if (btn) btn.disabled = false;
      }
    };

    await doCall();
  }

  // ════════════════════════════════════════════════
  //  GROUP SUGGESTIONS
  // ════════════════════════════════════════════════
  async function suggestGroups() {
    const hasAPIs = await AIManager.hasAPIs();
    if (!hasAPIs) { openAddAPIModal(); return; }
    const headers = Editor.getHeaders();
    const rows    = Editor.getRows();
    if (!headers.length) { App.toast('Önce veri yükleyin', 'warning'); return; }
    App.setLoading(true, 'AI gruplama önerileri hazırlanıyor...');
    const doCall = async () => {
      try {
        const prompt = `Aşağıdaki tabloyu analiz et ve mantıklı sütun grupları öner.\n\n${buildDataSummary(headers, rows)}\n\nYanıt (JSON dizi, başka bir şey ekleme):\n[{"name":"Grup Adı","color":"#hexrenk","columns":["sütun1"],"reason":"kısa açıklama"}]`;
        const result = await AIManager.call([{ role: 'user', content: prompt }], SYSTEM_PROMPT);
        const groups = parseJSON(result.text);
        if (!Array.isArray(groups) || !groups.length) throw new Error('Geçersiz yanıt formatı');
        showGroupSuggestions(groups);
      } catch (err) {
        handleAIError(err, doCall);
      } finally {
        App.setLoading(false);
      }
    };
    await doCall();
  }

  function showGroupSuggestions(suggestions) {
    const modal = document.getElementById('ai-suggestions-modal');
    const body  = document.getElementById('ai-suggestions-body');
    if (!modal || !body) return;
    body.innerHTML = '';
    suggestions.forEach((g, i) => {
      const card = document.createElement('div');
      card.className = 'ai-suggestion-card';
      card.innerHTML = `
        <div class="ai-sug-header">
          <span class="ai-sug-dot" style="background:${g.color || '#8b5cf6'}"></span>
          <strong>${g.name}</strong>
          <label class="ai-sug-check"><input type="checkbox" checked data-idx="${i}" /> Ekle</label>
        </div>
        <div class="ai-sug-cols">${(g.columns || []).join(' · ')}</div>
        <div class="ai-sug-reason">${g.reason || ''}</div>`;
      body.appendChild(card);
    });
    document.getElementById('btn-apply-suggestions').onclick = () => {
      const checked = [...body.querySelectorAll('input:checked')];
      checked.forEach(cb => { const g = suggestions[parseInt(cb.dataset.idx)]; if (g) GroupManager.addFromAI(g); });
      modal.style.display = 'none';
      App.toast(`${checked.length} grup eklendi`, 'success');
    };
    modal.style.display = 'flex';
  }

  // ════════════════════════════════════════════════
  //  RESULTS INTERPRETATION
  // ════════════════════════════════════════════════
  async function interpretResults(result) {
    const hasAPIs = await AIManager.hasAPIs();
    if (!hasAPIs) return null;
    try {
      const summary = JSON.stringify(result).slice(0, 4000);
      const prompt  = `Aşağıdaki analiz sonuçlarını yorumla. headline (ana çıkarım), keyPoints (önemli noktalar, dizi), warnings (uyarılar, dizi), recommendations (öneriler, dizi) alanlarını içeren JSON döndür.\n\n${summary}\n\nYanıt (sadece JSON):`;
      const r = await AIManager.call([{ role: 'user', content: prompt }], SYSTEM_PROMPT);
      return parseJSON(r.text);
    } catch { return null; }
  }

  function renderAIInterpretation(interp) {
    const panel = document.getElementById('ai-interpretation-panel');
    if (!panel || !interp) return;
    panel.innerHTML = `
      <div class="interp-headline">${interp.headline || ''}</div>
      ${interp.keyPoints?.length ? `<div class="interp-section"><strong>📌 Önemli Noktalar</strong><ul>${interp.keyPoints.map(p => `<li>${p}</li>`).join('')}</ul></div>` : ''}
      ${interp.warnings?.length  ? `<div class="interp-section warn"><strong>⚠ Uyarılar</strong><ul>${interp.warnings.map(w => `<li>${w}</li>`).join('')}</ul></div>` : ''}
      ${interp.recommendations?.length ? `<div class="interp-section"><strong>💡 Öneriler</strong><ul>${interp.recommendations.map(r => `<li>${r}</li>`).join('')}</ul></div>` : ''}`;
    panel.style.display = 'block';
  }

  // ════════════════════════════════════════════════
  //  INIT
  // ════════════════════════════════════════════════
  function initAIPanel() {
    _buildChatPanel();
    _initAddAPIModal();
    _initQuotaModalEvents();
    _updateModelBadge();

    // Bind group suggest button
    document.getElementById('btn-ai-suggest-groups')?.addEventListener('click', suggestGroups);
    // Bind AI interpret results button
    document.getElementById('btn-ai-interpret-results')?.addEventListener('click', async () => {
      const result = Charts.getResult?.();
      if (!result) { App.toast('Önce analiz yapın', 'warning'); return; }
      App.setLoading(true, 'AI yorumu hazırlanıyor...');
      const interp = await interpretResults(result);
      App.setLoading(false);
      if (interp) renderAIInterpretation(interp);
      else App.toast('Yorum alınamadı', 'error');
    });

    // Settings open API button
    document.getElementById('btn-open-add-api-modal')?.addEventListener('click', openAddAPIModal);
  }

  function _initQuotaModalEvents() {
    document.getElementById('btn-quota-add-new')?.addEventListener('click', () => {
      closeQuotaModal();
      openAddAPIModal();
    });
    document.getElementById('btn-quota-reset-all')?.addEventListener('click', async () => {
      await AIManager.resetAllQuotas();
      closeQuotaModal();
      App.toast('Tüm kotalar sıfırlandı', 'success');
      if (_pendingContinuation) { setTimeout(() => { _pendingContinuation(); _pendingContinuation = null; }, 300); }
    });
    document.getElementById('btn-quota-dismiss')?.addEventListener('click', () => {
      closeQuotaModal();
      _pendingContinuation = null;
    });
  }

  return {
    initAIPanel, renderAPIManager, suggestGroups,
    interpretResults, renderAIInterpretation,
    showQuotaModal, closeQuotaModal,
    openAddAPIModal
  };
})();

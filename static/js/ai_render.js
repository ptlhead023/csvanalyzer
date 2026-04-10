const AIRender = (() => {
  const SYSTEM_PROMPT = `Sen DataLens adlı bir veri analiz asistanısın. Kullanıcının tablo verilerini analiz eder, gruplar önerir, trendleri yorumlar ve piyasa/risk araştırması yaparsın. Yanıtlarını her zaman geçerli JSON olarak döndür, ek açıklama ekleme. Türkçe konuş.`;

  function buildDataSummary(headers, rows) {
    const lines = [`Tablo başlıkları: ${headers.join(', ')}`, `Satır sayısı: ${rows.length}`, 'Satırlar (ilk 30):'];
    rows.slice(0, 30).forEach(r => lines.push(headers.map((h, i) => `${h}:${r[i] ?? ''}`).join(' | ')));
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

  function handleAIError(err) {
    if (err.type === 'no_api') showNoAPIModal();
    else if (err.type === 'all_quota') showAllQuotaModal(err.apis);
    else App.toast('AI Hatası: ' + (err.message || String(err)), 'error');
  }

  function showNoAPIModal() {
    document.getElementById('api-setup-modal').style.display = 'flex';
  }

  function showAllQuotaModal(apis) {
    const modal = document.getElementById('quota-exhausted-modal');
    const list = document.getElementById('quota-api-list');
    if (!modal || !list) return;
    list.innerHTML = '';
    (apis || []).forEach(api => {
      const row = document.createElement('div');
      row.className = 'quota-api-row';
      row.innerHTML = `<span class="quota-api-name">${api.name}</span>
        <span class="quota-api-model">${api.model}</span>
        <button class="btn-xs" onclick="AIManager.resetQuota('${api.id}');AIRender.closeQuotaModal()">Kotayı Sıfırla</button>`;
      list.appendChild(row);
    });
    modal.style.display = 'flex';
  }

  function closeQuotaModal() {
    const m = document.getElementById('quota-exhausted-modal');
    if (m) m.style.display = 'none';
  }

  async function suggestGroups() {
    if (!AIManager.hasAPIs()) { showNoAPIModal(); return; }
    const headers = Editor.getHeaders();
    const rows = Editor.getRows();
    if (!headers.length) { App.toast('Önce veri yükleyin', 'warning'); return; }
    App.setLoading(true, 'AI gruplama önerileri hazırlanıyor...');
    try {
      const dataSummary = buildDataSummary(headers, rows);
      const prompt = `Aşağıdaki tabloyu analiz et ve mantıklı sütun grupları öner. Konuya veya ilişkiye göre birleştir.\n\n${dataSummary}\n\nYanıt (JSON dizi, başka bir şey ekleme):\n[{"name":"Grup Adı","color":"#hexrenk","columns":["sütun1","sütun2"],"reason":"kısa açıklama"}]`;
      const result = await AIManager.call([{ role: 'user', content: prompt }], SYSTEM_PROMPT);
      const groups = parseJSON(result.text);
      if (!Array.isArray(groups) || !groups.length) throw new Error('Geçersiz yanıt formatı');
      showGroupSuggestions(groups);
    } catch (err) { handleAIError(err); }
    finally { App.setLoading(false); }
  }

  function showGroupSuggestions(suggestions) {
    const modal = document.getElementById('ai-suggestions-modal');
    const body = document.getElementById('ai-suggestions-body');
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

  async function analyzeWithAI(prompt) {
    if (!AIManager.hasAPIs()) { showNoAPIModal(); return null; }
    const headers = Editor.getHeaders();
    const rows = Editor.getRows();
    const dataSummary = buildDataSummary(headers, rows);
    const fullPrompt = `${dataSummary}\n\nKullanıcı sorusu: ${prompt}\n\nAçıklayıcı metin olarak yanıtla, JSON gerekmez.`;
    App.setLoading(true, 'AI analiz yapıyor...');
    try {
      const result = await AIManager.call([{ role: 'user', content: fullPrompt }], SYSTEM_PROMPT);
      return result.text;
    } catch (err) { handleAIError(err); return null; }
    finally { App.setLoading(false); }
  }

  async function researchTopic(topic) {
    if (!AIManager.hasAPIs()) { showNoAPIModal(); return null; }
    App.setLoading(true, `"${topic}" araştırılıyor...`);
    try {
      const prompt = `Aşağıdaki konuyu araştır. Sayısal değerler, risk faktörleri ve güncel trendler hakkında özet ver.\n\nKonu: ${topic}\n\nYanıt (JSON, başka bir şey ekleme):\n{"summary":"özet","indicators":[{"name":"gösterge","value":"değer","risk":"low|medium|high"}],"trend":"artış|düşüş|stabil","sources":["kaynak notu"]}`;
      const result = await AIManager.call([{ role: 'user', content: prompt }], SYSTEM_PROMPT);
      return parseJSON(result.text);
    } catch (err) { handleAIError(err); return null; }
    finally { App.setLoading(false); }
  }

  async function interpretResults(analysisResult) {
    if (!AIManager.hasAPIs()) return null;
    App.setLoading(true, 'AI sonuçları yorumluyor...');
    try {
      const summary = JSON.stringify({ meta: analysisResult.meta, trend: analysisResult.trend, groups: analysisResult.groups }, null, 2).slice(0, 3000);
      const prompt = `Aşağıdaki analiz sonuçlarını yorumla. Önemli bulgular, uyarılar ve öneriler sun.\n\nAnaliz:\n${summary}\n\nYanıt (JSON, başka bir şey ekleme):\n{"headline":"tek cümle özet","findings":["bulgu1"],"warnings":["uyarı1"],"suggestions":["öneri1"]}`;
      const result = await AIManager.call([{ role: 'user', content: prompt }], SYSTEM_PROMPT);
      return parseJSON(result.text);
    } catch (err) { return null; }
    finally { App.setLoading(false); }
  }

  function renderAPIManager() {
    const container = document.getElementById('api-manager-container');
    if (!container) return;
    const apis = AIManager.getAPIs();
    const activeIdx = AIManager.getActiveIndex();
    container.innerHTML = '';
    if (!apis.length) {
      container.innerHTML = '<div class="api-empty">Henüz API eklenmedi. Aşağıdan ekleyin.</div>';
      return;
    }
    const activeList = apis.filter(a => !a.quotaExhausted);
    apis.forEach((api, i) => {
      const reg = AIManager.getRegistry()[api.provider] || {};
      const isNext = activeList.length > 0 && activeList[AIManager.getActiveIndex() % activeList.length]?.id === api.id;
      const card = document.createElement('div');
      card.className = 'api-card' + (api.quotaExhausted ? ' quota-exhausted' : '');
      card.innerHTML = `
        <div class="api-card-header">
          <div class="api-card-info">
            <span class="api-card-name">${api.name}</span>
            <span class="api-card-provider">${reg.label || api.provider} · ${api.model}</span>
          </div>
          <div class="api-card-actions">
            ${isNext && !api.quotaExhausted ? '<span class="api-badge next">Sıradaki</span>' : ''}
            ${api.quotaExhausted ? '<span class="api-badge warn">Kota Doldu</span>' : '<span class="api-badge ok">Aktif</span>'}
            ${api.quotaExhausted ? `<button class="btn-xs" onclick="AIManager.resetQuota('${api.id}');AIRender.renderAPIManager()">Sıfırla</button>` : ''}
            <button class="btn-xs danger" onclick="if(confirm('Silinsin mi?')){AIManager.removeAPI('${api.id}');AIRender.renderAPIManager()}">Sil</button>
          </div>
        </div>
        <div class="api-card-stats">Toplam kullanım: ${api.usageCount || 0} istek</div>`;
      container.appendChild(card);
    });
  }

  function renderResearchPanel(data) {
    const panel = document.getElementById('research-panel');
    if (!panel || !data) return;
    panel.style.display = 'block';
    panel.innerHTML = `
      <div class="research-headline">${data.summary || ''}</div>
      <div class="research-trend">Trend: <strong>${data.trend || '—'}</strong></div>
      ${(data.indicators || []).map(ind => `
        <div class="research-indicator risk-${ind.risk || 'low'}">
          <span class="ri-name">${ind.name}</span>
          <span class="ri-value">${ind.value}</span>
          <span class="ri-risk">${ind.risk === 'high' ? '⚠ Yüksek' : ind.risk === 'medium' ? '~ Orta' : '✓ Düşük'}</span>
        </div>`).join('')}
      ${data.sources?.length ? `<div class="research-sources">Not: ${data.sources.join(' | ')}</div>` : ''}`;
  }

  function renderAIInterpretation(data) {
    const panel = document.getElementById('ai-interpretation-panel');
    if (!panel || !data) return;
    panel.style.display = 'block';
    panel.innerHTML = `
      <div class="interp-headline">${data.headline || ''}</div>
      ${data.findings?.length ? `<div class="interp-section"><strong>Bulgular</strong><ul>${data.findings.map(f => `<li>${f}</li>`).join('')}</ul></div>` : ''}
      ${data.warnings?.length ? `<div class="interp-section warn"><strong>Uyarılar</strong><ul>${data.warnings.map(w => `<li>${w}</li>`).join('')}</ul></div>` : ''}
      ${data.suggestions?.length ? `<div class="interp-section"><strong>Öneriler</strong><ul>${data.suggestions.map(s => `<li>${s}</li>`).join('')}</ul></div>` : ''}`;
  }

  function initAddAPIForm() {
    const providerSel = document.getElementById('new-api-provider');
    const modelSel = document.getElementById('new-api-model');
    if (!providerSel || !modelSel) return;

    function updateModels() {
      const models = AIManager.getModelsForProvider(providerSel.value);
      modelSel.innerHTML = '';
      const freeGroup = document.createElement('optgroup');
      freeGroup.label = '★ Ücretsiz Modeller';
      const paidGroup = document.createElement('optgroup');
      paidGroup.label = 'Ücretli Modeller';
      models.forEach(m => {
        const opt = document.createElement('option');
        opt.value = m.id;
        opt.textContent = `${m.label} — ${m.note}`;
        (m.free ? freeGroup : paidGroup).appendChild(opt);
      });
      if (freeGroup.children.length) modelSel.appendChild(freeGroup);
      if (paidGroup.children.length) modelSel.appendChild(paidGroup);
    }
    providerSel.addEventListener('change', updateModels);
    updateModels();

    document.getElementById('btn-test-add-api')?.addEventListener('click', async () => {
      const statusEl = document.getElementById('add-api-status');
      const key = document.getElementById('new-api-key')?.value.trim();
      if (!key) { App.toast('API anahtarı girin', 'warning'); return; }
      if (statusEl) { statusEl.textContent = 'Test ediliyor...'; statusEl.className = 'api-status'; }
      try {
        await AIManager.testAPI(providerSel.value, key, modelSel.value);
        if (statusEl) { statusEl.textContent = '✓ Bağlantı başarılı'; statusEl.className = 'api-status ok'; }
      } catch (e) {
        if (statusEl) { statusEl.textContent = '✗ ' + e.message; statusEl.className = 'api-status err'; }
      }
    });

    document.getElementById('btn-save-add-api')?.addEventListener('click', async () => {
      const statusEl = document.getElementById('add-api-status');
      const key = document.getElementById('new-api-key')?.value.trim();
      const name = document.getElementById('new-api-name')?.value.trim() || `${providerSel.value} API`;
      if (!key) { App.toast('API anahtarı girin', 'warning'); return; }
      if (statusEl) { statusEl.textContent = 'Test ediliyor...'; statusEl.className = 'api-status'; }
      try {
        await AIManager.testAPI(providerSel.value, key, modelSel.value);
        AIManager.addAPI({ provider: providerSel.value, key, model: modelSel.value, name });
        renderAPIManager();
        document.getElementById('new-api-key').value = '';
        document.getElementById('new-api-name').value = '';
        if (statusEl) { statusEl.textContent = ''; }
        App.toast(`"${name}" eklendi`, 'success');
        document.getElementById('api-setup-modal').style.display = 'none';
        document.getElementById('add-api-form').style.display = 'none';
      } catch (e) {
        if (statusEl) { statusEl.textContent = '✗ Kaydedilmedi: ' + e.message; statusEl.className = 'api-status err'; }
      }
    });
  }

  function initAIPanel() {
    document.getElementById('btn-ai-suggest-groups')?.addEventListener('click', suggestGroups);

    document.getElementById('btn-ai-analyze-custom')?.addEventListener('click', async () => {
      const inp = document.getElementById('ai-custom-prompt');
      const prompt = inp?.value.trim();
      if (!prompt) { App.toast('Soru girin', 'warning'); return; }
      const result = await analyzeWithAI(prompt);
      if (result) {
        const out = document.getElementById('ai-custom-output');
        if (out) { out.textContent = result; out.style.display = 'block'; }
      }
    });

    document.getElementById('btn-ai-research')?.addEventListener('click', async () => {
      const topic = document.getElementById('ai-research-topic')?.value.trim();
      if (!topic) { App.toast('Araştırma konusu girin', 'warning'); return; }
      const data = await researchTopic(topic);
      if (data) renderResearchPanel(data);
    });

    document.getElementById('btn-ai-interpret-results')?.addEventListener('click', async () => {
      const result = Charts.getResult();
      if (!result) { App.toast('Önce analiz çalıştırın', 'warning'); return; }
      const data = await interpretResults(result);
      if (data) renderAIInterpretation(data);
    });

    document.getElementById('btn-close-api-setup')?.addEventListener('click', () => {
      document.getElementById('api-setup-modal').style.display = 'none';
    });
    document.getElementById('btn-close-quota-modal')?.addEventListener('click', closeQuotaModal);
    document.getElementById('btn-close-ai-suggestions')?.addEventListener('click', () => {
      document.getElementById('ai-suggestions-modal').style.display = 'none';
    });

    document.getElementById('btn-open-add-api')?.addEventListener('click', () => {
      const f = document.getElementById('add-api-form');
      if (f) f.style.display = f.style.display === 'none' ? 'block' : 'none';
    });

    initAddAPIForm();
    renderAPIManager();
  }

  return {
    suggestGroups, analyzeWithAI, researchTopic, interpretResults,
    renderAPIManager, initAIPanel, renderResearchPanel, renderAIInterpretation,
    showNoAPIModal, showAllQuotaModal, closeQuotaModal, handleAIError
  };
})();
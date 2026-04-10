// ══════════════════════════════════════════════════════════
//  ai_manager.js  v2.0
//  – Gemini çağrıları: exponential backoff + rate-limit retry
//  – Ücretsiz plan banner + günlük limit takibi
//  – Firestore API key yönetimi (users/{uid}/apis/)
//  – OpenAI desteği
// ══════════════════════════════════════════════════════════
const AIManager = (() => {
  const FIREBASE_CDN = 'https://www.gstatic.com/firebasejs/10.12.2';
  const GEMINI_BASE  = 'https://generativelanguage.googleapis.com/v1beta/models';
  const ACTIVE_KEY   = 'dl_ai_active';

  const FREE_DAILY_LIMIT = 10;
  const FREE_WARN_AT     = 8;
  const TODAY_KEY        = 'dl_ai_today';
  const TODAY_COUNT_KEY  = 'dl_ai_count';
  const BACKOFF_MS       = [15000, 45000, 90000];
  const MIN_INTERVAL_MS  = 6500;
  const _lastRequest     = {};

  async function _getFS() { return import(`${FIREBASE_CDN}/firebase-firestore.js`); }

  async function _apisRef() {
    const fs  = await _getFS();
    const { getFirestore, collection } = fs;
    const uid = Auth.getUID();
    if (!uid) throw new Error('Giriş yapılmamış');
    const db = getFirestore(window.__fbApp);
    return { fs, db, col: collection(db, 'users', uid, 'apis'), uid };
  }

  async function getAPIs() {
    try {
      const { fs, col } = await _apisRef();
      const { getDocs, orderBy, query } = fs;
      const snap = await getDocs(query(col, orderBy('createdAt', 'asc')));
      return snap.docs.map(d => ({ id: d.id, ...d.data() }));
    } catch { return []; }
  }

  async function addAPI(entry) {
    const { fs, col } = await _apisRef();
    const { addDoc, serverTimestamp } = fs;
    const ref = await addDoc(col, { ...entry, quotaExhausted: false, quotaResetAt: null, usageCount: 0, createdAt: serverTimestamp() });
    return ref.id;
  }

  async function updateAPI(id, changes) {
    try {
      const { fs, db, uid } = await _apisRef();
      const { doc, updateDoc } = fs;
      await updateDoc(doc(db, 'users', uid, 'apis', id), changes);
      return true;
    } catch { return false; }
  }

  async function removeAPI(id) {
    const { fs, db, uid } = await _apisRef();
    const { doc, deleteDoc } = fs;
    await deleteDoc(doc(db, 'users', uid, 'apis', id));
  }

  // ── Günlük kullanım ────────────────────────────────────
  function _todayStr() { return new Date().toISOString().slice(0, 10); }

  function _getTodayCount() {
    if (localStorage.getItem(TODAY_KEY) !== _todayStr()) {
      localStorage.setItem(TODAY_KEY, _todayStr());
      localStorage.setItem(TODAY_COUNT_KEY, '0');
      return 0;
    }
    return parseInt(localStorage.getItem(TODAY_COUNT_KEY) || '0');
  }

  function _incTodayCount() {
    const c = _getTodayCount() + 1;
    localStorage.setItem(TODAY_KEY, _todayStr());
    localStorage.setItem(TODAY_COUNT_KEY, String(c));
    return c;
  }

  async function _getUserPlan() {
    try {
      if (typeof Plans !== 'undefined' && Auth.getUID()) {
        const d = await Plans.getUserPlanData(Auth.getUID());
        return d?.isExpired ? 'free' : (d?.plan || 'free');
      }
    } catch {}
    return 'free';
  }

  // ── Free banner ────────────────────────────────────────
  function showFreeBanner(used, limit) {
    document.getElementById('ai-free-banner')?.remove();
    const pct   = Math.min(100, Math.round((used / limit) * 100));
    const isFull = used >= limit;
    const isWarn = used >= FREE_WARN_AT;
    const banner = document.createElement('div');
    banner.id        = 'ai-free-banner';
    banner.className = `ai-free-banner${isFull ? ' full' : isWarn ? ' warn' : ''}`;
    banner.innerHTML = `
      <div class="ai-banner-left">
        <span class="ai-banner-icon">${isFull ? '🚫' : isWarn ? '⚠️' : 'ℹ️'}</span>
        <div class="ai-banner-text">
          <span class="ai-banner-title">${isFull ? 'Günlük limit doldu' : 'Ücretsiz Plan'}</span>
          <span class="ai-banner-sub">${isFull ? 'Yarın yenilenir veya Pro\'ya geçin' : `Bugün ${used}/${limit} istek`}</span>
        </div>
      </div>
      <div class="ai-banner-right">
        <div class="ai-banner-bar-wrap"><div class="ai-banner-bar" style="width:${pct}%;background:${pct > 80 ? '#ef4444' : '#8b5cf6'}"></div></div>
        <button class="ai-banner-upgrade" onclick="TabManager.switchTo('settings')">⚡ Yükselt</button>
      </div>`;
    const target = document.getElementById('ai-analysis-panel') || document.getElementById('ai-chat-panel');
    if (target?.parentNode) target.parentNode.insertBefore(banner, target);
    return isFull;
  }

  function removeFreeBanner() { document.getElementById('ai-free-banner')?.remove(); }

  // ── Rate-limit bekle ────────────────────────────────────
  async function _rateWait(keyId) {
    const wait = MIN_INTERVAL_MS - (Date.now() - (_lastRequest[keyId] || 0));
    if (wait > 0) await new Promise(r => setTimeout(r, wait));
    _lastRequest[keyId] = Date.now();
  }

  // ── Gemini raw call ─────────────────────────────────────
  async function _geminiRaw(apiKey, model, messages, systemPrompt, opts = {}) {
    const body = {
      contents: messages.map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
      generationConfig: { temperature: opts.temperature ?? 0.4, topK: 40, topP: 0.95, maxOutputTokens: opts.maxTokens ?? 8192, responseMimeType: 'text/plain' }
    };
    if (systemPrompt) body.system_instruction = { parts: [{ text: systemPrompt }] };
    const url  = `${GEMINI_BASE}/${encodeURIComponent((model || 'gemini-1.5-flash').trim())}:generateContent?key=${apiKey}`;
    const ctrl = new AbortController();
    const tmr  = setTimeout(() => ctrl.abort(), (opts.timeoutSec || 120) * 1000);
    try {
      const res = await fetch(url, { method: 'POST', signal: ctrl.signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      clearTimeout(tmr);
      if (!res.ok) {
        let e = {}; try { e = await res.json(); } catch (_) {}
        const msg     = e?.error?.message || `HTTP ${res.status}`;
        const isQuota = res.status === 429 || msg.includes('quota') || msg.includes('RESOURCE_EXHAUSTED') || msg.includes('RATE_LIMIT');
        const isAuth  = res.status === 401 || res.status === 403 || msg.includes('API_KEY') || msg.includes('PERMISSION_DENIED');
        return { ok: false, error: msg, isQuota, isAuth, status: res.status };
      }
      const data = await res.json();
      const cand = data.candidates?.[0];
      if (!cand) return { ok: false, error: data.promptFeedback?.blockReason ? `Güvenlik filtresi: ${data.promptFeedback.blockReason}` : 'Yanıt alınamadı', status: 200 };
      const text = (cand.content?.parts ?? []).map(p => (p.text || '').replace(/"thoughtSignature"\s*:\s*"[^"]*"/g, '')).join('');
      if (!text) return { ok: false, error: 'Boş yanıt', status: 200 };
      return { ok: true, text, truncated: cand.finishReason === 'MAX_TOKENS' };
    } catch (e) {
      clearTimeout(tmr);
      if (e.name === 'AbortError') return { ok: false, error: `Zaman aşımı (${opts.timeoutSec || 120}s)`, isTimeout: true, status: 408 };
      return { ok: false, error: e.message, isNetwork: true, status: 0 };
    }
  }

  // ── Gemini retry (backoff) ──────────────────────────────
  async function _geminiRetry(api, messages, systemPrompt, opts = {}) {
    let attempt = 0;
    while (true) {
      await _rateWait(api.id);
      const r = await _geminiRaw(api.key, api.model, messages, systemPrompt, opts);
      if (r.ok) return r.text;

      if (r.isAuth || r.status === 400) throw { type: 'auth', message: r.error };

      if (r.isQuota || r.status === 429) {
        if (attempt >= BACKOFF_MS.length) {
          await updateAPI(api.id, { quotaExhausted: true, quotaResetAt: Date.now() + 86400000 });
          throw { type: 'quota', message: r.error };
        }
        const retryMatch = r.error?.match(/retry in ([\d.]+)s/i);
        const waitMs = retryMatch ? (Math.ceil(parseFloat(retryMatch[1])) + 3) * 1000 : BACKOFF_MS[attempt];
        _showRetryCountdown(waitMs, attempt + 1);
        await new Promise(res => setTimeout(res, waitMs));
        _clearRetryIndicator();
        attempt++;
        continue;
      }

      if ((r.isTimeout || r.isNetwork || r.status >= 500) && attempt < 2) {
        attempt++;
        await new Promise(res => setTimeout(res, 10000));
        continue;
      }

      throw { type: 'error', message: r.error };
    }
  }

  function _showRetryCountdown(waitMs, attempt) {
    const container = document.getElementById('ai-chat-messages');
    if (!container) return;
    let el = document.getElementById('ai-retry-indicator');
    if (!el) { el = document.createElement('div'); el.id = 'ai-retry-indicator'; el.className = 'ai-retry-banner'; container.appendChild(el); container.scrollTop = container.scrollHeight; }
    let sec = Math.ceil(waitMs / 1000);
    const update = () => { if (el) el.innerHTML = `⏳ Rate limit — ${sec}s sonra tekrar deneniyor (deneme ${attempt}/${BACKOFF_MS.length})`; };
    update();
    el._timer = setInterval(() => { sec--; if (sec <= 0) clearInterval(el._timer); else update(); }, 1000);
  }

  function _clearRetryIndicator() {
    const el = document.getElementById('ai-retry-indicator');
    if (el) { clearInterval(el._timer); el.remove(); }
  }

  // ── OpenAI call ─────────────────────────────────────────
  async function _callOpenAI(api, messages, systemPrompt) {
    const msgs = systemPrompt ? [{ role: 'system', content: systemPrompt }, ...messages] : messages;
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${api.key}` },
      body: JSON.stringify({ model: api.model, messages: msgs, temperature: 0.4, max_tokens: 8192 })
    });
    if (!res.ok) { const e = await res.json().catch(() => ({})); const msg = e?.error?.message || res.statusText; if (res.status === 429) throw { type: 'quota', message: msg }; throw { type: 'error', message: msg }; }
    const data = await res.json();
    return data?.choices?.[0]?.message?.content || '';
  }

  // ── Test API ────────────────────────────────────────────
  async function testAPI(provider, apiKey, model) {
    if (provider === 'gemini') {
      const r = await _geminiRaw(apiKey, model || 'gemini-1.5-flash', [{ role: 'user', content: 'Sadece "TAMAM" yaz.' }], null, { maxTokens: 10, timeoutSec: 20 });
      if (!r.ok) throw new Error(r.error);
      return true;
    }
    if (provider === 'openai') {
      const res = await fetch('https://api.openai.com/v1/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` }, body: JSON.stringify({ model: model || 'gpt-3.5-turbo', messages: [{ role: 'user', content: 'reply: ok' }], max_tokens: 5 }) });
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e?.error?.message || 'Bağlantı hatası'); }
      return true;
    }
    throw new Error('Bilinmeyen sağlayıcı');
  }

  // ── Model listesi ───────────────────────────────────────
  async function fetchGeminiModels(apiKey) {
    const res = await fetch(`${GEMINI_BASE}?key=${apiKey}&pageSize=100`);
    if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e?.error?.message || 'Modeller alınamadı'); }
    const data = await res.json();
    return (data.models || []).filter(m => m.supportedGenerationMethods?.includes('generateContent')).map(m => {
      const id = m.name.replace('models/', '');
      const isFree = id.includes('flash') || id.includes('lite');
      const isThinking = id.includes('thinking') || id.includes('exp');
      return { id, label: m.displayName || id, free: isFree, thinking: isThinking, inputLimit: m.inputTokenLimit || 0, note: isThinking ? '🧠 Düşünen' : isFree ? '⚡ Ücretsiz' : '💎 Güçlü' };
    }).sort((a, b) => { if (a.free && !b.free) return -1; if (!a.free && b.free) return 1; return a.id.localeCompare(b.id); });
  }

  // ── Ana call ────────────────────────────────────────────
  async function call(messages, systemPrompt = '', opts = {}) {
    const allAPIs = await getAPIs();
    if (!allAPIs.length) throw { type: 'no_api', message: 'API tanımlı değil' };
    const available = allAPIs.filter(a => !a.quotaExhausted);
    if (!available.length) throw { type: 'all_quota', message: 'Tüm API kotaları doldu', apis: allAPIs };

    const plan = await _getUserPlan();
    if (plan === 'free') {
      const count = _getTodayCount();
      if (count >= FREE_DAILY_LIMIT) { showFreeBanner(count, FREE_DAILY_LIMIT); throw { type: 'free_limit', message: `Günlük ücretsiz limit (${FREE_DAILY_LIMIT}) doldu. Pro\'ya geçin veya yarın tekrar deneyin.` }; }
      if (count >= FREE_WARN_AT) showFreeBanner(count, FREE_DAILY_LIMIT);
    }

    let activeIdx = parseInt(localStorage.getItem(ACTIVE_KEY) || '0');
    if (activeIdx >= available.length) activeIdx = 0;

    for (let i = 0; i < available.length; i++) {
      const idx = (activeIdx + i) % available.length;
      const api = available[idx];
      try {
        let text = '';
        if (api.provider === 'gemini') text = await _geminiRetry(api, messages, systemPrompt, opts);
        else if (api.provider === 'openai') text = await _callOpenAI(api, messages, systemPrompt);
        else throw { type: 'error', message: 'Bilinmeyen sağlayıcı' };

        await updateAPI(api.id, { usageCount: (api.usageCount || 0) + 1 });
        localStorage.setItem(ACTIVE_KEY, String((idx + 1) % available.length));

        if (plan === 'free') {
          const nc = _incTodayCount();
          if (nc >= FREE_WARN_AT) showFreeBanner(nc, FREE_DAILY_LIMIT); else removeFreeBanner();
        }
        if (typeof Plans !== 'undefined' && Auth.getUID()) Plans.incrementAIQuery(Auth.getUID()).catch(() => {});

        return { text, usedApi: api };
      } catch (err) {
        if (err.type === 'quota') {
          await updateAPI(api.id, { quotaExhausted: true, quotaResetAt: Date.now() + 86400000 });
          if (typeof App !== 'undefined') App.toast(`"${api.name}" kota doldu, sonraki deneniyor`, 'warning');
          continue;
        }
        throw err;
      }
    }
    const fresh = await getAPIs();
    if (fresh.every(a => a.quotaExhausted)) throw { type: 'all_quota', message: 'Tüm API kotaları doldu', apis: fresh };
    throw { type: 'error', message: "Tüm API'ler başarısız" };
  }

  async function resetQuota(id) { await updateAPI(id, { quotaExhausted: false, quotaResetAt: null }); }
  async function resetAllQuotas() { const apis = await getAPIs(); await Promise.all(apis.map(a => updateAPI(a.id, { quotaExhausted: false, quotaResetAt: null }))); }
  async function hasAPIs() { const list = await getAPIs(); return list.length > 0; }

  return { getAPIs, addAPI, updateAPI, removeAPI, testAPI, call, resetQuota, resetAllQuotas, hasAPIs, fetchGeminiModels, showFreeBanner, removeFreeBanner, getTodayCount: _getTodayCount };
})();

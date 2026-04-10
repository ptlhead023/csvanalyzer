// ══════════════════════════════════════════════════════════
//  ai_manager.js  —  API key management with Firestore sync
// ══════════════════════════════════════════════════════════
const AIManager = (() => {
  const FIREBASE_CDN = 'https://www.gstatic.com/firebasejs/10.12.2';
  const ACTIVE_KEY   = 'dl_ai_active';

  async function fetchGeminiModels(apiKey) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`;
    const res = await fetch(url);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err?.error?.message || 'Modeller alınamadı. API anahtarını kontrol edin.');
    }
    const data = await res.json();
    return data.models
      .filter(m => m.supportedGenerationMethods?.includes('generateContent'))
      .map(m => {
        const id = m.name.split('/').pop();
        const isFree = id.includes('flash') || id.includes('lite');
        const isThinking = id.includes('thinking');
        return {
          id, label: m.displayName || id, free: isFree, thinking: isThinking,
          inputLimit: m.inputTokenLimit || 0,
          note: isThinking ? '🧠 Düşünen Model' : isFree ? '⚡ Hızlı & Ücretsiz' : '💎 Güçlü'
        };
      })
      .sort((a, b) => { if (a.free && !b.free) return -1; if (!a.free && b.free) return 1; return a.id.localeCompare(b.id); });
  }

  async function _getFS() { return import(`${FIREBASE_CDN}/firebase-firestore.js`); }

  async function _apisRef() {
    const fs = await _getFS();
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
    const docRef = await addDoc(col, { ...entry, quotaExhausted: false, quotaResetAt: null, usageCount: 0, createdAt: serverTimestamp() });
    return docRef.id;
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

  async function _callGemini(apiKey, model, messages, systemPrompt) {
    const body = {
      contents: messages.map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
      generationConfig: { temperature: 0.4, maxOutputTokens: 8192 }
    };
    if (systemPrompt) body.system_instruction = { parts: [{ text: systemPrompt }] };
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      const msg = err?.error?.message || res.statusText;
      if (res.status === 429 || msg.includes('quota') || msg.includes('RESOURCE_EXHAUSTED')) throw { type: 'quota', message: msg };
      throw { type: 'error', message: msg };
    }
    const data = await res.json();
    return data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
  }

  async function _callOpenAI(apiKey, model, messages, systemPrompt) {
    const msgs = systemPrompt ? [{ role: 'system', content: systemPrompt }, ...messages] : messages;
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({ model, messages: msgs, temperature: 0.4, max_tokens: 8192 })
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      const msg = err?.error?.message || res.statusText;
      if (res.status === 429) throw { type: 'quota', message: msg };
      throw { type: 'error', message: msg };
    }
    const data = await res.json();
    return data?.choices?.[0]?.message?.content || '';
  }

  async function testAPI(provider, apiKey, model) {
    if (provider === 'gemini') {
      const m = model || 'gemini-1.5-flash';
      const body = { contents: [{ role: 'user', parts: [{ text: 'reply: ok' }] }], generationConfig: { maxOutputTokens: 5 } };
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${apiKey}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e?.error?.message || 'Bağlantı hatası'); }
      return true;
    }
    if (provider === 'openai') {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify({ model: model || 'gpt-3.5-turbo', messages: [{ role: 'user', content: 'reply: ok' }], max_tokens: 5 })
      });
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e?.error?.message || 'Bağlantı hatası'); }
      return true;
    }
    throw new Error('Bilinmeyen sağlayıcı');
  }

  async function call(messages, systemPrompt = '') {
    const allApis = await getAPIs();
    if (!allApis.length) throw { type: 'no_api', message: 'API tanımlı değil' };
    const list = allApis.filter(a => !a.quotaExhausted);
    if (!list.length) throw { type: 'all_quota', message: 'Tüm API kotaları doldu', apis: allApis };
    let activeIdx = parseInt(localStorage.getItem(ACTIVE_KEY) || '0');
    if (activeIdx >= list.length) activeIdx = 0;
    let lastErr = null;
    for (let i = 0; i < list.length; i++) {
      const tryIdx = (activeIdx + i) % list.length;
      const api = list[tryIdx];
      try {
        let result = '';
        if (api.provider === 'gemini') result = await _callGemini(api.key, api.model, messages, systemPrompt);
        else if (api.provider === 'openai') result = await _callOpenAI(api.key, api.model, messages, systemPrompt);
        else throw { type: 'error', message: 'Bilinmeyen sağlayıcı' };
        await updateAPI(api.id, { usageCount: (api.usageCount || 0) + 1 });
        localStorage.setItem(ACTIVE_KEY, String((tryIdx + 1) % list.length));
        return { text: result, usedApi: api };
      } catch (err) {
        lastErr = err;
        if (err.type === 'quota') {
          await updateAPI(api.id, { quotaExhausted: true, quotaResetAt: Date.now() + 86400000 });
          if (typeof App !== 'undefined') App.toast(`"${api.name}" kotası doldu, sonraki deneniyor`, 'warning');
          continue;
        }
        throw err;
      }
    }
    const fresh = await getAPIs();
    if (fresh.every(a => a.quotaExhausted)) throw { type: 'all_quota', message: 'Tüm API kotaları doldu', apis: fresh };
    throw lastErr || { type: 'error', message: 'Bilinmeyen hata' };
  }

  async function resetQuota(id) { await updateAPI(id, { quotaExhausted: false, quotaResetAt: null }); }
  async function resetAllQuotas() { const apis = await getAPIs(); await Promise.all(apis.map(a => updateAPI(a.id, { quotaExhausted: false, quotaResetAt: null }))); }
  async function hasAPIs() { const list = await getAPIs(); return list.length > 0; }

  return { getAPIs, addAPI, updateAPI, removeAPI, testAPI, call, resetQuota, resetAllQuotas, hasAPIs, fetchGeminiModels };
})();

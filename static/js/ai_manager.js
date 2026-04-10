const AIManager = (() => {
  const STORAGE_KEY = 'dl_ai_apis';
  const ACTIVE_KEY  = 'dl_ai_active';

  const MODEL_REGISTRY = {
    gemini: {
      label: 'Google Gemini',
      // Modelleri girilen API anahtarına göre dinamik olarak çeker
      fetchModels: async (apiKey) => {
        const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`;
        const res = await fetch(url);
        if (!res.ok) throw new Error('Modeller alınamadı. API anahtarını kontrol edin.');
        const data = await res.json();
        
        return data.models
          .filter(m => m.supportedGenerationMethods.includes('generateContent'))
          .map(m => {
            const id = m.name.split('/').pop();
            // Flash, Lite ve Thinking modellerini ücretsiz olarak etiketler
            const isFree = id.includes('flash') || id.includes('lite') || id.includes('thinking');
            return {
              id: id,
              label: m.displayName,
              free: isFree,
              note: isFree ? 'Hızlı ve Ücretsiz' : 'Güçlü Performans'
            };
          });
      },
      call: async (apiKey, model, messages, systemPrompt) => {
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
          if (res.status === 429) throw { type: 'quota', message: msg };
          throw { type: 'error', message: msg };
        }
        const data = await res.json();
        return data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
      },
      test: async (apiKey, model) => {
        const testModel = model || 'gemini-1.5-flash';
        const body = { contents: [{ role: 'user', parts: [{ text: 'reply: ok' }] }], generationConfig: { maxOutputTokens: 5 } };
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${testModel}:generateContent?key=${apiKey}`;
        const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err?.error?.message || 'Bağlantı hatası'); }
        return true;
      }
    },
    openai: {
      label: 'OpenAI',
      models: [
        { id: 'gpt-4o-mini',   label: 'GPT-4o Mini',   free: false, rpm: 500,  note: 'Hızlı ve ucuz' },
        { id: 'gpt-4o',        label: 'GPT-4o',        free: false, rpm: 500,  note: 'Güçlü' },
        { id: 'gpt-3.5-turbo', label: 'GPT-3.5 Turbo', free: false, rpm: 3500, note: 'Eski ama hızlı' },
      ],
      call: async (apiKey, model, messages, systemPrompt) => {
        const msgs = systemPrompt ? [{ role: 'system', content: systemPrompt }, ...messages] : messages;
        const res = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
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
      },
      test: async (apiKey, model) => {
        const testModel = model || 'gpt-3.5-turbo';
        const res = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
          body: JSON.stringify({ model: testModel, messages: [{ role: 'user', content: 'reply: ok' }], max_tokens: 5 })
        });
        if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err?.error?.message || 'Bağlantı hatası'); }
        return true;
      }
    }
  };

  function loadAPIs() { try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); } catch { return []; } }
  function saveAPIs(list) { localStorage.setItem(STORAGE_KEY, JSON.stringify(list)); }
  function getAPIs() { return loadAPIs(); }
  function getActiveIndex() { return parseInt(localStorage.getItem(ACTIVE_KEY) || '0'); }
  function setActiveIndex(i) { localStorage.setItem(ACTIVE_KEY, String(i)); }

  function addAPI(entry) {
    const list = loadAPIs();
    entry.id = Date.now().toString();
    entry.quotaExhausted = false;
    entry.quotaResetAt = null;
    entry.usageCount = 0;
    list.push(entry);
    saveAPIs(list);
    return entry.id;
  }

  function updateAPI(id, changes) {
    const list = loadAPIs();
    const idx = list.findIndex(a => a.id === id);
    if (idx === -1) return false;
    list[idx] = { ...list[idx], ...changes };
    saveAPIs(list);
    return true;
  }

  function removeAPI(id) { saveAPIs(loadAPIs().filter(a => a.id !== id)); }
  function getRegistry() { return MODEL_REGISTRY; }
  function getModelsForProvider(provider) { return MODEL_REGISTRY[provider]?.models || []; }

  // Arayüzün çağıracağı dinamik fetch fonksiyonu
  async function fetchRemoteModels(provider, apiKey) {
    if (MODEL_REGISTRY[provider]?.fetchModels) {
      return await MODEL_REGISTRY[provider].fetchModels(apiKey);
    }
    return MODEL_REGISTRY[provider]?.models || [];
  }

  async function testAPI(provider, apiKey, model) {
    const reg = MODEL_REGISTRY[provider];
    if (!reg) throw new Error('Bilinmeyen sağlayıcı');
    await reg.test(apiKey, model);
    return true;
  }

  async function call(messages, systemPrompt = '') {
    const list = loadAPIs().filter(a => !a.quotaExhausted);
    if (!list.length) {
      const allList = loadAPIs();
      if (!allList.length) throw { type: 'no_api', message: 'API tanımlı değil' };
      throw { type: 'all_quota', message: 'Tüm API kotaları doldu', apis: allList };
    }

    let activeIdx = getActiveIndex();
    if (activeIdx >= list.length) activeIdx = 0;
    const startIdx = activeIdx;
    let lastErr = null;

    for (let i = 0; i < list.length; i++) {
      const tryIdx = (startIdx + i) % list.length;
      const api = list[tryIdx];
      const reg = MODEL_REGISTRY[api.provider];
      if (!reg) continue;
      try {
        const result = await reg.call(api.key, api.model, messages, systemPrompt);
        updateAPI(api.id, { usageCount: (api.usageCount || 0) + 1 });
        setActiveIndex((tryIdx + 1) % list.length);
        return { text: result, usedApi: api };
      } catch (err) {
        lastErr = err;
        if (err.type === 'quota') {
          updateAPI(api.id, { quotaExhausted: true, quotaResetAt: Date.now() + 86400000 });
          if(typeof App !== 'undefined' && App.toast) App.toast(`"${api.name}" kotası doldu, sonraki deneniyor`, 'warning');
          continue;
        }
        throw err;
      }
    }

    const allList = loadAPIs();
    if (allList.every(a => a.quotaExhausted)) {
      throw { type: 'all_quota', message: 'Tüm API kotaları doldu', apis: allList };
    }
    throw lastErr || { type: 'error', message: 'Bilinmeyen hata' };
  }

  function resetQuota(id) { updateAPI(id, { quotaExhausted: false, quotaResetAt: null }); }
  function resetAllQuotas() { saveAPIs(loadAPIs().map(a => ({ ...a, quotaExhausted: false, quotaResetAt: null }))); }
  function hasAPIs() { return loadAPIs().length > 0; }

  return { 
    getAPIs, addAPI, updateAPI, removeAPI, testAPI, call, 
    resetQuota, resetAllQuotas, getRegistry, getModelsForProvider, 
    fetchRemoteModels, hasAPIs, getActiveIndex, setActiveIndex 
  };
})();
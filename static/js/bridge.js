const Bridge = (() => {
  const BASE = '';
  const DEFAULT_TIMEOUT = 120000;
  const HEALTH_TIMEOUT = 8000;
  const MAX_RETRY = 3;

  async function request(url, options = {}, timeout = DEFAULT_TIMEOUT, retries = MAX_RETRY) {
    for (let attempt = 1; attempt <= retries; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeout);
      try {
        const res = await fetch(BASE + url, { ...options, signal: controller.signal });
        clearTimeout(timer);
        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: res.statusText }));
          throw new Error(err.error || `HTTP ${res.status}`);
        }
        return await res.json();
      } catch (e) {
        clearTimeout(timer);
        if (attempt === retries) throw e;
        await new Promise(r => setTimeout(r, 600 * attempt));
      }
    }
  }

  async function checkHealth() {
    try {
      const data = await request('/api/health', {}, HEALTH_TIMEOUT, 1);
      return { ok: true, data };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  async function preprocess(csvData, options = {}) {
    return request('/api/preprocess', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ csv: csvData, options })
    }, 30000);
  }

  async function analyze(csvData, groups = [], options = {}) {
    return request('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ csv: csvData, groups, options })
    }, DEFAULT_TIMEOUT);
  }

  async function exportExcel(csvData) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30000);
    try {
      const res = await fetch(BASE + '/api/export/excel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ csv: csvData }),
        signal: controller.signal
      });
      clearTimeout(timer);
      if (!res.ok) throw new Error('Excel export başarısız');
      const blob = await res.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'datalens_export.xlsx';
      a.click();
      return { success: true };
    } catch (e) {
      clearTimeout(timer);
      throw e;
    }
  }

  async function exportJson() {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const res = await fetch(BASE + '/api/export/json', { signal: controller.signal });
      clearTimeout(timer);
      if (!res.ok) throw new Error('JSON export başarısız');
      const blob = await res.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'datalens_result.json';
      a.click();
      return { success: true };
    } catch (e) {
      clearTimeout(timer);
      throw e;
    }
  }

  return { checkHealth, preprocess, analyze, exportExcel, exportJson };
})();

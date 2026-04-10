const App = (() => {
  let currentProjectId = null;
  let currentTheme = localStorage.getItem('dl-theme') || 'obsidian';

  function toast(msg, type = 'info', duration = 3500) {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const t = document.createElement('div');
    t.className = `toast toast-${type}`;
    t.textContent = msg;
    container.appendChild(t);
    gsap.fromTo(t, { x: 60, opacity: 0 }, { x: 0, opacity: 1, duration: 0.3 });
    setTimeout(() => gsap.to(t, { x: 60, opacity: 0, duration: 0.3, onComplete: () => t.remove() }), duration);
  }

  function setLoading(state, text = 'İşleniyor...') {
    const overlay = document.getElementById('loading-overlay');
    const label = document.getElementById('loading-text');
    if (!overlay) return;
    if (label) label.textContent = text;
    overlay.style.display = state ? 'flex' : 'none';
  }

  function getOptions() {
    const adv = document.getElementById('advanced-options')?.style.display !== 'none';
    return {
      forecast_periods: parseInt(document.getElementById('opt-forecast-periods')?.value || '3'),
      confidence: adv ? parseInt(document.getElementById('opt-confidence')?.value || '95') : 95,
      number_format: adv ? (document.getElementById('opt-number-format')?.value || 'float') : 'float',
      period_col: adv ? (document.getElementById('opt-period-col')?.value || 'auto') : 'auto',
      row_start: adv ? parseInt(document.getElementById('opt-row-start')?.value || '1') : 1,
      row_end: adv ? (document.getElementById('opt-row-end')?.value || '') : '',
      ma_window: adv ? parseInt(document.getElementById('opt-ma-window')?.value || '3') : 3,
      analysis_types: ['regression', 'arima', 'moving_avg', 'anomaly', 'correlation', 'bayesian', 'distribution']
    };
  }

  async function runAnalysis() {
    const csv = Editor.getCSV();
    if (!csv.trim()) { toast('Önce CSV yükleyin', 'warning'); return; }
    setLoading(true, 'Analiz yapılıyor...');
    try {
      const groups = GroupManager.getGroups();
      const options = getOptions();
      const data = await Bridge.analyze(csv, groups, options);
      if (!data.success) throw new Error(data.error || 'Analiz başarısız');
      const result = data.result;
      Charts.setResult(result);
      document.getElementById('results-empty').style.display = 'none';
      document.getElementById('results-content').style.display = 'block';
      document.getElementById('results-badge').style.display = 'flex';
      Charts.renderSummaryCards(result);
      Charts.renderChart('trend', null);
      Charts.renderDetailTable(result, 'trend');
      document.querySelectorAll('.chart-tab').forEach(b => b.classList.remove('active'));
      document.querySelector('.chart-tab[data-chart="trend"]')?.classList.add('active');
      TabManager.switchTo('results');
      toast('Analiz tamamlandı', 'success');
      if (AIManager.hasAPIs()) {
        const interp = await AIRender.interpretResults(result);
        if (interp) AIRender.renderAIInterpretation(interp);
      }
    } catch (e) {
      toast('Hata: ' + e.message, 'error');
    } finally {
      setLoading(false);
    }
  }

  async function saveProject() {
    const csv = Editor.getCSV();
    if (!csv.trim()) { toast('Kaydedilecek veri yok', 'warning'); return; }
    const name = document.getElementById('project-name-input')?.value.trim() || 'İsimsiz Proje';
    const notes = document.getElementById('project-notes-input')?.value.trim() || '';
    setLoading(true, 'Kaydediliyor...');
    try {
      const id = await FirebaseDB.saveProject({
        id: currentProjectId || undefined,
        name, notes, csvData: csv,
        groups: GroupManager.getGroups(),
        analysisResult: Charts.getResult() || null, tags: []
      });
      currentProjectId = id;
      toast('Proje kaydedildi', 'success');
    } catch (e) { toast('Kayıt hatası: ' + e.message, 'error'); }
    finally { setLoading(false); }
  }

  async function loadProject(id) {
    setLoading(true, 'Proje yükleniyor...');
    try {
      const proj = await FirebaseDB.loadProject(id);
      currentProjectId = proj.id;
      if (document.getElementById('project-name-input')) document.getElementById('project-name-input').value = proj.name || '';
      if (document.getElementById('project-notes-input')) document.getElementById('project-notes-input').value = proj.notes || '';
      if (proj.csvData) Editor.loadCSV(proj.csvData);
      if (proj.analysisResult) {
        Charts.setResult(proj.analysisResult);
        document.getElementById('results-empty').style.display = 'none';
        document.getElementById('results-content').style.display = 'block';
        document.getElementById('results-badge').style.display = 'flex';
        Charts.renderSummaryCards(proj.analysisResult);
        Charts.renderChart('trend', null);
        Charts.renderDetailTable(proj.analysisResult, 'trend');
      }
      TabManager.switchTo('new-analysis');
      toast(`"${proj.name}" yüklendi`, 'success');
    } catch (e) { toast('Yükleme hatası: ' + e.message, 'error'); }
    finally { setLoading(false); }
  }

  async function deleteProject(id) {
    if (!confirm('Bu projeyi silmek istediğinize emin misiniz?')) return;
    setLoading(true, 'Siliniyor...');
    try {
      await FirebaseDB.deleteProject(id);
      if (currentProjectId === id) currentProjectId = null;
      toast('Proje silindi', 'info');
      loadProjectsList();
    } catch (e) { toast('Silme hatası: ' + e.message, 'error'); }
    finally { setLoading(false); }
  }

  async function loadProjectsList() {
    const grid = document.getElementById('projects-grid');
    if (!grid) return;
    try {
      const projects = await FirebaseDB.listProjects();
      const search = document.getElementById('search-projects')?.value.toLowerCase() || '';
      const filtered = projects.filter(p => (p.name || '').toLowerCase().includes(search));
      grid.innerHTML = '';
      if (!filtered.length) {
        grid.innerHTML = `<div class="projects-empty"><div class="empty-icon">◈</div><h3>Proje bulunamadı</h3><p>CSV verilerinizi yükleyerek ilk analizinizi başlatın</p><button class="btn-primary" onclick="TabManager.switchTo('new-analysis')"><i data-lucide="plus-circle"></i> İlk Projeyi Oluştur</button></div>`;
        lucide.createIcons(); return;
      }
      filtered.forEach(proj => {
        const card = document.createElement('div');
        card.className = 'project-card';
        const date = proj.updatedAt?.toDate?.() || new Date();
        const dateStr = date.toLocaleDateString('tr-TR', { day: '2-digit', month: 'short', year: 'numeric' });
        card.innerHTML = `<div class="project-card-header"><div class="project-card-icon">◈</div><div class="project-card-actions"><button class="btn-xs" data-share="${proj.id}"><i data-lucide="share-2"></i></button><button class="btn-xs danger" data-delete="${proj.id}"><i data-lucide="trash-2"></i></button></div></div><div class="project-card-body"><h3>${proj.name || 'İsimsiz'}</h3><p>${proj.notes || ''}</p></div><div class="project-card-footer"><span>${dateStr}</span><span>${proj.groups?.length || 0} grup</span></div>`;
        card.addEventListener('click', e => { if (e.target.closest('[data-delete],[data-share]')) return; loadProject(proj.id); });
        card.querySelector('[data-delete]')?.addEventListener('click', e => { e.stopPropagation(); deleteProject(proj.id); });
        card.querySelector('[data-share]')?.addEventListener('click', async e => {
          e.stopPropagation();
          try { const sid = await FirebaseDB.createShareLink(proj.id); navigator.clipboard?.writeText(`${location.origin}?share=${sid}`).then(() => toast('Link kopyalandı', 'success')); }
          catch (err) { toast('Paylaşım hatası: ' + err.message, 'error'); }
        });
        grid.appendChild(card);
      });
      lucide.createIcons();
    } catch (e) { toast('Projeler yüklenemedi: ' + e.message, 'error'); }
  }

  async function checkSharedLink() {
    const shareId = new URLSearchParams(location.search).get('share');
    if (!shareId) return;
    setLoading(true, 'Paylaşılan proje yükleniyor...');
    try {
      const proj = await FirebaseDB.loadShared(shareId);
      if (proj.csvData) Editor.loadCSV(proj.csvData);
      if (proj.analysisResult) {
        Charts.setResult(proj.analysisResult);
        document.getElementById('results-empty').style.display = 'none';
        document.getElementById('results-content').style.display = 'block';
        Charts.renderSummaryCards(proj.analysisResult);
        Charts.renderChart('trend', null);
        Charts.renderDetailTable(proj.analysisResult, 'trend');
      }
      TabManager.switchTo('results');
      toast(`Paylaşılan: "${proj.name}"`, 'info');
    } catch (e) { toast('Paylaşım linki geçersiz', 'error'); }
    finally { setLoading(false); }
  }

  async function checkServerHealth() {
    const res = await Bridge.checkHealth();
    const ok = res.ok;
    const dot = document.getElementById('status-dot');
    const label = document.getElementById('status-label');
    const badge = document.getElementById('server-status-badge');
    if (dot) dot.className = 'status-dot ' + (ok ? 'online' : 'offline');
    if (label) label.textContent = ok ? 'Sunucu Aktif' : 'Sunucu Kapalı';
    if (badge) { badge.textContent = ok ? 'Bağlı' : 'Bağlantı Yok'; badge.className = 'status-badge ' + (ok ? 'ok' : 'error'); }
  }

  function applyTheme(theme) {
    currentTheme = theme;
    document.body.dataset.theme = theme;
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('dl-theme', theme);
    document.querySelectorAll('.theme-btn,.theme-option').forEach(b => b.classList.toggle('active', b.dataset.theme === theme));
    Charts.updateTheme();
  }

  function initTheme() {
    applyTheme(currentTheme);
    document.querySelectorAll('.theme-btn').forEach(b => b.addEventListener('click', () => applyTheme(b.dataset.theme)));
    document.querySelectorAll('.theme-option').forEach(b => b.addEventListener('click', () => applyTheme(b.dataset.theme)));
  }

  function initAdvancedToggle() {
    const btn = document.getElementById('btn-toggle-advanced');
    const panel = document.getElementById('advanced-options');
    if (!btn || !panel) return;
    btn.addEventListener('click', () => {
      const open = panel.style.display !== 'none';
      panel.style.display = open ? 'none' : 'block';
      btn.innerHTML = open ? '<i data-lucide="settings-2"></i> Gelişmiş Seçenekler' : '<i data-lucide="chevron-up"></i> Gizle';
      lucide.createIcons();
    });
  }

  function initEvents() {
    document.getElementById('btn-run-analysis')?.addEventListener('click', runAnalysis);
    document.getElementById('btn-save-project')?.addEventListener('click', saveProject);
    document.getElementById('btn-new-project-quick')?.addEventListener('click', () => {
      currentProjectId = null;
      document.getElementById('project-name-input').value = '';
      document.getElementById('project-notes-input').value = '';
      TabManager.switchTo('new-analysis');
    });
    document.getElementById('search-projects')?.addEventListener('input', loadProjectsList);
    document.getElementById('btn-export-json')?.addEventListener('click', () => Bridge.exportJson().catch(e => toast('Export hatası: ' + e.message, 'error')));
    document.getElementById('btn-export-excel')?.addEventListener('click', () => {
      const csv = Editor.getCSV();
      if (!csv.trim()) { toast('Veri yok', 'warning'); return; }
      Bridge.exportExcel(csv).catch(e => toast('Excel hatası: ' + e.message, 'error'));
    });
    document.getElementById('btn-save-notes')?.addEventListener('click', async () => {
      if (!currentProjectId) { toast('Önce projeyi kaydedin', 'warning'); return; }
      try { await FirebaseDB.saveProject({ id: currentProjectId, notes: document.getElementById('analysis-notes')?.value || '' }); toast('Not kaydedildi', 'success'); }
      catch (e) { toast('Not kaydedilemedi', 'error'); }
    });
    document.getElementById('btn-test-firebase')?.addEventListener('click', async () => {
      const badge = document.getElementById('fb-status-badge');
      if (badge) badge.textContent = 'Test ediliyor...';
      const res = await FirebaseDB.testConnection();
      if (badge) { badge.textContent = res.ok ? 'Bağlı' : 'Hata'; badge.className = 'status-badge ' + (res.ok ? 'ok' : 'error'); }
      toast(res.ok ? 'Firebase başarılı' : 'Firebase hatası: ' + res.error, res.ok ? 'success' : 'error');
    });
    document.getElementById('btn-test-server')?.addEventListener('click', async () => { await checkServerHealth(); toast('Sunucu kontrol edildi', 'info'); });
    document.getElementById('btn-clear-local')?.addEventListener('click', () => {
      if (confirm('API anahtarları dahil tüm yerel veriler silinecek. Emin misiniz?')) { localStorage.clear(); toast('Yerel veriler temizlendi', 'info'); }
    });
    document.getElementById('btn-reset-all-quotas')?.addEventListener('click', () => { AIManager.resetAllQuotas(); AIRender.renderAPIManager(); toast('Tüm kotalar sıfırlandı', 'success'); });
    initAdvancedToggle();
  }

  async function init() {
    initTheme();
    TabManager.init();
    Editor.init();
    GroupManager.init();
    Charts.initEvents();
    AIRender.initAIPanel();
    initEvents();
    await checkServerHealth();
    document.addEventListener('firebase-ready', () => {
      const label = document.getElementById('firebase-label');
      if (label) label.textContent = 'Firebase Bağlı';
      const badge = document.getElementById('fb-status-badge');
      if (badge) { badge.textContent = 'Bağlı'; badge.className = 'status-badge ok'; }
      loadProjectsList();
    });
    await checkSharedLink();
    lucide.createIcons();
    setInterval(checkServerHealth, 30000);
  }

  return { init, toast, setLoading, loadProjectsList };
})();


const TabManager = (() => {
  const TITLES = {
    projects:       { title: 'Projeler',    subtitle: 'Kayıtlı analizleriniz' },
    'new-analysis': { title: 'Yeni Analiz', subtitle: 'CSV yükle, AI ile analiz et' },
    results:        { title: 'Sonuçlar',    subtitle: 'Analiz çıktıları ve grafikler' },
    settings:       { title: 'Ayarlar',     subtitle: 'API bağlantıları ve tercihler' }
  };

  function switchTo(tabId) {
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
    const panel = document.getElementById(`tab-${tabId}`);
    const navBtn = document.querySelector(`.nav-item[data-tab="${tabId}"]`);
    if (panel) { panel.classList.add('active'); gsap.fromTo(panel, { opacity: 0, y: 8 }, { opacity: 1, y: 0, duration: 0.3 }); }
    if (navBtn) navBtn.classList.add('active');
    const meta = TITLES[tabId] || {};
    document.getElementById('page-title').textContent = meta.title || '';
    document.getElementById('page-subtitle').textContent = meta.subtitle || '';
    const editorVisible = document.getElementById('editor-area')?.style.display !== 'none';
    const show = tabId === 'new-analysis' && editorVisible;
    document.getElementById('history-controls').style.display = show ? 'flex' : 'none';
    document.getElementById('btn-save-project').style.display = show ? 'inline-flex' : 'none';
    document.getElementById('btn-run-analysis').style.display = show ? 'inline-flex' : 'none';
    if (tabId === 'projects') App.loadProjectsList();
    if (tabId === 'settings') AIRender.renderAPIManager();
  }

  function init() {
    document.querySelectorAll('.nav-item[data-tab]').forEach(btn => btn.addEventListener('click', () => switchTo(btn.dataset.tab)));
  }

  return { init, switchTo };
})();


document.addEventListener('DOMContentLoaded', App.init);
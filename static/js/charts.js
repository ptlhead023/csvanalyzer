const Charts = (() => {
    let mainChart = null;
    let currentResult = null;
    let currentType = 'trend';
    let currentCol = null;

    const THEME_COLORS = {
        obsidian: { accent: '#8b5cf6', accent2: '#a78bfa', grid: 'rgba(255,255,255,0.06)', text: '#94a3b8' },
        ocean: { accent: '#06b6d4', accent2: '#67e8f9', grid: 'rgba(255,255,255,0.06)', text: '#94a3b8' },
        ember: { accent: '#f97316', accent2: '#fdba74', grid: 'rgba(255,255,255,0.06)', text: '#94a3b8' },
        forest: { accent: '#84cc16', accent2: '#bef264', grid: 'rgba(255,255,255,0.06)', text: '#94a3b8' },
    };

    const PALETTE = ['#8b5cf6', '#06b6d4', '#f97316', '#84cc16', '#ec4899', '#f59e0b', '#10b981', '#ef4444', '#3b82f6', '#a78bfa'];

    function getTheme() {
        const t = document.body.dataset.theme || 'obsidian';
        return THEME_COLORS[t] || THEME_COLORS.obsidian;
    }

    function baseOptions(title = '') {
        const th = getTheme();
        return {
            responsive: true,
            maintainAspectRatio: false,
            animation: { duration: 600, easing: 'easeOutQuart' },
            plugins: {
                legend: { labels: { color: th.text, font: { family: 'Inter', size: 12 }, boxWidth: 12, padding: 16 } },
                title: title ? { display: true, text: title, color: th.text, font: { family: 'Syne', size: 14 } } : { display: false },
                tooltip: {
                    backgroundColor: 'rgba(15,15,25,0.92)',
                    borderColor: th.accent,
                    borderWidth: 1,
                    titleColor: '#e2e8f0',
                    bodyColor: '#94a3b8',
                    padding: 10,
                    callbacks: {}
                }
            },
            scales: {
                x: { grid: { color: th.grid }, ticks: { color: th.text, font: { family: 'JetBrains Mono', size: 11 } } },
                y: { grid: { color: th.grid }, ticks: { color: th.text, font: { family: 'JetBrains Mono', size: 11 } } }
            }
        };
    }

    function destroyChart() {
        if (mainChart) { mainChart.destroy(); mainChart = null; }
    }

    function getNumericCols(result) {
        return result?.meta?.numeric_cols || [];
    }

    function getLabels(result) {
        const rows = result?.meta?.rows || 0;
        return Array.from({ length: rows }, (_, i) => i + 1);
    }

    function renderColSelector(cols, active, onSelect) {
        const wrap = document.getElementById('chart-col-selector');
        if (!wrap) return;
        wrap.innerHTML = '';
        cols.forEach(c => {
            const btn = document.createElement('button');
            btn.className = 'chart-col-btn' + (c === active ? ' active' : '');
            btn.textContent = c;
            btn.addEventListener('click', () => { currentCol = c; onSelect(c); });
            wrap.appendChild(btn);
        });
    }

    function renderTrend(col) {
        destroyChart();
        const th = getTheme();
        const ctx = document.getElementById('main-chart').getContext('2d');
        const result = currentResult;
        const labels = getLabels(result);
        const trend = result.trend?.[col] || {};
        const datasets = [];

        if (result.stats?.[col]) {
            const mean = result.stats[col].mean;
            const meanLine = labels.map(() => mean);
            datasets.push({ label: 'Ortalama', data: meanLine, borderColor: 'rgba(148,163,184,0.4)', borderDash: [6, 4], borderWidth: 1, pointRadius: 0, fill: false });
        }

        if (trend.ema) {
            datasets.push({ label: 'EMA', data: trend.ema, borderColor: th.accent2, borderWidth: 1.5, pointRadius: 0, fill: false, tension: 0.4 });
        }

        if (trend.slope !== undefined && trend.intercept !== undefined) {
            const linReg = labels.map((_, i) => trend.intercept + trend.slope * i);
            datasets.push({ label: 'Doğrusal Trend', data: linReg, borderColor: th.accent, borderWidth: 2, borderDash: [4, 3], pointRadius: 0, fill: false });
        }

        const opts = baseOptions(`Trend — ${col}`);
        mainChart = new Chart(ctx, { type: 'line', data: { labels, datasets }, options: opts });
        gsap.fromTo('#main-chart', { opacity: 0 }, { opacity: 1, duration: 0.5 });
    }

    function renderForecast(col) {
        destroyChart();
        const th = getTheme();
        const ctx = document.getElementById('main-chart').getContext('2d');
        const result = currentResult;
        const histLabels = getLabels(result);
        const fc = result.forecast?.[col] || {};
        const arima = fc.arima || {};
        const nFc = arima.next_values?.length || 0;
        const fcLabels = Array.from({ length: nFc }, (_, i) => `+${i + 1}`);
        const allLabels = [...histLabels, ...fcLabels];
        const histLen = histLabels.length;
        const datasets = [];

        if (fc.sma) {
            datasets.push({ label: 'SMA', data: [...fc.sma, ...new Array(nFc).fill(null)], borderColor: 'rgba(148,163,184,0.5)', borderWidth: 1.5, pointRadius: 0, fill: false, tension: 0.3 });
        }

        if (arima.next_values) {
            const hist_nulls = new Array(histLen).fill(null);
            const fc_vals = arima.next_values;

            if (arima.confidence_95) {
                const lo95 = arima.confidence_95.map(v => v[0]);
                const hi95 = arima.confidence_95.map(v => v[1]);
                datasets.push({ label: '%95 Alt', data: [...hist_nulls, ...lo95], borderColor: 'transparent', backgroundColor: 'rgba(139,92,246,0.08)', fill: '+1', pointRadius: 0 });
                datasets.push({ label: '%95 Üst', data: [...hist_nulls, ...hi95], borderColor: 'transparent', backgroundColor: 'rgba(139,92,246,0.08)', fill: false, pointRadius: 0 });
            }

            if (arima.confidence_80) {
                const lo80 = arima.confidence_80.map(v => v[0]);
                const hi80 = arima.confidence_80.map(v => v[1]);
                datasets.push({ label: '%80 Alt', data: [...hist_nulls, ...lo80], borderColor: 'transparent', backgroundColor: 'rgba(139,92,246,0.14)', fill: '+1', pointRadius: 0 });
                datasets.push({ label: '%80 Üst', data: [...hist_nulls, ...hi80], borderColor: 'transparent', backgroundColor: 'rgba(139,92,246,0.14)', fill: false, pointRadius: 0 });
            }

            datasets.push({ label: 'ARIMA Tahmin', data: [...hist_nulls, ...fc_vals], borderColor: th.accent, borderWidth: 2.5, pointRadius: 4, pointBackgroundColor: th.accent, fill: false, borderDash: [5, 3] });
        }

        const opts = baseOptions(`Tahmin — ${col}`);
        mainChart = new Chart(ctx, { type: 'line', data: { labels: allLabels, datasets }, options: opts });
        gsap.fromTo('#main-chart', { opacity: 0 }, { opacity: 1, duration: 0.5 });
    }

    function renderCorrelation() {
        destroyChart();
        const th = getTheme();
        const ctx = document.getElementById('main-chart').getContext('2d');
        const result = currentResult;
        const pearson = result.correlation?.pearson || {};
        const cols = Object.keys(pearson);
        if (cols.length === 0) { ctx.canvas.parentElement.innerHTML = '<p class="chart-empty-msg">Korelasyon verisi yok</p>'; return; }

        const labels = cols;
        const datasets = cols.map((col, ci) => ({
            label: col,
            data: cols.map(c => pearson[col]?.[c] ?? null),
            backgroundColor: PALETTE[ci % PALETTE.length] + 'cc',
            borderColor: PALETTE[ci % PALETTE.length],
            borderWidth: 1
        }));

        const opts = baseOptions('Pearson Korelasyon Matrisi');
        opts.scales.y.min = -1;
        opts.scales.y.max = 1;
        mainChart = new Chart(ctx, { type: 'bar', data: { labels, datasets }, options: opts });
        gsap.fromTo('#main-chart', { opacity: 0 }, { opacity: 1, duration: 0.5 });
    }

    function renderDistribution(col) {
        destroyChart();
        const th = getTheme();
        const ctx = document.getElementById('main-chart').getContext('2d');
        const result = currentResult;
        const dist = result.distribution?.[col] || {};
        const datasets = [];

        if (dist.histogram) {
            const edges = dist.histogram.bin_edges || [];
            const counts = dist.histogram.counts || [];
            const binLabels = edges.slice(0, -1).map((v, i) => {
                const lo = v != null ? v.toFixed(2) : '';
                const hi = edges[i + 1] != null ? edges[i + 1].toFixed(2) : '';
                return `${lo}–${hi}`;
            });
            datasets.push({ label: 'Frekans', data: counts, backgroundColor: th.accent + '99', borderColor: th.accent, borderWidth: 1, type: 'bar' });
        }

        if (dist.kde) {
            const kdeLabels = dist.kde.x?.map(v => v != null ? v.toFixed(2) : '') || [];
            const kdeData = dist.kde.y || [];
            const maxCount = dist.histogram?.counts?.length ? Math.max(...dist.histogram.counts) : 1;
            const maxKde = kdeData.length ? Math.max(...kdeData.filter(v => v != null)) : 1;
            const scale = maxKde > 0 ? maxCount / maxKde : 1;
            datasets.push({ label: 'KDE', data: kdeData.map(v => v != null ? v * scale : null), borderColor: th.accent2, borderWidth: 2, pointRadius: 0, fill: false, tension: 0.4, type: 'line' });
        }

        const histBinLabels = dist.histogram?.bin_edges?.slice(0, -1).map((v, i) => {
            const edges = dist.histogram.bin_edges;
            return v != null ? v.toFixed(2) : '';
        }) || [];

        const opts = baseOptions(`Dağılım — ${col}`);
        mainChart = new Chart(ctx, { type: 'bar', data: { labels: histBinLabels, datasets }, options: opts });
        gsap.fromTo('#main-chart', { opacity: 0 }, { opacity: 1, duration: 0.5 });
    }

    function renderAnomaly(col) {
        destroyChart();
        const th = getTheme();
        const ctx = document.getElementById('main-chart').getContext('2d');
        const result = currentResult;
        const labels = getLabels(result);
        const anomalies = result.anomalies?.[col] || {};
        const iqrIdx = new Set(anomalies.iqr?.indices || []);
        const ifIdx = new Set(anomalies.isolation_forest?.indices || []);

        const sma = result.forecast?.[col]?.sma;
        const baseData = sma ? sma : labels.map(() => null);

        const pointColors = labels.map((_, i) => {
            if (iqrIdx.has(i) || ifIdx.has(i)) return '#ef4444';
            return th.accent;
        });

        const pointRadius = labels.map((_, i) => (iqrIdx.has(i) || ifIdx.has(i)) ? 7 : 3);

        const datasets = [{
            label: col,
            data: baseData,
            borderColor: th.accent,
            borderWidth: 1.5,
            pointBackgroundColor: pointColors,
            pointBorderColor: pointColors,
            pointRadius,
            fill: false,
            tension: 0.3
        }];

        if (anomalies.iqr?.lower_bound != null) {
            datasets.push({ label: 'IQR Alt', data: labels.map(() => anomalies.iqr.lower_bound), borderColor: 'rgba(239,68,68,0.4)', borderDash: [4, 3], borderWidth: 1, pointRadius: 0, fill: false });
            datasets.push({ label: 'IQR Üst', data: labels.map(() => anomalies.iqr.upper_bound), borderColor: 'rgba(239,68,68,0.4)', borderDash: [4, 3], borderWidth: 1, pointRadius: 0, fill: false });
        }

        const opts = baseOptions(`Anomali — ${col}`);
        mainChart = new Chart(ctx, { type: 'line', data: { labels, datasets }, options: opts });
        gsap.fromTo('#main-chart', { opacity: 0 }, { opacity: 1, duration: 0.5 });
    }

    function renderBayesian(col) {
        destroyChart();
        const th = getTheme();
        const ctx = document.getElementById('main-chart').getContext('2d');
        const result = currentResult;
        const bayes = result.bayesian?.[col] || {};

        if (!bayes.iterations?.length) {
            ctx.canvas.parentElement.innerHTML = '<p class="chart-empty-msg">Bayes verisi yok</p>';
            return;
        }

        const labels = bayes.iterations.map(n => `n=${n}`);
        const datasets = [
            { label: 'Koşan Ortalama', data: bayes.running_mean, borderColor: th.accent, borderWidth: 2, pointRadius: 0, fill: false, tension: 0.3 },
            { label: '%95 Alt', data: bayes.ci_lower, borderColor: 'transparent', backgroundColor: th.accent + '22', fill: '+1', pointRadius: 0 },
            { label: '%95 Üst', data: bayes.ci_upper, borderColor: 'transparent', backgroundColor: th.accent + '22', fill: false, pointRadius: 0 },
        ];

        const opts = baseOptions(`Bayesian Güven Aralığı — ${col}`);
        mainChart = new Chart(ctx, { type: 'line', data: { labels, datasets }, options: opts });
        gsap.fromTo('#main-chart', { opacity: 0 }, { opacity: 1, duration: 0.5 });
    }

    function renderChart(type, col) {
        currentType = type;
        currentCol = col;
        if (!currentResult) return;

        const cols = getNumericCols(currentResult);
        const activeCol = col || cols[0];

        if (type === 'correlation') {
            renderColSelector([], null, () => { });
            renderCorrelation();
        } else {
            renderColSelector(cols, activeCol, (c) => renderChart(type, c));
            if (!activeCol) return;
            if (type === 'trend') renderTrend(activeCol);
            else if (type === 'forecast') renderForecast(activeCol);
            else if (type === 'distribution') renderDistribution(activeCol);
            else if (type === 'anomaly') renderAnomaly(activeCol);
            else if (type === 'bayesian') renderBayesian(activeCol);
        }
    }

    function renderSummaryCards(result) {
        const wrap = document.getElementById('summary-cards');
        if (!wrap) return;
        wrap.innerHTML = '';
        const cols = getNumericCols(result);

        cols.forEach((col, ci) => {
            const s = result.stats?.[col] || {};
            const t = result.trend?.[col] || {};
            const direction = t.direction || 'flat';
            const dirIcon = direction === 'up' ? '↑' : (direction === 'down' ? '↓' : '→');
            const dirClass = direction === 'up' ? 'up' : (direction === 'down' ? 'down' : 'flat');
            const color = PALETTE[ci % PALETTE.length];

            const card = document.createElement('div');
            card.className = 'summary-card';
            card.style.borderTopColor = color;
            card.innerHTML = `
        <div class="summary-col-name">${col}</div>
        <div class="summary-trend ${dirClass}">${dirIcon} ${direction === 'up' ? 'Artış' : direction === 'down' ? 'Düşüş' : 'Sabit'}</div>
        <div class="summary-stats">
          <div class="summary-stat"><span>Ort</span><strong>${s.mean != null ? s.mean.toFixed(2) : '—'}</strong></div>
          <div class="summary-stat"><span>Min</span><strong>${s.min != null ? s.min.toFixed(2) : '—'}</strong></div>
          <div class="summary-stat"><span>Max</span><strong>${s.max != null ? s.max.toFixed(2) : '—'}</strong></div>
          <div class="summary-stat"><span>R²</span><strong>${t.r2 != null ? t.r2.toFixed(3) : '—'}</strong></div>
        </div>`;
            wrap.appendChild(card);
        });

        const groups = result.groups || {};
        Object.entries(groups).forEach(([name, g]) => {
            const card = document.createElement('div');
            card.className = 'summary-card group-card';
            const inBounds = g.within_bounds;
            const badge = inBounds === true ? '<span class="badge ok">Aralıkta</span>' : inBounds === false ? '<span class="badge warn">Aralık Dışı</span>' : '';
            card.innerHTML = `
        <div class="summary-col-name">${name} ${badge}</div>
        <div class="summary-stats">
          <div class="summary-stat"><span>Mevcut</span><strong>${g.current_total != null ? g.current_total.toFixed(2) : '—'}</strong></div>
          <div class="summary-stat"><span>Tahmin</span><strong>${g.total_forecast != null ? g.total_forecast.toFixed(2) : '—'}</strong></div>
          <div class="summary-stat"><span>Min</span><strong>${g.min_bound != null ? g.min_bound : '—'}</strong></div>
          <div class="summary-stat"><span>Max</span><strong>${g.max_bound != null ? g.max_bound : '—'}</strong></div>
        </div>`;
            wrap.appendChild(card);
        });
    }

    function renderDetailTable(result, type) {
        const wrap = document.getElementById('detail-table-wrap');
        const titleEl = document.getElementById('detail-title');
        if (!wrap) return;
        wrap.innerHTML = '';

        const cols = getNumericCols(result);

        if (type === 'trend') {
            if (titleEl) titleEl.textContent = 'Trend Detayları';
            const rows = cols.map(col => {
                const t = result.trend?.[col] || {};
                const s = result.stats?.[col] || {};
                return {
                    "Sütun": col,
                    "Eğim": t.slope?.toFixed(4) ?? '—',
                    "R²": t.r2?.toFixed(4) ?? '—',
                    "P-değeri": t.p_value?.toFixed(4) ?? '—',
                    "Yön": t.direction ?? '—',
                    "Ortalama": s.mean?.toFixed(3) ?? '—',
                    "Std Sapma": s.std?.toFixed(3) ?? '—'
                };
            });
            buildTable(wrap, rows);
        } else if (type === 'forecast') {
            if (titleEl) titleEl.textContent = 'Tahmin Değerleri';
            const rows = [];
            cols.forEach(col => {
                const arima = result.forecast?.[col]?.arima || {};
                (arima.next_values || []).forEach((v, i) => {
                    rows.push({ Sütun: col, Dönem: `+${i + 1}`, Tahmin: v?.toFixed(3) ?? '—', '%80 Alt': arima.confidence_80?.[i]?.[0]?.toFixed(3) ?? '—', '%80 Üst': arima.confidence_80?.[i]?.[1]?.toFixed(3) ?? '—', '%95 Alt': arima.confidence_95?.[i]?.[0]?.toFixed(3) ?? '—', '%95 Üst': arima.confidence_95?.[i]?.[1]?.toFixed(3) ?? '—' });
                });
            });
            buildTable(wrap, rows);
        } else if (type === 'anomaly') {
            if (titleEl) titleEl.textContent = 'Anomali Tespiti';
            const rows = [];
            cols.forEach(col => {
                const a = result.anomalies?.[col] || {};
                (a.iqr?.indices || []).forEach((idx, i) => {
                    rows.push({ Sütun: col, Satır: idx + 1, Değer: a.iqr.values?.[i]?.toFixed(3) ?? '—', Yöntem: 'IQR' });
                });
                (a.isolation_forest?.indices || []).forEach((idx, i) => {
                    rows.push({ Sütun: col, Satır: idx + 1, Değer: a.isolation_forest.values?.[i]?.toFixed(3) ?? '—', Yöntem: 'Isolation Forest' });
                });
            });
            buildTable(wrap, rows);
        } else if (type === 'correlation') {
            if (titleEl) titleEl.textContent = 'Korelasyon Matrisi (Pearson)';
            const pearson = result.correlation?.pearson || {};
            const colNames = Object.keys(pearson);
            const rows = colNames.map(r => {
                const row = { Sütun: r };
                colNames.forEach(c => { row[c] = pearson[r]?.[c]?.toFixed(3) ?? '—'; });
                return row;
            });
            buildTable(wrap, rows);
        } else if (type === 'distribution') {
            if (titleEl) titleEl.textContent = 'Dağılım & Normallik';
            const rows = cols.map(col => {
                const d = result.distribution?.[col] || {};
                return {
                    Sütun: col,
                    'Shapiro W': d.normality?.shapiro_stat?.toFixed(4) ?? '—',
                    'Shapiro p': d.normality?.shapiro_p?.toFixed(4) ?? '—',
                    'Normal mi?': d.normality?.is_normal === true ? 'Evet' : d.normality?.is_normal === false ? 'Hayır' : '—',
                    'Normal KS': d.fits?.normal?.ks_stat?.toFixed(4) ?? '—',
                    'Lognorm KS': d.fits?.lognorm?.ks_stat?.toFixed(4) ?? '—',
                };
            });
            buildTable(wrap, rows);
        } else if (type === 'bayesian') {
            if (titleEl) titleEl.textContent = 'Bayesian Özeti';
            const rows = cols.map(col => {
                const b = result.bayesian?.[col] || {};
                return {
                    Sütun: col,
                    'Final Ortalama': b.final_mean?.toFixed(4) ?? '—',
                    'Final Std': b.final_std?.toFixed(4) ?? '—',
                    'Gözlem Sayısı': b.n_observations ?? '—',
                };
            });
            buildTable(wrap, rows);
        }
    }

    function buildTable(container, rows) {
        if (!rows.length) { container.innerHTML = '<p class="chart-empty-msg">Veri yok</p>'; return; }
        const keys = Object.keys(rows[0]);
        const table = document.createElement('table');
        table.className = 'detail-table';
        const thead = document.createElement('thead');
        thead.innerHTML = '<tr>' + keys.map(k => `<th>${k}</th>`).join('') + '</tr>';
        const tbody = document.createElement('tbody');
        rows.forEach(row => {
            const tr = document.createElement('tr');
            tr.innerHTML = keys.map(k => `<td>${row[k]}</td>`).join('');
            tbody.appendChild(tr);
        });
        table.appendChild(thead);
        table.appendChild(tbody);
        container.appendChild(table);
    }

    function downloadChart() {
        const canvas = document.getElementById('main-chart');
        if (!canvas || !mainChart) return;
        const a = document.createElement('a');
        a.download = `datalens_${currentType}_${currentCol || 'chart'}.png`;
        a.href = canvas.toDataURL('image/png');
        a.click();
    }

    function updateTheme() {
        if (mainChart && currentResult) {
            renderChart(currentType, currentCol);
        }
    }

    function setResult(result) {
        currentResult = result;
        currentCol = getNumericCols(result)[0] || null;
    }

    function getResult() { return currentResult; }

    function initEvents() {
        document.querySelectorAll('.chart-tab').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.chart-tab').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                const type = btn.dataset.chart;
                renderDetailTable(currentResult, type);
                renderChart(type, currentCol);
            });
        });

        document.getElementById('btn-download-chart')?.addEventListener('click', downloadChart);

        document.getElementById('btn-toggle-fullscreen')?.addEventListener('click', () => {
            const area = document.querySelector('.chart-container');
            if (!area) return;
            if (!document.fullscreenElement) area.requestFullscreen?.();
            else document.exitFullscreen?.();
        });

        document.getElementById('detail-filter')?.addEventListener('input', e => {
            const q = e.target.value.toLowerCase();
            document.querySelectorAll('.detail-table tbody tr').forEach(tr => {
                tr.style.display = tr.textContent.toLowerCase().includes(q) ? '' : 'none';
            });
        });
    }

    return { initEvents, renderChart, renderSummaryCards, renderDetailTable, setResult, getResult, downloadChart, updateTheme };
})();
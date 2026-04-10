const Editor = (() => {
  let headers = [];
  let rows = [];
  let originalHeaders = [];
  let originalRows = [];
  let sortCol = -1;
  let sortDir = 1;
  let selectedCells = new Set();
  let editingCell = null;

  const history = [];
  let histIdx = -1;
  const MAX_HIST = 60;

  function snapshot() {
    const s = { headers: JSON.parse(JSON.stringify(headers)), rows: JSON.parse(JSON.stringify(rows)) };
    if (histIdx < history.length - 1) history.splice(histIdx + 1);
    history.push(s);
    if (history.length > MAX_HIST) history.shift();
    histIdx = history.length - 1;
    updateHistoryUI();
  }

  function updateHistoryUI() {
    const u = document.getElementById('btn-undo');
    const r = document.getElementById('btn-redo');
    const res = document.getElementById('btn-reset');
    const c = document.getElementById('history-counter');
    if (!u) return;
    u.disabled = histIdx <= 0;
    r.disabled = histIdx >= history.length - 1;
    res.disabled = history.length === 0;
    c.textContent = `${histIdx} / ${history.length - 1}`;
  }

  function undo() {
    if (histIdx <= 0) return;
    histIdx--;
    const s = history[histIdx];
    headers = JSON.parse(JSON.stringify(s.headers));
    rows = JSON.parse(JSON.stringify(s.rows));
    renderTable();
    updateHistoryUI();
  }

  function redo() {
    if (histIdx >= history.length - 1) return;
    histIdx++;
    const s = history[histIdx];
    headers = JSON.parse(JSON.stringify(s.headers));
    rows = JSON.parse(JSON.stringify(s.rows));
    renderTable();
    updateHistoryUI();
  }

  function resetToOriginal() {
    if (!originalHeaders.length) return;
    headers = JSON.parse(JSON.stringify(originalHeaders));
    rows = JSON.parse(JSON.stringify(originalRows));
    history.length = 0;
    histIdx = -1;
    snapshot();
    renderTable();
    updateHistoryUI();
    App.toast('Tablo sıfırlandı', 'info');
  }

  function loadCSV(text) {
    const result = Papa.parse(text.trim(), {
      header: true,
      skipEmptyLines: true,
      dynamicTyping: false,
      delimitersToGuess: [',', ';', '\t', '|']
    });

    if (!result.data.length) { App.toast('CSV okunamadı', 'error'); return; }

    headers = result.meta.fields || [];
    rows = result.data.map(r => headers.map(h => r[h] ?? ''));
    originalHeaders = JSON.parse(JSON.stringify(headers));
    originalRows = JSON.parse(JSON.stringify(rows));

    history.length = 0;
    histIdx = -1;
    snapshot();

    document.getElementById('upload-zone').style.display = 'none';
    document.getElementById('editor-area').style.display = 'block';
    document.getElementById('btn-save-project').style.display = 'inline-flex';
    document.getElementById('btn-run-analysis').style.display = 'inline-flex';
    document.getElementById('history-controls').style.display = 'flex';

    populatePeriodColSelect();
    renderTable();
    GroupManager.refresh();
    // Sütun rolleri otomatik algıla ve grid güncelle
    if (typeof ColRoles !== 'undefined') {
      ColRoles.autoDetect(headers, rows);
    }
    App.toast(`${rows.length} satır, ${headers.length} sütun yüklendi`, 'success');
  }

  function populatePeriodColSelect() {
    const sel = document.getElementById('opt-period-col');
    if (!sel) return;
    sel.innerHTML = '<option value="auto">Otomatik tespit</option>';
    headers.forEach(h => {
      const o = document.createElement('option');
      o.value = h; o.textContent = h;
      sel.appendChild(o);
    });
  }

  function renderTable() {
    const head = document.getElementById('table-head');
    const body = document.getElementById('table-body');
    const info = document.getElementById('table-info');
    if (!head) return;

    info.textContent = `${rows.length} × ${headers.length}`;

    head.innerHTML = '';
    const tr = document.createElement('tr');
    const th0 = document.createElement('th');
    th0.className = 'row-num'; th0.textContent = '#';
    tr.appendChild(th0);

    headers.forEach((h, i) => {
      const th = document.createElement('th');
      th.textContent = h;
      th.dataset.col = i;
      if (sortCol === i) th.classList.add(sortDir === 1 ? 'sorted-asc' : 'sorted-desc');
      th.addEventListener('click', () => sortByCol(i));
      th.addEventListener('dblclick', (e) => { e.stopPropagation(); editHeader(th, i); });
      tr.appendChild(th);
    });
    head.appendChild(tr);

    body.innerHTML = '';
    rows.forEach((row, ri) => {
      const tr = document.createElement('tr');
      tr.dataset.row = ri;

      const td0 = document.createElement('td');
      td0.className = 'row-num'; td0.textContent = ri + 1;
      tr.appendChild(td0);

      row.forEach((val, ci) => {
        const td = document.createElement('td');
        td.textContent = val;
        td.dataset.row = ri;
        td.dataset.col = ci;
        td.addEventListener('dblclick', () => editCell(td, ri, ci));
        td.addEventListener('click', (e) => selectCell(td, ri, ci, e));
        tr.appendChild(td);
      });
      body.appendChild(tr);
    });
  }

  function editHeader(th, ci) {
    if (editingCell) commitEdit();
    const old = headers[ci];
    const inp = document.createElement('input');
    inp.value = old;
    inp.style.cssText = 'width:100%;background:transparent;border:none;outline:none;color:inherit;font:inherit;';
    th.textContent = '';
    th.appendChild(inp);
    inp.focus(); inp.select();

    const commit = () => {
      const nv = inp.value.trim() || old;
      headers[ci] = nv;
      snapshot();
      renderTable();
      populatePeriodColSelect();
    };
    inp.addEventListener('blur', commit);
    inp.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); commit(); }
      if (e.key === 'Escape') { headers[ci] = old; renderTable(); }
    });
  }

  function editCell(td, ri, ci) {
    if (editingCell) commitEdit();
    const old = rows[ri][ci];
    td.classList.add('editing');
    const inp = document.createElement('input');
    inp.value = old;
    td.textContent = '';
    td.appendChild(inp);
    inp.focus(); inp.select();
    editingCell = { td, ri, ci, old };

    inp.addEventListener('blur', commitEdit);
    inp.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); commitEdit(); navigateCell(ri, ci, 1, 0); }
      if (e.key === 'Tab')   { e.preventDefault(); commitEdit(); navigateCell(ri, ci, 0, 1); }
      if (e.key === 'Escape') { cancelEdit(); }
      if (e.key === 'ArrowDown')  { e.preventDefault(); commitEdit(); navigateCell(ri, ci, 1, 0); }
      if (e.key === 'ArrowUp')    { e.preventDefault(); commitEdit(); navigateCell(ri, ci, -1, 0); }
      if (e.key === 'ArrowRight' && inp.selectionStart === inp.value.length) { e.preventDefault(); commitEdit(); navigateCell(ri, ci, 0, 1); }
      if (e.key === 'ArrowLeft'  && inp.selectionStart === 0) { e.preventDefault(); commitEdit(); navigateCell(ri, ci, 0, -1); }
    });
  }

  function commitEdit() {
    if (!editingCell) return;
    const { td, ri, ci, old } = editingCell;
    const inp = td.querySelector('input');
    const nv = inp ? inp.value : old;
    rows[ri][ci] = nv;
    td.classList.remove('editing');
    td.textContent = nv;
    editingCell = null;
    if (nv !== old) snapshot();
  }

  function cancelEdit() {
    if (!editingCell) return;
    const { td, old } = editingCell;
    td.classList.remove('editing');
    td.textContent = old;
    editingCell = null;
  }

  function navigateCell(ri, ci, dr, dc) {
    const nr = ri + dr;
    const nc = ci + dc;
    if (nr < 0 || nr >= rows.length || nc < 0 || nc >= headers.length) return;
    const td = document.querySelector(`#table-body td[data-row="${nr}"][data-col="${nc}"]`);
    if (td) editCell(td, nr, nc);
  }

  function selectCell(td, ri, ci, e) {
    if (!e.ctrlKey) {
      document.querySelectorAll('#data-table td.selected').forEach(t => t.classList.remove('selected'));
      selectedCells.clear();
    }
    td.classList.toggle('selected');
    const key = `${ri}:${ci}`;
    if (selectedCells.has(key)) selectedCells.delete(key);
    else selectedCells.add(key);
  }

  function sortByCol(ci) {
    if (sortCol === ci) sortDir *= -1;
    else { sortCol = ci; sortDir = 1; }
    rows.sort((a, b) => {
      const av = a[ci], bv = b[ci];
      const an = parseFloat(av), bn = parseFloat(bv);
      if (!isNaN(an) && !isNaN(bn)) return (an - bn) * sortDir;
      return String(av).localeCompare(String(bv)) * sortDir;
    });
    renderTable();
  }

  function addRow() {
    rows.push(new Array(headers.length).fill(''));
    snapshot();
    renderTable();
  }

  function addCol() {
    const name = `Sütun${headers.length + 1}`;
    headers.push(name);
    rows.forEach(r => r.push(''));
    snapshot();
    renderTable();
    populatePeriodColSelect();
  }

  function deleteSelectedRow() {
    const sel = [...selectedCells];
    if (!sel.length) { App.toast('Silinecek satır seçin', 'warning'); return; }
    const riSet = new Set(sel.map(k => parseInt(k.split(':')[0])));
    rows = rows.filter((_, i) => !riSet.has(i));
    selectedCells.clear();
    snapshot();
    renderTable();
  }

  function deleteSelectedCol() {
    const sel = [...selectedCells];
    if (!sel.length) { App.toast('Silinecek sütun seçin', 'warning'); return; }
    const ciSet = new Set(sel.map(k => parseInt(k.split(':')[1])));
    headers = headers.filter((_, i) => !ciSet.has(i));
    rows = rows.map(r => r.filter((_, i) => !ciSet.has(i)));
    selectedCells.clear();
    snapshot();
    renderTable();
    populatePeriodColSelect();
  }

  function exportCSV() {
    const csv = [headers.join(','), ...rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(','))].join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = 'datalens_export.csv';
    a.click();
  }

  function getCSV() {
    return [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
  }

  function getHeaders() { return [...headers]; }
  function getRows() { return rows.map(r => [...r]); }

  function getData() {
    return rows.map(r => {
      const obj = {};
      headers.forEach((h, i) => { obj[h] = r[i]; });
      return obj;
    });
  }

  function initEvents() {
    const fileInput = document.getElementById('file-input');
    const uploadZone = document.getElementById('upload-zone');
    const pasteModal = document.getElementById('paste-modal');
    const pasteTextarea = document.getElementById('paste-textarea');

    fileInput?.addEventListener('change', e => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = ev => loadCSV(ev.target.result);
      reader.readAsText(file, 'utf-8');
      fileInput.value = '';
    });

    uploadZone?.addEventListener('dragover', e => { e.preventDefault(); uploadZone.classList.add('drag-over'); });
    uploadZone?.addEventListener('dragleave', () => uploadZone.classList.remove('drag-over'));
    uploadZone?.addEventListener('drop', e => {
      e.preventDefault();
      uploadZone.classList.remove('drag-over');
      const file = e.dataTransfer.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = ev => loadCSV(ev.target.result);
      reader.readAsText(file, 'utf-8');
    });

    document.getElementById('btn-paste-csv')?.addEventListener('click', () => {
      pasteModal.style.display = 'flex';
      pasteTextarea.focus();
    });

    const closeP = () => { pasteModal.style.display = 'none'; pasteTextarea.value = ''; };
    document.getElementById('btn-close-paste')?.addEventListener('click', closeP);
    document.getElementById('btn-close-paste-2')?.addEventListener('click', closeP);

    document.getElementById('btn-confirm-paste')?.addEventListener('click', () => {
      const txt = pasteTextarea.value.trim();
      if (!txt) { App.toast('Boş içerik', 'warning'); return; }
      loadCSV(txt);
      closeP();
    });

    document.getElementById('btn-add-row')?.addEventListener('click', addRow);
    document.getElementById('btn-add-col')?.addEventListener('click', addCol);
    document.getElementById('btn-del-row')?.addEventListener('click', deleteSelectedRow);
    document.getElementById('btn-del-col')?.addEventListener('click', deleteSelectedCol);
    document.getElementById('btn-export-csv')?.addEventListener('click', exportCSV);

    document.getElementById('btn-undo')?.addEventListener('click', undo);
    document.getElementById('btn-redo')?.addEventListener('click', redo);
    document.getElementById('btn-reset')?.addEventListener('click', resetToOriginal);

    document.addEventListener('keydown', e => {
      const active = document.getElementById('tab-new-analysis');
      if (!active?.classList.contains('active')) return;
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') { e.preventDefault(); undo(); }
      if ((e.ctrlKey || e.metaKey) && e.key === 'y') { e.preventDefault(); redo(); }
      if (e.key === 'Escape' && editingCell) cancelEdit();
    });

    document.addEventListener('click', e => {
      if (editingCell && !e.target.closest('#data-table')) commitEdit();
    });
  }

  return { init: initEvents, loadCSV, getCSV, getHeaders, getRows, getData, undo, redo, resetToOriginal };
})();


const GroupManager = (() => {
  let groups = [];
  let editIdx = -1;
  let selectedColor = '#8b5cf6';
  let rangeMode = 'auto';

  function open(idx = -1) {
    editIdx = idx;
    selectedColor = '#8b5cf6';
    rangeMode = 'auto';

    const modal = document.getElementById('group-modal-overlay');
    const title = document.getElementById('group-modal-title');
    const nameInp = document.getElementById('group-name-input');
    const colBox = document.getElementById('column-checkboxes');

    if (idx === -1) {
      title.textContent = 'Yeni Grup';
      nameInp.value = '';
      document.getElementById('group-min').value = '';
      document.getElementById('group-max').value = '';
    } else {
      const g = groups[idx];
      title.textContent = 'Grubu Düzenle';
      nameInp.value = g.name;
      selectedColor = g.color;
      rangeMode = g.rangeMode || 'auto';
      document.getElementById('group-min').value = g.min ?? '';
      document.getElementById('group-max').value = g.max ?? '';
    }

    setRangeMode(rangeMode);

    document.querySelectorAll('.color-swatch').forEach(s => {
      s.classList.toggle('selected', s.dataset.color === selectedColor);
    });
    document.getElementById('group-color-custom').value = selectedColor;

    colBox.innerHTML = '';
    const headers = Editor.getHeaders();
    headers.forEach(h => {
      const chip = document.createElement('label');
      chip.className = 'col-chip';
      const checked = idx !== -1 && groups[idx].columns.includes(h);
      if (checked) chip.classList.add('selected');
      chip.innerHTML = `<input type="checkbox" value="${h}" ${checked ? 'checked' : ''} />${h}`;
      chip.querySelector('input').addEventListener('change', e => {
        chip.classList.toggle('selected', e.target.checked);
      });
      colBox.appendChild(chip);
    });

    modal.style.display = 'flex';
    nameInp.focus();
  }

  function close() {
    document.getElementById('group-modal-overlay').style.display = 'none';
  }

  function save() {
    const name = document.getElementById('group-name-input').value.trim();
    if (!name) { App.toast('Grup adı girin', 'warning'); return; }

    const cols = [...document.querySelectorAll('#column-checkboxes input:checked')].map(i => i.value);
    if (!cols.length) { App.toast('En az bir sütun seçin', 'warning'); return; }

    let min = null, max = null;
    if (rangeMode === 'manual') {
      const minV = document.getElementById('group-min').value;
      const maxV = document.getElementById('group-max').value;
      if (minV !== '') min = parseFloat(minV);
      if (maxV !== '') max = parseFloat(maxV);
      if (min !== null && max !== null && min > max) { App.toast('Min, Max\'tan büyük olamaz', 'warning'); return; }
    } else {
      const bounds = autoRange(cols);
      min = bounds.min; max = bounds.max;
    }

    const group = { name, color: selectedColor, columns: cols, rangeMode, min, max };

    if (editIdx === -1) groups.push(group);
    else groups[editIdx] = group;

    close();
    render();
    App.toast(editIdx === -1 ? 'Grup eklendi' : 'Grup güncellendi', 'success');
    editIdx = -1;
  }

  function autoRange(cols) {
    const rows = Editor.getData();
    let vals = [];
    rows.forEach(row => {
      let sum = 0;
      let valid = true;
      cols.forEach(c => {
        const v = parseFloat(row[c]);
        if (isNaN(v)) valid = false;
        else sum += v;
      });
      if (valid) vals.push(sum);
    });
    if (!vals.length) return { min: null, max: null };
    const fmt = document.getElementById('opt-number-format')?.value === 'int';
    const mn = Math.min(...vals);
    const mx = Math.max(...vals);
    return {
      min: fmt ? Math.floor(mn) : Math.round(mn * 100) / 100,
      max: fmt ? Math.ceil(mx) : Math.round(mx * 100) / 100
    };
  }

  function remove(idx) {
    groups.splice(idx, 1);
    render();
  }

  function render() {
    const list = document.getElementById('groups-list');
    const empty = document.getElementById('groups-empty-msg');
    if (!list) return;

    if (!groups.length) {
      list.innerHTML = '';
      list.appendChild(empty || (() => {
        const d = document.createElement('div');
        d.className = 'groups-empty-msg';
        d.id = 'groups-empty-msg';
        d.textContent = 'Henüz grup eklenmedi.';
        return d;
      })());
      return;
    }

    list.innerHTML = '';
    groups.forEach((g, i) => {
      const item = document.createElement('div');
      item.className = 'group-item';
      item.innerHTML = `
        <div class="group-color-dot" style="background:${g.color};color:${g.color}"></div>
        <div class="group-name">${g.name}</div>
        <div class="group-columns">${g.columns.join(', ')}</div>
        <div class="group-range">${g.min ?? '?'} — ${g.max ?? '?'}</div>
        <div class="group-item-actions">
          <button class="btn-xs" data-edit="${i}"><i data-lucide="pencil"></i></button>
          <button class="btn-xs danger" data-del="${i}"><i data-lucide="trash-2"></i></button>
        </div>`;
      item.querySelector('[data-edit]').addEventListener('click', () => open(i));
      item.querySelector('[data-del]').addEventListener('click', () => remove(i));
      list.appendChild(item);
    });
    lucide.createIcons();
  }

  function setRangeMode(mode) {
    rangeMode = mode;
    const autoBtn = document.getElementById('range-auto-btn');
    const manBtn = document.getElementById('range-manual-btn');
    const inputs = document.getElementById('range-inputs');
    const hint = document.getElementById('range-hint');
    autoBtn?.classList.toggle('active', mode === 'auto');
    manBtn?.classList.toggle('active', mode === 'manual');
    if (inputs) inputs.style.display = mode === 'manual' ? 'block' : 'none';
    if (hint) hint.style.display = mode === 'auto' ? 'block' : 'none';
  }


  function addFromAI(g) {
    const headers = Editor.getHeaders();
    const validCols = (g.columns || []).filter(c => headers.includes(c));
    if (!validCols.length) return;
    const bounds = autoRange(validCols);
    groups.push({
      name: g.name || 'AI Grubu',
      color: g.color || '#8b5cf6',
      columns: validCols,
      rangeMode: 'auto',
      min: bounds.min,
      max: bounds.max
    });
    render();
  }

  function refresh() { render(); }
  function getGroups() { return JSON.parse(JSON.stringify(groups)); }

  function initEvents() {
    document.getElementById('btn-add-group')?.addEventListener('click', () => open());
    document.getElementById('btn-close-group-modal')?.addEventListener('click', close);
    document.getElementById('btn-cancel-group')?.addEventListener('click', close);
    document.getElementById('btn-save-group')?.addEventListener('click', save);

    document.getElementById('range-auto-btn')?.addEventListener('click', () => setRangeMode('auto'));
    document.getElementById('range-manual-btn')?.addEventListener('click', () => setRangeMode('manual'));

    document.querySelectorAll('.color-swatch').forEach(s => {
      s.addEventListener('click', () => {
        selectedColor = s.dataset.color;
        document.querySelectorAll('.color-swatch').forEach(x => x.classList.remove('selected'));
        s.classList.add('selected');
        document.getElementById('group-color-custom').value = selectedColor;
      });
    });

    document.getElementById('group-color-custom')?.addEventListener('input', e => {
      selectedColor = e.target.value;
      document.querySelectorAll('.color-swatch').forEach(x => x.classList.remove('selected'));
    });

    document.getElementById('group-modal-overlay')?.addEventListener('click', e => {
      if (e.target === document.getElementById('group-modal-overlay')) close();
    });
  }

  return { init: initEvents, refresh, getGroups, render, addFromAI };
})();
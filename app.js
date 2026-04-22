/* =========================================================
   Mes Dépenses — PWA (FCFA)
   Personal expense tracker, all data in localStorage.
   ========================================================= */

'use strict';

// ---------- Storage ----------
const STORAGE_KEY = 'mes_depenses_v1';

const defaultCategories = [
  { id: 'cat-food',      name: 'Alimentation', icon: '🍽️', color: '#f97316', type: 'expense' },
  { id: 'cat-transport', name: 'Transport',    icon: '🚗', color: '#3b82f6', type: 'expense' },
  { id: 'cat-rent',      name: 'Loyer',        icon: '🏠', color: '#8b5cf6', type: 'expense' },
  { id: 'cat-bills',     name: 'Factures',     icon: '💡', color: '#eab308', type: 'expense' },
  { id: 'cat-health',    name: 'Santé',        icon: '💊', color: '#ef4444', type: 'expense' },
  { id: 'cat-leisure',   name: 'Loisirs',      icon: '🎮', color: '#ec4899', type: 'expense' },
  { id: 'cat-edu',       name: 'Éducation',    icon: '📚', color: '#06b6d4', type: 'expense' },
  { id: 'cat-clothes',   name: 'Vêtements',    icon: '👕', color: '#14b8a6', type: 'expense' },
  { id: 'cat-family',    name: 'Famille',      icon: '👨‍👩‍👧', color: '#a855f7', type: 'expense' },
  { id: 'cat-other-e',   name: 'Autre dépense',icon: '📦', color: '#64748b', type: 'expense' },
  { id: 'cat-salary',    name: 'Salaire',      icon: '💼', color: '#10b981', type: 'income' },
  { id: 'cat-bonus',     name: 'Prime',        icon: '🎁', color: '#22c55e', type: 'income' },
  { id: 'cat-other-i',   name: 'Autre revenu', icon: '💰', color: '#84cc16', type: 'income' },
];

const defaultState = {
  transactions: [],
  categories: defaultCategories,
  settings: { monthlyBudget: 0, theme: 'auto', lastRecurringRun: '', lastSync: '' },
};

let state = loadState();

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return structuredClone(defaultState);
    const parsed = JSON.parse(raw);
    return {
      transactions: parsed.transactions || [],
      categories: parsed.categories?.length ? parsed.categories : defaultCategories,
      settings: { ...defaultState.settings, ...(parsed.settings || {}) },
    };
  } catch {
    return structuredClone(defaultState);
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

// ---------- Utils ----------
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);
const uid = () => 't-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

const nfFCFA = new Intl.NumberFormat('fr-FR');
const fmtMoney = (n) => nfFCFA.format(Math.round(n || 0)) + ' FCFA';
const fmtMoneyShort = (n) => {
  const v = Math.round(n || 0);
  if (v >= 1_000_000) return (v / 1_000_000).toFixed(1).replace('.0', '') + ' M';
  if (v >= 1_000) return (v / 1_000).toFixed(0) + ' k';
  return String(v);
};

const todayISO = () => new Date().toISOString().slice(0, 10);
const ymKey = (d) => {
  const dt = (d instanceof Date) ? d : new Date(d);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`;
};
const prettyMonth = (ym) => {
  const [y, m] = ym.split('-').map(Number);
  const dt = new Date(y, m - 1, 1);
  return dt.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
};
const prettyDate = (iso) => new Date(iso).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });

function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => (el.hidden = true), 2200);
}

// ---------- App state (UI) ----------
let currentMonth = ymKey(new Date());
let charts = { category: null, trend: null, compare: null };

// ---------- Recurring ----------
function applyRecurring() {
  const nowYM = ymKey(new Date());
  if (state.settings.lastRecurringRun === nowYM) return;

  const existingByMonth = new Map();
  state.transactions.forEach(t => {
    const key = ymKey(t.date) + '|' + (t.recurringParentId || '');
    if (t.recurringParentId) existingByMonth.set(key, true);
  });

  const parents = state.transactions.filter(t => t.recurring);
  const today = new Date();

  parents.forEach(p => {
    const startDate = new Date(p.date);
    const cursor = new Date(startDate.getFullYear(), startDate.getMonth() + 1, 1);
    while (cursor <= today) {
      const targetDay = Math.min(startDate.getDate(), new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate());
      const targetDate = new Date(cursor.getFullYear(), cursor.getMonth(), targetDay);
      const targetISO = targetDate.toISOString().slice(0, 10);
      const ym = ymKey(targetISO);
      const key = ym + '|' + p.id;

      if (!existingByMonth.has(key)) {
        state.transactions.push({
          id: uid(),
          type: p.type,
          amount: p.amount,
          date: targetISO,
          categoryId: p.categoryId,
          description: p.description,
          recurring: false,
          recurringParentId: p.id,
        });
        existingByMonth.set(key, true);
      }
      cursor.setMonth(cursor.getMonth() + 1);
    }
  });

  state.settings.lastRecurringRun = nowYM;
  saveState();
}

// ---------- Theme ----------
function applyTheme() {
  const t = state.settings.theme || 'auto';
  if (t === 'auto') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', t);
  $$('.theme-btn').forEach(b => b.classList.toggle('active', b.dataset.theme === t));
}

// ---------- Navigation ----------
function navigate(view) {
  $$('.view').forEach(v => v.classList.remove('active'));
  $('#view-' + view).classList.add('active');
  $$('.nav-btn[data-nav]').forEach(b => b.classList.toggle('active', b.dataset.nav === view));
  window.scrollTo({ top: 0, behavior: 'instant' });
  if (view === 'dashboard') renderDashboard();
  if (view === 'transactions') renderTransactions();
  if (view === 'stats') renderStats();
  if (view === 'settings') renderSettings();
}

// ---------- Month navigation ----------
function changeMonth(delta) {
  const [y, m] = currentMonth.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  currentMonth = ymKey(d);
  updateHeader();
  const active = document.querySelector('.view.active')?.id;
  if (active === 'view-dashboard') renderDashboard();
  if (active === 'view-transactions') renderTransactions();
  if (active === 'view-stats') renderStats();
}

function updateHeader() {
  $('#currentMonthLabel').textContent = capitalize(prettyMonth(currentMonth));
  const now = ymKey(new Date());
  $('#headerSubtitle').textContent = currentMonth === now ? 'Mois en cours' : (currentMonth > now ? 'À venir' : 'Historique');
}
const capitalize = (s) => s.charAt(0).toUpperCase() + s.slice(1);

// ---------- Data helpers ----------
function txOfMonth(ym) {
  return state.transactions.filter(t => ymKey(t.date) === ym);
}
function getCategory(id) {
  return state.categories.find(c => c.id === id) || { name: 'Inconnu', icon: '❔', color: '#64748b', type: 'expense' };
}
function totals(txs) {
  let expense = 0, income = 0;
  txs.forEach(t => { if (t.type === 'expense') expense += t.amount; else income += t.amount; });
  return { expense, income, balance: income - expense };
}

// ---------- Dashboard ----------
function renderDashboard() {
  const txs = txOfMonth(currentMonth);
  const { expense, income, balance } = totals(txs);
  $('#sumExpense').textContent = fmtMoney(expense);
  $('#sumIncome').textContent = fmtMoney(income);
  $('#sumBalance').textContent = fmtMoney(balance);

  const budget = state.settings.monthlyBudget || 0;
  const remaining = Math.max(0, budget - expense);
  $('#sumBudget').textContent = budget ? fmtMoney(remaining) : '—';

  const pct = budget ? Math.min(100, (expense / budget) * 100) : 0;
  $('#budgetProgress').style.width = pct + '%';
  $('#budgetPercent').textContent = budget ? pct.toFixed(0) + '%' : '—';
  $('#budgetText').textContent = budget
    ? (expense > budget
        ? `⚠️ Dépassement de ${fmtMoney(expense - budget)}`
        : `${fmtMoney(expense)} dépensés sur ${fmtMoney(budget)}`)
    : 'Définis ton budget dans les Paramètres';

  renderCategoryChart(txs);
  renderTrendChart();
  renderRecent(txs);
}

function renderCategoryChart(txs) {
  const expenses = txs.filter(t => t.type === 'expense');
  const byCat = new Map();
  expenses.forEach(t => byCat.set(t.categoryId, (byCat.get(t.categoryId) || 0) + t.amount));

  const entries = [...byCat.entries()]
    .map(([id, sum]) => ({ cat: getCategory(id), sum }))
    .sort((a, b) => b.sum - a.sum);

  const ctx = $('#categoryChart').getContext('2d');
  if (charts.category) charts.category.destroy();

  if (!entries.length) {
    charts.category = null;
    $('#categoryLegend').innerHTML = '<p class="muted small">Aucune dépense ce mois.</p>';
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    return;
  }

  charts.category = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: entries.map(e => e.cat.name),
      datasets: [{
        data: entries.map(e => e.sum),
        backgroundColor: entries.map(e => e.cat.color),
        borderWidth: 0,
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      cutout: '65%',
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: (ctx) => `${ctx.label}: ${fmtMoney(ctx.parsed)}` } },
      },
    },
  });

  $('#categoryLegend').innerHTML = entries.map(e => `
    <span class="legend-item">
      <span class="legend-swatch" style="background:${e.cat.color}"></span>
      ${e.cat.icon} ${e.cat.name} · ${fmtMoney(e.sum)}
    </span>
  `).join('');
}

function renderTrendChart() {
  const months = [];
  const [y, m] = currentMonth.split('-').map(Number);
  for (let i = 5; i >= 0; i--) {
    const d = new Date(y, m - 1 - i, 1);
    months.push(ymKey(d));
  }
  const data = months.map(ym => {
    const t = totals(txOfMonth(ym));
    return { ym, expense: t.expense, income: t.income };
  });

  const ctx = $('#trendChart').getContext('2d');
  if (charts.trend) charts.trend.destroy();

  charts.trend = new Chart(ctx, {
    type: 'line',
    data: {
      labels: data.map(d => prettyMonth(d.ym).replace(/ \d{4}$/, '')),
      datasets: [
        { label: 'Dépenses', data: data.map(d => d.expense), borderColor: '#ef4444', backgroundColor: 'rgba(239,68,68,0.15)', tension: 0.3, fill: true },
        { label: 'Revenus',  data: data.map(d => d.income),  borderColor: '#10b981', backgroundColor: 'rgba(16,185,129,0.15)', tension: 0.3, fill: true },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { position: 'bottom', labels: { boxWidth: 10, font: { size: 11 } } },
        tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${fmtMoney(c.parsed.y)}` } },
      },
      scales: {
        y: { ticks: { callback: (v) => fmtMoneyShort(v), font: { size: 10 } } },
        x: { ticks: { font: { size: 10 } } },
      },
    },
  });
}

function renderRecent(txs) {
  const sorted = [...txs].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5);
  $('#recentTx').innerHTML = sorted.length ? sorted.map(txRowHTML).join('') : '<li class="muted small" style="padding:10px 0">Aucune transaction.</li>';
  $('#recentTx').querySelectorAll('[data-tx-id]').forEach(el => {
    el.addEventListener('click', () => openTxModal(el.dataset.txId));
  });
}

function txRowHTML(t) {
  const c = getCategory(t.categoryId);
  const sign = t.type === 'expense' ? '−' : '+';
  const cls = t.type;
  const desc = t.description || c.name;
  return `
    <li class="tx-item" data-tx-id="${t.id}">
      <div class="tx-icon" style="background:${c.color}22;color:${c.color}">${c.icon}</div>
      <div class="tx-body">
        <div class="tx-title">${escapeHtml(desc)}${t.recurringParentId ? ' 🔁' : (t.recurring ? ' 🔁' : '')}</div>
        <div class="tx-sub">${c.name} · ${prettyDate(t.date)}</div>
      </div>
      <div class="tx-amount ${cls}">${sign} ${fmtMoney(t.amount)}</div>
    </li>
  `;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ---------- Transactions view ----------
function renderTransactions() {
  const search = $('#searchInput').value.trim().toLowerCase();
  const filterCat = $('#filterCategory').value;
  const filterType = $('#filterType').value;

  // Populate category filter once per render
  if (!$('#filterCategory').dataset.ready) {
    $('#filterCategory').innerHTML = '<option value="">Toutes catégories</option>' +
      state.categories.map(c => `<option value="${c.id}">${c.icon} ${c.name}</option>`).join('');
    $('#filterCategory').dataset.ready = '1';
  }

  let txs = txOfMonth(currentMonth);
  if (filterType) txs = txs.filter(t => t.type === filterType);
  if (filterCat) txs = txs.filter(t => t.categoryId === filterCat);
  if (search) {
    txs = txs.filter(t => {
      const c = getCategory(t.categoryId);
      return (t.description || '').toLowerCase().includes(search) || c.name.toLowerCase().includes(search);
    });
  }

  // Group by date
  const groups = new Map();
  txs.sort((a, b) => b.date.localeCompare(a.date)).forEach(t => {
    if (!groups.has(t.date)) groups.set(t.date, []);
    groups.get(t.date).push(t);
  });

  const container = $('#txGroups');
  if (!groups.size) {
    container.innerHTML = '';
    $('#txEmpty').hidden = false;
  } else {
    $('#txEmpty').hidden = true;
    container.innerHTML = [...groups.entries()].map(([date, items]) => {
      const { expense, income } = totals(items);
      const net = income - expense;
      return `
        <div class="tx-group">
          <div class="tx-group-header">
            <span>${capitalize(prettyDate(date))}</span>
            <span>${net >= 0 ? '+' : ''}${fmtMoney(net)}</span>
          </div>
          <ul class="tx-list">${items.map(txRowHTML).join('')}</ul>
        </div>
      `;
    }).join('');
    container.querySelectorAll('[data-tx-id]').forEach(el => {
      el.addEventListener('click', () => openTxModal(el.dataset.txId));
    });
  }
}

// ---------- Stats view ----------
function renderStats() {
  const txs = txOfMonth(currentMonth);
  const expenses = txs.filter(t => t.type === 'expense');

  // Top categories
  const byCat = new Map();
  expenses.forEach(t => byCat.set(t.categoryId, (byCat.get(t.categoryId) || 0) + t.amount));
  const sorted = [...byCat.entries()].map(([id, sum]) => ({ cat: getCategory(id), sum })).sort((a, b) => b.sum - a.sum);
  const maxSum = sorted[0]?.sum || 1;

  $('#topCategories').innerHTML = sorted.length
    ? sorted.map(e => `
      <li>
        <span style="min-width:90px">${e.cat.icon} ${e.cat.name}</span>
        <span class="rank-bar"><span class="rank-bar-fill" style="width:${(e.sum/maxSum*100).toFixed(0)}%; background:${e.cat.color}"></span></span>
        <span style="font-weight:600">${fmtMoney(e.sum)}</span>
      </li>`).join('')
    : '<li class="muted small">Aucune donnée ce mois.</li>';

  // Daily average
  const [y, m] = currentMonth.split('-').map(Number);
  const daysInMonth = new Date(y, m, 0).getDate();
  const now = new Date();
  const isCurrent = ymKey(now) === currentMonth;
  const daysElapsed = isCurrent ? now.getDate() : daysInMonth;
  const totalExp = expenses.reduce((s, t) => s + t.amount, 0);
  const avg = daysElapsed ? totalExp / daysElapsed : 0;
  $('#dailyAverage').textContent = fmtMoney(avg);
  $('#dailyAverageText').textContent = `${fmtMoney(totalExp)} sur ${daysElapsed} jour${daysElapsed > 1 ? 's' : ''}`;

  // Compare last 6 months (reuse trend-like bar)
  const months = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(y, m - 1 - i, 1);
    months.push(ymKey(d));
  }
  const compareData = months.map(ym => totals(txOfMonth(ym)).expense);

  const ctx = $('#compareChart').getContext('2d');
  if (charts.compare) charts.compare.destroy();
  charts.compare = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: months.map(ym => prettyMonth(ym).replace(/ \d{4}$/, '')),
      datasets: [{
        label: 'Dépenses',
        data: compareData,
        backgroundColor: months.map(ym => ym === currentMonth ? '#3b82f6' : '#94a3b8'),
        borderRadius: 6,
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: (c) => fmtMoney(c.parsed.y) } },
      },
      scales: {
        y: { ticks: { callback: (v) => fmtMoneyShort(v), font: { size: 10 } } },
        x: { ticks: { font: { size: 10 } } },
      },
    },
  });

  // Yearly total
  const yearTxs = state.transactions.filter(t => t.date.startsWith(String(y) + '-'));
  const yt = totals(yearTxs);
  $('#yearlyTotal').textContent = fmtMoney(yt.expense);
  $('#yearlyText').textContent = `Revenus ${y} : ${fmtMoney(yt.income)} · Solde : ${fmtMoney(yt.balance)}`;
}

// ---------- Settings ----------
function renderSettings() {
  $('#budgetInput').value = state.settings.monthlyBudget || '';
  $('#categoryList').innerHTML = state.categories.map(c => `
    <li data-cat-id="${c.id}">
      <div class="cat-icon" style="background:${c.color}22;color:${c.color}">${c.icon}</div>
      <span class="cat-name">${escapeHtml(c.name)}</span>
      <span class="cat-type">${c.type === 'expense' ? 'Dépense' : c.type === 'income' ? 'Revenu' : 'Les deux'}</span>
      <button class="cat-edit">Modifier</button>
    </li>
  `).join('');
  $('#categoryList').querySelectorAll('li').forEach(li => {
    li.querySelector('.cat-edit').addEventListener('click', () => openCatModal(li.dataset.catId));
  });

  const lastSyncEl = $('#lastSyncText');
  if (lastSyncEl) lastSyncEl.textContent = 'Dernière sauvegarde : ' + formatSyncTime(state.settings.lastSync);
}

// ---------- Transaction modal ----------
function openTxModal(txId) {
  const modal = $('#txModal');
  const existing = txId ? state.transactions.find(t => t.id === txId) : null;
  $('#txId').value = existing?.id || '';
  $('#txAmount').value = existing?.amount ?? '';
  $('#txDate').value = existing?.date || todayISO();
  $('#txDescription').value = existing?.description || '';
  $('#txRecurring').checked = !!existing?.recurring;

  const type = existing?.type || 'expense';
  setTxType(type);

  if (existing) {
    $('#txCategory').value = existing.categoryId;
    $('#txModalTitle').textContent = existing.type === 'expense' ? 'Modifier la dépense' : 'Modifier le revenu';
    $('#deleteTx').hidden = false;
  } else {
    $('#txModalTitle').textContent = 'Nouvelle dépense';
    $('#deleteTx').hidden = true;
  }

  modal.hidden = false;
  setTimeout(() => $('#txAmount').focus(), 100);
}

function setTxType(type) {
  $$('.type-btn').forEach(b => b.classList.toggle('active', b.dataset.type === type));
  const cats = state.categories.filter(c => c.type === type || c.type === 'both');
  $('#txCategory').innerHTML = cats.map(c => `<option value="${c.id}">${c.icon} ${c.name}</option>`).join('');
  $('#txModalTitle').textContent = $('#txId').value
    ? (type === 'expense' ? 'Modifier la dépense' : 'Modifier le revenu')
    : (type === 'expense' ? 'Nouvelle dépense' : 'Nouveau revenu');
}

function saveTransaction(e) {
  e.preventDefault();
  const id = $('#txId').value || uid();
  const type = $('.type-btn.active').dataset.type;
  const amount = parseFloat($('#txAmount').value);
  const date = $('#txDate').value;
  const categoryId = $('#txCategory').value;
  const description = $('#txDescription').value.trim();
  const recurring = $('#txRecurring').checked;

  if (!amount || amount <= 0) return toast('Montant invalide');
  if (!date) return toast('Date invalide');
  if (!categoryId) return toast('Choisis une catégorie');

  const existing = state.transactions.find(t => t.id === id);
  const tx = { id, type, amount, date, categoryId, description, recurring, recurringParentId: existing?.recurringParentId };
  if (existing) Object.assign(existing, tx);
  else state.transactions.push(tx);

  saveState();
  closeTxModal();
  toast(existing ? 'Modifié' : 'Ajouté');
  refreshAll();
}

function deleteTransaction() {
  const id = $('#txId').value;
  if (!id) return;
  const tx = state.transactions.find(t => t.id === id);
  const hasChildren = state.transactions.some(t => t.recurringParentId === id);
  let msg = 'Supprimer cette transaction ?';
  if (hasChildren) msg = 'Supprimer aussi toutes les occurrences récurrentes ?';
  if (!confirm(msg)) return;

  state.transactions = state.transactions.filter(t => t.id !== id && t.recurringParentId !== id);
  saveState();
  closeTxModal();
  toast('Supprimé');
  refreshAll();
}

function closeTxModal() {
  $('#txModal').hidden = true;
}

// ---------- Category modal ----------
function openCatModal(catId) {
  const existing = catId ? state.categories.find(c => c.id === catId) : null;
  $('#catId').value = existing?.id || '';
  $('#catName').value = existing?.name || '';
  $('#catIcon').value = existing?.icon || '📦';
  $('#catColor').value = existing?.color || '#3b82f6';
  $('#catType').value = existing?.type || 'expense';
  $('#catModalTitle').textContent = existing ? 'Modifier la catégorie' : 'Nouvelle catégorie';
  $('#deleteCat').hidden = !existing;
  $('#catModal').hidden = false;
}

function saveCategory(e) {
  e.preventDefault();
  const id = $('#catId').value || 'cat-' + uid();
  const name = $('#catName').value.trim();
  const icon = $('#catIcon').value.trim() || '📦';
  const color = $('#catColor').value;
  const type = $('#catType').value;

  if (!name) return toast('Nom requis');

  const existing = state.categories.find(c => c.id === id);
  if (existing) Object.assign(existing, { name, icon, color, type });
  else state.categories.push({ id, name, icon, color, type });

  saveState();
  $('#catModal').hidden = true;
  delete $('#filterCategory').dataset.ready;
  toast(existing ? 'Catégorie modifiée' : 'Catégorie ajoutée');
  refreshAll();
  renderSettings();
}

function deleteCategory() {
  const id = $('#catId').value;
  if (!id) return;
  const used = state.transactions.some(t => t.categoryId === id);
  if (used) {
    if (!confirm('Cette catégorie contient des transactions. Les transactions seront conservées mais sans catégorie valide. Continuer ?')) return;
  } else {
    if (!confirm('Supprimer cette catégorie ?')) return;
  }
  state.categories = state.categories.filter(c => c.id !== id);
  saveState();
  $('#catModal').hidden = true;
  delete $('#filterCategory').dataset.ready;
  toast('Supprimée');
  refreshAll();
  renderSettings();
}

// ---------- Export / Import ----------
function exportJson() {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  downloadBlob(blob, `mes-depenses-${todayISO()}.json`);
}

function exportCsv() {
  const rows = [['Date', 'Type', 'Catégorie', 'Description', 'Montant (FCFA)']];
  state.transactions
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date))
    .forEach(t => {
      const c = getCategory(t.categoryId);
      rows.push([t.date, t.type === 'expense' ? 'Dépense' : 'Revenu', c.name, t.description || '', t.amount]);
    });
  const csv = rows.map(r => r.map(csvCell).join(',')).join('\n');
  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
  downloadBlob(blob, `mes-depenses-${todayISO()}.csv`);
}

function csvCell(v) {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function importJson(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      if (!data.transactions || !data.categories) throw new Error('Fichier invalide');
      if (!confirm('Remplacer toutes tes données actuelles par celles du fichier ?')) return;
      state = {
        transactions: data.transactions,
        categories: data.categories,
        settings: { ...defaultState.settings, ...(data.settings || {}) },
      };
      saveState();
      applyTheme();
      toast('Importé');
      refreshAll();
    } catch (err) {
      toast('Fichier invalide');
    }
  };
  reader.readAsText(file);
}

// ---------- Cloud sync (via iOS Share / file picker) ----------
const SYNC_FILENAME = 'mes-depenses-sync.json';

async function cloudSave() {
  const payload = { ...state, _savedAt: new Date().toISOString() };
  const json = JSON.stringify(payload, null, 2);
  const file = new File([json], SYNC_FILENAME, { type: 'application/json' });

  // iOS 15+ / Safari : Web Share API avec fichier → menu Partager → Fichiers
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: 'Mes Dépenses — Sauvegarde' });
      state.settings.lastSync = new Date().toISOString();
      saveState();
      toast('Sauvegardé ✔');
      renderSettings();
      return;
    } catch (err) {
      if (err && err.name === 'AbortError') return;
    }
  }

  // Fallback desktop / navigateur sans Share API
  const blob = new Blob([json], { type: 'application/json' });
  downloadBlob(blob, SYNC_FILENAME);
  state.settings.lastSync = new Date().toISOString();
  saveState();
  toast('Fichier téléchargé');
  renderSettings();
}

function cloudRestore(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      if (!Array.isArray(data.transactions) || !Array.isArray(data.categories)) {
        throw new Error('invalid');
      }

      const localCount = state.transactions.length;
      const remoteCount = data.transactions.length;
      const savedAt = data._savedAt
        ? new Date(data._savedAt).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })
        : 'inconnue';

      const choice = prompt(
        `Fichier du ${savedAt}\n` +
        `Local : ${localCount} transaction${localCount > 1 ? 's' : ''}\n` +
        `Fichier : ${remoteCount} transaction${remoteCount > 1 ? 's' : ''}\n\n` +
        `Tape F pour FUSIONNER (recommandé — ajoute ce qui manque)\n` +
        `Tape R pour REMPLACER tout\n` +
        `Annule pour ne rien faire.`
      );

      if (!choice) return;
      const mode = choice.trim().toUpperCase();

      if (mode === 'F') {
        const added = mergeIntoState(data);
        toast(added > 0 ? `Fusionné : +${added} transaction${added > 1 ? 's' : ''}` : 'Déjà à jour');
      } else if (mode === 'R') {
        if (!confirm('Remplacer toutes tes données actuelles ? Action irréversible.')) return;
        state = {
          transactions: data.transactions,
          categories: data.categories.length ? data.categories : defaultCategories,
          settings: { ...defaultState.settings, ...(data.settings || {}), lastSync: new Date().toISOString() },
        };
        saveState();
        applyTheme();
        toast('Données remplacées');
      } else {
        toast('Annulé');
        return;
      }

      delete $('#filterCategory').dataset.ready;
      refreshAll();
      renderSettings();
    } catch {
      toast('Fichier invalide');
    }
  };
  reader.readAsText(file);
}

function mergeIntoState(data) {
  const txMap = new Map(state.transactions.map(t => [t.id, t]));
  let added = 0;
  data.transactions.forEach(t => {
    if (!txMap.has(t.id)) { txMap.set(t.id, t); added++; }
  });
  state.transactions = [...txMap.values()];

  const catMap = new Map(state.categories.map(c => [c.id, c]));
  data.categories.forEach(c => {
    if (!catMap.has(c.id)) catMap.set(c.id, c);
  });
  state.categories = [...catMap.values()];

  if (!state.settings.monthlyBudget && data.settings?.monthlyBudget) {
    state.settings.monthlyBudget = data.settings.monthlyBudget;
  }

  state.settings.lastSync = new Date().toISOString();
  saveState();
  return added;
}

function formatSyncTime(iso) {
  if (!iso) return 'jamais';
  const dt = new Date(iso);
  const diffMin = Math.floor((Date.now() - dt.getTime()) / 60000);
  if (diffMin < 1) return "à l'instant";
  if (diffMin < 60) return `il y a ${diffMin} min`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `il y a ${diffH} h`;
  const diffD = Math.floor(diffH / 24);
  if (diffD < 7) return `il y a ${diffD} jour${diffD > 1 ? 's' : ''}`;
  return dt.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
}

function clearAllData() {
  if (!confirm('Vraiment tout effacer ? Cette action est irréversible.')) return;
  if (!confirm('Dernière confirmation : toutes les transactions seront supprimées.')) return;
  localStorage.removeItem(STORAGE_KEY);
  state = structuredClone(defaultState);
  toast('Données effacées');
  refreshAll();
  renderSettings();
}

// ---------- Refresh orchestrator ----------
function refreshAll() {
  const active = document.querySelector('.view.active')?.id;
  if (active === 'view-dashboard') renderDashboard();
  if (active === 'view-transactions') renderTransactions();
  if (active === 'view-stats') renderStats();
  if (active === 'view-settings') renderSettings();
}

// ---------- Event bindings ----------
function bindEvents() {
  $('#prevMonth').addEventListener('click', () => changeMonth(-1));
  $('#nextMonth').addEventListener('click', () => changeMonth(1));

  $$('.nav-btn[data-nav]').forEach(b => b.addEventListener('click', () => navigate(b.dataset.nav)));
  $$('[data-nav]').forEach(b => b.addEventListener('click', () => navigate(b.dataset.nav)));

  $('#openAdd').addEventListener('click', () => openTxModal(null));
  $('#closeTxModal').addEventListener('click', closeTxModal);
  $('#txModal').addEventListener('click', (e) => { if (e.target.id === 'txModal') closeTxModal(); });
  $('#txForm').addEventListener('submit', saveTransaction);
  $('#deleteTx').addEventListener('click', deleteTransaction);
  $$('.type-btn').forEach(b => b.addEventListener('click', () => setTxType(b.dataset.type)));

  $('#addCategoryBtn').addEventListener('click', () => openCatModal(null));
  $('#closeCatModal').addEventListener('click', () => ($('#catModal').hidden = true));
  $('#catModal').addEventListener('click', (e) => { if (e.target.id === 'catModal') $('#catModal').hidden = true; });
  $('#catForm').addEventListener('submit', saveCategory);
  $('#deleteCat').addEventListener('click', deleteCategory);

  $('#searchInput').addEventListener('input', renderTransactions);
  $('#filterCategory').addEventListener('change', renderTransactions);
  $('#filterType').addEventListener('change', renderTransactions);

  $('#saveBudget').addEventListener('click', () => {
    const v = parseFloat($('#budgetInput').value) || 0;
    state.settings.monthlyBudget = v;
    saveState();
    toast('Budget enregistré');
    refreshAll();
  });

  $$('.theme-btn').forEach(b => b.addEventListener('click', () => {
    state.settings.theme = b.dataset.theme;
    saveState();
    applyTheme();
  }));

  $('#exportJson').addEventListener('click', exportJson);
  $('#exportCsv').addEventListener('click', exportCsv);
  $('#importJson').addEventListener('change', (e) => e.target.files[0] && importJson(e.target.files[0]));
  $('#clearData').addEventListener('click', clearAllData);

  $('#cloudSave').addEventListener('click', cloudSave);
  $('#cloudRestore').addEventListener('change', (e) => {
    if (e.target.files[0]) cloudRestore(e.target.files[0]);
    e.target.value = '';
  });
}

// ---------- Service worker ----------
function registerSW() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

// ---------- Init ----------
function init() {
  applyRecurring();
  applyTheme();
  updateHeader();
  bindEvents();
  renderDashboard();
  registerSW();
}

document.addEventListener('DOMContentLoaded', init);

/* =========================================================
   Mes Dépenses — PWA (FCFA) v2
   ========================================================= */

'use strict';

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
  return dt.getFullYear() + '-' + String(dt.getMonth() + 1).padStart(2, '0');
};
const prettyMonth = (ym) => {
  const [y, m] = ym.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
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
    if (t.recurringParentId) existingByMonth.set(ymKey(t.date) + '|' + t.recurringParentId, true);
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
      const key = ymKey(targetISO) + '|' + p.id;
      if (!existingByMonth.has(key)) {
        state.transactions.push({
          id: uid(), type: p.type, amount: p.amount, date: targetISO,
          categoryId: p.categoryId, description: p.description,
          recurring: false, recurringParentId: p.id,
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

function changeMonth(delta) {
  const [y, m] = currentMonth.split('-').map(Number);
  currentMonth = ymKey(new Date(y, m - 1 + delta, 1));
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
function txOfMonth(ym) { return state.transactions.filter(t => ymKey(t.date) === ym); }
function getCategory(id) {
  return state.categories.find(c => c.id === id) || { name: 'Inconnu', icon: '❔', color: '#64748b', type: 'expense' };
}
function totals(txs) {
  let expense = 0, income = 0;
  txs.forEach(t => { if (t.type === 'expense') expense += t.amount; else income += t.amount; });
  return { expense, income, balance: income - expense };
}

// ---------- Greeting & Anecdotes ----------
const GREETINGS = {
  morning:   { emoji: '☀️', label: 'Bon matin', title: ['Bonne journée !', 'Nouveau jour, nouveau départ', 'Le marché vous attend', 'Une belle journée commence'] },
  noon:      { emoji: '🌤️', label: 'Midi',      title: ['Pause bien méritée', 'Bon appétit !', 'Midi à Abidjan', 'Temps de recharger'] },
  afternoon: { emoji: '🌞', label: 'Après-midi', title: ['Bon après-midi', 'La journée avance', 'Garde le rythme', 'Continue comme ça'] },
  evening:   { emoji: '🌅', label: 'Soirée',    title: ['Bonsoir !', 'Belle soirée', 'Le soleil se couche', 'Fin de journée'] },
  night:     { emoji: '🌙', label: 'Bonne nuit', title: ['Douce nuit', 'Un dernier coup d\'œil ?', 'Temps de se reposer', 'La nuit porte conseil'] },
};

const ANECDOTES = {
  first: [
    'Commence par ajouter ta première transaction 👇',
    'Le plus dur, c\'est de commencer. Vas-y !',
    'Prêt à prendre le contrôle de ton argent ?',
    'Ton voyage financier commence ici 🌱',
  ],
  excellent: [
    'Tu gères comme un chef ! 👑',
    'Bravo, ton budget respire 🌿',
    'Tu es sur la bonne voie, continue !',
    'Quelle discipline, c\'est admirable 💪',
    '"Petit à petit, l\'oiseau fait son nid" — proverbe',
    'Tes finances sont en fête ce mois-ci 🎉',
  ],
  good: [
    'Belle maîtrise de ton budget 👍',
    'Tu avances bien, garde le cap',
    'Le mois se passe plutôt bien 😊',
    'Solide, continue comme ça !',
  ],
  warning: [
    'Attention, le budget fond comme beurre au soleil 🌡️',
    'Un peu de vigilance cette semaine',
    'Ralentis un peu, tu approches la limite',
    'Il est temps de serrer la ceinture un peu 👔',
  ],
  over: [
    'Oups, le budget a été dépassé 😅 On repart de zéro demain !',
    'Pas grave, le mois prochain sera meilleur 💪',
    'L\'argent file ? Note chaque dépense pour comprendre',
    '"Qui va doucement va sûrement" — prends le temps',
  ],
  saving: [
    'Tes économies grandissent 🌱',
    'Tu mets de côté, bravo !',
    'Continue d\'épargner, c\'est la clé 🔑',
  ],
  motivation: [
    'Chaque FCFA compte — bienvenue !',
    'Aujourd\'hui est un bon jour pour commencer',
    'L\'argent bien géré, c\'est la liberté',
    '"L\'épargne est la mère de la richesse"',
    'Un budget, c\'est un plan pour tes rêves',
    'Garder trace de tout, c\'est le secret 📝',
  ],
};

function getTimeOfDay() {
  const h = new Date().getHours();
  if (h < 6) return 'night';
  if (h < 12) return 'morning';
  if (h < 14) return 'noon';
  if (h < 18) return 'afternoon';
  if (h < 22) return 'evening';
  return 'night';
}

function pickRandom(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

function renderGreeting() {
  const tod = getTimeOfDay();
  const g = GREETINGS[tod];
  $('#greetingTime').textContent = g.emoji + ' ' + g.label.toUpperCase();
  $('#greetingTitle').textContent = pickRandom(g.title);

  // Choix de l'anecdote selon l'état financier
  const txs = txOfMonth(currentMonth);
  const { expense, income } = totals(txs);
  const budget = state.settings.monthlyBudget || 0;
  const totalTx = state.transactions.length;

  let pool;
  if (totalTx === 0) pool = ANECDOTES.first;
  else if (budget > 0 && expense > budget) pool = ANECDOTES.over;
  else if (budget > 0 && expense > budget * 0.85) pool = ANECDOTES.warning;
  else if (budget > 0 && expense < budget * 0.5 && income > expense) pool = ANECDOTES.excellent;
  else if (income > expense && income > 0) pool = ANECDOTES.saving;
  else if (budget > 0) pool = ANECDOTES.good;
  else pool = ANECDOTES.motivation;

  $('#greetingAnecdote').textContent = pickRandom(pool);
}

// ---------- Dashboard ----------
function renderDashboard() {
  renderGreeting();
  const txs = txOfMonth(currentMonth);
  const { expense, income, balance } = totals(txs);
  $('#sumExpense').textContent = fmtMoney(expense);
  $('#sumIncome').textContent = fmtMoney(income);
  $('#sumBalance').textContent = fmtMoney(balance);

  const budget = state.settings.monthlyBudget || 0;
  $('#sumBudget').textContent = budget ? fmtMoney(Math.max(0, budget - expense)) : '—';
  const pct = budget ? Math.min(100, (expense / budget) * 100) : 0;
  $('#budgetProgress').style.width = pct + '%';
  $('#budgetPercent').textContent = budget ? pct.toFixed(0) + '%' : '—';
  $('#budgetText').textContent = budget
    ? (expense > budget ? '⚠️ Dépassement de ' + fmtMoney(expense - budget) + ' — on reste zen' : fmtMoney(expense) + ' dépensés sur ' + fmtMoney(budget) + ' 💪')
    : '✨ Définis ton budget dans les Paramètres pour démarrer';

  renderCategoryChart(txs);
  renderTrendChart();
  renderRecent(txs);
}

function renderCategoryChart(txs) {
  const expenses = txs.filter(t => t.type === 'expense');
  const byCat = new Map();
  expenses.forEach(t => byCat.set(t.categoryId, (byCat.get(t.categoryId) || 0) + t.amount));
  const entries = [...byCat.entries()].map(([id, sum]) => ({ cat: getCategory(id), sum })).sort((a, b) => b.sum - a.sum);
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
      datasets: [{ data: entries.map(e => e.sum), backgroundColor: entries.map(e => e.cat.color), borderWidth: 0 }],
    },
    options: {
      responsive: true, maintainAspectRatio: false, cutout: '65%',
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: (ctx) => ctx.label + ': ' + fmtMoney(ctx.parsed) } },
      },
    },
  });
  $('#categoryLegend').innerHTML = entries.map(e =>
    '<span class="legend-item"><span class="legend-swatch" style="background:' + e.cat.color + '"></span>' +
    e.cat.icon + ' ' + e.cat.name + ' · ' + fmtMoney(e.sum) + '</span>'
  ).join('');
}

function renderTrendChart() {
  const [y, m] = currentMonth.split('-').map(Number);
  const months = [];
  for (let i = 5; i >= 0; i--) months.push(ymKey(new Date(y, m - 1 - i, 1)));
  const data = months.map(ym => { const t = totals(txOfMonth(ym)); return { ym, expense: t.expense, income: t.income }; });
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
        tooltip: { callbacks: { label: (c) => c.dataset.label + ': ' + fmtMoney(c.parsed.y) } },
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
  $('#recentTx').querySelectorAll('[data-tx-id]').forEach(el => el.addEventListener('click', () => openTxModal(el.dataset.txId)));
}

function txRowHTML(t) {
  const c = getCategory(t.categoryId);
  const sign = t.type === 'expense' ? '−' : '+';
  const desc = t.description || c.name;
  return '<li class="tx-item" data-tx-id="' + t.id + '">' +
    '<div class="tx-icon" style="background:' + c.color + '22;color:' + c.color + '">' + c.icon + '</div>' +
    '<div class="tx-body">' +
      '<div class="tx-title">' + escapeHtml(desc) + (t.recurringParentId || t.recurring ? ' 🔁' : '') + '</div>' +
      '<div class="tx-sub">' + c.name + ' · ' + prettyDate(t.date) + '</div>' +
    '</div>' +
    '<div class="tx-amount ' + t.type + '">' + sign + ' ' + fmtMoney(t.amount) + '</div>' +
    '</li>';
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ---------- Transactions view ----------
function renderTransactions() {
  const search = $('#searchInput').value.trim().toLowerCase();
  const filterCat = $('#filterCategory').value;
  const filterType = $('#filterType').value;

  if (!$('#filterCategory').dataset.ready) {
    $('#filterCategory').innerHTML = '<option value="">Toutes catégories</option>' +
      state.categories.map(c => '<option value="' + c.id + '">' + c.icon + ' ' + c.name + '</option>').join('');
    $('#filterCategory').dataset.ready = '1';
  }

  let txs = txOfMonth(currentMonth);
  if (filterType) txs = txs.filter(t => t.type === filterType);
  if (filterCat) txs = txs.filter(t => t.categoryId === filterCat);
  if (search) txs = txs.filter(t => {
    const c = getCategory(t.categoryId);
    return (t.description || '').toLowerCase().includes(search) || c.name.toLowerCase().includes(search);
  });

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
      return '<div class="tx-group">' +
        '<div class="tx-group-header"><span>' + capitalize(prettyDate(date)) + '</span><span>' + (net >= 0 ? '+' : '') + fmtMoney(net) + '</span></div>' +
        '<ul class="tx-list">' + items.map(txRowHTML).join('') + '</ul></div>';
    }).join('');
    container.querySelectorAll('[data-tx-id]').forEach(el => el.addEventListener('click', () => openTxModal(el.dataset.txId)));
  }
}

// ---------- Stats view ----------
function renderStats() {
  const txs = txOfMonth(currentMonth);
  const expenses = txs.filter(t => t.type === 'expense');
  const byCat = new Map();
  expenses.forEach(t => byCat.set(t.categoryId, (byCat.get(t.categoryId) || 0) + t.amount));
  const sorted = [...byCat.entries()].map(([id, sum]) => ({ cat: getCategory(id), sum })).sort((a, b) => b.sum - a.sum);
  const maxSum = sorted[0]?.sum || 1;

  $('#topCategories').innerHTML = sorted.length
    ? sorted.map(e =>
        '<li><span style="min-width:90px">' + e.cat.icon + ' ' + e.cat.name + '</span>' +
        '<span class="rank-bar"><span class="rank-bar-fill" style="width:' + (e.sum/maxSum*100).toFixed(0) + '%; background:' + e.cat.color + '"></span></span>' +
        '<span style="font-weight:600">' + fmtMoney(e.sum) + '</span></li>'
      ).join('')
    : '<li class="muted small">Aucune donnée ce mois.</li>';

  const [y, m] = currentMonth.split('-').map(Number);
  const daysInMonth = new Date(y, m, 0).getDate();
  const now = new Date();
  const daysElapsed = ymKey(now) === currentMonth ? now.getDate() : daysInMonth;
  const totalExp = expenses.reduce((s, t) => s + t.amount, 0);
  const avg = daysElapsed ? totalExp / daysElapsed : 0;
  $('#dailyAverage').textContent = fmtMoney(avg);
  $('#dailyAverageText').textContent = fmtMoney(totalExp) + ' sur ' + daysElapsed + ' jour' + (daysElapsed > 1 ? 's' : '');

  const months = [];
  for (let i = 5; i >= 0; i--) months.push(ymKey(new Date(y, m - 1 - i, 1)));
  const compareData = months.map(ym => totals(txOfMonth(ym)).expense);
  const ctx = $('#compareChart').getContext('2d');
  if (charts.compare) charts.compare.destroy();
  charts.compare = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: months.map(ym => prettyMonth(ym).replace(/ \d{4}$/, '')),
      datasets: [{
        label: 'Dépenses', data: compareData,
        backgroundColor: months.map(ym => ym === currentMonth ? '#3b82f6' : '#94a3b8'),
        borderRadius: 6,
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => fmtMoney(c.parsed.y) } } },
      scales: {
        y: { ticks: { callback: (v) => fmtMoneyShort(v), font: { size: 10 } } },
        x: { ticks: { font: { size: 10 } } },
      },
    },
  });

  const yearTxs = state.transactions.filter(t => t.date.startsWith(String(y) + '-'));
  const yt = totals(yearTxs);
  $('#yearlyTotal').textContent = fmtMoney(yt.expense);
  $('#yearlyText').textContent = 'Revenus ' + y + ' : ' + fmtMoney(yt.income) + ' · Solde : ' + fmtMoney(yt.balance);
}

// ---------- Settings ----------
function renderSettings() {
  $('#budgetInput').value = state.settings.monthlyBudget || '';
  $('#categoryList').innerHTML = state.categories.map(c =>
    '<li data-cat-id="' + c.id + '">' +
    '<div class="cat-icon" style="background:' + c.color + '22;color:' + c.color + '">' + c.icon + '</div>' +
    '<span class="cat-name">' + escapeHtml(c.name) + '</span>' +
    '<span class="cat-type">' + (c.type === 'expense' ? 'Dépense' : c.type === 'income' ? 'Revenu' : 'Les deux') + '</span>' +
    '<button class="cat-edit">Modifier</button></li>'
  ).join('');
  $('#categoryList').querySelectorAll('li').forEach(li => {
    li.querySelector('.cat-edit').addEventListener('click', () => openCatModal(li.dataset.catId));
  });

  // Sync UI
  const pInfo = SyncModule.platformInfo[SyncModule.platform];
  const badge = $('#syncPlatformBadge');
  if (badge) badge.textContent = pInfo.icon + ' ' + pInfo.cloudName;

  const platformNameEl = $('#syncPlatformName');
  if (platformNameEl) platformNameEl.textContent = pInfo.name;

  const deviceInput = $('#deviceNameInput');
  if (deviceInput && !deviceInput.dataset.filled) {
    deviceInput.value = SyncModule.getDeviceName();
    deviceInput.dataset.filled = '1';
  }

  const familyInput = $('#familyKeyInput');
  if (familyInput && !familyInput.dataset.filled) {
    familyInput.value = SyncModule.getFamilyKey();
    familyInput.dataset.filled = '1';
  }

  const saveHint = $('#syncSaveHint');
  if (saveHint) saveHint.textContent = 'vers ' + pInfo.cloudName;

  const dot = $('#syncDot');
  const statusText = $('#syncStatusText');
  const lastSync = state.settings.lastSync;
  if (dot && statusText) {
    if (!lastSync) {
      dot.className = 'sync-dot never';
      statusText.textContent = 'Jamais synchronisé — pense à sauvegarder !';
    } else {
      const diffMin = Math.floor((Date.now() - new Date(lastSync).getTime()) / 60000);
      dot.className = 'sync-dot ' + (diffMin < 1440 ? 'ok' : 'warn');
      statusText.textContent = SyncModule.formatSyncTime(lastSync);
    }
  }

  const guideSteps = $('#syncGuideSteps');
  if (guideSteps) {
    const steps = SyncModule.instructions[SyncModule.platform];
    guideSteps.innerHTML = steps.map(s => '<li>' + escapeHtml(s) + '</li>').join('');
  }

  const lastSyncEl = $('#lastSyncText');
  if (lastSyncEl) lastSyncEl.textContent = SyncModule.formatSyncTime(state.settings.lastSync);
}

// ---------- Transaction modal ----------
function openTxModal(txId) {
  const existing = txId ? state.transactions.find(t => t.id === txId) : null;
  $('#txId').value = existing?.id || '';
  $('#txAmount').value = existing?.amount ?? '';
  $('#txDate').value = existing?.date || todayISO();
  $('#txDescription').value = existing?.description || '';
  $('#txRecurring').checked = !!existing?.recurring;
  setTxType(existing?.type || 'expense');
  if (existing) {
    $('#txCategory').value = existing.categoryId;
    $('#txModalTitle').textContent = existing.type === 'expense' ? 'Modifier la dépense' : 'Modifier le revenu';
    $('#deleteTx').hidden = false;
  } else {
    $('#txModalTitle').textContent = 'Nouvelle dépense';
    $('#deleteTx').hidden = true;
  }
  $('#txModal').hidden = false;
  setTimeout(() => $('#txAmount').focus(), 100);
}

function setTxType(type) {
  $$('.type-btn').forEach(b => b.classList.toggle('active', b.dataset.type === type));
  const cats = state.categories.filter(c => c.type === type || c.type === 'both');
  $('#txCategory').innerHTML = cats.map(c => '<option value="' + c.id + '">' + c.icon + ' ' + c.name + '</option>').join('');
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
  toast(existing ? 'Modifié ✔' : 'Ajouté ✔');
  refreshAll();
}

function deleteTransaction() {
  const id = $('#txId').value;
  if (!id) return;
  const hasChildren = state.transactions.some(t => t.recurringParentId === id);
  const msg = hasChildren ? 'Supprimer aussi toutes les occurrences récurrentes ?' : 'Supprimer cette transaction ?';
  if (!confirm(msg)) return;
  state.transactions = state.transactions.filter(t => t.id !== id && t.recurringParentId !== id);
  saveState();
  closeTxModal();
  toast('Supprimé');
  refreshAll();
}

function closeTxModal() { $('#txModal').hidden = true; }

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
  const msg = used
    ? 'Cette catégorie contient des transactions. Elles seront conservées sans catégorie. Continuer ?'
    : 'Supprimer cette catégorie ?';
  if (!confirm(msg)) return;
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
  downloadBlob(blob, 'mes-depenses-' + todayISO() + '.json');
}

function exportCsv() {
  const rows = [['Date', 'Type', 'Categorie', 'Description', 'Montant (FCFA)']];
  state.transactions.slice().sort((a, b) => a.date.localeCompare(b.date)).forEach(t => {
    const c = getCategory(t.categoryId);
    rows.push([t.date, t.type === 'expense' ? 'Depense' : 'Revenu', c.name, t.description || '', t.amount]);
  });
  const csv = rows.map(r => r.map(v => { const s = String(v ?? ''); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }).join(',')).join('\n');
  downloadBlob(new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' }), 'mes-depenses-' + todayISO() + '.csv');
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
      if (!data.transactions || !data.categories) throw new Error('invalide');
      if (!confirm('Remplacer toutes tes données actuelles par celles du fichier ?')) return;
      state = {
        transactions: data.transactions,
        categories: data.categories,
        settings: { ...defaultState.settings, ...(data.settings || {}) },
      };
      saveState(); applyTheme(); toast('Importé ✔'); refreshAll();
    } catch { toast('Fichier invalide'); }
  };
  reader.readAsText(file);
}

// ---------- Cloud sync v2 ----------
async function cloudSave() {
  const result = await SyncModule.syncSave(state);
  if (result.aborted) return;
  if (result.success) {
    state.settings.lastSync = new Date().toISOString();
    saveState();
    toast(result.method === 'share' ? 'Sauvegardé ✔' : 'Fichier téléchargé ✔');
    renderSettings();
  }
}

function cloudRestore(file) {
  const reader = new FileReader();
  reader.onload = () => {
    const { ok, data, error } = SyncModule.parseSyncFile(reader.result);
    if (!ok) return toast(error || 'Fichier invalide');
    openSyncModal(data);
  };
  reader.readAsText(file);
}

function openSyncModal(remoteData) {
  const analysis = SyncModule.analyzeSync(state, remoteData);

  $('#syncModalContent').innerHTML =
    '<p class="muted small" style="margin-bottom:10px">Fichier de <strong>' + escapeHtml(analysis.deviceName) + '</strong></p>' +
    '<div class="sync-modal-info">' +
      '<div class="sync-modal-row"><span>📅 Sauvegardé le</span><span>' + analysis.savedAt + '</span></div>' +
      '<div class="sync-modal-row"><span>📱 Sur cet appareil</span><span>' + state.transactions.length + ' transaction' + (state.transactions.length > 1 ? 's' : '') + '</span></div>' +
      '<div class="sync-modal-row"><span>📂 Dans le fichier</span><span>' + analysis.total + ' transaction' + (analysis.total > 1 ? 's' : '') + '</span></div>' +
      '<div class="sync-modal-row"><span>✨ Nouvelles à ajouter</span><span style="color:var(--income)">' + analysis.onlyRemote + '</span></div>' +
      '<div class="sync-modal-row"><span>📍 Uniquement en local</span><span style="color:var(--warning)">' + analysis.onlyLocal + '</span></div>' +
    '</div>' +
    (analysis.sameFamily ? '<p class="sync-family-match">✅ Code famille : ' + escapeHtml(analysis.familyKey) + '</p>' : '') +
    '<p class="muted small" style="margin-top:10px"><strong>Fusionner</strong> (recommandé) : combine les deux sans perdre de données.<br><strong>Remplacer</strong> : écrase tes données locales.</p>';

  $('#syncModalActions').innerHTML =
    '<button class="sync-merge-btn" id="doMerge">🔀 Fusionner</button>' +
    '<button class="sync-replace-btn" id="doReplace">🔄 Remplacer tout</button>' +
    '<button class="sync-cancel-btn" id="doCancel">Annuler</button>';

  $('#doMerge').addEventListener('click', () => {
    const merged = SyncModule.mergeStates(state, remoteData);
    state.transactions = merged.transactions;
    state.categories = merged.categories;
    state.settings = merged.settings;
    saveState();
    delete $('#filterCategory').dataset.ready;
    $('#syncModal').hidden = true;
    const added = merged._mergeStats.added;
    toast(added > 0 ? '✔ Fusionné — +' + added + ' transaction' + (added > 1 ? 's' : '') : '✔ Déjà à jour');
    refreshAll(); renderSettings();
  });

  $('#doReplace').addEventListener('click', () => {
    if (!confirm('Remplacer toutes tes données locales ? Action irréversible.')) return;
    state = {
      transactions: remoteData.transactions,
      categories: remoteData.categories?.length ? remoteData.categories : defaultCategories,
      settings: { ...defaultState.settings, ...(remoteData.settings || {}), lastSync: new Date().toISOString() },
    };
    saveState(); applyTheme();
    delete $('#filterCategory').dataset.ready;
    $('#syncModal').hidden = true;
    toast('✔ Données remplacées');
    refreshAll(); renderSettings();
  });

  $('#doCancel').addEventListener('click', () => { $('#syncModal').hidden = true; });
  $('#closeSyncModal').addEventListener('click', () => { $('#syncModal').hidden = true; });
  $('#syncModal').hidden = false;
}

function clearAllData() {
  if (!confirm('Vraiment tout effacer ? Cette action est irréversible.')) return;
  if (!confirm('Dernière confirmation : toutes les transactions seront supprimées.')) return;
  localStorage.removeItem(STORAGE_KEY);
  state = structuredClone(defaultState);
  toast('Données effacées');
  refreshAll(); renderSettings();
}

// ---------- Refresh ----------
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
    state.settings.monthlyBudget = parseFloat($('#budgetInput').value) || 0;
    saveState(); toast('Budget enregistré'); refreshAll();
  });

  $$('.theme-btn').forEach(b => b.addEventListener('click', () => {
    state.settings.theme = b.dataset.theme;
    saveState(); applyTheme();
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

  // Sync v2 : nom appareil, code famille, guide
  document.addEventListener('click', (e) => {
    if (e.target.id === 'saveDeviceName') {
      const v = $('#deviceNameInput')?.value?.trim();
      if (v) { SyncModule.setDeviceName(v); toast('Nom enregistré ✔'); }
    }
    if (e.target.id === 'saveFamilyKey') {
      const v = ($('#familyKeyInput')?.value || '').trim().toUpperCase();
      SyncModule.setFamilyKey(v);
      toast(v ? 'Code famille enregistré ✔' : 'Code famille supprimé');
    }
    if (e.target.id === 'genFamilyKey') {
      const key = SyncModule.generateFamilyKey();
      const input = $('#familyKeyInput');
      if (input) { input.value = key; input.dataset.filled = '1'; }
    }
    if (e.target.id === 'syncGuideToggle') {
      const guide = $('#syncGuide');
      if (guide) guide.hidden = !guide.hidden;
    }
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

/* =========================================================
   Mes Dépenses v4 — Dépenses uniquement + budget intelligent
   ========================================================= */
'use strict';

const STORAGE_KEY = 'mes_depenses_v1';

const defaultCategories = [
  { id: 'cat-food',      name: 'Alimentation', icon: '🍽️', color: '#f97316' },
  { id: 'cat-transport', name: 'Transport',    icon: '🚗', color: '#3b82f6' },
  { id: 'cat-rent',      name: 'Loyer',        icon: '🏠', color: '#8b5cf6' },
  { id: 'cat-bills',     name: 'Factures',     icon: '💡', color: '#eab308' },
  { id: 'cat-health',    name: 'Santé',        icon: '💊', color: '#ef4444' },
  { id: 'cat-leisure',   name: 'Loisirs',      icon: '🎮', color: '#ec4899' },
  { id: 'cat-edu',       name: 'Éducation',    icon: '📚', color: '#06b6d4' },
  { id: 'cat-clothes',   name: 'Vêtements',    icon: '👕', color: '#14b8a6' },
  { id: 'cat-family',    name: 'Famille',      icon: '👨‍👩‍👧', color: '#a855f7' },
  { id: 'cat-other',     name: 'Autre',        icon: '📦', color: '#64748b' },
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
    // Migration : on ne garde que les dépenses (expense)
    const txs = (parsed.transactions || []).filter(t => !t.type || t.type === 'expense');
    // Nettoyage catégories : on retire type income
    const cats = (parsed.categories || defaultCategories).filter(c => !c.type || c.type !== 'income').map(c => {
      const {type, ...rest} = c; return rest;
    });
    return {
      transactions: txs,
      categories: cats.length ? cats : defaultCategories,
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
const $ = s => document.querySelector(s);
const $$ = s => document.querySelectorAll(s);
const uid = () => 't-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const todayISO = () => new Date().toISOString().slice(0, 10);
const ymKey = d => { const dt = d instanceof Date ? d : new Date(d); return dt.getFullYear() + '-' + String(dt.getMonth()+1).padStart(2,'0'); };
const prettyMonth = ym => { const [y,m]=ym.split('-').map(Number); return new Date(y,m-1,1).toLocaleDateString('fr-FR',{month:'long',year:'numeric'}); };
const prettyDate = iso => new Date(iso).toLocaleDateString('fr-FR',{weekday:'short',day:'numeric',month:'short'});
const capitalize = s => s.charAt(0).toUpperCase()+s.slice(1);
const nf = new Intl.NumberFormat('fr-FR');
const fmtMoney = n => nf.format(Math.round(n||0))+' FCFA';
const fmtShort = n => { const v=Math.round(n||0); if(v>=1e6) return (v/1e6).toFixed(1).replace('.0','')+'M'; if(v>=1e3) return Math.round(v/1e3)+'k'; return String(v); };
const escHtml = s => String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

function toast(msg) {
  const el = $('#toast');
  el.textContent = msg; el.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.hidden = true, 2500);
}

let currentMonth = ymKey(new Date());
let charts = { cat: null, trend: null, compare: null };
let selectedCatId = '';

// ---------- Recurring ----------
function applyRecurring() {
  const nowYM = ymKey(new Date());
  if (state.settings.lastRecurringRun === nowYM) return;
  const existing = new Map();
  state.transactions.forEach(t => { if (t.recurringParentId) existing.set(ymKey(t.date)+'|'+t.recurringParentId, true); });
  const parents = state.transactions.filter(t => t.recurring);
  const today = new Date();
  parents.forEach(p => {
    const start = new Date(p.date);
    const cursor = new Date(start.getFullYear(), start.getMonth()+1, 1);
    while (cursor <= today) {
      const day = Math.min(start.getDate(), new Date(cursor.getFullYear(),cursor.getMonth()+1,0).getDate());
      const iso = new Date(cursor.getFullYear(),cursor.getMonth(),day).toISOString().slice(0,10);
      const key = ymKey(iso)+'|'+p.id;
      if (!existing.has(key)) {
        state.transactions.push({ id:uid(), type:'expense', amount:p.amount, date:iso, categoryId:p.categoryId, description:p.description, recurring:false, recurringParentId:p.id });
        existing.set(key, true);
      }
      cursor.setMonth(cursor.getMonth()+1);
    }
  });
  state.settings.lastRecurringRun = nowYM;
  saveState();
}

// ---------- Theme ----------
function applyTheme() {
  const t = state.settings.theme || 'auto';
  if (t==='auto') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', t);
  $$('.theme-btn').forEach(b => b.classList.toggle('active', b.dataset.theme===t));
}

// ---------- Navigation ----------
function navigate(view) {
  $$('.view').forEach(v => v.classList.remove('active'));
  $('#view-'+view).classList.add('active');
  $$('.nav-btn[data-nav]').forEach(b => b.classList.toggle('active', b.dataset.nav===view));
  window.scrollTo({top:0,behavior:'instant'});
  if (view==='dashboard') renderDashboard();
  if (view==='transactions') renderTransactions();
  if (view==='stats') renderStats();
  if (view==='settings') renderSettings();
}

function changeMonth(delta) {
  const [y,m] = currentMonth.split('-').map(Number);
  currentMonth = ymKey(new Date(y, m-1+delta, 1));
  updateHeader();
  const active = document.querySelector('.view.active')?.id;
  if (active==='view-dashboard') renderDashboard();
  if (active==='view-transactions') renderTransactions();
  if (active==='view-stats') renderStats();
}

function updateHeader() {
  $('#currentMonthLabel').textContent = capitalize(prettyMonth(currentMonth));
  const now = ymKey(new Date());
  $('#headerSubtitle').textContent = currentMonth===now ? 'Mois en cours' : (currentMonth>now ? 'À venir' : 'Historique');
}

// ---------- Data ----------
function txOfMonth(ym) { return state.transactions.filter(t => ymKey(t.date)===ym); }
function getCategory(id) { return state.categories.find(c=>c.id===id) || {name:'Autre',icon:'📦',color:'#64748b'}; }
function totalExpense(txs) { return txs.reduce((s,t)=>s+t.amount,0); }

// ---------- Greetings ----------
const GREETINGS = {
  morning:   { emoji:'☀️', label:'BON MATIN',   titles:['Une belle journée commence','Prêt à tout noter ?','Bonjour champion !','Nouveau jour, nouveau départ'] },
  noon:      { emoji:'🌤️', label:'MIDI',         titles:['Bon appétit !','Pause bien méritée','Midi à Abidjan 🌴','Tu tiens le rythme !'] },
  afternoon: { emoji:'🌞', label:'APRÈS-MIDI',   titles:['La journée avance','Reste concentré !','Continue comme ça','Tu gères bien !'] },
  evening:   { emoji:'🌅', label:'BONSOIR',      titles:['Belle soirée à toi','Le soleil se couche','Revue de fin de journée','Détends-toi 🌴'] },
  night:     { emoji:'🌙', label:'BONNE NUIT',   titles:['Un dernier coup d\'œil ?','La nuit porte conseil','Dors bien 😴','Demain sera meilleur'] },
};
const ANECDOTES = {
  empty:    ['Commence par ajouter ta première dépense 👇','Le plus dur, c\'est de commencer 💪','Prêt à prendre le contrôle de ton argent ?','Ton voyage financier commence ici 🌱'],
  great:    ['Tu gères comme un chef ! 👑','Bravo, ton budget est bien maîtrisé 🌿','"Petit à petit, l\'oiseau fait son nid" 🐦','Tes finances sourient ce mois-ci 🎉','Quelle discipline, bravo !'],
  good:     ['Belle maîtrise du budget 👍','Tu avances bien, garde le cap','Le mois se passe bien 😊','Continue sur ta lancée !'],
  warning:  ['Attention, le budget fond vite 🌡️','Un peu de vigilance s\'impose','Tu approches la limite, ralentis un peu','Il est temps de faire attention 👀'],
  over:     ['Budget dépassé 😅 — le mois prochain sera meilleur !','L\'argent file vite, note bien tout','Pas grave, on repart de zéro 💪','"Qui va doucement va sûrement" 🐢'],
  nobudget: ['Définis ton budget dans les Réglages 🎯','Sans budget, difficile de suivre !','Lance-toi, définis ton budget !','Un budget = la liberté financière 🔑'],
};
function pickRandom(arr) { return arr[Math.floor(Math.random()*arr.length)]; }
function getTimeOfDay() {
  const h = new Date().getHours();
  if (h<6) return 'night'; if (h<12) return 'morning';
  if (h<14) return 'noon'; if (h<18) return 'afternoon';
  if (h<22) return 'evening'; return 'night';
}

function renderGreeting() {
  const tod = getTimeOfDay();
  const g = GREETINGS[tod];
  $('#greetingTime').textContent = g.emoji + ' ' + g.label;
  $('#greetingTitle').textContent = pickRandom(g.titles);

  const txs = txOfMonth(currentMonth);
  const exp = totalExpense(txs);
  const budget = state.settings.monthlyBudget || 0;
  let pool;
  if (!txs.length) pool = ANECDOTES.empty;
  else if (!budget) pool = ANECDOTES.nobudget;
  else if (exp > budget) pool = ANECDOTES.over;
  else if (exp > budget * 0.8) pool = ANECDOTES.warning;
  else if (exp < budget * 0.5) pool = ANECDOTES.great;
  else pool = ANECDOTES.good;
  $('#greetingAnecdote').textContent = pickRandom(pool);
}

// ---------- Dashboard ----------
function renderDashboard() {
  renderGreeting();
  const txs = txOfMonth(currentMonth);
  const exp = totalExpense(txs);
  const budget = state.settings.monthlyBudget || 0;
  const remaining = budget ? Math.max(0, budget-exp) : 0;
  const pct = budget ? Math.min(100, (exp/budget)*100) : 0;

  // Hero
  $('#heroExpense').textContent = fmtMoney(exp);
  $('#heroProgressFill').style.width = pct + '%';
  $('#heroProgressPct').textContent = budget ? Math.round(pct)+'%' : '—';

  // Stat cards
  $('#sumExpense').textContent = fmtShort(exp);
  $('#sumBudget').textContent = budget ? fmtShort(remaining) : '—';

  // Moyenne journalière
  const [y,m] = currentMonth.split('-').map(Number);
  const now = new Date();
  const daysElapsed = ymKey(now)===currentMonth ? now.getDate() : new Date(y,m,0).getDate();
  const avg = daysElapsed ? exp/daysElapsed : 0;
  $('#sumDailyAvg').textContent = fmtShort(avg);

  renderCatChart(txs);
  renderTrendChart();
  renderRecent(txs);
}

function renderCatChart(txs) {
  const byCat = new Map();
  txs.forEach(t => byCat.set(t.categoryId, (byCat.get(t.categoryId)||0)+t.amount));
  const entries = [...byCat.entries()].map(([id,sum])=>({cat:getCategory(id),sum})).sort((a,b)=>b.sum-a.sum);
  const ctx = $('#categoryChart').getContext('2d');
  if (charts.cat) charts.cat.destroy();
  if (!entries.length) {
    charts.cat = null;
    $('#categoryLegend').innerHTML = '<p class="muted small" style="padding:16px 0">Aucune dépense ce mois.</p>';
    ctx.clearRect(0,0,ctx.canvas.width,ctx.canvas.height);
    return;
  }
  charts.cat = new Chart(ctx, {
    type:'doughnut',
    data:{ labels:entries.map(e=>e.cat.name), datasets:[{data:entries.map(e=>e.sum), backgroundColor:entries.map(e=>e.cat.color), borderWidth:0, hoverOffset:8}] },
    options:{responsive:true,maintainAspectRatio:false,cutout:'66%',plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>c.label+': '+fmtMoney(c.parsed)}}}},
  });
  $('#categoryLegend').innerHTML = entries.map(e =>
    '<span class="legend-item"><span class="legend-swatch" style="background:'+e.cat.color+'"></span>'+e.cat.icon+' '+e.cat.name+' · '+fmtMoney(e.sum)+'</span>'
  ).join('');
}

function renderTrendChart() {
  const [y,m] = currentMonth.split('-').map(Number);
  const months = [];
  for (let i=5;i>=0;i--) months.push(ymKey(new Date(y,m-1-i,1)));
  const ctx = $('#trendChart').getContext('2d');
  if (charts.trend) charts.trend.destroy();
  charts.trend = new Chart(ctx, {
    type:'line',
    data:{
      labels:months.map(ym=>prettyMonth(ym).replace(/ \d{4}$/,'')),
      datasets:[{label:'Dépenses',data:months.map(ym=>totalExpense(txOfMonth(ym))),borderColor:'#c4532b',backgroundColor:'rgba(196,83,43,.15)',tension:.35,fill:true,pointBackgroundColor:'#c4532b',pointRadius:4}],
    },
    options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>fmtMoney(c.parsed.y)}}},scales:{y:{ticks:{callback:v=>fmtShort(v),font:{size:10}}},x:{ticks:{font:{size:10}}}}},
  });
}

function renderRecent(txs) {
  const sorted = [...txs].sort((a,b)=>b.date.localeCompare(a.date)).slice(0,6);
  $('#recentTx').innerHTML = sorted.length
    ? sorted.map(txRowHTML).join('')
    : '<li class="muted small" style="padding:16px 0;text-align:center">😶 Aucune dépense</li>';
  $('#recentTx').querySelectorAll('[data-tx-id]').forEach(el => el.addEventListener('click',()=>openTxModal(el.dataset.txId)));
}

function txRowHTML(t) {
  const c = getCategory(t.categoryId);
  return '<li class="tx-item" data-tx-id="'+t.id+'">'+
    '<div class="tx-icon" style="background:'+c.color+'22;color:'+c.color+'">'+c.icon+'</div>'+
    '<div class="tx-body">'+
      '<div class="tx-title">'+escHtml(t.description||c.name)+(t.recurringParentId||t.recurring?' 🔁':'')+'</div>'+
      '<div class="tx-sub">'+c.name+' · '+prettyDate(t.date)+'</div>'+
    '</div>'+
    '<div class="tx-amount">− '+fmtMoney(t.amount)+'</div>'+
    '</li>';
}

// ---------- Transactions ----------
function renderTransactions() {
  const search = $('#searchInput').value.trim().toLowerCase();
  const filterCat = $('#filterCategory').value;

  if (!$('#filterCategory').dataset.ready) {
    $('#filterCategory').innerHTML = '<option value="">Toutes catégories</option>'+
      state.categories.map(c=>'<option value="'+c.id+'">'+c.icon+' '+c.name+'</option>').join('');
    $('#filterCategory').dataset.ready = '1';
  }

  let txs = txOfMonth(currentMonth);
  if (filterCat) txs = txs.filter(t=>t.categoryId===filterCat);
  if (search) txs = txs.filter(t=>{
    const c=getCategory(t.categoryId);
    return (t.description||'').toLowerCase().includes(search)||c.name.toLowerCase().includes(search);
  });

  const groups = new Map();
  txs.sort((a,b)=>b.date.localeCompare(a.date)).forEach(t=>{ if(!groups.has(t.date))groups.set(t.date,[]); groups.get(t.date).push(t); });

  const container = $('#txGroups');
  if (!groups.size) {
    container.innerHTML=''; $('#txEmpty').hidden=false; return;
  }
  $('#txEmpty').hidden=true;
  container.innerHTML = [...groups.entries()].map(([date,items])=>{
    const total = totalExpense(items);
    return '<div class="tx-group">'+
      '<div class="tx-group-header"><span>'+capitalize(prettyDate(date))+'</span><span>− '+fmtMoney(total)+'</span></div>'+
      '<ul class="tx-list">'+items.map(txRowHTML).join('')+'</ul></div>';
  }).join('');
  container.querySelectorAll('[data-tx-id]').forEach(el=>el.addEventListener('click',()=>openTxModal(el.dataset.txId)));
}

// ---------- Stats ----------
function renderStats() {
  const txs = txOfMonth(currentMonth);
  const byCat = new Map();
  txs.forEach(t=>byCat.set(t.categoryId,(byCat.get(t.categoryId)||0)+t.amount));
  const sorted = [...byCat.entries()].map(([id,sum])=>({cat:getCategory(id),sum})).sort((a,b)=>b.sum-a.sum);
  const maxSum = sorted[0]?.sum||1;

  $('#topCategories').innerHTML = sorted.length
    ? sorted.map(e=>'<li>'+
        '<span>'+e.cat.icon+' '+e.cat.name+'</span>'+
        '<span class="rank-bar"><span class="rank-bar-fill" style="width:'+(e.sum/maxSum*100).toFixed(0)+'%;background:'+e.cat.color+'"></span></span>'+
        '<span>'+fmtMoney(e.sum)+'</span></li>').join('')
    : '<li class="muted small">Aucune donnée.</li>';

  const [y,m] = currentMonth.split('-').map(Number);
  const daysInMonth = new Date(y,m,0).getDate();
  const now = new Date();
  const daysElapsed = ymKey(now)===currentMonth ? now.getDate() : daysInMonth;
  const totalExp = totalExpense(txs);
  const avg = daysElapsed ? totalExp/daysElapsed : 0;
  $('#dailyAverage').textContent = fmtMoney(avg);
  $('#dailyAverageText').textContent = fmtMoney(totalExp)+' sur '+daysElapsed+' jour'+(daysElapsed>1?'s':'');

  const months = [];
  for (let i=5;i>=0;i--) months.push(ymKey(new Date(y,m-1-i,1)));
  const ctx = $('#compareChart').getContext('2d');
  if (charts.compare) charts.compare.destroy();
  charts.compare = new Chart(ctx, {
    type:'bar',
    data:{
      labels:months.map(ym=>prettyMonth(ym).replace(/ \d{4}$/,'')),
      datasets:[{label:'Dépenses',data:months.map(ym=>totalExpense(txOfMonth(ym))),backgroundColor:months.map(ym=>ym===currentMonth?'#c4532b':'#e8d5c0'),borderRadius:8}],
    },
    options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>fmtMoney(c.parsed.y)}}},scales:{y:{ticks:{callback:v=>fmtShort(v),font:{size:10}}},x:{ticks:{font:{size:10}}}}},
  });

  const yearTxs = state.transactions.filter(t=>t.date.startsWith(String(y)+'-'));
  $('#yearlyTotal').textContent = fmtMoney(totalExpense(yearTxs));
  $('#yearlyText').textContent = String(y)+' · '+yearTxs.length+' transaction'+(yearTxs.length>1?'s':'');
}

// ---------- Settings ----------
function renderSettings() {
  const budget = state.settings.monthlyBudget||0;
  $('#budgetInput').value = budget||'';
  $('#budgetCurrent').textContent = budget ? '💰 Budget actuel : '+fmtMoney(budget) : '';

  $('#categoryList').innerHTML = state.categories.map(c=>
    '<li data-cat-id="'+c.id+'">'+
    '<div class="cat-icon" style="background:'+c.color+'22;color:'+c.color+'">'+c.icon+'</div>'+
    '<span class="cat-name">'+escHtml(c.name)+'</span>'+
    '<button class="cat-edit">Modifier</button></li>'
  ).join('');
  $('#categoryList').querySelectorAll('li').forEach(li=>li.querySelector('.cat-edit').addEventListener('click',()=>openCatModal(li.dataset.catId)));

  // Sync UI
  const pInfo = SyncModule.platformInfo[SyncModule.platform];
  const badge = $('#syncPlatformBadge');
  if (badge) badge.textContent = pInfo.icon+' '+pInfo.cloudName;
  const platformNameEl = $('#syncPlatformName');
  if (platformNameEl) platformNameEl.textContent = pInfo.name;
  const deviceInput = $('#deviceNameInput');
  if (deviceInput && !deviceInput.dataset.filled) { deviceInput.value=SyncModule.getDeviceName(); deviceInput.dataset.filled='1'; }
  const familyInput = $('#familyKeyInput');
  if (familyInput && !familyInput.dataset.filled) { familyInput.value=SyncModule.getFamilyKey(); familyInput.dataset.filled='1'; }
  const saveHint = $('#syncSaveHint');
  if (saveHint) saveHint.textContent = 'vers '+pInfo.cloudName;
  const dot = $('#syncDot'), statusText = $('#syncStatusText');
  const lastSync = state.settings.lastSync;
  if (dot && statusText) {
    if (!lastSync) { dot.className='sync-dot never'; statusText.textContent='Jamais synchronisé'; }
    else {
      const diffMin = Math.floor((Date.now()-new Date(lastSync).getTime())/60000);
      dot.className='sync-dot '+(diffMin<1440?'ok':'warn');
      statusText.textContent = SyncModule.formatSyncTime(lastSync);
    }
  }
  const guideSteps = $('#syncGuideSteps');
  if (guideSteps) { const steps=SyncModule.instructions[SyncModule.platform]; guideSteps.innerHTML=steps.map(s=>'<li>'+escHtml(s)+'</li>').join(''); }
  const lastSyncEl = $('#lastSyncText');
  if (lastSyncEl) lastSyncEl.textContent = SyncModule.formatSyncTime(state.settings.lastSync);
}

// ---------- Transaction modal ----------
function openTxModal(txId) {
  const existing = txId ? state.transactions.find(t=>t.id===txId) : null;
  $('#txId').value = existing?.id||'';
  $('#txAmount').value = existing?.amount??'';
  $('#txDate').value = existing?.date||todayISO();
  $('#txDescription').value = existing?.description||'';
  $('#txRecurring').checked = !!existing?.recurring;
  $('#txModalTitle').textContent = existing ? '✏️ Modifier la dépense' : '💸 Nouvelle dépense';
  $('#deleteTx').hidden = !existing;

  selectedCatId = existing?.categoryId || state.categories[0]?.id || '';
  renderCatQuickPick();

  $('#txModal').hidden = false;
  setTimeout(()=>$('#txAmount').focus(), 100);
}

function renderCatQuickPick() {
  const grid = $('#catQuickPick');
  if (!grid) return;
  grid.innerHTML = state.categories.map(c =>
    '<div class="cat-quick-item'+(selectedCatId===c.id?' selected':'')+'" data-cat-id="'+c.id+'" style="color:'+c.color+'">'+
    '<span class="cat-q-icon">'+c.icon+'</span>'+escHtml(c.name)+'</div>'
  ).join('');
  grid.querySelectorAll('.cat-quick-item').forEach(el => {
    el.addEventListener('click', () => {
      selectedCatId = el.dataset.catId;
      $('#txCategory').value = selectedCatId;
      grid.querySelectorAll('.cat-quick-item').forEach(i=>i.classList.toggle('selected', i.dataset.catId===selectedCatId));
    });
  });
  $('#txCategory').value = selectedCatId;
}

function saveTransaction(e) {
  e.preventDefault();
  const id = $('#txId').value || uid();
  const amount = parseFloat($('#txAmount').value);
  const date = $('#txDate').value;
  const categoryId = selectedCatId || state.categories[0]?.id;
  const description = $('#txDescription').value.trim();
  const recurring = $('#txRecurring').checked;

  if (!amount||amount<=0) return toast('⚠️ Montant invalide');
  if (!date) return toast('⚠️ Date invalide');
  if (!categoryId) return toast('⚠️ Choisis une catégorie');

  const existing = state.transactions.find(t=>t.id===id);
  const tx = {id, type:'expense', amount, date, categoryId, description, recurring, recurringParentId:existing?.recurringParentId};
  if (existing) Object.assign(existing, tx);
  else state.transactions.push(tx);

  saveState();
  closeTxModal();
  toast(existing ? '✅ Modifié !' : '✅ Ajouté !');
  refreshAll();
}

function deleteTransaction() {
  const id = $('#txId').value;
  if (!id) return;
  const hasChildren = state.transactions.some(t=>t.recurringParentId===id);
  if (!confirm(hasChildren ? 'Supprimer aussi toutes les occurrences récurrentes ?' : 'Supprimer cette dépense ?')) return;
  state.transactions = state.transactions.filter(t=>t.id!==id&&t.recurringParentId!==id);
  saveState(); closeTxModal(); toast('🗑️ Supprimé'); refreshAll();
}

function closeTxModal() { $('#txModal').hidden=true; }

// ---------- Category modal ----------
function openCatModal(catId) {
  const existing = catId ? state.categories.find(c=>c.id===catId) : null;
  $('#catId').value = existing?.id||'';
  $('#catName').value = existing?.name||'';
  $('#catIcon').value = existing?.icon||'📦';
  $('#catColor').value = existing?.color||'#c4532b';
  $('#catModalTitle').textContent = existing ? '✏️ Modifier' : '🏷️ Nouvelle catégorie';
  $('#deleteCat').hidden = !existing;
  $('#catModal').hidden = false;
}

function saveCategory(e) {
  e.preventDefault();
  const id = $('#catId').value || 'cat-'+uid();
  const name = $('#catName').value.trim();
  const icon = $('#catIcon').value.trim()||'📦';
  const color = $('#catColor').value;
  if (!name) return toast('⚠️ Nom requis');
  const existing = state.categories.find(c=>c.id===id);
  if (existing) Object.assign(existing, {name,icon,color});
  else state.categories.push({id,name,icon,color});
  saveState(); $('#catModal').hidden=true;
  delete $('#filterCategory').dataset.ready;
  toast(existing?'✅ Catégorie modifiée':'✅ Catégorie ajoutée');
  refreshAll(); renderSettings();
}

function deleteCategory() {
  const id = $('#catId').value;
  if (!id) return;
  const used = state.transactions.some(t=>t.categoryId===id);
  if (!confirm(used?'Cette catégorie a des dépenses. Continuer ?':'Supprimer cette catégorie ?')) return;
  state.categories = state.categories.filter(c=>c.id!==id);
  saveState(); $('#catModal').hidden=true;
  delete $('#filterCategory').dataset.ready;
  toast('🗑️ Supprimée'); refreshAll(); renderSettings();
}

// ---------- Export/Import ----------
function exportJson() {
  const blob = new Blob([JSON.stringify(state,null,2)],{type:'application/json'});
  dlBlob(blob,'mes-depenses-'+todayISO()+'.json');
}
function exportCsv() {
  const rows=[['Date','Catégorie','Description','Montant (FCFA)']];
  state.transactions.slice().sort((a,b)=>a.date.localeCompare(b.date)).forEach(t=>{
    const c=getCategory(t.categoryId);
    rows.push([t.date,c.name,t.description||'',t.amount]);
  });
  const csv=rows.map(r=>r.map(v=>{const s=String(v??'');return /[",\n]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s;}).join(',')).join('\n');
  dlBlob(new Blob(['\ufeff'+csv],{type:'text/csv;charset=utf-8'}),'mes-depenses-'+todayISO()+'.csv');
}
function dlBlob(blob,name) {
  const url=URL.createObjectURL(blob),a=document.createElement('a');
  a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),0);
}
function importJson(file) {
  const r=new FileReader();
  r.onload=()=>{
    try {
      const data=JSON.parse(r.result);
      if(!data.transactions) throw new Error();
      if(!confirm('Remplacer toutes tes données ?')) return;
      state={transactions:data.transactions.filter(t=>!t.type||t.type==='expense'),categories:data.categories||defaultCategories,settings:{...defaultState.settings,...(data.settings||{})}};
      saveState();applyTheme();toast('✅ Importé !');refreshAll();
    } catch { toast('⚠️ Fichier invalide'); }
  };
  r.readAsText(file);
}

// ---------- Cloud sync ----------
async function cloudSave() {
  const result = await SyncModule.syncSave(state);
  if (result.aborted) return;
  if (result.success) {
    state.settings.lastSync=new Date().toISOString();
    saveState();toast(result.method==='share'?'✅ Sauvegardé !':'✅ Fichier téléchargé !');renderSettings();
  }
}
function cloudRestore(file) {
  const r=new FileReader();
  r.onload=()=>{
    const {ok,data,error}=SyncModule.parseSyncFile(r.result);
    if(!ok) return toast('⚠️ '+error);
    openSyncModal(data);
  };
  r.readAsText(file);
}
function openSyncModal(remoteData) {
  const analysis=SyncModule.analyzeSync(state,remoteData);
  $('#syncModalContent').innerHTML=
    '<p class="muted small" style="margin-bottom:10px">Fichier de <strong>'+escHtml(analysis.deviceName)+'</strong></p>'+
    '<div class="sync-modal-info">'+
      '<div class="sync-modal-row"><span>📅 Sauvegardé le</span><span>'+analysis.savedAt+'</span></div>'+
      '<div class="sync-modal-row"><span>📱 Sur cet appareil</span><span>'+state.transactions.length+' dépense'+(state.transactions.length>1?'s':'')+'</span></div>'+
      '<div class="sync-modal-row"><span>📂 Dans le fichier</span><span>'+analysis.total+' dépense'+(analysis.total>1?'s':'')+'</span></div>'+
      '<div class="sync-modal-row"><span>✨ Nouvelles à ajouter</span><span style="color:var(--income)">+'+analysis.onlyRemote+'</span></div>'+
    '</div>'+
    (analysis.sameFamily?'<p class="sync-family-match">✅ Code famille : '+escHtml(analysis.familyKey)+'</p>':'')+
    '<p class="muted small" style="margin-top:10px"><strong>Fusionner</strong> : combine les deux sans rien perdre.<br><strong>Remplacer</strong> : écrase tes données locales.</p>';
  $('#syncModalActions').innerHTML=
    '<button class="sync-merge-btn" id="doMerge">🔀 Fusionner (recommandé)</button>'+
    '<button class="sync-replace-btn" id="doReplace">🔄 Remplacer tout</button>'+
    '<button class="sync-cancel-btn" id="doCancel">Annuler</button>';
  $('#doMerge').addEventListener('click',()=>{
    const merged=SyncModule.mergeStates(state,remoteData);
    state.transactions=merged.transactions.filter(t=>!t.type||t.type==='expense');
    state.categories=merged.categories;state.settings=merged.settings;
    saveState();delete $('#filterCategory').dataset.ready;
    $('#syncModal').hidden=true;
    const added=merged._mergeStats.added;
    toast(added>0?'✅ Fusionné +'+added+' dépense'+(added>1?'s':''):'✅ Déjà à jour');
    refreshAll();renderSettings();
  });
  $('#doReplace').addEventListener('click',()=>{
    if(!confirm('Remplacer toutes tes données ? Irréversible.')) return;
    state={transactions:(remoteData.transactions||[]).filter(t=>!t.type||t.type==='expense'),categories:remoteData.categories||defaultCategories,settings:{...defaultState.settings,...(remoteData.settings||{}),lastSync:new Date().toISOString()}};
    saveState();applyTheme();delete $('#filterCategory').dataset.ready;
    $('#syncModal').hidden=true;toast('✅ Données remplacées');refreshAll();renderSettings();
  });
  $('#doCancel').addEventListener('click',()=>$('#syncModal').hidden=true);
  $('#closeSyncModal').addEventListener('click',()=>$('#syncModal').hidden=true);
  $('#syncModal').hidden=false;
}

function clearAllData() {
  if(!confirm('Vraiment tout effacer ? Irréversible.')) return;
  if(!confirm('Dernière confirmation ?')) return;
  localStorage.removeItem(STORAGE_KEY);
  state=structuredClone(defaultState);
  toast('🗑️ Données effacées');refreshAll();renderSettings();
}

function refreshAll() {
  const active=document.querySelector('.view.active')?.id;
  if(active==='view-dashboard') renderDashboard();
  if(active==='view-transactions') renderTransactions();
  if(active==='view-stats') renderStats();
  if(active==='view-settings') renderSettings();
}

// ---------- Events ----------
function bindEvents() {
  $('#prevMonth').addEventListener('click',()=>changeMonth(-1));
  $('#nextMonth').addEventListener('click',()=>changeMonth(1));
  $$('.nav-btn[data-nav]').forEach(b=>b.addEventListener('click',()=>navigate(b.dataset.nav)));
  $$('[data-nav]').forEach(b=>b.addEventListener('click',()=>navigate(b.dataset.nav)));

  $('#openAdd').addEventListener('click',()=>openTxModal(null));
  $('#closeTxModal').addEventListener('click',closeTxModal);
  $('#txModal').addEventListener('click',e=>{if(e.target.id==='txModal')closeTxModal();});
  $('#txForm').addEventListener('submit',saveTransaction);
  $('#deleteTx').addEventListener('click',deleteTransaction);

  $('#addCategoryBtn').addEventListener('click',()=>openCatModal(null));
  $('#closeCatModal').addEventListener('click',()=>$('#catModal').hidden=true);
  $('#catModal').addEventListener('click',e=>{if(e.target.id==='catModal')$('#catModal').hidden=true;});
  $('#catForm').addEventListener('submit',saveCategory);
  $('#deleteCat').addEventListener('click',deleteCategory);

  $('#searchInput').addEventListener('input',renderTransactions);
  $('#filterCategory').addEventListener('change',renderTransactions);

  $('#saveBudget').addEventListener('click',()=>{
    const v=parseFloat($('#budgetInput').value)||0;
    state.settings.monthlyBudget=v;
    saveState();toast(v?'✅ Budget de '+fmtMoney(v)+' enregistré !':'Budget supprimé');refreshAll();renderSettings();
  });

  $$('.theme-btn').forEach(b=>b.addEventListener('click',()=>{
    state.settings.theme=b.dataset.theme;saveState();applyTheme();
  }));

  $('#exportJson').addEventListener('click',exportJson);
  $('#exportCsv').addEventListener('click',exportCsv);
  $('#importJson').addEventListener('change',e=>e.target.files[0]&&importJson(e.target.files[0]));
  $('#clearData').addEventListener('click',clearAllData);
  $('#cloudSave').addEventListener('click',cloudSave);
  $('#cloudRestore').addEventListener('change',e=>{if(e.target.files[0])cloudRestore(e.target.files[0]);e.target.value='';});

  document.addEventListener('click',e=>{
    if(e.target.id==='saveDeviceName'){const v=$('#deviceNameInput')?.value?.trim();if(v){SyncModule.setDeviceName(v);toast('✅ Nom enregistré');}}
    if(e.target.id==='saveFamilyKey'){const v=($('#familyKeyInput')?.value||'').trim().toUpperCase();SyncModule.setFamilyKey(v);toast(v?'✅ Code famille enregistré':'Code famille supprimé');}
    if(e.target.id==='genFamilyKey'){const k=SyncModule.generateFamilyKey();const i=$('#familyKeyInput');if(i){i.value=k;i.dataset.filled='1';}}
    if(e.target.id==='syncGuideToggle'){const g=$('#syncGuide');if(g)g.hidden=!g.hidden;}
  });
}

function registerSW() {
  if('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(()=>{});
}

function init() {
  applyRecurring();applyTheme();updateHeader();bindEvents();renderDashboard();registerSW();
}

document.addEventListener('DOMContentLoaded',init);

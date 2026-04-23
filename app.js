/* =========================================================
   Mes Dépenses v5 — Sync temps réel Firebase
   ========================================================= */
'use strict';

// ---- Config locale ----
const LOCAL_KEY   = 'mes_depenses_family';
const THEME_KEY   = 'mes_depenses_theme';

const defaultCategories = [
  { id:'cat-food',      name:'Alimentation', icon:'🍽️', color:'#f97316', locked:true },
  { id:'cat-transport', name:'Transport',    icon:'🚗', color:'#3b82f6', locked:true },
  { id:'cat-rent',      name:'Loyer',        icon:'🏠', color:'#8b5cf6', locked:true },
  { id:'cat-bills',     name:'Factures',     icon:'💡', color:'#eab308', locked:true },
  { id:'cat-health',    name:'Santé',        icon:'💊', color:'#ef4444', locked:true },
  { id:'cat-leisure',   name:'Loisirs',      icon:'🎮', color:'#ec4899', locked:true },
  { id:'cat-edu',       name:'Éducation',    icon:'📚', color:'#06b6d4', locked:true },
  { id:'cat-clothes',   name:'Vêtements',    icon:'👕', color:'#14b8a6', locked:true },
  { id:'cat-family',    name:'Famille',      icon:'👨‍👩‍👧', color:'#a855f7', locked:true },
  { id:'cat-other',     name:'Autre',        icon:'📦', color:'#64748b', locked:true },
];

// ---- État local (miroir Firestore) ----
let state = {
  transactions: [],
  categories:   [...defaultCategories],
  settings:     { monthlyBudget: 0, theme: 'auto' },
};

let familyCode    = '';
let unsubscribers = [];
let currentMonth  = ymKey(new Date());
let charts        = { cat: null, trend: null, compare: null };
let selectedCatId = '';
let isOnline      = false;

// ---- Firebase refs ----
function getDB()       { return window.__firebase.db; }
function txCol()       { return window.__firebase.collection(getDB(), 'families', familyCode, 'transactions'); }
function catCol()      { return window.__firebase.collection(getDB(), 'families', familyCode, 'categories'); }
function settingsDoc() { return window.__firebase.doc(getDB(), 'families', familyCode, 'meta', 'settings'); }

// ---- Utils ----
const $  = s => document.querySelector(s);
const $$ = s => document.querySelectorAll(s);
const uid = () => 't-' + Date.now().toString(36) + Math.random().toString(36).slice(2,7);
const todayISO  = () => new Date().toISOString().slice(0,10);
const capitalize = s => s.charAt(0).toUpperCase() + s.slice(1);
const nf = new Intl.NumberFormat('fr-FR');
const fmtMoney  = n => nf.format(Math.round(n||0)) + ' FCFA';
const fmtShort  = n => { const v=Math.round(n||0); if(v>=1e6) return (v/1e6).toFixed(1).replace('.0','')+'M'; if(v>=1e3) return Math.round(v/1e3)+'k'; return String(v); };
const escHtml   = s => String(s).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const pickRandom = arr => arr[Math.floor(Math.random()*arr.length)];

function ymKey(d) { const dt=d instanceof Date?d:new Date(d); return dt.getFullYear()+'-'+String(dt.getMonth()+1).padStart(2,'0'); }
function prettyMonth(ym) { const [y,m]=ym.split('-').map(Number); return new Date(y,m-1,1).toLocaleDateString('fr-FR',{month:'long',year:'numeric'}); }
function prettyDate(iso) { return new Date(iso).toLocaleDateString('fr-FR',{weekday:'short',day:'numeric',month:'short'}); }

function toast(msg) {
  const el=$('#toast'); el.textContent=msg; el.hidden=false;
  clearTimeout(toast._t); toast._t=setTimeout(()=>el.hidden=true, 2500);
}

// ---- Code famille ----
function generateCode() {
  const chars='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let k='';
  for(let i=0;i<8;i++) { if(i===4)k+='-'; k+=chars[Math.floor(Math.random()*chars.length)]; }
  return k;
}

function normalizeCode(raw) {
  const clean = raw.replace(/[^A-Z0-9]/gi,'').toUpperCase().slice(0,8);
  if(clean.length<=4) return clean;
  return clean.slice(0,4)+'-'+clean.slice(4);
}

// ---- Login screen ----
function showLogin() {
  $('#loginScreen').style.display='flex';
  $('#appMain').hidden=true;
}

function hideLogin() {
  $('#loginScreen').style.display='none';
  $('#appMain').hidden=false;
}

async function doLogin(code) {
  if(!code || code.replace('-','').length < 4) {
    $('#loginHint').textContent='⚠️ Code trop court — minimum 4 caractères';
    return;
  }

  // Vérifier que Firebase est disponible
  if(!window.__firebase) {
    $('#loginHint').textContent='⚠️ Connexion internet requise. Vérifie ta connexion et recharge la page.';
    return;
  }

  $('#loginHint').textContent='⏳ Connexion en cours…';
  $('#loginBtn').disabled=true;

  try {
    familyCode = normalizeCode(code);
    localStorage.setItem(LOCAL_KEY, familyCode);
    await startSync();
    hideLogin();
    updateHeader();
    renderDashboard();
  } catch(e) {
    $('#loginHint').textContent='❌ Erreur : ' + e.message;
    $('#loginBtn').disabled=false;
    familyCode='';
    localStorage.removeItem(LOCAL_KEY);
    console.error(e);
  }
}

// ---- Sync temps réel ----
async function startSync() {
  // Stopper les anciens listeners
  unsubscribers.forEach(u=>u());
  unsubscribers=[];

  const { onSnapshot, collection, doc, getDoc, setDoc } = window.__firebase;
  const db = getDB();

  // === INITIALISATION : sauvegarder les catégories par défaut si absent ===
  // On vérifie si la famille existe déjà dans Firebase
  // Si non, on crée toutes les catégories par défaut automatiquement
  await initDefaultCategories(db);

  // Écouter les transactions en temps réel
  const txUnsub = onSnapshot(
    collection(db,'families',familyCode,'transactions'),
    snap => {
      state.transactions = snap.docs.map(d=>({id:d.id,...d.data()}));
      setSyncStatus(true);
      refreshAll();
    },
    err => { setSyncStatus(false); console.error('tx error',err); }
  );

  // Écouter les catégories en temps réel
  // FUSION : toujours garder les défauts + ajouter celles de Firebase
  const catUnsub = onSnapshot(
    collection(db,'families',familyCode,'categories'),
    snap => {
      const remoteCats = snap.docs.map(d=>({id:d.id,...d.data()}));
      // Fusionner : les catégories Firebase remplacent les défauts si même ID
      // Les défauts manquants sont toujours présents
      const catMap = new Map(defaultCategories.map(c=>[c.id,c]));
      remoteCats.forEach(c=>catMap.set(c.id,c));
      state.categories = [...catMap.values()];
      delete $('#filterCategory')?.dataset?.ready;
      refreshAll();
    },
    err => console.error('cat error',err)
  );

  // Écouter les settings en temps réel
  const setUnsub = onSnapshot(
    doc(db,'families',familyCode,'meta','settings'),
    snap => {
      if(snap.exists()) {
        state.settings = {...state.settings, ...snap.data()};
        applyTheme();
        refreshAll();
      }
    },
    err => console.error('settings error',err)
  );

  unsubscribers = [txUnsub, catUnsub, setUnsub];
}

// Initialiser les catégories par défaut dans Firebase si pas encore fait
async function initDefaultCategories(db) {
  const { collection, getDocs, setDoc, doc } = window.__firebase;
  try {
    const snap = await getDocs(collection(db,'families',familyCode,'categories'));
    if(snap.empty) {
      // Première connexion — sauvegarder toutes les catégories par défaut
      console.log('Initialisation des catégories par défaut...');
      await Promise.all(
        defaultCategories.map(cat =>
          setDoc(doc(db,'families',familyCode,'categories',cat.id), cat)
        )
      );
      console.log('Catégories par défaut initialisées');
    }
  } catch(e) {
    console.error('Erreur init catégories:', e);
    // Pas bloquant — l'app continue quand même
  }
}

function setSyncStatus(online) {
  isOnline = online;
  const dot  = $('#syncBarDot');
  const text = $('#syncBarText');
  const code = $('#syncBarCode');
  if(!dot) return;
  if(online) {
    dot.className='sync-bar-dot online';
    text.textContent='En direct';
  } else {
    dot.className='sync-bar-dot offline';
    text.textContent='Hors ligne';
  }
  if(code) code.textContent = familyCode ? '👨‍👩‍👧 '+familyCode : '';
}

// ---- Firestore writes ----
async function saveTx(tx) {
  const { doc, setDoc } = window.__firebase;
  await setDoc(doc(getDB(),'families',familyCode,'transactions',tx.id), tx);
}

async function deleteTxRemote(id) {
  const { doc, deleteDoc } = window.__firebase;
  await deleteDoc(doc(getDB(),'families',familyCode,'transactions',id));
}

async function saveCat(cat) {
  const { doc, setDoc } = window.__firebase;
  await setDoc(doc(getDB(),'families',familyCode,'categories',cat.id), cat);
}

async function deleteCatRemote(id) {
  const { doc, deleteDoc } = window.__firebase;
  await deleteDoc(doc(getDB(),'families',familyCode,'categories',id));
}

async function saveSettings() {
  const { doc, setDoc } = window.__firebase;
  await setDoc(doc(getDB(),'families',familyCode,'meta','settings'), state.settings);
}

// ---- Theme ----
function applyTheme() {
  const t = state.settings.theme || localStorage.getItem(THEME_KEY) || 'auto';
  if(t==='auto') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme',t);
  $$('.theme-btn').forEach(b=>b.classList.toggle('active',b.dataset.theme===t));
}

// ---- Navigation ----
function navigate(view) {
  $$('.view').forEach(v=>v.classList.remove('active'));
  $('#view-'+view).classList.add('active');
  $$('.nav-btn[data-nav]').forEach(b=>b.classList.toggle('active',b.dataset.nav===view));
  window.scrollTo({top:0,behavior:'instant'});
  if(view==='dashboard')    renderDashboard();
  if(view==='transactions') renderTransactions();
  if(view==='stats')        renderStats();
  if(view==='settings')     renderSettings();
}

function changeMonth(delta) {
  const [y,m]=currentMonth.split('-').map(Number);
  currentMonth=ymKey(new Date(y,m-1+delta,1));
  updateHeader();
  const active=document.querySelector('.view.active')?.id;
  if(active==='view-dashboard')    renderDashboard();
  if(active==='view-transactions') renderTransactions();
  if(active==='view-stats')        renderStats();
}

function updateHeader() {
  $('#currentMonthLabel').textContent=capitalize(prettyMonth(currentMonth));
  const now=ymKey(new Date());
  $('#headerSubtitle').textContent=currentMonth===now?'Mois en cours':(currentMonth>now?'À venir':'Historique');
}

// ---- Data ----
function txOfMonth(ym) { return state.transactions.filter(t=>ymKey(t.date)===ym); }
function getCategory(id) { return state.categories.find(c=>c.id===id)||{name:'Autre',icon:'📦',color:'#64748b'}; }
function totalExpense(txs) { return txs.reduce((s,t)=>s+t.amount,0); }

// ---- Prénom local ----
const PRENOM_KEY = 'mes_depenses_prenom';
function getPrenom() { return localStorage.getItem(PRENOM_KEY) || ''; }
function setPrenom(p) { localStorage.setItem(PRENOM_KEY, p.trim()); }
function isHassan() { return getPrenom().toLowerCase().includes('hassan'); }
function isAurore() { return getPrenom().toLowerCase().includes('aurore'); }

// ---- Greetings personnalisés ----
function getGreetings() {
  const prenom = getPrenom();
  const n = prenom ? prenom.split(' ')[0] : '';
  const h = isHassan(), a = isAurore();

  return {
    morning: {
      emoji: '☀️', label: 'BON MATIN',
      titles: h ? [
        'Wêh '+n+' ! C\'est parti mon gars 💪',
        'Eh djo '+n+', nouvelle journée pour tout noter !',
        n+' le patron est là ! On gère aujourd\'hui',
        'Allez '+n+' ! Nouvelle journée, nouveau départ',
      ] : a ? [
        'Bonjour '+n+' ! Belle journée à toi 🌸',
        n+' chérie, on commence bien cette journée ✨',
        'C\'est toi la boss aujourd\'hui '+n+' 👑',
        'Bonjour '+n+' ! Prête à noter les dépenses ?',
      ] : n ? [
        'Bonjour '+n+' ! Belle journée 🌅',
        n+', c\'est parti pour une nouvelle journée !',
        'Eh '+n+' ! Nouveau jour, on note tout',
      ] : [
        'Wêh ! C\'est parti 💪',
        'Nouvelle journée, on gère l\'argent !',
        'Bonjour ! Prêt à tout noter ?',
      ],
    },
    noon: {
      emoji: '🌤️', label: 'MIDI',
      titles: h ? [
        'Hassan, c\'est l\'heure de manger ! 🍽️',
        'Pause méritée djo ! Bon appétit',
        'Midi à Abidjan ! Tu tiens le rythme Hassan',
      ] : a ? [
        'Aurore, bon appétit ma chérie ! 🌸',
        'Pause bien méritée Aurore ✨',
        'Midi ! Tu tiens bien le rythme Aurore',
      ] : ['Bon appétit ! 🍽️','Pause bien méritée','Midi à Abidjan 🌴'],
    },
    afternoon: {
      emoji: '🌞', label: 'APRÈS-MIDI',
      titles: h ? [
        'La journée avance Hassan, continue !',
        'Eh djo, tu gères bien aujourd\'hui !',
        'Hassan reste focus ! On est bons',
      ] : a ? [
        'La journée avance bien Aurore ✨',
        'Continue comme ça Aurore, tu gères !',
        'Aurore est en feu aujourd\'hui 🌸',
      ] : ['La journée avance, reste focus !','Continue comme ça 💪','Tu gères bien !'],
    },
    evening: {
      emoji: '🌅', label: 'BONSOIR',
      titles: h ? [
        'Bonsoir Hassan ! Belle soirée 🌴',
        'La journée est finie djo, détends-toi',
        'Hassan a bossé aujourd\'hui ! Repos mérité',
      ] : a ? [
        'Bonsoir Aurore ! Belle soirée 🌸',
        'La journée est finie Aurore, détends-toi ✨',
        'Aurore a assuré aujourd\'hui ! Repose-toi',
      ] : ['Bonsoir ! Belle soirée 🌴','Le soleil se couche, détends-toi','Fin de journée, beau travail !'],
    },
    night: {
      emoji: '🌙', label: 'BONNE NUIT',
      titles: h ? [
        'Dors bien Hassan 😴',
        'La nuit porte conseil djo !',
        'Hassan, dernier coup d\'œil avant de dormir ?',
      ] : a ? [
        'Bonne nuit Aurore 🌸',
        'Dors bien Aurore, demain sera beau ✨',
        'Aurore, un dernier coup d\'œil ?',
      ] : ['Bonne nuit 😴','La nuit porte conseil','Dors bien, demain sera meilleur'],
    },
  };
}

// ---- Anecdotes personnalisées ----
function getAnecdotes(exp, budget, overAmount) {
  const prenom = getPrenom();
  const n = prenom ? prenom.split(' ')[0] : '';
  const h = isHassan(), a = isAurore();
  const expStr = fmtMoney(overAmount||0);

  return {
    empty: h ? [
      'Allez '+n+', rentre ta première dépense là !',
      'Eh djo '+n+' ! On commence à noter aujourd\'hui',
      'C\'est parti '+n+' ! Note tout ce que tu dépenses',
    ] : a ? [
      'Aurore, commence par ajouter ta première dépense 🌸',
      n+' chérie, on est prêtes ! Ajoute ta première dépense',
      'C\'est parti '+n+' ! Note tes dépenses ici',
    ] : [
      'Commence par ajouter ta première dépense 👇',
      'Le plus dur c\'est de commencer, allez !',
      'Note ta première dépense pour démarrer 💪',
    ],

    great: h ? [
      'Wêh '+n+' ! Tu gères ton argent comme un vrai patron 👑',
      'C\'est toi le chef ici '+n+' ! Le compte sourit',
      'Gbê ! '+n+' a géré ça proprement ce mois',
      'Trop fort '+n+' ! Le budget il respire bien 🌿',
      'Hassan et Aurore gèrent ! Le compte est propre 🎉',
    ] : a ? [
      'Bravo '+n+' ! Tu gères le budget comme une pro 👑',
      n+' a tout maîtrisé ce mois, chapeau ! 🌸',
      'Wêh '+n+' ! Les finances de la famille sourient 🎉',
      'Hassan et Aurore gèrent ! Belle équipe 💪',
      'Trop bien '+n+' ! Le budget respire ce mois ✨',
    ] : [
      'Wêh ! Tu gères comme un vrai patron 👑',
      'La famille gère ! Le compte est propre 🎉',
      '"Petit à petit, l\'oiseau fait son nid" 🐦',
      'Trop fort ! Le budget respire bien ce mois 🌿',
    ],

    good: h ? [
      'Pas mal '+n+' ! On tient le cap ce mois',
      'Continue comme ça djo, ça va bien',
      n+', le mois se passe bien, garde le rythme',
    ] : a ? [
      'Bien joué '+n+' ! On tient le cap ce mois ✨',
      'Continue comme ça '+n+', tu avances bien 🌸',
      n+', le mois se passe bien !',
    ] : [
      'Pas mal ! On tient le cap ce mois',
      'Continue comme ça, tu avances bien',
      'Le mois se passe bien, garde le rythme',
    ],

    warning: h ? [
      'Doux-doux '+n+' hein ! Le budget il part vite là 🌡️',
      'Eh djo '+n+' ! Tu approches la limite, calme-toi',
      n+' mon ami, fais attention, l\'argent fuit 👀',
      'Ralentis un peu '+n+', sinon fin du mois va faire mal',
    ] : a ? [
      'Attention '+n+' chérie ! Le budget fond vite 🌡️',
      n+', on approche la limite, un peu de prudence ✨',
      'Doucement '+n+' ! L\'argent part vite là 👀',
      n+', ralentis un peu sur les dépenses ce mois',
    ] : [
      'Doux-doux hein ! Le budget part vite 🌡️',
      'Attention, on approche la limite 👀',
      'Ralentis un peu, sinon fin du mois va faire mal',
    ],

    over: h ? [
      'Aïe aïe aïe '+n+'... le budget est mort ce mois 😅',
      'Eh djo '+n+' ! On a trop mangé l\'argent ce mois-ci',
      n+' a frappé fort ! Dépassement de '+expStr,
      'C\'est pas grave '+n+', le mois prochain on redresse 💪',
      '"Qui va doucement va sûrement" — proverbe pour '+n+' 🐢',
    ] : a ? [
      'Oups '+n+' ! On a un peu dépassé ce mois 😅',
      n+', le budget pleure un peu là 🥲',
      'Pas grave '+n+' chérie ! Dépassement de '+expStr+', on repart 💪',
      n+', le mois prochain on va mieux gérer ensemble ✨',
      'C\'est pas grave '+n+' ! On apprend de ça 🌸',
    ] : [
      'Aïe ! Le budget est dépassé de '+expStr+' 😅',
      'Pas grave, le mois prochain sera meilleur 💪',
      '"Qui va doucement va sûrement" 🐢',
      'On a dépassé, mais on reste debout !',
    ],

    nobudget: h ? [
      n+', définis ton budget dans les Réglages 🎯',
      'Eh djo '+n+' ! Sans budget c\'est difficile de gérer',
      'Allez '+n+', mets un budget pour mieux suivre !',
    ] : a ? [
      n+' chérie, définis ton budget dans les Réglages 🎯',
      n+', sans budget c\'est difficile ! Lance-toi ✨',
      'Mets un budget '+n+', ça va tout changer 🌸',
    ] : [
      'Définis ton budget dans les Réglages 🎯',
      'Sans budget, difficile de suivre !',
      'Un budget = la liberté financière 🔑',
    ],
  };
}

function getTimeOfDay() {
  const h=new Date().getHours();
  if(h<6)return'night';if(h<12)return'morning';if(h<14)return'noon';if(h<18)return'afternoon';if(h<22)return'evening';return'night';
}

function renderGreeting() {
  const tod = getTimeOfDay();
  const GREETINGS = getGreetings();
  const g = GREETINGS[tod];
  $('#greetingTime').textContent = g.emoji+' '+g.label;
  $('#greetingTitle').textContent = pickRandom(g.titles);

  const txs=txOfMonth(currentMonth), exp=totalExpense(txs), budget=state.settings.monthlyBudget||0;
  const overAmount = budget ? Math.max(0, exp-budget) : 0;
  const ANECDOTES = getAnecdotes(exp, budget, overAmount);

  let pool;
  if(!txs.length)         pool = ANECDOTES.empty;
  else if(!budget)        pool = ANECDOTES.nobudget;
  else if(exp>budget)     pool = ANECDOTES.over;
  else if(exp>budget*.8)  pool = ANECDOTES.warning;
  else if(exp<budget*.5)  pool = ANECDOTES.great;
  else                    pool = ANECDOTES.good;

  $('#greetingAnecdote').textContent = pickRandom(pool);

  // Couleur hero selon état budget
  const hero = document.querySelector('.hero-card');
  if(hero) {
    if(budget && exp>budget) {
      hero.style.background = 'linear-gradient(135deg, #ef4444 0%, #b91c1c 50%, #7f1d1d 100%)';
    } else if(budget && exp>budget*.8) {
      hero.style.background = 'linear-gradient(135deg, #f59e0b 0%, #d97706 50%, #92400e 100%)';
    } else if(budget && exp<budget*.5 && txs.length>0) {
      hero.style.background = 'linear-gradient(135deg, #22c55e 0%, #15803d 50%, #14532d 100%)';
    } else {
      hero.style.background = '';
    }
  }
}

// ---- Dashboard ----
function renderDashboard() {
  renderGreeting();
  const txs=txOfMonth(currentMonth), exp=totalExpense(txs);
  const budget=state.settings.monthlyBudget||0;
  const pct=budget?Math.min(100,(exp/budget)*100):0;

  $('#heroExpense').textContent=fmtMoney(exp);
  $('#heroProgressFill').style.width=pct+'%';
  $('#heroProgressPct').textContent=budget?Math.round(pct)+'%':'—';
  $('#sumExpense').textContent=fmtShort(exp);

  // Budget restant ou depassement
  const budgetCard=document.querySelector('.stat-card.stat-green');
  if(budget && exp>budget) {
    const over=exp-budget;
    $('#sumBudget').textContent='-'+fmtShort(over);
    if(budgetCard){budgetCard.style.background='linear-gradient(135deg,#ef4444,#b91c1c)';budgetCard.querySelector('.stat-icon').textContent='🚨';budgetCard.querySelector('.stat-label').textContent='Depassement';}
  } else {
    $('#sumBudget').textContent=budget?fmtShort(Math.max(0,budget-exp)):'—';
    if(budgetCard){budgetCard.style.background='';budgetCard.querySelector('.stat-icon').textContent='🎯';budgetCard.querySelector('.stat-label').textContent='Restant';}
  }

  const [y,m]=currentMonth.split('-').map(Number);
  const now=new Date();
  const daysElapsed=ymKey(now)===currentMonth?now.getDate():new Date(y,m,0).getDate();
  $('#sumDailyAvg').textContent=fmtShort(daysElapsed?exp/daysElapsed:0);

  renderCatChart(txs);
  renderTrendChart();
  renderRecent(txs);
}

function renderCatChart(txs) {
  const byCat=new Map();
  txs.forEach(t=>byCat.set(t.categoryId,(byCat.get(t.categoryId)||0)+t.amount));
  const entries=[...byCat.entries()].map(([id,sum])=>({cat:getCategory(id),sum})).sort((a,b)=>b.sum-a.sum);
  const ctx=$('#categoryChart').getContext('2d');
  if(charts.cat) charts.cat.destroy();
  if(!entries.length) {
    charts.cat=null;
    $('#categoryLegend').innerHTML='<p class="muted small" style="padding:16px 0;text-align:center">Aucune dépense ce mois.</p>';
    ctx.clearRect(0,0,ctx.canvas.width,ctx.canvas.height); return;
  }
  charts.cat=new Chart(ctx,{
    type:'doughnut',
    data:{labels:entries.map(e=>e.cat.name),datasets:[{data:entries.map(e=>e.sum),backgroundColor:entries.map(e=>e.cat.color),borderWidth:0,hoverOffset:8}]},
    options:{responsive:true,maintainAspectRatio:false,cutout:'66%',plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>c.label+': '+fmtMoney(c.parsed)}}}},
  });
  $('#categoryLegend').innerHTML=entries.map(e=>
    '<span class="legend-item"><span class="legend-swatch" style="background:'+e.cat.color+'"></span>'+e.cat.icon+' '+e.cat.name+' · '+fmtMoney(e.sum)+'</span>'
  ).join('');
}

function renderTrendChart() {
  const [y,m]=currentMonth.split('-').map(Number);
  const months=[];
  for(let i=5;i>=0;i--) months.push(ymKey(new Date(y,m-1-i,1)));
  const ctx=$('#trendChart').getContext('2d');
  if(charts.trend) charts.trend.destroy();
  charts.trend=new Chart(ctx,{
    type:'line',
    data:{labels:months.map(ym=>prettyMonth(ym).replace(/ \d{4}$/,'')),datasets:[{label:'Dépenses',data:months.map(ym=>totalExpense(txOfMonth(ym))),borderColor:'#c4532b',backgroundColor:'rgba(196,83,43,.15)',tension:.35,fill:true,pointBackgroundColor:'#c4532b',pointRadius:4}]},
    options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>fmtMoney(c.parsed.y)}}},scales:{y:{ticks:{callback:v=>fmtShort(v),font:{size:10}}},x:{ticks:{font:{size:10}}}}},
  });
}

function renderRecent(txs) {
  const sorted=[...txs].sort((a,b)=>b.date.localeCompare(a.date)).slice(0,6);
  $('#recentTx').innerHTML=sorted.length
    ?sorted.map(txRowHTML).join('')
    :'<li class="muted small" style="padding:16px 0;text-align:center">😶 Aucune dépense</li>';
  $('#recentTx').querySelectorAll('[data-tx-id]').forEach(el=>el.addEventListener('click',()=>openTxModal(el.dataset.txId)));
}

function txRowHTML(t) {
  const c=getCategory(t.categoryId);
  return '<li class="tx-item" data-tx-id="'+t.id+'">'+
    '<div class="tx-icon" style="background:'+c.color+'22;color:'+c.color+'">'+c.icon+'</div>'+
    '<div class="tx-body"><div class="tx-title">'+escHtml(t.description||c.name)+(t.recurring||t.recurringParentId?' 🔁':'')+'</div>'+
    '<div class="tx-sub">'+c.name+' · '+prettyDate(t.date)+'</div></div>'+
    '<div class="tx-amount">− '+fmtMoney(t.amount)+'</div></li>';
}

// ---- Transactions view ----
function renderTransactions() {
  const search=$('#searchInput').value.trim().toLowerCase();
  const filterCat=$('#filterCategory').value;
  if(!$('#filterCategory').dataset.ready) {
    $('#filterCategory').innerHTML='<option value="">Toutes catégories</option>'+
      state.categories.map(c=>'<option value="'+c.id+'">'+c.icon+' '+c.name+'</option>').join('');
    $('#filterCategory').dataset.ready='1';
  }
  let txs=txOfMonth(currentMonth);
  if(filterCat) txs=txs.filter(t=>t.categoryId===filterCat);
  if(search) txs=txs.filter(t=>(t.description||'').toLowerCase().includes(search)||getCategory(t.categoryId).name.toLowerCase().includes(search));
  const groups=new Map();
  txs.sort((a,b)=>b.date.localeCompare(a.date)).forEach(t=>{if(!groups.has(t.date))groups.set(t.date,[]);groups.get(t.date).push(t);});
  const container=$('#txGroups');
  if(!groups.size){container.innerHTML='';$('#txEmpty').hidden=false;return;}
  $('#txEmpty').hidden=true;
  container.innerHTML=[...groups.entries()].map(([date,items])=>
    '<div class="tx-group">'+
    '<div class="tx-group-header"><span>'+capitalize(prettyDate(date))+'</span><span>− '+fmtMoney(totalExpense(items))+'</span></div>'+
    '<ul class="tx-list">'+items.map(txRowHTML).join('')+'</ul></div>'
  ).join('');
  container.querySelectorAll('[data-tx-id]').forEach(el=>el.addEventListener('click',()=>openTxModal(el.dataset.txId)));
}

// ---- Stats ----
function renderStats() {
  const txs=txOfMonth(currentMonth);
  const byCat=new Map();
  txs.forEach(t=>byCat.set(t.categoryId,(byCat.get(t.categoryId)||0)+t.amount));
  const sorted=[...byCat.entries()].map(([id,sum])=>({cat:getCategory(id),sum})).sort((a,b)=>b.sum-a.sum);
  const maxSum=sorted[0]?.sum||1;
  $('#topCategories').innerHTML=sorted.length
    ?sorted.map(e=>'<li><span>'+e.cat.icon+' '+e.cat.name+'</span><span class="rank-bar"><span class="rank-bar-fill" style="width:'+(e.sum/maxSum*100).toFixed(0)+'%;background:'+e.cat.color+'"></span></span><span>'+fmtMoney(e.sum)+'</span></li>').join('')
    :'<li class="muted small">Aucune donnée.</li>';
  const [y,m]=currentMonth.split('-').map(Number);
  const daysElapsed=ymKey(new Date())===currentMonth?new Date().getDate():new Date(y,m,0).getDate();
  const totalExp=totalExpense(txs);
  $('#dailyAverage').textContent=fmtMoney(daysElapsed?totalExp/daysElapsed:0);
  $('#dailyAverageText').textContent=fmtMoney(totalExp)+' sur '+daysElapsed+' jour'+(daysElapsed>1?'s':'');
  const months=[];
  for(let i=5;i>=0;i--) months.push(ymKey(new Date(y,m-1-i,1)));
  const ctx=$('#compareChart').getContext('2d');
  if(charts.compare) charts.compare.destroy();
  charts.compare=new Chart(ctx,{
    type:'bar',
    data:{labels:months.map(ym=>prettyMonth(ym).replace(/ \d{4}$/,'')),datasets:[{label:'Dépenses',data:months.map(ym=>totalExpense(txOfMonth(ym))),backgroundColor:months.map(ym=>ym===currentMonth?'#c4532b':'#e8d5c0'),borderRadius:8}]},
    options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>fmtMoney(c.parsed.y)}}},scales:{y:{ticks:{callback:v=>fmtShort(v),font:{size:10}}},x:{ticks:{font:{size:10}}}}},
  });
  const yearTxs=state.transactions.filter(t=>t.date.startsWith(String(y)+'-'));
  $('#yearlyTotal').textContent=fmtMoney(totalExpense(yearTxs));
  $('#yearlyText').textContent=String(y)+' · '+yearTxs.length+' transaction'+(yearTxs.length>1?'s':'');

  // Historique depassements 6 derniers mois
  renderBudgetHistory(months, y, m);
}

function renderBudgetHistory(months, y, m) {
  const budget=state.settings.monthlyBudget||0;
  const el=$('#budgetHistory');
  if(!el) return;
  if(!budget) { el.innerHTML='<p class="muted small" style="text-align:center;padding:12px">Definis un budget dans les Reglages pour voir l\'historique</p>'; return; }

  el.innerHTML=months.map(ym=>{
    const exp=totalExpense(txOfMonth(ym));
    const over=exp-budget;
    const isOver=over>0;
    const pct=Math.min(100,(exp/budget)*100);
    const label=prettyMonth(ym).replace(/ \d{4}$/,'');
    const isCurrent=ym===currentMonth;
    return '<div class="budget-hist-row">'+
      '<span class="budget-hist-month'+(isCurrent?' current':'')+'">'+(isCurrent?'📍 ':'')+label+'</span>'+
      '<div class="budget-hist-bar-wrap">'+
        '<div class="budget-hist-bar"><div class="budget-hist-fill" style="width:'+Math.min(100,pct).toFixed(0)+'%;background:'+(isOver?'#ef4444':pct>80?'#f59e0b':'#22c55e')+'"></div></div>'+
      '</div>'+
      '<span class="budget-hist-amount '+(isOver?'over':'ok')+'">'+
        (isOver ? '−'+fmtMoney(over) : '+'+fmtMoney(Math.max(0,budget-exp)))+
      '</span>'+
      '<span class="budget-hist-icon">'+(isOver?'🔴':'✅')+'</span>'+
    '</div>';
  }).join('');
}

// ---- Settings ----
function renderSettings() {
  const budget=state.settings.monthlyBudget||0;
  $('#budgetInput').value=budget||'';
  $('#budgetCurrent').textContent=budget?'💰 Budget actuel : '+fmtMoney(budget):'';
  $('#familyCodeDisplay').textContent=familyCode||'—';

  // Prenom
  const prenomInput=$('#prenomInput');
  if(prenomInput && !prenomInput.dataset.filled) {
    prenomInput.value=getPrenom();
    prenomInput.dataset.filled='1';
  }

  $('#categoryList').innerHTML=state.categories.map(c=>
    '<li data-cat-id="'+c.id+'">'+
    '<div class="cat-icon" style="background:'+c.color+'22;color:'+c.color+'">'+c.icon+'</div>'+
    '<span class="cat-name">'+escHtml(c.name)+'</span>'+
    (c.locked ? '<span class="cat-lock">🔒</span>' : '<button class="cat-edit">Modifier</button>')+
    '</li>'
  ).join('');
  // Attacher les listeners seulement sur celles sans lock
  $('#categoryList').querySelectorAll('li').forEach(li=>{
    const editBtn=li.querySelector('.cat-edit');
    if(editBtn) editBtn.addEventListener('click',()=>openCatModal(li.dataset.catId));
  });

  applyTheme();
}

// ---- Modals ----
function openTxModal(txId) {
  const existing=txId?state.transactions.find(t=>t.id===txId):null;
  $('#txId').value=existing?.id||'';
  $('#txAmount').value=existing?.amount??'';
  $('#txDate').value=existing?.date||todayISO();
  $('#txDescription').value=existing?.description||'';
  $('#txRecurring').checked=!!existing?.recurring;
  $('#txModalTitle').textContent=existing?'✏️ Modifier la dépense':'💸 Nouvelle dépense';
  $('#deleteTx').hidden=!existing;
  selectedCatId=existing?.categoryId||state.categories[0]?.id||'';
  renderCatQuickPick();
  $('#txModal').hidden=false;
  setTimeout(()=>$('#txAmount').focus(),100);
}

function renderCatQuickPick() {
  const grid=$('#catQuickPick');
  if(!grid) return;
  grid.innerHTML=state.categories.map(c=>
    '<div class="cat-quick-item'+(selectedCatId===c.id?' selected':'')+'" data-cat-id="'+c.id+'" style="color:'+c.color+'">'+
    '<span class="cat-q-icon">'+c.icon+'</span>'+escHtml(c.name)+'</div>'
  ).join('');
  grid.querySelectorAll('.cat-quick-item').forEach(el=>{
    el.addEventListener('click',()=>{
      selectedCatId=el.dataset.catId;
      $('#txCategory').value=selectedCatId;
      grid.querySelectorAll('.cat-quick-item').forEach(i=>i.classList.toggle('selected',i.dataset.catId===selectedCatId));
    });
  });
  $('#txCategory').value=selectedCatId;
}

async function saveTransaction(e) {
  e.preventDefault();
  const id=$('#txId').value||uid();
  const amount=parseFloat($('#txAmount').value);
  const date=$('#txDate').value;
  const categoryId=selectedCatId||state.categories[0]?.id;
  const description=$('#txDescription').value.trim();
  const recurring=$('#txRecurring').checked;
  if(!amount||amount<=0) return toast('⚠️ Montant invalide');
  if(!date) return toast('⚠️ Date invalide');
  if(!categoryId) return toast('⚠️ Choisis une catégorie');
  const existing=state.transactions.find(t=>t.id===id);
  const tx={id,type:'expense',amount,date,categoryId,description,recurring,recurringParentId:existing?.recurringParentId||null};
  try {
    await saveTx(tx);
    closeTxModal();
    toast(existing?'✅ Modifié !':'✅ Ajouté !');
  } catch(err) {
    toast('❌ Erreur : '+err.message);
  }
}

async function deleteTransaction() {
  const id=$('#txId').value;
  if(!id) return;
  const hasChildren=state.transactions.some(t=>t.recurringParentId===id);
  if(!confirm(hasChildren?'Supprimer aussi toutes les occurrences récurrentes ?':'Supprimer cette dépense ?')) return;
  const toDelete=state.transactions.filter(t=>t.id===id||(hasChildren&&t.recurringParentId===id)).map(t=>t.id);
  try {
    await Promise.all(toDelete.map(tid=>deleteTxRemote(tid)));
    closeTxModal(); toast('🗑️ Supprimé');
  } catch(err) { toast('❌ Erreur : '+err.message); }
}

function closeTxModal() { $('#txModal').hidden=true; }

function openCatModal(catId) {
  const existing=catId?state.categories.find(c=>c.id===catId):null;
  const isLocked=existing?.locked===true;
  $('#catId').value=existing?.id||'';
  $('#catName').value=existing?.name||'';
  $('#catIcon').value=existing?.icon||'📦';
  $('#catColor').value=existing?.color||'#c4532b';
  $('#catModalTitle').textContent=existing?(isLocked?'🔒 Modifier la catégorie':'✏️ Modifier'):'🏷️ Nouvelle catégorie';
  // Cacher Supprimer si catégorie par défaut (locked)
  $('#deleteCat').hidden=!existing||isLocked;
  // Afficher un badge si locked
  const lockMsg=$('#catLockMsg');
  if(lockMsg) lockMsg.hidden=!isLocked;
  $('#catModal').hidden=false;
}

async function saveCategory(e) {
  e.preventDefault();
  const id=$('#catId').value||'cat-'+uid();
  const name=$('#catName').value.trim();
  const icon=$('#catIcon').value.trim()||'📦';
  const color=$('#catColor').value;
  if(!name) return toast('⚠️ Nom requis');
  try {
    await saveCat({id,name,icon,color});
    $('#catModal').hidden=true;
    delete $('#filterCategory').dataset.ready;
    toast('✅ Catégorie enregistrée');
  } catch(err) { toast('❌ Erreur : '+err.message); }
}

async function deleteCategory() {
  const id=$('#catId').value;
  if(!id) return;
  // Protection : ne jamais supprimer une catégorie par défaut
  const cat=state.categories.find(c=>c.id===id);
  if(cat?.locked) { toast('🔒 Cette catégorie ne peut pas être supprimée'); return; }
  const used=state.transactions.some(t=>t.categoryId===id);
  if(!confirm(used?'Cette catégorie a des dépenses. Continuer ?':'Supprimer cette catégorie ?')) return;
  try {
    await deleteCatRemote(id);
    $('#catModal').hidden=true;
    delete $('#filterCategory').dataset.ready;
    toast('🗑️ Supprimée');
  } catch(err) { toast('❌ Erreur : '+err.message); }
}

// ---- Export CSV ----
function exportCsv() {
  const rows=[['Date','Catégorie','Description','Montant (FCFA)']];
  state.transactions.slice().sort((a,b)=>a.date.localeCompare(b.date)).forEach(t=>{
    const c=getCategory(t.categoryId);
    rows.push([t.date,c.name,t.description||'',t.amount]);
  });
  const csv=rows.map(r=>r.map(v=>{const s=String(v??'');return/[",\n]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s;}).join(',')).join('\n');
  const blob=new Blob(['\ufeff'+csv],{type:'text/csv;charset=utf-8'});
  const url=URL.createObjectURL(blob),a=document.createElement('a');
  a.href=url;a.download='mes-depenses-'+new Date().toISOString().slice(0,10)+'.csv';
  document.body.appendChild(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),0);
}

async function clearAllData() {
  if(!confirm('Vraiment tout effacer ? Irréversible.')) return;
  if(!confirm('Dernière confirmation — toutes les dépenses seront supprimées.')) return;
  try {
    await Promise.all(state.transactions.map(t=>deleteTxRemote(t.id)));
    toast('🗑️ Tout effacé');
  } catch(err) { toast('❌ Erreur : '+err.message); }
}

function refreshAll() {
  const active=document.querySelector('.view.active')?.id;
  if(active==='view-dashboard')    renderDashboard();
  if(active==='view-transactions') renderTransactions();
  if(active==='view-stats')        renderStats();
  if(active==='view-settings')     renderSettings();
}

// ---- Events ----
function bindEvents() {
  // Login
  $('#loginBtn').addEventListener('click',()=>{
    const code=$('#loginCode').value.trim();
    doLogin(code);
  });
  $('#loginCode').addEventListener('keydown',e=>{ if(e.key==='Enter') $('#loginBtn').click(); });
  $('#loginCode').addEventListener('input',e=>{
    e.target.value=normalizeCode(e.target.value);
  });
  $('#newFamilyBtn').addEventListener('click',()=>{
    const code=generateCode();
    $('#loginCode').value=code;
    $('#loginHint').textContent='✨ Nouveau code créé ! Clique Accéder pour l\'utiliser.';
  });

  // Navigation
  $('#prevMonth').addEventListener('click',()=>changeMonth(-1));
  $('#nextMonth').addEventListener('click',()=>changeMonth(1));
  $$('.nav-btn[data-nav]').forEach(b=>b.addEventListener('click',()=>navigate(b.dataset.nav)));
  $$('[data-nav]').forEach(b=>b.addEventListener('click',()=>navigate(b.dataset.nav)));

  // Transactions
  $('#openAdd').addEventListener('click',()=>openTxModal(null));
  $('#closeTxModal').addEventListener('click',closeTxModal);
  $('#txModal').addEventListener('click',e=>{if(e.target.id==='txModal')closeTxModal();});
  $('#txForm').addEventListener('submit',saveTransaction);
  $('#deleteTx').addEventListener('click',deleteTransaction);

  // Catégories
  $('#addCategoryBtn').addEventListener('click',()=>openCatModal(null));
  $('#closeCatModal').addEventListener('click',()=>$('#catModal').hidden=true);
  $('#catModal').addEventListener('click',e=>{if(e.target.id==='catModal')$('#catModal').hidden=true;});
  $('#catForm').addEventListener('submit',saveCategory);
  $('#deleteCat').addEventListener('click',deleteCategory);

  // Recherche
  $('#searchInput').addEventListener('input',renderTransactions);
  $('#filterCategory').addEventListener('change',renderTransactions);

  // Budget
  $('#saveBudget').addEventListener('click',async()=>{
    const v=parseFloat($('#budgetInput').value)||0;
    state.settings.monthlyBudget=v;
    try {
      await saveSettings();
      toast(v?'✅ Budget de '+fmtMoney(v)+' enregistré !':'Budget supprimé');
    } catch(err) { toast('❌ Erreur : '+err.message); }
  });

  // Thème
  $$('.theme-btn').forEach(b=>b.addEventListener('click',async()=>{
    state.settings.theme=b.dataset.theme;
    localStorage.setItem(THEME_KEY,b.dataset.theme);
    applyTheme();
    try { await saveSettings(); } catch(e){}
  }));

  // Données
  $('#exportCsv').addEventListener('click',exportCsv);
  $('#clearData').addEventListener('click',clearAllData);

  // Code famille
  // Prenom
  document.addEventListener('click', e=>{
    if(e.target.id==='savePrenomBtn') {
      const v=$('#prenomInput')?.value?.trim();
      if(v) { setPrenom(v); toast('✅ Bonjour '+v+' ! 👋'); renderDashboard(); }
    }
  });

  $('#copyCodeBtn').addEventListener('click',()=>{
    navigator.clipboard?.writeText(familyCode).then(()=>toast('✅ Code copié : '+familyCode)).catch(()=>toast('Code : '+familyCode));
  });
  $('#logoutBtn').addEventListener('click',()=>{
    if(!confirm('Changer de code famille ? Vous serez déconnecté.')) return;
    unsubscribers.forEach(u=>u());
    localStorage.removeItem(LOCAL_KEY);
    familyCode='';
    state={transactions:[],categories:[...defaultCategories],settings:{monthlyBudget:0,theme:'auto'}};
    showLogin();
  });
}

function registerSW() {
  if('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(()=>{});
}

// ---- Init ----
document.addEventListener('DOMContentLoaded', () => {
  // Démarrer immédiatement — login ne nécessite pas Firebase
  applyTheme();
  bindEvents();
  registerSW();
  showLogin(); // Par défaut montrer login

  const saved = localStorage.getItem(LOCAL_KEY);

  const onFirebaseReady = async () => {
    if (saved) {
      familyCode = saved;
      setSyncStatus(false);
      hideLogin();
      updateHeader();
      try {
        await startSync();
      } catch(e) {
        setSyncStatus(false);
        console.error('Sync error:', e);
      }
    }
    // Sinon rester sur l'écran de login
  };

  if (window.__firebase) {
    // Firebase déjà chargé
    onFirebaseReady();
  } else {
    // Attendre l'événement firebase-ready
    window.addEventListener('firebase-ready', onFirebaseReady, { once: true });
    // Sécurité : si Firebase ne charge pas en 6s
    setTimeout(() => {
      if (!window.__firebase) {
        const hint = document.getElementById('loginHint');
        if (hint) hint.textContent = '⚠️ Connexion internet requise pour utiliser l\'app';
      }
    }, 6000);
  }
});

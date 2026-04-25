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
  settings:     { budgets: {}, theme: 'auto' }, // budgets = { '2026-04': 150000, ... }
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

// Budget du mois — indépendant par mois
function getBudget(ym) {
  return state.settings.budgets?.[ym] || 0;
}
async function setBudget(ym, amount) {
  if (!state.settings.budgets) state.settings.budgets = {};
  state.settings.budgets[ym] = amount;
  await saveSettings();
}

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
        const data = snap.data();
        // Migration : si ancien format monthlyBudget, convertir
        if (data.monthlyBudget && !data.budgets) {
          data.budgets = { [ymKey(new Date())]: data.monthlyBudget };
          delete data.monthlyBudget;
        }
        state.settings = {...state.settings, ...data};
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

// ---- Système anti-répétition ----
const QUEUE_KEY = 'mes_depenses_anec_queue';
const QUEUE_IDX_KEY = 'mes_depenses_anec_idx';

function shuffleArray(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function pickNoRepeat(pool, poolKey) {
  const key = QUEUE_KEY + '_' + poolKey;
  const idxKey = QUEUE_IDX_KEY + '_' + poolKey;
  let queue = [];
  let idx = 0;
  try {
    queue = JSON.parse(localStorage.getItem(key) || '[]');
    idx = parseInt(localStorage.getItem(idxKey) || '0');
  } catch(e) {}

  // Si queue vide ou épuisée, recréer
  if (!queue.length || idx >= queue.length) {
    queue = shuffleArray(pool.map((_, i) => i));
    idx = 0;
    // S'assurer que le 1er élément de la nouvelle queue ≠ dernier affiché
    const lastIdx = queue[queue.length - 1];
    if (queue[0] === lastIdx && queue.length > 1) {
      [queue[0], queue[1]] = [queue[1], queue[0]];
    }
  }

  const chosen = pool[queue[idx]];
  idx++;
  try {
    localStorage.setItem(key, JSON.stringify(queue));
    localStorage.setItem(idxKey, String(idx));
  } catch(e) {}
  return chosen;
}


// ---- Greetings personnalisés ----
function getGreetings() {
  const prenom = getPrenom();
  const n = prenom ? prenom.split(' ')[0] : '';
  const h = isHassan(), a = isAurore();

  return {
    morning: {
      emoji: '☀️', label: 'BON MATIN',
      titles: h ? [
        'Wêh ' + n + ' ! C\'est parti mon gars 💪',
        'Eh djo ' + n + ', nouvelle journée pour tout noter !',
        n + ' le patron est là ! On gère aujourd\'hui',
        'Allez ' + n + ' ! Nouvelle journée, nouveau départ',
        'Bonjour ' + n + ' ! L\'argent ne dort pas, toi non plus',
        'Djo ' + n + ' ! Le soleil est levé, note tes dépenses',
        n + ', aujourd\'hui on gère propre comme Plateau 🏙️',
        'Eh ' + n + ' ! Abidjan t\'attend, commence la journée',
        'Levé tôt ' + n + ' ! Les gros sous arrivent 💰',
        'Gbê ' + n + ' ! Une nouvelle page commence aujourd\'hui',
      ] : a ? [
        'Bonjour ' + n + ' ! Belle journée à toi 🌸',
        n + ' chérie, on commence bien cette journée ✨',
        'C\'est toi la boss aujourd\'hui ' + n + ' 👑',
        'Bonjour ' + n + ' ! Prête à noter les dépenses ?',
        n + ', le matin est beau comme la lagune 🌊',
        'Belle matinée ' + n + ' ! On démarre en beauté 🌸',
        n + ' chérie, nouvelle journée = nouvelles opportunités ✨',
        'Coucou ' + n + ' ! Prête à maîtriser le budget du jour ?',
        n + ', chaque matin est un cadeau — gère-le bien 🎁',
        'Bonjour ' + n + ' ! La famille compte sur toi 👨‍👩‍👧',
      ] : n ? [
        'Bonjour ' + n + ' ! Belle journée 🌅',
        n + ', c\'est parti pour une nouvelle journée !',
        'Eh ' + n + ' ! Nouveau jour, on note tout',
        'Bonne journée ' + n + ' ! L\'argent bien géré, c\'est la liberté',
        n + ', commence fort ce matin 💪',
      ] : [
        'Wêh ! C\'est parti 💪',
        'Nouvelle journée, on gère l\'argent !',
        'Bonjour ! Prêt à tout noter ?',
        'Le matin est frais, l\'esprit est clair — note tout !',
        'Nouvelle journée, nouvelles opportunités 🌅',
        'Abidjan se réveille, toi aussi ! C\'est parti 🌴',
      ],
    },
    noon: {
      emoji: '🌤️', label: 'MIDI',
      titles: h ? [
        'Hassan, c\'est l\'heure de manger ! 🍽️',
        'Pause méritée djo ! Bon appétit',
        'Midi à Abidjan ! Tu tiens le rythme Hassan',
        n + ', attieké-poisson ou garba aujourd\'hui ? 😄',
        'Eh djo ' + n + ' ! Pause méridienne bien méritée',
        'Midi ' + n + ' ! Tu gères ce matin, continue cet après-midi',
      ] : a ? [
        'Aurore, bon appétit ma chérie ! 🌸',
        'Pause bien méritée Aurore ✨',
        'Midi ! Tu tiens bien le rythme Aurore',
        n + ', petite pause bien méritée 🌸',
        'Midi ' + n + ' ! La journée est à moitié gagnée ✨',
        n + ' chérie, mange bien et reprends de plus belle !',
      ] : [
        'Bon appétit ! 🍽️',
        'Pause bien méritée',
        'Midi à Abidjan 🌴',
        'Mi-journée, mi-chemin ! Continue comme ça',
        'Pause méridienne — tu reviens plus fort après',
        'Midi au soleil 🌤️ La journée avance bien',
      ],
    },
    afternoon: {
      emoji: '🌞', label: 'APRÈS-MIDI',
      titles: h ? [
        'La journée avance Hassan, continue !',
        'Eh djo, tu gères bien aujourd\'hui !',
        'Hassan reste focus ! On est bons',
        n + ', l\'après-midi à Abidjan, ça bouge ! 🏙️',
        'Djo ' + n + ', plus que quelques heures — tiens le cap',
        n + ' est en mode gestion, j\'aime ça 💪',
      ] : a ? [
        'La journée avance bien Aurore ✨',
        'Continue comme ça Aurore, tu gères !',
        'Aurore est en feu aujourd\'hui 🌸',
        n + ', l\'après-midi est à toi ✨',
        'Bien joué ce matin ' + n + ' ! Finis en beauté',
        n + ' sur sa lancée — rien ne peut l\'arrêter 👑',
      ] : [
        'La journée avance, reste focus !',
        'Continue comme ça 💪',
        'Tu gères bien !',
        'Après-midi productive — on tient le cap',
        'Plus que quelques heures, reste concentré',
        'La lagune attend, finis ta journée en beauté 🌊',
      ],
    },
    evening: {
      emoji: '🌅', label: 'BONSOIR',
      titles: h ? [
        'Bonsoir Hassan ! Belle soirée 🌴',
        'La journée est finie djo, détends-toi',
        'Hassan a bossé aujourd\'hui ! Repos mérité',
        n + ', le coucher de soleil sur la lagune... 🌅',
        'Eh djo ' + n + ' ! La soirée t\'appartient',
        n + ', belle journée ! Tu mérites de souffler',
        'Bonsoir ' + n + ' ! Révision des dépenses du jour ?',
      ] : a ? [
        'Bonsoir Aurore ! Belle soirée 🌸',
        'La journée est finie Aurore, détends-toi ✨',
        'Aurore a assuré aujourd\'hui ! Repose-toi',
        n + ' chérie, belle soirée à toi 🌸',
        'Bonsoir ' + n + ' ! Tu as bien géré aujourd\'hui ✨',
        n + ', le soir est doux — profites-en',
        'Belle soirée ' + n + ' ! La famille est bien gardée 👨‍👩‍👧',
      ] : [
        'Bonsoir ! Belle soirée 🌴',
        'Le soleil se couche, détends-toi',
        'Fin de journée, beau travail !',
        'Soirée méritée ! Tu as bien géré',
        'Le soleil se couche sur Abidjan 🌅',
        'Bonsoir ! Petit bilan de la journée ?',
        'La journée s\'achève bien 🌟',
      ],
    },
    night: {
      emoji: '🌙', label: 'BONNE NUIT',
      titles: h ? [
        'Dors bien Hassan 😴',
        'La nuit porte conseil djo !',
        'Hassan, dernier coup d\'œil avant de dormir ?',
        n + ', demain on repart de plus belle 💪',
        'Bonne nuit ' + n + ' ! La famille est bien protégée',
        n + ' djo, repose-toi bien — demain ça travaille !',
        'La nuit est calme ' + n + ' — dors tranquille 🌙',
      ] : a ? [
        'Bonne nuit Aurore 🌸',
        'Dors bien Aurore, demain sera beau ✨',
        'Aurore, un dernier coup d\'œil ?',
        n + ' chérie, bonne nuit — tu as bien géré 🌸',
        'Dors bien ' + n + ' ! Demain de nouvelles opportunités',
        n + ', la nuit est douce comme ton sourire 🌙✨',
        'Bonne nuit ' + n + ' ! La famille est entre de bonnes mains',
      ] : [
        'Bonne nuit 😴',
        'La nuit porte conseil',
        'Dors bien, demain sera meilleur',
        'Nuit étoilée sur Abidjan 🌙',
        'Repose-toi bien — demain on repart fort',
        'Bonne nuit ! Ton budget te remercie 💤',
        'Ferme les yeux, tout est bien géré 🌙',
      ],
    },
  };
}

// ---- Anecdotes personnalisées (anti-répétition) ----
function getAnecdotePools() {
  const prenom = getPrenom();
  const n = prenom ? prenom.split(' ')[0] : '';
  const h = isHassan(), a = isAurore();

  return {
    empty: h ? [
      'Allez ' + n + ', rentre ta première dépense là !',
      'Eh djo ' + n + ' ! On commence à noter aujourd\'hui',
      'C\'est parti ' + n + ' ! Note tout ce que tu dépenses',
      n + ', zéro dépense notée — on commence quand ?',
      'Djo ' + n + ' ! L\'argent qui sort sans être noté, c\'est l\'argent perdu',
      n + ', premier pas vers la liberté financière — ajoute ta première dépense',
      'Eh ' + n + ' ! Même 100 FCFA ça compte, note tout',
      n + ' le patron ! On commence le suivi aujourd\'hui ?',
      'Wêh ' + n + ' ! Vide pour l\'instant — remplis ça mon ami',
      n + ', une dépense notée = un pas vers la maîtrise totale 💪',
    ] : a ? [
      'Aurore, commence par ajouter ta première dépense 🌸',
      n + ' chérie, on est prêtes ! Ajoute ta première dépense',
      'C\'est parti ' + n + ' ! Note tes dépenses ici',
      n + ', chaque centime compté, c\'est la liberté 🌸',
      'Lance-toi ' + n + ' ! Une petite dépense pour commencer ✨',
      n + ' chérie, ton budget t\'attend — première entrée ?',
      'Rien encore ' + n + ' — on commence quand tu veux 🌸',
      n + ', note même le petit café du matin ☕ Ça compte !',
      'Premier pas ' + n + ' ! Ajoute ce que tu as dépensé aujourd\'hui',
      n + ', la gestion parfaite commence par la première note ✨',
    ] : [
      'Commence par ajouter ta première dépense 👇',
      'Le plus dur c\'est de commencer, allez !',
      'Note ta première dépense pour démarrer 💪',
      'Vide pour l\'instant — remplis ça !',
      'Premier pas vers la maîtrise de ton argent',
      'Même 100 FCFA ça compte — note tout !',
      '"Le voyage de mille lieues commence par un pas" 🌍',
      'L\'argent non suivi est l\'argent perdu',
      'Un clic pour ajouter, une vie pour bénéficier 📲',
      'Commence petit, vois grand 🌱',
    ],

    great: h ? [
      'Wêh ' + n + ' ! Tu gères ton argent comme un vrai patron 👑',
      'C\'est toi le chef ici ' + n + ' ! Le compte sourit',
      'Gbê ! ' + n + ' a géré ça proprement ce mois',
      'Trop fort ' + n + ' ! Le budget il respire bien 🌿',
      'Hassan et Aurore gèrent ! Le compte est propre 🎉',
      n + ' djo ! Tu as dompté l\'argent ce mois 🔥',
      'Eh ' + n + ' ! Les chiffres sont beaux comme la lagune',
      n + ' est en mode économies — respect mon frère 🫡',
      'Wêh ! ' + n + ' gère comme les grands hommes d\'Abidjan',
      '"L\'homme sage dépense moins qu\'il ne gagne" — et toi tu l\'es',
      n + ', le compte est propre comme le Plateau un dimanche matin',
      'Djo ! ' + n + ' maîtrise son argent mieux qu\'un banquier 💼',
      'La famille Hassan-Aurore est solide ce mois ! 💪',
      n + ', félicitations — le budget te dit merci 🎊',
      'Tu gardes la tête froide ' + n + ' ! Ça se voit sur le compte',
    ] : a ? [
      'Bravo ' + n + ' ! Tu gères le budget comme une pro 👑',
      n + ' a tout maîtrisé ce mois, chapeau ! 🌸',
      'Wêh ' + n + ' ! Les finances de la famille sourient 🎉',
      'Hassan et Aurore gèrent ! Belle équipe 💪',
      'Trop bien ' + n + ' ! Le budget respire ce mois ✨',
      n + ' chérie, tu es la reine du budget ce mois 👑🌸',
      'Magnifique ' + n + ' ! L\'argent est bien gardé entre tes mains',
      n + ', les chiffres sont aussi beaux que toi ce mois ✨',
      '"Une femme qui gère bien son foyer bâtit une nation" 🌍',
      n + ', le compte sourit — et nous aussi 😊',
      'La famille est entre de bonnes mains avec toi ' + n + ' 🌸',
      n + ' est imbattable sur le budget ce mois ! 🏆',
      'Chapeau ' + n + ' ! Même les banques peuvent apprendre de toi',
      n + ' chérie, tu rayonnes — et ton compte aussi ✨',
      'Wêh ' + n + ' ! La gestionnaire de la famille a encore frappé fort',
    ] : [
      'Wêh ! Tu gères comme un vrai patron 👑',
      'La famille gère ! Le compte est propre 🎉',
      '"Petit à petit, l\'oiseau fait son nid" 🐦',
      'Trop fort ! Le budget respire bien ce mois 🌿',
      'L\'argent est bien gardé — félicitations 🏆',
      'Budget maîtrisé = esprit tranquille 🧘',
      '"Qui économise aujourd\'hui mange demain" 🌾',
      'Les chiffres sont beaux — continue comme ça !',
      'Gestionnaire de l\'année ! Le compte le confirme 📊',
      'Abidjan-gestion : niveau expert atteint 🔥',
      'Le budget respire, la famille aussi 🌿',
      'Bien joué ! La liberté financière se construit ainsi',
    ],

    good: h ? [
      'Pas mal ' + n + ' ! On tient le cap ce mois',
      'Continue comme ça djo, ça va bien',
      n + ', le mois se passe bien, garde le rythme',
      'Djo ' + n + ' ! Tu es dans la bonne zone, reste-y',
      n + ', mi-chemin et les chiffres sont bons — continue',
      'Eh ' + n + ' ! Solide comme d\'habitude',
      n + ' tient la barque — la famille est stable 🚢',
      'Correct ' + n + ' ! On vise encore mieux le mois prochain',
      n + ' gère — pas parfait mais on avance 👍',
      'Bon rythme djo ! ' + n + ' est dans le tempo',
    ] : a ? [
      'Bien joué ' + n + ' ! On tient le cap ce mois ✨',
      'Continue comme ça ' + n + ', tu avances bien 🌸',
      n + ', le mois se passe bien !',
      n + ' chérie, tu es dans la bonne direction ✨',
      'Bel équilibre ' + n + ' ! Continue sur cette lancée 🌸',
      n + ', les chiffres sont sages comme toi 😊',
      'On est sur la bonne voie ' + n + ' — ensemble on gère 💪',
      n + ' chérie, c\'est propre — visons encore mieux',
      'Bien ' + n + ' ! Le mois avance dans le bon sens ✨',
      n + ', gestionnaire sérieuse — ça se confirme 🌸',
    ] : [
      'Pas mal ! On tient le cap ce mois',
      'Continue comme ça, tu avances bien',
      'Le mois se passe bien, garde le rythme',
      'Dans la bonne direction — continue',
      'Bonne gestion ! Le compte apprécie',
      'Mi-chemin, mi-victoire — reste focus',
      'Solide ! Les chiffres parlent d\'eux-mêmes',
      '"La régularité fait la victoire" 🏆',
      'Bon équilibre — visons encore mieux',
      'Dans le vert ! Continue sur cette lancée',
    ],

    warning: h ? [
      'Doux-doux ' + n + ' hein ! Le budget il part vite là 🌡️',
      'Eh djo ' + n + ' ! Tu approches la limite, calme-toi',
      n + ' mon ami, fais attention, l\'argent fuit 👀',
      'Ralentis un peu ' + n + ', sinon fin du mois va faire mal',
      n + ' ! Le compte dit "attention" — écoute-le',
      'Djo ' + n + ' ! Plus que 20% du budget — chaque FCFA compte',
      n + ', on a un peu trop mangé l\'argent là — on ralentit',
      'Eh ' + n + ' ! La ligne rouge approche — doucement',
      n + ' djo, le mois n\'est pas fini mais le budget lui file',
      '"Qui dépense vite se retrouve vite à sec" — proverbe pour ' + n,
      n + ', petite alerte amicale — surveille les prochaines dépenses',
      n + ' ! Abidjan est chère, le budget te le dit',
    ] : a ? [
      'Attention ' + n + ' chérie ! Le budget fond vite 🌡️',
      n + ', on approche la limite, un peu de prudence ✨',
      'Doucement ' + n + ' ! L\'argent part vite là 👀',
      n + ', ralentis un peu sur les dépenses ce mois',
      n + ' chérie, petite alerte — il reste peu de budget 🌸',
      n + ', on souffre un peu là — mais on peut encore sauver le mois',
      'Eh ' + n + ' ! La limite approche, sois vigilante ✨',
      n + ' chérie, quelques dépenses de moins et on est sauvées',
      n + ', le budget te fait un clin d\'œil d\'avertissement 👀',
      '"Mieux vaut prévenir que guérir" — pour le budget aussi ' + n,
      n + ', ensemble on peut encore redresser ça 💪',
      'Attention ' + n + ' ! Le compte a besoin de repos',
    ] : [
      'Doux-doux hein ! Le budget part vite 🌡️',
      'Attention, on approche la limite 👀',
      'Ralentis un peu, sinon fin du mois va faire mal',
      'Alerte jaune ! Le budget dit attention',
      '"Celui qui dépense sans compter pleure sans larmes" 💧',
      'Encore quelques jours — chaque FCFA compte maintenant',
      'La limite approche — soyons sages',
      'Petit coup de frein conseillé 🚦',
      'Le mois n\'est pas fini mais le budget file',
      'Vigilance ! Le compte surveille chaque dépense',
      '"L\'eau qui coule doucement creuse la roche" — ton budget aussi',
      'On peut encore sauver le mois — focus 🎯',
    ],

    over: h ? [
      'Aïe aïe aïe ' + n + '... le budget est mort ce mois 😅',
      'Eh djo ' + n + ' ! On a trop mangé l\'argent ce mois-ci',
      n + ' a frappé fort ! Mais le mois prochain on redresse',
      'C\'est pas grave ' + n + ', le mois prochain on redresse 💪',
      '"Qui va doucement va sûrement" — proverbe pour ' + n + ' 🐢',
      n + ' djo, même les grands patrons dépassent parfois — on repart',
      'Eh ' + n + ' ! Le compte a souffert mais on apprend',
      n + ', Abidjan est chère parfois — le mois prochain on anticipe',
      'Dépassé ' + n + ' ! Mais un vrai patron rebondit toujours 🔥',
      'Le budget est KO ce mois ' + n + ' — mais ce n\'est qu\'un round 🥊',
      n + ' djo, on a trop dépensé là — analyse et repart plus fort',
      'Pas grave ' + n + ' ! Chaque mois est une nouvelle page',
      n + ', même les meilleurs gestionnaires dépassent — l\'important c\'est la leçon',
      'Ce mois c\'est rouge ' + n + ' — le prochain sera vert, j\'en suis sûr',
      '"La chute n\'est pas un échec, rester à terre l\'est" 💪 ' + n,
    ] : a ? [
      'Oups ' + n + ' ! On a un peu dépassé ce mois 😅',
      n + ', le budget pleure un peu là 🥲',
      'Pas grave ' + n + ' chérie ! On repart le mois prochain 💪',
      n + ', le mois prochain on va mieux gérer ensemble ✨',
      'C\'est pas grave ' + n + ' ! On apprend de ça 🌸',
      n + ' chérie, le dépassement n\'est pas une défaite — c\'est une leçon',
      'Oups ' + n + ' ! Mais une femme forte rebondit — tu le sais 👑',
      n + ', ce mois on a dépassé mais ensemble on redresse ✨',
      'Le budget a craqué ' + n + ' — pas toi ! On repart 💪',
      n + ' chérie, même les meilleures ont des mois difficiles 🌸',
      '"Après la pluie le beau temps" — ton prochain mois ' + n + ' ✨',
      n + ', analyse les grosses dépenses et le prochain mois sera différent',
      'Dépasser son budget une fois ' + n + ' c\'est humain — le répéter c\'est un choix',
      n + ' chérie, on a appris quelque chose ce mois — ça vaut de l\'or',
      'Courage ' + n + ' ! Le prochain mois t\'appartient 🌸',
    ] : [
      'Aïe ! Le budget est dépassé 😅',
      'Pas grave, le mois prochain sera meilleur 💪',
      '"Qui va doucement va sûrement" 🐢',
      'On a dépassé, mais on reste debout !',
      'Dépassement = leçon précieuse pour le mois prochain',
      '"La chute n\'est pas un échec, rester à terre l\'est"',
      'Analyse les grosses dépenses — le mois prochain sera différent',
      'Un mois dans le rouge, le prochain dans le vert 🟢',
      '"Après la pluie le beau temps" — ton prochain mois',
      'On a appris quelque chose ce mois — ça vaut de l\'or',
      'Rebondir c\'est ce que font les grands 💪',
      'Ce mois est fermé — ouvrons le prochain avec sagesse',
    ],

    nobudget: h ? [
      n + ', définis ton budget dans les Réglages 🎯',
      'Eh djo ' + n + ' ! Sans budget c\'est difficile de gérer',
      'Allez ' + n + ', mets un budget pour mieux suivre !',
      n + ' ! Un budget c\'est comme une carte — sans carte tu te perds',
      'Djo ' + n + ', sans budget tu dépenses à l\'aveugle — va dans Réglages',
      n + ', le budget c\'est ton garde-fou — active-le !',
      'Eh ' + n + ' ! Même 50 000 FCFA comme budget c\'est mieux que rien',
      n + ' djo, le vrai patron se fixe des limites — mets ton budget',
      '"Qui ne planifie pas planifie d\'échouer" — ' + n + ' fixe ton budget',
      n + ', un homme qui se respecte connaît ses limites — Réglages > Budget',
    ] : a ? [
      n + ' chérie, définis ton budget dans les Réglages 🎯',
      n + ', sans budget c\'est difficile ! Lance-toi ✨',
      'Mets un budget ' + n + ', ça va tout changer 🌸',
      n + ' chérie, le budget c\'est ta boussole — active-la !',
      n + ', sans budget on navigue à vue — va dans Réglages',
      'Un budget ' + n + ' c\'est la clé de la sérénité financière 🗝️',
      n + ' chérie, même 100 000 FCFA comme budget — juste pour voir 🌸',
      'La femme qui se fixe un budget est imbattable ' + n + ' !',
      n + ', définir son budget c\'est s\'aimer — vas-y ✨',
      '"Une maison sans budget est une maison sans direction" 🏠',
    ] : [
      'Définis ton budget dans les Réglages 🎯',
      'Sans budget, difficile de suivre !',
      'Un budget = la liberté financière 🔑',
      'Sans limite, l\'argent disparaît sans raison',
      '"Qui ne planifie pas planifie d\'échouer"',
      'Va dans Réglages → Budget — ça change tout',
      'Le budget c\'est ta boussole financière 🧭',
      'Même un petit budget vaut mieux que rien',
      'Définir son budget c\'est se respecter',
      '"Connais ta limite avant de la franchir" 🚦',
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
  // Anti-répétition sur les titres aussi
  $('#greetingTitle').textContent = pickNoRepeat(g.titles, 'greet_'+tod);

  const txs=txOfMonth(currentMonth), exp=totalExpense(txs), budget=getBudget(currentMonth);
  const overAmount = budget ? Math.max(0, exp-budget) : 0;
  const POOLS = getAnecdotePools();

  // Déterminer la situation financière
  let poolKey;
  let pool;
  if(!txs.length)         { pool = POOLS.empty;    poolKey = 'empty'; }
  else if(!budget)        { pool = POOLS.nobudget;  poolKey = 'nobudget'; }
  else if(exp>budget)     { pool = POOLS.over;      poolKey = 'over'; }
  else if(exp>budget*.8)  { pool = POOLS.warning;   poolKey = 'warning'; }
  else if(exp<budget*.5)  { pool = POOLS.great;     poolKey = 'great'; }
  else                    { pool = POOLS.good;       poolKey = 'good'; }

  // Anti-répétition sur les anecdotes
  $('#greetingAnecdote').textContent = pickNoRepeat(pool, 'anec_'+poolKey);

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
  const budget=getBudget(currentMonth);
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
  // Chaque mois a son propre budget
  const el=$('#budgetHistory');
  if(!el) return;
  const hasAnyBudget = months.some(ym => getBudget(ym) > 0);
  if(!hasAnyBudget) { el.innerHTML='<p class="muted small" style="text-align:center;padding:12px">Definis un budget mensuel pour voir l\'historique</p>'; return; }

  el.innerHTML=months.map(ym=>{
    const exp=totalExpense(txOfMonth(ym));
    const budget=getBudget(ym);
    if(!budget) return '<div class="budget-hist-row"><span class="budget-hist-month">'+(ym===currentMonth?'📍 ':'')+prettyMonth(ym).replace(/ \d{4}$/,'')+'</span><span class="muted small" style="flex:1;text-align:center">Pas de budget</span></div>';
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
  const budget=getBudget(currentMonth);
  $('#budgetInput').value=budget||'';
  const monthLabel=capitalize(prettyMonth(currentMonth));
  $('#budgetCurrent').textContent=budget?'💰 '+monthLabel+' : '+fmtMoney(budget):'';
  // Badge mois
  const badge=$('#budgetMonthBadge');
  if(badge) badge.textContent=monthLabel;
  const sub=$('#budgetSetupSub');
  if(sub) sub.textContent='Budget pour '+monthLabel;
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

// ---- Export JSON ----
function exportJson() {
  const data = {
    _exportedAt: new Date().toISOString(),
    _version: 'v10',
    transactions: state.transactions,
    categories: state.categories.filter(c => !c.locked), // Exporter seulement les catégories custom
    settings: { budgets: state.settings.budgets || {} },
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], {type:'application/json'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'mes-depenses-' + new Date().toISOString().slice(0,10) + '.json';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
  toast('✅ Export JSON téléchargé');
}

// ---- Import JSON ----
async function importJson(file) {
  const reader = new FileReader();
  reader.onload = async () => {
    try {
      const data = JSON.parse(reader.result);

      // Validation basique
      if (!data.transactions && !data.categories) {
        toast('❌ Fichier invalide — aucune donnée trouvée');
        return;
      }

      const txCount = (data.transactions || []).length;
      const catCount = (data.categories || []).length;
      const exportDate = data._exportedAt
        ? new Date(data._exportedAt).toLocaleDateString('fr-FR', {day:'numeric',month:'short',year:'numeric'})
        : 'date inconnue';

      const msg = `Fichier du ${exportDate}\n` +
        `• ${txCount} dépense${txCount>1?'s':''}\n` +
        `• ${catCount} catégorie${catCount>1?'s':''} personnalisée${catCount>1?'s':''}\n\n` +
        `Ces données seront AJOUTÉES à Firebase (rien ne sera supprimé).\nContinuer ?`;

      if (!confirm(msg)) return;

      let imported = 0;
      let skipped = 0;

      // Importer les transactions (fusionner — pas écraser)
      if (data.transactions && data.transactions.length > 0) {
        const existingIds = new Set(state.transactions.map(t => t.id));
        const newTxs = data.transactions
          .filter(t => t.amount && t.date) // Valider
          .map(t => ({...t, type: 'expense'})); // S'assurer que c'est bien expense

        for (const tx of newTxs) {
          if (existingIds.has(tx.id)) {
            skipped++;
          } else {
            try {
              await saveTx(tx);
              imported++;
            } catch(e) {
              console.error('Erreur import tx:', e);
            }
          }
        }
      }

      // Importer les catégories custom (jamais écraser les défauts)
      if (data.categories && data.categories.length > 0) {
        const defaultIds = new Set(defaultCategories.map(c => c.id));
        const customCats = data.categories.filter(c => !defaultIds.has(c.id));
        for (const cat of customCats) {
          try {
            await saveCat({...cat, locked: false});
          } catch(e) {
            console.error('Erreur import cat:', e);
          }
        }
      }

      // Importer le budget si pas encore défini
      if (data.settings?.monthlyBudget && !getBudget(ymKey(new Date()))) {
        // Migration : appliquer l'ancien budget au mois courant
        await setBudget(ymKey(new Date()), data.settings.monthlyBudget).catch(()=>{});
      } else if (data.settings?.budgets) {
        // Nouveau format — fusionner les budgets
        if (!state.settings.budgets) state.settings.budgets = {};
        Object.assign(state.settings.budgets, data.settings.budgets);
        try { await saveSettings(); } catch(e) {}
      }

      const msg2 = imported > 0
        ? `✅ Import terminé !\n${imported} dépense${imported>1?'s':''} ajoutée${imported>1?'s':''}${skipped>0?' ('+skipped+' déjà présentes)':''}`
        : `ℹ️ Toutes les dépenses étaient déjà présentes`;
      toast(imported > 0 ? `✅ ${imported} dépense${imported>1?'s':''} importée${imported>1?'s':''}` : 'ℹ️ Déjà à jour');
      alert(msg2);

    } catch(e) {
      toast('❌ Fichier JSON invalide');
      console.error('Import error:', e);
    }
  };
  reader.readAsText(file);
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

  // Budget — sauvegardé pour le mois affiché uniquement
  $('#saveBudget').addEventListener('click',async()=>{
    const v=parseFloat($('#budgetInput').value)||0;
    try {
      await setBudget(currentMonth, v);
      const monthLabel=capitalize(prettyMonth(currentMonth));
      toast(v?'✅ Budget '+monthLabel+' : '+fmtMoney(v):'Budget supprimé pour ce mois');
      renderSettings();
      renderDashboard();
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
  $('#exportJson').addEventListener('click',exportJson);
  $('#exportCsv').addEventListener('click',exportCsv);
  $('#importJson').addEventListener('change',e=>{if(e.target.files[0]){importJson(e.target.files[0]);e.target.value='';} });
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
    state={transactions:[],categories:[...defaultCategories],settings:{budgets:{},theme:'auto'}};
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

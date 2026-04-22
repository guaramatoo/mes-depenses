/* =========================================================
   Mes Dépenses — Module Sync v2
   Synchronisation multi-appareils via fichier cloud
   Compatible iPhone, Android, PC/Mac — sans compte
   ========================================================= */

'use strict';

const SYNC_VERSION = 2;
const SYNC_FILENAME = 'mes-depenses-sync.json';
const FAMILY_KEY_STORAGE = 'mes_depenses_family_key';
const DEVICE_NAME_STORAGE = 'mes_depenses_device_name';

// ---- Détection plateforme ----
const _platform = (() => {
  const ua = navigator.userAgent;
  if (/iPad|iPhone|iPod/.test(ua)) return 'ios';
  if (/Android/.test(ua)) return 'android';
  if (/Mac/.test(ua)) return 'mac';
  return 'other';
})();

const _platformInfo = {
  ios:     { name: 'iPhone/iPad', cloudName: 'iCloud Drive', icon: '☁️' },
  android: { name: 'Android',     cloudName: 'Google Drive',  icon: '📂' },
  mac:     { name: 'Mac',         cloudName: 'iCloud Drive',  icon: '☁️' },
  other:   { name: 'Navigateur',  cloudName: 'Drive/Dropbox', icon: '📁' },
};

const _syncInstructions = {
  ios: [
    'Appuie sur 📤 Sauvegarder',
    'Dans le menu Partager → "Enregistrer dans Fichiers"',
    'Choisis iCloud Drive et crée un dossier "Mes Dépenses"',
    'Sur l\'autre iPhone : appuie sur 📥 Restaurer → sélectionne ce fichier dans iCloud Drive',
  ],
  android: [
    'Appuie sur 📤 Sauvegarder — le fichier se télécharge automatiquement',
    'Ouvre Google Drive et uploade le fichier téléchargé',
    'Sur l\'autre appareil : télécharge le fichier depuis Google Drive',
    'Appuie sur 📥 Restaurer et sélectionne le fichier',
  ],
  mac: [
    'Appuie sur 📤 Sauvegarder — le fichier se télécharge',
    'Déplace-le dans iCloud Drive → dossier "Mes Dépenses"',
    'Sur iPhone : 📥 Restaurer → Fichiers → iCloud Drive → Mes Dépenses',
    'Ou partage directement via AirDrop avec ton iPhone',
  ],
  other: [
    'Appuie sur 📤 Sauvegarder — le fichier se télécharge',
    'Uploade-le sur Google Drive, Dropbox ou OneDrive',
    'Sur l\'autre appareil : télécharge le fichier depuis ton cloud',
    'Appuie sur 📥 Restaurer et sélectionne le fichier',
  ],
};

// ---- Nom appareil ----
function getDeviceName() {
  const stored = localStorage.getItem(DEVICE_NAME_STORAGE);
  if (stored) return stored;
  const p = _platformInfo[_platform];
  const name = p.name + ' #' + Math.floor(Math.random() * 900 + 100);
  localStorage.setItem(DEVICE_NAME_STORAGE, name);
  return name;
}
function setDeviceName(name) {
  localStorage.setItem(DEVICE_NAME_STORAGE, name.trim());
}

// ---- Code famille ----
function getFamilyKey() {
  return localStorage.getItem(FAMILY_KEY_STORAGE) || '';
}
function setFamilyKey(key) {
  if (key) localStorage.setItem(FAMILY_KEY_STORAGE, key.trim().toUpperCase());
  else localStorage.removeItem(FAMILY_KEY_STORAGE);
}
function generateFamilyKey() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let k = '';
  for (let i = 0; i < 8; i++) {
    if (i === 4) k += '-';
    k += chars[Math.floor(Math.random() * chars.length)];
  }
  return k;
}

// ---- Sauvegarde ----
async function syncSave(state) {
  const payload = {
    _version: SYNC_VERSION,
    _savedAt: new Date().toISOString(),
    _deviceName: getDeviceName(),
    _familyKey: getFamilyKey() || null,
    _txCount: state.transactions.length,
    transactions: state.transactions,
    categories: state.categories,
    settings: state.settings,
  };
  const json = JSON.stringify(payload, null, 2);
  const file = new File([json], SYNC_FILENAME, { type: 'application/json' });

  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: 'Mes Depenses - Sync' });
      return { success: true, method: 'share' };
    } catch (err) {
      if (err && err.name === 'AbortError') return { success: false, aborted: true };
    }
  }

  // Fallback téléchargement
  const blob = new Blob([json], { type: 'application/json' });
  _downloadBlob(blob, SYNC_FILENAME);
  return { success: true, method: 'download' };
}

// ---- Parsing fichier ----
function parseSyncFile(content) {
  try {
    const data = JSON.parse(content);
    if (!Array.isArray(data.transactions) || !Array.isArray(data.categories)) {
      return { ok: false, error: 'Format invalide.' };
    }
    return { ok: true, data };
  } catch {
    return { ok: false, error: 'Fichier JSON invalide.' };
  }
}

// ---- Analyse avant fusion ----
function analyzeSync(localState, remoteData) {
  const localIds = new Set(localState.transactions.map(t => t.id));
  const remoteIds = new Set(remoteData.transactions.map(t => t.id));
  const onlyLocal = [...localIds].filter(id => !remoteIds.has(id)).length;
  const onlyRemote = [...remoteIds].filter(id => !localIds.has(id)).length;
  const savedAt = remoteData._savedAt
    ? new Date(remoteData._savedAt).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })
    : 'inconnue';
  const localKey = getFamilyKey();
  const sameFamily = !!(localKey && remoteData._familyKey && localKey === remoteData._familyKey);
  return {
    onlyLocal,
    onlyRemote,
    total: remoteData.transactions.length,
    savedAt,
    deviceName: remoteData._deviceName || 'Appareil inconnu',
    sameFamily,
    familyKey: remoteData._familyKey || null,
  };
}

// ---- Fusion intelligente ----
function mergeStates(localState, remoteData) {
  const txMap = new Map(localState.transactions.map(t => [t.id, t]));
  let added = 0;
  remoteData.transactions.forEach(t => {
    if (!txMap.has(t.id)) { txMap.set(t.id, t); added++; }
  });
  const catMap = new Map(localState.categories.map(c => [c.id, c]));
  remoteData.categories.forEach(c => {
    if (!catMap.has(c.id)) catMap.set(c.id, c);
  });
  const budget = Math.max(
    localState.settings.monthlyBudget || 0,
    remoteData.settings?.monthlyBudget || 0
  );
  return {
    transactions: [...txMap.values()],
    categories: [...catMap.values()],
    settings: { ...localState.settings, monthlyBudget: budget, lastSync: new Date().toISOString() },
    _mergeStats: { added },
  };
}

// ---- Formatage temps ----
function formatSyncTime(iso) {
  if (!iso) return 'Jamais synchronise';
  const dt = new Date(iso);
  const diffMin = Math.floor((Date.now() - dt.getTime()) / 60000);
  if (diffMin < 1) return "Synchronise a l'instant";
  if (diffMin < 60) return 'Synchronise il y a ' + diffMin + ' min';
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return 'Synchronise il y a ' + diffH + 'h';
  const diffD = Math.floor(diffH / 24);
  if (diffD < 7) return 'Synchronise il y a ' + diffD + ' jour' + (diffD > 1 ? 's' : '');
  return 'Derniere sync : ' + dt.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
}

function _downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

// ---- Export public ----
window.SyncModule = {
  platform: _platform,
  platformInfo: _platformInfo,
  instructions: _syncInstructions,
  getDeviceName, setDeviceName,
  getFamilyKey, setFamilyKey, generateFamilyKey,
  syncSave, parseSyncFile, analyzeSync, mergeStates, formatSyncTime,
};

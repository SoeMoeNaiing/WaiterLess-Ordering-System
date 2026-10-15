// Tiny i18n helper. Loads one language JSON, provides t(key) and
// applyTranslations() that rewrites any element with data-i18n="key".

const STORAGE_KEY = 'rs_lang';

let currentLang = 'en';
let currentDict = {};
let fallbackDict = {};

async function fetchDict(code) {
  try {
    const res = await fetch(`/i18n/${code}.json`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (e) {
    console.warn(`[i18n] could not load ${code}:`, e.message);
    return {};
  }
}

async function loadLang(code) {
  currentLang = code;
  currentDict = await fetchDict(code);
  if (code !== 'en') {
    fallbackDict = await fetchDict('en');
  } else {
    fallbackDict = currentDict;
  }
  localStorage.setItem(STORAGE_KEY, code);
}

export function t(key) {
  if (key in currentDict) return currentDict[key];
  if (key in fallbackDict) return fallbackDict[key];
  return key;
}

export function getLang() {
  return currentLang;
}

// Replace text content of any element with data-i18n="<key>".
// Also sets placeholder for inputs with data-i18n-placeholder="<key>".
export function applyTranslations(root = document) {
  root.querySelectorAll('[data-i18n]').forEach((el) => {
    el.textContent = t(el.dataset.i18n);
  });
  root.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
    el.placeholder = t(el.dataset.i18nPlaceholder);
  });
}

export async function initI18n() {
  let lang = localStorage.getItem(STORAGE_KEY);
  if (!lang) {
    try {
      const s = await fetch('/api/public/settings').then((r) => r.json());
      lang = s.default_language || 'en';
    } catch {
      lang = 'en';
    }
  }
  await loadLang(lang);
  applyTranslations();
}

export async function setLang(code) {
  await loadLang(code);
  applyTranslations();
  // Let pages re-render dynamic content that uses t()
  document.dispatchEvent(new CustomEvent('lang-changed', { detail: { lang: code } }));
}

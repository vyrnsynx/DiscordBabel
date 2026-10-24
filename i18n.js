'use strict';

var DB_STYLES = [
  {id: 'code', labelKey: 'styleCode'},
  {id: 'soft', labelKey: 'styleSoft'},
  {id: 'accent', labelKey: 'styleAccent'},
  {id: 'contrast', labelKey: 'styleContrast'},
  {id: 'minimal', labelKey: 'styleMinimal'},
];

var DB_TEXT_COLORS = [
  {id: 'auto', css: '', labelKey: 'colorAuto'},
  {id: 'default', css: 'var(--text-normal, #dbdee1)', labelKey: 'colorDefault'},
  {id: 'blurple', css: '#5865f2', labelKey: 'colorBlurple'},
  {id: 'green', css: '#23a559', labelKey: 'colorGreen'},
  {id: 'orange', css: '#f0b232', labelKey: 'colorOrange'},
  {id: 'yellow', css: '#fee75c', labelKey: 'colorYellow'},
  {id: 'gray', css: '#949ba4', labelKey: 'colorGray'},
  {id: 'white', css: '#ffffff', labelKey: 'colorWhite'},
];

var DB_FONTS = [
  {
    id: 'sans',
    labelKey: 'fontSans',
    css: 'var(--font-primary, "gg sans", "Noto Sans", "Helvetica Neue", Helvetica, Arial, sans-serif)',
  },
  {
    id: 'serif',
    labelKey: 'fontSerif',
    css: 'Georgia, "Times New Roman", "Noto Serif", "Songti SC", "SimSun", serif',
  },
];

function dbLangCodeToLocale(code) {
  if (!code) return 'en';
  return String(code).replace(/-/g, '_');
}

function dbNormalizeLocaleTag(tag) {
  if (!tag) return 'en';
  var t = String(tag).replace(/-/g, '_');
  if (typeof DB_I18N_MESSAGES !== 'undefined' && DB_I18N_MESSAGES[t]) {
    return t;
  }
  var lower = t.toLowerCase();
  if (lower === 'zh_cn' || lower === 'zh_hans' || lower.indexOf('zh_cn') === 0) {
    return 'zh_CN';
  }
  if (lower === 'zh_tw' || lower === 'zh_hk' || lower === 'zh_mo' ||
      lower === 'zh_hant' || lower.indexOf('zh_tw') === 0) {
    return 'zh_TW';
  }
  if (lower.indexOf('zh') === 0) return 'zh_CN';
  if (lower === 'pt_br' || lower.indexOf('pt_br') === 0) return 'pt_BR';
  if (lower === 'pt_pt' || lower.indexOf('pt_pt') === 0) return 'pt_PT';
  if (lower.indexOf('pt') === 0) return 'pt_BR';
  var base = t.split('_')[0];
  var candidates = [base, base.toLowerCase()];
  
  var known = typeof DB_I18N_MESSAGES !== 'undefined' ?
      Object.keys(DB_I18N_MESSAGES) : [];
  for (var i = 0; i < known.length; i++) {
    if (known[i].toLowerCase() === lower ||
        known[i].toLowerCase() === base.toLowerCase()) {
      return known[i];
    }
  }
  for (var j = 0; j < candidates.length; j++) {
    if (DB_I18N_MESSAGES && DB_I18N_MESSAGES[candidates[j]]) {
      return candidates[j];
    }
  }
  return 'en';
}

function dbDetectBrowserLocale() {
  try {
    if (typeof chrome !== 'undefined' && chrome.i18n &&
        chrome.i18n.getUILanguage) {
      return dbNormalizeLocaleTag(chrome.i18n.getUILanguage());
    }
  } catch (e) {
    
  }
  try {
    var nav = (typeof navigator !== 'undefined' && navigator) || {};
    var list = nav.languages && nav.languages.length ?
        nav.languages : [nav.language || nav.userLanguage];
    for (var i = 0; i < list.length; i++) {
      var n = dbNormalizeLocaleTag(list[i]);
      if (n && DB_I18N_MESSAGES && DB_I18N_MESSAGES[n]) return n;
    }
  } catch (e2) {
    
  }
  return 'en';
}

function dbResolveLocale(pref) {
  if (!pref || pref === 'auto') return dbDetectBrowserLocale();
  return dbNormalizeLocaleTag(pref);
}

function dbT(key, vars, locale) {
  var loc = locale || dbResolveLocale('auto');
  var pack = (DB_I18N_MESSAGES && DB_I18N_MESSAGES[loc]) ||
      (DB_I18N_MESSAGES && DB_I18N_MESSAGES.en) || {};
  var text = pack[key] ||
      (DB_I18N_MESSAGES && DB_I18N_MESSAGES.en && DB_I18N_MESSAGES.en[key]) ||
      key;
  if (vars) {
    Object.keys(vars).forEach(function(k) {
      text = text.replace(new RegExp('\\{' + k + '\\}', 'g'), String(vars[k]));
    });
  }
  return text;
}

function dbTextColorCss(id) {
  var row = null;
  for (var i = 0; i < DB_TEXT_COLORS.length; i++) {
    if (DB_TEXT_COLORS[i].id === id) {
      row = DB_TEXT_COLORS[i];
      break;
    }
  }
  return row ? row.css : '';
}

function dbUiLocaleLabel(code, forLocale) {
  if (code === 'auto') return dbT('uiAuto', null, forLocale);
  var langCode = String(code).replace(/_/g, '-');
  if (typeof dbLangDisplayName === 'function') {
    return dbLangDisplayName(langCode, forLocale || 'en');
  }
  if (typeof dbLookupLang === 'function') {
    var row = dbLookupLang(langCode) || dbLookupLang(code);
    if (row) return row.name;
  }
  return code;
}

function dbUiLocaleSecondary(code, forLocale) {
  if (code === 'auto') return '';
  var langCode = String(code).replace(/_/g, '-');
  var native = typeof dbLangNativeName === 'function' ?
      dbLangNativeName(langCode) : '';
  var primary = dbUiLocaleLabel(code, forLocale);
  if (native && native !== primary) return native;
  return '';
}

function dbBuildUiLocales() {
  var list = [{code: 'auto', name: 'Auto', zh: ''}];
  var seen = Object.create(null);
  seen.auto = true;
  if (typeof DB_LANGUAGES !== 'undefined') {
    DB_LANGUAGES.forEach(function(lang) {
      var loc = dbLangCodeToLocale(lang.code);
      if (seen[loc]) return;
      if (!DB_I18N_MESSAGES || !DB_I18N_MESSAGES[loc]) return;
      seen[loc] = true;
      list.push({
        code: loc,
        name: lang.name,
        zh: lang.zh || '',
        langCode: lang.code,
      });
    });
  } else if (DB_I18N_MESSAGES) {
    Object.keys(DB_I18N_MESSAGES).sort().forEach(function(loc) {
      if (loc === 'en' || seen[loc]) return;
      list.push({code: loc, name: loc, zh: ''});
    });
  }
  return list;
}

var DB_I18N_LOCALES = [];

function dbRefreshUiLocales() {
  DB_I18N_LOCALES = dbBuildUiLocales();
  return DB_I18N_LOCALES;
}

dbRefreshUiLocales();

function dbFilterUiLocales(query, uiLocale) {
  var q = String(query || '').trim().toLowerCase();
  var all = DB_I18N_LOCALES.length ? DB_I18N_LOCALES : dbRefreshUiLocales();
  if (!q) return all.slice();
  var loc = uiLocale || 'en';
  return all.filter(function(item) {
    if (item.code === 'auto') {
      return dbT('uiAuto', null, loc).toLowerCase().indexOf(q) >= 0 ||
          'auto'.indexOf(q) >= 0;
    }
    if (item.code.toLowerCase().indexOf(q) >= 0) return true;
    if (item.langCode && item.langCode.toLowerCase().indexOf(q) >= 0) {
      return true;
    }
    if (item.name && item.name.toLowerCase().indexOf(q) >= 0) return true;
    if (item.zh && item.zh.toLowerCase().indexOf(q) >= 0) return true;
    var localized = dbUiLocaleLabel(item.code, loc).toLowerCase();
    return localized.indexOf(q) >= 0;
  });
}

globalThis.DB_STYLES = DB_STYLES;
globalThis.DB_TEXT_COLORS = DB_TEXT_COLORS;
globalThis.DB_FONTS = DB_FONTS;
globalThis.DB_I18N_LOCALES = DB_I18N_LOCALES;
globalThis.dbTextColorCss = dbTextColorCss;
globalThis.dbT = dbT;
globalThis.dbResolveLocale = dbResolveLocale;
globalThis.dbDetectBrowserLocale = dbDetectBrowserLocale;
globalThis.dbNormalizeLocaleTag = dbNormalizeLocaleTag;
globalThis.dbLangCodeToLocale = dbLangCodeToLocale;
globalThis.dbUiLocaleLabel = dbUiLocaleLabel;
globalThis.dbUiLocaleSecondary = dbUiLocaleSecondary;
globalThis.dbBuildUiLocales = dbBuildUiLocales;
globalThis.dbRefreshUiLocales = dbRefreshUiLocales;
globalThis.dbFilterUiLocales = dbFilterUiLocales;

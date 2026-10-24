'use strict';

var DB_LANGUAGES = [
  {code: 'zh-CN', name: '中文（中国）', zh: '中文（中国）', google: 'zh-CN', mm: 'zh-CN', deepl: 'ZH-HANS', edge: 'zh-Hans', volc: 'zh'},
  {code: 'zh-TW', name: '中文（台湾）', zh: '中文（台湾）', google: 'zh-TW', mm: 'zh-TW', deepl: 'ZH-HANT', edge: 'zh-Hant', volc: 'zh-Hant'},
  {code: 'en', name: 'English', zh: '英语', google: 'en', mm: 'en', deepl: 'EN-US', edge: 'en', volc: 'en'},
  {code: 'ja', name: '日本語', zh: '日语', google: 'ja', mm: 'ja', deepl: 'JA', edge: 'ja', volc: 'ja'},
  {code: 'ko', name: '한국어', zh: '韩语', google: 'ko', mm: 'ko', deepl: 'KO', edge: 'ko', volc: 'ko'},
  {code: 'fr', name: 'Français', zh: '法语', google: 'fr', mm: 'fr', deepl: 'FR', edge: 'fr', volc: 'fr'},
  {code: 'de', name: 'Deutsch', zh: '德语', google: 'de', mm: 'de', deepl: 'DE', edge: 'de', volc: 'de'},
  {code: 'es', name: 'Español', zh: '西班牙语', google: 'es', mm: 'es', deepl: 'ES', edge: 'es', volc: 'es'},
  {code: 'pt-BR', name: 'Português (Brasil)', zh: '葡萄牙语（巴西）', google: 'pt', mm: 'pt-BR', deepl: 'PT-BR', edge: 'pt', volc: 'pt'},
  {code: 'pt-PT', name: 'Português (Portugal)', zh: '葡萄牙语（葡萄牙）', google: 'pt-PT', mm: 'pt-PT', deepl: 'PT-PT', edge: 'pt-PT', volc: 'pt'},
  {code: 'ru', name: 'Русский', zh: '俄语', google: 'ru', mm: 'ru', deepl: 'RU', edge: 'ru', volc: 'ru'},
  {code: 'uk', name: 'Українська', zh: '乌克兰语', google: 'uk', mm: 'uk', deepl: 'UK', edge: 'uk', volc: 'uk'},
  {code: 'it', name: 'Italiano', zh: '意大利语', google: 'it', mm: 'it', deepl: 'IT', edge: 'it', volc: 'it'},
  {code: 'nl', name: 'Nederlands', zh: '荷兰语', google: 'nl', mm: 'nl', deepl: 'NL', edge: 'nl', volc: 'nl'},
  {code: 'pl', name: 'Polski', zh: '波兰语', google: 'pl', mm: 'pl', deepl: 'PL', edge: 'pl', volc: 'pl'},
  {code: 'tr', name: 'Türkçe', zh: '土耳其语', google: 'tr', mm: 'tr', deepl: 'TR', edge: 'tr', volc: 'tr'},
  {code: 'ar', name: 'العربية', zh: '阿拉伯语', google: 'ar', mm: 'ar', deepl: 'AR', edge: 'ar', volc: 'ar'},
  {code: 'hi', name: 'हिन्दी', zh: '印地语', google: 'hi', mm: 'hi', deepl: 'HI', edge: 'hi', volc: 'hi'},
  {code: 'th', name: 'ไทย', zh: '泰语', google: 'th', mm: 'th', deepl: 'TH', edge: 'th', volc: false},
  {code: 'vi', name: 'Tiếng Việt', zh: '越南语', google: 'vi', mm: 'vi', deepl: 'VI', edge: 'vi', volc: 'vi'},
  {code: 'id', name: 'Indonesia', zh: '印尼语', google: 'id', mm: 'id', deepl: 'ID', edge: 'id', volc: 'id'},
  {code: 'ms', name: 'Melayu', zh: '马来语', google: 'ms', mm: 'ms', deepl: 'MS', edge: 'ms', volc: 'ms'},
  {code: 'cs', name: 'Čeština', zh: '捷克语', google: 'cs', mm: 'cs', deepl: 'CS', edge: 'cs', volc: 'cs'},
  {code: 'sv', name: 'Svenska', zh: '瑞典语', google: 'sv', mm: 'sv', deepl: 'SV', edge: 'sv', volc: 'sv'},
  {code: 'da', name: 'Dansk', zh: '丹麦语', google: 'da', mm: 'da', deepl: 'DA', edge: 'da', volc: 'da'},
  {code: 'fi', name: 'Suomi', zh: '芬兰语', google: 'fi', mm: 'fi', deepl: 'FI', edge: 'fi', volc: 'fi'},
  {code: 'no', name: 'Norsk', zh: '挪威语', google: 'nb', mm: 'nb', deepl: 'NB', edge: 'nb', volc: 'nb'},
  {code: 'ro', name: 'Română', zh: '罗马尼亚语', google: 'ro', mm: 'ro', deepl: 'RO', edge: 'ro', volc: 'ro'},
  {code: 'hu', name: 'Magyar', zh: '匈牙利语', google: 'hu', mm: 'hu', deepl: 'HU', edge: 'hu', volc: 'hu'},
  {code: 'el', name: 'Ελληνικά', zh: '希腊语', google: 'el', mm: 'el', deepl: 'EL', edge: 'el', volc: 'el'},
  {code: 'he', name: 'עברית', zh: '希伯来语', google: 'he', mm: 'he', deepl: 'HE', edge: 'he', volc: 'he'},
  {code: 'bg', name: 'Български', zh: '保加利亚语', google: 'bg', mm: 'bg', deepl: 'BG', edge: 'bg', volc: 'bg'},
  {code: 'sk', name: 'Slovenčina', zh: '斯洛伐克语', google: 'sk', mm: 'sk', deepl: 'SK', edge: 'sk', volc: 'sk'},
  {code: 'sl', name: 'Slovenščina', zh: '斯洛文尼亚语', google: 'sl', mm: 'sl', deepl: 'SL', edge: 'sl', volc: 'sl'},
  {code: 'hr', name: 'Hrvatski', zh: '克罗地亚语', google: 'hr', mm: 'hr', deepl: 'HR', edge: 'hr', volc: 'hr'},
  {code: 'lt', name: 'Lietuvių', zh: '立陶宛语', google: 'lt', mm: 'lt', deepl: 'LT', edge: 'lt', volc: 'lt'},
  {code: 'lv', name: 'Latviešu', zh: '拉脱维亚语', google: 'lv', mm: 'lv', deepl: 'LV', edge: 'lv', volc: 'lv'},
  {code: 'et', name: 'Eesti', zh: '爱沙尼亚语', google: 'et', mm: 'et', deepl: 'ET', edge: 'et', volc: 'et'},
  {code: 'af', name: 'Afrikaans', zh: '南非荷兰语', google: 'af', mm: 'af', deepl: 'AF', edge: 'af', volc: 'af'},
  {code: 'am', name: 'አማርኛ', zh: '阿姆哈拉语', google: 'am', mm: 'am', deepl: false, edge: 'am', volc: 'am'},
  {code: 'bn', name: 'বাংলা', zh: '孟加拉语', google: 'bn', mm: 'bn', deepl: 'BN', edge: 'bn', volc: 'bn'},
  {code: 'fa', name: 'فارسی', zh: '波斯语', google: 'fa', mm: 'fa', deepl: 'FA', edge: 'fa', volc: 'fa'},
  {code: 'fil', name: 'Filipino', zh: '菲律宾语', google: 'tl', mm: 'tl', deepl: 'TL', edge: 'fil', volc: 'tl'},
  {code: 'sw', name: 'Kiswahili', zh: '斯瓦希里语', google: 'sw', mm: 'sw', deepl: 'SW', edge: 'sw', volc: 'sw'},
  {code: 'ca', name: 'Català', zh: '加泰罗尼亚语', google: 'ca', mm: 'ca', deepl: 'CA', edge: 'ca', volc: 'ca'},
];

var DB_TOKENDANCE_BASE = 'https://tokendance.space/gateway/v1';

var DB_TOKENDANCE_MODELS = [
  'deepseek-v4-flash-0731',
  'deepseek-v4-flash',
  'deepseek-v4.1-flash',
  'deepseek-v4-pro',
  'kimi-k2.7-code',
  'kimi-k2.6',
  'glm-5.3',
  'glm-5.3-flash',
  'minimax-m3',
  'seed-2.0-code',
  'qwen3.8-flash',
  'qwen3.7-plus',
  'step-3.7-flash',
  'mimo-v2.6-flash',
];

var DB_AI_PROVIDERS = [
  {
    id: 'tokendance',
    name: 'TokenDance',
    baseUrl: DB_TOKENDANCE_BASE,
    oauth: true,
    liveModels: true,
    models: DB_TOKENDANCE_MODELS.slice(),
  },
  {
    id: 'kimi',
    name: 'Kimi',
    baseUrl: 'https://api.moonshot.cn/v1',
    models: ['kimi-k2.5', 'kimi-k2.6', 'kimi-k3', 'kimi-k3.1-pro', 'moonshot-v1-auto'],
  },
  {
    id: 'kimi-intl',
    name: 'Kimi International',
    nameZh: 'Kimi 国际',
    baseUrl: 'https://api.moonshot.ai/v1',
    models: ['kimi-k2.5', 'kimi-k2.6', 'kimi-k3', 'kimi-k3.1-pro', 'moonshot-v1-auto'],
  },
  {
    id: 'zhipu',
    name: 'Zhipu GLM',
    nameZh: '智谱 GLM',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    models: ['glm-5.3', 'glm-5.3-flash', 'glm-5.2', 'glm-5', 'glm-4.7', 'glm-4.5-air'],
  },
  {
    id: 'zhipu-intl',
    name: 'Zhipu GLM International',
    nameZh: '智谱 GLM 国际',
    baseUrl: 'https://api.z.ai/api/paas/v4',
    models: ['glm-5.3', 'glm-5.3-flash', 'glm-5.2', 'glm-5', 'glm-4.7', 'glm-4.5-air'],
  },
  {
    id: 'minimax',
    name: 'MiniMax',
    baseUrl: 'https://api.minimax.cn/v1',
    models: ['MiniMax-M3.1-Flash', 'MiniMax-M3', 'MiniMax-M2.7', 'MiniMax-M2.5'],
  },
  {
    id: 'minimax-intl',
    name: 'MiniMax International',
    nameZh: 'MiniMax 国际',
    baseUrl: 'https://api.minimax.io/v1',
    models: ['MiniMax-M3.1-Flash', 'MiniMax-M3', 'MiniMax-M2.7', 'MiniMax-M2.5'],
  },
  {
    id: 'stepfun',
    name: 'StepFun',
    nameZh: '阶跃星辰',
    baseUrl: 'https://api.stepfun.com/v1',
    models: ['step-5-preview', 'step-3.7-flash', 'step-3.5-flash'],
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    models: ['deepseek-flash', 'deepseek-v4-pro'],
  },
  {
    id: 'qwen',
    name: 'Qwen',
    nameZh: '通义千问',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    models: ['qwen-turbo', 'qwen-plus', 'qwen-max', 'qwen-turbo-latest', 'qwen-plus-latest'],
  },
  {
    id: 'qwen-intl',
    name: 'Qwen International',
    nameZh: '通义千问 国际',
    baseUrl: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
    models: ['qwen-turbo', 'qwen-plus', 'qwen-max', 'qwen-turbo-latest', 'qwen-plus-latest'],
  },
  {
    id: 'openai',
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    models: ['gpt-6-luna', 'gpt-6.1-sol', 'gpt-6-astra'],
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    baseUrl: 'https://api.anthropic.com/v1',
    models: ['claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-opus-5-5'],
  },
  {
    id: 'gemini',
    name: 'Gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    models: ['gemini-3.8-flash', 'gemini-3.5-flash-lite', 'gemini-2.5-flash'],
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    models: [
      'openrouter/free',
      'deepseek/deepseek-v4.1-flash-1017',
      'openai/gpt-6-luna',
      'anthropic/claude-haiku-5.5',
      'anthropic/claude-sonnet-5.5',
      'google/gemini-3.8-flash',
    ],
  },
  {
    id: 'ollama',
    name: 'Ollama',
    baseUrl: 'http://localhost:11434/v1',
    models: ['llama3.2', 'llama3.3', 'qwen2.5', 'qwen3', 'mistral', 'gemma3'],
  },
];

function dbIsTokenDanceProvider(idOrUrl) {
  var s = String(idOrUrl || '');
  if (s === 'tokendance' || s.indexOf('tokendance-') === 0) return true;
  return /tokendance\.space/i.test(s);
}

function dbNormalizeAiProviderId(id) {
  var s = String(id || '');
  if (s.indexOf('tokendance-') === 0) return 'tokendance';
  return s;
}

function dbFindAiProvider(id) {
  for (var i = 0; i < DB_AI_PROVIDERS.length; i++) {
    if (DB_AI_PROVIDERS[i].id === id) return DB_AI_PROVIDERS[i];
  }
  return null;
}

function dbProviderDisplayName(provider, locale) {
  if (!provider) return '';
  var loc = String(locale || '').replace('-', '_');
  if (/^zh/i.test(loc) && provider.nameZh) return provider.nameZh;
  return provider.name || '';
}

var DB_LANG_BY_CODE = (function() {
  var map = Object.create(null);
  for (var i = 0; i < DB_LANGUAGES.length; i++) {
    map[DB_LANGUAGES[i].code] = DB_LANGUAGES[i];
  }
  return map;
})();

function dbLookupLang(code) {
  if (!code) return null;
  if (DB_LANG_BY_CODE[code]) return DB_LANG_BY_CODE[code];
  var base = String(code).split('-')[0].toLowerCase();
  for (var i = 0; i < DB_LANGUAGES.length; i++) {
    var c = DB_LANGUAGES[i].code;
    if (c === base || c.toLowerCase().indexOf(base + '-') === 0) {
      return DB_LANGUAGES[i];
    }
  }
  return null;
}

function dbLangNativeName(code) {
  var row = dbLookupLang(code);
  return row ? row.name : (code || '');
}

function dbLangDisplayName(code, uiLocale) {
  if (!code) return '';
  var tag = String(code).replace(/_/g, '-');
  var loc = String(uiLocale || 'en').replace(/_/g, '-');
  try {
    if (typeof Intl !== 'undefined' && Intl.DisplayNames) {
      var label = new Intl.DisplayNames([loc], {type: 'language'}).of(tag);
      if (label) return label;
    }
  } catch (e) {
    
  }
  return dbLangNativeName(code);
}

function dbLangName(code, uiLocale) {
  if (uiLocale) return dbLangDisplayName(code, uiLocale);
  return dbLangNativeName(code);
}

function dbProviderCode(code, field, fallback) {
  var row = dbLookupLang(code);
  if (row && row[field]) return row[field];
  return fallback;
}

function dbGoogleCode(code) { return dbProviderCode(code, 'google', 'en'); }
function dbMyMemoryCode(code) { return dbProviderCode(code, 'mm', 'en'); }
function dbDeeplCode(code) { return dbProviderCode(code, 'deepl', 'EN'); }
function dbEdgeCode(code) { return dbProviderCode(code, 'edge', 'en'); }
function dbVolcCode(code) { return dbProviderCode(code, 'volc', 'en'); }

function dbFilterLangs(query, uiLocale) {
  var q = String(query || '').trim().toLowerCase();
  if (!q) return DB_LANGUAGES.slice();
  return DB_LANGUAGES.filter(function(lang) {
    if (lang.name.toLowerCase().indexOf(q) >= 0) return true;
    if (lang.zh && lang.zh.toLowerCase().indexOf(q) >= 0) return true;
    if (lang.code.toLowerCase().indexOf(q) >= 0) return true;
    if (uiLocale) {
      var localized = dbLangDisplayName(lang.code, uiLocale).toLowerCase();
      if (localized.indexOf(q) >= 0) return true;
    }
    return false;
  });
}

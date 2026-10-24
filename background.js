'use strict';

importScripts('languages.js');

var FREE_TIMEOUT_MS = 8000;
var ALT_TIMEOUT_MS = 20000;
var AI_TIMEOUT_MS = 30000;
var COALESCE_MS = 8000;
var COALESCE_MAX = 200;
var EDGE_ORIGIN = 'https://edge.microsoft.com';
var VOLC_ORIGIN = 'https://translate.volcengine.com';

var inflight = new Map();
var memo = new Map();
var syncDefaults = {
  enabled: true,
  targetLanguage: 'en',
  understoodMode: 'mine',
  understoodLanguages: [],
  translationStyle: 'code',
  textColor: 'auto',
  textFont: 'sans',
  uiLanguage: 'auto',
  outgoingEnabled: false,
  outgoingLanguage: 'en',
  displayMode: 'append',
  service: 'free',
  theme: 'auto',
  aiBaseUrl: '',
  aiModel: '',
  aiProviderId: '',
  deeplKeyPresent: false,
  aiKeyPresent: false,
};

function timeoutSignal(ms) {
  if (typeof AbortSignal !== 'undefined' && AbortSignal.timeout) {
    return AbortSignal.timeout(ms);
  }
  var ctrl = new AbortController();
  setTimeout(function() { ctrl.abort(); }, ms);
  return ctrl.signal;
}

function laneOf(msg) {
  return msg && msg.outgoing ? 'out' : 'in';
}

function coalesce(key, lane, run) {
  var now = Date.now();
  var hit = memo.get(key);
  if (hit && now - hit.at < COALESCE_MS) {
    return Promise.resolve(Object.assign({}, hit.result, {memo: true}));
  }
  var flightKey = lane + '\0' + key;
  var flying = inflight.get(flightKey);
  if (flying) {
    return flying.then(function(r) {
      return Object.assign({}, r, {shared: true});
    });
  }
  var p = Promise.resolve()
      .then(run)
      .catch(function() { return {ok: false, error: 'network'}; })
      .then(function(result) {
        inflight.delete(flightKey);
        if (result && result.ok) {
          memo.set(key, {at: Date.now(), result: result});
          while (memo.size > COALESCE_MAX) {
            memo.delete(memo.keys().next().value);
          }
        }
        return result;
      });
  inflight.set(flightKey, p);
  return p;
}

async function hasOrigin(origin) {
  return chrome.permissions.contains({origins: [origin + '/*']});
}

async function googleFetch(q, sl, tl) {
  var url = 'https://translate.googleapis.com/translate_a/single?client=gtx' +
      '&sl=' + encodeURIComponent(sl || 'auto') +
      '&tl=' + encodeURIComponent(tl) +
      '&dt=t&q=' + encodeURIComponent(q);
  try {
    var res = await fetch(url, {
      signal: timeoutSignal(FREE_TIMEOUT_MS),
      redirect: 'manual',
    });
    if (res.type === 'opaqueredirect' || res.status === 0) {
      return {ok: false, error: 'redirect'};
    }
    if (!res.ok) return {ok: false, error: 'http-' + res.status};
    var data = await res.json();
    if (!Array.isArray(data) || !Array.isArray(data[0])) {
      return {ok: false, error: 'empty'};
    }
    var text = data[0].map(function(row) { return row[0]; }).join('');
    if (!text) return {ok: false, error: 'empty'};
    return {ok: true, text: text, via: 'google'};
  } catch (e) {
    return {ok: false, error: 'network'};
  }
}

async function mymemoryFetch(q, langpair) {
  var url = 'https://api.mymemory.translated.net/get?q=' +
      encodeURIComponent(q) + '&langpair=' + encodeURIComponent(langpair);
  try {
    var res = await fetch(url, {signal: timeoutSignal(FREE_TIMEOUT_MS)});
    if (!res.ok) return {ok: false, error: 'http-' + res.status};
    var data = await res.json();
    var body = data && data.responseData;
    var text = body && body.translatedText;
    var status = Number(data && data.responseStatus);
    if (!text || (status && status !== 200)) {
      return {ok: false, error: 'empty'};
    }
    return {ok: true, text: text, via: 'mymemory'};
  } catch (e) {
    return {ok: false, error: 'network'};
  }
}

async function freeTranslate(message) {
  var text = String(message.text || '');
  var target = String(message.targetLang || 'en');
  var source = String(message.sourceLang || 'auto');
  var gTl = dbGoogleCode(target);
  var gSl = source === 'auto' ? 'auto' : dbGoogleCode(source);
  var key = 'free\0' + gSl + '\0' + gTl + '\0' + text;
  return coalesce(key, laneOf(message), async function() {
    var g = await googleFetch(text, gSl, gTl);
    if (g.ok) return g;
    var mmTl = dbMyMemoryCode(target);
    var mmSl = source === 'auto' ? 'Autodetect' : dbMyMemoryCode(source);
    var mm = await mymemoryFetch(text, mmSl + '|' + mmTl);
    if (mm.ok) return mm;
    return g.error ? g : mm;
  });
}

async function edgeFetch(q, tl) {
  if (!(await hasOrigin(EDGE_ORIGIN))) return {ok: false, error: 'no-permission'};
  try {
    var res = await fetch(
        EDGE_ORIGIN + '/translate/translatetext?from=&to=' +
        encodeURIComponent(tl),
        {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify([String(q)]),
          signal: timeoutSignal(ALT_TIMEOUT_MS),
        });
    if (res.status === 429) return {ok: false, error: 'rate-limit'};
    if (!res.ok) return {ok: false, error: 'http-' + res.status};
    var data = await res.json();
    var text = null;
    if (Array.isArray(data)) {
      var first = data[0];
      if (typeof first === 'string') text = first;
      else if (first && first.translations && first.translations[0]) {
        text = first.translations[0].text;
      } else if (first && first.text) {
        text = first.text;
      }
    } else if (data && typeof data.translation === 'string') {
      text = data.translation;
    }
    if (!text) return {ok: false, error: 'empty'};
    return {ok: true, text: text, via: 'edge'};
  } catch (e) {
    return {ok: false, error: 'network'};
  }
}

async function volcFetch(q, sl, tl) {
  if (!(await hasOrigin(VOLC_ORIGIN))) return {ok: false, error: 'no-permission'};
  try {
    var body = {target_language: String(tl), text: String(q)};
    if (sl && sl !== 'auto') body.source_language = String(sl);
    var res = await fetch(VOLC_ORIGIN + '/crx/translate/v1/', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(body),
      signal: timeoutSignal(ALT_TIMEOUT_MS),
    });
    if (res.status === 429) return {ok: false, error: 'rate-limit'};
    if (!res.ok) return {ok: false, error: 'http-' + res.status};
    var data = await res.json();
    var code = data && data.base_resp && data.base_resp.status_code;
    var text = data && data.translation;
    if (code !== 0 || typeof text !== 'string' || !text) {
      return {ok: false, error: 'empty'};
    }
    return {ok: true, text: text, via: 'volc'};
  } catch (e) {
    return {ok: false, error: 'network'};
  }
}

async function edgeVolcTranslate(message) {
  var text = String(message.text || '');
  var target = String(message.targetLang || 'en');
  var source = String(message.sourceLang || 'auto');
  var edgeTl = dbEdgeCode(target);
  var volcTl = dbVolcCode(target);
  var volcSl = source === 'auto' ? 'auto' : dbVolcCode(source);
  var key = 'edgevolc\0' + edgeTl + '\0' + text;
  return coalesce(key, laneOf(message), async function() {
    var edge = await edgeFetch(text, edgeTl);
    if (edge.ok) return edge;
    var volc = await volcFetch(text, volcSl, volcTl);
    if (volc.ok) return volc;
    return edge.error === 'no-permission' ? edge : volc;
  });
}

function deeplEndpoint(apiKey) {
  return String(apiKey).endsWith(':fx') ?
      'https://api-free.deepl.com' : 'https://api.deepl.com';
}

async function resolveDeeplKey() {
  try {
    var data = await chrome.storage.local.get(['deeplKey']);
    return data.deeplKey || '';
  } catch (e) {
    return null;
  }
}

async function deeplTranslate(message) {
  var apiKey = await resolveDeeplKey();
  if (apiKey === null) return {ok: false, error: 'network'};
  if (!apiKey) return {ok: false, error: 'no-key'};
  var text = String(message.text || '');
  var target = dbDeeplCode(message.targetLang || 'EN');
  var source = message.sourceLang && message.sourceLang !== 'auto' ?
      dbDeeplCode(message.sourceLang) : '';
  var key = 'deepl\0' + source + '\0' + target + '\0' + text;
  return coalesce(key, laneOf(message), async function() {
    var origin = deeplEndpoint(apiKey);
    if (!(await hasOrigin(origin))) return {ok: false, error: 'no-permission'};
    try {
      var body = {text: [text], target_lang: target};
      if (source) body.source_lang = String(source).split('-')[0];
      var res = await fetch(origin + '/v2/translate', {
        method: 'POST',
        headers: {
          'Authorization': 'DeepL-Auth-Key ' + apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: timeoutSignal(FREE_TIMEOUT_MS),
      });
      if (res.status === 403 || res.status === 456) {
        return {ok: false, error: 'rejected'};
      }
      if (!res.ok) return {ok: false, error: 'http-' + res.status};
      var data = await res.json();
      var t = data && data.translations && data.translations[0] &&
          data.translations[0].text;
      if (!t) return {ok: false, error: 'empty'};
      return {ok: true, text: t, via: 'deepl'};
    } catch (e) {
      return {ok: false, error: 'network'};
    }
  });
}

async function resolveAiKey(baseUrl) {
  try {
    var data = await chrome.storage.local.get(['aiKeys']);
    var keys = data.aiKeys || {};
    var origin = '';
    try {
      origin = new URL(baseUrl).origin;
    } catch (e) {
      return {key: '', reason: 'bad-url'};
    }
    if (keys[origin]) return {key: keys[origin], reason: 'ok'};
    if (/localhost|127\.0\.0\.1/i.test(baseUrl)) {
      return {key: '', reason: 'none'};
    }
    return {key: '', reason: 'no-key'};
  } catch (e) {
    return {key: '', reason: 'read-fail'};
  }
}

function normalizeAiBaseUrl(url) {
  var u = String(url || '').trim().replace(/\/+$/, '');
  if (!u) return '';
  if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
  return u;
}

function isTokenDanceUrl(url) {
  return /tokendance\.space/i.test(String(url || ''));
}

function tokenDanceRecoveryError(res) {
  var action = '';
  try {
    action = String(res.headers.get('TokenDance-Recovery-Action') || '');
  } catch (e) {
    action = '';
  }
  if (action === 'top_up_balance') return 'td-top-up';
  if (action === 'reauthorize_api_key') return 'td-reauth';
  if (action === 'api_key_quota') return 'td-quota';
  return '';
}

async function saveAiKeyForBase(baseUrl, aiKey) {
  var base = normalizeAiBaseUrl(baseUrl);
  var data = await chrome.storage.local.get(['aiKeys']);
  var keys = data.aiKeys || {};
  var origin = new URL(base).origin;
  if (aiKey) keys[origin] = aiKey;
  else delete keys[origin];
  await chrome.storage.local.set({aiKeys: keys});
  return origin;
}

async function pkceChallenge(verifier) {
  var digest = await crypto.subtle.digest(
      'SHA-256', new TextEncoder().encode(verifier));
  var bytes = new Uint8Array(digest);
  var bin = '';
  for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function makePkceVerifier() {
  var a = crypto.randomUUID().replace(/-/g, '');
  var b = crypto.randomUUID().replace(/-/g, '');
  return (a + b).slice(0, 64);
}

async function tokendanceOAuthStart() {
  var verifier = makePkceVerifier();
  var challenge = await pkceChallenge(verifier);
  await chrome.storage.session.set({
    tdOauthVerifier: verifier,
    tdOauthAt: Date.now(),
  });
  var url = 'https://tokendance.space/auth' +
      '?code_challenge=' + encodeURIComponent(challenge) +
      '&code_challenge_method=S256' +
      '&app_url=' + encodeURIComponent('app://discord-babel') +
      '&key_name=' + encodeURIComponent('DiscordBabel');
  await chrome.tabs.create({url: url, active: true});
  return {ok: true};
}

async function tokendanceOAuthExchange(code) {
  var raw = String(code || '').trim();
  if (!raw) return {ok: false, error: 'no-code'};
  var sess = await chrome.storage.session.get(['tdOauthVerifier', 'tdOauthAt']);
  var verifier = String(sess.tdOauthVerifier || '');
  if (!verifier) return {ok: false, error: 'no-verifier'};
  if (sess.tdOauthAt && Date.now() - sess.tdOauthAt > 15 * 60 * 1000) {
    return {ok: false, error: 'expired'};
  }
  if (!(await hasOrigin('https://tokendance.space'))) {
    return {ok: false, error: 'no-permission'};
  }
  try {
    var res = await fetch('https://tokendance.space/portal/api/v1/auth/keys', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({
        code: raw,
        code_verifier: verifier,
        code_challenge_method: 'S256',
      }),
      signal: timeoutSignal(20000),
    });
    if (!res.ok) {
      return {ok: false, error: 'http-' + res.status};
    }
    var data = await res.json();
    var key = data && data.key ? String(data.key).trim() : '';
    if (!key) return {ok: false, error: 'empty'};
    await saveAiKeyForBase('https://tokendance.space/gateway/v1', key);
    await chrome.storage.session.remove(['tdOauthVerifier', 'tdOauthAt']);
    await chrome.storage.sync.set({
      aiBaseUrl: 'https://tokendance.space/gateway/v1',
      aiKeyPresent: true,
    });
    return {ok: true};
  } catch (e) {
    return {ok: false, error: 'network'};
  }
}

async function tokendanceFetchModels() {
  if (!(await hasOrigin('https://tokendance.space'))) {
    return {ok: false, error: 'no-permission'};
  }
  try {
    var res = await fetch('https://tokendance.space/gateway/v1/models', {
      signal: timeoutSignal(20000),
    });
    if (!res.ok) return {ok: false, error: 'http-' + res.status};
    var data = await res.json();
    var list = Array.isArray(data && data.data) ? data.data : [];
    var models = [];
    for (var i = 0; i < list.length; i++) {
      var m = list[i];
      if (!m || !m.id) continue;
      var protocols = m.supported_protocols || [];
      var chat = false;
      for (var j = 0; j < protocols.length; j++) {
        if (String(protocols[j]).indexOf('chat-completions') >= 0) {
          chat = true;
          break;
        }
      }
      if (!chat) continue;
      // Skip TTS / voice / OCR / search-only models for translation UX.
      if (/tts|voice|ocr|unifuncs|cogevol|spark-x|dots-3/i.test(m.id)) continue;
      models.push({
        id: String(m.id),
        name: String(m.name || m.id),
      });
    }
    await chrome.storage.local.set({
      tokendanceModels: models,
      tokendanceModelsAt: Date.now(),
    });
    return {ok: true, models: models};
  } catch (e) {
    return {ok: false, error: 'network'};
  }
}

async function aiTranslate(message) {
  var baseUrl = normalizeAiBaseUrl(message.baseUrl);
  if (!baseUrl) return {ok: false, error: 'no-key'};
  var resolved = await resolveAiKey(baseUrl);
  if (resolved.reason === 'read-fail') return {ok: false, error: 'network'};
  if (resolved.reason === 'no-key' || resolved.reason === 'bad-url') {
    return {ok: false, error: 'no-key'};
  }
  var text = String(message.text || '');
  var target = String(message.targetLang || 'en');
  var model = String(message.model || '');
  var key = 'ai\0' + baseUrl + '\0' + model + '\0' + target + '\0' + text;
  return coalesce(key, laneOf(message), async function() {
    var origin = new URL(baseUrl).origin;
    if (!(await hasOrigin(origin))) return {ok: false, error: 'no-permission'};
    var endpoint = /\/chat\/completions$/i.test(baseUrl) ?
        baseUrl : (baseUrl + '/chat/completions');
    var headers = {'Content-Type': 'application/json'};
    if (resolved.key) headers['Authorization'] = 'Bearer ' + resolved.key;
    if (isTokenDanceUrl(baseUrl)) {
      headers['X-App-URL'] = 'app://discord-babel';
    }
    var system = 'Translate the user message into ' + target +
        '. Output only the translation, no quotes or notes.';
    try {
      var res = await fetch(endpoint, {
        method: 'POST',
        headers: headers,
        body: JSON.stringify({
          model: model || 'gpt-4o-mini',
          temperature: 0,
          messages: [
            {role: 'system', content: system},
            {role: 'user', content: text},
          ],
        }),
        signal: timeoutSignal(AI_TIMEOUT_MS),
      });
      var recovery = tokenDanceRecoveryError(res);
      if (recovery) return {ok: false, error: recovery};
      if (res.status === 401 || res.status === 403) {
        return {ok: false, error: 'rejected'};
      }
      if (!res.ok) return {ok: false, error: 'http-' + res.status};
      var data = await res.json();
      var content = data && data.choices && data.choices[0] &&
          data.choices[0].message && data.choices[0].message.content;
      if (!content || typeof content !== 'string') {
        return {ok: false, error: 'empty'};
      }
      return {ok: true, text: content.trim(), via: 'ai'};
    } catch (e) {
      return {ok: false, error: 'network'};
    }
  });
}

async function ensureSyncDefaults() {
  var data = await chrome.storage.sync.get(null);
  var patch = {};
  Object.keys(syncDefaults).forEach(function(k) {
    if (data[k] === undefined) patch[k] = syncDefaults[k];
  });
  if (Object.keys(patch).length) await chrome.storage.sync.set(patch);
}

function discordPatterns() {
  return [
    'https://discord.com/*',
    'https://ptb.discord.com/*',
    'https://canary.discord.com/*',
  ];
}

async function injectIntoTab(tabId) {
  await chrome.scripting.executeScript({
    target: {tabId: tabId},
    files: ['languages.js', 'i18n-messages.js', 'i18n.js', 'hotkeys.js', 'content.js'],
  });
  await chrome.scripting.insertCSS({
    target: {tabId: tabId},
    files: ['styles.css'],
  });
  await chrome.scripting.executeScript({
    target: {tabId: tabId},
    files: ['page-bridge.js'],
    world: 'MAIN',
  });
}

async function reloadDiscordTabs(tabIds) {
  var tabs = await chrome.tabs.query({url: discordPatterns()});
  var want = tabIds && tabIds.length ?
      new Set(tabIds.filter(function(id) { return Number.isInteger(id); })) :
      null;
  for (var i = 0; i < tabs.length; i++) {
    var tab = tabs[i];
    if (!tab.id) continue;
    if (want && !want.has(tab.id)) continue;
    try {
      await chrome.tabs.reload(tab.id);
    } catch (e) {
      
    }
  }
}

async function primeOpenDiscordTabs(tabIds) {
  var tabs = await chrome.tabs.query({url: discordPatterns()});
  var want = tabIds && tabIds.length ?
      new Set(tabIds.filter(function(id) { return Number.isInteger(id); })) :
      null;
  for (var i = 0; i < tabs.length; i++) {
    var tab = tabs[i];
    if (!tab.id) continue;
    if (want && !want.has(tab.id)) continue;
    try {
      await injectIntoTab(tab.id);
    } catch (e) {
      
    }
  }
}

chrome.runtime.onInstalled.addListener(function(details) {
  ensureSyncDefaults().then(function() {
    
    return reloadDiscordTabs();
  });
  if (details.reason === 'install') {
    chrome.tabs.create({url: 'https://discord.com/app'});
  }
});

chrome.runtime.onStartup.addListener(function() {
  
  primeOpenDiscordTabs();
});

chrome.runtime.onMessage.addListener(function(message, sender, sendResponse) {
  if (!message || typeof message !== 'object') return;
  var type = message.type;

  if (type === 'db-ping') {
    sendResponse({ok: true, version: chrome.runtime.getManifest().version});
    return;
  }
  if (type === 'db-prime-tabs') {
    var ids = Array.isArray(message.tabIds) ? message.tabIds : null;
    
    reloadDiscordTabs(ids).then(function() {
      sendResponse({ok: true});
    });
    return true;
  }
  if (type === 'free-translate') {
    freeTranslate(message).then(sendResponse);
    return true;
  }
  if (type === 'edgevolc-translate') {
    edgeVolcTranslate(message).then(sendResponse);
    return true;
  }
  if (type === 'deepl-translate') {
    deeplTranslate(message).then(sendResponse);
    return true;
  }
  if (type === 'ai-translate') {
    aiTranslate(message).then(sendResponse);
    return true;
  }
  if (type === 'save-deepl-key') {
    var key = String(message.key || '').trim();
    chrome.storage.local.set({deeplKey: key}).then(function() {
      return chrome.storage.sync.set({deeplKeyPresent: !!key});
    }).then(function() {
      sendResponse({ok: true});
    });
    return true;
  }
  if (type === 'save-ai-key') {
    var base = normalizeAiBaseUrl(message.baseUrl);
    var aiKey = String(message.key || '').trim();
    var keepExisting = !!message.keepExisting;
    chrome.storage.local.get(['aiKeys']).then(function(data) {
      var keys = data.aiKeys || {};
      var origin;
      try {
        origin = new URL(base).origin;
        if (aiKey) keys[origin] = aiKey;
        else if (!keepExisting) delete keys[origin];
      } catch (e) {
        sendResponse({ok: false, error: 'bad-url'});
        return;
      }
      var present = !!keys[origin] || /localhost|127\.0\.0\.1/i.test(base);
      return chrome.storage.local.set({aiKeys: keys}).then(function() {
        return chrome.storage.sync.set({
          aiBaseUrl: base,
          aiModel: String(message.model || ''),
          aiProviderId: String(message.providerId || ''),
          aiKeyPresent: present,
        });
      }).then(function() {
        sendResponse({ok: true, keyPresent: present});
      });
    });
    return true;
  }
  if (type === 'tokendance-oauth-start') {
    tokendanceOAuthStart().then(sendResponse);
    return true;
  }
  if (type === 'tokendance-oauth-exchange') {
    tokendanceOAuthExchange(message.code).then(sendResponse);
    return true;
  }
  if (type === 'tokendance-fetch-models') {
    tokendanceFetchModels().then(sendResponse);
    return true;
  }
  if (type === 'request-permission') {
    var origins = Array.isArray(message.origins) ? message.origins : [];
    chrome.permissions.request({origins: origins}).then(function(granted) {
      sendResponse({ok: granted});
    });
    return true;
  }
});

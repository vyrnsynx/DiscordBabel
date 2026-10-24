'use strict';

(function() {
  var BOOT = 235;
  if (window.__discordBabelLoaded === BOOT) return;
  if (window.__dbCleanup) {
    try { window.__dbCleanup(); } catch (e) {  }
  }
  window.__discordBabelLoaded = BOOT;
  try {
    console.info('[DiscordBabel] content boot', BOOT, chrome.runtime.getManifest().version);
  } catch (e) {
    console.info('[DiscordBabel] content boot', BOOT);
  }

  var settings = {
    enabled: true,
    targetLanguage: 'en',
    understoodMode: 'mine',
    understoodLanguages: [],
    translationStyle: 'code',
    textColor: 'auto',
    textFont: 'sans',
    uiLanguage: 'auto',
    theme: 'auto',
    outgoingEnabled: false,
    outgoingLanguage: 'en',
    displayMode: 'append',
    service: 'free',
    aiBaseUrl: '',
    aiModel: '',
    deeplKeyPresent: false,
    aiKeyPresent: false,
  };

  function resolveTheme() {
    if (settings.theme === 'dark' || settings.theme === 'light') {
      return settings.theme;
    }
    try {
      return matchMedia('(prefers-color-scheme: dark)').matches ?
          'dark' : 'light';
    } catch (e) {
      return 'dark';
    }
  }

  function formatError(err) {
    var code = String(err || 'unavailable');
    var mapped = t(code);
    return mapped && mapped !== code ? mapped : code;
  }

  
  var TEXT_COLOR_CSS = {
    auto: '',
    default: 'var(--text-normal, #dbdee1)',
    blurple: '#5865f2',
    green: '#23a559',
    orange: '#f0b232',
    yellow: '#fee75c',
    gray: '#949ba4',
    white: '#ffffff',
  };

  function resolveTextColorCss(id) {
    var key = id || 'auto';
    return Object.prototype.hasOwnProperty.call(TEXT_COLOR_CSS, key) ?
        TEXT_COLOR_CSS[key] : '';
  }

  function t(key, vars) {
    var translate = globalThis.dbT;
    var resolve = globalThis.dbResolveLocale;
    if (typeof translate !== 'function' || typeof resolve !== 'function') {
      return key;
    }
    return translate(key, vars, resolve(settings.uiLanguage));
  }

  var REF_ATTR = 'data-db-mention-ref';
  var STAMP_EVENT = 'db-stamp-mentions-v1';
  var processed = new WeakSet();
  var inFlight = new Set();
  var originals = new WeakMap();
  var cache = new Map();
  var CACHE_MAX = 500;
  var debounceTimer = null;
  var pendingNodes = [];
  var activePreview = null;
  var observer = null;

  function extensionAlive() {
    try {
      return !!(chrome.runtime && chrome.runtime.id);
    } catch (e) {
      return false;
    }
  }

  function loadSettings() {
    return chrome.storage.sync.get(null).then(function(data) {
      if (!data) return;
      Object.keys(settings).forEach(function(k) {
        if (data[k] !== undefined) settings[k] = data[k];
      });
    });
  }

  function cacheGet(key) {
    var hit = cache.get(key);
    if (!hit) return null;
    cache.delete(key);
    cache.set(key, hit);
    return hit;
  }

  function cacheSet(key, value) {
    if (cache.has(key)) cache.delete(key);
    cache.set(key, value);
    while (cache.size > CACHE_MAX) {
      cache.delete(cache.keys().next().value);
    }
  }

  function nearViewport(el) {
    var r = el.getBoundingClientRect();
    return r.bottom >= -400 && r.top <= window.innerHeight + 400;
  }

  function messageRootFrom(node) {
    if (!(node instanceof Element)) return null;
    if (node.closest) {
      var el = node.closest('li[id^="chat-messages-"]');
      if (el) return el;
    }
    if (node.id && /^chat-messages-/.test(node.id)) return node;
    return null;
  }

  function contentEl(root) {
    return root.querySelector('[id^="message-content-"]') ||
        root.querySelector('[class*="messageContent"]');
  }

  function extractText(content) {
    var clone = content.cloneNode(true);
    clone.querySelectorAll(
        '.db-translation, .db-ask, [class*="reactions"], time')
        .forEach(function(n) { n.remove(); });
    return (clone.innerText || clone.textContent || '')
        .trim()
        .replace(/\s+\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n');
  }

  function scriptLooks(text) {
    return {
      han: /[\u4e00-\u9fff]/.test(text),
      kana: /[\u3040-\u30ff]/.test(text),
      hangul: /[\uac00-\ud7af]/.test(text),
      cyrillic: /[\u0400-\u04ff]/.test(text),
      arabic: /[\u0600-\u06ff]/.test(text),
      hebrew: /[\u0590-\u05ff]/.test(text),
      latin: /[A-Za-z]{3,}/.test(text),
    };
  }

  function looksLikeLang(text, lang) {
    if (!text || text.length < 2) return true;
    var code = String(lang || '').toLowerCase();
    var s = scriptLooks(text);
    if (code.indexOf('zh') === 0) return s.han && !s.cyrillic;
    if (code === 'ja') return s.kana || (s.han && !s.latin);
    if (code === 'ko') return s.hangul;
    if (code === 'ru' || code === 'uk' || code === 'bg') {
      return s.cyrillic && !s.latin;
    }
    if (code === 'ar') return s.arabic;
    if (code === 'he') return s.hebrew;
    if (code.indexOf('en') === 0) {
      return s.latin && !s.han && !s.kana && !s.hangul && !s.cyrillic;
    }
    return false;
  }

  function shouldSkipInbound(text) {
    if (looksLikeLang(text, settings.targetLanguage)) return true;
    if (settings.understoodMode === 'custom') {
      var list = settings.understoodLanguages || [];
      for (var i = 0; i < list.length; i++) {
        if (looksLikeLang(text, list[i])) return true;
      }
      return false;
    }
    return false;
  }

  function sendTranslate(text, targetLang, outgoing) {
    var service = settings.service || 'free';
    var payload = {
      type: 'free-translate',
      text: text,
      targetLang: targetLang,
      sourceLang: 'auto',
      outgoing: !!outgoing,
    };
    if (service === 'edgevolc') payload.type = 'edgevolc-translate';
    else if (service === 'deepl') payload.type = 'deepl-translate';
    else if (service === 'ai') {
      payload.type = 'ai-translate';
      payload.baseUrl = settings.aiBaseUrl;
      payload.model = settings.aiModel;
    }
    var cacheKey = [service, targetLang, text].join('\0');
    var cached = cacheGet(cacheKey);
    if (cached) return Promise.resolve({ok: true, text: cached, via: 'cache'});

    return new Promise(function(resolve) {
      if (!extensionAlive()) {
        resolve({ok: false, error: 'context-dead'});
        return;
      }
      chrome.runtime.sendMessage(payload, function(res) {
        if (chrome.runtime.lastError) {
          resolve({ok: false, error: 'context-dead'});
          return;
        }
        if (res && res.ok && res.text) cacheSet(cacheKey, res.text);
        resolve(res || {ok: false, error: 'network'});
      });
    });
  }

  function clearTranslationNear(content) {
    var parent = content.parentElement;
    if (!parent) return;
    Array.from(parent.children).forEach(function(el) {
      if (el.classList && el.classList.contains('db-translation') &&
          (el.previousElementSibling === content ||
           (content.id && el.dataset.dbFor === content.id))) {
        el.remove();
      }
    });
    content.querySelectorAll('.db-ask').forEach(function(b) { b.remove(); });
  }

  function applyTextColor(el) {
    try {
      var css = resolveTextColorCss(settings.textColor || 'auto');
      if (css) el.style.setProperty('--db-fg', css);
      else el.style.removeProperty('--db-fg');
    } catch (e) {
      
    }
  }

  function toggleOriginal(content, block) {
    if (settings.displayMode === 'replace') {
      var showingTranslation = content.classList.contains('db-replaced');
      if (showingTranslation) {
        content.textContent = originals.get(content) ||
            content.dataset.dbOriginal || '';
        content.classList.remove('db-replaced');
      } else {
        content.textContent = block.dataset.translated || content.textContent;
        content.classList.add('db-replaced');
      }
      return;
    }
    var hidden = content.classList.toggle('db-source-hidden');
    var globe = block.querySelector('.db-globe');
    if (globe) {
      globe.title = hidden ? t('showOriginal') : t('hideOriginal');
    }
  }

  function placeTranslation(content, translated, via) {
    clearTranslationNear(content);
    var style = settings.translationStyle || 'code';

    if (settings.displayMode === 'replace') {
      if (!originals.has(content)) {
        originals.set(content, content.textContent || '');
        content.dataset.dbOriginal = content.textContent || '';
      }
      content.textContent = translated;
      content.classList.add('db-replaced');
      content.dataset.dbFont = settings.textFont || 'sans';
      var ask = document.createElement('button');
      ask.type = 'button';
      ask.className = 'db-ask';
      ask.textContent = '🌐';
      ask.title = t('showOriginal');
      ask.addEventListener('click', function(e) {
        e.preventDefault();
        e.stopPropagation();
        toggleOriginal(content, {dataset: {translated: translated}});
      });
      content.appendChild(ask);
      return;
    }

    var block = document.createElement('div');
    block.className = 'db-translation';
    block.dataset.style = style;
    block.dataset.font = settings.textFont || 'sans';
    block.dataset.via = via || '';
    block.dataset.translated = translated;
    if (content.id) block.dataset.dbFor = content.id;
    applyTextColor(block);

    var globe = document.createElement('button');
    globe.type = 'button';
    globe.className = 'db-globe';
    globe.textContent = '🌐';
    globe.title = t('hideOriginal');
    globe.addEventListener('click', function(e) {
      e.preventDefault();
      e.stopPropagation();
      toggleOriginal(content, block);
    });

    var text = document.createElement('div');
    text.className = 'db-translation-text';
    text.textContent = translated;

    block.appendChild(globe);
    block.appendChild(text);
    content.insertAdjacentElement('afterend', block);
  }

  function addAskButton(content, messageId) {
    if (content.querySelector('.db-ask')) return;
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'db-ask';
    btn.title = t('translateThis');
    btn.textContent = '🌐';
    btn.addEventListener('click', function(e) {
      e.preventDefault();
      e.stopPropagation();
      translateOne(content, messageId, true);
    });
    content.appendChild(btn);
  }

  async function translateOne(content, messageId, force) {
    if (!content || !content.isConnected) return;
    if (inFlight.has(messageId)) return;
    var text = extractText(content);
    if (!text || text.length < 2) return;
    if (!force && shouldSkipInbound(text)) {
      addAskButton(content, messageId);
      return;
    }
    if (!force && content.parentElement &&
        content.parentElement.querySelector('.db-translation')) {
      return;
    }
    if (!force && content.classList.contains('db-replaced')) return;

    inFlight.add(messageId);
    try {
      var res = await sendTranslate(text, settings.targetLanguage, false);
      if (!content.isConnected) return;
      if (res && res.ok && res.text && res.text !== text) {
        placeTranslation(content, res.text, res.via || settings.service);
      } else if (force) {
        showToast(t('translateFailed'));
      } else {
        addAskButton(content, messageId);
      }
    } finally {
      inFlight.delete(messageId);
    }
  }

  function processRoot(root) {
    if (!root || processed.has(root)) return;
    var content = contentEl(root);
    if (!content) return;
    processed.add(root);
    var id = root.id || content.id || String(Math.random());
    if (!settings.enabled) {
      addAskButton(content, id);
      return;
    }
    if (!nearViewport(content)) {
      processed.delete(root);
      return;
    }
    translateOne(content, id, false);
  }

  function flushPending() {
    var batch = pendingNodes.splice(0);
    for (var i = 0; i < batch.length; i++) {
      var root = messageRootFrom(batch[i]);
      if (root) processRoot(root);
      else if (batch[i].querySelectorAll) {
        batch[i].querySelectorAll('li[id^="chat-messages-"]').forEach(
            processRoot);
      }
    }
  }

  function queueNode(node) {
    if (!(node instanceof Element)) return;
    pendingNodes.push(node);
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(flushPending, 80);
  }

  function scanExisting() {
    document.querySelectorAll('li[id^="chat-messages-"]').forEach(processRoot);
  }

  function startObserver() {
    if (observer) observer.disconnect();
    observer = new MutationObserver(function(mutations) {
      for (var i = 0; i < mutations.length; i++) {
        var m = mutations[i];
        for (var j = 0; j < m.addedNodes.length; j++) {
          queueNode(m.addedNodes[j]);
        }
      }
    });
    observer.observe(document.body || document.documentElement, {
      childList: true,
      subtree: true,
    });
    scanExisting();
  }

  function composerField() {
    return document.querySelector(
        '[role="textbox"][contenteditable="true"][data-slate-editor="true"]') ||
        document.querySelector('[role="textbox"][contenteditable="true"]');
  }

  function stampMentions() {
    document.dispatchEvent(new CustomEvent(STAMP_EVENT, {bubbles: true}));
  }

  function draftText(field) {
    stampMentions();
    var parts = [];
    function walk(node) {
      if (node.nodeType === Node.TEXT_NODE) {
        parts.push(node.nodeValue || '');
        return;
      }
      if (!(node instanceof Element)) return;
      if (node.getAttribute && node.getAttribute(REF_ATTR)) {
        parts.push(node.getAttribute(REF_ATTR));
        return;
      }
      if (node.getAttribute && node.getAttribute('data-slate-void') === 'true') {
        parts.push(node.getAttribute('aria-label') || node.textContent || '');
        return;
      }
      if (node.tagName === 'BR') {
        parts.push('\n');
        return;
      }
      var kids = node.childNodes;
      for (var i = 0; i < kids.length; i++) walk(kids[i]);
      if (node.getAttribute &&
          node.getAttribute('data-slate-node') === 'element' &&
          node.tagName === 'DIV') {
        parts.push('\n');
      }
    }
    walk(field);
    return parts.join('').replace(/\n+$/, '').trim();
  }

  function setComposerText(field, text) {
    field.focus();
    document.execCommand('selectAll', false, null);
    document.execCommand('insertText', false, text);
  }

  function clickSend() {
    var btn = document.querySelector('button[aria-label="Send Message"]') ||
        document.querySelector('button[aria-label="Send message"]') ||
        document.querySelector('button[aria-label="发送消息"]') ||
        document.querySelector('form [type="submit"]');
    if (btn) btn.click();
  }

  var previewKeyHandler = null;

  function closePreview() {
    if (previewKeyHandler) {
      document.removeEventListener('keydown', previewKeyHandler, true);
      previewKeyHandler = null;
    }
    if (activePreview && activePreview.root) activePreview.root.remove();
    activePreview = null;
  }

  function showToast(msg) {
    var el = document.createElement('div');
    el.className = 'db-toast';
    el.setAttribute('data-theme', resolveTheme());
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(function() { el.remove(); }, 2200);
  }

  function showPreview(original, field) {
    closePreview();
    var root = document.createElement('div');
    root.className = 'db-preview-root';
    root.setAttribute('data-theme', resolveTheme());
    root.innerHTML =
        '<div class="db-preview-header">' +
        '<div class="db-preview-title">🌐 ' + t('previewTitle') + '</div>' +
        '<button type="button" class="db-preview-close" aria-label="' +
        t('previewClose') + '">×</button></div>' +
        '<div class="db-preview-label">' + t('previewOriginal') + '</div>' +
        '<div class="db-preview-box db-preview-original"></div>' +
        '<div class="db-preview-label">' + t('previewWillSend') + '</div>' +
        '<div class="db-preview-box db-preview-translated">' +
        '<button type="button" class="db-preview-copy" title="' +
        t('previewCopy') + '">⧉</button>' +
        '<span class="db-preview-translated-text">' + t('translating') +
        '</span></div>' +
        '<div class="db-preview-actions">' +
        '<button type="button" class="db-preview-btn db-preview-send" disabled>' +
        '✓ ' + t('previewSend') +
        '<span class="db-preview-kbd">Enter</span></button>' +
        '<button type="button" class="db-preview-btn db-preview-cancel">' +
        t('previewKeep') + '</button></div>';

    root.querySelector('.db-preview-original').textContent = original;
    document.body.appendChild(root);
    activePreview = {root: root, field: field, original: original};

    root.querySelector('.db-preview-close').onclick = closePreview;
    root.querySelector('.db-preview-cancel').onclick = function() {
      closePreview();
      setTimeout(clickSend, 20);
    };
    root.querySelector('.db-preview-copy').onclick = function() {
      if (!activePreview || !activePreview.translated) return;
      navigator.clipboard.writeText(activePreview.translated);
      showToast(t('copied'));
    };
    var sendBtn = root.querySelector('.db-preview-send');
    sendBtn.onclick = function() {
      if (!activePreview || !activePreview.translated) return;
      setComposerText(field, activePreview.translated);
      closePreview();
      setTimeout(clickSend, 40);
    };

    previewKeyHandler = function(e) {
      if (!activePreview || activePreview.root !== root) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        closePreview();
        return;
      }
      if (e.key === 'Enter' && !e.shiftKey && activePreview.translated) {
        e.preventDefault();
        e.stopPropagation();
        sendBtn.click();
      }
    };
    document.addEventListener('keydown', previewKeyHandler, true);

    sendTranslate(original, settings.outgoingLanguage, true).then(
        function(res) {
          if (!activePreview || activePreview.root !== root) return;
          var textEl = root.querySelector('.db-preview-translated-text');
          if (res && res.ok && res.text) {
            activePreview.translated = res.text;
            textEl.textContent = res.text;
            sendBtn.disabled = false;
          } else {
            textEl.textContent = t('failedPrefix') +
                formatError(res && res.error);
          }
        });
  }

  function onKeyDown(e) {
    if (!extensionAlive()) return;
    var hotkeys = globalThis.DB_HOTKEYS;
    var action = hotkeys && hotkeys.matchHotkey(e);
    if (action && !e.repeat) {
      e.preventDefault();
      e.stopPropagation();
      if (action === 'toggle') {
        settings.enabled = !settings.enabled;
        chrome.storage.sync.set({enabled: settings.enabled});
        showToast(settings.enabled ? t('translatorOn') : t('translatorOff'));
        if (settings.enabled) {
          processed = new WeakSet();
          scanExisting();
        }
      } else if (action === 'outgoing') {
        settings.outgoingEnabled = !settings.outgoingEnabled;
        chrome.storage.sync.set({outgoingEnabled: settings.outgoingEnabled});
        showToast(settings.outgoingEnabled ?
            t('outgoingOn') : t('outgoingOff'));
      }
      return;
    }

    if (e.key !== 'Enter' || e.shiftKey || e.isComposing) return;
    if (!settings.outgoingEnabled) return;
    if (activePreview) return;
    var field = composerField();
    if (!field || (e.target !== field && !field.contains(e.target))) return;
    var text = draftText(field);
    if (!text) return;
    if (looksLikeLang(text, settings.outgoingLanguage)) return;
    e.preventDefault();
    e.stopPropagation();
    showPreview(text, field);
  }

  chrome.runtime.onMessage.addListener(function(msg, _sender, sendResponse) {
    if (msg && msg.type === 'db-ping') {
      sendResponse({ok: true, enabled: settings.enabled});
      return;
    }
  });

  chrome.storage.onChanged.addListener(function(changes, area) {
    if (area !== 'sync') return;
    var needRescan = false;
    Object.keys(changes).forEach(function(k) {
      if (k in settings) {
        settings[k] = changes[k].newValue;
        if (k === 'enabled' || k === 'targetLanguage' || k === 'displayMode' ||
            k === 'service' || k === 'translationStyle' || k === 'textColor' ||
            k === 'textFont' ||
            k === 'understoodMode' || k === 'understoodLanguages' ||
            k === 'uiLanguage') {
          needRescan = true;
        }
      }
    });
    if (needRescan) {
      document.querySelectorAll('.db-translation').forEach(function(el) {
        el.remove();
      });
      document.querySelectorAll('.db-ask').forEach(function(el) {
        el.remove();
      });
      document.querySelectorAll('.db-replaced').forEach(function(el) {
        if (el.dataset.dbOriginal) el.textContent = el.dataset.dbOriginal;
        el.classList.remove('db-replaced');
      });
      processed = new WeakSet();
      if (settings.enabled) scanExisting();
    }
  });

  var scanTimer = null;

  function boot() {
    loadSettings().then(function() {
      startObserver();
      document.addEventListener('keydown', onKeyDown, true);
      scanTimer = setInterval(function() {
        if (!settings.enabled) return;
        scanExisting();
      }, 2500);
    });
  }

  window.__dbCleanup = function() {
    if (observer) {
      try { observer.disconnect(); } catch (e) {  }
      observer = null;
    }
    if (scanTimer) {
      clearInterval(scanTimer);
      scanTimer = null;
    }
    document.removeEventListener('keydown', onKeyDown, true);
  };

  if (document.body) boot();
  else document.addEventListener('DOMContentLoaded', boot);
})();

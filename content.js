'use strict';

(function() {
  var BOOT = 244;
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
    translateChannels: true,
    translateAnnouncements: true,
    translateEvents: true,
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
      var el = node.closest(
          'li[id^="chat-messages-"], [id^="chat-messages-"],' +
          ' [class*="messageListItem"], [class*="mainCard"]');
      if (el) return el;
    }
    if (node.id && /^chat-messages-/.test(node.id)) return node;
    return null;
  }

  function contentEl(root) {
    return root.querySelector('[id^="message-content-"]') ||
        root.querySelector('[class*="messageContent"]');
  }

  function inComposer(el) {
    return !!(el && el.closest && (
      el.closest('[data-slate-editor="true"]') ||
      el.closest('[class*="channelTextArea"]') ||
      el.closest('[class*="textArea"]')
    ));
  }

  function isAnnouncementText(el) {
    if (!el || !el.matches) return false;
    return el.matches(
        '[class*="topic"], [class*="subtitle"], [class*="embedTitle"],' +
        ' [class*="embedDescription"], [class*="textDisplay"],' +
        ' [class*="messageContent"], [id^="message-content-"],' +
        ' [class*="markup"], [class*="postTitle"], [class*="threadName"],' +
        ' [class*="title"], [class*="heading"], [class*="forumTag"],' +
        ' [class*="tagPill"], h1, h2, h3, h4');
  }

  function collectMessageTextEls(root) {
    if (!root || !root.querySelectorAll) return [];
    var nodes = root.querySelectorAll(
        '[id^="message-content-"], [class*="messageContent"],' +
        ' [class*="embedTitle"], [class*="embedDescription"],' +
        ' [class*="textDisplay"], [class*="textContainer"],' +
        ' [class*="markup"]');
    var list = [];
    nodes.forEach(function(el) {
      if (inComposer(el)) return;
      if (el.closest('[class*="repliedMessage"]')) return;
      if (el.closest('[class*="reactions"]')) return;
      if (el.closest('.db-translation, .db-preview-root, .db-ask')) return;
      if (el.closest('nav, [class*="members"], [class*="guilds"]')) return;
      var text = (el.innerText || el.textContent || '').trim();
      if (text.length < 2) return;
      list.push(el);
    });
    return list.filter(function(el) {
      return !list.some(function(other) {
        return other !== el && other.contains(el);
      });
    });
  }

  function stripEmojiTokens(text) {
    return String(text || '')
        .replace(/:[a-zA-Z0-9_+-]{2,}:/g, '')
        .replace(/\d+\s*(条消息|則訊息|messages?|件のメッセージ|개 메시지)/gi, '')
        .replace(/\s+/g, ' ')
        .trim();
  }

  function extractText(content) {
    var clone = content.cloneNode(true);
    clone.querySelectorAll(
        '.db-translation, .db-ask, [class*="reactions"], time,' +
        ' img, svg, [class*="emoji"]')
        .forEach(function(n) { n.remove(); });
    return stripEmojiTokens(
        (clone.innerText || clone.textContent || '')
            .trim()
            .replace(/\s+\n/g, '\n')
            .replace(/\n{3,}/g, '\n\n'));
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
    if (!force && content.nextElementSibling &&
        content.nextElementSibling.classList &&
        content.nextElementSibling.classList.contains('db-translation')) {
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
    if (root.className && /mainCard/i.test(String(root.className))) {
      processForumCard(root);
      return;
    }
    var blocks = collectMessageTextEls(root);
    var content = contentEl(root);
    if (!blocks.length && content) blocks = [content];
    if (!blocks.length) return;
    if (!nearViewport(blocks[0] || root)) return;
    processed.add(root);
    var id = root.id || (content && content.id) || String(Math.random());
    if (!settings.enabled) {
      addAskButton(blocks[0], id);
      return;
    }
    blocks.forEach(function(el, i) {
      translateOne(el, id + ':' + i, false);
    });
  }

  function skipAnnouncementHost(el) {
    if (!el || !el.closest) return true;
    if (inComposer(el)) return true;
    if (el.closest('nav')) return true;
    if (el.closest('[class*="guilds"]')) return true;
    if (el.closest('[class*="privateChannels"]')) return true;
    if (el.closest('[class*="members"]')) return true;
    if (el.closest('.db-preview-root, .db-translation, .db-ask')) return true;
    if (el.closest('[class*="username"]')) return true;
    if (el.closest('[class*="roleName"]')) return true;
    if (el.closest('time')) return true;
    var clickable = el.closest('button, [role="button"]');
    if (clickable && !isAnnouncementText(el) && !isAnnouncementText(clickable)) {
      return true;
    }
    return false;
  }

  function isCompactTitle(el) {
    if (!el) return false;
    if (el.matches && el.matches(
        'h1, h2, h3, [class*="embedTitle"], [class*="topic"],' +
        ' [class*="threadName"], [class*="postTitle"],' +
        ' [class*="eventName"], [class*="forumTag"],' +
        ' [class*="tagPill"], [class*="heading"]')) {
      return true;
    }
    var cls = String(el.className || '');
    return /title|topic|subtitle/i.test(cls) &&
        (el.textContent || '').trim().length < 220;
  }

  async function translateSurfaceEl(el, idHint) {
    if (!settings.enabled || !settings.translateAnnouncements) return;
    if (!el || !el.isConnected) return;
    if (skipAnnouncementHost(el)) return;
    if (el.nextElementSibling &&
        el.nextElementSibling.classList &&
        el.nextElementSibling.classList.contains('db-translation')) {
      return;
    }
    if (el.dataset.dbChTr &&
        (el.textContent || '').replace(/\s+/g, ' ').trim() ===
            el.dataset.dbChTr) {
      return;
    }
    var text = extractText(el);
    if (!text || text.length < 2) return;
    if (shouldSkipInbound(text)) return;
    if (!nearViewport(el)) return;

    var id = idHint || el.id || ('surf\0' + text.slice(0, 80));
    if (inFlight.has(id)) return;
    if (processed.has(el)) return;
    processed.add(el);
    inFlight.add(id);
    try {
      var res = await sendTranslate(text, settings.targetLanguage, false);
      if (!el.isConnected || !settings.enabled) return;
      if (!res || !res.ok || !res.text || res.text === text) return;
      if (isCompactTitle(el)) {
        var orig = (el.dataset.dbChOrig ||
            (el.textContent || '').replace(/\s+/g, ' ').trim());
        if (!el.dataset.dbChOrig) el.dataset.dbChOrig = orig;
        el.dataset.dbChTr = res.text.trim();
        el.title = orig;
        setLeafText(el, res.text.trim());
      } else {
        placeTranslation(el, res.text, res.via || settings.service);
      }
    } finally {
      inFlight.delete(id);
    }
  }

  function processForumCard(card) {
    if (!card || processed.has(card)) return;
    processed.add(card);
    if (!settings.enabled || !settings.translateAnnouncements) return;
    if (!nearViewport(card)) {
      processed.delete(card);
      return;
    }
    collectMessageTextEls(card).forEach(function(el) {
      translateSurfaceEl(el, (card.id || 'forum') + '\0' +
          (el.textContent || '').slice(0, 40));
    });
    card.querySelectorAll(
        'h1, h2, h3, [class*="postTitle"], [class*="threadName"],' +
        ' [class*="title"]')
        .forEach(function(el) {
          if (skipAnnouncementHost(el)) return;
          if (el.querySelector(
              'h1, h2, h3, [class*="postTitle"], [class*="title"]')) {
            return;
          }
          translateInlineEl(el, 'ft');
        });
  }

  function isForumTagUi(text) {
    var t = String(text || '').replace(/\s+/g, ' ').trim();
    if (!t || t.length < 2) return true;
    return /^(All|全部|全部標籤|全て|전체|BOT|APP|NEW)$/i.test(t);
  }

  function skipForumTagHost(el) {
    if (!el || !el.closest) return true;
    if (inComposer(el)) return true;
    if (el.closest('[class*="guilds"]')) return true;
    if (el.closest('[class*="privateChannels"]')) return true;
    if (el.closest('[class*="membersWrap"], [class*="membersList"]')) return true;
    if (el.closest('[class*="botTag"]')) return true;
    if (el.closest('[class*="username"]')) return true;
    if (el.closest('time')) return true;
    if (el.closest('[class*="reactions"]')) return true;
    if (el.closest('.db-preview-root, .db-translation, .db-ask')) return true;
    if (el.closest(
        '[id^="message-content-"], [class*="markup"], [class*="messageContent"]')) {
      return true;
    }
    return false;
  }

  function forumTagLeaf(el) {
    var leaf = el.querySelector('[class*="name"], [class*="text"]') || el;
    var inner = leaf.querySelector('[class*="name"], [class*="text"]');
    if (inner) leaf = inner;
    return leaf;
  }

  function pushForumTagLeaf(list, el) {
    if (!el || skipForumTagHost(el)) return;
    var leaf = forumTagLeaf(el);
    var raw = (leaf.textContent || '').replace(/\s+/g, ' ').trim();
    if (isForumTagUi(raw) || raw.length > 40) return;
    if (leaf.dataset.dbChTr && raw === leaf.dataset.dbChTr) return;
    if (list.indexOf(leaf) >= 0) return;
    list.push(leaf);
  }

  function collectExactLabelEls(orig) {
    var out = [];
    if (!orig || orig.length < 2 || orig.length > 40) return out;
    document.querySelectorAll('span, div, button, a').forEach(function(el) {
      if (skipForumTagHost(el)) return;
      var raw = (el.textContent || '').replace(/\s+/g, ' ').trim();
      if (raw !== orig) return;
      var nested = el.querySelector('span, div, button, a');
      if (nested &&
          (nested.textContent || '').replace(/\s+/g, ' ').trim() === orig) {
        return;
      }
      if (out.indexOf(el) >= 0) return;
      out.push(el);
    });
    return out;
  }

  function collectForumTagEls() {
    var list = [];
    document.querySelectorAll(
        '[class*="forumTag"], [class*="tagPill"], [class*="chip"],' +
        ' [class*="pill"], [class*="tagsRow"] [class*="box"],' +
        ' [class*="tagList"] [class*="box"], [class*="tagsContainer"] *,' +
        ' [class*="headerTags"] [class*="box"], [class*="headerTags"] span,' +
        ' [class*="tags"] [class*="box"], [class*="tag"]:not([class*="botTag"])')
        .forEach(function(el) {
          if (el.querySelector(
              '[class*="forumTag"], [class*="tagPill"],' +
              ' [class*="tag"]:not([class*="botTag"])')) {
            return;
          }
          pushForumTagLeaf(list, el);
        });
    collectThreadTitleEls().forEach(function(title) {
      var scope = title.parentElement;
      var hops = 0;
      while (scope && hops < 4) {
        scope.querySelectorAll('div, span, button').forEach(function(el) {
          if (title.contains(el) || el.contains(title)) return;
          if (el.querySelector('div, span, button, p, h1, h2, h3')) return;
          pushForumTagLeaf(list, el);
        });
        scope = scope.parentElement;
        hops++;
      }
    });
    return list;
  }

  function applyInlineText(el, orig, next) {
    if (!el || !el.isConnected) return;
    if (!el.dataset.dbChOrig) el.dataset.dbChOrig = orig;
    el.dataset.dbChTr = next;
    el.title = orig;
    setLeafText(el, next);
    if (el.nextElementSibling &&
        el.nextElementSibling.classList &&
        el.nextElementSibling.classList.contains('db-translation')) {
      el.nextElementSibling.remove();
    }
  }

  async function translateInlineEl(el, keyPrefix) {
    if (!settings.enabled || !settings.translateAnnouncements) return;
    if (!el || !el.isConnected) return;
    var orig = channelNameRaw(el);
    if (!orig || orig.length < 2) return;
    if (shouldSkipInbound(orig)) return;
    var shown = (el.textContent || '').replace(/\s+/g, ' ').trim();
    if (el.dataset.dbChTr && shown === el.dataset.dbChTr) return;
    var key = keyPrefix + '\0' + orig + '\0' + settings.targetLanguage;
    if (inFlight.has(key)) return;
    inFlight.add(key);
    try {
      var res = await sendTranslate(orig, settings.targetLanguage, false);
      if (!settings.enabled || !settings.translateAnnouncements) return;
      if (!res || !res.ok || !res.text) return;
      var next = String(res.text).replace(/\s+/g, ' ').trim();
      if (!next || next === orig) return;
      collectForumTagEls().concat(collectThreadTitleEls()).concat(
          collectExactLabelEls(orig)).forEach(function(other) {
            var raw = channelNameRaw(other);
            if (raw !== orig && raw !== shown) return;
            applyInlineText(other, orig, next);
          });
      applyInlineText(el, orig, next);
    } finally {
      inFlight.delete(key);
    }
  }

  function collectThreadTitleEls() {
    var out = [];
    document.querySelectorAll(
        'h1, h2, h3, [class*="heading-xxl"], [class*="heading-xl"],' +
        ' [class*="heading-lg"], [class*="forumPostTitle"],' +
        ' [class*="threadName"], [class*="postTitle"]')
        .forEach(function(el) {
          if (inComposer(el)) return;
          if (el.closest(
              '[class*="guilds"], [class*="privateChannels"],' +
              ' [class*="members"], nav')) {
            return;
          }
          if (el.closest('li[id^="chat-messages-"]')) return;
          if (el.closest('.db-translation, .db-preview-root')) return;
          if (el.querySelector(
              'time, [class*="avatar"], [class*="username"]')) {
            return;
          }
          if (el.querySelector(
              'h1, h2, h3, [class*="heading-xxl"], [class*="heading-xl"]')) {
            return;
          }
          var raw = channelNameRaw(el);
          if (raw.length < 4 || raw.length > 280) return;
          if (el.dataset.dbChTr && raw === el.dataset.dbChTr) return;
          if (out.indexOf(el) >= 0) return;
          out.push(el);
        });
    document.querySelectorAll(
        '[class*="chat"] [class*="title"], [class*="chatContent"] [class*="title"]')
        .forEach(function(el) {
          if (inComposer(el)) return;
          if (el.closest('li[id^="chat-messages-"]')) return;
          if (el.closest('nav, [class*="guilds"], [class*="members"]')) return;
          if (el.querySelector('[class*="title"], h1, h2, h3')) return;
          if (el.querySelector(
              'time, [class*="avatar"], [class*="username"]')) {
            return;
          }
          var raw = channelNameRaw(el);
          if (raw.length < 4 || raw.length > 280) return;
          if (el.dataset.dbChTr && raw === el.dataset.dbChTr) return;
          if (out.indexOf(el) >= 0) return;
          out.push(el);
        });
    return out;
  }

  function scanForumTags() {
    if (!settings.enabled || !settings.translateAnnouncements) return;
    collectForumTagEls().forEach(function(el) {
      translateInlineEl(el, 'tag');
    });
  }

  function scanThreadTitles() {
    if (!settings.enabled || !settings.translateAnnouncements) return;
    collectThreadTitleEls().forEach(function(el) {
      translateInlineEl(el, 'th');
    });
  }

  function scanAnnouncementSurfaces() {
    if (!settings.enabled || !settings.translateAnnouncements) return;
    document.querySelectorAll('[class*="mainCard"]').forEach(processForumCard);
    document.querySelectorAll(
        '[class*="topic"], [class*="subtitle"]')
        .forEach(function(el) {
          if (skipAnnouncementHost(el)) return;
          if (el.closest('[class*="members"]')) return;
          if (el.closest('nav')) return;
          if (el.closest('[class*="guilds"]')) return;
          if (inComposer(el)) return;
          if (el.querySelector('[class*="topic"], [class*="subtitle"]')) {
            return;
          }
          if ((el.textContent || '').trim().length < 4) return;
          translateInlineEl(el, 'topic');
        });
    scanForumTags();
    scanThreadTitles();
    scanThreadPreviews();
  }

  function scanThreadPreviews() {
    if (!settings.enabled || !settings.translateAnnouncements) return;
    var cards = [];
    document.querySelectorAll(
        '[class*="threadMessage"], [class*="threadEmbed"],' +
        ' [class*="threadAccessory"], [class*="clickable"]')
        .forEach(function(card) {
          var blob = card.textContent || '';
          if (!/\d+\s*(条消息|則訊息|messages?|件のメッセージ|개 메시지)/i
              .test(blob)) {
            return;
          }
          if (blob.length > 600) return;
          if (card.closest(
              'nav, [class*="guilds"], [class*="membersWrap"]')) {
            return;
          }
          if (card.querySelector('li[id^="chat-messages-"]')) return;
          cards.push(card);
        });
    cards.filter(function(el) {
      return !cards.some(function(other) {
        return other !== el && other.contains(el);
      });
    }).forEach(function(card) {
      card.querySelectorAll('div, span, h1, h2, h3, strong').forEach(
          function(el) {
            if (el.closest(
                'time, [class*="username"], [class*="avatar"]')) {
              return;
            }
            if (el.querySelector(
                'div, span, h1, h2, h3, strong, time') &&
                !el.querySelector('[class*="emoji"], img')) {
              return;
            }
            var raw = channelNameRaw(el);
            if (!raw || raw.length < 8) return;
            translateInlineEl(el, 'tp');
          });
    });
  }

  function flushPending() {
    var batch = pendingNodes.splice(0);
    for (var i = 0; i < batch.length; i++) {
      var root = messageRootFrom(batch[i]);
      if (root) processRoot(root);
      else if (batch[i].querySelectorAll) {
        batch[i].querySelectorAll(
            'li[id^="chat-messages-"], [id^="chat-messages-"],' +
            ' [class*="messageListItem"], [class*="mainCard"]').forEach(
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

  function channelNavRoot() {
    var a = document.querySelector(
        'a[data-list-item-id^="channels___"], nav a[href*="/channels/"]');
    if (!a) return null;
    var href = a.getAttribute('href') || '';
    if (href.indexOf('/channels/@me') === 0) return null;
    return a.closest('nav') || a.closest('[class*="sidebar"]');
  }

  function skipChannelNameHost(el) {
    if (!el || !el.closest) return true;
    if (el.closest('header')) return true;
    if (el.closest('[class*="guilds"]')) return true;
    if (el.closest('[class*="privateChannels"]')) return true;
    if (el.closest('[class*="voiceUser"]')) return true;
    if (el.closest('[class*="userSmall"]')) return true;
    if (el.closest('[class*="members"]')) return true;
    if (el.closest('[class*="numberBadge"]')) return true;
    if (el.closest('.db-preview-root, .db-translation')) return true;
    if (el.closest(
        '[class*="guildEvent"], [class*="scheduledEvent"],' +
        ' [class*="eventStatus"], [class*="eventCard"],' +
        ' [class*="liveEvent"]')) {
      return true;
    }
    return false;
  }

  function humanizeChannelName(text) {
    return String(text || '')
        .replace(/[-_]+/g, ' ')
        .replace(/([a-z])([A-Z])/g, '$1 $2')
        .replace(/\s+/g, ' ')
        .trim();
  }

  function channelNameRaw(el) {
    if (el.dataset && el.dataset.dbChOrig) return el.dataset.dbChOrig;
    var clone = el.cloneNode(true);
    clone.querySelectorAll('img, svg, [class*="emoji"], time').forEach(
        function(n) { n.remove(); });
    return stripEmojiTokens(clone.textContent);
  }

  function setLeafText(el, text) {
    var best = null;
    var bestLen = 0;
    var walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null);
    var node;
    while ((node = walker.nextNode())) {
      var v = (node.nodeValue || '').trim();
      if (!v) continue;
      if (/^:[a-zA-Z0-9_+-]+:$/.test(v)) continue;
      if (/^\d+\s*(条消息|則訊息|messages?)/i.test(v)) continue;
      if (v.length > bestLen) {
        best = node;
        bestLen = v.length;
      }
    }
    if (best) {
      best.nodeValue = text;
      return;
    }
    if (el.querySelector('img, svg, [class*="emoji"]')) {
      var span = document.createElement('span');
      span.textContent = text;
      el.appendChild(span);
      return;
    }
    el.textContent = text;
  }

  function collectChannelNameEls() {
    var nav = channelNavRoot();
    if (!nav) return [];
    var out = [];
    nav.querySelectorAll('[class*="name"]').forEach(function(el) {
      if (skipChannelNameHost(el)) return;
      if (el.querySelector('[class*="name"]')) return;
      var raw = channelNameRaw(el);
      if (!raw || raw.length < 2) return;
      out.push(el);
    });
    return out;
  }

  function restoreChannelNames() {
    document.querySelectorAll('[data-db-ch-orig]').forEach(function(el) {
      var orig = el.dataset.dbChOrig;
      if (orig) setLeafText(el, orig);
      el.removeAttribute('data-db-ch-orig');
      el.removeAttribute('data-db-ch-tr');
      if (el.getAttribute('title') === orig) el.removeAttribute('title');
      el.classList.remove('db-channel');
    });
  }

  async function translateChannelEl(el) {
    if (!settings.enabled || !settings.translateChannels) return;
    if (!el || !el.isConnected) return;
    var orig = channelNameRaw(el);
    var phrase = humanizeChannelName(orig);
    if (!phrase || phrase.length < 2) return;
    if (shouldSkipInbound(phrase)) return;
    var shown = (el.textContent || '').replace(/\s+/g, ' ').trim();
    if (el.dataset.dbChTr && shown === el.dataset.dbChTr) return;

    var key = 'ch\0' + phrase + '\0' + settings.targetLanguage;
    if (inFlight.has(key)) return;
    inFlight.add(key);
    try {
      var res = await sendTranslate(phrase, settings.targetLanguage, false);
      if (!el.isConnected || !settings.enabled || !settings.translateChannels) {
        return;
      }
      if (!res || !res.ok || !res.text) return;
      var next = String(res.text).replace(/\s+/g, ' ').trim();
      if (!next || next === phrase || next === orig) return;
      if (!el.dataset.dbChOrig) el.dataset.dbChOrig = orig;
      el.dataset.dbChTr = next;
      el.title = orig;
      el.classList.add('db-channel');
      setLeafText(el, next);
    } finally {
      inFlight.delete(key);
    }
  }

  function scanChannels() {
    if (!settings.enabled || !settings.translateChannels) return;
    collectChannelNameEls().forEach(function(el) {
      translateChannelEl(el);
    });
  }

  function eventCardRoots() {
    var nodes = document.querySelectorAll(
        '[class*="guildEvent"], [class*="scheduledEvent"],' +
        ' [class*="eventStatus"], [class*="liveEvent"],' +
        ' [class*="eventCard"], [class*="eventInfo"],' +
        ' [class*="activeEvent"]');
    var roots = [];
    nodes.forEach(function(el) {
      if (el.closest('[class*="guilds"]')) return;
      if (el.closest('[class*="privateChannels"]')) return;
      if (el.closest('[class*="members"]')) return;
      roots.push(el);
    });
    document.querySelectorAll('[role="dialog"]').forEach(function(dlg) {
      if (!dlg.querySelector(
          '[class*="eventName"], [class*="guildEvent"],' +
          ' [class*="scheduledEvent"], [class*="eventStatus"]')) {
        return;
      }
      roots.push(dlg);
    });
    document.querySelectorAll('button, [role="button"]').forEach(function(btn) {
      var label = (btn.textContent || '').replace(/\s+/g, ' ').trim();
      if (!/^(Event Details|活动详情|活動詳情|이벤트 상세)$/i.test(label)) {
        return;
      }
      var card = btn.closest(
          '[class*="guildEvent"], [class*="scheduledEvent"],' +
          ' [class*="eventStatus"], [class*="eventCard"],' +
          ' [class*="liveEvent"], [class*="eventInfo"]');
      if (!card) {
        card = btn.parentElement;
        var hops = 0;
        while (card && hops < 6 && card !== document.body) {
          var blob = (card.textContent || '').replace(/\s+/g, ' ').trim();
          if (blob.length > 8 && blob.length < 280) break;
          card = card.parentElement;
          hops++;
        }
      }
      if (card && card !== document.body) roots.push(card);
    });
    return roots.filter(function(el) {
      return !roots.some(function(other) {
        return other !== el && other.contains(el);
      });
    });
  }

  function isEventUiLabel(text) {
    var t = String(text || '').replace(/\s+/g, ' ').trim();
    if (!t || t.length < 3) return true;
    if (t.charAt(0) === '#') return true;
    return /^(LIVE|Event Details|Events|Close|Interested|Join|进行中|已结束|活动详情|活动|活動詳情|活動|ライブ|終了|진행|이벤트 상세|이벤트)$/i
        .test(t);
  }

  function collectEventTextEls() {
    var out = [];
    eventCardRoots().forEach(function(root) {
      root.querySelectorAll(
          'h1, h2, h3, h4, [class*="eventName"], [class*="name"],' +
          ' [class*="title"], [class*="description"]')
          .forEach(function(el) {
            if (el.closest('.db-preview-root, .db-translation')) return;
            if (el.closest('time')) return;
            if (el.querySelector(
                'h1, h2, h3, h4, [class*="eventName"], [class*="name"],' +
                ' [class*="title"], [class*="description"]')) {
              return;
            }
            var raw = (el.textContent || '').replace(/\s+/g, ' ').trim();
            if (isEventUiLabel(raw)) return;
            if (el.dataset.dbChTr && raw === el.dataset.dbChTr) return;
            out.push(el);
          });
      if (out.some(function(el) { return root.contains(el); })) return;
      root.querySelectorAll('div, span, strong, p').forEach(function(el) {
        if (el.closest('button, [role="button"]') &&
            el.closest('button, [role="button"]') !== root) {
          return;
        }
        if (el.querySelector('div, span, strong, p, button, svg, img')) {
          return;
        }
        var raw = (el.textContent || '').replace(/\s+/g, ' ').trim();
        if (isEventUiLabel(raw) || raw.length < 6) return;
        if (el.dataset.dbChTr && raw === el.dataset.dbChTr) return;
        out.push(el);
      });
    });
    return out;
  }

  async function translateEventEl(el) {
    if (!settings.enabled || !settings.translateEvents) return;
    if (!el || !el.isConnected) return;
    var orig = channelNameRaw(el);
    if (isEventUiLabel(orig)) return;
    if (shouldSkipInbound(orig)) return;
    var shown = (el.textContent || '').replace(/\s+/g, ' ').trim();
    if (el.dataset.dbChTr && shown === el.dataset.dbChTr) return;

    var key = 'ev\0' + orig + '\0' + settings.targetLanguage;
    if (inFlight.has(key)) return;
    inFlight.add(key);
    try {
      var res = await sendTranslate(orig, settings.targetLanguage, false);
      if (!el.isConnected || !settings.enabled || !settings.translateEvents) {
        return;
      }
      if (!res || !res.ok || !res.text) return;
      var next = String(res.text).replace(/\s+/g, ' ').trim();
      if (!next || next === orig) return;
      if (!el.dataset.dbChOrig) el.dataset.dbChOrig = orig;
      el.dataset.dbChTr = next;
      el.title = orig;
      el.classList.add('db-event');
      setLeafText(el, next);
    } finally {
      inFlight.delete(key);
    }
  }

  function scanEvents() {
    if (!settings.enabled || !settings.translateEvents) return;
    collectEventTextEls().forEach(function(el) {
      translateEventEl(el);
    });
  }

  function scanExisting() {
    document.querySelectorAll(
        'li[id^="chat-messages-"], [id^="chat-messages-"],' +
        ' [class*="messageListItem"]').forEach(processRoot);
    scanChannels();
    scanAnnouncementSurfaces();
    scanEvents();
  }

  function startObserver() {
    if (observer) observer.disconnect();
    observer = new MutationObserver(function(mutations) {
      var touchChannels = false;
      for (var i = 0; i < mutations.length; i++) {
        var m = mutations[i];
        for (var j = 0; j < m.addedNodes.length; j++) {
          queueNode(m.addedNodes[j]);
          if (m.addedNodes[j] instanceof Element) touchChannels = true;
        }
      }
      if (touchChannels) {
        scanChannels();
        scanAnnouncementSurfaces();
        scanEvents();
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
            k === 'uiLanguage' || k === 'translateChannels' ||
            k === 'translateAnnouncements' || k === 'translateEvents') {
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
      restoreChannelNames();
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

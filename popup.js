'use strict';

(function() {
  var state = {
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
    translateChannels: true,
    translateAnnouncements: true,
    translateEvents: true,
    service: 'free',
    theme: 'auto',
    aiBaseUrl: '',
    aiModel: '',
    aiProviderId: '',
    deeplKeyPresent: false,
    aiKeyPresent: false,
  };

  var locale = 'en';
  var langPickMode = 'target';
  var screenStack = ['screenMain'];
  var csHintKey = null;
  var $ = function(id) { return document.getElementById(id); };

  function t(key, vars) {
    return dbT(key, vars, locale);
  }

  function langLabel(code) {
    return dbLangDisplayName(code, locale);
  }

  function langSecondary(code) {
    var native = dbLangNativeName(code);
    var primary = langLabel(code);
    return native && native !== primary ? native : '';
  }

  function setCsHint(key) {
    csHintKey = key || null;
    var hint = $('csHint');
    if (!csHintKey) {
      hint.hidden = true;
      hint.textContent = '';
      return;
    }
    hint.hidden = false;
    hint.textContent = t(csHintKey);
  }

  function applyI18n() {
    locale = dbResolveLocale(state.uiLanguage);
    document.documentElement.lang = locale.replace('_', '-');
    document.querySelectorAll('[data-i18n]').forEach(function(el) {
      el.textContent = t(el.getAttribute('data-i18n'));
    });
    document.querySelectorAll('[data-i18n-title]').forEach(function(el) {
      el.title = t(el.getAttribute('data-i18n-title'));
    });
    document.querySelectorAll('[data-i18n-placeholder]').forEach(function(el) {
      el.placeholder = t(el.getAttribute('data-i18n-placeholder'));
    });
    var hk = globalThis.DB_HOTKEYS ? DB_HOTKEYS.label('outgoing') : 'Alt+O';
    $('outgoingHotkeyHint').textContent = t('outgoingHotkey', {key: hk});
    if (csHintKey) setCsHint(csHintKey);
  }

  function showScreen(id) {
    document.querySelectorAll('.screen').forEach(function(el) {
      el.hidden = el.id !== id;
    });
    if (screenStack[screenStack.length - 1] !== id) screenStack.push(id);
  }

  function goBack() {
    if (screenStack.length > 1) screenStack.pop();
    showScreen(screenStack[screenStack.length - 1] || 'screenMain');
  }

  function persist(partial) {
    Object.assign(state, partial);
    return chrome.storage.sync.set(partial);
  }

  function resolveTheme() {
    if (state.theme === 'dark' || state.theme === 'light') return state.theme;
    try {
      return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    } catch (e) {
      return 'light';
    }
  }

  function applyTheme() {
    document.documentElement.setAttribute('data-theme', resolveTheme());
  }

  function renderUiLangList(query) {
    var list = $('uiLangList');
    list.innerHTML = '';
    var selected = state.uiLanguage || 'auto';
    dbRefreshUiLocales();
    dbFilterUiLocales(query, locale).forEach(function(item) {
      var btn = document.createElement('button');
      btn.type = 'button';
      var primary = item.code === 'auto' ?
          t('uiAuto') :
          dbUiLocaleLabel(item.code, locale);
      var secondary = item.code === 'auto' ?
          '' :
          dbUiLocaleSecondary(item.code, locale);
      btn.innerHTML = '<span>' + escapeHtml(primary) + '</span>' +
          '<span class="sec">' + escapeHtml(secondary) +
          (item.code === selected ? ' <span class="mark">✓</span>' : '') +
          '</span>';
      btn.addEventListener('click', function() {
        persist({uiLanguage: item.code}).then(function() {
          renderMain();
          pingContentScript();
          goBack();
        });
      });
      list.appendChild(btn);
    });
  }

  function syncVersionLabels() {
    var ver = 'v0.0.2';
    try {
      ver = 'v' + chrome.runtime.getManifest().version;
    } catch (e) {
      
    }
    var ftr = $('ftrVer');
    var about = $('aboutVer');
    if (ftr) ftr.textContent = ver;
    if (about) about.textContent = ver;
  }

  function renderMain() {
    applyI18n();
    applyTheme();
    syncVersionLabels();
    $('uiLangLabel').textContent = dbUiLocaleLabel(state.uiLanguage || 'auto', locale);

    var on = !!state.enabled;
    $('enabled').checked = on;
    $('powerRow').classList.toggle('is-off', !on);
    $('powerHint').textContent = t(on ? 'translatorOn' : 'translatorOff');
    $('themeBtn').textContent = resolveTheme() === 'dark' ? '☀' : '☾';

    $('outgoingEnabled').checked = !!state.outgoingEnabled;
    $('outgoingPanel').classList.toggle('is-off', !state.outgoingEnabled);
    $('replaceOriginal').checked = state.displayMode === 'replace';
    $('translateChannels').checked = state.translateChannels !== false;
    $('translateAnnouncements').checked = state.translateAnnouncements !== false;
    $('translateEvents').checked = state.translateEvents !== false;
    $('targetLangLabel').textContent = langLabel(state.targetLanguage);
    $('outgoingLangLabel').textContent = langLabel(state.outgoingLanguage);
    $('understoodLabel').textContent = state.understoodMode === 'mine' ?
        t('understoodMine') :
        t('understoodSelected', {n: (state.understoodLanguages || []).length});
    $('understoodMine').checked = state.understoodMode === 'mine';

    if (globalThis.DB_HOTKEYS) {
      $('hkToggle').textContent = DB_HOTKEYS.label('toggle');
    }

    var svc = state.service || 'free';
    document.querySelectorAll('input[name="service"]').forEach(function(el) {
      el.checked = el.value === svc;
    });
    document.querySelectorAll('.svc').forEach(function(el) {
      el.classList.toggle('is-on', el.getAttribute('data-svc') === svc);
    });

    var deeplStatus = $('deeplStatus');
    deeplStatus.textContent = state.deeplKeyPresent ?
        t('deeplSaved') : t('deeplNeedKey');
    deeplStatus.classList.toggle('warn', !state.deeplKeyPresent);

    var aiStatus = $('aiStatus');
    if (state.aiKeyPresent && state.aiBaseUrl && state.aiModel) {
      aiStatus.textContent = t('aiReady', {model: state.aiModel});
      aiStatus.classList.remove('warn');
    } else {
      aiStatus.textContent = t('aiNotSet');
      aiStatus.classList.add('warn');
    }

    $('providerLabel').textContent = providerName(state.aiProviderId) ||
        (state.aiBaseUrl ? t('custom') : t('choose'));
    $('modelLabel').textContent = state.aiModel || t('choose');
    updateTokenDanceUi();

    renderStyleDots();
    renderColorDots();
    renderFontDots();
  }

  function providerName(id) {
    var p = dbFindAiProvider ? dbFindAiProvider(id) :
        DB_AI_PROVIDERS.find(function(x) { return x.id === id; });
    if (!p) return '';
    return dbProviderDisplayName ? dbProviderDisplayName(p, locale) : p.name;
  }

  function currentProvider() {
    return dbFindAiProvider ? dbFindAiProvider(state.aiProviderId) :
        DB_AI_PROVIDERS.find(function(x) { return x.id === state.aiProviderId; });
  }

  function isTokenDanceSelected() {
    var p = currentProvider();
    if (p && p.oauth) return true;
    return dbIsTokenDanceProvider ?
        dbIsTokenDanceProvider(state.aiProviderId || state.aiBaseUrl) : false;
  }

  function setTdStatus(key, isWarn) {
    var el = $('tdOauthStatus');
    if (!key) {
      el.hidden = true;
      el.textContent = '';
      return;
    }
    el.hidden = false;
    el.textContent = t(key);
    el.classList.toggle('warn', !!isWarn);
  }

  function updateTokenDanceUi() {
    var on = isTokenDanceSelected();
    $('tdOauthBox').hidden = !on;
    if (!on) setTdStatus(null);
  }

  async function ensureTokenDancePermission() {
    return requestOrigins(['https://tokendance.space/*']);
  }

  async function loadCachedTokenDanceModels() {
    var data = await chrome.storage.local.get(['tokendanceModels']);
    return Array.isArray(data.tokendanceModels) ? data.tokendanceModels : [];
  }

  function modelIdsForProvider(provider, live) {
    var seed = provider && provider.models ? provider.models.slice() : [];
    if (!provider || !provider.liveModels || !live || !live.length) return seed;
    var seen = Object.create(null);
    var out = [];
    seed.forEach(function(id) {
      if (seen[id]) return;
      seen[id] = true;
      out.push(id);
    });
    live.forEach(function(m) {
      var id = typeof m === 'string' ? m : m.id;
      if (!id || seen[id]) return;
      seen[id] = true;
      out.push(id);
    });
    return out;
  }

  function renderStyleDots() {
    var host = $('styleDots');
    host.innerHTML = '';
    DB_STYLES.forEach(function(s) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'style-chip' +
          (state.translationStyle === s.id ? ' active' : '');
      btn.dataset.id = s.id;
      btn.textContent = t(s.labelKey);
      btn.title = t(s.labelKey);
      btn.addEventListener('click', function() {
        persist({translationStyle: s.id}).then(renderMain);
      });
      host.appendChild(btn);
    });
  }

  function renderColorDots() {
    var host = $('colorDots');
    host.innerHTML = '';
    DB_TEXT_COLORS.forEach(function(c) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'dot' + (state.textColor === c.id ? ' active' : '');
      btn.dataset.id = c.id;
      btn.title = t(c.labelKey);
      if (c.id === 'auto') {
        btn.classList.add('dot-auto');
        btn.textContent = 'A';
      } else {
        btn.style.background = c.css || '#dbdee1';
      }
      btn.addEventListener('click', function() {
        persist({textColor: c.id}).then(renderMain);
      });
      host.appendChild(btn);
    });
  }

  function renderFontDots() {
    var host = $('fontDots');
    host.innerHTML = '';
    var fonts = globalThis.DB_FONTS || [];
    fonts.forEach(function(f) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'style-chip font-chip' +
          (state.textFont === f.id ? ' active' : '');
      btn.dataset.id = f.id;
      btn.dataset.font = f.id;
      btn.textContent = t(f.labelKey);
      btn.title = t(f.labelKey);
      if (f.css) btn.style.fontFamily = f.css;
      btn.addEventListener('click', function() {
        persist({textFont: f.id}).then(renderMain);
      });
      host.appendChild(btn);
    });
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function(ch) {
      return ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;',
        '\'': '&#39;'})[ch];
    });
  }

  function renderLangList(query) {
    var list = $('langList');
    list.innerHTML = '';
    var selected = langPickMode === 'outgoing' ?
        state.outgoingLanguage : state.targetLanguage;
    dbFilterLangs(query, locale).forEach(function(lang) {
      var btn = document.createElement('button');
      btn.type = 'button';
      var primary = langLabel(lang.code);
      var secondary = langSecondary(lang.code);
      btn.innerHTML = '<span>' + escapeHtml(primary) + '</span>' +
          '<span class="sec">' + escapeHtml(secondary) +
          (lang.code === selected ? ' <span class="mark">✓</span>' : '') +
          '</span>';
      btn.addEventListener('click', function() {
        var patch = langPickMode === 'outgoing' ?
            {outgoingLanguage: lang.code} : {targetLanguage: lang.code};
        persist(patch).then(function() {
          renderMain();
          goBack();
        });
      });
      list.appendChild(btn);
    });
  }

  function renderUnderstoodList(query) {
    var list = $('understoodList');
    list.innerHTML = '';
    var selected = new Set(state.understoodLanguages || []);
    dbFilterLangs(query, locale).forEach(function(lang) {
      var btn = document.createElement('button');
      btn.type = 'button';
      var on = selected.has(lang.code);
      var primary = langLabel(lang.code);
      var secondary = langSecondary(lang.code);
      btn.innerHTML = '<span>' + escapeHtml(primary) + '</span>' +
          '<span class="sec">' + escapeHtml(secondary) +
          (on ? ' <span class="mark">✓</span>' : '') + '</span>';
      btn.addEventListener('click', function() {
        var next = new Set(state.understoodLanguages || []);
        if (next.has(lang.code)) next.delete(lang.code);
        else next.add(lang.code);
        persist({
          understoodMode: 'custom',
          understoodLanguages: Array.from(next),
        }).then(function() {
          $('understoodMine').checked = false;
          renderMain();
          renderUnderstoodList($('understoodSearch').value);
        });
      });
      list.appendChild(btn);
    });
  }

  function renderProviders() {
    var list = $('providerList');
    list.innerHTML = '';
    DB_AI_PROVIDERS.forEach(function(p) {
      var btn = document.createElement('button');
      btn.type = 'button';
      var label = dbProviderDisplayName ?
          dbProviderDisplayName(p, locale) : p.name;
      btn.innerHTML = '<span><strong>' + escapeHtml(label) +
          '</strong><br><span class="sec">' + escapeHtml(p.baseUrl) +
          '</span></span>' +
          (state.aiProviderId === p.id ? '<span class="mark">✓</span>' : '');
      btn.addEventListener('click', async function() {
        state.aiProviderId = p.id;
        state.aiBaseUrl = p.baseUrl;
        if (!state.aiModel || p.models.indexOf(state.aiModel) < 0) {
          state.aiModel = p.models[0] || '';
        }
        try {
          await requestOrigins([new URL(p.baseUrl).origin + '/*']);
        } catch (e) {
          
        }
        chrome.storage.sync.set({
          aiProviderId: p.id,
          aiBaseUrl: p.baseUrl,
          aiModel: state.aiModel,
        }).then(function() {
          renderMain();
          goBack();
        });
      });
      list.appendChild(btn);
    });
  }

  async function renderModels() {
    var list = $('modelList');
    list.innerHTML = '';
    var provider = currentProvider();
    var live = [];
    var showRefresh = !!(provider && provider.liveModels);
    $('tdRefreshWrap').hidden = !showRefresh;
    if (showRefresh) {
      live = await loadCachedTokenDanceModels();
    }
    var models = modelIdsForProvider(provider, live);
    var nameById = Object.create(null);
    live.forEach(function(m) {
      if (m && m.id) nameById[m.id] = m.name || m.id;
    });
    models.forEach(function(m) {
      var btn = document.createElement('button');
      btn.type = 'button';
      var label = nameById[m] && nameById[m] !== m ?
          m + ' · ' + nameById[m] : m;
      btn.innerHTML = '<span>' + escapeHtml(label) + '</span>' +
          (state.aiModel === m ? '<span class="mark">✓</span>' : '');
      btn.addEventListener('click', function() {
        persist({aiModel: m}).then(function() {
          renderMain();
          goBack();
        });
      });
      list.appendChild(btn);
    });
  }

  async function requestOrigins(origins) {
    return chrome.runtime.sendMessage({
      type: 'request-permission',
      origins: origins,
    });
  }

  async function onServiceChange(svc) {
    if (svc === 'edgevolc') {
      await requestOrigins([
        'https://edge.microsoft.com/*',
        'https://translate.volcengine.com/*',
      ]);
    }
    if (svc === 'deepl') {
      await requestOrigins([
        'https://api-free.deepl.com/*',
        'https://api.deepl.com/*',
      ]);
    }
    if (svc === 'ai' && state.aiBaseUrl) {
      try {
        await requestOrigins([new URL(state.aiBaseUrl).origin + '/*']);
      } catch (e) {
        
      }
    }
    await persist({service: svc});
    renderMain();
  }

  function pingContentScript() {
    chrome.tabs.query({
      active: true,
      currentWindow: true,
      url: [
        'https://discord.com/*',
        'https://ptb.discord.com/*',
        'https://canary.discord.com/*',
      ],
    }, function(tabs) {
      if (!tabs || !tabs.length) {
        setCsHint('openDiscordHint');
        return;
      }
      chrome.tabs.sendMessage(tabs[0].id, {type: 'db-ping'}, function(res) {
        if (chrome.runtime.lastError || !res || !res.ok) {
          setCsHint('reloadHint');
          chrome.runtime.sendMessage({
            type: 'db-prime-tabs',
            tabIds: [tabs[0].id],
          });
        } else {
          setCsHint(null);
        }
      });
    });
  }

  async function load() {
    var data = await chrome.storage.sync.get(null);
    Object.keys(state).forEach(function(k) {
      if (data[k] !== undefined) state[k] = data[k];
    });

    var normalizedId = dbNormalizeAiProviderId ?
        dbNormalizeAiProviderId(state.aiProviderId) : state.aiProviderId;
    if (normalizedId && normalizedId !== state.aiProviderId) {
      state.aiProviderId = normalizedId;
      var td = dbFindAiProvider ? dbFindAiProvider('tokendance') : null;
      var patch = {aiProviderId: 'tokendance'};
      if (td) {
        state.aiBaseUrl = td.baseUrl;
        patch.aiBaseUrl = td.baseUrl;
      }
      chrome.storage.sync.set(patch);
    }

    if (state.translationStyle === 'blurple' ||
        state.translationStyle === 'green' ||
        state.translationStyle === 'orange') {
      state.translationStyle = 'code';
      chrome.storage.sync.set({translationStyle: 'code'});
    }
    renderMain();
    pingContentScript();
  }

  document.querySelectorAll('[data-back]').forEach(function(btn) {
    btn.addEventListener('click', goBack);
  });

  $('themeBtn').addEventListener('click', function() {
    var cur = resolveTheme();
    persist({theme: cur === 'dark' ? 'light' : 'dark'}).then(renderMain);
  });
  $('aboutBtn').addEventListener('click', function() {
    showScreen('screenAbout');
  });

  $('openUiLang').addEventListener('click', function() {
    $('uiLangSearch').value = '';
    renderUiLangList('');
    showScreen('screenUiLang');
  });
  $('uiLangSearch').addEventListener('input', function() {
    renderUiLangList($('uiLangSearch').value);
  });

  $('enabled').addEventListener('change', function() {
    persist({enabled: $('enabled').checked}).then(renderMain);
  });
  $('outgoingEnabled').addEventListener('change', function() {
    persist({outgoingEnabled: $('outgoingEnabled').checked}).then(renderMain);
  });
  $('replaceOriginal').addEventListener('change', function() {
    persist({
      displayMode: $('replaceOriginal').checked ? 'replace' : 'append',
    });
  });
  $('translateChannels').addEventListener('change', function() {
    persist({translateChannels: $('translateChannels').checked})
        .then(renderMain);
  });
  $('translateAnnouncements').addEventListener('change', function() {
    persist({translateAnnouncements: $('translateAnnouncements').checked})
        .then(renderMain);
  });
  $('translateEvents').addEventListener('change', function() {
    persist({translateEvents: $('translateEvents').checked})
        .then(renderMain);
  });

  $('openTargetLang').addEventListener('click', function() {
    langPickMode = 'target';
    $('langTitle').textContent = t('translateTo');
    $('langSearch').value = '';
    renderLangList('');
    showScreen('screenLang');
  });
  $('openOutgoingLang').addEventListener('click', function() {
    langPickMode = 'outgoing';
    $('langTitle').textContent = t('outgoingTo');
    $('langSearch').value = '';
    renderLangList('');
    showScreen('screenLang');
  });
  $('langSearch').addEventListener('input', function() {
    renderLangList($('langSearch').value);
  });

  $('openUnderstood').addEventListener('click', function() {
    $('understoodSearch').value = '';
    renderUnderstoodList('');
    showScreen('screenUnderstood');
  });
  $('understoodMine').addEventListener('change', function() {
    if ($('understoodMine').checked) {
      persist({understoodMode: 'mine', understoodLanguages: []})
          .then(renderMain);
    } else {
      persist({understoodMode: 'custom'}).then(renderMain);
    }
  });
  $('understoodSearch').addEventListener('input', function() {
    renderUnderstoodList($('understoodSearch').value);
  });

  document.querySelectorAll('input[name="service"]').forEach(function(el) {
    el.addEventListener('change', function() {
      if (el.checked) onServiceChange(el.value);
    });
  });

  $('saveDeepl').addEventListener('click', async function() {
    await requestOrigins([
      'https://api-free.deepl.com/*',
      'https://api.deepl.com/*',
    ]);
    var key = $('deeplKey').value.trim();
    var res = await chrome.runtime.sendMessage({
      type: 'save-deepl-key',
      key: key,
    });
    if (res && res.ok) {
      state.deeplKeyPresent = !!key;
      $('deeplKey').value = '';
      await persist({service: 'deepl'});
      renderMain();
    }
  });

  $('openAiSetup').addEventListener('click', function(e) {
    e.preventDefault();
    e.stopPropagation();
    updateTokenDanceUi();
    showScreen('screenAi');
  });
  $('openProvider').addEventListener('click', function() {
    renderProviders();
    showScreen('screenProvider');
  });
  $('openModel').addEventListener('click', function() {
    renderModels().then(function() {
      showScreen('screenModel');
    });
  });
  $('useCustomBase').addEventListener('click', function() {
    var url = $('customBaseUrl').value.trim();
    if (!url) return;
    persist({aiProviderId: 'custom', aiBaseUrl: url}).then(function() {
      renderMain();
      goBack();
    });
  });
  $('useCustomModel').addEventListener('click', function() {
    var m = $('customModel').value.trim();
    if (!m) return;
    persist({aiModel: m}).then(function() {
      renderMain();
      goBack();
    });
  });
  $('tdAuthorize').addEventListener('click', async function() {
    await ensureTokenDancePermission();
    setTdStatus('tdOauthOpening', false);
    var res = await chrome.runtime.sendMessage({type: 'tokendance-oauth-start'});
    if (res && res.ok) setTdStatus('tdOauthPaste', false);
    else setTdStatus('tdOauthFail', true);
  });
  $('tdExchange').addEventListener('click', async function() {
    await ensureTokenDancePermission();
    setTdStatus('tdOauthExchanging', false);
    var res = await chrome.runtime.sendMessage({
      type: 'tokendance-oauth-exchange',
      code: $('tdAuthCode').value.trim(),
    });
    if (res && res.ok) {
      state.aiKeyPresent = true;
      $('tdAuthCode').value = '';
      $('aiKey').value = '';
      setTdStatus('tdOauthOk', false);
      await chrome.storage.sync.set({
        aiBaseUrl: state.aiBaseUrl || 'https://tokendance.space/gateway/v1',
        aiProviderId: state.aiProviderId || 'tokendance',
        aiModel: state.aiModel || 'deepseek-v4-flash-0731',
        aiKeyPresent: true,
        service: 'ai',
      });
      Object.assign(state, {
        aiKeyPresent: true,
        service: 'ai',
        aiBaseUrl: state.aiBaseUrl || 'https://tokendance.space/gateway/v1',
        aiProviderId: state.aiProviderId || 'tokendance',
        aiModel: state.aiModel || 'deepseek-v4-flash-0731',
      });
      renderMain();
    } else {
      var err = res && res.error;
      if (err === 'no-verifier' || err === 'expired') setTdStatus('tdOauthNeedAuth', true);
      else if (err === 'no-permission') setTdStatus('tdOauthNeedPerm', true);
      else setTdStatus('tdOauthFail', true);
    }
  });
  $('tdRefreshModels').addEventListener('click', async function() {
    await ensureTokenDancePermission();
    var btn = $('tdRefreshModels');
    btn.disabled = true;
    var res = await chrome.runtime.sendMessage({type: 'tokendance-fetch-models'});
    btn.disabled = false;
    if (res && res.ok) await renderModels();
  });
  $('saveAi').addEventListener('click', async function() {
    var base = state.aiBaseUrl;
    if (!base) return;
    try {
      var origin = new URL(
          /^https?:\/\//i.test(base) ? base : 'https://' + base).origin;
      await requestOrigins([origin + '/*']);
    } catch (e) {
      return;
    }
    var typed = $('aiKey').value.trim();
    var res = await chrome.runtime.sendMessage({
      type: 'save-ai-key',
      baseUrl: base,
      model: state.aiModel,
      providerId: state.aiProviderId,
      key: typed,
      keepExisting: !typed && isTokenDanceSelected(),
    });
    if (res && res.ok) {
      state.aiKeyPresent = res.keyPresent !== false;
      $('aiKey').value = '';
      await persist({service: 'ai'});
      renderMain();
      goBack();
    }
  });

  load();
})();

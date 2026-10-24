'use strict';

(function() {
  if (globalThis.DB_HOTKEYS) return;

  function isMac() {
    try {
      var nav = globalThis.navigator || {};
      var platform = (nav.userAgentData && nav.userAgentData.platform) ||
          nav.platform || '';
      return /mac/i.test(platform);
    } catch (e) {
      return false;
    }
  }

  var IS_MAC = isMac();

  
  function matchHotkey(e, mac) {
    if (mac === undefined) mac = IS_MAC;
    if (!e || !e.altKey || e.metaKey) return null;
    if (typeof e.getModifierState === 'function' &&
        e.getModifierState('AltGraph')) {
      return null;
    }
    if (mac ? !e.ctrlKey : e.ctrlKey) return null;
    var key = String(e.key || '').toLowerCase();
    if (e.code === 'KeyT' || key === 't') return 'toggle';
    if (e.code === 'KeyO' || key === 'o') return 'outgoing';
    return null;
  }

  function label(action, mac) {
    if (mac === undefined) mac = IS_MAC;
    var letter = action === 'outgoing' ? 'O' : 'T';
    return mac ? ('\u2303\u2325' + letter) : ('Alt+' + letter);
  }

  globalThis.DB_HOTKEYS = Object.freeze({IS_MAC: IS_MAC, matchHotkey: matchHotkey, label: label});
})();

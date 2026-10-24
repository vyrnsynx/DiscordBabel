'use strict';

// MAIN world
(function() {
  if (window.__dbMentionBridgeV1) return;
  window.__dbMentionBridgeV1 = true;

  var REQUEST_EVENT = 'db-stamp-mentions-v1';
  var REF_ATTR = 'data-db-mention-ref';
  var SNOWFLAKE_RE = /^\d{17,20}$/;

  function modelNodeOf(el, field) {
    var fiber = null;
    try {
      var key = Object.keys(el).find(function(k) {
        return k.indexOf('__reactFiber$') === 0;
      });
      fiber = key ? el[key] : null;
    } catch (e) {
      return null;
    }
    for (var hop = 0; fiber && hop < 8; hop++, fiber = fiber.return) {
      if (fiber.stateNode === field) break;
      var node = fiber.memoizedProps && fiber.memoizedProps.element;
      if (node && typeof node === 'object' && typeof node.type === 'string' &&
          Array.isArray(node.children)) {
        return node;
      }
    }
    return null;
  }

  function refFor(node) {
    if (!node || typeof node !== 'object') return null;
    var type = String(node.type || '');
    function idOf(field) {
      var v = String(node[field] || '');
      return SNOWFLAKE_RE.test(v) ? v : null;
    }
    if (/user/i.test(type) && idOf('userId')) return '<@' + idOf('userId') + '>';
    if (/role/i.test(type) && idOf('roleId')) return '<@&' + idOf('roleId') + '>';
    if (/channel/i.test(type) && idOf('channelId')) {
      return '<#' + idOf('channelId') + '>';
    }
    return null;
  }

  function stamp() {
    var fields = document.querySelectorAll(
        '[role="textbox"][contenteditable="true"]');
    for (var i = 0; i < fields.length; i++) {
      var field = fields[i];
      var voids;
      try {
        voids = field.querySelectorAll('[data-slate-void="true"]');
      } catch (e) {
        continue;
      }
      for (var j = 0; j < voids.length; j++) {
        var el = voids[j];
        var ref = refFor(modelNodeOf(el, field));
        if (ref) el.setAttribute(REF_ATTR, ref);
        else el.removeAttribute(REF_ATTR);
      }
    }
  }

  document.addEventListener(REQUEST_EVENT, function() {
    try {
      stamp();
    } catch (e) {
      
    }
  }, true);
})();

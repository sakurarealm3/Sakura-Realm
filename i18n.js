/* Sakura Realm - language switcher (English / မြန်မာ)
   How it works: the page is written in English. When Myanmar is chosen, every visible text (also the text that script.js
   creates later) is swapped through the dictionary below. English is restored from the saved originals.
   Anything inside [data-no-i18n] (the header brand "SAKURA REALM Manga World", the language names) is never touched. */
(function () {
    'use strict';
    var KEY = 'sakura_lang_v1';
    var pack = (window.SakuraLangPack && window.SakuraLangPack.my) || { dict: {}, patterns: [] };
    var D = pack.dict, P = pack.patterns;
    if (pack.legal) window.LEGAL_DOCS_MY = pack.legal;

    // ------------------------------------------------------------------ engine
    var lower = {};
    function indexLower() { lower = {}; Object.keys(D).forEach(function (k) { lower[k.toLowerCase()] = D[k]; }); }
    indexLower();
    var missing = {}, DEBUG = false;
    try { DEBUG = /[?&]i18n=debug/.test(location.search) || localStorage.getItem('sakura_i18n_debug') === '1'; } catch (e) {}

    function tr(raw) {                                   // returns translated string or null
        var s = String(raw).replace(/\s+/g, ' ').trim();
        if (!s || !/[A-Za-z]/.test(s)) return null;
        if (Object.prototype.hasOwnProperty.call(D, s)) return D[s];
        var lc = s.toLowerCase();
        if (Object.prototype.hasOwnProperty.call(lower, lc)) return lower[lc];
        for (var i = 0; i < P.length; i++) {
            var m = P[i][0].exec(s);
            if (m) return P[i][1](m, function (x) { var r = tr(x); return r == null ? x : r; });
        }
        if (lang === 'my' && s.length < 160 && s.replace(/[^A-Za-z]/g, '').length > 3 && !missing[s]) {          // untranslated text: remember it so it can be filled in later
            missing[s] = 1;
            if (DEBUG && window.console) console.warn('[i18n] no Myanmar text for: "' + s + '"');
        }
        return null;
    }

    var txt = new WeakMap(), att = new WeakMap();
    var ATTRS = ['title', 'placeholder', 'aria-label'];
    var SKIP = { SCRIPT: 1, STYLE: 1, TEXTAREA: 1, NOSCRIPT: 1, CANVAS: 1, SVG: 1 };
    var lang = 'en', obs = null;

    function blocked(el) {
        while (el && el.nodeType === 1) {
            if (SKIP[el.tagName] || SKIP[el.tagName.toUpperCase()] || el.hasAttribute('data-no-i18n')) return true;
            el = el.parentElement;
        }
        return false;
    }

    function doText(n) {
        var cur = n.nodeValue, rec = txt.get(n);
        if (rec && cur === rec.a) return;
        var pe = n.parentElement, inline = pe && pe.getAttribute && pe.getAttribute('data-i18n-my');
        var r = inline && /\S/.test(cur) ? inline : tr(cur);     // data-i18n-my="..." on an element wins
        if (r == null || blocked(pe)) { if (rec) txt.delete(n); return; }
        var out = cur.match(/^\s*/)[0] + r + cur.match(/\s*$/)[0];
        txt.set(n, { o: cur, a: out });
        n.nodeValue = out;
    }
    function doAttr(el, a) {
        var cur = el.getAttribute(a);
        if (cur == null) return;
        var map = att.get(el) || {}, rec = map[a];
        if (rec && cur === rec.a) return;
        var r = tr(cur);
        if (r == null || blocked(el)) { if (rec) { delete map[a]; } return; }
        map[a] = { o: cur, a: r };
        att.set(el, map);
        el.setAttribute(a, r);
    }
    function walk(root) {
        if (!root) return;
        if (root.nodeType === 3) { doText(root); return; }
        if (root.nodeType !== 1 && root.nodeType !== 9 && root.nodeType !== 11) return;
        if (root.nodeType === 1) {
            if (blocked(root)) return;
            ATTRS.forEach(function (a) { doAttr(root, a); });
        }
        var base = root.nodeType === 9 ? root.body : root;
        var tw = document.createTreeWalker(base, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
            acceptNode: function (x) {       // REJECT on an element skips its whole subtree
                return (x.nodeType === 1 && (x.hasAttribute('data-no-i18n') || SKIP[x.tagName.toUpperCase()]))
                    ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
            }
        });
        var n;
        while ((n = tw.nextNode())) {
            if (n.nodeType === 3) doText(n);
            else ATTRS.forEach(function (a) { doAttr(n, a); });
        }
    }

    function restore(root) {
        var tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, null), n;
        var each = function (node) {
            if (node.nodeType === 3) {
                var rec = txt.get(node);
                if (rec) { if (node.nodeValue === rec.a) node.nodeValue = rec.o; txt.delete(node); }
            } else {
                var map = att.get(node);
                if (map) {
                    Object.keys(map).forEach(function (a) { if (node.getAttribute(a) === map[a].a) node.setAttribute(a, map[a].o); });
                    att.delete(node);
                }
            }
        };
        each(root);
        while ((n = tw.nextNode())) each(n);
    }

    function startObserver() {
        if (obs || !window.MutationObserver) return;
        obs = new MutationObserver(function (list) {
            for (var i = 0; i < list.length; i++) {
                var r = list[i];
                if (r.type === 'characterData') doText(r.target);
                else if (r.type === 'attributes') doAttr(r.target, r.attributeName);
                else for (var j = 0; j < r.addedNodes.length; j++) walk(r.addedNodes[j]);
            }
        });
        obs.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });
    }
    function stopObserver() { if (obs) { obs.disconnect(); obs = null; } }

    function syncUI() {
        document.documentElement.setAttribute('lang', lang);
        var cur = document.getElementById('langCurrent');
        if (cur) cur.textContent = lang === 'my' ? 'မြန်မာ' : 'English';
        document.querySelectorAll('#langMenu [data-lang]').forEach(function (li) {
            li.setAttribute('aria-selected', li.getAttribute('data-lang') === lang ? 'true' : 'false');
        });
    }

    function apply(next, save) {
        lang = next === 'my' ? 'my' : 'en';
        if (save) { try { localStorage.setItem(KEY, JSON.stringify(lang)); } catch (e) {} }
        if (typeof window.closeLegal === 'function') { try { window.closeLegal(); } catch (e) {} }
        if (lang === 'my') { document.documentElement.classList.add('lang-my'); walk(document.body); startObserver(); }
        else { stopObserver(); restore(document.body); document.documentElement.classList.remove('lang-my'); }
        syncUI();
    }

    window.sakuraLang = function () { return lang; };
    window.SakuraI18n = {
        lang: function () { return lang; },
        set: function (l) { apply(l, true); },
        // add more words at any time (also from a new feature's own file):  SakuraI18n.add({ 'Save': 'သိမ်းမည်' }, [[/^Page (\d+)$/, function (m) { return 'စာမျက်နှာ ' + m[1]; }]])
        add: function (dict, patterns) {
            if (dict) Object.keys(dict).forEach(function (k) { D[k] = dict[k]; delete missing[k]; });
            if (patterns) patterns.forEach(function (p) { P.push(p); });
            indexLower();
            if (lang === 'my') walk(document.body);
        },
        t: function (text) { var r = lang === 'my' ? tr(text) : null; return r == null ? text : r; },   // for text built in code
        missing: function () { return Object.keys(missing); },
        exportMissing: function () {
            var out = Object.keys(missing).map(function (k) { return "        '" + k.replace(/'/g, "\\'") + "': ''," ; }).join('\n');
            if (window.console) console.log(out || '(nothing missing)');
            return out;
        }
    };
    window.setSakuraLanguage = function (l) { apply(l, true); };

    // ------------------------------------------------------------------ language box (Settings > User Setting)
    function initBox() {
        var box = document.getElementById('langBox'), trg = document.getElementById('langTrigger'), menu = document.getElementById('langMenu');
        if (!box || !trg || !menu) return;
        var setOpen = function (o) { box.classList.toggle('open', o); trg.setAttribute('aria-expanded', o ? 'true' : 'false'); };
        trg.addEventListener('click', function (e) { e.stopPropagation(); setOpen(!box.classList.contains('open')); });
        menu.addEventListener('click', function (e) {
            var li = e.target.closest('[data-lang]');
            if (!li) return;
            e.stopPropagation();
            apply(li.getAttribute('data-lang'), true);
            setOpen(false);
        });
        menu.addEventListener('keydown', function (e) {
            if (e.key !== 'Enter' && e.key !== ' ') return;
            var li = e.target.closest('[data-lang]'); if (!li) return;
            e.preventDefault(); apply(li.getAttribute('data-lang'), true); setOpen(false); trg.focus();
        });
        document.addEventListener('pointerdown', function (e) { if (!box.contains(e.target)) setOpen(false); }, true);
        document.addEventListener('keydown', function (e) { if (e.key === 'Escape') setOpen(false); });
    }

    function boot() {
        var saved = 'en';
        try { var v = JSON.parse(localStorage.getItem(KEY)); if (v === 'my' || v === 'en') saved = v; } catch (e) {}
        initBox();
        apply(saved, false);
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();

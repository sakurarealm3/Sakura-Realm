/* Jelly touch effect for the Home hero character (Reze / adult) and the History character (Makima / adult).
   Touch or drag the picture: the spot you touch bends WITH your finger and wobbles back like jelly.
   The picture itself never changes position - only the bit near your finger deforms.

   >>> Want more / less wobble?  Change JELLY_STRENGTH below  (1 = normal, 1.5 = more, 0.7 = less) <<<   */
(function () {
    'use strict';
    var JELLY_STRENGTH = 0.35;   // how far the picture bends under your finger (slightly stronger than before)
    var JELLY_WOBBLE   = 0.7;    // how long it keeps wobbling after you let go (1 = normal, 1.5 = longer)
    var JELLY_REACH    = 0.1;   // how wide the bent area is (fraction of the picture size)

    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    var GX = 14, GY = 18;        // mesh resolution
    var MAXTEX = 1600;

    var VS = 'attribute vec2 p;attribute vec2 t;varying vec2 v;void main(){v=t;gl_Position=vec4(p,0.,1.);}';
    var FS = 'precision mediump float;uniform sampler2D s;varying vec2 v;void main(){gl_FragColor=texture2D(s,v);}';

    function sh(gl, type, src) { var s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return s; }

    function Jelly(canvas, getRect, fitCss) {
        var self = this;
        this.canvas = canvas; this.getRect = getRect;
        var gl = canvas.getContext('webgl', { premultipliedAlpha: true, alpha: true, antialias: false });
        if (!gl) { this.ok = false; return; }
        this.ok = true; this.gl = gl;
        var pr = gl.createProgram();
        gl.attachShader(pr, sh(gl, gl.VERTEX_SHADER, VS)); gl.attachShader(pr, sh(gl, gl.FRAGMENT_SHADER, FS));
        gl.linkProgram(pr); gl.useProgram(pr);
        this.aP = gl.getAttribLocation(pr, 'p'); this.aT = gl.getAttribLocation(pr, 't');
        this.pBuf = gl.createBuffer(); this.tBuf = gl.createBuffer(); this.iBuf = gl.createBuffer();
        var n = (GX + 1) * (GY + 1);
        this.n = n;
        this.bx = new Float32Array(n); this.by = new Float32Array(n);       // base position in picture units 0..1
        this.dx = new Float32Array(n); this.dy = new Float32Array(n);       // displacement (picture units)
        this.vx = new Float32Array(n); this.vy = new Float32Array(n);
        this.pos = new Float32Array(n * 2); var uv = new Float32Array(n * 2);
        for (var j = 0, k = 0; j <= GY; j++) for (var i = 0; i <= GX; i++, k++) {
            this.bx[k] = i / GX; this.by[k] = j / GY; uv[k * 2] = i / GX; uv[k * 2 + 1] = j / GY;
        }
        var idx = [];
        for (j = 0; j < GY; j++) for (i = 0; i < GX; i++) {
            var a = j * (GX + 1) + i, b = a + 1, c = a + GX + 1, d = c + 1;
            idx.push(a, b, c, b, d, c);
        }
        this.cnt = idx.length;
        gl.bindBuffer(gl.ARRAY_BUFFER, this.tBuf); gl.bufferData(gl.ARRAY_BUFFER, uv, gl.STATIC_DRAW);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.iBuf); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(idx), gl.STATIC_DRAW);
        this.tex = gl.createTexture();
        this.ready = false; this.raf = 0; this.down = false; this.lastT = 0; this.energy = 0;
        this.rect = { x: 0, y: 0, w: 1, h: 1 };       // picture rectangle inside the canvas, in canvas pixels
        this.pointer = null;

        function pt(e) {
            var r = canvas.getBoundingClientRect();
            return { x: (e.clientX - r.left) / (r.width || 1), y: (e.clientY - r.top) / (r.height || 1), w: r.width || 1, h: r.height || 1, cx: e.clientX, cy: e.clientY };
        }
        function toPic(q) {                                  // canvas fraction -> picture fraction
            var cw = canvas.width, ch = canvas.height, R = self.rect;
            return { x: (q.x * cw - R.x) / R.w, y: (q.y * ch - R.y) / R.h };
        }
        canvas.addEventListener('pointerdown', function (e) {
            if (!self.ready) return;
            self.down = true; self.moved = 0;
            try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
            var q = pt(e); self.pointer = { id: e.pointerId, q: q, cx: e.clientX, cy: e.clientY };
            var p = toPic(q); self.poke(p.x, p.y, 0, 0.012 * JELLY_STRENGTH, 0);   // a little press "squish"
            self.kick();
        });
        canvas.addEventListener('pointermove', function (e) {
            var P = self.pointer; if (!self.down || !P || P.id !== e.pointerId) return;
            var q = pt(e), R = self.rect, k = canvas.width / (q.w);   // css px -> canvas px
            var dxp = (e.clientX - P.cx) * k / R.w, dyp = (e.clientY - P.cy) * k / R.h;   // finger movement in picture units
            self.moved += Math.abs(e.clientX - P.cx) + Math.abs(e.clientY - P.cy);
            P.cx = e.clientX; P.cy = e.clientY; P.q = q;
            var p = toPic(q); self.poke(p.x, p.y, dxp, dyp, 1);
            self.kick();
        });
        function up(e) {
            var P = self.pointer; if (!P || P.id !== e.pointerId) return;
            self.down = false; self.pointer = null; self.kick();
        }
        canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
        // a drag is not a tap: stop it from opening the card behind the picture
        canvas.addEventListener('click', function (e) { if (self.moved > 8) { e.stopPropagation(); e.preventDefault(); } self.moved = 0; }, true);
    }

    // push the mesh around the touch point in the direction the finger moves
    Jelly.prototype.poke = function (px, py, mx, my, hold) {
        var s = JELLY_STRENGTH, sx = JELLY_REACH, sy = JELLY_REACH * this.rect.w / this.rect.h;   // round falloff in screen terms
        var lim = 0.30 * s;
        for (var k = 0; k < this.n; k++) {
            var ex = (this.bx[k] - px) / sx, ey = (this.by[k] - py) / sy;
            var w = Math.exp(-(ex * ex + ey * ey) * 0.5);
            if (w < 0.02) continue;
            this.dx[k] = Math.max(-lim, Math.min(lim, this.dx[k] + mx * w * s * 1.15));
            this.dy[k] = Math.max(-lim, Math.min(lim, this.dy[k] + my * w * s * 1.15));
            this.vx[k] += mx * w * s * 0.35; this.vy[k] += my * w * s * 0.35;
        }
    };

    Jelly.prototype.kick = function () {
        if (this.raf || !this.ready) return;
        var self = this; this.lastT = 0;
        this.raf = requestAnimationFrame(function f(t) { self.raf = 0; self.step(t); });
    };

    Jelly.prototype.step = function (t) {
        var dt = this.lastT ? Math.min(2.5, (t - this.lastT) / 16.667) : 1; this.lastT = t;
        var K = 0.075, C = 0.34, DAMP = 0.042 / JELLY_WOBBLE;       // spring, neighbour coupling (wave), damping
        var W = GX + 1, n = this.n, dx = this.dx, dy = this.dy, vx = this.vx, vy = this.vy, e = 0;
        var ax = new Float32Array(n), ay = new Float32Array(n);
        for (var j = 0, k = 0; j <= GY; j++) for (var i = 0; i <= GX; i++, k++) {
            var sx = 0, sy = 0, c = 0;
            if (i > 0)  { sx += dx[k - 1]; sy += dy[k - 1]; c++; }
            if (i < GX) { sx += dx[k + 1]; sy += dy[k + 1]; c++; }
            if (j > 0)  { sx += dx[k - W]; sy += dy[k - W]; c++; }
            if (j < GY) { sx += dx[k + W]; sy += dy[k + W]; c++; }
            ax[k] = -K * dx[k] + C * (sx / c - dx[k]) * 0.5;
            ay[k] = -K * dy[k] + C * (sy / c - dy[k]) * 0.5;
        }
        for (k = 0; k < n; k++) {
            vx[k] += ax[k] * dt; vy[k] += ay[k] * dt;
            vx[k] *= Math.pow(1 - DAMP * 2.4, dt); vy[k] *= Math.pow(1 - DAMP * 2.4, dt);
            dx[k] += vx[k] * dt; dy[k] += vy[k] * dt;
            e += Math.abs(dx[k]) + Math.abs(dy[k]) + Math.abs(vx[k]) * 8 + Math.abs(vy[k]) * 8;
        }
        this.draw();
        if (this.down || e / n > 0.00025) this.kick();
        else { this.dx.fill(0); this.dy.fill(0); this.vx.fill(0); this.vy.fill(0); this.draw(); }
    };

    Jelly.prototype.draw = function () {
        var gl = this.gl, c = this.canvas, R = this.rect, cw = c.width, ch = c.height, p = this.pos;
        for (var k = 0; k < this.n; k++) {
            var X = R.x + (this.bx[k] + this.dx[k]) * R.w, Y = R.y + (this.by[k] + this.dy[k]) * R.h;
            p[k * 2] = X / cw * 2 - 1; p[k * 2 + 1] = 1 - Y / ch * 2;
        }
        gl.viewport(0, 0, cw, ch); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.pBuf); gl.bufferData(gl.ARRAY_BUFFER, p, gl.DYNAMIC_DRAW);
        gl.enableVertexAttribArray(this.aP); gl.vertexAttribPointer(this.aP, 2, gl.FLOAT, false, 0, 0);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.tBuf);
        gl.enableVertexAttribArray(this.aT); gl.vertexAttribPointer(this.aT, 2, gl.FLOAT, false, 0, 0);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.iBuf);
        gl.bindTexture(gl.TEXTURE_2D, this.tex);
        gl.drawElements(gl.TRIANGLES, this.cnt, gl.UNSIGNED_SHORT, 0);
    };

    Jelly.prototype.setImage = function (img) {       // img: loaded HTMLImageElement
        var gl = this.gl, w = img.naturalWidth, h = img.naturalHeight, s = Math.min(1, MAXTEX / Math.max(w, h));
        var src = img;
        if (s < 1) {
            src = document.createElement('canvas'); src.width = Math.round(w * s); src.height = Math.round(h * s);
            src.getContext('2d').drawImage(img, 0, 0, src.width, src.height);
        }
        gl.bindTexture(gl.TEXTURE_2D, this.tex);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        this.ar = w / h; this.ready = true;
    };

    Jelly.prototype.relayout = function () {
        if (!this.ready) return;
        var r = this.getRect(this);
        if (!r) return;
        this.rect = r; this.dx.fill(0); this.dy.fill(0); this.vx.fill(0); this.vy.fill(0);
        this.draw();
    };

    function loadImg(url, cb, fail) {
        var im = new Image(); im.onload = function () { cb(im); }; im.onerror = fail || function () {}; im.src = url;
    }
    function cssVar(n, d) { var v = parseFloat(getComputedStyle(document.documentElement).getPropertyValue(n)); return isFinite(v) ? v : d; }
    function isAdult() { return document.documentElement.classList.contains('adult-mode'); }

    /* ---------- Home hero: character lives inside .wh-reze as a background picture ---------- */
    function initHero() {
        var box = document.querySelector('.wh-reze'); if (!box || box.__jelly) return;
        var cv = document.createElement('canvas'); cv.className = 'jelly-cv';
        var J = new Jelly(cv); if (!J.ok) return;
        box.__jelly = J; box.appendChild(cv);
        J.getRect = function (j) {
            var bw = box.clientWidth, bh = box.clientHeight; if (!bw || !bh) return null;
            var dpr = Math.min(2, window.devicePixelRatio || 1);
            cv.width = Math.round(bw * dpr); cv.height = Math.round(bh * dpr);
            var ih, ox = 0, oy = 0;
            if (isAdult()) { ih = bh * cssVar('--ah-size', 100) * 1.37 / 100; ox = cssVar('--ah-x', 0); oy = cssVar('--ah-y', 0); } else { ih = bh * cssVar('--nh-size', 100) / 100; ox = cssVar('--nh-x', 0); oy = cssVar('--nh-y', 0); }
            var iw = ih * j.ar;
            return { x: (bw - iw + ox) * dpr, y: oy * dpr, w: iw * dpr, h: ih * dpr };       // = background-size:auto <ih>; position: right + offsets
        };
        var cur = '';
        function off() { return document.documentElement.classList.contains('jelly-off'); }
        function show() { if (J.ready && !off()) box.classList.add('jelly-on'); else box.classList.remove('jelly-on'); }
        function load() {
            // read the picture url with jelly-on removed (otherwise background-image is "none")
            var had = box.classList.contains('jelly-on');
            if (had) box.classList.remove('jelly-on');
            var m = /url\(["']?(.*?)["']?\)/.exec(getComputedStyle(box).backgroundImage || '');
            var url = m && m[1];
            if (!url) { if (had) box.classList.add('jelly-on'); return; }
            if (url === cur && J.ready) { J.relayout(); show(); return; }
            cur = url;
            loadImg(url, function (im) { if (cur !== url) return; J.setImage(im); J.relayout(); show(); });
        }
        load();
        var pend = 0;
        function soon() { if (pend) return; pend = requestAnimationFrame(function () { pend = 0; load(); }); }
        if (window.ResizeObserver) new ResizeObserver(function () { J.relayout(); }).observe(box);
        window.addEventListener('resize', function () { J.relayout(); });
        // class change (adult mode / jelly on-off) or style change (Layout Control vars) -> re-read picture + size, then show the canvas again
        new MutationObserver(function () { soon(); setTimeout(load, 80); }).observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style'] });
    }

    /* ---------- History card: character is an <img class="hx-makima"> ---------- */
    function initHistory() {
        var img = document.querySelector('img.hx-makima'); if (!img || img.__jelly) return;
        var cv = document.createElement('canvas'); cv.className = 'hx-makima hx-jelly jelly-cv';
        var J = new Jelly(cv); if (!J.ok) return;
        img.__jelly = J; img.parentNode.insertBefore(cv, img.nextSibling);
        J.getRect = function (j) { return { x: 0, y: 0, w: cv.width, h: cv.height }; };
        var cur = '';
        function load() {
            var url = img.src; if (!url) return;   // img.src follows the attribute at once (currentSrc still shows the OLD picture until the new one loads)
            if (url === cur) return; cur = url;
            cv.classList.remove('jelly-on'); img.classList.remove('jelly-src');
            loadImg(url, function (im) {
                if (cur !== url) return;
                var s = Math.min(1, 1000 / im.naturalHeight);
                cv.width = Math.round(im.naturalWidth * s); cv.height = Math.round(im.naturalHeight * s);
                J.setImage(im); J.relayout(); cv.classList.add('jelly-on'); img.classList.add('jelly-src');
            }, function () { cv.classList.remove('jelly-on'); });
        }
        load();
        new MutationObserver(load).observe(img, { attributes: true, attributeFilter: ['src'] });
        // jelly switched back on: make sure the canvas is drawn and shown again
        new MutationObserver(function () {
            if (J.ready && !document.documentElement.classList.contains('jelly-off')) { J.relayout(); cv.classList.add('jelly-on'); img.classList.add('jelly-src'); }
        }).observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    }

    function init() { initHero(); initHistory(); }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
    window.addEventListener('load', init);
})();

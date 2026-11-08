// --- Firebase Config & SDK Imports ---
import { initializeApp } from "https://www.gstatic.com/firebasejs/13.0.0/firebase-app.js";
import { getDatabase, ref, onValue, update, increment, set, remove, get as dbGet } from "https://www.gstatic.com/firebasejs/13.0.0/firebase-database.js";
import { getAuth, signInWithEmailAndPassword, signOut as signOutB, onAuthStateChanged as onAuthB } from "https://www.gstatic.com/firebasejs/13.0.0/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyBAyTxN3YWVFzkmyAsd6SWF8f2YYpbc0T8",
  authDomain: "sakura-realm.firebaseapp.com",
  databaseURL: "https://sakura-realm-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "sakura-realm",
  storageBucket: "sakura-realm.firebasestorage.app",
  messagingSenderId: "1033024958998",
  appId: "1:1033024958998:web:5f6dab22aebd6b9fc83b37",
  measurementId: "G-7VZ07WZK6D"
};

const app = initializeApp(firebaseConfig);
const database = getDatabase(app);

// --- Firebase B: User accounts (login only; accounts are created from the Uploader) ---
// Project A (above) keeps manga + images. Project B only handles user login.
const firebaseConfigB = {
  apiKey: "AIzaSyD2D-QH6R-90PTn5mN0OG4QHLT8cCoJaBA",
  authDomain: "sakura-realm-user.firebaseapp.com",
  databaseURL: "https://sakura-realm-user-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "sakura-realm-user",
  storageBucket: "sakura-realm-user.firebasestorage.app",
  messagingSenderId: "685194449190",
  appId: "1:685194449190:web:ac83e1db140662bc5171e7"
};
const appB = initializeApp(firebaseConfigB, "userAuth"); // named app = does not clash with A
const authB = getAuth(appB);
const dbB = getDatabase(appB);
window.sakuraUserAuth = authB;

// --- Coins wallet: locked chapters cost coins; free chapters stay open to everyone ---
const wallet = { uid: null, coins: null, unlocked: {}, plan: null, coinPath: null };
// --- Paid member plan (Firebase B users/{uid}/plan = {type:'paid', months, expiresAt}); kept separate from the Coins plan ---
// Active  -> every chapter opens like a free one (no coin icons). Expired -> locked chapters show a "plan expired" warning.
const memberPaid = () => !!(wallet.uid && wallet.plan && wallet.plan.type === 'paid');
const memberActive = () => memberPaid() && Number(wallet.plan.expiresAt) > Date.now();
const memberExpired = () => memberPaid() && !memberActive();
const memberLabel = (m) => { m = Number(m) || 0; return m === 12 ? '1 Year' : (m + (m === 1 ? ' Month' : ' Months')); };
const memberDate = (ms) => { const d = new Date(Number(ms)); return isNaN(d) ? '' : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }); };
function acRenderPlan() {
    const row = document.getElementById('acPlanRow'); if (!row) return;
    if (!memberPaid()) { row.style.display = 'none'; return; }
    const on = memberActive();
    row.style.display = 'flex';
    row.classList.toggle('is-off', !on);
    document.getElementById('acPlanName').textContent = memberLabel(wallet.plan.months);
    document.getElementById('acPlanState').textContent = on ? 'Active' : 'Not Active';
    document.getElementById('acPlanDate').textContent = wallet.plan.expiresAt ? ((on ? 'Valid until ' : 'Expired on ') + memberDate(wallet.plan.expiresAt)) : '';
}
const coinKey = (m, c) => String(m + '__' + c).replace(/[.#$\[\]\/]/g, '_');
// The coins list lives in Firebase B: chapterPrices/{mangaId__chapterId} = number of coins (written by the Uploader, public read)
const chapterPrices = {};
const coinsOf = (mangaId, chId) => Math.max(0, Math.floor(Number(chapterPrices[coinKey(mangaId, chId)]) || 0));
// Firebase B helpers. Some networks / browsers block the SDK's live connection; Firebase A already falls back to plain HTTPS (REST),
// so B does the same here: reads and the unlock write go over REST when the live connection does not answer in time.
const B_URL = firebaseConfigB.databaseURL;
let bViaRest = false;   // set once the live connection proved unusable: later reads go straight to REST
async function bGet(path) {
    let done = false;
    const sdk = dbGet(ref(dbB, path)).then(s => { done = true; return s.exists() ? s.val() : null; });
    const rest = new Promise((resolve, reject) => setTimeout(async () => {
        if (done) return;
        try {
            const u = authB.currentUser, tok = u ? await u.getIdToken() : null;
            const r = await fetch(`${B_URL}/${path}.json` + (tok ? '?auth=' + encodeURIComponent(tok) : ''), { cache: 'no-store' });
            if (!r.ok) throw new Error('HTTP ' + r.status);
            const v = await r.json(); bViaRest = true; resolve(v);
        } catch (e) { reject(e); }
    }, bViaRest ? 0 : 2500));
    return Promise.any([sdk, rest]);
}
async function bUpdate(multi) {
    let to;
    try {
        await Promise.race([update(ref(dbB), multi), new Promise((_, rej) => { to = setTimeout(() => rej(new Error('sdk-timeout')), bViaRest ? 0 : 6000); })]);
        clearTimeout(to); return;
    } catch (e) { clearTimeout(to); if (!e || e.message !== 'sdk-timeout') throw e; }
    const tok = await authB.currentUser.getIdToken();
    const r = await fetch(`${B_URL}/.json?auth=${encodeURIComponent(tok)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(multi) });
    if (!r.ok) throw new Error('HTTP ' + r.status);
}
let pricesLive = false, pricesSig = null;
const applyPrices = (v) => {
    const sig = JSON.stringify(v || {});
    if (sig === pricesSig) return;                       // nothing changed -> no re-render
    pricesSig = sig;
    Object.keys(chapterPrices).forEach(k => delete chapterPrices[k]);
    Object.assign(chapterPrices, v && typeof v === 'object' ? v : {});
    refreshLocks();
};
onValue(ref(dbB, 'chapterPrices'), (snap) => {
    pricesLive = true;
    applyPrices(snap.exists() ? snap.val() : {});
}, (err) => console.warn('Coins list unavailable:', err && err.code));
const pullPrices = async () => {
    if (pricesLive) return;
    try {
        const r = await fetch(`${B_URL}/chapterPrices.json`, { cache: 'no-store' });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        applyPrices(await r.json());
        bViaRest = true;
    } catch (e) { console.warn('Coins list (REST) unavailable:', e && e.message); }
};
{
    let blocked = false;
    try { blocked = localStorage.getItem('sakura_sdk_blocked') === '1'; } catch (e) {}
    setTimeout(pullPrices, blocked ? 0 : 1500);
    setInterval(pullPrices, 30000);
}
const coinLocked = (mangaId, chId) => coinsOf(mangaId, chId) > 0 && !memberActive() && !wallet.unlocked[coinKey(mangaId, chId)];
const lockBadgeHTML = (mangaId, ch) => {
    const price = coinsOf(mangaId, ch.id);
    if (!price || memberActive()) return '';
    const open = !!wallet.unlocked[coinKey(mangaId, ch.id)];
    return `<span class="cx-badge${open ? ' is-open' : ''}" title="${open ? 'Unlocked' : price + ' coins'}"><i class="fa-solid ${open ? 'fa-lock-open' : 'fa-lock'}"></i><i class="fa-solid fa-coins"></i><b>${price}</b></span>`;
};
function refreshLocks() {
    try { acRenderPlan(); } catch (e) {}
    try { if (currentActiveView === 'detail') renderChapterList(currentDetailId()); } catch (e) {}
    try { const c = document.getElementById('readerPagesContainer'); if (c && c.dataset.cxLocked === '1' && !coinLocked(...c.dataset.cxParam.split('___'))) renderReaderContentInner(c.dataset.cxParam); } catch (e) {}
}
function acRenderCoins() {
    const row = document.getElementById('acCoinsRow'), n = document.getElementById('acCoins');
    if (row && n) { row.style.display = wallet.coins === null ? 'none' : 'flex'; n.textContent = wallet.coins === null ? '0' : wallet.coins; }
}
let cxBusy = false;
function coinAsk({ icon = 'fa-coins', title, text, rows = [], yes = 'Yes', no = 'No' }) {
    if (cxBusy) return Promise.resolve(false);
    cxBusy = true;
    return new Promise((resolve) => {
        const el = document.createElement('div');
        el.className = 'cx-modal';
        el.innerHTML = `<div class="cx-sheet" role="dialog" aria-modal="true"><div class="cx-ico"><i class="fa-solid ${icon}"></i></div><h3>${esc(title)}</h3><p>${esc(text)}</p>` +
            (rows.length ? `<div class="cx-rows">${rows.map(r => `<div><span>${esc(r[0])}</span><b><i class="fa-solid fa-coins"></i> ${esc(r[1])}</b></div>`).join('')}</div>` : '') +
            `<div class="cx-foot"><button type="button" class="cx-no">${esc(no)}</button>${yes ? `<button type="button" class="cx-yes">${esc(yes)}</button>` : ''}</div></div>`;
        const done = (v) => { el.remove(); cxBusy = false; resolve(v); };
        el.addEventListener('click', (e) => { if (e.target === el || e.target.closest('.cx-no')) done(false); else if (e.target.closest('.cx-yes')) done(true); });
        document.body.appendChild(el);
    });
}
async function coinGate(mangaId, chId) {
    const price = coinsOf(mangaId, chId);
    if (!price || wallet.unlocked[coinKey(mangaId, chId)]) return true;
    if (memberActive()) return true;
    if (memberExpired()) {
        acRenderPlan();
        await coinAsk({ icon: 'fa-hourglass-end', title: 'Member plan expired', text: `Your Member Plan (${memberLabel(wallet.plan.months)}) expired on ${memberDate(wallet.plan.expiresAt)}. Please renew your plan to keep reading locked chapters.`, yes: null, no: 'OK' });
        return false;
    }
    if (!wallet.uid) {
        const go = await coinAsk({ icon: 'fa-lock', title: 'Login needed', text: `This chapter costs ${price} coins. Login from the menu to unlock it.`, yes: 'Open menu', no: 'Close' });
        if (go) { const sb = document.getElementById('rightSidebar'); if (sb && sb.classList.contains('translate-x-full')) window.toggleRightSidebar(); }
        return false;
    }
    try { wallet.coins = Number(await bGet(wallet.coinPath || ('coinAccounts/' + wallet.uid + '/coins'))) || 0; acRenderCoins(); } catch (e) {}   // fresh balance (the admin may have topped up)
    const have = wallet.coins || 0;
    if (have < price) { await coinAsk({ icon: 'fa-coins', title: 'Not enough coins', text: `This chapter costs ${price} coins. You have ${have}.`, rows: [['Price', price], ['Your coins', have]], yes: null, no: 'OK' }); return false; }
    const ok = await coinAsk({ icon: 'fa-lock-open', title: 'Unlock this chapter?', text: 'Are you sure you want to open it? The coins will be taken from your account.', rows: [['Price', price], ['Your coins', have], ['After', have - price]], yes: 'Yes, unlock', no: 'No' });
    if (!ok) return false;
    try {
        const left = have - price, key = coinKey(mangaId, chId);
        await bUpdate({ [wallet.coinPath || ('coinAccounts/' + wallet.uid + '/coins')]: left, ['unlocked/' + wallet.uid + '/' + key]: { price, at: Date.now() } });
        wallet.coins = left; wallet.unlocked[key] = { price }; acRenderCoins(); refreshLocks();
        showToast('Chapter unlocked', 'ok');
        return true;
    } catch (err) { showToast('Unlock failed - try again', 'err'); return false; }
}
function renderLockedReader(container, mangaId, chId, ch, param) {
    container.style.height = 'auto'; container.dataset.cxLocked = '1'; container.dataset.cxParam = param;
    container.innerHTML = `<div class="cx-lockcard"><div class="cx-ico"><i class="fa-solid fa-lock"></i></div><h3>${esc(ch.title)}</h3><p>${memberExpired() ? 'Your member plan has expired' : 'This chapter is locked'}</p><button type="button" class="cx-yes">${memberExpired() ? 'View details' : 'Unlock &middot; <i class="fa-solid fa-coins"></i> ' + coinsOf(mangaId, chId)}</button></div>`;
    container.querySelector('.cx-yes').onclick = async () => { if (await coinGate(mangaId, chId)) renderReaderContentInner(param); };
}

// --- Sidebar account UI (Login form <-> User Account) ---
// Accounts are created from the Uploader; only accounts with an active users/{uid} record can log in here.
const acEl = (id) => document.getElementById(id);
const acShow = (loggedIn) => {
    acEl('acLoginView')?.classList.toggle('hidden', loggedIn);
    const pv = acEl('acProfileView');
    if (pv) { pv.classList.toggle('hidden', !loggedIn); pv.classList.toggle('flex', loggedIn); }
};
const acErr = (t) => { const e = acEl('acErr'); if (e) e.textContent = t || ''; };
const acBusy = (b) => { const x = acEl('acBtn'); if (x) { x.disabled = b; x.innerHTML = b ? '<i class="fa-solid fa-circle-notch fa-spin"></i><span>Signing in...</span>' : '<i class="fa-solid fa-right-to-bracket"></i><span>Login</span>'; } };
acEl('acEye')?.addEventListener('click', () => { const i = acEl('acPass'), on = i.type === 'password'; i.type = on ? 'text' : 'password'; const b = acEl('acEye'); b.classList.toggle('on', on); b.innerHTML = '<i class="fa-regular ' + (on ? 'fa-eye-slash' : 'fa-eye') + '"></i>'; });

acEl('acLoginForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    acErr(''); acBusy(true);
    clearTimeout(window.__acLoginTimer);
    window.__acLoginTimer = setTimeout(() => { acBusy(false); acErr('Network ပြဿနာ ရှိနေပါတယ်၊ ပြန်ကြိုးစားပါ'); }, 25000);
    try { await signInWithEmailAndPassword(authB, acEl('acEmail').value.trim(), acEl('acPass').value); }
    catch (err) { clearTimeout(window.__acLoginTimer); acBusy(false); acErr(err && err.code === 'auth/network-request-failed' ? 'Network ပြဿနာ ရှိနေပါတယ်၊ ပြန်ကြိုးစားပါ' : 'Email သို့မဟုတ် password မှားနေပါတယ်'); }
});
acEl('acLogout')?.addEventListener('click', () => signOutB(authB));
window.sakuraLogout = () => signOutB(authB);

onAuthB(authB, async (user) => {
    clearTimeout(window.__acLoginTimer);
    if (!user) { acShow(false); acBusy(false); wallet.uid = null; wallet.coins = null; wallet.unlocked = {}; wallet.plan = null; acRenderCoins(); refreshLocks(); return; }
    try {
        const rec = await bGet('users/' + user.uid);
        if (rec && rec.active !== false) {
            const name = rec.username || user.email.split('@')[0];
            acEl('acName').textContent = name;
            acEl('acMail').textContent = user.email;
            acEl('acAvatar').textContent = name.charAt(0).toUpperCase();
            acEl('acPass').value = '';
            wallet.uid = user.uid;
            // Coins accounts and Paid accounts live in their own nodes of B: coinAccounts/{uid} and paidAccounts/{uid}
            // (old accounts that still carry users/{uid}/plan keep working until the admin re-saves their plan)
            let ca = null, pa = null;
            try { ca = await bGet('coinAccounts/' + user.uid); } catch (e) {}
            try { pa = await bGet('paidAccounts/' + user.uid); } catch (e) {}
            wallet.coinPath = 'coinAccounts/' + user.uid + '/coins';
            if (!ca && !pa && rec.plan) {
                if (rec.plan.type === 'coins') { ca = { coins: rec.plan.coins }; wallet.coinPath = 'users/' + user.uid + '/plan/coins'; }
                else if (rec.plan.type === 'paid') pa = rec.plan;
            }
            wallet.coins = ca ? (Number(ca.coins) || 0) : null;
            wallet.plan = pa ? { type: 'paid', months: Number(pa.months) || 0, expiresAt: Number(pa.expiresAt) || 0 } : null;
            try { wallet.unlocked = (await bGet('unlocked/' + user.uid)) || {}; } catch (e) { wallet.unlocked = {}; }
            acRenderCoins(); refreshLocks();
            acBusy(false); acShow(true);
            return;
        }
        await signOutB(authB);
        wallet.uid = null; wallet.coins = null; wallet.unlocked = {}; wallet.plan = null;
        acShow(false); acBusy(false); acErr('ဒီ account ကို အသုံးပြုခွင့် မရှိပါ');
    } catch (err) {
        await signOutB(authB).catch(() => {});
        acShow(false); acBusy(false); acErr('စစ်ဆေး၍မရပါ၊ ပြန်ကြိုးစားပါ');
    }
});

// Firebase App Check (blocks scripts/bots that call your database outside this site).
// Paste your reCAPTCHA v3 / Enterprise site key here after enabling App Check in the console. Empty = skipped.
const APP_CHECK_SITE_KEY = '';
if (APP_CHECK_SITE_KEY) {
    import("https://www.gstatic.com/firebasejs/13.0.0/firebase-app-check.js")
        .then(({ initializeAppCheck, ReCaptchaV3Provider }) => initializeAppCheck(app, { provider: new ReCaptchaV3Provider(APP_CHECK_SITE_KEY), isTokenAutoRefreshEnabled: true }))
        .catch(e => console.warn('App Check unavailable:', e));
}

// --- Global State & Shared Storage Keys ---
const SHARED_STORAGE_KEY = "sakura_shared_master_mangas_v1";
const PREFS_KEY = "sakura_reader_prefs_v1";
const BOOKMARK_KEY = "sakura_bookmarks_v1";
const USER_SET_KEY = "sakura_user_settings_v1";
// User settings (all OFF by default)
const userSettings = Object.assign({ autoDl: false, keepAwake: false, battery: false, adult: false, jelly: true, lite: undefined }, safeGet(USER_SET_KEY, {}));
delete userSettings.notify; delete userSettings.fcmKey; delete userSettings.fcmAt;
// Low-end Mode: switched on automatically on weak phones (<=2 GB RAM / <=2 CPU cores) until the user chooses
if (typeof userSettings.lite !== 'boolean') {
    userSettings.lite = (navigator.deviceMemory && navigator.deviceMemory <= 2) || (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 2) || false;
}
const perfLow = () => !!(userSettings.battery || userSettings.lite);
let currentViewId = '';
let wakeLock = null;
document.documentElement.classList.toggle('battery-saver', !!userSettings.battery);
document.documentElement.classList.toggle('lite', !!userSettings.lite);
document.documentElement.classList.toggle('jelly-off', userSettings.jelly === false);   // Jelly Touch switch (Settings)
// Adult Content mode: swaps the Home hero character and the History character (images: adult-hero.webp, adult-history.webp)
function applyAdultArt() {
    const on = !!userSettings.adult;
    document.documentElement.classList.toggle('adult-mode', on);
    document.querySelectorAll('img.hx-makima').forEach(img => {
        const want = on ? 'adult-history.webp' : 'makima.webp';
        img.style.visibility = '';
        img.onerror = () => { img.style.visibility = 'hidden'; };       // file not added yet -> show nothing, never the normal character
        if (img.getAttribute('src') !== want) img.setAttribute('src', want);
    });
}
applyAdultArt();
document.addEventListener('DOMContentLoaded', applyAdultArt);

// --- Safe helpers (storage + HTML escaping) ---
function safeGet(key, fallback) {
    try {
        const raw = localStorage.getItem(key);
        if (raw === null) return fallback;
        const v = JSON.parse(raw);
        return v === null || v === undefined ? fallback : v;
    } catch (e) { return fallback; }
}
function safeSet(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); }
    catch (e) { console.warn("localStorage write failed:", e); }
}
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const cssUrl = (u) => 'url("' + String(u == null ? '' : u).replace(/\\/g, '%5C').replace(/"/g, '%22').replace(/'/g, '%27').replace(/\(/g, '%28').replace(/\)/g, '%29').replace(/[\r\n]/g, '') + '")';

// --- Security helpers: anything that comes from the database is untrusted ---
const FALLBACK_COVER = 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?q=80&w=1000';
const safeUrl = (u, fb = '') => {
    try {
        const s = String(u == null ? '' : u).trim();
        if (s.length > 2048 && !/^data:image\//i.test(s)) return fb;
        if (/^data:image\/(webp|png|jpe?g|gif|avif);base64,/i.test(s)) return s;
        const x = new URL(s);
        if (x.protocol === 'https:' || (x.protocol === 'http:' && location.protocol === 'http:')) return x.href;
        return fb;
    } catch (e) { return fb; }
};
const cleanList = (list) => (Array.isArray(list) ? list : []).filter(m => m && typeof m === 'object').map(m => Object.assign({}, m, {
    image: safeUrl(m.image, FALLBACK_COVER),
    chapters: (Array.isArray(m.chapters) ? m.chapters : []).map(c => Object.assign({}, c, {
        pages: (Array.isArray(c.pages) ? c.pages : []).map(pg => ({ data: safeUrl(pg && pg.data) })).filter(pg => pg.data)
    }))
}));

let currentMangaData = [];

// Filter States
let currentReleaseFilter = 'all';
let selectedGenres = [];

// Reader Settings State
let currentReadingMode = 'scroll';
let currentImageQuality = 'high';
let currentPageIndex = 0;
let totalChapterPages = [];

let startX = 0;
let startY = 0;
let currentX = 0;
let isDragging = false;
let isLocked = false;
let containerWidth = 0;
let lastReaderScrollTop = 0;
let searchQuery = '';
let holdOrderUntil = 0;
let readerFromDetail = false;
let genresMode = 'genres';
let genresViewGenre = '';
let lastDragAt = 0;
let readerObserver = null;

let currentActiveView = 'home';
let previousActiveView = '';
// Navigation direction + position in the browser history (so Back/Forward animate the right way)
let navDirection = 'forward';
let navIndex = (history.state && Number.isInteger(history.state.idx)) ? history.state.idx : 0;
let firstViewRendered = false;
let shownDetailId = '';        // which manga the Chapter Lobby is currently showing

// --- Firebase Realtime Database Listener ---
// Your uploader puts the upload time in the id ("manga-1792345862945", "ch-1792345922644")
function idTime(id) {
    const m = String(id || '').match(/(\d{12,13})$/);
    return m ? Number(m[1]) : 0;
}

function chapterNumber(c, key) {
    if (c.chapter_number !== undefined && c.chapter_number !== null && c.chapter_number !== '') {
        const n = Number(c.chapter_number);
        if (Number.isFinite(n)) return n;
    }
    const m = String(c.chapter_title || key).match(/(\d+(?:\.\d+)?)/);
    return m ? Number(m[1]) : NaN;
}

// Normal manga live in  manga_list,  adult manga live in  adult_list  (kept apart in Firebase)
const MAIN_NODE = 'manga_list';
const ADULT_NODE = 'adult_list';
const rawNodes = { [MAIN_NODE]: null, [ADULT_NODE]: null };
const nodeLoaded = { [MAIN_NODE]: false, [ADULT_NODE]: false };

// --- Layout Control: picture size / position set from the Uploader (Firebase node "layoutControl") ---
const LAYOUT_CACHE_KEY = 'sakura_layout_v1';
const LAYOUT_VARS = {
    normal: { hero: ['--nh-size', '--nh-x', '--nh-y'], history: ['--nhist-size', '--nhist-x', '--nhist-y'] },
    adult:  { hero: ['--ah-size', '--ah-x', '--ah-y'],  history: ['--ahist-size', '--ahist-x', '--ahist-y'] }
};
const LAYOUT_LIMITS = { size: [20, 300], x: [-500, 500], y: [-500, 500] };   // safety: only plain numbers inside these limits are applied
function applyLayoutControl(data) {
    if (!data || typeof data !== 'object') return;
    const root = document.documentElement;
    Object.keys(LAYOUT_VARS).forEach(mode => {
        Object.keys(LAYOUT_VARS[mode]).forEach(part => {
            const src = data[mode] && data[mode][part];
            if (!src || typeof src !== 'object') return;
            ['size', 'x', 'y'].forEach((key, i) => {
                const n = Number(src[key]);
                if (!isFinite(n)) return;
                const [lo, hi] = LAYOUT_LIMITS[key];
                root.style.setProperty(LAYOUT_VARS[mode][part][i], String(Math.min(hi, Math.max(lo, n))));
            });
        });
    });
}
try { applyLayoutControl(JSON.parse(localStorage.getItem(LAYOUT_CACHE_KEY) || 'null')); } catch (e) {}   // instant, no flash
function listenToLayoutControl() {
    onValue(ref(database, 'layoutControl'), (snap) => {
        const v = snap.val();
        if (!v) return;
        applyLayoutControl(v);
        try { localStorage.setItem(LAYOUT_CACHE_KEY, JSON.stringify(v)); } catch (e) {}
    }, (err) => console.warn('Layout Control read skipped:', err && err.code));
}

// Some networks / VPNs / browsers block Firebase's WebSocket. The SDK then tries "long polling", which this
// page's Content-Security-Policy does not allow, so the lists stay empty. Safety net: if the SDK has not
// answered within a few seconds (or reports an error), read the same data with a plain HTTPS request instead
// (allowed by connect-src) and keep refreshing it, until the live SDK connection works.
let fbProblem = '';
const sdkLive = { [MAIN_NODE]: false, [ADULT_NODE]: false };
// If nothing arrived after 12 s, tell the reader WHY on screen (instead of a silent empty page) + a Retry button
let gotAnyData = false;
setTimeout(function checkNoData() {
    if (gotAnyData || sdkLive[MAIN_NODE] || sdkLive[ADULT_NODE] || (typeof currentMangaData !== 'undefined' && currentMangaData.length)) return;
    if (document.getElementById('netProblem')) return;
    const b = document.createElement('div');
    b.id = 'netProblem';
    b.style.cssText = 'position:fixed;left:12px;right:12px;bottom:14px;z-index:99999;padding:12px 14px;border-radius:14px;background:#2a1410;color:#ffd9c9;border:1px solid #d9774a;font:13px/1.45 system-ui,sans-serif;box-shadow:0 8px 30px rgba(0,0,0,.5)';
    const reason = fbProblem || 'no answer from the server';
    b.innerHTML = '<b>Cannot load the manga list.</b><br>Your network, VPN, ad-blocker or private DNS may be blocking the database. Try another browser or turn the blocker off.<br><small style="opacity:.75">Reason: ' + String(reason).replace(/[<>&]/g, '') + '</small><div style="margin-top:8px"><button style="padding:6px 14px;border-radius:99px;border:0;background:#d9774a;color:#fff;font-weight:700" onclick="location.reload()">Retry</button> <button style="padding:6px 14px;border-radius:99px;border:1px solid #d9774a;background:none;color:#ffd9c9" onclick="this.closest(\'#netProblem\').remove()">Close</button></div>';
    document.body.appendChild(b);
}, 12000);
const restOn = { [MAIN_NODE]: false, [ADULT_NODE]: false };
const REST_EVERY_MS = 45000;
function startRestFallback(node) {
    if (restOn[node]) return;
    restOn[node] = true;
    try { localStorage.setItem('sakura_sdk_blocked', '1'); } catch (e) {}
    const pull = async () => {
        if (sdkLive[node]) return;                                   // live connection is working: nothing to do
        try {
            const ctl = ('AbortController' in window) ? new AbortController() : null;
            const to = ctl ? setTimeout(() => ctl.abort(), 15000) : null;
            const r = await fetch(`${firebaseConfig.databaseURL}/${node}.json`, { cache: 'no-store', signal: ctl ? ctl.signal : undefined });
            if (to) clearTimeout(to);
            if (!r.ok) throw new Error('HTTP ' + r.status);
            const v = await r.json();
            if (sdkLive[node]) return;
            rawNodes[node] = v;
            nodeLoaded[node] = true;
            gotAnyData = true;
            { const nb = document.getElementById('netProblem'); if (nb) nb.remove(); }
            rebuildMangaData();
        } catch (e) {
            fbProblem = 'REST ' + node + ': ' + ((e && (e.message || e.name)) || e);
            console.warn('Firebase REST fallback failed (' + node + '):', e);
            if (!nodeLoaded[node]) { nodeLoaded[node] = true; rebuildMangaData(); }   // do not wait forever: show the saved copy
        }
    };
    pull();
    setInterval(pull, REST_EVERY_MS);
}

function listenToFirebaseData() {
    const onNode = (node) => {
        // this device already needed the fallback last time -> start it at once; otherwise give the live connection 1.5 s
        let blocked = false;
        try { blocked = localStorage.getItem('sakura_sdk_blocked') === '1'; } catch (e) {}
        setTimeout(() => { if (!sdkLive[node]) startRestFallback(node); }, blocked ? 0 : 1500);
        onValue(ref(database, node), (snapshot) => {
            sdkLive[node] = true; gotAnyData = true;
            try { localStorage.removeItem('sakura_sdk_blocked'); } catch (e) {}
            { const nb = document.getElementById('netProblem'); if (nb) nb.remove(); }
            rawNodes[node] = snapshot.val();
            nodeLoaded[node] = true;
            rebuildMangaData();
        }, (error) => {
            fbProblem = 'SDK ' + node + ': ' + ((error && (error.code || error.message)) || error);
            console.warn('Firebase Read Warning/Fallback (' + node + '):', error);
            rawNodes[node] = null;
            nodeLoaded[node] = true;
            rebuildMangaData();
            startRestFallback(node);
        });
    };
    onNode(MAIN_NODE);
    onNode(ADULT_NODE);
}

function rebuildMangaData() {
    {
        const entries = [];
        [MAIN_NODE, ADULT_NODE].forEach(node => {
            const d = rawNodes[node];
            if (d && typeof d === 'object') Object.keys(d).forEach(k => entries.push({ key: k, node, item: d[k] || {} }));
        });
        if (entries.length) {
            let formattedList = entries.map(({ key, node, item }) => {
                let chaptersArr = [];
                if (item.chapters) {
                    chaptersArr = Object.keys(item.chapters).map(cKey => {
                        const c = item.chapters[cKey] || {};
                        const rawPages = Array.isArray(c.pages) ? c.pages : Object.values(c.pages || {});
                        const created = Number(c.created_at || 0) || idTime(cKey);
                        const d = created ? new Date(created) : null;
                        return {
                            id: cKey,
                            num: chapterNumber(c, cKey),
                            created: created,
                            title: c.chapter_title || `Chapter ${c.chapter_number || cKey}`,
                            date: d && !isNaN(d) ? d.toLocaleDateString() : 'Recent',
                            pages: rawPages.map(pUrl => safeUrl(pUrl)).filter(Boolean).map(pUrl => ({ data: pUrl }))
                        };
                    });
                    // Newest / highest chapter first (so the LAST item is always Chapter 1)
                    chaptersArr.sort((a, b) => {
                        if (Number.isFinite(a.num) && Number.isFinite(b.num) && a.num !== b.num) return b.num - a.num;
                        if (a.created !== b.created) return b.created - a.created;
                        return b.id.localeCompare(a.id, undefined, { numeric: true });
                    });
                }
                const createdAt = Number(item.created_at || item.createdAt || 0) || idTime(key);
                const lastChapterAt = chaptersArr.reduce((mx, c) => Math.max(mx, c.created || 0), 0);
                const latestCh = chaptersArr.reduce((best, c) => (!best || c.created > best.created) ? c : best, null);
                return {
                    id: key,
                    title: item.title || key,
                    image: safeUrl(item.cover_image || item.image, FALLBACK_COVER),
                    coverType: item.coverType || 'Manga',
                    status: item.status || 'Ongoing',
                    rating: item.rating || '4.9 / 5.0',
                    views: Math.max(0, Number(item.views) || 0),
                    createdAt: createdAt,
                    updatedAt: Math.max(createdAt, lastChapterAt),
                    lastChapterAt: lastChapterAt,
                    latestChapterTitle: latestCh ? latestCh.title : '',
                    description: item.description || 'Cinematic Manga Experience desu~',
                    genre: item.genre || 'Action, Fantasy',
                    adult: node === ADULT_NODE || item.adult === true || item.adult === 'true' || item.adult === 1 || item.adult === '1',
                    node: node,
                    chapters: chaptersArr
                };
            });

            if (Date.now() < holdOrderUntil && currentMangaData.length) {
                // Our own view-count write just happened: keep card order stable so the grid doesn't jump
                const idx = new Map(currentMangaData.map((m, i) => [m.id, i]));
                formattedList.sort((a, b) => (idx.has(a.id) ? idx.get(a.id) : 1e9) - (idx.has(b.id) ? idx.get(b.id) : 1e9));
            } else {
                formattedList.sort((a, b) => b.views - a.views);
            }
            currentMangaData = formattedList;
            safeSet(SHARED_STORAGE_KEY, formattedList);
        } else if (nodeLoaded[MAIN_NODE] && nodeLoaded[ADULT_NODE]) {
            // both nodes answered and are empty / unreadable: use the saved copy
            currentMangaData = cleanList(safeGet(SHARED_STORAGE_KEY, []));
        } else {
            return;     // still waiting for the other node
        }
        refreshCurrentView();
        populateFilterGenres();
    }
}

// Every manga (used to look up one manga by id: detail page, reader, history, downloads)
function loadAllMangas() {
    return currentMangaData.length > 0 ? currentMangaData : cleanList(safeGet(SHARED_STORAGE_KEY, []));
}

// Adult content = every manga that lives in the Firebase node  adult_list  (set as m.adult when the list is built)
function isAdultManga(m) {
    return !!(m && m.adult === true);
}

// Lists shown to the person (home, genres, latest, search, filter):
//   Adult Content OFF -> normal manga only      Adult Content ON -> adult manga only
function loadSharedMangas() {
    const on = !!userSettings.adult;
    return loadAllMangas().filter(m => isAdultManga(m) === on);
}

function refreshCurrentView() {
    renderLatestHero();
    renderHotShowcase();
    renderMainMangaGrid();
    const hash = window.location.hash;
    if (hash.startsWith('#detail-')) {
        const mangaId = hash.slice('#detail-'.length);
        renderChapterList(mangaId);
    } else if (hash.startsWith('#genres') || hash.startsWith('#latest')) {
        renderGenresView();
    }
}

// --- FILTER MODAL CONTROLS ---
window.toggleFilterModal = function() {
    const modal = document.getElementById('filterModal');
    const backdrop = document.getElementById('filterBackdrop');
    const isOpen = modal.classList.contains('show');
    
    if (isOpen) {
        modal.classList.remove('show');
        backdrop.classList.add('opacity-0', 'pointer-events-none');
    } else {
        modal.classList.add('show');
        backdrop.classList.remove('opacity-0', 'pointer-events-none');
    }
};

window.setReleaseFilter = function(type) {
    currentReleaseFilter = type;
    document.getElementById('filterRelAll').className = type === 'all' ? "setting-btn-active py-2.5 px-2 rounded-xl border transition text-center text-xs" : "setting-btn-inactive py-2.5 px-2 rounded-xl border transition text-center text-xs";
    document.getElementById('filterRelNew').className = type === 'new' ? "setting-btn-active py-2.5 px-2 rounded-xl border transition text-center text-xs" : "setting-btn-inactive py-2.5 px-2 rounded-xl border transition text-center text-xs";
    document.getElementById('filterRelOld').className = type === 'old' ? "setting-btn-active py-2.5 px-2 rounded-xl border transition text-center text-xs" : "setting-btn-inactive py-2.5 px-2 rounded-xl border transition text-center text-xs";
};

// Same list as the Adult (18+) group in the Uploader
const ADULT_GENRES = ['Adult', 'Mature', 'Smut', 'Erotica', 'Uncensored', 'Yaoi', 'Yuri', 'NTR', 'Netorare', 'Cheating', 'Vanilla', 'Femdom', 'BDSM', 'Milf', 'Office Romance', 'Forbidden Love', 'Revenge', 'Dark', 'Full Color'];

function populateFilterGenres() {
    const container = document.getElementById('filterGenresList');
    if (!container) return;
    
    const mangas = loadSharedMangas();
    const defaultGenres = [
        'Action', 'Adventure', 'Fantasy', 'Romance', 'Comedy', 
        'Sci-Fi', 'Supernatural', 'Isekai', 'Drama', 'Mystery', 
        'Horror', 'Slice of Life', 'Martial Arts', 'Seinen', 'Shonen'
    ];
    
    // Adult genres only exist while Adult Content is ON (they never show when it is off)
    const adultLower = new Set(ADULT_GENRES.map(g => g.toLowerCase()));
    const genresSet = new Set(userSettings.adult ? ADULT_GENRES.concat(defaultGenres) : defaultGenres);
    mangas.forEach(m => {
        if (m.genre) {
            m.genre.split(',').forEach(g => {
                const clean = g.trim();
                if (!clean) return;
                if (!userSettings.adult && adultLower.has(clean.toLowerCase())) return;
                genresSet.add(clean);
            });
        }
    });
    
    container.innerHTML = '';
    genresSet.forEach(g => {
        const btn = document.createElement('button');
        const isSelected = selectedGenres.includes(g);
        
        btn.className = isSelected ? 
            "setting-btn-active py-1.5 px-2.5 rounded-lg border text-[11px] font-bold transition shadow-sakura-sm" : 
            "setting-btn-inactive py-1.5 px-2.5 rounded-lg border text-[11px] font-bold transition";
        
        btn.textContent = g + ' ';
        if (isSelected) {
            const ck = document.createElement('i');
            ck.className = 'fa-solid fa-check ml-1 text-[9px]';
            btn.appendChild(ck);
        }
        
        btn.onclick = () => {
            if (isSelected) {
                selectedGenres = selectedGenres.filter(item => item !== g);
            } else {
                selectedGenres.push(g);
            }
            populateFilterGenres();
        };
        container.appendChild(btn);
    });
}

window.clearAllGenres = function() {
    selectedGenres = [];
    populateFilterGenres();
};

window.applyFilters = function() {
    toggleFilterModal();
    renderMainMangaGrid();
};

async function incrementMangaViewCount(mangaId) {
    if (!mangaId || !/^[\w-]{1,100}$/.test(String(mangaId))) return;
    // Anti-spam: count one view per manga per 6 hours per browser
    const VK = 'sakura_view_seen_v1', now = Date.now();
    const seen = safeGet(VK, {});
    if (seen[mangaId] && now - seen[mangaId] < 6 * 3600 * 1000) return;
    seen[mangaId] = now;
    Object.keys(seen).forEach(k => { if (now - seen[k] > 24 * 3600 * 1000) delete seen[k]; });
    safeSet(VK, seen);
    holdOrderUntil = Date.now() + 3000;
    try {
        // Atomic server-side +1 (no read-then-write race)
        const vm = loadAllMangas().find(x => x.id === mangaId);
        await update(ref(database, `${vm && vm.node === ADULT_NODE ? ADULT_NODE : MAIN_NODE}/${mangaId}`), { views: increment(1) });
    } catch (err) {
        console.warn("Failed to increment view count:", err);
    }
}

function isMangaNew(createdAtTimestamp) {
    if (!createdAtTimestamp) return false;
    const now = Date.now();
    const twoDaysInMillis = 2 * 24 * 60 * 60 * 1000;
    return (now - createdAtTimestamp) < twoDaysInMillis;
}

// "NEW CHAPTER" tag lives for 24 hours after the latest chapter upload
function hasNewChapter(manga) {
    const t = manga.lastChapterAt || 0;
    return t > 0 && (Date.now() - t) < 24 * 60 * 60 * 1000;
}

// A single chapter is "New" for 24 hours after it was uploaded (the tag switches itself off after that)
function isChapterNew(ch) {
    const t = Number(ch && ch.created) || 0;
    return t > 0 && (Date.now() - t) < 24 * 60 * 60 * 1000;
}

function currentDetailId() {
    const h = window.location.hash;
    return h.startsWith('#detail-') ? h.slice('#detail-'.length) : '';
}

function applyBookmarkUI(active) {
    const btn = document.getElementById("bookmarkBtn");
    const icon = document.getElementById("bookmarkIcon");
    const text = document.getElementById("bookmarkText");
    if (!btn || !icon || !text) return;
    btn.classList.toggle("active", !!active);
    if (active) {
        icon.className = "fa-solid fa-bookmark text-white text-sm";
        text.textContent = "Bookmarked";
    } else {
        icon.className = "fa-regular fa-bookmark text-sakura-400 text-sm";
        text.textContent = "Add to Bookmark";
    }
}

window.toggleBookmark = function() {
    const id = currentDetailId();
    if (!id) return;
    const list = safeGet(BOOKMARK_KEY, []);
    const i = list.indexOf(id);
    if (i >= 0) list.splice(i, 1); else list.push(id);
    safeSet(BOOKMARK_KEY, list);
    applyBookmarkUI(i < 0);
};

window.toggleSettingsModal = function() {
    const modal = document.getElementById('settingsModal');
    const backdrop = document.getElementById('settingsBackdrop');
    const isOpen = modal.classList.contains('show');
    
    if (isOpen) {
        modal.classList.remove('show');
        backdrop.classList.add('opacity-0', 'pointer-events-none');
    } else {
        modal.classList.add('show');
        backdrop.classList.remove('opacity-0', 'pointer-events-none');
    }
};

function syncReaderPrefsUI() {
    const A = "setting-btn-active", I = "setting-btn-inactive";
    const modeBase = " py-3 px-3 rounded-xl border transition text-center shadow-md flex items-center justify-center gap-2";
    const qBase = " py-2.5 px-2 rounded-xl border transition text-center flex items-center justify-center gap-1.5 text-xs";
    const set = (id, cls) => { const e = document.getElementById(id); if (e) e.className = cls; };
    set('modeScrollBtn', (currentReadingMode === 'scroll' ? A : I) + modeBase);
    set('modePageBtn', (currentReadingMode === 'page' ? A : I) + modeBase);
    [['qualLow', 'low'], ['qualMed', 'medium'], ['qualHigh', 'high']].forEach(([id, q]) => {
        set(id, currentImageQuality === q ? A + qBase + " shadow-md" : I + qBase);
    });
}

function savePrefs() {
    safeSet(PREFS_KEY, { mode: currentReadingMode, quality: currentImageQuality });
}

// Which page is the reader on right now? (used to keep position when settings change)
function currentReaderPageEstimate() {
    if (currentReadingMode === 'page') return currentPageIndex;
    const ws = document.querySelectorAll('#readerPagesContainer .manga-page-wrapper');
    for (let i = 0; i < ws.length; i++) {
        if (ws[i].getBoundingClientRect().bottom > 60) return i;
    }
    return 0;
}

function rerenderReader(startIndex) {
    const hash = window.location.hash.replace('#', '');
    if (hash.startsWith('reader-')) {
        renderReaderContent(hash.replace('reader-', ''), startIndex || 0);
    }
}

window.setReadingMode = function(mode) {
    const idx = currentReaderPageEstimate();   // measure BEFORE switching mode
    currentReadingMode = mode;
    savePrefs();
    syncReaderPrefsUI();
    rerenderReader(idx);
    toggleSettingsModal();
};

window.setImageQuality = function(quality) {
    const idx = currentReaderPageEstimate();
    currentImageQuality = quality;
    savePrefs();
    syncReaderPrefsUI();
    rerenderReader(idx);
    toggleSettingsModal();
};

// Downscale by WIDTH (so tall webtoon strips stay readable), skip if already small enough.
// Phones with little memory (or old browsers) cannot always draw big canvases: they give back a BLANK picture
// with no error. So: keep canvases small, check the result is really a picture, and always fall back to the
// original image if anything looks wrong (never leave the page empty).
const MAX_CANVAS_PIXELS = 4000000;    // ~4 MP: safe even on low-end Android / old iPhones
const MAX_CANVAS_SIDE = 4096;
function loadDownscaledImage(originalUrl, imgElement) {
    const useOriginal = () => { imgElement.onerror = imgElement._origOnError || imgElement.onerror; imgElement.src = originalUrl; };
    if (currentImageQuality === 'high') {
        imgElement.src = originalUrl;
        return;
    }
    // if the shrunk copy fails to show, show the original instead (only once)
    if (!imgElement._origOnError) imgElement._origOnError = imgElement.onerror;
    const maxWidth = currentImageQuality === 'low' ? 540 : 800;
    const jpegQuality = currentImageQuality === 'low' ? 0.55 : 0.78;
    const probe = new Image();
    probe.crossOrigin = "anonymous";
    probe.onload = function() {
        const w = probe.naturalWidth, h = probe.naturalHeight;
        const outH = Math.round(h * (maxWidth / w));
        if (!w || !h || w <= maxWidth || outH > MAX_CANVAS_SIDE || maxWidth * outH > MAX_CANVAS_PIXELS) {
            useOriginal();
            return;
        }
        try {
            const canvas = document.createElement('canvas');
            canvas.width = maxWidth;
            canvas.height = outH;
            const ctx = canvas.getContext('2d');
            if (!ctx) { useOriginal(); return; }
            ctx.drawImage(probe, 0, 0, canvas.width, canvas.height);
            // blank-canvas check: sample a few pixels; a failed canvas is fully transparent
            let blank = true;
            try {
                const pts = [[0.5, 0.5], [0.25, 0.25], [0.75, 0.75], [0.5, 0.1], [0.5, 0.9]];
                for (const [fx, fy] of pts) {
                    const d = ctx.getImageData(Math.floor(fx * (canvas.width - 1)), Math.floor(fy * (canvas.height - 1)), 1, 1).data;
                    if (d[3] !== 0) { blank = false; break; }
                }
            } catch (e) { blank = false; }
            if (blank) { useOriginal(); return; }
            if (canvas.toBlob) {
                canvas.toBlob((blob) => {
                    if (!blob || blob.size < 200) { useOriginal(); return; }
                    const u = URL.createObjectURL(blob);
                    imgElement.onerror = () => { URL.revokeObjectURL(u); useOriginal(); };
                    imgElement.src = u;
                }, 'image/jpeg', jpegQuality);
            } else {
                const data = canvas.toDataURL('image/jpeg', jpegQuality);
                if (!data || data.length < 300) { useOriginal(); return; }
                imgElement.onerror = useOriginal;
                imgElement.src = data;
            }
        } catch (e) {
            useOriginal();
        }
    };
    probe.onerror = function() { useOriginal(); };
    probe.src = originalUrl;
}

function getStatusClass(statusText) {
    if (!statusText) return 'status-ongoing';
    const lower = statusText.toLowerCase();
    if (lower.includes('complete') || lower.includes('completed')) {
        return 'status-complete';
    } else if (lower.includes('pause') || lower.includes('paused')) {
        return 'status-pause';
    }
    return 'status-ongoing';
}

function renderHotShowcase() {
    const container = document.getElementById("showcaseScrollContainer");
    if (!container) return;
    const mangas = loadSharedMangas();
    container.innerHTML = "";

    if (mangas.length === 0) {
        container.innerHTML = `
            <div class="w-full py-5 text-center text-xs text-slate-400/80 italic glass-card rounded-xl border border-dark-border">
                No Hot Trending Manga Available Desu~
            </div>
        `;
        return;
    }

    mangas.slice(0, 6).forEach((manga, index) => {
        const card = document.createElement("div");
        card.className = "showcase-card shrink-0 w-32 sm:w-40 h-44 sm:h-52 rounded-2xl relative overflow-hidden cursor-pointer group snap-start border border-dark-border shadow-lg";
        card.onclick = () => window.navigateToView('detail', manga.id, manga.title);

        const mangaStatus = manga.status || 'Ongoing';
        card.innerHTML = `
            <div class="absolute inset-0 bg-gradient-to-t from-dark-base via-dark-card/40 to-transparent z-10"></div>
            <div class="absolute inset-0 bg-cover bg-center" style='background-image: ${esc(cssUrl(manga.image))}'></div>
            <div class="absolute top-2.5 left-2.5 z-20">
                <span class="px-2 py-0.5 rounded-md bg-dark-card/90 text-white font-bold text-[9px] border border-dark-border shadow-sm">HOT #${index + 1}</span>
            </div>
            <div class="absolute bottom-3 left-3 right-3 z-20 space-y-1">
                <h3 class="formula-manga-title !mt-0 !text-left !text-xs !w-full text-white group-hover:text-sakura-300 transition line-clamp-1">${esc(manga.title)}</h3>
                <p class="text-[10px] font-semibold uppercase tracking-wider ${getStatusClass(mangaStatus)}">${esc(mangaStatus)}</p>
            </div>
        `;
        container.appendChild(card);
    });
}

// ===== Welcome hero: "Latest Update" cover carousel (fade out -> next fades in) =====
const LATEST_HERO_MS = 3800;
let latestHeroIdx = 0;
let latestHeroTimer = null;
let latestHeroKey = '';
let latestHeroDragging = false;
let latestHeroMoved = false;

let latestTickLabel = null;
function latestHaptic() {
    // Android / Chrome: real vibration
    try { if (navigator.vibrate && navigator.vibrate(30)) return; } catch (_) {}
    // iPhone Safari has no vibrate(): toggling a hidden native "switch" checkbox gives the system tick instead
    try {
        if (!latestTickLabel) {
            latestTickLabel = document.createElement('label');
            latestTickLabel.setAttribute('aria-hidden', 'true');
            latestTickLabel.style.cssText = 'position:fixed;left:-200px;top:0;width:40px;height:20px;opacity:0.01;pointer-events:none;';
            const cb = document.createElement('input');
            cb.type = 'checkbox'; cb.setAttribute('switch', ''); cb.tabIndex = -1;
            latestTickLabel.appendChild(cb);
            document.body.appendChild(latestTickLabel);
        }
        latestTickLabel.click();
    } catch (_) {}
}

function latestHeroAutoplay() {
    const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    return !reduce && !perfLow() && document.querySelectorAll('#latestHeroSlides .lh-slide').length > 1;
}

function showLatestSlide(i) {
    const slides = document.querySelectorAll('#latestHeroSlides .lh-slide');
    const dotsBox = document.getElementById('latestHeroDots');
    if (!slides.length) return;
    latestHeroIdx = ((i % slides.length) + slides.length) % slides.length;
    slides.forEach((s, k) => s.classList.toggle('active', k === latestHeroIdx));
    if (dotsBox) {
        dotsBox.style.setProperty('--i', latestHeroIdx);            // the bright block glides to the new position
        dotsBox.classList.remove('run');                            // restart the "time left" fill
        void dotsBox.offsetWidth;
        if (latestHeroAutoplay()) dotsBox.classList.add('run');
    }
}

function startLatestHeroTimer() {
    if (latestHeroTimer) { clearInterval(latestHeroTimer); latestHeroTimer = null; }
    const dotsBox = document.getElementById('latestHeroDots');
    if (!latestHeroAutoplay()) { if (dotsBox) dotsBox.classList.remove('run'); return; }
    if (dotsBox) { dotsBox.classList.remove('run'); void dotsBox.offsetWidth; dotsBox.classList.add('run'); }
    latestHeroTimer = setInterval(() => {
        const home = document.getElementById('homeView');
        if (document.hidden || !home || home.classList.contains('hidden')) return;   // only run while Home is on screen
        if (latestHeroDragging) return;                                              // finger is on the cover
        showLatestSlide(latestHeroIdx + 1);
    }, LATEST_HERO_MS);
}

function timeAgo(ts) {
    if (!ts) return '';
    const m = Math.floor((Date.now() - ts) / 60000);
    if (m < 1) return 'just now';
    if (m < 60) return m + 'm ago';
    const h = Math.floor(m / 60);
    if (h < 24) return h + 'h ago';
    return Math.floor(h / 24) + 'd ago';
}

// What was the latest upload for this manga: a brand-new manga, or a new chapter?
function latestKindTag(m) {
    const born = m.createdAt || 0, last = m.lastChapterAt || 0;
    const bornRecently = born && (Date.now() - born) < 2 * 24 * 60 * 60 * 1000;
    if (bornRecently && (!last || last - born < 30 * 60 * 1000)) return 'NEW MANGA';
    if (hasNewChapter(m)) return 'NEW CHAPTER';
    return '';
}

function renderLatestHero() {
    const wrap = document.getElementById('latestHeroSlides');
    const dotsBox = document.getElementById('latestHeroDots');
    if (!wrap || !dotsBox) return;

    // newest upload first: brand-new manga AND manga that just got a new chapter
    const list = [...loadSharedMangas()].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)).slice(0, 5);
    // Rebuild only when something visible changed (view counts etc. must not restart the carousel)
    const key = list.map(m => [m.id, m.updatedAt || 0, m.createdAt || 0, m.lastChapterAt || 0, m.latestChapterTitle || '', m.image].join('~')).join('|');
    if (key === latestHeroKey && (wrap.children.length || !list.length)) return;
    const wasBuilt = wrap.children.length > 0 && !wrap.querySelector('.lh-empty');
    latestHeroKey = key;
    if (wasBuilt) wrap.classList.add('lh-nofx');       // data refresh only: rebuild silently, no fade-in / shine replay (this was the flicker)

    wrap.innerHTML = '';
    dotsBox.innerHTML = '';
    if (!list.length) {
        const empty = document.createElement('div');
        empty.className = 'lh-empty';
        empty.textContent = 'Latest updates will appear here desu~';
        wrap.style.aspectRatio = 'auto';
        wrap.appendChild(empty);
        if (latestHeroTimer) { clearInterval(latestHeroTimer); latestHeroTimer = null; }
        return;
    }
    wrap.style.aspectRatio = '';
    latestHeroIdx = Math.min(latestHeroIdx, list.length - 1);
    dotsBox.style.setProperty('--n', list.length);
    dotsBox.style.setProperty('--i', latestHeroIdx);

    list.forEach((m, i) => {
        const slide = document.createElement('div');
        slide.className = 'lh-slide' + (i === latestHeroIdx ? ' active' : '');
        slide.setAttribute('role', 'link');
        slide.tabIndex = 0;
        slide.setAttribute('aria-label', `${m.title} - ${m.latestChapterTitle || 'new upload'}`);

        const img = document.createElement('img');
        img.className = 'lh-cover';
        img.alt = '';
        img.decoding = 'async';
        img.onerror = () => { img.style.display = 'none'; };
        img.src = m.image;
        slide.appendChild(img);

        const fade = document.createElement('span');
        fade.className = 'lh-fade';
        slide.appendChild(fade);

        const tag = latestKindTag(m);
        if (tag) {
            const nw = document.createElement('span');
            nw.className = 'lh-new';
            nw.textContent = tag;
            slide.appendChild(nw);
        }

        const info = document.createElement('div');
        info.className = 'lh-info';
        const t = document.createElement('span');
        t.className = 'lh-title';
        t.textContent = m.title;
        const meta = document.createElement('div');
        meta.className = 'lh-meta';
        const c = document.createElement('span');
        c.className = 'lh-ch';
        c.textContent = m.latestChapterTitle || 'New upload';
        meta.appendChild(c);
        const ago = timeAgo(m.updatedAt);
        if (ago) {
            const tm = document.createElement('span');
            tm.className = 'lh-time';
            tm.textContent = ago;
            meta.appendChild(tm);
        }
        info.appendChild(t);
        info.appendChild(meta);
        slide.appendChild(info);

        slide.onclick = () => { if (latestHeroMoved) { latestHeroMoved = false; return; } window.navigateToView('detail', m.id, m.title); };
        slide.onkeydown = (e) => { if (e.key === 'Enter') slide.click(); };
        wrap.appendChild(slide);

        const blk = document.createElement('button');
        blk.type = 'button';
        blk.className = 'lh-block';
        blk.setAttribute('aria-label', `Show update ${i + 1}`);
        blk.onclick = () => { if (i !== latestHeroIdx) latestHaptic(); showLatestSlide(i); startLatestHeroTimer(); };
        dotsBox.appendChild(blk);
    });
    const glider = document.createElement('span');
    glider.className = 'lh-glider';
    glider.setAttribute('aria-hidden', 'true');
    dotsBox.appendChild(glider);
    bindLatestHeroDrag(wrap);
    if (wasBuilt) { void wrap.offsetWidth; requestAnimationFrame(() => wrap.classList.remove('lh-nofx')); }
    startLatestHeroTimer();
}

// ===== Drag / swipe the cover (manual): NO fade. The held cover only tilts a little, the next cover
// peeks in from the opposite side (tilted), and on release the held cover slips in behind the new one. =====
function bindLatestHeroDrag(wrap) {
    if (wrap.dataset.dragBound) return;
    wrap.dataset.dragBound = '1';
    let startX = 0, dx = 0, pid = null, t0 = 0, cur = null, inc = null, incIdx = -1, dir = 0, w = 1, busy = false;
    const EASE = 'transform 0.45s cubic-bezier(0.22, 1, 0.36, 1)';

    const slidesList = () => document.querySelectorAll('#latestHeroSlides .lh-slide');
    const wipe = (el) => { if (el) { el.style.transition = ''; el.style.transform = ''; el.style.opacity = ''; el.style.zIndex = ''; } };
    const wipeQuiet = (...els) => {                          // clear inline styles with no transition (so nothing fades)
        wrap.classList.add('lh-nofx');
        els.forEach(wipe);
        void wrap.offsetWidth;
        wrap.classList.remove('lh-nofx');
    };
    // held cover: lifts + tilts toward its own side, limited (does not follow the finger freely)
    const curPose = (q) => `translateX(${-dir * q * 9}%) rotate(${-dir * q * 7}deg) scale(1.04)`;
    // incoming cover: waits behind the held one, then leans out from the opposite side, tilted
    const incPose = (q) => `translateX(${dir * (2 + q * 16)}%) rotate(${dir * q * 8}deg) scale(0.95)`;

    wrap.addEventListener('pointerdown', (e) => {
        if (busy || pid !== null) return;
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        if (slidesList().length < 2) return;
        pid = e.pointerId; startX = e.clientX; dx = 0; t0 = Date.now();
        cur = wrap.querySelector('.lh-slide.active');
        inc = null; incIdx = -1; dir = 0;
        w = wrap.getBoundingClientRect().width || 1;
        latestHeroMoved = false;
    });

    wrap.addEventListener('pointermove', (e) => {
        if (e.pointerId !== pid || !cur) return;
        dx = e.clientX - startX;
        if (!latestHeroDragging) {
            if (Math.abs(dx) < 6) return;
            latestHeroDragging = true; latestHeroMoved = true;
            try { wrap.setPointerCapture(pid); } catch (_) {}
            cur.style.transition = 'none';
        }
        const slides = slidesList();
        const newDir = dx < 0 ? 1 : -1;                       // drag left -> next cover (enters from right); drag right -> previous (enters from left)
        if (newDir !== dir) {
            wipeQuiet(inc);
            dir = newDir;
            incIdx = ((latestHeroIdx + dir) % slides.length + slides.length) % slides.length;
            inc = slides[incIdx];
            inc.style.transition = 'none';
            inc.style.opacity = '1';                          // shown by position only, never faded
            inc.style.zIndex = '1';                           // behind the held cover for now
        }
        const q = Math.min(Math.abs(dx) / (w * 0.5), 1);
        cur.style.transform = curPose(q);
        inc.style.transform = incPose(q);
    });

    const finish = (e) => {
        if (e.pointerId !== pid) return;
        const wasDragging = latestHeroDragging;
        try { wrap.releasePointerCapture(pid); } catch (_) {}
        pid = null;
        if (!wasDragging || !cur) { cur = null; return; }
        const fast = Math.abs(dx) / Math.max(Date.now() - t0, 1) > 0.45;
        const commit = e.type !== 'pointercancel' && (Math.abs(dx) > w * 0.22 || (fast && Math.abs(dx) > 24));
        const c = cur, n = inc, target = incIdx;
        cur = null; inc = null; dir = 0; busy = true;
        if (commit) {
            latestHaptic();
            n.style.zIndex = '3';                             // new cover comes in on top ...
            n.style.transition = EASE;
            n.style.transform = 'translateX(0) rotate(0deg) scale(1)';
            c.style.transition = EASE;                        // ... and the old one slips in behind it
            c.style.transform = 'translateX(0) rotate(0deg) scale(0.96)';
            setTimeout(() => {
                wrap.classList.add('lh-nofx');
                wipe(c); wipe(n);
                showLatestSlide(target);                      // swap the real "active" state with no transition
                void wrap.offsetWidth;
                wrap.classList.remove('lh-nofx');
                latestHeroDragging = false; busy = false;
                startLatestHeroTimer();
            }, 480);
        } else {
            c.style.transition = EASE;
            c.style.transform = 'translateX(0) rotate(0deg) scale(1)';
            if (n) { n.style.transition = EASE; n.style.transform = 'translateX(0) rotate(0deg) scale(0.95)'; }   // tucks back behind
            setTimeout(() => {
                wipeQuiet(c, n);
                latestHeroDragging = false; busy = false;
                startLatestHeroTimer();
            }, 480);
        }
        setTimeout(() => { latestHeroMoved = false; }, 60);
    };
    wrap.addEventListener('pointerup', finish);
    wrap.addEventListener('pointercancel', finish);
}

function buildMangaCard(manga) {
    const card = document.createElement("div");
    card.className = "formula-manga-card";
    card.onclick = () => window.navigateToView('detail', manga.id, manga.title);

    const mangaStatus = manga.status || 'Ongoing';
    const newBadgeHtml = isMangaNew(manga.createdAt) ? `<div class="formula-new-badge">NEW</div>` : '';

    card.innerHTML = `
        <div class="clean-single-bold-frame">
            <div class="absolute inset-0 bg-cover bg-center" style='background-image: ${esc(cssUrl(manga.image))}'></div>
            <div class="formula-type-badge">
                <span>${esc(manga.coverType || 'Manga')}</span>
            </div>
            ${newBadgeHtml}
            <div class="formula-chapter-tag ${getStatusClass(mangaStatus)}">
                <i class="fa-solid fa-circle-dot mr-1 text-[7px]"></i>${esc(mangaStatus)}
            </div>
        </div>
        <div class="formula-title-row">
            <h3 class="formula-manga-title">${esc(manga.title)}</h3>
            ${hasNewChapter(manga) ? '<span class="formula-newch-tag">New Ch</span>' : ''}
        </div>
    `;
    return card;
}

function renderMainMangaGrid() {
    const gridContainer = document.getElementById("mainMangaGridContainer");
    if (!gridContainer) return;
    const mangas = loadSharedMangas();
    gridContainer.innerHTML = "";

    const filteredMangas = mangas.filter(manga => {
        const isNew = isMangaNew(manga.createdAt);
        if (currentReleaseFilter === 'new' && !isNew) return false;
        if (currentReleaseFilter === 'old' && isNew) return false;

        if (selectedGenres.length > 0) {
            const mangaGenres = manga.genre ? manga.genre.split(',').map(g => g.trim().toLowerCase()) : [];
            if (!selectedGenres.some(sg => mangaGenres.includes(sg.toLowerCase()))) return false;
        }
        if (searchQuery) {
            if (!String(manga.title || '').toLowerCase().includes(searchQuery)) return false;
        }
        return true;
    });

    if (filteredMangas.length === 0) {
        gridContainer.innerHTML = `
            <div class="col-span-2 py-10 text-center text-xs text-slate-400/80 italic glass-card rounded-2xl border border-dark-border">
                No Manga found matching filter desu~
            </div>
        `;
        return;
    }
    filteredMangas.forEach(manga => gridContainer.appendChild(buildMangaCard(manga)));
}

// "Browse Genres" and "Latest Updates" pages
function renderGenresView() {
    const grid = document.getElementById('genresGrid');
    const chips = document.getElementById('genresChips');
    const title = document.getElementById('genresTitle');
    const sub = document.getElementById('genresSubtitle');
    if (!grid || !chips || !title) return;

    const mangas = loadSharedMangas();
    let list;

    if (genresMode === 'latest') {
        title.textContent = 'Latest Updates';
        if (sub) sub.textContent = 'Newest chapters first desu~';
        chips.classList.add('hidden');
        list = [...mangas].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    } else {
        title.textContent = 'Browse Genres';
        if (sub) sub.textContent = 'Pick a genre to filter desu~';
        chips.classList.remove('hidden');

        const set = new Set();
        mangas.forEach(m => (m.genre || '').split(',').forEach(g => { const c = g.trim(); if (c) set.add(c); }));
        chips.innerHTML = '';
        ['', ...set].forEach(g => {
            const b = document.createElement('button');
            const on = (genresViewGenre || '').toLowerCase() === g.toLowerCase();
            b.className = (on ? "setting-btn-active" : "setting-btn-inactive") + " py-1.5 px-2.5 rounded-lg border text-[11px] font-bold transition";
            b.textContent = g || 'All';
            b.onclick = () => { genresViewGenre = g; renderGenresView(); };
            chips.appendChild(b);
        });
        list = genresViewGenre
            ? mangas.filter(m => (m.genre || '').split(',').map(x => x.trim().toLowerCase()).includes(genresViewGenre.toLowerCase()))
            : mangas;
    }

    grid.innerHTML = '';
    if (list.length === 0) {
        grid.innerHTML = `<div class="col-span-2 py-10 text-center text-xs text-slate-400/80 italic glass-card rounded-2xl border border-dark-border">No Manga found desu~</div>`;
        return;
    }
    list.forEach(m => grid.appendChild(buildMangaCard(m)));
}

// ---- Chapter list display prefs (sort + layout) ----
const CH_PREFS_KEY = "sakura_chapter_list_prefs_v1";
const CH_LIST_LIMIT = 10;      // list layout: show this many, the rest behind "Show more"
let chPrefs = (() => {
    const p = safeGet(CH_PREFS_KEY, {});
    return {
        sort: p.sort === 'oldest' ? 'oldest' : 'newest',
        view: p.view === 'grid' ? 'grid' : 'list'
    };
})();
let chExpandedFor = '';        // manga id whose list is fully expanded ("Show more" pressed)
let chLastMangaId = '';

function chapterTileLabel(ch) {
    if (Number.isFinite(ch.num)) return String(ch.num);
    const m = String(ch.title || '').match(/(\d+(?:\.\d+)?)/);
    return m ? m[1] : '#';
}

// ---- Reading progress: how far each chapter has been read (0-100, best value is kept; 100 = read to the very end) ----
const READ_PROGRESS_KEY = "sakura_read_progress_v2";   // v2: old values were measured while page images were still loading (wrong)
let readProgKey = '';          // "<mangaId>___<chapterId>" of the chapter open in the reader
let readSaveTimer = null;

function getReadProgress() {
    const p = safeGet(READ_PROGRESS_KEY, {});
    return (p && typeof p === 'object' && !Array.isArray(p)) ? p : {};
}

// Chapters that were opened in the reader (even if not finished) -> they lose their "New" tag
const OPENED_KEY = "sakura_chapters_opened_v1";
function markChapterOpened(key) {
    if (!key) return;
    const o = safeGet(OPENED_KEY, {});
    const all = (o && typeof o === 'object' && !Array.isArray(o)) ? o : {};
    if (all[key]) return;
    all[key] = 1;
    safeSet(OPENED_KEY, all);
}

function computeReadPct() {
    const wrappers = document.querySelectorAll('#readerPagesContainer .manga-page-wrapper');
    const total = wrappers.length;
    if (!total) return 0;
    if (currentReadingMode === 'page') return Math.round((currentPageIndex + 1) / total * 100);
    const sec = document.getElementById('readerView');
    const viewBottom = Math.min(sec ? sec.getBoundingClientRect().bottom : window.innerHeight, window.innerHeight);
    // A page only counts once its image is loaded: before that its box is tiny, the layout is not real yet,
    // and the whole chapter would seem to fit on one screen (-> wrong / full %).
    const settled = (w) => {
        const img = w.querySelector('img');
        return (img && img.classList.contains('loaded')) || !!w.querySelector('.simple-loading-text.failed');
    };
    let done = 0, partial = 0;
    for (let i = 0; i < total; i++) {
        const w = wrappers[i];
        const r = w.getBoundingClientRect();
        if (r.top >= viewBottom) break;                    // not reached yet
        if (!settled(w)) return 0;                         // layout not final -> do not measure now
        if (r.bottom <= viewBottom + 4) { done++; continue; }
        if (r.height > 0) partial = (viewBottom - r.top) / r.height;
        break;
    }
    if (done >= total) return 100;                         // scrolled to the end of the last page
    return Math.min(99, Math.floor((done + partial) / total * 100));
}

function saveReadProgress() {
    if (!readProgKey) return;
    const pct = computeReadPct();
    if (!pct) return;
    const all = getReadProgress();
    if ((all[readProgKey] || 0) >= pct) return;           // never go backwards
    all[readProgKey] = pct;
    safeSet(READ_PROGRESS_KEY, all);
}

function scheduleReadSave(delay) {
    clearTimeout(readSaveTimer);
    readSaveTimer = setTimeout(saveReadProgress, delay == null ? 250 : delay);
}

function syncChapterTools() {
    const sb = document.getElementById('chSortBtn');
    if (sb) {
        sb.dataset.sort = chPrefs.sort;
        const t = chPrefs.sort === 'newest' ? 'Newest first - tap for Oldest first' : 'Oldest first - tap for Newest first';
        sb.title = t; sb.setAttribute('aria-label', t);
    }
    const vb = document.getElementById('chViewToggle');
    if (vb) {
        // icon shows the layout you will SWITCH TO
        const toGrid = chPrefs.view === 'list';
        vb.innerHTML = `<i class="fa-solid ${toGrid ? 'fa-table-cells-large' : 'fa-list'}"></i>`;
        vb.title = toGrid ? 'Show as blocks' : 'Show as list';
        vb.setAttribute('aria-label', vb.title);
    }
}

window.setChapterSort = function(mode) {
    if (mode !== 'newest' && mode !== 'oldest') return;
    if (chPrefs.sort === mode) return;
    chPrefs.sort = mode;
    safeSet(CH_PREFS_KEY, chPrefs);
    renderChapterList(shownDetailId || currentDetailId());
};
window.toggleChapterSort = function() {
    window.setChapterSort(chPrefs.sort === 'newest' ? 'oldest' : 'newest');
};
window.toggleChapterView = function() {
    chPrefs.view = chPrefs.view === 'list' ? 'grid' : 'list';
    safeSet(CH_PREFS_KEY, chPrefs);
    renderChapterList(shownDetailId || currentDetailId());
};

function renderChapterList(mangaId) {
    const container = document.getElementById('chapterListContainer');
    if (!container) return;
    container.innerHTML = '';

    const foundManga = loadAllMangas().find(m => m.id === mangaId);
    const baseChapters = (foundManga && foundManga.chapters) ? foundManga.chapters : [];
    if (baseChapters.length === 0) {
        // no chapters uploaded yet: say so (no fake preview chapters)
        const countEl0 = document.getElementById('chapterCountBadge');
        if (countEl0) countEl0.textContent = 0;
        container.className = 'w-full';
        container.innerHTML = '<div class="py-6 text-center text-xs text-slate-400/80 italic">No Chapter Yet</div>';
        return;
    }
    // stored order is newest-first; "Oldest" just flips a copy (the data itself is untouched)
    const chapters = chPrefs.sort === 'oldest' ? baseChapters.slice().reverse() : baseChapters;

    if (chLastMangaId !== mangaId) { chLastMangaId = mangaId; chExpandedFor = ''; }

    const countEl = document.getElementById('chapterCountBadge');
    if (countEl) countEl.textContent = chapters.length;
    syncChapterTools();

    const isGrid = chPrefs.view === 'grid';
    container.className = isGrid ? 'ch-grid w-full' : 'space-y-2.5 w-full';
    const readProg = getReadProgress();
    const pctOf = (ch) => Math.max(0, Math.min(100, Number(readProg[`${mangaId}___${ch.id}`]) || 0));
    const openedSet = safeGet(OPENED_KEY, {}) || {};
    const showNew = (ch) => isChapterNew(ch) && !openedSet[`${mangaId}___${ch.id}`] && pctOf(ch) === 0;   // "New" ends as soon as the chapter is opened

    if (isGrid) {
        chapters.forEach((ch, ci) => {
            const tile = document.createElement('button');
            tile.type = 'button';
            tile.className = 'ch-tile' + (pctOf(ch) >= 100 ? ' is-read' : '') + (showNew(ch) ? ' is-new' : '');
            tile.style.setProperty('--i', Math.min(ci, 12));
            tile.title = ch.title;
            tile.onclick = () => navigateToReaderView(mangaId, ch.id, ch.title);
            tile.innerHTML = `<span class="ch-tile-label">CH</span><span class="ch-tile-num">${esc(chapterTileLabel(ch))}</span>` + lockBadgeHTML(mangaId, ch);
            container.appendChild(tile);
        });
        return;
    }

    const expanded = chExpandedFor === mangaId;
    const visible = expanded ? chapters : chapters.slice(0, CH_LIST_LIMIT);

    visible.forEach((ch, ci) => {
        const chBox = document.createElement('div');
        chBox.style.setProperty('--i', Math.min(ci, 12));
        const pct = pctOf(ch);
        chBox.className = "chapter-grey-box flex items-center justify-between p-3.5 rounded-xl border border-dark-border cursor-pointer transition" + (pct >= 100 ? ' is-read' : '');
        chBox.onclick = () => navigateToReaderView(mangaId, ch.id, ch.title);

        chBox.innerHTML = `
            <div class="flex items-center gap-3 min-w-0">
                <div class="ch-badge shrink-0"><i class="fa-solid fa-book-open"></i></div>
                <div class="flex flex-col min-w-0 gap-0.5">
                    <div class="ch-title-row">
                        <span class="ch-title text-xs sm:text-sm font-bold text-slate-100">${esc(ch.title)}</span>
                        ${showNew(ch) ? '<span class="ch-new">New</span>' : ''}
                    </div>
                    <span class="ch-meta text-[10px] text-slate-400">
                        <span><i class="fa-regular fa-calendar"></i> ${esc(ch.date || 'Recent Release')}</span>
                    </span>
                </div>
            </div>
            ${lockBadgeHTML(mangaId, ch)}
            <span class="ch-progress" aria-hidden="true"><i style="width:${pct}%"></i></span>
        `;

        // chapter box + a separate Download box beside it (small gap between the two)
        const row = document.createElement('div');
        row.className = 'ch-row';
        row.style.setProperty('--i', Math.min(ci, 12));
        const dl = document.createElement('button');
        dl.type = 'button';
        dl.className = 'ch-dl';
        dl.title = 'Download';
        dl.setAttribute('aria-label', 'Download ' + ch.title);
        dl.innerHTML = '<i class="fa-solid fa-download"></i>';
        dl.dataset.key = mangaId + '___' + ch.id;
        dlApplyBtn(dl);
        dl.onclick = (ev) => { ev.stopPropagation(); startDownload(mangaId, ch.id); };
        row.appendChild(chBox);
        row.appendChild(dl);
        container.appendChild(row);
    });

    if (!expanded && chapters.length > CH_LIST_LIMIT) {
        const more = document.createElement('button');
        more.type = 'button';
        more.className = 'ch-show-more';
        more.innerHTML = `Show more <span class="ch-more-count">+${chapters.length - CH_LIST_LIMIT}</span> <i class="fa-solid fa-chevron-down text-[10px]"></i>`;
        more.onclick = () => { chExpandedFor = mangaId; renderChapterList(mangaId); };
        container.appendChild(more);
    }
}

window.readFirstChapter = function() {
    const mangaId = currentDetailId();
    const found = loadAllMangas().find(m => m.id === mangaId);

    if (found && found.chapters && found.chapters.length > 0) {
        // chapters are sorted newest-first, so the last one is Chapter 1
        const firstCh = found.chapters[found.chapters.length - 1];
        navigateToReaderView(mangaId, firstCh.id, firstCh.title);
    } else {
        showToast('No Chapter Yet', 'err');
    }
};

function navigateToReaderView(mangaId, chapterId, chapterTitle) {
    coinGate(mangaId, chapterId).then((ok) => {
        if (!ok) return;
        if (mangaId) incrementMangaViewCount(mangaId);
        readerFromDetail = (currentActiveView === 'detail');
        window.navigateToView('reader', `${mangaId}___${chapterId}`, chapterTitle);
    });
}

// Switch chapter inside the reader without adding a history entry
async function openChapterInPlace(mangaId, chapterId, chapterTitle) {
    if (!(await coinGate(mangaId, chapterId))) return;
    if (mangaId) incrementMangaViewCount(mangaId);
    const st = { view: 'reader', id: `${mangaId}___${chapterId}`, title: chapterTitle, idx: navIndex };
    history.replaceState(st, '', `#reader-${st.id}`);
    navDirection = 'forward';
    renderView(st);
}

// Return from Reader to Chapter Lobby
window.goBackToDetailFromReader = function() {
    const hash = window.location.hash.replace('#', '');
    if (hash.startsWith('reader-')) {
        const readerParam = hash.replace('reader-', '');
        const mangaId = readerParam.includes('___') ? readerParam.split('___')[0] : null;
        if (mangaId) {
            if (readerFromDetail) {
                readerFromDetail = false;
                history.back();            // real "back", so the browser history stays clean
                return;
            }
            window.navigateToView('detail', mangaId, 'Chapter Lobby', 'back');
            return;
        }
    }
    goHome();
};

const scrollPositions = {};

// Remember where the visible page is scrolled to. The Chapter Lobby is remembered PER MANGA,
// so coming back from the reader returns to the same spot in the chapter list.
function rememberScroll() {
    const s = document.querySelector('.view-section:not(.hidden)');
    if (!s) return;
    const key = s.id === 'detailView' ? 'detail:' + shownDetailId : s.id;
    scrollPositions[key] = window.scrollY;
}

window.navigateToView = function(viewName, id = '', title = '', direction = 'forward') {
    previousActiveView = currentActiveView;
    currentActiveView = viewName;

    rememberScroll();

    // From the first in-app navigation on we restore scroll ourselves (scrollPositions).
    // Otherwise the browser's own restoration scrolls the OLD page (clamped) a frame before our swap -> visible jump.
    if ('scrollRestoration' in history) history.scrollRestoration = 'manual';

    navIndex++;
    navDirection = direction;
    const stateData = { view: viewName, id: id, title: title, idx: navIndex };
    const hash = `#${viewName}${id ? '-' + id : ''}`;
    history.pushState(stateData, '', hash);
    renderView(stateData);
};

window.goHome = function() {
    if (currentActiveView === 'home') {
        // Already home: don't add a duplicate history entry, just go to the top
        window.scrollTo({ top: 0, left: 0, behavior: 'smooth' });
        return;
    }
    window.navigateToView('home', '', '', 'back');   // leaving a lobby for Home feels like "back"
};

window.addEventListener('popstate', (e) => {
    rememberScroll();
    const idx = (e.state && Number.isInteger(e.state.idx)) ? e.state.idx : null;
    if (idx !== null) {
        navDirection = idx < navIndex ? 'back' : 'forward';
        navIndex = idx;
    } else {
        navDirection = 'forward';
    }
    if (e.state && e.state.view) {
        previousActiveView = currentActiveView;
        currentActiveView = e.state.view;
    }
    restoreViewFromHash();
});

function restoreViewFromHash() {
    const hash = window.location.hash.replace('#', '');
    const hasIdx = history.state && Number.isInteger(history.state.idx);
    if (!hash) {
        previousActiveView = currentActiveView;
        currentActiveView = 'home';
        if (!hasIdx) { try { history.replaceState({ view: 'home', id: '', title: '', idx: navIndex }, ''); } catch (e) {} }
        renderView({ view: 'home' });
        return;
    }

    const parts = hash.split('-');
    const viewName = parts[0];
    const id = parts.slice(1).join('-');
    if (!hasIdx) { try { history.replaceState({ view: viewName, id: id, title: '', idx: navIndex }, ''); } catch (e) {} }
    if (currentActiveView !== viewName) {
        previousActiveView = currentActiveView;
        currentActiveView = viewName;
    }

    let title = '';
    if (viewName === 'detail') {
        const found = loadAllMangas().find(m => m.id === id);
        title = found ? found.title : 'Manga Detail';
    }
    // renderView() fills the detail page / reader itself
    renderView({ view: viewName, id: id, title: title }, true);
}

window.handleReaderScreenTap = function(event) {
    if (isDragging || Date.now() - lastDragAt < 150) return;   // a drag/swipe is not a tap
    const floatingBar = document.getElementById('readerFloatingBar');
    const modal = document.getElementById('settingsModal');
    if (modal && modal.classList.contains('show')) return;
    if (floatingBar) floatingBar.classList.toggle('show');
};

function getClientX(e) {
    return (e.touches && e.touches.length) ? e.touches[0].clientX : e.clientX;
}

function getClientY(e) {
    return (e.touches && e.touches.length) ? e.touches[0].clientY : e.clientY;
}

function dragStart(e) {
    if (currentReadingMode !== 'page') return;
    isDragging = true;
    isLocked = false;
    startX = getClientX(e);
    startY = getClientY(e);
    currentX = startX;

    const container = document.getElementById('readerPagesContainer');
    containerWidth = container.offsetWidth || window.innerWidth;
    document.querySelectorAll('.manga-page-wrapper.page-mode').forEach(w => w.classList.add('dragging'));
}

function dragMove(e) {
    if (currentReadingMode !== 'page' || !isDragging) return;
    const currentTouchX = getClientX(e);
    const currentTouchY = getClientY(e);

    let diffX = currentTouchX - startX;
    let diffY = currentTouchY - startY;

    if (!isLocked && (Math.abs(diffX) > 5 || Math.abs(diffY) > 5)) {
        if (Math.abs(diffY) > Math.abs(diffX)) {
            isDragging = false;
            document.querySelectorAll('.manga-page-wrapper.page-mode').forEach(w => w.classList.remove('dragging'));
            updatePagePositions();
            return;
        }
        isLocked = true;
    }

    currentX = currentTouchX;
    const wrappers = document.querySelectorAll('.manga-page-wrapper.page-mode');
    if (wrappers.length === 0) return;
    const currentElem = wrappers[currentPageIndex];
    if (!currentElem) return;

    if ((currentPageIndex === 0 && diffX > 0) || (currentPageIndex === wrappers.length - 1 && diffX < 0)) {
        diffX = diffX / 3.5;
    }

    currentElem.style.transform = `translate3d(${diffX}px, 0, 0)`;

    const nextElem = wrappers[currentPageIndex + 1];
    const prevElem = wrappers[currentPageIndex - 1];
    // Always reset the neighbour we are NOT dragging in, so reversing direction mid-swipe leaves no ghost page
    if (diffX < 0 && nextElem) {
        nextElem.style.transform = `translate3d(${containerWidth + diffX}px, 0, 0)`;
        if (prevElem) prevElem.style.transform = '';
    } else if (diffX > 0 && prevElem) {
        prevElem.style.transform = `translate3d(${-containerWidth + diffX}px, 0, 0)`;
        if (nextElem) nextElem.style.transform = '';
    } else {
        if (nextElem) nextElem.style.transform = '';
        if (prevElem) prevElem.style.transform = '';
    }
}

function dragEnd(e) {
    if (currentReadingMode !== 'page' || !isDragging) return;
    isDragging = false;
    isLocked = false;
    let diffX = currentX - startX;
    const instantThreshold = 35;
    if (Math.abs(diffX) > 6) lastDragAt = Date.now();

    document.querySelectorAll('.manga-page-wrapper.page-mode').forEach(w => w.classList.remove('dragging'));
    const wrappers = document.querySelectorAll('.manga-page-wrapper.page-mode');

    if (diffX < -instantThreshold && currentPageIndex < wrappers.length - 1) {
        changePage(1);
    } else if (diffX > instantThreshold && currentPageIndex > 0) {
        changePage(-1);
    } else {
        updatePagePositions();
    }
    currentX = startX = startY = 0;
}

window.changePage = function(direction) {
    if (currentReadingMode !== 'page') return;
    let targetPage = currentPageIndex + direction;
    const wrappers = document.querySelectorAll('.manga-page-wrapper.page-mode');
    if (targetPage < 0 || targetPage >= wrappers.length) return;
    currentPageIndex = targetPage;
    updatePagePositions();
};

function updatePagePositions() {
    const wrappers = document.querySelectorAll('.manga-page-wrapper.page-mode');
    wrappers.forEach((elem, index) => {
        elem.style.transform = '';
        if (index < currentPageIndex) {
            elem.className = 'manga-page-wrapper page-mode prev-page';
        } else if (index > currentPageIndex) {
            elem.className = 'manga-page-wrapper page-mode next-page';
        } else {
            elem.className = 'manga-page-wrapper page-mode active-page';
        }
    });

    const readerSec = document.getElementById('readerView');
    if (readerSec) readerSec.scrollTop = 0;
    window.scrollTo(0, 0);
    syncPageChapterNav();
    saveReadProgress();
}

function setupReaderTouchEvents() {
    const container = document.getElementById('readerPagesContainer');
    if (!container) return;

    container.removeEventListener('touchstart', dragStart);
    container.removeEventListener('touchmove', dragMove);
    container.removeEventListener('touchend', dragEnd);
    container.removeEventListener('touchcancel', dragEnd);
    container.removeEventListener('mousedown', dragStart);
    window.removeEventListener('mousemove', dragMove);
    window.removeEventListener('mouseup', dragEnd);

    container.addEventListener('touchstart', dragStart, { passive: true });
    container.addEventListener('touchmove', dragMove, { passive: true });
    container.addEventListener('touchend', dragEnd);
    container.addEventListener('touchcancel', dragEnd);   // browser took over the gesture -> don't stay stuck in "dragging"
    container.addEventListener('mousedown', dragStart);
    window.addEventListener('mousemove', dragMove);
    window.addEventListener('mouseup', dragEnd);
}

const readerViewElement = document.getElementById('readerView');
if (readerViewElement) {
    readerViewElement.addEventListener('scroll', function() {
        if (currentReadingMode !== 'scroll') return;
        const floatingBar = document.getElementById('readerFloatingBar');
        const cur = Math.max(0, readerViewElement.scrollTop);
        if (floatingBar && floatingBar.classList.contains('show') && cur > lastReaderScrollTop && cur > 10) {
            floatingBar.classList.remove('show');
        }
        lastReaderScrollTop = cur;   // always track, not only while the bar is visible
        scheduleReadSave();
    }, { passive: true });
}

// Page loading placeholder: spinning sakura flower in a glowing ring + "LOADING" with bouncing dots
const LOADER_FLOWER = (() => {
    let petals = '';
    for (let i = 0; i < 5; i++) {
        petals += `<path d="M0,-8 C-13,-30 0,-44 0,-44 C0,-44 13,-30 0,-8 Z" transform="rotate(${i * 72})" opacity="${(0.95 - i * 0.1).toFixed(2)}"/>`;
    }
    return `<svg class="ld-flower" viewBox="-50 -50 100 100" aria-hidden="true"><g style="fill:rgb(var(--c300))">${petals}</g><circle r="5" fill="#fff"/></svg>`;
})();

function setLoaderLoading(loader) {
    loader.classList.remove('failed');
    loader.innerHTML = `<div class="ld-box"><span class="ld-ring"></span><span class="ld-ring ld-ring2"></span>${LOADER_FLOWER}</div>` +
        `<div class="ld-text">LOADING<span class="ld-dots"><i></i><i></i><i></i></span></div>`;
}

function setLoaderFailed(loader) {
    loader.classList.add('failed');
    loader.innerHTML = `<div class="ld-box ld-box-fail"><i class="fa-solid fa-rotate-right"></i></div>` +
        `<div class="ld-text ld-text-fail">Failed to load<small>Tap to retry</small></div>`;
}

// Build the 3-part chapter bar: [Back Chapter] [chapter select] [Next Chapter]
// manga.chapters is stored newest-first, so "back" = the older chapter (idx + 1), "next" = the newer one (idx - 1)
function buildChapterNav(manga, chapterId) {
    const chapters = manga.chapters || [];
    const idx = chapters.findIndex(c => c.id === chapterId);
    const prev = idx >= 0 && idx < chapters.length - 1 ? chapters[idx + 1] : null;
    const next = idx > 0 ? chapters[idx - 1] : null;
    const go = (ch) => openChapterInPlace(manga.id, ch.id, ch.title);

    const nav = document.createElement('div');
    nav.className = 'rcn';

    const mkSide = (cls, icon, label, target, left) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'rcn-btn ' + cls;
        b.disabled = !target;
        if (target) b.title = target.title;
        b.innerHTML = left
            ? `<i class="fa-solid ${icon}"></i><span>${label}</span>`
            : `<span>${label}</span><i class="fa-solid ${icon}"></i>`;
        if (target) b.onclick = () => go(target);
        return b;
    };

    // left corner
    nav.appendChild(mkSide('rcn-back', 'fa-chevron-left', 'Back Chapter', prev, true));

    // middle: chapter selection box (custom dropdown, opens upward, styled list)
    const dd = document.createElement('div');
    dd.className = 'rcn-select';
    const ordered = (typeof chPrefs !== 'undefined' && chPrefs.sort === 'oldest') ? chapters.slice().reverse() : chapters;
    const curCh = chapters[idx];

    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'rcn-trigger';
    trigger.setAttribute('aria-haspopup', 'listbox');
    trigger.setAttribute('aria-expanded', 'false');
    trigger.innerHTML = `<span class="rcn-trigger-text">${esc(curCh ? curCh.title : 'Chapters')}</span><i class="fa-solid fa-chevron-up rcn-caret" aria-hidden="true"></i>`;

    const pop = document.createElement('div');
    pop.className = 'rcn-pop';
    pop.setAttribute('role', 'listbox');
    pop.innerHTML = `<div class="rcn-pop-head"><span>CHAPTERS</span><em>${chapters.length}</em></div>`;
    const listBox = document.createElement('div');
    listBox.className = 'rcn-list';
    ordered.forEach((c) => {
        const it = document.createElement('button');
        it.type = 'button';
        it.className = 'rcn-item' + (c.id === chapterId ? ' current' : '');
        it.setAttribute('role', 'option');
        it.setAttribute('aria-selected', c.id === chapterId ? 'true' : 'false');
        it.innerHTML = `<span class="rcn-item-num">${esc(chapterTileLabel(c))}</span><span class="rcn-item-title">${esc(c.title)}</span>` +
            (c.id === chapterId ? '<i class="fa-solid fa-check rcn-item-check" aria-hidden="true"></i>' : '');
        it.onclick = (ev) => {
            ev.stopPropagation();
            closePop();
            if (c.id !== chapterId) go(c);
        };
        listBox.appendChild(it);
    });
    pop.appendChild(listBox);

    const onDocDown = (ev) => { if (!dd.contains(ev.target)) closePop(); };
    const onKey = (ev) => { if (ev.key === 'Escape') closePop(); };
    function closePop() {
        dd.classList.remove('open');
        trigger.setAttribute('aria-expanded', 'false');
        document.removeEventListener('pointerdown', onDocDown, true);
        document.removeEventListener('keydown', onKey);
    }
    function openPop() {
        dd.classList.add('open');
        trigger.setAttribute('aria-expanded', 'true');
        document.addEventListener('pointerdown', onDocDown, true);
        document.addEventListener('keydown', onKey);
        listBox.scrollTop = 0;                                   // always starts with the first chapters (5 visible), the rest by scrolling
        const cur = listBox.querySelector('.current');
        if (cur && cur.offsetTop + cur.offsetHeight > listBox.clientHeight) listBox.scrollTop = Math.max(0, cur.offsetTop - 8);   // reading chapter is further down: bring it into view
    }
    trigger.onclick = (ev) => { ev.stopPropagation(); dd.classList.contains('open') ? closePop() : openPop(); };

    dd.appendChild(trigger);
    dd.appendChild(pop);
    nav.appendChild(dd);

    // right corner
    nav.appendChild(mkSide('rcn-next', 'fa-chevron-right', 'Next Chapter', next, false));
    return nav;
}

// Page mode: show the fixed chapter bar only while the last page is on screen
function syncPageChapterNav() {
    const bar = document.getElementById('readerChapterNavFixed');
    if (!bar) return;
    const total = document.querySelectorAll('.manga-page-wrapper.page-mode').length;
    bar.classList.toggle('show', currentReadingMode === 'page' && total > 0 && currentPageIndex >= total - 1);
}

let readerBlobUrls = [];
let readerRenderToken = 0;
function revokeReaderBlobs() { readerBlobUrls.forEach(u => { try { URL.revokeObjectURL(u); } catch (e) {} }); readerBlobUrls = []; }

// Downloaded chapter -> pages come from the device (zero bandwidth, works with no internet). Otherwise -> online as before.
function renderReaderContent(readerParam, startIndex = 0) {
    const token = ++readerRenderToken;
    const key = readerParam.includes('___') ? readerParam : '';
    if (key && dlIsOffline(key)) {
        offGet(key).then((rec) => {
            if (token !== readerRenderToken) return;                    // user already moved on
            if (rec && rec.blobs && rec.blobs.length) {
                revokeReaderBlobs();
                readerBlobUrls = rec.blobs.map(b => URL.createObjectURL(b));
                renderReaderContentInner(readerParam, startIndex, readerBlobUrls);
            } else {
                // files are gone (browser cleared storage): forget the offline flag, read online
                const e = dlEntry(key); if (e) { e.off = false; dlSetEntry(e); }
                renderReaderContentInner(readerParam, startIndex, null);
            }
        }).catch(() => { if (token === readerRenderToken) renderReaderContentInner(readerParam, startIndex, null); });
        return;
    }
    revokeReaderBlobs();
    renderReaderContentInner(readerParam, startIndex, null);
}

function renderReaderContentInner(readerParam, startIndex = 0, offlineUrls = null) {
    const container = document.getElementById('readerPagesContainer');
    const readerSection = document.getElementById('readerView');
    if (!container) return;
    if (readerObserver) { readerObserver.disconnect(); readerObserver = null; }
    container.innerHTML = '';
    delete container.dataset.cxLocked;

    const [mangaId, chapterId] = readerParam.includes('___') ? readerParam.split('___') : [null, readerParam];
    const foundManga = mangaId ? loadAllMangas().find(m => m.id === mangaId) : null;
    const foundCh = (foundManga && foundManga.chapters) ? foundManga.chapters.find(c => c.id === chapterId) : null;

    if (!offlineUrls && foundManga && foundCh && coinLocked(mangaId, chapterId)) { renderLockedReader(container, mangaId, chapterId, foundCh, readerParam); return; }

    const floatingTitle = document.getElementById('readerFloatingTitle');
    if (floatingTitle && foundManga && foundCh) floatingTitle.textContent = `${foundManga.title} - ${foundCh.title}` + (offlineUrls ? '  \u00b7  Offline' : '');

    readProgKey = (foundManga && foundCh) ? `${mangaId}___${chapterId}` : '';
    markChapterOpened(readProgKey);
    recordLastRead(readProgKey);
    if (foundCh && foundCh.pages && foundCh.pages.length > 0) {
        totalChapterPages = foundCh.pages;
        const pageMode = currentReadingMode === 'page';
        currentPageIndex = pageMode ? Math.min(Math.max(startIndex, 0), foundCh.pages.length - 1) : 0;

        if (pageMode) {
            container.style.height = '100vh';
            container.style.height = '100dvh';   // mobile browsers: 100vh is taller than the visible area
        } else {
            container.style.height = 'auto';
        }

        // Low/Medium quality: only decode pages that are close to the screen (scroll mode)
        const lazy = !pageMode && currentImageQuality !== 'high' && 'IntersectionObserver' in window;
        if (lazy) {
            readerObserver = new IntersectionObserver((entries) => {
                entries.forEach(en => {
                    if (en.isIntersecting) {
                        readerObserver.unobserve(en.target);
                        if (en.target._start) en.target._start();
                    }
                });
            }, { root: readerSection, rootMargin: '1500px 0px' });
        }

        foundCh.pages.forEach((pageObj, index) => {
            const rawUrl = (offlineUrls && offlineUrls[index]) || pageObj.data || pageObj;
            const wrapper = document.createElement('div');
            wrapper.id = `manga-page-${index}`;

            if (pageMode) {
                const pos = index === currentPageIndex ? 'active-page' : (index < currentPageIndex ? 'prev-page' : 'next-page');
                wrapper.className = `manga-page-wrapper page-mode ${pos}`;
            } else {
                wrapper.className = "manga-page-wrapper w-full flex justify-center m-0 p-0";
            }

            const loader = document.createElement('div');
            loader.className = "simple-loading-text";
            setLoaderLoading(loader);

            const img = document.createElement('img');
            img.loading = "lazy";
            img.className = "manga-page-img";

            img.onload = () => {
                img.classList.add('loaded');
                scheduleReadSave(400);
                wrapper.style.minHeight = '0';
                loader.style.opacity = '0';
                setTimeout(() => loader.remove(), 250);
            };
            img.onerror = () => setLoaderFailed(loader);

            const start = () => loadDownscaledImage(rawUrl, img);
            loader.onclick = (ev) => {
                if (loader.classList.contains('failed')) {
                    ev.stopPropagation();
                    setLoaderLoading(loader);
                    start();
                }
            };

            wrapper.appendChild(loader);
            wrapper.appendChild(img);
            container.appendChild(wrapper);

            if (readerObserver) {
                wrapper._start = start;
                readerObserver.observe(wrapper);
            } else {
                start();
            }
        });

        // Chapter navigation: Back Chapter | chapter select | Next Chapter
        // scroll mode -> at the end of the chapter; page mode -> fixed bar that shows on the last page
        const oldFixedNav = document.getElementById('readerChapterNavFixed');
        if (oldFixedNav) oldFixedNav.remove();
        if (foundManga) {
            const nav = buildChapterNav(foundManga, chapterId);
            if (!pageMode) {
                const end = document.createElement('div');
                end.className = 'rcn-end';
                end.onclick = (ev) => ev.stopPropagation();
                end.appendChild(nav);
                container.appendChild(end);
            } else if (readerSection) {
                const fixed = document.createElement('div');
                fixed.id = 'readerChapterNavFixed';
                fixed.className = 'rcn-fixed';
                fixed.onclick = (ev) => ev.stopPropagation();
                fixed.appendChild(nav);
                readerSection.appendChild(fixed);
                syncPageChapterNav();
            }
        }

        setupReaderTouchEvents();
        // Auto Download (setting): reading online -> quietly save this chapter for offline too
        if (!offlineUrls && userSettings.autoDl && foundManga && foundCh && foundCh.pages.length) {
            const adKey = mangaId + '___' + chapterId;
            const ae = dlEntry(adKey);
            if (!dlIsOffline(adKey) && !dlRuntime.has(adKey) && !(ae && ae.status === 'downloading')) {
                setTimeout(() => { if (userSettings.autoDl) startDownload(mangaId, chapterId, { auto: true }); }, 1500);
            }
        }
        lastReaderScrollTop = 0;
        scheduleReadSave(700);      // short chapters / page mode: counts what is already on screen
        if (readerSection) {
            if (!pageMode && startIndex > 0 && container.children[startIndex]) {
                readerSection.scrollTop = container.children[startIndex].offsetTop;
            } else {
                readerSection.scrollTop = 0;
            }
        }
        window.scrollTo(0, 0);
        return;
    }

    const staleNav = document.getElementById('readerChapterNavFixed');
    if (staleNav) staleNav.remove();
    container.style.height = 'auto';
    container.innerHTML = `
        <div class="p-10 text-center text-slate-400 text-xs w-full">
            Manga Panel Image Placeholder desu~ (Upload chapters from Uploader Panel to view actual images!)
        </div>
    `;
    if (readerSection) readerSection.scrollTop = 0;
    window.scrollTo(0, 0);
}

// Fill the Chapter Lobby (detail page) for one manga
function fillDetail(found) {
    document.getElementById('detailTitle').textContent = found.title;
    document.getElementById('detailCoverBox').style.backgroundImage = cssUrl(found.image);

    const badgeEl = document.getElementById('detailCoverTagBadge');
    if (badgeEl) badgeEl.textContent = found.coverType || 'Manga';

    const ratingEl = document.getElementById('detailRatingText');
    if (ratingEl) ratingEl.textContent = found.rating || '4.9 / 5.0';

    const heroEl = document.getElementById('cinematicHero');
    if (heroEl && found.image) heroEl.style.setProperty('--hero-bg', cssUrl(found.image));

    const descEl = document.getElementById('detailDescription');
    if (descEl) descEl.textContent = found.description || 'No description available desu~';

    const genresContainer = document.getElementById('detailGenresContainer');
    if (genresContainer) {
        genresContainer.innerHTML = '';
        // small tags first, long ones after: they pack into fewer rows instead of a short tag being pushed down alone
        const genreList = (found.genre || '').split(',').map(g => g.trim()).filter(Boolean)
            .map((g, i) => ({ g, i }))
            .sort((a, b) => (a.g.length - b.g.length) || (a.i - b.i))
            .map(o => o.g);
        genreList.forEach(g => {
            const cleanG = g;
            if (cleanG !== '') {
                const tag = document.createElement('div');
                tag.className = "individual-genre-frame";
                tag.textContent = cleanG;
                genresContainer.appendChild(tag);
            }
        });
        packGenreChips(genresContainer);
    }

    renderChapterList(found.id);
    applyBookmarkUI(safeGet(BOOKMARK_KEY, []).includes(found.id));
}

// Genre tags: order them so that the normal wrapping fills every row as much as possible (a tag is only
// pushed to the next row when it really does not fit). Only the ORDER of the tags is changed; the layout itself
// stays the plain flex-wrap, so nothing can overflow or break even if a measurement is a little off.
function packGenreChips(box, tries) {
    tries = tries || 0;
    if (!box) return;
    const chips = Array.from(box.querySelectorAll('.individual-genre-frame'));
    if (chips.length < 2) return;
    const W = box.clientWidth;
    if (!W) {                                    // page not visible yet: try again on the next frames
        if (tries < 40) requestAnimationFrame(() => packGenreChips(box, tries + 1));
        return;
    }
    const gap = parseFloat(getComputedStyle(box).columnGap) || 6;
    const items = chips.map(el => ({ el, w: el.offsetWidth }));      // offsetWidth = layout width (ignores animations/zoom effects)
    if (items.some(it => !it.w)) return;
    items.sort((a, b) => b.w - a.w);                       // biggest first, each goes to the first row with room
    const rows = [];
    items.forEach(it => {
        let r = rows.find(r => r.used + gap + it.w <= W - 1);
        if (!r) { r = { items: [], used: -gap }; rows.push(r); }
        r.used += gap + it.w;
        r.items.push(it);
    });
    rows.forEach(r => r.items.sort((a, b) => a.w - b.w));
    rows.sort((a, b) => (b.items.length - a.items.length) || (a.used - b.used));   // rows with the small tags first
    rows.forEach(r => r.items.forEach(it => box.appendChild(it.el)));              // re-append = new order
}
(function () {                                 // re-order when the screen turns or fonts finish loading
    let t = 0;
    const again = () => {
        clearTimeout(t);
        t = setTimeout(() => {
            const box = document.getElementById('detailGenresContainer');
            if (box && box.children.length) packGenreChips(box);
        }, 150);
    };
    window.addEventListener('resize', again);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(again);
})();

// Decides HOW to switch views: smooth cross-fade (View Transitions API) -> CSS slide fallback -> instant (reduced motion)
function renderView(state, isRestore = false) {
    const isFirst = !firstViewRendered;
    firstViewRendered = true;
    const reduce = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

    if (isFirst || reduce || perfLow()) {
        applyView(state, isFirst ? 'first' : 'none');
        return;
    }
    if (typeof document.startViewTransition === 'function') {
        // The browser snapshots the old page, we swap the DOM, then it cross-fades old -> new.
        // No blank frame, and the new page is already at the right scroll position.
        document.documentElement.dataset.nav = navDirection === 'back' ? 'back' : 'forward';
        const go = () => document.startViewTransition(() => applyView(state, 'none'));
        // Chapter Lobby: make sure its cover is already decoded, otherwise the new snapshot is taken
        // while the cover is still empty (black flash / half a cover).
        const target = state.view === 'detail' ? loadAllMangas().find(m => m.id === state.id) : null;
        if (target && target.image) {
            const img = new Image();
            img.src = target.image;
            const ready = img.decode ? img.decode().catch(() => {}) : Promise.resolve();
            Promise.race([ready, new Promise(r => setTimeout(r, 350))]).then(go);
        } else {
            go();
        }
        return;
    }
    applyView(state, 'css');
}

// mode: 'first' (page load) | 'none' (no CSS animation) | 'css' (fallback slide animation)
function applyView(state, mode) {
    const views = ['homeView', 'genresView', 'detailView', 'readerView', 'historyView', 'settingsView'];
    const prevVisible = views.find(v => !document.getElementById(v).classList.contains('hidden'));   // page we are leaving
    if (prevVisible === 'readerView') { clearTimeout(readSaveTimer); saveReadProgress(); }   // keep the last bit of progress before the reader is hidden
    views.forEach(v => {
        const el = document.getElementById(v);
        el.classList.add('hidden');
        el.classList.remove('lobby-slide-right-transition', 'lobby-slide-left-transition');
        if (mode !== 'first') el.classList.remove('home-cinematic-entry');
    });

    const floatingBar = document.getElementById('readerFloatingBar');
    const modal = document.getElementById('settingsModal');
    const backdrop = document.getElementById('settingsBackdrop');

    if (floatingBar && state.view !== 'reader') floatingBar.classList.remove('show');
    if (modal) modal.classList.remove('show');
    if (backdrop) backdrop.classList.add('opacity-0', 'pointer-events-none');

    let targetId = 'homeView';
    if (state.view === 'genres' || state.view === 'latest') {
        targetId = 'genresView';
        genresMode = state.view;
        renderGenresView();
    }
    if (state.view === 'history') targetId = 'historyView';
    if (state.view === 'history') renderHistoryPage();
    if (state.view === 'settings') { targetId = 'settingsView'; renderSettingsPage(); }
    if (state.view === 'detail') {
        targetId = 'detailView';
        shownDetailId = state.id;
        const found = loadAllMangas().find(m => m.id === state.id);
        if (found) fillDetail(found);
    }
    if (state.view === 'reader') {
        targetId = 'readerView';
        renderReaderContent(state.id);
    }

    const targetSection = document.getElementById(targetId);
    if (targetSection) {
        // Lobby entrance animation only when arriving from Home/Genres - never when returning from the Reader
        if (targetId === 'detailView') {
            if (prevVisible !== 'detailView') targetSection.classList.toggle('lobby-enter', prevVisible !== 'readerView');
        } else {
            document.getElementById('detailView').classList.remove('lobby-enter');
        }
        targetSection.classList.remove('hidden');
        if (mode === 'css') {
            void targetSection.offsetWidth;   // flush styles so the animation restarts even when the same view is re-opened
            if (state.view === 'home') {
                targetSection.classList.add('home-cinematic-entry');
            } else {
                targetSection.classList.add(navDirection === 'back' ? 'lobby-slide-left-transition' : 'lobby-slide-right-transition');
            }
        }
    }

    const headerBar = document.getElementById('mainHeaderBar');
    const sakuraCanvas = document.getElementById('sakuraCanvas');

    updateHomeDock(targetId);
    currentViewId = targetId;
    syncWakeLock();

    if (targetId === 'readerView' || targetId === 'detailView' || targetId === 'historyView' || targetId === 'settingsView') {
        if (headerBar) headerBar.classList.add('hidden');
        if (sakuraCanvas) sakuraCanvas.style.display = 'none';
    } else {
        if (headerBar) headerBar.classList.remove('hidden');
        if (sakuraCanvas) sakuraCanvas.style.display = 'block';
    }

    if (targetId === 'homeView') {
        // Home is kept up to date by refreshCurrentView()/filters/search, so only build it if it is still empty.
        // Rebuilding it on every return recreates all cards and their cover images flash in again.
        const grid = document.getElementById('mainMangaGridContainer');
        const showcase = document.getElementById('showcaseScrollContainer');
        if (!grid || grid.children.length === 0) renderMainMangaGrid();
        if (!showcase || showcase.children.length === 0) renderHotShowcase();
        renderLatestHero();
    }

    // Scroll position is set right away (no setTimeout), so the page never "jumps" during the fade
    if (state.view === 'reader') {
        const readerSec = document.getElementById('readerView');
        if (readerSec) readerSec.scrollTop = 0;
        window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
    } else if (state.view === 'detail') {
        // Back from the reader -> same spot in the chapter list.  Arriving from Home (or anywhere else) -> top.
        const key = 'detail:' + state.id;
        const y = (navDirection === 'back' && mode !== 'first') ? (scrollPositions[key] || 0) : 0;
        if (navDirection !== 'back') delete scrollPositions[key];
        window.scrollTo({ top: y, left: 0, behavior: 'instant' });
    } else {
        window.scrollTo({ top: scrollPositions[targetId] || 0, left: 0, behavior: 'instant' });
    }
}

// ---- Search dropdown + "recent searches" memory ----
const RECENT_SEARCH_KEY = "sakura_recent_searches_v1";
const RECENT_SEARCH_MAX = 8;
let searchBodyMode = '';
let searchDebounce = null;     // debounce timer for live Home filtering (must be cancelled when the search closes)
let searchDusting = false;     // true while the "Clear all" dust animation is playing

function getRecentSearches() {
    const list = safeGet(RECENT_SEARCH_KEY, []);
    return Array.isArray(list) ? list.filter(x => x && x.id) : [];
}
function saveRecentSearch(m) {
    const list = getRecentSearches().filter(x => x.id !== m.id);
    list.unshift({ id: m.id, title: m.title, image: m.image, genre: m.genre || '', t: Date.now() });
    safeSet(RECENT_SEARCH_KEY, list.slice(0, RECENT_SEARCH_MAX));
}
function isSearchOpen() {
    const o = document.getElementById('searchOverlay');
    return !!o && o.classList.contains('is-open');
}

function highlightMatch(title, q) {
    const i = title.toLowerCase().indexOf(q.toLowerCase());
    if (i < 0 || !q) return esc(title);
    return esc(title.slice(0, i)) + '<mark>' + esc(title.slice(i, i + q.length)) + '</mark>' + esc(title.slice(i + q.length));
}

function searchItemHtml(m, i, opts) {
    const sub = m.genre || m.status || m.coverType || 'Manga';
    const badge = opts.recent ? '<span class="search-thumb-badge"><i class="fa-solid fa-clock-rotate-left"></i></span>' : '';
    const trail = opts.recent
        ? '<span class="search-remove" role="button" tabindex="0" data-remove="' + esc(m.id) + '" aria-label="Remove from recent"><i class="fa-solid fa-xmark"></i></span>'
        : '<i class="fa-solid fa-chevron-right search-go"></i>';
    return '<div class="search-item" role="button" tabindex="0" data-id="' + esc(m.id) + '" style="--i:' + i + '">' +
        '<span class="search-thumb" style=\'background-image:' + esc(cssUrl(m.image)) + '\'>' + badge + '</span>' +
        '<span class="search-meta"><span class="search-title">' + (opts.q ? highlightMatch(String(m.title || ''), opts.q) : esc(m.title)) + '</span>' +
        '<span class="search-sub">' + esc(sub) + '</span></span>' + trail + '</div>';
}

function getSearchMatches(q) {
    const ql = q.toLowerCase();
    return loadSharedMangas()
        .filter(m => String(m.title || '').toLowerCase().includes(ql))
        .sort((a, b) => {
            const as = String(a.title || '').toLowerCase().startsWith(ql) ? 0 : 1;
            const bs = String(b.title || '').toLowerCase().startsWith(ql) ? 0 : 1;
            return as - bs;
        });
}

function renderSearchBody(forceAnimate) {
    const body = document.getElementById('searchBody');
    const input = document.getElementById('searchInput');
    if (!body || !input) return;
    const q = input.value.trim();
    const mode = q ? 'results' : 'recent';
    let html = '';

    if (mode === 'recent') {
        const all = loadSharedMangas();
        const live = new Map(all.map(m => [m.id, m]));
        const list = getRecentSearches().map(r => live.get(r.id) || (all.length ? null : r)).filter(Boolean);
        if (list.length) {
            html = '<div class="search-section"><span><i class="fa-solid fa-clock-rotate-left"></i> Recent searches</span>' +
                   '<button type="button" class="search-clear-all" data-clear-all>Clear all</button></div>' +
                   list.map((m, i) => searchItemHtml(m, i, { recent: true })).join('');
        } else {
            html = '<div class="search-empty"><i class="fa-regular fa-clock"></i><p>Manga you search for will be remembered here</p></div>';
        }
    } else {
        const matches = getSearchMatches(q);
        if (matches.length) {
            html = '<div class="search-section"><span><i class="fa-solid fa-wand-magic-sparkles"></i> Results</span><em>' + matches.length + '</em></div>' +
                   matches.slice(0, 6).map((m, i) => searchItemHtml(m, i, { q })).join('');
            if (matches.length > 6) html += '<div class="search-more">+' + (matches.length - 6) + ' more shown on Home</div>';
        } else {
            html = '<div class="search-empty"><i class="fa-regular fa-face-sad-tear"></i><p>No manga found for “' + esc(q) + '”</p></div>';
        }
    }

    body.classList.toggle('stagger', !!forceAnimate || mode !== searchBodyMode);
    searchBodyMode = mode;
    body.innerHTML = html;
}

let searchOpening = false;
function openSearchResult(id) {
    if (searchOpening || searchDusting) return;
    const m = loadAllMangas().find(x => x.id === id) || getRecentSearches().find(x => x.id === id);
    if (!m) return;
    saveRecentSearch(m);
    searchOpening = true;
    clearTimeout(searchDebounce); searchDebounce = null;
    // 1) close the search panel + dim backdrop + keyboard with their normal animation
    closeSearchBar(true);
    // 2) when Home is clean again (same state as tapping a card), run the exact same Chapter Lobby transition
    setTimeout(() => {
        searchOpening = false;
        window.navigateToView('detail', m.id, m.title);
        // 3) reset the Home filter afterwards (Home is hidden now, so nothing flashes)
        if (searchQuery) { searchQuery = ''; renderMainMangaGrid(); }
    }, 340);
}

function loadDustImage(url) {
    return new Promise(res => {
        const done = (img) => res(img);
        const tryLoad = (cors) => {
            const im = new Image();
            if (cors) im.crossOrigin = 'anonymous';
            im.onload = () => done(im);
            im.onerror = () => cors ? tryLoad(false) : done(null);
            im.src = url;
        };
        tryLoad(true);
        setTimeout(() => done(null), 1500);
    });
}
function dustWrapText(ctx, text, maxW, maxLines) {
    const words = String(text).split(/\s+/), lines = [];
    let cur = '';
    for (const w of words) {
        const t = cur ? cur + ' ' + w : w;
        if (ctx.measureText(t).width <= maxW || !cur) cur = t;
        else { lines.push(cur); cur = w; }
    }
    if (cur) lines.push(cur);
    if (lines.length > maxLines) {
        lines.length = maxLines;
        let l = lines[maxLines - 1];
        while (l.length > 1 && ctx.measureText(l + '…').width > maxW) l = l.slice(0, -1);
        lines[maxLines - 1] = l + '…';
    }
    return lines;
}

// ---- Dust effect: the real cover + title crumble into ROUND dust grains and blow away ----
// Used by BOTH "Clear all" (every row) and the little X on one row (just that row).
let dustActive = 0;            // how many dust animations are playing right now

function dustReduced() {
    return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
}

// copy of a canvas where every (step x step) cell is cut into a circle -> each grain is a round dot
function dustRoundSheet(src, step) {
    const sheet = document.createElement('canvas');
    sheet.width = src.width; sheet.height = src.height;
    const sx = sheet.getContext('2d');
    sx.drawImage(src, 0, 0);
    const mask = document.createElement('canvas');
    mask.width = src.width; mask.height = src.height;
    const mx = mask.getContext('2d');
    mx.fillStyle = '#000';
    for (let y = 0; y < src.height; y += step) for (let x = 0; x < src.width; x += step) {
        mx.beginPath(); mx.arc(x + step / 2, y + step / 2, step / 2, 0, Math.PI * 2); mx.fill();
    }
    sx.globalCompositeOperation = 'destination-in';
    sx.drawImage(mask, 0, 0);
    return sheet;
}

// after the row has turned to dust, let the rows below slide up smoothly
function dustCollapseRow(el) {
    if (!el || !el.isConnected) return;
    el.style.height = el.offsetHeight + 'px';
    void el.offsetHeight;
    el.classList.add('dust-collapse');
    el.style.height = '0px';
}

function dustAfter() {
    dustActive = Math.max(0, dustActive - 1);
    searchDusting = dustActive > 0;
    if (!dustActive) { searchBodyMode = ''; renderSearchBody(true); }
}

async function dustItems(items, opts) {
    opts = opts || {};
    const body = document.getElementById('searchBody');
    const recents = getRecentSearches();      // read now: callers delete the entries from storage right after calling us
    dustActive++; searchDusting = true;
    try {
        const DPR = Math.min(window.devicePixelRatio || 1, 2);
        const step = Math.max(2, Math.round(2 * DPR));   // one grain = 2 css px (was 3) -> far more dust
        const GS = step / DPR;
        const MAX_GRAINS = 18000;

        // measure everything first (before any await, while the layout is still untouched)
        const rows = items.map((el, idx) => {
            const title = el.querySelector('.search-title'), sub = el.querySelector('.search-sub');
            const pick = (n) => { const s = getComputedStyle(n); return { fw: s.fontWeight, fs: s.fontSize, ff: s.fontFamily, color: s.color, lh: s.lineHeight }; };
            return {
                el, idx,
                rec: recents.find(r => r.id === el.getAttribute('data-id')),
                rowR: el.getBoundingClientRect(),
                tr: el.querySelector('.search-thumb').getBoundingClientRect(),
                mr: el.querySelector('.search-meta').getBoundingClientRect(),
                tR: title.getBoundingClientRect(), sR: sub.getBoundingClientRect(),
                tcs: pick(title), scs: pick(sub),
                titleText: title.textContent, subText: sub.textContent
            };
        });

        const grains = [];
        // "static" layer = the intact rows; a row's grains are erased from it the moment they start to fly
        const stc = document.createElement('canvas');
        stc.width = Math.round(innerWidth * DPR); stc.height = Math.round(innerHeight * DPR);
        const stx = stc.getContext('2d');
        stx.scale(DPR, DPR);

        await Promise.all(rows.map(async (r) => {
            const img = r.rec && r.rec.image ? await loadDustImage(r.rec.image) : null;
            const rowDelay = r.idx * 110;

            const addGrains = (sheet, left, top, W, H, PW, PH, alpha) => {
                for (let sy = 0; sy < PH; sy += step) for (let sx = 0; sx < PW; sx += step) {
                    if (sx >= W || sy >= H) continue;
                    if (alpha) {                                   // text layer: skip empty cells
                        let hit = false;
                        for (let yy = sy; yy < Math.min(sy + step, PH) && !hit; yy++)
                            for (let xx2 = sx; xx2 < Math.min(sx + step, PW); xx2++)
                                if (alpha[(yy * PW + xx2) * 4 + 3] > 6) { hit = true; break; }
                        if (!hit) continue;
                    }
                    const gx = left + sx / DPR, gy = top + sy / DPR;
                    const sweep = ((gx - r.rowR.left) / r.rowR.width) * 520;      // wave sweeps left -> right
                    const start = 120 + rowDelay + sweep + Math.random() * 260;
                    grains.push({
                        sheet, sx, sy, x: gx, y: gy, start, bonus: false, size: GS,
                        life: 1100 + Math.random() * 900,
                        vx: 0.8 + Math.random() * 2.6, vy: -(0.2 + Math.random() * 1.6),
                        wob: Math.random() * 6.28, wf: 0.004 + Math.random() * 0.006, amp: 4 + Math.random() * 14
                    });
                    // extra loose dust around every grain -> a thick cloud
                    if (grains.length < MAX_GRAINS && (!alpha || Math.random() < 0.8)) {
                        grains.push({
                            sheet, sx, sy, bonus: true,
                            x: gx + (Math.random() - 0.5) * GS * 3, y: gy + (Math.random() - 0.5) * GS * 3,
                            start: start + Math.random() * 380, size: GS * (0.55 + Math.random() * 0.95),
                            life: 1300 + Math.random() * 1500,
                            vx: 1.2 + Math.random() * 3.4, vy: -(0.1 + Math.random() * 2.2),
                            wob: Math.random() * 6.28, wf: 0.003 + Math.random() * 0.007, amp: 6 + Math.random() * 22
                        });
                    }
                }
            };

            // --- cover layer
            const W = Math.ceil(r.tr.width * DPR), H = Math.ceil(r.tr.height * DPR);
            const PW = Math.ceil(W / step) * step, PH = Math.ceil(H / step) * step;
            const tc = document.createElement('canvas'); tc.width = PW; tc.height = PH;
            const tx = tc.getContext('2d');
            tx.beginPath();
            if (tx.roundRect) tx.roundRect(0, 0, W, H, 10 * DPR); else tx.rect(0, 0, W, H);
            tx.clip();
            tx.fillStyle = tcol('bgc'); tx.fillRect(0, 0, W, H);
            if (img && img.naturalWidth) {
                const sc = Math.max(W / img.naturalWidth, H / img.naturalHeight);
                const w = img.naturalWidth * sc, h = img.naturalHeight * sc;
                tx.drawImage(img, (W - w) / 2, (H - h) / 2, w, h);
            } else {
                const g = tx.createLinearGradient(0, 0, W, H);
                g.addColorStop(0, tcol('c400')); g.addColorStop(1, tcol('c300'));
                tx.fillStyle = g; tx.fillRect(0, 0, W, H);
            }
            stx.drawImage(tc, r.tr.left, r.tr.top, PW / DPR, PH / DPR);
            addGrains(dustRoundSheet(tc, step), r.tr.left, r.tr.top, W, H, PW, PH, null);

            // --- text layer (same font / colour as the row)
            const XW = Math.ceil(r.mr.width * DPR), XH = Math.ceil(r.mr.height * DPR);
            const XPW = Math.ceil(XW / step) * step, XPH = Math.ceil(XH / step) * step;
            const xc = document.createElement('canvas'); xc.width = XPW; xc.height = XPH;
            const xx = xc.getContext('2d');
            xx.scale(DPR, DPR);
            xx.textBaseline = 'top';
            const tfs = parseFloat(r.tcs.fs), tlh = parseFloat(r.tcs.lh) || tfs * 1.25;
            xx.font = `${r.tcs.fw} ${r.tcs.fs} ${r.tcs.ff}`; xx.fillStyle = r.tcs.color;
            dustWrapText(xx, r.titleText, r.tR.width, 2).forEach((ln, i) =>
                xx.fillText(ln, r.tR.left - r.mr.left, r.tR.top - r.mr.top + i * tlh + (tlh - tfs) / 2));
            const sfs = parseFloat(r.scs.fs);
            xx.font = `${r.scs.fw} ${r.scs.fs} ${r.scs.ff}`; xx.fillStyle = r.scs.color;
            xx.fillText(dustWrapText(xx, r.subText, r.sR.width, 1)[0] || '', r.sR.left - r.mr.left, r.sR.top - r.mr.top + (r.sR.height - sfs) / 2);
            let alpha = null;
            try { alpha = xx.getImageData(0, 0, XPW, XPH).data; } catch (e) {}
            stx.drawImage(xc, r.mr.left, r.mr.top, XPW / DPR, XPH / DPR);
            addGrains(dustRoundSheet(xc, step), r.mr.left, r.mr.top, XW, XH, XPW, XPH, alpha);
        }));

        grains.sort((a, b) => a.start - b.start);

        // overlay canvas; the real rows are hidden on the very frame the intact copy appears
        const cv = document.createElement('canvas');
        cv.className = 'dust-canvas';
        cv.style.cssText = 'position:fixed;left:0;top:0;width:' + innerWidth + 'px;height:' + innerHeight + 'px;';
        cv.width = Math.round(innerWidth * DPR); cv.height = Math.round(innerHeight * DPR);
        document.body.appendChild(cv);
        const ctx = cv.getContext('2d');
        ctx.scale(DPR, DPR);
        ctx.drawImage(stc, 0, 0, innerWidth, innerHeight);
        items.forEach(el => el.classList.add('dust-hide'));
        const hdr = body && body.querySelector('.search-clear-all');
        if (hdr && (opts.all || !body.querySelector('.search-item:not(.dust-hide)'))) hdr.classList.add('dust-fade');
        if (opts.collapse) items.forEach(el => setTimeout(() => dustCollapseRow(el), 200));

        let end = 0;
        grains.forEach(g => { end = Math.max(end, g.start + g.life); });
        const live = [];
        let next = 0;
        const t0 = performance.now();
        await new Promise((resolve) => {
            (function frame(now) {
                const t = now - t0;
                ctx.clearRect(0, 0, innerWidth, innerHeight);
                while (next < grains.length && grains[next].start <= t) {      // grains that take off now
                    const g = grains[next++];
                    if (!g.bonus) stx.clearRect(g.x - 0.5, g.y - 0.5, GS + 1, GS + 1);
                    live.push(g);
                }
                if (next < grains.length) ctx.drawImage(stc, 0, 0, innerWidth, innerHeight);   // the part that has not crumbled yet
                for (let i = live.length - 1; i >= 0; i--) {
                    const g = live[i];
                    const age = t - g.start;
                    if (age > g.life) { live[i] = live[live.length - 1]; live.pop(); continue; }
                    const k = age / g.life, ease = k * k;
                    const x = g.x + g.vx * age * 0.075 + Math.sin(g.wob + age * g.wf) * g.amp * ease;
                    const y = g.y + g.vy * age * 0.06 - 70 * ease + Math.cos(g.wob + age * g.wf) * 5 * k;
                    const s = g.size * (1 - k * 0.45);
                    ctx.globalAlpha = Math.max(0, 1 - k * 1.05);
                    ctx.drawImage(g.sheet, g.sx, g.sy, step, step, x, y, s, s);
                }
                ctx.globalAlpha = 1;
                if (t < end + 60) requestAnimationFrame(frame);
                else { cv.remove(); resolve(); }
            })(t0);
        });
    } catch (err) {
        console.warn('dust effect failed', err);
        document.querySelectorAll('.dust-canvas').forEach(c => c.remove());
    }
    dustAfter();
}

// "Clear all": every visible row turns to dust, memory is wiped
function dustClearAll() {
    if (searchDusting) return;
    const body = document.getElementById('searchBody');
    const items = body ? Array.from(body.querySelectorAll('.search-item:not(.dust-hide)')) : [];
    if (!items.length || dustReduced()) {
        safeSet(RECENT_SEARCH_KEY, []);
        renderSearchBody(true);
        return;
    }
    dustItems(items, { all: true });                 // (its first lines read the covers from storage before we wipe it)
    safeSet(RECENT_SEARCH_KEY, []);
}

// the X on ONE row: only that row turns to dust, the rows below slide up
function removeRecentSearch(id, row) {
    if (searchDusting || (row && row.classList.contains('dust-hide'))) return;
    if (!row || dustReduced()) {
        safeSet(RECENT_SEARCH_KEY, getRecentSearches().filter(x => x.id !== id));
        renderSearchBody(false);
        return;
    }
    dustItems([row], { collapse: true });
    safeSet(RECENT_SEARCH_KEY, getRecentSearches().filter(x => x.id !== id));
}

function openSearchBar() {
    const overlay = document.getElementById('searchOverlay');
    const input = document.getElementById('searchInput');
    if (!overlay || !input) return;
    searchBodyMode = '';
    renderSearchBody(true);
    overlay.classList.add('is-open');
    overlay.setAttribute('aria-hidden', 'false');
    document.getElementById('searchBackdrop')?.classList.add('is-open');
    const btn = document.getElementById('searchToggleBtn');
    if (btn) { btn.classList.add('is-active'); btn.setAttribute('aria-expanded', 'true'); }
    input.focus({ preventScroll: true });
}

function closeSearchBar(instant) {
    const overlay = document.getElementById('searchOverlay');
    const input = document.getElementById('searchInput');
    if (!overlay || !input) return;
    clearTimeout(searchDebounce); searchDebounce = null;
    overlay.classList.remove('is-open');
    overlay.setAttribute('aria-hidden', 'true');
    document.getElementById('searchBackdrop')?.classList.remove('is-open');
    const btn = document.getElementById('searchToggleBtn');
    if (btn) { btn.classList.remove('is-active'); btn.setAttribute('aria-expanded', 'false'); }
    input.blur();
    input.value = '';
    overlay.querySelector('.search-field')?.classList.remove('has-value');
    if (!instant && searchQuery) { searchQuery = ''; renderMainMangaGrid(); }
}

window.toggleSearchBar = function() {
    if (isSearchOpen()) closeSearchBar(); else openSearchBar();
};

window.clearSearchInput = function() {
    const input = document.getElementById('searchInput');
    if (!input) return;
    input.value = '';
    input.dispatchEvent(new Event('input'));
    input.focus({ preventScroll: true });
};

function setupSearch() {
    const input = document.getElementById('searchInput');
    const body = document.getElementById('searchBody');
    if (!input || !body) return;
    input.addEventListener('input', () => {
        input.closest('.search-field')?.classList.toggle('has-value', input.value.length > 0);
        renderSearchBody(false);
        clearTimeout(searchDebounce);
        searchDebounce = setTimeout(() => {
            if (!isSearchOpen()) return;
            searchQuery = input.value.trim().toLowerCase();
            if (currentActiveView !== 'home') window.goHome();
            else renderMainMangaGrid();
        }, 150);
    });
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            const q = input.value.trim();
            if (!q) return;
            const first = getSearchMatches(q)[0];
            if (first) { e.preventDefault(); openSearchResult(first.id); }
        }
    });
    body.addEventListener('pointerdown', (e) => {
        if (e.target.closest('[data-remove],[data-clear-all]')) e.preventDefault();   // keep input focused: keyboard must not move the layout
    });
    body.addEventListener('mousedown', (e) => {
        if (e.target.closest('[data-remove],[data-clear-all]')) e.preventDefault();
    });
    body.addEventListener('click', (e) => {
        const rm = e.target.closest('[data-remove]');
        if (rm) {
            e.stopPropagation();
            removeRecentSearch(rm.getAttribute('data-remove'), rm.closest('.search-item'));
            return;
        }
        if (e.target.closest('[data-clear-all]')) {
            dustClearAll();
            return;
        }
        const it = e.target.closest('.search-item[data-id]');
        if (it) openSearchResult(it.getAttribute('data-id'));
    });
    body.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        const rm = e.target.closest('[data-remove]');
        if (rm) { e.preventDefault(); rm.click(); return; }
        const it = e.target.closest('.search-item[data-id]');
        if (it) { e.preventDefault(); openSearchResult(it.getAttribute('data-id')); }
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && isSearchOpen()) closeSearchBar();
    });
}

// ============================================================================
//  COLOUR THEMES  (replaces the old day / night toggle)
//  The palettes live in style.css (html[data-theme=...]); JS only switches the attribute
//  and tells the canvas scenes to re-read the colours.
// ============================================================================
const THEME_KEY = 'sakura_theme_v1';
const THEMES = [
    { id: 'teal',   name: 'Sakura Teal', a: '#5fe0c2', b: '#0ea691', bg: '#060e10', tag: 'Original' },
    { id: 'rose',   name: 'Rose',        a: '#ff8fab', b: '#e13e70', bg: '#10070b' },
    { id: 'violet', name: 'Violet',      a: '#b7a4ff', b: '#7c5ce8', bg: '#0a0814' },
    { id: 'amber',  name: 'Amber',       a: '#ffcf78', b: '#f58e14', bg: '#100b06' },
    { id: 'aurora', name: 'Aurora',      a: '#5fe0c2', b: '#7c5ce8', bg: '#070a14', tag: 'Blend' },
    { id: 'sunset', name: 'Sunset',      a: '#ffbe6e', b: '#e83e70', bg: '#100810', tag: 'Blend' },
    { id: 'smoke',    name: 'Smoke',       a: '#ffffff', b: '#808694', bg: '#16181d', tag: 'Blend' },
    { id: 'goldgrey', name: 'Gold Grey',   a: '#f0d482', b: '#80848e', bg: '#111114', tag: 'Blend' },
    { id: 'white',    name: 'White',       a: '#ffffff', b: '#475569', bg: '#ffffff' },
    { id: 'black',    name: 'Black',       a: '#d4d4d4', b: '#737373', bg: '#000000' }
];
// current palette as [r,g,b] arrays, read from the CSS variables (used by the canvas scenes)
const THEME_RGB = {};
function readThemeColors() {
    const cs = getComputedStyle(document.documentElement);
    ['c50', 'c100', 'c300', 'c400', 'c500', 'c600', 'c900', 'bgb', 'bgs', 'bgc'].forEach(k => {
        const p = cs.getPropertyValue('--' + k).split(',').map(n => parseInt(n, 10));
        THEME_RGB[k] = p.length === 3 && p.every(n => !isNaN(n)) ? p : [128, 128, 128];
    });
}
function tcol(k, a) { const c = THEME_RGB[k] || [128, 128, 128]; return a === undefined ? `rgb(${c[0]},${c[1]},${c[2]})` : `rgba(${c[0]},${c[1]},${c[2]},${a})`; }
// colour k mixed with [r,g,b] target: t = 0 -> k, t = 1 -> target
function tmix(k, to, t) { const c = THEME_RGB[k] || [128, 128, 128]; return `rgb(${Math.round(c[0] + (to[0] - c[0]) * t)},${Math.round(c[1] + (to[1] - c[1]) * t)},${Math.round(c[2] + (to[2] - c[2]) * t)})`; }

readThemeColors();

function applyTheme(id, save) {
    if (!THEMES.some(t => t.id === id)) id = 'teal';
    document.documentElement.setAttribute('data-theme', id);
    const th = THEMES.find(t => t.id === id);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', th.bg);
    if (save) safeSet(THEME_KEY, id);
    readThemeColors();
    // canvas scenes keep pre-drawn sprites: rebuild them with the new colours
    sSprites = null;
    if (typeof initSidebarScene === 'function' && sidebarCanvas && sWidth) { try { initSidebarScene(); } catch (e) {} }
    document.querySelectorAll('.theme-opt').forEach(b => {
        const on = b.dataset.theme === id;
        b.classList.toggle('active', on);
        b.setAttribute('aria-checked', on ? 'true' : 'false');
    });
}

function buildThemePicker() {
    const grid = document.getElementById('themeGrid');
    if (!grid || grid.childElementCount) return;
    THEMES.forEach(t => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'theme-opt';
        b.dataset.theme = t.id;
        b.setAttribute('role', 'menuitemradio');
        b.innerHTML = `<span class="tp-sw" style="background:linear-gradient(135deg, ${t.a} 0%, ${t.a} 38%, ${t.b} 100%)"></span>` +
            `<span class="tp-name"><span>${t.name}</span>${t.tag ? `<span class="tp-tag">${t.tag}</span>` : ''}</span>` +
            `<span class="tp-check"><i class="fa-solid fa-check"></i></span>`;
        b.onclick = (ev) => { ev.stopPropagation(); applyTheme(t.id, true); };
        grid.appendChild(b);
    });
}

let themeOutsideBound = false;
function closeThemePicker() {
    const pop = document.getElementById('themePicker'), btn = document.getElementById('themeToggleBtn');
    if (pop) { pop.classList.remove('open'); pop.setAttribute('aria-hidden', 'true'); }
    if (btn) btn.setAttribute('aria-expanded', 'false');
}
window.toggleThemePicker = function() {
    const pop = document.getElementById('themePicker'), btn = document.getElementById('themeToggleBtn');
    if (!pop) return;
    buildThemePicker();
    const open = !pop.classList.contains('open');
    if (open) {
        pop.classList.add('open'); pop.setAttribute('aria-hidden', 'false');
        if (btn) btn.setAttribute('aria-expanded', 'true');
        applyTheme(document.documentElement.getAttribute('data-theme') || 'teal', false);   // mark the active one
        if (!themeOutsideBound) {
            themeOutsideBound = true;
            document.addEventListener('pointerdown', (e) => { if (!e.target.closest('.theme-wrap')) closeThemePicker(); }, true);
            document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeThemePicker(); });
        }
    } else closeThemePicker();
};

window.toggleRightSidebar = function() {
    const sidebar = document.getElementById('rightSidebar');
    const backdrop = document.getElementById('sidebarBackdrop');
    const isOpen = !sidebar.classList.contains('translate-x-full');
    
    if (isOpen) {
        sidebar.classList.add('translate-x-full');
        backdrop.classList.add('opacity-0', 'pointer-events-none');
        document.documentElement.classList.remove('sidebar-open');   // let the page scroll again
    } else {
        sidebar.classList.remove('translate-x-full');
        backdrop.classList.remove('opacity-0', 'pointer-events-none');
        document.documentElement.classList.add('sidebar-open');      // page behind must not scroll while the menu is open
        sbFreeze(true);
        setTimeout(resizeSidebarCanvas, 50);
    }
};

// ---- Sidebar height is frozen while the on-screen keyboard is open ----
// The keyboard shrinks the viewport -> the menu (and its branch scene, which is anchored to the bottom) used to shrink with it and the
// branches jumped up. Now the menu keeps its full height, so the keyboard simply covers the lower part.
const sbEl = document.getElementById('rightSidebar');
let sbStableH = 0, sbStableW = 0;
const sbTyping = () => { const a = document.activeElement; return !!(a && sbEl && sbEl.contains(a) && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)); };
function sbFreeze(force) {
    if (!sbEl) return;
    const w = Math.round(window.innerWidth), h = Math.round(window.innerHeight);
    const keyboardLike = w === sbStableW && sbStableH && h < sbStableH * 0.85;     // same width but much shorter = keyboard, not a rotation
    if (!force && (sbTyping() || keyboardLike)) return;
    sbStableW = w; sbStableH = h;
    sbEl.style.setProperty('--sb-h', h + 'px');
}
window.addEventListener('resize', () => sbFreeze(false));
window.addEventListener('orientationchange', () => setTimeout(() => { sbFreeze(true); resizeSidebarCanvas(); }, 350));
if (sbEl) sbEl.addEventListener('focusout', () => setTimeout(() => { if (!sbTyping()) sbFreeze(false); }, 450));
sbFreeze(true);

// ============================================================================
//  SIDEBAR SCENE - blossoming branches
//  Every blossom / bud / leaf is positioned ON its branch's curve every frame, so they can never drift off.
// ============================================================================
const sidebarCanvas = document.getElementById('sidebarSakuraCanvas');
let sCtx = sidebarCanvas ? sidebarCanvas.getContext('2d') : null;
let sWidth = 0, sHeight = 0, sDpr = 1;
let sRoots = [];          // root branches
let sBlossoms = [];       // flat list (used to let petals fall from real blossoms)
let sPetals = [];
let sStars = [];
let sSprites = null;
let sPetalTimer = 0;

function mulberry32(a) {
    return function() {
        a |= 0; a = a + 0x6D2B79F5 | 0;
        let t = Math.imul(a ^ a >>> 15, 1 | a);
        t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
}

function resizeSidebarCanvas() {
    if (!sidebarCanvas || !sCtx) return;
    if (sbTyping()) return;                       // keyboard open: keep the scene exactly as it is
    const w = sidebarCanvas.parentElement.clientWidth;
    const h = sidebarCanvas.parentElement.clientHeight;
    if (!w || !h) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (w === sWidth && h === sHeight && dpr === sDpr && sRoots.length) return;
    sWidth = w; sHeight = h; sDpr = dpr;
    sidebarCanvas.width = Math.round(w * dpr);
    sidebarCanvas.height = Math.round(h * dpr);
    sCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    initSidebarScene();       // the layout depends on the size, so rebuild: branches stay anchored to the edges
}
window.addEventListener('resize', resizeSidebarCanvas);

// ---- pre-rendered sprites (cheap to draw, no per-frame shadowBlur) ----
function makeBlossomSprite(variant) {
    const S = 96, c = document.createElement('canvas');
    c.width = c.height = S;
    const x = c.getContext('2d');
    x.translate(S / 2, S / 2);
    const pal = [[tcol('c300'), tcol('c50')], [tcol('c400'), tcol('c100')], [tmix('c500', [255, 255, 255], 0.45), tmix('c50', [255, 255, 255], 0.4)]][variant];
    let g = x.createRadialGradient(0, 0, 3, 0, 0, S / 2);
    g.addColorStop(0, tcol('c300', 0.42));
    g.addColorStop(1, tcol('c300', 0));
    x.fillStyle = g;
    x.beginPath(); x.arc(0, 0, S / 2, 0, Math.PI * 2); x.fill();
    for (let p = 0; p < 5; p++) {
        x.save();
        x.rotate(p * Math.PI * 2 / 5);
        const pg = x.createLinearGradient(0, 0, 0, -34);
        pg.addColorStop(0, pal[0]); pg.addColorStop(1, pal[1]);
        x.fillStyle = pg;
        x.beginPath();
        x.moveTo(0, 0);
        x.bezierCurveTo(-15, -8, -17, -28, -6, -34);
        x.quadraticCurveTo(0, -29, 6, -34);          // the little notch of a cherry petal
        x.bezierCurveTo(17, -28, 15, -8, 0, 0);
        x.closePath(); x.fill();
        x.strokeStyle = 'rgba(255,255,255,0.55)'; x.lineWidth = 0.8; x.stroke();
        x.strokeStyle = tcol('c500', 0.35);
        x.beginPath(); x.moveTo(0, -5); x.lineTo(0, -24); x.stroke();
        x.restore();
    }
    x.fillStyle = tcol('c600');
    x.beginPath(); x.arc(0, 0, 4.2, 0, Math.PI * 2); x.fill();
    for (let i = 0; i < 8; i++) {                    // stamens
        const a = i * 0.785 + 0.2, l = 9 + (i * 7) % 4;
        x.strokeStyle = 'rgba(255,233,168,0.9)'; x.lineWidth = 1;
        x.beginPath(); x.moveTo(0, 0); x.lineTo(Math.cos(a) * l, Math.sin(a) * l); x.stroke();
        x.fillStyle = '#ffe9a8';
        x.beginPath(); x.arc(Math.cos(a) * l, Math.sin(a) * l, 1.7, 0, Math.PI * 2); x.fill();
    }
    return c;
}

function makeBudSprite() {
    const c = document.createElement('canvas');
    c.width = 32; c.height = 40;
    const x = c.getContext('2d');
    x.translate(16, 30);
    const g = x.createLinearGradient(0, 0, 0, -26);
    g.addColorStop(0, tcol('c300')); g.addColorStop(1, tcol('c50'));
    x.fillStyle = g;
    x.beginPath();
    x.moveTo(0, 0);
    x.bezierCurveTo(-11, -6, -9, -22, 0, -27);
    x.bezierCurveTo(9, -22, 11, -6, 0, 0);
    x.fill();
    x.strokeStyle = 'rgba(255,255,255,0.5)'; x.lineWidth = 0.8; x.stroke();
    x.fillStyle = tcol('c600');                         // calyx
    x.beginPath(); x.ellipse(0, -1, 5.5, 3.2, 0, 0, Math.PI * 2); x.fill();
    return c;
}

function makePetalSprite() {
    const c = document.createElement('canvas');
    c.width = 28; c.height = 36;
    const x = c.getContext('2d');
    x.translate(14, 32);
    const g = x.createLinearGradient(0, 0, 0, -28);
    g.addColorStop(0, tcol('c300')); g.addColorStop(1, tcol('c50'));
    x.fillStyle = g;
    x.beginPath();
    x.moveTo(0, 0);
    x.bezierCurveTo(-13, -7, -14, -23, -5, -28);
    x.quadraticCurveTo(0, -24, 5, -28);
    x.bezierCurveTo(14, -23, 13, -7, 0, 0);
    x.fill();
    return c;
}

// ---- a branch: a curved, tapering limb with blossoms, buds and leaves attached by position along its curve ----
class SBranch {
    constructor(spec, rng, depth) {
        this.rel = spec.rel;            // angle relative to the parent (roots: absolute)
        this.at = spec.at == null ? 1 : spec.at;   // where on the parent it grows from (0..1)
        this.len = spec.len;
        this.w = spec.w * 1.3;
        this.wEnd = this.w * 0.58;
        this.bend = spec.bend == null ? 0.08 : spec.bend;
        this.depth = depth;
        this.phase = rng() * 6.283;
        this.speed = 0.7 + rng() * 0.45;
        this.amp = 0.016 + depth * 0.011;
        this.kids = (spec.kids || []).map(k => new SBranch(k, rng, depth + 1));
        this.blossoms = [];
        this.leaves = [];
        const nb = spec.bl || 0;
        for (let i = 0; i < nb; i++) {
            this.blossoms.push({
                t: 0.3 + 0.7 * (i + rng() * 0.7) / Math.max(nb, 1) * (nb > 1 ? 1 : 0.9),
                n: (rng() - 0.5) * 12,
                size: 26 + rng() * 14,
                rot: rng() * 6.283,
                v: rng() < 0.78 ? 0 : (rng() < 0.6 ? 1 : 2),
                ph: rng() * 6.283,
                wx: 0, wy: 0
            });
        }
        if (spec.bud) this.bud = { n: 0, ph: rng() * 6.283 };
        const nl = spec.leaf == null ? (this.w <= 5 ? 2 : 0) : spec.leaf;
        for (let i = 0; i < nl; i++) {
            this.leaves.push({ t: 0.25 + rng() * 0.6, side: rng() < 0.5 ? -1 : 1, len: 9 + rng() * 6, ph: rng() * 6.283 });
        }
    }

    bez(t) {
        const u = 1 - t;
        return [
            u * u * this.sx + 2 * u * t * this.cx + t * t * this.ex,
            u * u * this.sy + 2 * u * t * this.cy + t * t * this.ey,
            2 * u * (this.cx - this.sx) + 2 * t * (this.ex - this.cx),
            2 * u * (this.cy - this.sy) + 2 * t * (this.ey - this.cy)
        ];
    }

    layout(time, sx, sy, rest, windAcc) {
        const wind = Math.sin(time * this.speed + this.phase) * this.amp + Math.sin(time * 0.37 + this.phase * 0.5) * this.amp * 0.6;
        const a = rest + windAcc + wind;
        this.sx = sx; this.sy = sy;
        const L = this.len;
        this.ex = sx + Math.cos(a) * L;
        this.ey = sy + Math.sin(a) * L;
        this.cx = (sx + this.ex) / 2 - Math.sin(a) * this.bend * L;
        this.cy = (sy + this.ey) / 2 + Math.cos(a) * this.bend * L;
        for (const k of this.kids) {
            const p = this.bez(k.at);
            k.layout(time, p[0], p[1], rest + k.rel, windAcc + wind);
        }
    }

    drawWood(ctx) {
        const N = 14, up = [], dn = [];
        for (let i = 0; i <= N; i++) {
            const t = i / N, p = this.bez(t), l = Math.hypot(p[2], p[3]) || 1;
            const nx = -p[3] / l, ny = p[2] / l, w = (this.w * (1 - t) + this.wEnd * t) / 2;
            up.push([p[0] + nx * w, p[1] + ny * w]);
            dn.push([p[0] - nx * w, p[1] - ny * w]);
        }
        ctx.beginPath();
        ctx.moveTo(up[0][0], up[0][1]);
        for (let i = 1; i <= N; i++) ctx.lineTo(up[i][0], up[i][1]);
        for (let i = N; i >= 0; i--) ctx.lineTo(dn[i][0], dn[i][1]);
        ctx.closePath();
        ctx.fillStyle = this.depth === 0 ? tmix('c600', [30, 40, 40], 0.6) : tmix('c600', [40, 50, 50], 0.55);
        ctx.fill();
        ctx.beginPath();                                       // soft rim light on one side of the bark
        ctx.moveTo(up[0][0], up[0][1]);
        for (let i = 1; i <= N; i++) ctx.lineTo(up[i][0], up[i][1]);
        ctx.strokeStyle = tcol('c300', 0.42);
        ctx.lineWidth = 1;
        ctx.stroke();
        for (const k of this.kids) {
            ctx.beginPath();                                   // blend the joint
            ctx.arc(k.sx, k.sy, k.w / 2, 0, Math.PI * 2);
            ctx.fillStyle = tmix('c600', [40, 50, 50], 0.55);
            ctx.fill();
            k.drawWood(ctx);
        }
    }

    drawLeaves(ctx, time) {
        for (const lf of this.leaves) {
            const p = this.bez(lf.t), a = Math.atan2(p[3], p[2]) + lf.side * (0.9 + Math.sin(time * 1.2 + lf.ph) * 0.08);
            ctx.save();
            ctx.translate(p[0], p[1]);
            ctx.rotate(a);
            const L = lf.len;
            const g = ctx.createLinearGradient(0, 0, L, 0);
            g.addColorStop(0, tmix('c600', [0, 0, 0], 0.35)); g.addColorStop(1, tcol('c400'));
            ctx.fillStyle = g;
            ctx.beginPath();
            ctx.moveTo(0, 0);
            ctx.quadraticCurveTo(L * 0.5, -L * 0.42, L, 0);
            ctx.quadraticCurveTo(L * 0.5, L * 0.42, 0, 0);
            ctx.fill();
            ctx.restore();
        }
        for (const k of this.kids) k.drawLeaves(ctx, time);
    }

    drawFlowers(ctx, time) {
        for (const b of this.blossoms) {
            const p = this.bez(b.t), l = Math.hypot(p[2], p[3]) || 1;
            b.wx = p[0] - (p[3] / l) * b.n;
            b.wy = p[1] + (p[2] / l) * b.n;
            const s = b.size * (1 + Math.sin(time * 1.3 + b.ph) * 0.035);
            ctx.save();
            ctx.translate(b.wx, b.wy);
            ctx.rotate(b.rot + Math.sin(time * 0.8 + b.ph) * 0.12);
            ctx.drawImage(sSprites.blossom[b.v], -s / 2, -s / 2, s, s);
            ctx.restore();
        }
        if (this.bud) {
            const p = this.bez(1), a = Math.atan2(p[3], p[2]);
            ctx.save();
            ctx.translate(p[0], p[1]);
            ctx.rotate(a + Math.PI / 2 + Math.sin(time + this.bud.ph) * 0.1);
            ctx.drawImage(sSprites.bud, -7, -17, 14, 17.5);
            ctx.restore();
        }
        for (const k of this.kids) k.drawFlowers(ctx, time);
    }

    collect(list) {
        for (const b of this.blossoms) list.push(b);
        for (const k of this.kids) k.collect(list);
    }
}

class SPetal {
    constructor(x, y, rng) { this.reset(x, y, rng); }
    reset(x, y, rng) {
        this.x = x; this.y = y;
        this.s = 11 + rng() * 8;
        this.vy = 0.28 + rng() * 0.32;
        this.ph = rng() * 6.283;
        this.rot = rng() * 6.283;
        this.vr = (rng() - 0.5) * 0.045;
        this.life = 0;
        this.max = 380 + rng() * 240;
    }
    update(time) {
        this.life++;
        this.x += Math.sin(time * 0.9 + this.ph) * 0.38 - 0.16;      // drifts gently, slightly to the left
        this.y += this.vy;
        this.rot += this.vr;
    }
    get alive() { return this.life < this.max && this.y < sHeight + 24 && this.x > -24 && this.x < sWidth + 24; }
    draw(ctx, time) {
        const fadeIn = Math.min(1, this.life / 35), fadeOut = Math.min(1, (this.max - this.life) / 70);
        ctx.save();
        ctx.globalAlpha = Math.max(0, Math.min(fadeIn, fadeOut)) * 0.85;
        ctx.translate(this.x, this.y);
        ctx.rotate(this.rot);
        ctx.scale(0.45 + Math.abs(Math.cos(time * 1.6 + this.ph)) * 0.55, 1);     // petal "flips" as it falls
        ctx.drawImage(sSprites.petal, -this.s * 0.4, -this.s * 0.9, this.s * 0.8, this.s);
        ctx.restore();
    }
}

function initSidebarScene() {
    if (!sidebarCanvas || !sWidth || !sHeight) return;
    if (!sSprites) sSprites = { blossom: [makeBlossomSprite(0), makeBlossomSprite(1), makeBlossomSprite(2)], bud: makeBudSprite(), petal: makePetalSprite() };
    const W = sWidth, H = sHeight, rng = mulberry32(20261103);
    // angle 0 = right, PI = left.  SMALLER than PI = pointing down-left, LARGER than PI = pointing up-left.
    const specs = [
        // 1) main branch from the top-right corner, drooping over the menu
        { x: W + 18, y: H * 0.05, rel: Math.PI - 0.10, len: W * 0.52, w: 11, bend: -0.10, bl: 2, leaf: 0, kids: [
            { at: 1, rel: -0.34, len: W * 0.40, w: 7, bend: 0.10, bl: 3, kids: [
                { at: 1,   rel: -0.42, len: W * 0.27, w: 4,   bl: 5, bud: true },
                { at: 0.55, rel: 0.55, len: W * 0.24, w: 3.6, bl: 4, bud: true } ] },
            { at: 0.45, rel: -0.78, len: W * 0.34, w: 5.5, bend: -0.12, bl: 4, kids: [
                { at: 1, rel: 0.45, len: W * 0.2, w: 3.4, bl: 4, bud: true } ] },
            { at: 0.72, rel: 0.62, len: W * 0.24, w: 4.4, bl: 4, bud: true }
        ] },
        // 2) lower branch from the right edge
        { x: W + 18, y: H * 0.27, rel: Math.PI + 0.22, len: W * 0.42, w: 8, bend: 0.1, bl: 2, leaf: 0, kids: [
            { at: 1,   rel: -0.52, len: W * 0.30, w: 4.6, bl: 5, bud: true },
            { at: 0.5, rel: 0.62,  len: W * 0.23, w: 3.8, bl: 4, bud: true }
        ] },
        // 3) bottom-left branch growing up toward the footer
        { x: -18, y: H * 0.965, rel: -0.50, len: W * 0.50, w: 10, bend: -0.08, bl: 2, leaf: 0, kids: [
            { at: 1,    rel: -0.36, len: W * 0.40, w: 6.4, bl: 3, kids: [
                { at: 1,   rel: -0.42, len: W * 0.25, w: 3.8, bl: 5, bud: true },
                { at: 0.55, rel: 0.7,  len: W * 0.22, w: 3.6, bl: 4, bud: true } ] },
            { at: 0.5,  rel: -0.95, len: W * 0.28, w: 4.8, bl: 4, bud: true }
        ] },
        // 4) small branch, bottom-right
        { x: W + 18, y: H * 0.89, rel: Math.PI + 0.42, len: W * 0.30, w: 5.5, bend: 0.1, bl: 4, bud: true, kids: [
            { at: 0.6, rel: -0.6, len: W * 0.16, w: 3.2, bl: 3, bud: true } ] }
    ];
    sRoots = specs.map(s => { const b = new SBranch(s, rng, 0); b.rootX = s.x; b.rootY = s.y; b.rootA = s.rel; return b; });
    sBlossoms = [];
    sRoots.forEach(r => r.collect(sBlossoms));

    sPetals = [];
    for (let i = 0; i < 12; i++) sPetals.push(new SPetal(rng() * W, rng() * H, rng));

    sStars = [];
    for (let i = 0; i < 22; i++) sStars.push({ x: rng() * W, y: H * (0.18 + rng() * 0.8), r: 0.6 + rng() * 1.2, ph: rng() * 6.283, sp: 0.8 + rng() * 1.6 });
}

if (sidebarCanvas && sCtx) {
    resizeSidebarCanvas();
    const sidebarEl = document.getElementById('rightSidebar');
    const sRand = mulberry32(777);
    const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    function animateSidebar() {
        // Don't burn CPU/battery while the sidebar is closed or the tab is hidden
        if (document.hidden || !sRoots.length || (sidebarEl && sidebarEl.classList.contains('translate-x-full'))) {
            requestAnimationFrame(animateSidebar);
            return;
        }
        const time = reduceMotion ? 0 : Date.now() * 0.001;
        const ctx = sCtx, W = sWidth, H = sHeight;
        ctx.clearRect(0, 0, W, H);

        // night sky + soft glows
        const bg = ctx.createLinearGradient(0, 0, 0, H);
        bg.addColorStop(0, tmix('bgb', [0, 0, 0], 0.15)); bg.addColorStop(0.55, tcol('bgs')); bg.addColorStop(1, tcol('bgc'));
        ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
        let g = ctx.createRadialGradient(W * 0.22, H * 0.16, 0, W * 0.22, H * 0.16, W * 0.85);
        g.addColorStop(0, tcol('c300', 0.17)); g.addColorStop(1, tcol('c300', 0));
        ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
        g = ctx.createRadialGradient(W, H * 0.86, 0, W, H * 0.86, W * 0.9);
        g.addColorStop(0, 'rgba(150,120,240,0.14)'); g.addColorStop(1, 'rgba(150,120,240,0)');
        ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
        for (const s of sStars) {
            ctx.globalAlpha = 0.25 + 0.55 * (0.5 + 0.5 * Math.sin(time * s.sp + s.ph));
            ctx.fillStyle = tcol('c50');
            ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2); ctx.fill();
        }
        ctx.globalAlpha = 1;

        // branches -> leaves -> blossoms (everything computed from the same pose, so it always lines up)
        for (const r of sRoots) r.layout(time, r.rootX, r.rootY, r.rootA, 0);
        for (const r of sRoots) r.drawWood(ctx);
        for (const r of sRoots) r.drawLeaves(ctx, time);
        for (const r of sRoots) r.drawFlowers(ctx, time);

        // petals fall from real blossoms
        if (!reduceMotion) {
            if (--sPetalTimer <= 0 && sPetals.length < 34 && sBlossoms.length) {
                const b = sBlossoms[Math.floor(sRand() * sBlossoms.length)];
                sPetals.push(new SPetal(b.wx, b.wy, sRand));
                sPetalTimer = 22 + Math.floor(sRand() * 30);
            }
            for (const p of sPetals) p.update(time);
            sPetals = sPetals.filter(p => p.alive);
        }
        for (const p of sPetals) p.draw(ctx, time);

        requestAnimationFrame(animateSidebar);
    }
    animateSidebar();
}

function initSakuraPetals() {
    const canvas = document.getElementById('sakuraCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    
    function resizeCanvas() {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
    }
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);
    
    const petals = Array.from({ length: 22 }, () => ({
        x: Math.random() * window.innerWidth,
        y: Math.random() * window.innerHeight,
        size: Math.random() * 3.5 + 2.5,
        speedY: Math.random() * 0.7 + 0.3,
        speedX: Math.random() * 0.4 - 0.2,
        rotation: Math.random() * 360,
        rotationSpeed: Math.random() * 1.2 - 0.6,
        opacity: Math.random() * 0.5 + 0.2
    }));
    
    function animate() {
        if (perfLow()) {                       // Battery Saver / Low-end Mode: no falling petals, check again only twice a second
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            setTimeout(animate, 500);
            return;
        }
        if (document.hidden || canvas.style.display === 'none') {
            requestAnimationFrame(animate);
            return;
        }
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        petals.forEach(p => {
            p.y += p.speedY;
            p.x += p.speedX;
            p.rotation += p.rotationSpeed;
            if (p.y > canvas.height) {
                p.y = -10;
                p.x = Math.random() * canvas.width;
            }
            ctx.save();
            ctx.translate(p.x, p.y);
            ctx.rotate((p.rotation * Math.PI) / 180);
            ctx.globalAlpha = p.opacity;
            ctx.fillStyle = tcol('c300');
            ctx.beginPath();
            ctx.ellipse(0, 0, p.size, p.size * 1.5, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
        });
        requestAnimationFrame(animate);
    }
    animate();
}

window.addEventListener('DOMContentLoaded', () => {
    const prefs = safeGet(PREFS_KEY, {});
    if (prefs.mode === 'scroll' || prefs.mode === 'page') currentReadingMode = prefs.mode;
    if (['low', 'medium', 'high'].includes(prefs.quality)) currentImageQuality = prefs.quality;
    else if (userSettings.lite) currentImageQuality = 'low';     // Low-end Mode: lighter chapter images until the reader picks a quality
    syncReaderPrefsUI();
    setupSearch();
    renderLatestHero();
    initSakuraPetals();
    listenToFirebaseData();
    listenToLayoutControl();
    restoreViewFromHash();
    document.documentElement.classList.remove('boot-deep');   // router has chosen the page: Home may show again if it is the target

    window.addEventListener('storage', (e) => {
        if (e.key === SHARED_STORAGE_KEY) {
            refreshCurrentView();
        }
    });
});


// ============================================================================
//  HOME QUICK DOCK  (corner button -> long bar with Bookmark / History / Setting)
// ============================================================================
function isDockOpen() {
    const d = document.getElementById('homeDock');
    return !!d && d.dataset.open === 'true';
}
function setDock(open) {
    const d = document.getElementById('homeDock');
    const fab = document.getElementById('dockFab');
    if (!d) return;
    d.dataset.open = open ? 'true' : 'false';
    if (fab) fab.setAttribute('aria-expanded', open ? 'true' : 'false');
}
window.toggleDock = function() { setDock(!isDockOpen()); };

// the dock only lives on the Home page
function updateHomeDock(targetId) {
    const d = document.getElementById('homeDock');
    if (!d) return;
    const onHome = targetId === 'homeView';
    d.classList.toggle('is-visible', onHome);
    d.setAttribute('aria-hidden', onHome ? 'false' : 'true');
    setDock(false);
    closeLibrarySheet();
}

let libMode = '';
function libRender() {
    const list = document.getElementById('libList');
    if (!list) return;
    const all = loadAllMangas().filter(m => userSettings.adult || !isAdultManga(m));
    list.innerHTML = '';

    const empty = (icon, text) => {
        list.innerHTML = '<div class="lib-empty"><i class="' + icon + '"></i><p>' + text + '</p></div>';
    };

    const ids = safeGet(BOOKMARK_KEY, []);
    const items = (Array.isArray(ids) ? ids : []).map(id => all.find(m => m.id === id)).filter(Boolean).reverse();
    if (!items.length) return empty('fa-regular fa-bookmark', 'No bookmarks yet');
    items.forEach(m => list.appendChild(libItem(m, m.latestChapterTitle || (m.genre || ''), 'bookmark', () => {
        closeLibrarySheet(); window.navigateToView('detail', m.id, m.title);
    })));
}

function libItem(m, sub, kind, onOpen) {
    const el = document.createElement('div');
    el.className = 'lib-item';
    el.setAttribute('role', 'button');
    el.tabIndex = 0;
    el.innerHTML =
        '<span class="lib-thumb" style=\'background-image:' + esc(cssUrl(m.image)) + '\'></span>' +
        '<span class="lib-meta"><span class="lib-name">' + esc(m.title) + '</span><span class="lib-sub">' + esc(sub) + '</span></span>' +
        (kind === 'bookmark' ? '<button type="button" class="lib-remove" aria-label="Remove bookmark"><i class="fa-solid fa-xmark"></i></button>' : '');
    el.addEventListener('click', (e) => {
        if (e.target.closest('.lib-remove')) {
            e.stopPropagation();
            const ids = safeGet(BOOKMARK_KEY, []).filter(id => id !== m.id);
            safeSet(BOOKMARK_KEY, ids);
            libRender();
            return;
        }
        onOpen();
    });
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); onOpen(); } });
    return el;
}

// History button -> its own page (same slide transition as the other pages). Empty for now.
window.openHistoryPage = function() {
    setDock(false);
    window.navigateToView('history', '', 'History');
};

window.openLibrarySheet = function(mode) {
    libMode = mode;
    setDock(false);
    document.getElementById('libTitleText').textContent = mode === 'bookmark' ? 'Bookmark' : 'History';
    document.getElementById('libIcon').className = mode === 'bookmark' ? 'fa-solid fa-bookmark' : 'fa-solid fa-clock-rotate-left';
    libRender();
    document.getElementById('libBackdrop').classList.add('show');
    const sheet = document.getElementById('libSheet');
    sheet.classList.add('show');
    sheet.setAttribute('aria-hidden', 'false');
};
window.closeLibrarySheet = function() {
    const sheet = document.getElementById('libSheet');
    if (!sheet) return;
    sheet.classList.remove('show');
    sheet.setAttribute('aria-hidden', 'true');
    document.getElementById('libBackdrop')?.classList.remove('show');
};
// tap anywhere outside the dock closes it; Esc closes dock + sheet
document.addEventListener('click', (e) => {
    if (isDockOpen() && !e.target.closest('#homeDock')) setDock(false);
});
document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (isDockOpen()) setDock(false);
    closeLibrarySheet();
});


// ============================================================================
//  HISTORY PAGE: "Latest Reading" card
// ============================================================================
const LAST_READ_KEY = "sakura_last_read_v1";

function recordLastRead(key) {
    if (!key || key.indexOf('___') < 0) return;
    const [m, c] = key.split('___');
    safeSet(LAST_READ_KEY, { m, c, t: Date.now() });
}

// a few embers drifting up behind Makima
function buildHistoryEmbers() {
    const box = document.getElementById('hxEmbers');
    if (!box || box.childNodes.length) return;
    for (let i = 0; i < 12; i++) {
        const e = document.createElement('i');
        e.style.left = (8 + Math.random() * 84) + '%';
        e.style.setProperty('--sz', (2 + Math.random() * 3).toFixed(1) + 'px');
        e.style.setProperty('--dx', ((Math.random() - 0.5) * 36).toFixed(0) + 'px');
        e.style.animationDuration = (5 + Math.random() * 5).toFixed(1) + 's';
        e.style.animationDelay = (-Math.random() * 9).toFixed(1) + 's';
        box.appendChild(e);
    }
}

function renderHistoryPage() {
    const card = document.getElementById('hxCard');
    if (!card) return;
    buildHistoryEmbers();
    dmRender();
    const last = safeGet(LAST_READ_KEY, null);
    const manga = last && loadAllMangas().find(x => x.id === last.m);
    const thumb = document.getElementById('hxThumb');
    const chap = document.getElementById('hxChap');
    if (!manga) {
        card.classList.add('is-empty');
        card.onclick = null; card.onkeydown = null;
        document.getElementById('hxName').textContent = 'Nothing read yet';
        thumb.style.backgroundImage = '';
        if (chap) chap.hidden = true;
        return;
    }
    card.classList.remove('is-empty');
    document.getElementById('hxName').textContent = manga.title;
    thumb.style.backgroundImage = cssUrl(manga.image);

    // how far has this manga been read: the highest chapter that was opened (falls back to the last opened one)
    const opened = safeGet(OPENED_KEY, {}) || {};
    const prog = getReadProgress();
    const chs = manga.chapters || [];
    let best = null;
    chs.forEach((c) => {
        const k = manga.id + '___' + c.id;
        if (!opened[k] && !(prog[k] > 0) && c.id !== last.c) return;
        if (!best || (Number.isFinite(c.num) && (!Number.isFinite(best.num) || c.num > best.num))) best = c;
    });
    if (chap) {
        if (best) { document.getElementById('hxChapText').textContent = 'Read up to ' + best.title; chap.hidden = false; }
        else chap.hidden = true;
    }
    card.onclick = () => window.navigateToView('detail', manga.id, manga.title);   // the manga's Chapter Lobby
    card.onkeydown = (e) => { if (e.key === 'Enter') card.click(); };
}

// ============================================================================
//  TOAST (small notification pill, top of the screen)
// ============================================================================
function showToast(text, kind) {
    const host = document.getElementById('toastHost');
    if (!host) return;
    const t = document.createElement('div');
    t.className = 'toast ' + (kind || 'ok');
    const ico = kind === 'err' ? 'fa-triangle-exclamation' : (kind === 'busy' ? 'fa-arrow-down' : 'fa-check');
    t.innerHTML = '<span class="toast-ico"><i class="fa-solid ' + ico + '"></i></span><span class="toast-text"></span>';
    t.querySelector('.toast-text').textContent = text;
    host.appendChild(t);
    requestAnimationFrame(() => requestAnimationFrame(() => t.classList.add('in')));      // rises up from the bottom
    setTimeout(() => { t.classList.remove('in'); setTimeout(() => t.remove(), 450); }, kind === 'busy' ? 2000 : 2800);
    while (host.children.length > 3) host.firstChild.remove();
}

// ============================================================================
//  DOWNLOAD MANAGER
//  Download button (chapter list) -> fetches every page -> saves it inside the app only (no .zip in the phone's storage).
//  The History page lists each download: Downloading... (live progress) / Downloaded / Failed.
// ============================================================================
const DL_KEY = "sakura_downloads_v1";
const dlRuntime = new Map();            // id -> { ctrl } for downloads that are running right now

function dlLoad() {
    const l = safeGet(DL_KEY, []);
    return Array.isArray(l) ? l : [];
}
function dlSave(list) { safeSet(DL_KEY, list.slice(0, 60)); }
// anything still "downloading" from a previous visit can no longer be running
(function dlFixStale() {
    const l = dlLoad();
    let ch = false;
    l.forEach(e => { if (e.status === 'downloading') { e.status = 'error'; e.err = 'Interrupted'; ch = true; } });
    if (ch) dlSave(l);
})();


// ---- Offline store (IndexedDB): the downloaded page images are kept here so they can be read with no network ----
const OFF_DB = 'sakura_offline_v1', OFF_STORE = 'chapters';
let offDbP = null;
function offDb() {
    if (!offDbP) offDbP = new Promise((res, rej) => {
        if (!('indexedDB' in window)) return rej(new Error('No IndexedDB'));
        const rq = indexedDB.open(OFF_DB, 1);
        rq.onupgradeneeded = () => rq.result.createObjectStore(OFF_STORE, { keyPath: 'id' });
        rq.onsuccess = () => res(rq.result);
        rq.onerror = () => rej(rq.error);
    }).catch((e) => { offDbP = null; throw e; });
    return offDbP;
}
function offTx(mode, fn) {
    return offDb().then(db => new Promise((res, rej) => {
        const tx = db.transaction(OFF_STORE, mode);
        const rq = fn(tx.objectStore(OFF_STORE));
        tx.oncomplete = () => res(rq ? rq.result : undefined);
        tx.onerror = tx.onabort = () => rej(tx.error || new Error('IDB failed'));
    }));
}
const offPut = (rec) => offTx('readwrite', s => s.put(rec));
const offGet = (id) => offTx('readonly', s => s.get(id));
const offDel = (id) => offTx('readwrite', s => s.delete(id)).catch(() => {});
const offHas = (id) => offTx('readonly', s => s.count(id)).then(n => n > 0).catch(() => false);

// A chapter counts as "offline" only when its history entry says done AND the images were stored
function dlIsOffline(id) { const e = dlEntry(id); return !!(e && e.status === 'done' && e.off); }

function dlEntry(id) { return dlLoad().find(e => e.id === id); }
function dlSetEntry(e) {
    const l = dlLoad().filter(x => x.id !== e.id);
    l.unshift(e);
    dlSave(l);
}
function dlFmtSize(b) {
    if (b >= 1048576) return (b / 1048576).toFixed(1) + ' MB';
    return Math.max(1, Math.round(b / 1024)) + ' KB';
}

// state of the little download button in the chapter list
function dlApplyBtn(btn) {
    if (!btn) return;
    const e = dlEntry(btn.dataset.key);
    const st = e ? e.status : '';
    btn.classList.toggle('is-busy', st === 'downloading');
    btn.classList.toggle('is-done', st === 'done');
    btn.disabled = st === 'downloading';
    btn.innerHTML = st === 'downloading'
        ? '<span class="dl-anim" aria-hidden="true"><i class="fa-solid fa-arrow-down"></i></span>'      // arrow keeps sliding down into the tray
        : '<i class="fa-solid ' + (st === 'done' ? 'fa-check' : 'fa-download') + '"></i>';
    btn.title = st === 'downloading' ? 'Downloading...' : (st === 'done' ? 'Downloaded - remove it in History to download again' : 'Download');
}
function dlRefreshButtons() {
    document.querySelectorAll('.ch-dl[data-key]').forEach(dlApplyBtn);
}

// ---- minimal ZIP writer (store only: page images are already compressed) ----
const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
    return t;
})();
function crc32(u8) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < u8.length; i++) c = CRC_TABLE[(c ^ u8[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
}
function buildZip(files) {
    const enc = new TextEncoder();
    const parts = [], central = [];
    let offset = 0;
    const now = new Date();
    const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
    const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
    files.forEach((f) => {
        const name = enc.encode(f.name), crc = crc32(f.data), size = f.data.length;
        const lh = new DataView(new ArrayBuffer(30));
        lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(8, 0, true);
        lh.setUint16(10, dosTime, true); lh.setUint16(12, dosDate, true); lh.setUint32(14, crc, true);
        lh.setUint32(18, size, true); lh.setUint32(22, size, true); lh.setUint16(26, name.length, true); lh.setUint16(28, 0, true);
        parts.push(lh.buffer, name, f.data);
        const ch = new DataView(new ArrayBuffer(46));
        ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true); ch.setUint16(10, 0, true);
        ch.setUint16(12, dosTime, true); ch.setUint16(14, dosDate, true); ch.setUint32(16, crc, true);
        ch.setUint32(20, size, true); ch.setUint32(24, size, true); ch.setUint16(28, name.length, true);
        ch.setUint32(42, offset, true);
        central.push(ch.buffer, name);
        offset += 30 + name.length + size;
    });
    let cdSize = 0;
    central.forEach(b => { cdSize += b.byteLength !== undefined ? b.byteLength : b.length; });
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
    end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
    return new Blob([...parts, ...central, end.buffer], { type: 'application/zip' });
}

function dlSafeName(s) { return String(s || 'chapter').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'chapter'; }
function dlExt(type, url) {
    if (/png/.test(type)) return 'png';
    if (/webp/.test(type)) return 'webp';
    if (/gif/.test(type)) return 'gif';
    if (/jpe?g/.test(type)) return 'jpg';
    const m = String(url).match(/\.(png|jpe?g|webp|gif)(?:[?#]|$)/i);
    return m ? m[1].toLowerCase().replace('jpeg', 'jpg') : 'jpg';
}

async function startDownload(mangaId, chapterId, opts = {}) {
    const id = mangaId + '___' + chapterId;
    if (dlRuntime.has(id)) return;
    const manga = loadAllMangas().find(m => m.id === mangaId);
    const ch = manga && (manga.chapters || []).find(c => c.id === chapterId);
    if (!manga || !ch) return;
    if (!(await coinGate(mangaId, chapterId))) return;
    const urls = (ch.pages || []).map(p => p && p.data).filter(Boolean);
    if (!urls.length) { showToast('No pages to download in ' + ch.title, 'err'); return; }

    // already downloaded (and still stored on this device) -> never download it again; only deleting it in History re-enables it
    const old = dlEntry(id);
    if (old && old.status === 'done' && old.off && await offHas(id)) {
        showToast('Chapter already downloaded', 'ok');
        dlRefreshButtons();
        return;
    }

    const entry = { id, m: mangaId, c: chapterId, mt: manga.title, ct: ch.title, img: manga.image || '', status: 'downloading', done: 0, total: urls.length, size: 0, t: Date.now() };
    dlSetEntry(entry);
    const ctrl = new AbortController();
    dlRuntime.set(id, { ctrl });
    dlRefreshButtons(); dmRender();
    showToast('Downloading...', 'busy');

    try {
        const files = new Array(urls.length);
        const blobs = new Array(urls.length);
        let next = 0, size = 0;
        const worker = async () => {
            while (next < urls.length) {
                const i = next++;
                const res = await fetch(urls[i], { signal: ctrl.signal });
                if (!res.ok) throw new Error('HTTP ' + res.status);
                const blob = await res.blob();
                const buf = new Uint8Array(await blob.arrayBuffer());
                size += buf.length;
                files[i] = { name: String(i + 1).padStart(3, '0') + '.' + dlExt(blob.type, urls[i]), data: buf };
                blobs[i] = blob;                   // the same bytes are reused for offline reading: no second download
                entry.done++; entry.size = size;
                dmUpdateProgress(entry);           // live bar, no storage write per page
            }
        };
        await Promise.all([worker(), worker(), worker()]);

        // The chapter is kept ONLY inside the app's private storage (IndexedDB), never as a .zip / image files
        // in the phone's Downloads folder, so it cannot be picked up with a file manager and re-uploaded.
        try {
            await offPut({ id, m: mangaId, c: chapterId, n: blobs.length, blobs, t: Date.now() });
            entry.off = true;
        } catch (e) { throw new Error('Could not save offline (storage full or private mode)'); }

        entry.status = 'done'; entry.size = size; entry.t = Date.now();
        dlSetEntry(entry);
        showToast('Downloading Done', 'ok');
    } catch (err) {
        if (ctrl.signal.aborted) { dlSave(dlLoad().filter(e => e.id !== id)); }
        else {
            entry.status = 'error'; entry.err = (err && err.message) || 'Failed'; entry.t = Date.now();
            dlSetEntry(entry);
            showToast('Download failed: ' + ch.title, 'err');
        }
    }
    dlRuntime.delete(id);
    dlRefreshButtons(); dmRender();
}

function dlCancelOrRemove(id) {
    const rt = dlRuntime.get(id);
    if (rt) { rt.ctrl.abort(); return; }
    dlSave(dlLoad().filter(e => e.id !== id));
    offDel(id);                                   // deleting from History = the only way to download it again
    dlRefreshButtons();
    dmRender();
}

// ---- Download Management list (History page) ----
function dmUpdateProgress(e) {
    const row = document.querySelector('.dm-item[data-id="' + CSS.escape(String(e.id)) + '"]');
    if (!row) return;
    const pct = e.total ? Math.round(e.done / e.total * 100) : 0;
    const bar = row.querySelector('.dm-bar > i'), cnt = row.querySelector('.dm-count');
    if (bar) bar.style.width = pct + '%';
    if (cnt) cnt.textContent = e.done + ' / ' + e.total;
}

function dmRender() {
    const list = document.getElementById('dmList');
    if (!list) return;
    const items = dlLoad();
    list.innerHTML = '';
    if (!items.length) {
        list.innerHTML = '<div class="dm-empty"><i class="fa-solid fa-cloud-arrow-down"></i><span>No downloads yet</span></div>';
        return;
    }
    items.forEach((e) => {
        const pct = e.total ? Math.round(e.done / e.total * 100) : 0;
        const el = document.createElement('div');
        el.className = 'dm-item ' + e.status;
        el.dataset.id = e.id;
        let status = '';
        if (e.status === 'downloading') {
            status = '<span class="dm-status"><span class="dm-dl">Downloading<b>.</b><b>.</b><b>.</b></span><span class="dm-count">' + e.done + ' / ' + e.total + '</span></span>' +
                     '<span class="dm-bar"><i style="width:' + pct + '%"></i></span>';
        } else if (e.status === 'done') {
            status = '<span class="dm-status"><span class="dm-ok"><i class="fa-solid fa-circle-check"></i> Downloaded</span><span class="dm-count">' + dlFmtSize(e.size || 0) + ' \u00b7 ' + timeAgo(e.t) + '</span></span>';
        } else {
            status = '<span class="dm-status"><span class="dm-bad"><i class="fa-solid fa-circle-exclamation"></i> Failed</span><button type="button" class="dm-retry">Retry</button></span>';
        }
        el.innerHTML =
            '<span class="dm-thumb" style=\'background-image:' + esc(cssUrl(e.img)) + '\'></span>' +
            '<span class="dm-meta"><span class="dm-name">' + esc(e.mt) + '</span><span class="dm-chap">' + esc(e.ct) + '</span>' + status + '</span>' +
            '<button type="button" class="dm-x" aria-label="' + (e.status === 'downloading' ? 'Cancel' : 'Remove') + '"><i class="fa-solid fa-xmark"></i></button>';
        el.querySelector('.dm-x').onclick = (ev) => { ev.stopPropagation(); dlCancelOrRemove(e.id); };
        if (e.status === 'done') {
            el.classList.add('readable');
            el.onclick = () => {
                const m = loadAllMangas().find(x => x.id === e.m);
                if (!m || !(m.chapters || []).some(c => c.id === e.c)) { showToast('Chapter data not available yet', 'err'); return; }
                navigateToReaderView(e.m, e.c, e.ct);   // reader picks the offline copy automatically
            };
        }
        const rt = el.querySelector('.dm-retry');
        if (rt) rt.onclick = (ev) => { ev.stopPropagation(); startDownload(e.m, e.c); };
        list.appendChild(el);
    });
}


// ---- Offline app shell: lets the site itself open with no internet (needs https or localhost) ----
if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
    window.addEventListener('load', () => { navigator.serviceWorker.register('sw.js').catch(() => {}); });
}


// ============================================================================
//  SETTINGS PAGE  -  Data Storage Manager
// ============================================================================
window.openSettingsPage = function() {
    setDock(false);
    window.navigateToView('settings', '', 'Setting');
};

function stFmt(b) {
    b = Math.max(0, b || 0);
    if (b >= 1073741824) return (b / 1073741824).toFixed(2) + ' GB';
    if (b >= 1048576) return (b / 1048576).toFixed(1) + ' MB';
    if (b >= 1024) return Math.round(b / 1024) + ' KB';
    return b + ' B';
}

// size of the saved app files (Cache Storage); opaque (cross-origin, no-cors) responses cannot be measured and count as 0
async function stCacheBytes() {
    if (!('caches' in window)) return 0;
    let total = 0;
    try {
        const names = await caches.keys();
        for (const n of names) {
            const c = await caches.open(n);
            const reqs = await c.keys();
            for (const rq of reqs) {
                const res = await c.match(rq);
                if (!res || res.type === 'opaque') continue;
                total += (await res.blob()).size;
            }
        }
    } catch (e) {}
    return total;
}

async function renderSettingsPage() {
    const $ = (id) => document.getElementById(id);
    // 1) downloaded chapters (from the download list)
    const done = dlLoad().filter(e => e.status === 'done' && e.off);
    const dl = done.reduce((s, e) => s + (e.size || 0), 0);
    $('stChap').textContent = done.length + (done.length === 1 ? ' chapter downloaded' : ' chapters downloaded');
    $('stChapSize').textContent = stFmt(dl);
    // 2) cache data
    const cache = await stCacheBytes();

    const total = dl + cache;
    const bar = $('stBar');
    const pct = (v) => (total > 0 && v > 0) ? Math.max(2, v / total * 100) : 0;
    const pd = pct(dl), pc = pct(cache);
    const scale = (pd + pc) > 100 ? 100 / (pd + pc) : 1;
    bar.querySelector('.seg-dl').style.width = (pd * scale) + '%';
    bar.querySelector('.seg-other').style.width = (pc * scale) + '%';
    $('stFree').textContent = stFmt(total);
    $('stFreeOf').textContent = 'used by this site';
    $('stDl').textContent = stFmt(dl);
    $('stOther').textContent = stFmt(cache);
    $('stNote').textContent = 'Downloaded chapters = pages saved for offline reading. Cache data = saved app files (fonts, libraries).';
}

// ---- confirm dialog ----
let stConfirmAction = null;
function stAsk(opts, action) {
    stConfirmAction = action;
    document.getElementById('stConfirmIcon').className = 'fa-solid ' + opts.icon;
    document.getElementById('stConfirmTitle').textContent = opts.title;
    document.getElementById('stConfirmText').textContent = opts.text;
    document.getElementById('stConfirmYes').textContent = opts.yes;
    document.getElementById('stBackdrop').classList.add('show');
    const c = document.getElementById('stConfirm');
    c.classList.add('show'); c.setAttribute('aria-hidden', 'false');
}
function stCloseConfirm() {
    stConfirmAction = null;
    document.getElementById('stBackdrop').classList.remove('show');
    const c = document.getElementById('stConfirm');
    c.classList.remove('show'); c.setAttribute('aria-hidden', 'true');
}

async function stClearCache() {
    try {
        if ('caches' in window) { const ks = await caches.keys(); await Promise.all(ks.map(k => caches.delete(k))); }
        showToast('Cache cleared', 'ok');
    } catch (e) { showToast('Could not clear cache', 'err'); }
    renderSettingsPage();
}

async function stClearAll() {
    try {
        dlRuntime.forEach(rt => { try { rt.ctrl.abort(); } catch (e) {} });          // stop running downloads
        revokeReaderBlobs();
        // saved lists / progress / preferences of this site
        Object.keys(localStorage).filter(k => k.indexOf('sakura_') === 0).forEach(k => localStorage.removeItem(k));
        // downloaded chapter images
        try { const db = await offDb(); db.close(); } catch (e) {}
        offDbP = null;
        await new Promise((res) => {
            try {
                const rq = indexedDB.deleteDatabase(OFF_DB);
                rq.onsuccess = rq.onerror = rq.onblocked = () => res();
            } catch (e) { res(); }
        });
        if ('caches' in window) { const ks = await caches.keys(); await Promise.all(ks.map(k => caches.delete(k))); }
        showToast('All data cleared', 'ok');
        setTimeout(() => { history.replaceState(null, '', location.pathname + location.search); location.reload(); }, 900);
    } catch (e) {
        showToast('Could not clear everything', 'err');
        renderSettingsPage();
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const on = (id, fn) => { const el = document.getElementById(id); if (el) el.addEventListener('click', fn); };
    on('stClearCache', () => stAsk({ icon: 'fa-broom', title: 'Clear Cache?', text: 'Saved app files (fonts, libraries) will be removed. Your downloads, bookmarks and history stay safe. The app needs internet once to work offline again.', yes: 'Clear Cache' }, stClearCache));
    on('stClearAll', () => stAsk({ icon: 'fa-trash-can', title: 'Clear All Data?', text: 'Downloaded chapters, bookmarks, reading history and settings on this device will be deleted. This cannot be undone.', yes: 'Clear All' }, stClearAll));
    on('stConfirmNo', stCloseConfirm);
    on('stBackdrop', stCloseConfirm);
    on('stConfirmYes', () => { const fn = stConfirmAction; stCloseConfirm(); if (fn) fn(); });
});


// ============================================================================
//  SETTING MANAGEMENT  (Settings page): Auto Download / Keep Screen On / Low-end Mode / Battery Saver
// ============================================================================
function saveUserSettings() { safeSet(USER_SET_KEY, userSettings); }

// ---- Keep Screen On: Screen Wake Lock while the Reader is open ----
async function syncWakeLock() {
    const want = userSettings.keepAwake && currentViewId === 'readerView' && !document.hidden;
    try {
        if (want && !wakeLock && navigator.wakeLock) {
            wakeLock = await navigator.wakeLock.request('screen');
            wakeLock.addEventListener('release', () => { wakeLock = null; });
        } else if (!want && wakeLock) {
            const w = wakeLock; wakeLock = null;
            await w.release();
        }
    } catch (e) { wakeLock = null; }
}
document.addEventListener('visibilitychange', syncWakeLock);

// ---- switches ----
// ---- premium 18+ confirm box (returns a Promise: true = confirmed, false = cancelled) ----
function adultConfirm() {
    return new Promise(resolve => {
        const box = document.getElementById('adultGate');
        if (!box) { resolve(window.confirm('Are you 18 years or older?')); return; }
        const okBtn = document.getElementById('adultGateOk');
        const noBtn = document.getElementById('adultGateCancel');
        let done = false;
        const finish = (v) => {
            if (done) return; done = true;
            box.classList.remove('show'); box.setAttribute('aria-hidden', 'true');
            document.removeEventListener('keydown', onKey);
            setTimeout(() => { box.hidden = true; }, 260);
            resolve(v);
        };
        const onKey = (e) => { if (e.key === 'Escape') finish(false); };
        okBtn.onclick = () => finish(true);
        noBtn.onclick = () => finish(false);
        box.querySelector('.adult-gate-bd').onclick = () => finish(false);
        document.addEventListener('keydown', onKey);
        box.hidden = false; box.setAttribute('aria-hidden', 'false');
        requestAnimationFrame(() => { box.classList.add('show'); noBtn.focus(); });
    });
}

function stSyncSwitches() {
    document.querySelectorAll('.st-switch[data-set]').forEach(b => {
        const on = !!userSettings[b.dataset.set];
        b.setAttribute('aria-checked', on ? 'true' : 'false');
        b.classList.toggle('on', on);
    });
}

async function stSetOption(name, value) {
    if (name === 'keepAwake' && value && !('wakeLock' in navigator)) {
        showToast('Keep Screen On is not supported in this browser', 'err'); return false;
    }
    if (name === 'adult' && value && !(await adultConfirm())) return false;
    userSettings[name] = value;
    saveUserSettings();
    if (name === 'adult') {
        selectedGenres = [];                   // genres of the other mode would hide everything
        applyAdultArt();
        latestHeroKey = '';
        refreshCurrentView();
        populateFilterGenres();
        if (typeof renderGenresView === 'function') renderGenresView();
        showToast(value ? 'Adult Content on - showing 18+ manga only' : 'Adult Content off', 'ok');
    }
    if (name === 'jelly') {
        document.documentElement.classList.toggle('jelly-off', !value);
        showToast(value ? 'Jelly Touch on' : 'Jelly Touch off', 'ok');
    }
    if (name === 'battery') {
        document.documentElement.classList.toggle('battery-saver', value);
        startLatestHeroTimer();                      // autoplay stops / resumes
    }
    if (name === 'lite') {
        document.documentElement.classList.toggle('lite', value);
        startLatestHeroTimer();
        if (value) showToast('Low-end Mode on - lighter animations', 'ok');
    }
    if (name === 'keepAwake') syncWakeLock();
    return true;
}

document.addEventListener('DOMContentLoaded', () => {
    stSyncSwitches();
    document.querySelectorAll('.st-switch[data-set]').forEach(b => {
        b.addEventListener('click', async () => {
            const name = b.dataset.set;
            const target = !userSettings[name];
            const ok = await stSetOption(name, target);
            if (!ok) { userSettings[name] = false; saveUserSettings(); }
            stSyncSwitches();
        });
    });
});


// ============================================================================
//  ABOUT & LEGAL  (Settings page): Terms / Privacy
// ============================================================================
const LEGAL_SITE = 'Sakura Realm';
const LEGAL_UPDATED = '5 November 2026';
// Put your real contact (email or page link) here.  Shown in every legal text.  Left empty = generic wording.
const LEGAL_CONTACT = '';
const legalContactLine = () => LEGAL_CONTACT
    ? 'Contact: ' + LEGAL_CONTACT
    : 'Contact: through the contact link of the page or community where you found ' + LEGAL_SITE + '.';

// each section: [heading, [ 'paragraph' | ['bullet', 'bullet'] , ... ]]
const LEGAL_DOCS = {
    terms: {
        icon: 'fa-file-contract', title: 'Terms of Service',
        intro: '',
        sections: [
            ['1. About & Service', ['Sakura Realm is a website for reading manga online and offline. While it is currently free to use, pricing or subscription systems may be introduced in the future. Your reading progress, history, and settings are stored locally on your own device.']],
            ['2. Usage Rules', ['You may use the website for your own personal, non-commercial reading. You must not download chapters and share, sell, or re-upload them anywhere else.']],
            ['3. Copyright & Takedown', ['All manga, covers, titles, characters, and artwork belong to their respective authors, artists, and publishers. Sakura Realm does not claim ownership of them. If requested by the respective copyright owners, the requested manga will be immediately removed from the website.']],
            ['4. Content & Age', ['Some titles may contain mature themes or content. You are responsible for deciding what is suitable for you. If you are under the age of majority, please use the site together with a parent or guardian.']],
            ['5. Changes to Site', ['Titles may be added or removed without notice, and the website may be changed, updated, or paused at any time.']],
            ['6. Limitation of Liability', ['The website is provided "as is" and "as available" without warranties of any kind. The site operator is not liable for any data loss, damages, or issues arising from your use of the website.']]
        ]
    },
    privacy: {
        icon: 'fa-user-shield', title: 'Privacy Policy',
        intro: '',
        sections: [
            ['1. Information We Collect', [
                '<b>Account information:</b> If account and paid membership features are introduced in the future, we will collect the email, password and membership period details needed to create an account.',
                '<b>Data stored on your device:</b> Your bookmarks, reading history, downloaded manga and settings are stored only on your own device (Local Storage and IndexedDB).']],
            ['2. How We Use Your Data', ['Your data is used only to verify your account login, manage your membership period and let you read manga on the website. We will never use your personal information for advertising, and we will never sell it to anyone else.']],
            ['3. Third-Party Services', ['To keep the website and manga images working normally, we connect to Google Firebase, CDNs and Image Hosts. These services may therefore be able to see your IP address.']],
            ['4. Data Control & Security', ['You can clear the data on your device at any time from Settings. Account information will be protected using secure systems (HTTPS).']],
            ['5. Changes to This Policy', ['If our services or the way we handle data change, we will update this Privacy Policy page together with the date.']]
        ]
    }
};

function legalRender(key) {
    const my = (window.sakuraLang && window.sakuraLang() === 'my' && window.LEGAL_DOCS_MY) ? window.LEGAL_DOCS_MY : null;
    const d = (my && my[key]) || LEGAL_DOCS[key];
    const body = document.getElementById('legalBody');
    if (!d || !body) return false;
    document.getElementById('legalTitle').textContent = d.title;
    document.getElementById('legalIcon').className = 'fa-solid ' + d.icon;
    // text comes from the constants above (not from users), so inline <b> / entities are safe to render
    const rich = (t) => String(t);
    let html = '<span class="lg-upd">' + (my && my[key] ? my.updated : 'Last updated: ' + LEGAL_UPDATED) + '</span>' + (d.intro ? '<p class="lg-intro">' + rich(d.intro) + '</p>' : '');
    d.sections.forEach(sec => {
        html += '<h4>' + sec[0] + '</h4>';
        sec[1].forEach(part => {
            if (Array.isArray(part)) html += '<ul>' + part.map(li => '<li>' + rich(li) + '</li>').join('') + '</ul>';
            else html += '<p>' + rich(part) + '</p>';
        });
    });
    html += '<p class="lg-end">' + LEGAL_SITE + ' &copy; ' + new Date().getFullYear() + '</p>';
    body.innerHTML = html;
    body.scrollTop = 0;
    return true;
}

let legalOpen = false;
window.openLegal = function(key) {
    if (!legalRender(key)) return;
    legalOpen = true;
    document.getElementById('legalBackdrop').classList.add('show');
    const sheet = document.getElementById('legalSheet');
    sheet.classList.add('show');
    sheet.setAttribute('aria-hidden', 'false');
};
window.closeLegal = function() {
    legalOpen = false;
    document.getElementById('legalSheet')?.classList.remove('show');
    document.getElementById('legalSheet')?.setAttribute('aria-hidden', 'true');
    document.getElementById('legalBackdrop')?.classList.remove('show');
};

document.addEventListener('DOMContentLoaded', () => {
    const yr = document.getElementById('stYear');
    if (yr) yr.textContent = new Date().getFullYear();
    document.querySelectorAll('.st-link[data-legal]').forEach(b => b.addEventListener('click', () => openLegal(b.dataset.legal)));
});
// Esc closes the sheet; leaving the page with the phone Back button closes it too
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && legalOpen) closeLegal(); });
window.addEventListener('popstate', () => { if (legalOpen) closeLegal(); });


// theme: mark the saved one in the picker + browser bar colour (the palette itself is applied before first paint)
document.addEventListener('DOMContentLoaded', () => {
    applyTheme(safeGet(THEME_KEY, 'teal'), false);
});

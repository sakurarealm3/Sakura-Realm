// --- Firebase Config & SDK Imports ---
import { initializeApp } from "https://www.gstatic.com/firebasejs/13.0.0/firebase-app.js";
import { getDatabase, ref, onValue, update, increment } from "https://www.gstatic.com/firebasejs/13.0.0/firebase-database.js";

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

// --- Global State & Shared Storage Keys ---
const SHARED_STORAGE_KEY = "sakura_shared_master_mangas_v1";
const PREFS_KEY = "sakura_reader_prefs_v1";
const BOOKMARK_KEY = "sakura_bookmarks_v1";

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

function listenToFirebaseData() {
    const mangaRef = ref(database, 'manga_list');
    onValue(mangaRef, (snapshot) => {
        const data = snapshot.val();
        if (data) {
            let formattedList = Object.keys(data).map(key => {
                const item = data[key] || {};
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
                            pages: rawPages.filter(Boolean).map(pUrl => ({ data: pUrl }))
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
                    image: item.cover_image || item.image || 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?q=80&w=1000',
                    coverType: item.coverType || 'Manga',
                    status: item.status || 'Ongoing',
                    rating: item.rating || '4.9 / 5.0',
                    views: Number(item.views || 0),
                    createdAt: createdAt,
                    updatedAt: Math.max(createdAt, lastChapterAt),
                    lastChapterAt: lastChapterAt,
                    latestChapterTitle: latestCh ? latestCh.title : '',
                    description: item.description || 'Cinematic Manga Experience desu~',
                    genre: item.genre || 'Action, Fantasy',
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
        } else {
            currentMangaData = safeGet(SHARED_STORAGE_KEY, []);
        }
        refreshCurrentView();
        populateFilterGenres();
    }, (error) => {
        console.warn("Firebase Read Warning/Fallback:", error);
        currentMangaData = safeGet(SHARED_STORAGE_KEY, []);
        refreshCurrentView();
        populateFilterGenres();
    });
}

function loadSharedMangas() {
    return currentMangaData.length > 0 ? currentMangaData : safeGet(SHARED_STORAGE_KEY, []);
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

function populateFilterGenres() {
    const container = document.getElementById('filterGenresList');
    if (!container) return;
    
    const mangas = loadSharedMangas();
    const defaultGenres = [
        'Action', 'Adventure', 'Fantasy', 'Romance', 'Comedy', 
        'Sci-Fi', 'Supernatural', 'Isekai', 'Drama', 'Mystery', 
        'Horror', 'Slice of Life', 'Martial Arts', 'Seinen', 'Shonen'
    ];
    
    const genresSet = new Set(defaultGenres);
    mangas.forEach(m => {
        if (m.genre) {
            m.genre.split(',').forEach(g => {
                const clean = g.trim();
                if (clean) genresSet.add(clean);
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
    if (!mangaId) return;
    holdOrderUntil = Date.now() + 3000;
    try {
        // Atomic server-side +1 (no read-then-write race)
        await update(ref(database, `manga_list/${mangaId}`), { views: increment(1) });
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

// Downscale by WIDTH (so tall webtoon strips stay readable), skip if already small enough
function loadDownscaledImage(originalUrl, imgElement) {
    if (currentImageQuality === 'high') {
        imgElement.src = originalUrl;
        return;
    }
    const maxWidth = currentImageQuality === 'low' ? 540 : 800;
    const jpegQuality = currentImageQuality === 'low' ? 0.55 : 0.78;
    const probe = new Image();
    probe.crossOrigin = "anonymous";
    probe.onload = function() {
        const w = probe.naturalWidth, h = probe.naturalHeight;
        const outH = Math.round(h * (maxWidth / w));
        if (!w || !h || w <= maxWidth || outH > 16000) {
            imgElement.src = originalUrl;
            return;
        }
        try {
            const canvas = document.createElement('canvas');
            canvas.width = maxWidth;
            canvas.height = outH;
            canvas.getContext('2d').drawImage(probe, 0, 0, canvas.width, canvas.height);
            imgElement.src = canvas.toDataURL('image/jpeg', jpegQuality);
        } catch (e) {
            imgElement.src = originalUrl;
        }
    };
    probe.onerror = function() { imgElement.src = originalUrl; };
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
            <div class="absolute inset-0 bg-cover bg-center group-hover:scale-105 transition duration-500" style='background-image: ${esc(cssUrl(manga.image))}'></div>
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

function latestHeroAutoplay() {
    const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    return !reduce && document.querySelectorAll('#latestHeroSlides .lh-slide').length > 1;
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
    const list = [...loadSharedMangas()].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)).slice(0, 6);
    // Rebuild only when something visible changed (view counts etc. must not restart the carousel)
    const key = list.map(m => [m.id, m.updatedAt || 0, m.createdAt || 0, m.lastChapterAt || 0, m.latestChapterTitle || '', m.image].join('~')).join('|');
    if (key === latestHeroKey && (wrap.children.length || !list.length)) return;
    latestHeroKey = key;

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

        slide.onclick = () => window.navigateToView('detail', m.id, m.title);
        slide.onkeydown = (e) => { if (e.key === 'Enter') slide.click(); };
        wrap.appendChild(slide);

        const blk = document.createElement('button');
        blk.type = 'button';
        blk.className = 'lh-block';
        blk.setAttribute('aria-label', `Show update ${i + 1}`);
        blk.onclick = () => { showLatestSlide(i); startLatestHeroTimer(); };
        dotsBox.appendChild(blk);
    });
    const glider = document.createElement('span');
    glider.className = 'lh-glider';
    glider.setAttribute('aria-hidden', 'true');
    dotsBox.appendChild(glider);
    startLatestHeroTimer();
}

function buildMangaCard(manga) {
    const card = document.createElement("div");
    card.className = "formula-manga-card";
    card.onclick = () => window.navigateToView('detail', manga.id, manga.title);

    const mangaStatus = manga.status || 'Ongoing';
    const newBadgeHtml = isMangaNew(manga.createdAt) ? `<div class="formula-new-badge">NEW</div>` : '';

    card.innerHTML = `
        <div class="clean-single-bold-frame">
            <div class="absolute inset-0 bg-cover bg-center group-hover:scale-105 transition duration-500" style='background-image: ${esc(cssUrl(manga.image))}'></div>
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
            const hay = (manga.title + ' ' + (manga.genre || '')).toLowerCase();
            if (!hay.includes(searchQuery)) return false;
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

    const foundManga = loadSharedMangas().find(m => m.id === mangaId);
    const baseChapters = (foundManga && foundManga.chapters && foundManga.chapters.length > 0) ? foundManga.chapters : [
        { id: 'ch-3', title: 'Chapter 3 (Preview)', date: '2026-06-01', pages: [] },
        { id: 'ch-2', title: 'Chapter 2 (Preview)', date: '2026-05-15', pages: [] },
        { id: 'ch-1', title: 'Chapter 1 (Preview)', date: '2026-05-01', pages: [] }
    ];
    // stored order is newest-first; "Oldest" just flips a copy (the data itself is untouched)
    const chapters = chPrefs.sort === 'oldest' ? baseChapters.slice().reverse() : baseChapters;

    if (chLastMangaId !== mangaId) { chLastMangaId = mangaId; chExpandedFor = ''; }

    const countEl = document.getElementById('chapterCountBadge');
    if (countEl) countEl.textContent = chapters.length;
    syncChapterTools();

    const isGrid = chPrefs.view === 'grid';
    container.className = isGrid ? 'ch-grid w-full' : 'space-y-2.5 w-full';

    if (isGrid) {
        chapters.forEach((ch, ci) => {
            const tile = document.createElement('button');
            tile.type = 'button';
            tile.className = 'ch-tile';
            tile.style.setProperty('--i', Math.min(ci, 12));
            tile.title = ch.title;
            tile.onclick = () => navigateToReaderView(mangaId, ch.id, ch.title);
            tile.innerHTML = `<span class="ch-tile-label">CH</span><span class="ch-tile-num">${esc(chapterTileLabel(ch))}</span>`;
            container.appendChild(tile);
        });
        return;
    }

    const expanded = chExpandedFor === mangaId;
    const visible = expanded ? chapters : chapters.slice(0, CH_LIST_LIMIT);

    visible.forEach((ch, ci) => {
        const chBox = document.createElement('div');
        chBox.style.setProperty('--i', Math.min(ci, 12));
        chBox.className = "chapter-grey-box flex items-center justify-between p-3.5 rounded-xl border border-dark-border cursor-pointer transition";
        chBox.onclick = () => navigateToReaderView(mangaId, ch.id, ch.title);

        chBox.innerHTML = `
            <div class="flex items-center gap-3 min-w-0">
                <div class="ch-badge shrink-0"><i class="fa-solid fa-book-open"></i></div>
                <div class="flex flex-col min-w-0 gap-0.5">
                    <span class="ch-title text-xs sm:text-sm font-bold text-slate-100">${esc(ch.title)}</span>
                    <span class="ch-meta text-[10px] text-slate-400">
                        <span><i class="fa-regular fa-calendar"></i> ${esc(ch.date || 'Recent Release')}</span>
                    </span>
                </div>
            </div>
            <div class="ch-go shrink-0"><i class="fa-solid fa-chevron-right text-[10px]"></i></div>
        `;
        container.appendChild(chBox);
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
    const found = loadSharedMangas().find(m => m.id === mangaId);

    if (found && found.chapters && found.chapters.length > 0) {
        // chapters are sorted newest-first, so the last one is Chapter 1
        const firstCh = found.chapters[found.chapters.length - 1];
        navigateToReaderView(mangaId, firstCh.id, firstCh.title);
    } else {
        window.navigateToView('reader', 'ch-1', 'Chapter Reading');
    }
};

function navigateToReaderView(mangaId, chapterId, chapterTitle) {
    if (mangaId) incrementMangaViewCount(mangaId);
    readerFromDetail = (currentActiveView === 'detail');
    window.navigateToView('reader', `${mangaId}___${chapterId}`, chapterTitle);
}

// Switch chapter inside the reader without adding a history entry
function openChapterInPlace(mangaId, chapterId, chapterTitle) {
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
        const found = loadSharedMangas().find(m => m.id === id);
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
    }, { passive: true });
}

function renderReaderContent(readerParam, startIndex = 0) {
    const container = document.getElementById('readerPagesContainer');
    const readerSection = document.getElementById('readerView');
    if (!container) return;
    if (readerObserver) { readerObserver.disconnect(); readerObserver = null; }
    container.innerHTML = '';

    const [mangaId, chapterId] = readerParam.includes('___') ? readerParam.split('___') : [null, readerParam];
    const foundManga = mangaId ? loadSharedMangas().find(m => m.id === mangaId) : null;
    const foundCh = (foundManga && foundManga.chapters) ? foundManga.chapters.find(c => c.id === chapterId) : null;

    const floatingTitle = document.getElementById('readerFloatingTitle');
    if (floatingTitle && foundManga && foundCh) floatingTitle.textContent = `${foundManga.title} - ${foundCh.title}`;

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
            const rawUrl = pageObj.data || pageObj;
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
            loader.textContent = "Loading...";

            const img = document.createElement('img');
            img.loading = "lazy";
            img.className = "manga-page-img";

            img.onload = () => {
                img.classList.add('loaded');
                wrapper.style.minHeight = '0';
                loader.style.opacity = '0';
                setTimeout(() => loader.remove(), 250);
            };
            img.onerror = () => {
                loader.textContent = "Failed to load - tap to retry";
            };

            const start = () => loadDownscaledImage(rawUrl, img);
            loader.onclick = (ev) => {
                if (loader.textContent.startsWith('Failed')) {
                    ev.stopPropagation();
                    loader.textContent = "Loading...";
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

        // End of chapter (scroll mode): Next Chapter / Back to Lobby
        if (!pageMode && foundManga) {
            const idx = foundManga.chapters.findIndex(c => c.id === chapterId);
            const next = idx > 0 ? foundManga.chapters[idx - 1] : null;   // list is newest-first
            const end = document.createElement('div');
            end.className = "w-full max-w-md mx-auto px-6 py-8 flex flex-col gap-3 cursor-default";
            end.onclick = (ev) => ev.stopPropagation();

            const mkBtn = (label, primary, fn) => {
                const b = document.createElement('button');
                b.textContent = label;
                b.className = primary
                    ? "py-3 rounded-2xl bg-sakura-500 text-white font-bold text-sm"
                    : "py-3 rounded-2xl bg-dark-card border border-dark-border text-slate-200 font-bold text-sm";
                b.onclick = fn;
                return b;
            };
            if (next) end.appendChild(mkBtn(`Next: ${next.title}`, true, () => openChapterInPlace(mangaId, next.id, next.title)));
            else {
                const p = document.createElement('p');
                p.className = "text-center text-xs text-slate-400";
                p.textContent = "You are caught up desu~";
                end.appendChild(p);
            }
            end.appendChild(mkBtn("Back to Chapter Lobby", false, () => goBackToDetailFromReader()));
            container.appendChild(end);
        }

        setupReaderTouchEvents();
        lastReaderScrollTop = 0;
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
        (found.genre || '').split(',').forEach(g => {
            const cleanG = g.trim();
            if (cleanG !== '') {
                const tag = document.createElement('div');
                tag.className = "individual-genre-frame";
                tag.textContent = cleanG;
                genresContainer.appendChild(tag);
            }
        });
    }

    renderChapterList(found.id);
    applyBookmarkUI(safeGet(BOOKMARK_KEY, []).includes(found.id));
}

// Decides HOW to switch views: smooth cross-fade (View Transitions API) -> CSS slide fallback -> instant (reduced motion)
function renderView(state, isRestore = false) {
    const isFirst = !firstViewRendered;
    firstViewRendered = true;
    const reduce = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

    if (isFirst || reduce) {
        applyView(state, isFirst ? 'first' : 'none');
        return;
    }
    if (typeof document.startViewTransition === 'function') {
        // The browser snapshots the old page, we swap the DOM, then it cross-fades old -> new.
        // No blank frame, and the new page is already at the right scroll position.
        document.documentElement.dataset.nav = navDirection === 'back' ? 'back' : 'forward';
        document.startViewTransition(() => applyView(state, 'none'));
        return;
    }
    applyView(state, 'css');
}

// mode: 'first' (page load) | 'none' (no CSS animation) | 'css' (fallback slide animation)
function applyView(state, mode) {
    const views = ['homeView', 'genresView', 'detailView', 'readerView'];
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
    if (state.view === 'detail') {
        targetId = 'detailView';
        shownDetailId = state.id;
        const found = loadSharedMangas().find(m => m.id === state.id);
        if (found) fillDetail(found);
    }
    if (state.view === 'reader') {
        targetId = 'readerView';
        renderReaderContent(state.id);
    }

    const targetSection = document.getElementById(targetId);
    if (targetSection) {
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

    if (targetId === 'readerView' || targetId === 'detailView') {
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
        .filter(m => ((m.title || '') + ' ' + (m.genre || '')).toLowerCase().includes(ql))
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
    const m = loadSharedMangas().find(x => x.id === id) || getRecentSearches().find(x => x.id === id);
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
    if (!dustActive) renderSearchBody(getRecentSearches().length === 0);
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
            tx.fillStyle = '#0f2124'; tx.fillRect(0, 0, W, H);
            if (img && img.naturalWidth) {
                const sc = Math.max(W / img.naturalWidth, H / img.naturalHeight);
                const w = img.naturalWidth * sc, h = img.naturalHeight * sc;
                tx.drawImage(img, (W - w) / 2, (H - h) / 2, w, h);
            } else {
                const g = tx.createLinearGradient(0, 0, W, H);
                g.addColorStop(0, '#2cc7a9'); g.addColorStop(1, '#ff8fab');
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
    if (row && row.classList.contains('dust-hide')) return;
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

window.toggleDarkMode = function() {
    const html = document.documentElement;
    const icon = document.getElementById('themeIcon');
    if (html.classList.contains('dark')) {
        html.classList.remove('dark');
        icon.className = "fa-solid fa-sun text-sm sm:text-base text-amber-500";
    } else {
        html.classList.add('dark');
        icon.className = "fa-solid fa-moon text-sm sm:text-base text-sakura-300";
    }
};

window.toggleRightSidebar = function() {
    const sidebar = document.getElementById('rightSidebar');
    const backdrop = document.getElementById('sidebarBackdrop');
    const isOpen = !sidebar.classList.contains('translate-x-full');
    
    if (isOpen) {
        sidebar.classList.add('translate-x-full');
        backdrop.classList.add('opacity-0', 'pointer-events-none');
    } else {
        sidebar.classList.remove('translate-x-full');
        backdrop.classList.remove('opacity-0', 'pointer-events-none');
        setTimeout(resizeSidebarCanvas, 50);
    }
};

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
    const pal = [['#6fe3c9', '#f3fffb'], ['#5fd3e6', '#eefcff'], ['#b7a4ff', '#f7f2ff']][variant];
    let g = x.createRadialGradient(0, 0, 3, 0, 0, S / 2);
    g.addColorStop(0, 'rgba(150,255,230,0.42)');
    g.addColorStop(1, 'rgba(150,255,230,0)');
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
        x.strokeStyle = 'rgba(14,166,145,0.35)';
        x.beginPath(); x.moveTo(0, -5); x.lineTo(0, -24); x.stroke();
        x.restore();
    }
    x.fillStyle = '#0b8a79';
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
    g.addColorStop(0, '#6fe3c9'); g.addColorStop(1, '#f3fffb');
    x.fillStyle = g;
    x.beginPath();
    x.moveTo(0, 0);
    x.bezierCurveTo(-11, -6, -9, -22, 0, -27);
    x.bezierCurveTo(9, -22, 11, -6, 0, 0);
    x.fill();
    x.strokeStyle = 'rgba(255,255,255,0.5)'; x.lineWidth = 0.8; x.stroke();
    x.fillStyle = '#12806f';                         // calyx
    x.beginPath(); x.ellipse(0, -1, 5.5, 3.2, 0, 0, Math.PI * 2); x.fill();
    return c;
}

function makePetalSprite() {
    const c = document.createElement('canvas');
    c.width = 28; c.height = 36;
    const x = c.getContext('2d');
    x.translate(14, 32);
    const g = x.createLinearGradient(0, 0, 0, -28);
    g.addColorStop(0, '#6fe3c9'); g.addColorStop(1, '#f3fffb');
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
        ctx.fillStyle = this.depth === 0 ? '#2a554a' : '#2f5c50';
        ctx.fill();
        ctx.beginPath();                                       // soft rim light on one side of the bark
        ctx.moveTo(up[0][0], up[0][1]);
        for (let i = 1; i <= N; i++) ctx.lineTo(up[i][0], up[i][1]);
        ctx.strokeStyle = 'rgba(150,245,220,0.42)';
        ctx.lineWidth = 1;
        ctx.stroke();
        for (const k of this.kids) {
            ctx.beginPath();                                   // blend the joint
            ctx.arc(k.sx, k.sy, k.w / 2, 0, Math.PI * 2);
            ctx.fillStyle = '#2f5c50';
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
            g.addColorStop(0, '#0e5d52'); g.addColorStop(1, '#2bb89c');
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
        bg.addColorStop(0, '#050d10'); bg.addColorStop(0.55, '#07161a'); bg.addColorStop(1, '#0a2024');
        ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
        let g = ctx.createRadialGradient(W * 0.22, H * 0.16, 0, W * 0.22, H * 0.16, W * 0.85);
        g.addColorStop(0, 'rgba(95,224,194,0.17)'); g.addColorStop(1, 'rgba(95,224,194,0)');
        ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
        g = ctx.createRadialGradient(W, H * 0.86, 0, W, H * 0.86, W * 0.9);
        g.addColorStop(0, 'rgba(150,120,240,0.14)'); g.addColorStop(1, 'rgba(150,120,240,0)');
        ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
        for (const s of sStars) {
            ctx.globalAlpha = 0.25 + 0.55 * (0.5 + 0.5 * Math.sin(time * s.sp + s.ph));
            ctx.fillStyle = '#d9fff5';
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
            ctx.fillStyle = '#8ff0da';
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
    syncReaderPrefsUI();
    setupSearch();
    renderLatestHero();
    initSakuraPetals();
    listenToFirebaseData();
    restoreViewFromHash();
    
    window.addEventListener('storage', (e) => {
        if (e.key === SHARED_STORAGE_KEY) {
            refreshCurrentView();
        }
    });
});

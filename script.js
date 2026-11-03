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

function renderChapterList(mangaId) {
    const container = document.getElementById('chapterListContainer');
    if (!container) return;
    container.innerHTML = '';

    const foundManga = loadSharedMangas().find(m => m.id === mangaId);
    const chapters = (foundManga && foundManga.chapters && foundManga.chapters.length > 0) ? foundManga.chapters : [
        { id: 'ch-3', title: 'Chapter 3 (Preview)', date: '2026-06-01', pages: [] },
        { id: 'ch-2', title: 'Chapter 2 (Preview)', date: '2026-05-15', pages: [] },
        { id: 'ch-1', title: 'Chapter 1 (Preview)', date: '2026-05-01', pages: [] }
    ];

    chapters.forEach((ch) => {
        const chBox = document.createElement('div');
        chBox.className = "chapter-grey-box flex items-center justify-between p-3.5 rounded-xl border border-dark-border cursor-pointer transition";
        chBox.onclick = () => navigateToReaderView(mangaId, ch.id, ch.title);

        const pageCountText = ch.pages ? `${ch.pages.length} pages` : 'Preview';
        chBox.innerHTML = `
            <div class="flex items-center gap-3">
                <div class="w-8 h-8 rounded-lg bg-sakura-900/40 border border-sakura-500/30 flex items-center justify-center text-sakura-400 text-xs font-bold">
                    <i class="fa-solid fa-book-open"></i>
                </div>
                <div class="flex flex-col">
                    <span class="text-xs sm:text-sm font-bold text-slate-200">${esc(ch.title)}</span>
                    <span class="text-[10px] text-slate-400">${esc(ch.date || 'Recent Release')} &nbsp; ${esc(pageCountText)}</span>
                </div>
            </div>
            <div class="flex items-center gap-2 text-xs text-sakura-400 font-bold">
                <span>Read</span>
                <i class="fa-solid fa-chevron-right text-[10px]"></i>
            </div>
        `;
        container.appendChild(chBox);
    });
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

window.navigateToView = function(viewName, id = '', title = '', direction = 'forward') {
    previousActiveView = currentActiveView;
    currentActiveView = viewName;

    const activeSection = document.querySelector('.view-section:not(.hidden)');
    if (activeSection) {
        scrollPositions[activeSection.id] = window.scrollY;
    }

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
    const leaving = document.querySelector('.view-section:not(.hidden)');
    if (leaving) scrollPositions[leaving.id] = window.scrollY;
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
        window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
    } else {
        window.scrollTo({ top: scrollPositions[targetId] || 0, left: 0, behavior: 'instant' });
    }
}

window.toggleSearchBar = function() {
    const overlay = document.getElementById('searchOverlay');
    const input = document.getElementById('searchInput');
    overlay.classList.toggle('hidden');
    if (!overlay.classList.contains('hidden')) {
        input.focus();
    } else {
        input.value = '';
        if (searchQuery) { searchQuery = ''; renderMainMangaGrid(); }
    }
};

function setupSearch() {
    const input = document.getElementById('searchInput');
    if (!input) return;
    let timer;
    input.addEventListener('input', () => {
        clearTimeout(timer);
        timer = setTimeout(() => {
            searchQuery = input.value.trim().toLowerCase();
            if (currentActiveView !== 'home') window.goHome();
            else renderMainMangaGrid();
        }, 150);
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

const sidebarCanvas = document.getElementById('sidebarSakuraCanvas');
let sCtx = sidebarCanvas ? sidebarCanvas.getContext('2d') : null;
let sWidth, sHeight;

function resizeSidebarCanvas() {
    if (!sidebarCanvas) return;
    sWidth = sidebarCanvas.width = sidebarCanvas.parentElement.clientWidth;
    sHeight = sidebarCanvas.height = sidebarCanvas.parentElement.clientHeight;
}

window.addEventListener('resize', resizeSidebarCanvas);
if (sidebarCanvas) resizeSidebarCanvas();

class BranchNode {
    constructor(x, y, length, angle, width, depth) {
        this.x = x;
        this.y = y;
        this.length = length;
        this.angle = angle;
        this.baseAngle = angle;
        this.width = width;
        this.depth = depth;
        this.children = [];
        this.clusters = [];
        this.swayOffset = Math.random() * Math.PI * 2;
        this.swaySpeed = 0.012 + Math.random() * 0.008;
        this.buildSubBranches();
    }
    
    buildSubBranches() {
        if (this.depth <= 0) return;
        let numChildren = this.depth > 2 ? 2 : (Math.random() > 0.5 ? 1 : 2);
        for (let i = 0; i < numChildren; i++) {
            let angleDiff = (i === 0 ? -1 : 1) * (0.25 + Math.random() * 0.35);
            let newLength = this.length * (0.7 + Math.random() * 0.15);
            let newWidth = this.width * 0.62;
            let endX = this.x + Math.cos(this.angle + angleDiff) * this.length;
            let endY = this.y + Math.sin(this.angle + angleDiff) * this.length;
            this.children.push(new BranchNode(endX, endY, newLength, this.angle + angleDiff, newWidth, this.depth - 1));
        }
        if (this.depth <= 2) {
            let numClusters = 2 + Math.floor(Math.random() * 3);
            for (let c = 0; c < numClusters; c++) {
                let t = c / numClusters;
                let cx = this.x + Math.cos(this.angle) * (this.length * t) + (Math.random() - 0.5) * 15;
                let cy = this.y + Math.sin(this.angle) * (this.length * t) + (Math.random() - 0.5) * 15;
                this.clusters.push(new FlowerCluster(cx, cy));
            }
        }
    }
    
    update(time, parentWind) {
        this.swayOffset += this.swaySpeed;
        let windEffect = Math.sin(time * 1.8 + this.swayOffset) * 0.045;
        this.angle = this.baseAngle + windEffect + parentWind;
        for (let child of this.children) {
            child.update(time, windEffect);
        }
        for (let cluster of this.clusters) {
            cluster.update(time);
        }
    }
    
    draw(ctx) {
        ctx.beginPath();
        ctx.moveTo(this.x, this.y);
        let endX = this.x + Math.cos(this.angle) * this.length;
        let endY = this.y + Math.sin(this.angle) * this.length;
        let ctrlX = this.x + Math.cos(this.angle + 0.15) * (this.length * 0.5);
        let ctrlY = this.y + Math.sin(this.angle + 0.15) * (this.length * 0.5);
        
        ctx.quadraticCurveTo(ctrlX, ctrlY, endX, endY);
        ctx.strokeStyle = this.depth > 2 ? '#0a1514' : '#12231f';
        ctx.lineWidth = this.width;
        ctx.lineCap = 'round';
        ctx.stroke();
        
        for (let child of this.children) {
            child.x = endX;
            child.y = endY;
            child.draw(ctx);
        }
        for (let cluster of this.clusters) {
            cluster.draw(ctx);
        }
    }
}

class FlowerCluster {
    constructor(x, y) {
        this.x = x;
        this.y = y;
        this.flowers = [];
        let count = 4 + Math.floor(Math.random() * 4);
        for (let i = 0; i < count; i++) {
            this.flowers.push({
                offsetX: (Math.random() - 0.5) * 20,
                offsetY: (Math.random() - 0.5) * 20,
                size: 4 + Math.random() * 4,
                rotation: Math.random() * Math.PI,
                pulseOffset: Math.random() * 10
            });
        }
    }
    
    update(time) {
        if (Math.random() < 0.0015 && sidebarPetals.length < 40) {
            let f = this.flowers[Math.floor(Math.random() * this.flowers.length)];
            sidebarPetals.push(new SidebarPetal(this.x + f.offsetX, this.y + f.offsetY));
        }
    }
    
    draw(ctx) {
        for (let f of this.flowers) {
            let fx = this.x + f.offsetX;
            let fy = this.y + f.offsetY;
            ctx.save();
            ctx.translate(fx, fy);
            ctx.rotate(f.rotation + Math.sin(Date.now() * 0.002 + f.pulseOffset) * 0.15);
            for (let p = 0; p < 5; p++) {
                ctx.rotate((Math.PI * 2) / 5);
                ctx.beginPath();
                ctx.fillStyle = '#b9f5e6';
                ctx.shadowColor = '#3fd9bd';
                ctx.shadowBlur = 4;
                ctx.ellipse(0, -f.size * 0.55, f.size * 0.32, f.size * 0.55, 0, 0, Math.PI * 2);
                ctx.fill();
            }
            ctx.beginPath();
            ctx.arc(0, 0, f.size * 0.18, 0, Math.PI * 2);
            ctx.fillStyle = '#0ea691';
            ctx.fill();
            ctx.restore();
        }
    }
}

class SidebarPetal {
    constructor(x, y) {
        this.x = x || Math.random() * sWidth;
        this.y = y || Math.random() * sHeight * 0.4;
        this.size = 3 + Math.random() * 4;
        this.speedX = Math.random() * 0.8 + 0.4;
        this.speedY = Math.random() * 0.6 + 0.3;
        this.angle = Math.random() * Math.PI * 2;
        this.spinSpeed = (Math.random() - 0.5) * 0.05;
        this.oscillationSpeed = 0.02 + Math.random() * 0.02;
        this.initialX = this.x;
        this.age = 0;
        this.maxAge = 350 + Math.random() * 200;
        this.opacity = 0;
    }
    
    update(time) {
        this.age++;
        if (this.opacity < 1) this.opacity += 0.02;
        let windForce = 1.0 + Math.sin(time * 1.2 + this.initialX * 0.01) * 0.4;
        this.speedX = windForce + Math.cos(time * this.oscillationSpeed) * 0.3;
        this.speedY = 0.7 + Math.sin(time * 0.8 + this.initialX) * 0.2;
        this.x += this.speedX;
        this.y += this.speedY;
        this.angle += this.spinSpeed;
        if (this.y > sHeight + 20 || this.x > sWidth + 20 || this.age > this.maxAge) {
            this.reset();
        }
    }
    
    reset() {
        this.x = -20 + Math.random() * (sWidth + 20);
        this.y = -10 - Math.random() * 30;
        this.size = 3 + Math.random() * 4;
        this.speedX = Math.random() * 0.8 + 0.4;
        this.speedY = Math.random() * 0.6 + 0.3;
        this.angle = Math.random() * Math.PI * 2;
        this.spinSpeed = (Math.random() - 0.5) * 0.05;
        this.initialX = this.x;
        this.age = 0;
        this.maxAge = 350 + Math.random() * 200;
        this.opacity = 0;
    }
    
    draw(ctx) {
        ctx.save();
        ctx.translate(this.x, this.y);
        ctx.rotate(this.angle);
        ctx.globalAlpha = Math.min(1, this.opacity) * 0.75;
        ctx.beginPath();
        ctx.fillStyle = '#b9f5e6';
        ctx.shadowColor = '#3fd9bd';
        ctx.shadowBlur = 4;
        ctx.ellipse(0, 0, this.size * 0.38, this.size, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }
}

let sidebarBranches = [];
let sidebarPetals = [];
let sStartTime = Date.now();

function initSidebarScene() {
    if (!sidebarCanvas) return;
    sidebarBranches = [];
    sidebarPetals = [];
    if (!sWidth || !sHeight) resizeSidebarCanvas();
    sidebarBranches.push(new BranchNode(sWidth + 10, -10, 180, 2.6, 18, 3));
    sidebarBranches.push(new BranchNode(-10, sHeight + 10, 150, -0.6, 15, 2));
    let totalPetals = 20;
    for (let i = 0; i < totalPetals; i++) {
        let p = new SidebarPetal();
        p.y = Math.random() * sHeight;
        p.x = Math.random() * sWidth;
        sidebarPetals.push(p);
    }
}

if (sidebarCanvas) {
    initSidebarScene();
    const sidebarEl = document.getElementById('rightSidebar');
    function animateSidebar() {
        // Don't burn CPU/battery while the sidebar is closed or the tab is hidden
        if (document.hidden || (sidebarEl && sidebarEl.classList.contains('translate-x-full'))) {
            requestAnimationFrame(animateSidebar);
            return;
        }
        let time = (Date.now() - sStartTime) * 0.001;
        sCtx.clearRect(0, 0, sWidth, sHeight);
        let bgGrad = sCtx.createLinearGradient(0, 0, 0, sHeight);
        bgGrad.addColorStop(0, '#050d10');
        bgGrad.addColorStop(1, '#0a1f22');
        sCtx.fillStyle = bgGrad;
        sCtx.fillRect(0, 0, sWidth, sHeight);
        for (let branch of sidebarBranches) {
            branch.update(time, 0);
            branch.draw(sCtx);
        }
        for (let petal of sidebarPetals) {
            petal.update(time);
            petal.draw(sCtx);
        }
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

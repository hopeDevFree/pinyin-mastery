// ===== FIREBASE USER CODE =====
const USER_CODE_KEY = 'pinyin_user_code';

function generateUserCode() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let code = 'USER-';
    for (let i = 0; i < 6; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
}

let currentUserCode = null;

function getUserCode() {
    if (!currentUserCode) {
        let code = null;
        try {
            code = localStorage.getItem(USER_CODE_KEY);
        } catch (e) {
        }
        if (!code) {
            code = generateUserCode();
            try {
                localStorage.setItem(USER_CODE_KEY, code);
            } catch (e) {
            }
        }
        currentUserCode = code;
    }
    return currentUserCode;
}

function saveToFirebase(dataType, data) {
    if (!window.db) return;

    try {
        const userCode = getUserCode();
        window.db.ref(`users/${userCode}/${dataType}`).set(data)
            .catch(err => console.warn('⚠️ Errore async Firebase:', err.message));
    } catch (err) {
        // Cattura errori di validazione sincroni (es. chiavi invalide)
        console.warn('⚠️ Errore sync Firebase:', err.message);
    }
}

function loadFromFirebase(dataType) {
    return new Promise((resolve) => {
        if (!window.db) {
            resolve(null);
            return;
        }
        const userCode = getUserCode();
        window.db.ref(`users/${userCode}/${dataType}`).once('value', snapshot => {
            resolve(snapshot.val());
        }).catch(() => resolve(null));
    });
}

function loadFromCode(userCode, dataType) {
    return new Promise((resolve) => {
        if (!window.db) {
            resolve(null);
            return;
        }
        window.db.ref(`users/${userCode}/${dataType}`).once('value', snapshot => {
            resolve(snapshot.val());
        }).catch(() => resolve(null));
    });
}

// ===== STORAGE KEYS =====
const LEITNER_KEY = 'leitner_state';
const META_KEY = 'pinyin_meta_v2';
const STATS_KEY = 'pinyin_stats_v2';

// Cache in memoria
let leitnerCache = null;
let metaCache = null;
let statsCache = null;

// ===== LEITNER =====
function initLeitnerState() {
    if (leitnerCache) return leitnerCache;
    let s = {};
    try {
        const saved = localStorage.getItem(LEITNER_KEY);
        if (saved) s = JSON.parse(saved);
    } catch (e) {
    }
    for (const v of vocaboli) {
        if (!(v.id in s)) s[v.id] = 1;
    }
    const valid = new Set(vocaboli.map(v => v.id));
    for (const k of Object.keys(s)) if (!valid.has(k)) delete s[k];
    leitnerCache = s;
    try {
        localStorage.setItem(LEITNER_KEY, JSON.stringify(s));
    } catch (e) {
    }
    return s;
}

function salvaStato(s) {
    leitnerCache = s;
    try {
        localStorage.setItem(LEITNER_KEY, JSON.stringify(s));
    } catch (e) {
    }
    saveToFirebase('leitner', s);
}

function aggiornaParola(id, ok) {
    const st = initLeitnerState();
    if (!(id in st)) return;
    st[id] = ok ? Math.min(st[id] + 1, 5) : 1;
    salvaStato(st);
}

function getParolePerCapitolo(cap) {
    const st = initLeitnerState();
    let list = (cap === 'all' || cap === 'smart') ? [...vocaboli] : vocaboli.filter(v => String(v.capitolo) === String(cap));
    list.sort((a, b) => (st[a.id] || 1) - (st[b.id] || 1));
    return list;
}

// ===== META =====
function initMeta() {
    if (metaCache) return metaCache;
    let m = {};
    try {
        const saved = localStorage.getItem(META_KEY);
        if (saved) m = JSON.parse(saved);
    } catch (e) {
    }
    metaCache = m;
    return m;
}

function saveMeta(m) {
    metaCache = m;
    try {
        localStorage.setItem(META_KEY, JSON.stringify(m));
    } catch (e) {
    }
    saveToFirebase('meta', m);
}

function getMeta(id) {
    const all = initMeta();
    return all[id] || {lastSeen: 0, seen: 0, wrong: 0};
}

function updateMeta(id, isCorrect) {
    const all = initMeta();
    const now = Date.now();
    if (!all[id]) all[id] = {lastSeen: now, seen: 0, wrong: 0};
    all[id].lastSeen = now;
    all[id].seen = (all[id].seen || 0) + 1;
    if (!isCorrect) all[id].wrong = (all[id].wrong || 0) + 1;
    saveMeta(all);
}

// ===== STATS =====
function initStats() {
    if (statsCache) return statsCache;
    let st = null;
    try {
        const saved = localStorage.getItem(STATS_KEY);
        if (saved) st = JSON.parse(saved);
    } catch (e) {
    }
    if (!st) st = {totalAnswers: 0, correctAnswers: 0, sessions: 0, streak: 0, bestStreak: 0, lastDate: null};
    statsCache = st;
    return st;
}

function saveStats(st) {
    statsCache = st;
    try {
        localStorage.setItem(STATS_KEY, JSON.stringify(st));
    } catch (e) {
    }
    saveToFirebase('stats', st);
}

function updateStatsOnAnswer(isCorrect) {
    const st = initStats();
    st.totalAnswers++;
    if (isCorrect) st.correctAnswers++;
    saveStats(st);
}

function updateStreakOnSession() {
    const st = initStats();
    const today = new Date().toDateString();
    if (st.lastDate !== today) {
        const yesterday = new Date(Date.now() - 86400000).toDateString();
        if (st.lastDate === yesterday) st.streak = (st.streak || 0) + 1; else st.streak = 1;
        st.bestStreak = Math.max(st.bestStreak || 0, st.streak);
        st.lastDate = today;
    }
    st.sessions = (st.sessions || 0) + 1;
    saveStats(st);
}

function getAccuracy() {
    const st = initStats();
    if (!st.totalAnswers) return 0;
    return Math.round(st.correctAnswers / st.totalAnswers * 100);
}

// ===== AUDIO =====
function pronunciaCinese(t) {
    if (speechSynthesis.speaking || speechSynthesis.pending) speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(t);
    u.lang = 'zh-CN';
    u.rate = 0.9;
    speechSynthesis.speak(u);
}

// ===== DISTRATTORI =====
function generaDistrattori(parola, pool, campo) {
    const ok = parola[campo];
    const target = (campo === 'pinyin') ? ok.split(' ').length : ok.length;
    const altri = pool.filter(p => p.id !== parola.id && p[campo] !== ok);
    const same = [], sameInit = [], other = [];
    altri.forEach(p => {
        const l = (campo === 'pinyin') ? p[campo].split(' ').length : p[campo].length;
        if (l === target) same.push(p);
        else if (campo === 'pinyin' && p[campo][0].toLowerCase() === ok[0].toLowerCase()) sameInit.push(p);
        else other.push(p);
    });
    const combined = [...same.sort(() => Math.random() - 0.5), ...sameInit.sort(() => Math.random() - 0.5), ...other.sort(() => Math.random() - 0.5)];
    const res = [];
    const seen = new Set([ok]);
    for (const p of combined) {
        const v = p[campo];
        if (!seen.has(v)) {
            seen.add(v);
            res.push(v);
            if (res.length === 3) break;
        }
    }
    let i = 1;
    while (res.length < 3) {
        const f = `[?] ${i}`;
        if (!seen.has(f)) {
            res.push(f);
            seen.add(f);
        }
        i++;
    }
    return res;
}

function creaDomandaDinamica(parola, pool) {
    const tipi = ['hanzi_to_pinyin', 'hanzi_to_italiano', 'italiano_to_hanzi'];
    const tipo = tipi[Math.floor(Math.random() * tipi.length)];
    let stimolo, campo, risposta, testo;
    if (tipo === 'hanzi_to_pinyin') {
        stimolo = parola.hanzi;
        campo = 'pinyin';
        risposta = parola.pinyin;
        testo = 'Scegli il pinyin corretto';
    } else if (tipo === 'hanzi_to_italiano') {
        stimolo = parola.hanzi;
        campo = 'italiano';
        risposta = parola.italiano;
        testo = 'Scegli la traduzione corretta';
    } else {
        stimolo = parola.italiano;
        campo = 'hanzi';
        risposta = parola.hanzi;
        testo = 'Scegli il carattere corretto';
    }
    const distr = generaDistrattori(parola, pool, campo);
    const opzioni = [risposta, ...distr].sort(() => Math.random() - 0.5);
    return {tipo, stimolo, testoDomanda: testo, opzioni, rispostaCorretta: risposta, campo};
}

// ===== SESSIONE =====
const COOLDOWN_BASE = 8, DEC = 1, INC = 3;
const session = {
    queue: [], current: null, score: 0, mistakes: [], lesson: null,
    answered: false, total: 0, askedCount: 0, domandaCorrente: null
};

function initSession(parole, lessonId) {
    const leit = initLeitnerState();
    session.queue = parole.map(p => ({
        word: p, priority: 6 - (leit[p.id] || 1), cooldown: 0, wrong: false, shown: 0
    }));
    session.lesson = lessonId;
    session.score = 0;
    session.mistakes = [];
    session.answered = false;
    session.current = null;
    session.domandaCorrente = null;
    session.total = parole.length;
    session.askedCount = 0;
}

function getNextQuestion() {
    session.queue.forEach(i => {
        if (i.cooldown > 0) i.cooldown--;
    });
    let avail = session.queue.filter(i => i.cooldown <= 0);
    if (avail.length === 0) {
        session.queue.forEach(i => i.cooldown = 0);
        avail = [...session.queue];
    }
    avail.sort((a, b) => {
        if (b.priority !== a.priority) return b.priority - a.priority;
        return a.shown - b.shown;
    });
    const top = Math.min(3, avail.length);
    const cand = avail.slice(0, top);
    const chosen = cand[Math.floor(Math.random() * cand.length)];
    const dyn = Math.min(COOLDOWN_BASE, Math.max(2, session.queue.length - 2));
    chosen.cooldown = dyn;
    chosen.shown++;
    session.askedCount++;
    session.current = chosen;
    return chosen;
}

// ===== UI =====
const screens = {
    lesson: document.getElementById('lessonScreen'),
    quiz: document.getElementById('quizScreen'),
    studio: document.getElementById('studioScreen'),
    end: document.getElementById('endScreen')
};

function showScreen(id) {
    Object.values(screens).forEach(s => s.classList.remove('active'));
    screens[id]?.classList.add('active');
    if (id === 'lesson') renderHome();
}

// ===== SMART REVIEW =====
function getSmartReviewWords() {
    const leit = initLeitnerState();
    const metaAll = initMeta();
    const now = Date.now();
    const scored = vocaboli.map(v => {
        const lvl = leit[v.id] || 1;
        const m = metaAll[v.id] || {lastSeen: 0, seen: 0, wrong: 0};
        const days = (now - (m.lastSeen || 0)) / 86400000;
        const wrongRatio = m.seen ? m.wrong / m.seen : (lvl === 1 ? 0.5 : 0);
        let score = (6 - lvl) * 12 + wrongRatio * 25 + Math.min(days, 14);
        if (lvl <= 2) score += 10;
        if (days > 4 && lvl <= 4) score += 8;
        return {word: v, score, lvl, days, wrongRatio, m};
    });
    scored.sort((a, b) => b.score - a.score);
    let filtered = scored.filter(s => s.lvl <= 2 || s.days > 3 || s.wrongRatio > 0.3);
    if (filtered.length < 5) filtered = scored;
    return filtered.slice(0, 15).map(s => s.word);
}

// ===== HOME =====
function renderHome() {
    const smartWords = getSmartReviewWords();
    const smartDesc = document.getElementById('smartDesc');
    const smartBtn = document.getElementById('smartBtn');
    if (smartWords.length === 0) {
        smartDesc.textContent = 'Tutto memorizzato! Sei avanti.';
        smartBtn.textContent = 'Ripassa comunque';
    } else {
        smartDesc.textContent = `${smartWords.length} parole da consolidare`;
        smartBtn.textContent = 'Avvia';
    }

    const leit = initLeitnerState();
    for (let cap = 1; cap <= 35; cap++) {
        const list = vocaboli.filter(v => v.capitolo == cap);
        if (!list.length) continue;
        const mastered = list.filter(v => (leit[v.id] || 1) >= 4).length;
        const pct = Math.round(mastered / list.length * 100);
        const el = document.getElementById(`prog-${cap}`);
        if (el) {
            el.textContent = pct ? `${pct}%` : '0%';
            if (pct > 0) el.classList.add('has-progress');
        }
    }

    const allEl = document.getElementById('allCount');
    if (allEl) allEl.textContent = `${vocaboli.length} parole`;

    const stats = initStats();
    const totalMastered = vocaboli.filter(v => (leit[v.id] || 1) === 5).length;
    const acc = getAccuracy();
    const homeStats = document.getElementById('homeStats');
    homeStats.innerHTML = `
    <div class="stat-mini"><b>${totalMastered}</b><span>Padroneggiate</span></div>
    <div class="stat-mini"><b>${acc}%</b><span>Precisione</span></div>
    <div class="stat-mini"><b>${stats.streak || 0}🔥</b><span>Streak</span></div>
  `;
}

// ===== QUIZ =====
let modalitaEsperto = true, currentMode = 'quiz';

function renderQuestion() {
    const item = session.current;
    if (!item) return;
    const word = item.word;
    const pool = session.lesson === 'all' ? vocaboli : vocaboli.filter(v => v.capitolo == session.lesson);
    session.domandaCorrente = creaDomandaDinamica(word, pool);
    session.answered = false;

    const ch = document.getElementById('characterDisplay');
    ch.textContent = session.domandaCorrente.stimolo;
    ch.classList.toggle('long-text', session.domandaCorrente.stimolo.length > 4);
    document.getElementById('answerInfo').textContent = session.domandaCorrente.testoDomanda;

    const cont = document.getElementById('optionsContainer');
    cont.innerHTML = '';

    const useInput = modalitaEsperto && session.domandaCorrente.tipo === 'italiano_to_hanzi';
    if (useInput) {
        const wrap = document.createElement('div');
        wrap.className = 'expert-input-wrapper';
        const inp = document.createElement('input');
        inp.id = 'expertInput';
        inp.className = 'expert-input';
        inp.placeholder = 'Scrivi i caratteri...';
        inp.autocomplete = 'off';
        const btn = document.createElement('button');
        btn.id = 'expertVerifyBtn';
        btn.className = 'next-btn';
        btn.textContent = 'Verifica';
        const send = () => {
            const t = inp.value.trim();
            if (!t || session.answered) return;
            checkAnswer(t, btn, true);
        };
        btn.addEventListener('click', send);
        inp.addEventListener('keypress', e => {
            if (e.key === 'Enter') send();
        });
        wrap.append(inp, btn);
        cont.appendChild(wrap);
        setTimeout(() => inp.focus(), 100);
    } else {
        session.domandaCorrente.opzioni.forEach(opt => {
            const b = document.createElement('button');
            b.className = 'option-btn';
            b.textContent = opt;
            b.addEventListener('click', () => checkAnswer(opt, b, false));
            cont.appendChild(b);
        });
    }

    const msg = document.getElementById('message');
    msg.textContent = '';
    msg.className = 'message';
    document.getElementById('nextButton').classList.add('hidden');
    updateQuizProgress();
}

function buildFeedback(ok, word, tipo, chosen) {
    if (ok) return {title: 'Corretto', detail: `${word.hanzi} — ${word.pinyin} significa "${word.italiano}"`};
    if (tipo === 'hanzi_to_pinyin') return {
        title: 'Sbagliato',
        detail: `Hai scelto "${chosen}" ma ${word.hanzi} si legge "${word.pinyin}"`
    };
    if (tipo === 'hanzi_to_italiano') return {
        title: 'Sbagliato',
        detail: `"${word.hanzi}" significa "${word.italiano}", non "${chosen}"`
    };
    return {title: 'Sbagliato', detail: `"${word.italiano}" si scrive ${word.hanzi} (${word.pinyin}), non ${chosen}`};
}

function checkAnswer(selected, triggerEl, isManual = false) {
    if (session.answered) return;
    session.answered = true;
    const item = session.current;
    const word = item.word;
    const tipo = session.domandaCorrente.tipo;
    const correct = session.domandaCorrente.rispostaCorretta;
    const isCorrect = isManual ? selected === word.hanzi : selected === correct;

    document.querySelectorAll('.option-btn').forEach(b => b.disabled = true);
    document.getElementById('expertInput')?.setAttribute('disabled', 'true');
    document.getElementById('expertVerifyBtn')?.remove();

    const fb = buildFeedback(isCorrect, word, tipo, selected);
    const msg = document.getElementById('message');
    msg.className = isCorrect ? 'message correct' : 'message wrong';
    msg.innerHTML = `${fb.title}<span class="feedback-detail">${fb.detail}</span>`;

    if (!isManual) {
        if (isCorrect) triggerEl.classList.add('correct');
        else {
            triggerEl.classList.add('wrong');
            document.querySelectorAll('.option-btn').forEach(b => {
                if (b.textContent === correct) b.classList.add('correct');
            });
        }
    } else {
        const w = document.querySelector('.expert-input-wrapper');
        if (w) {
            w.classList.add(isCorrect ? 'correct' : 'wrong');
            if (!isCorrect) msg.innerHTML = `Sbagliato<span class="feedback-detail">Era: ${word.hanzi} — ${word.pinyin}</span>`;
        }
    }

    if (isCorrect) {
        item.priority = Math.max(0, item.priority - DEC);
        session.score++;
        aggiornaParola(word.id, true);
    } else {
        item.priority += INC;
        item.wrong = true;
        session.mistakes.push({word, tipo, chosen: selected, correct});
        aggiornaParola(word.id, false);
    }

    updateMeta(word.id, isCorrect);
    updateStatsOnAnswer(isCorrect);
    document.getElementById('characterDisplay').textContent = word.hanzi;
    document.getElementById('characterDisplay').classList.remove('long-text');
    document.getElementById('answerInfo').textContent = `${word.pinyin} — ${word.italiano}`;
    pronunciaCinese(word.hanzi);
    updateQuizScore();

    const nb = document.getElementById('nextButton');
    nb.classList.remove('hidden');
    nb.textContent = session.askedCount >= session.total ? 'Fine' : 'Prossima';
}

function nextQuestion() {
    if (session.askedCount >= session.total) {
        endQuiz();
        return;
    }
    getNextQuestion();
    renderQuestion();
}

function updateQuizProgress() {
    document.getElementById('progress').textContent = `${session.askedCount} di ${session.total}`;
    const bar = document.getElementById('quizProgressBar');
    if (bar) bar.style.width = `${Math.round(session.askedCount / session.total * 100)}%`;
}

function updateQuizScore() {
    document.getElementById('scoreDisplay').textContent = `Punteggio: ${session.score} / ${session.total}`;
}

function extractUniqueWords(mistakes) {
    const m = new Map();
    mistakes.forEach(e => {
        const w = e.word || e;
        m.set(w.id, w);
    });
    return [...m.values()];
}

function getHardestWords(n = 5) {
    const meta = initMeta();
    const arr = vocaboli.map(v => {
        const mm = meta[v.id];
        if (!mm) return null;
        return {word: v, wrong: mm.wrong || 0, seen: mm.seen || 0, ratio: mm.seen ? mm.wrong / mm.seen : 0};
    }).filter(Boolean);
    arr.sort((a, b) => b.wrong !== a.wrong ? b.wrong - a.wrong : b.ratio - a.ratio);
    return arr.slice(0, n);
}

function endQuiz() {
    updateStreakOnSession();
    showScreen('end');
    const total = session.total || 1;
    const perc = Math.round(session.score / total * 100);
    const emoji = document.getElementById('endEmoji');
    const title = document.getElementById('endTitle');

    if (perc >= 90) {
        emoji.textContent = '🏆';
        title.textContent = 'Incredibile!';
    } else if (perc >= 70) {
        emoji.textContent = '🎉';
        title.textContent = 'Ottimo lavoro!';
    } else if (perc >= 50) {
        emoji.textContent = '💪';
        title.textContent = 'Continua così';
    } else {
        emoji.textContent = '🌱';
        title.textContent = 'Si cresce sbagliando';
    }

    document.getElementById('endMessage').textContent = `${session.score} su ${total} corrette (${perc}%). ${perc >= 80 ? 'Sei pronta per l\'esame su questo capitolo!' : 'Ripassa i punti deboli e tornerà tutto.'}`;

    const mistakes = session.mistakes;
    const sumEl = document.getElementById('errorSummary');
    sumEl.innerHTML = '';

    if (mistakes.length === 0) {
        sumEl.innerHTML = `<div class="error-summary"><h4>Perfetto — zero errori</h4><p>Il motore abbasserà la priorità di queste parole. Tornano tra qualche giorno.</p></div>`;
    } else {
        const counts = {hanzi_to_pinyin: 0, hanzi_to_italiano: 0, italiano_to_hanzi: 0};
        mistakes.forEach(e => {
            if (counts[e.tipo] !== undefined) counts[e.tipo]++;
        });
        const labels = {hanzi_to_pinyin: 'pinyin', hanzi_to_italiano: 'significato', italiano_to_hanzi: 'caratteri'};
        const cls = {hanzi_to_pinyin: 'pinyin', hanzi_to_italiano: 'meaning', italiano_to_hanzi: 'hanzi'};
        const chips = Object.entries(counts).filter(([, c]) => c > 0).map(([k, c]) => `<span class="error-chip ${cls[k]}">${labels[k]}: ${c}</span>`).join('');
        const dom = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
        const insight = dom[1] >= 2 ? `Punto debole: <b>${labels[dom[0]]}</b>. Ti preparo un focus mirato.` : `Errori ben distribuiti. Ripassiamo le più difficili.`;
        sumEl.innerHTML = `<div class="error-summary"><h4>Analisi errori</h4><div class="error-chips">${chips}</div><p>${insight}</p></div>`;
    }

    const hardest = getHardestWords(5);
    const hardEl = document.getElementById('hardestPreview');
    if (hardest.length) {
        hardEl.innerHTML = `<div class="hardest-card"><h4>Parole più ostinate</h4>${hardest.map(h => `<div class="hardest-item"><div><b>${h.word.hanzi}</b> <span>${h.word.pinyin} — ${h.word.italiano}</span></div><em>${h.wrong} errori</em></div>`).join('')}<p style="font-size:.8rem;color:#a0aec0;margin-top:8px;font-weight:600">Basato su tutti i tuoi quiz, non solo questo.</p></div>`;
    } else hardEl.innerHTML = '';

    const stats = ottieniStatisticheCapitolo(session.lesson);
    renderDashboard(stats);

    const st = initStats();
    document.getElementById('fullStats').innerHTML = `<div class="dash-card"><h3>Il tuo percorso</h3><div class="stats-grid"><div class="stats-box"><b>${st.sessions}</b><span>Sessioni</span></div><div class="stats-box"><b>${getAccuracy()}%</b><span>Precisione</span></div><div class="stats-box"><b>${st.streak || 0}🔥</b><span>Streak</span></div><div class="stats-box"><b>${st.bestStreak || 0}</b><span>Best</span></div></div></div>`;

    const retry = document.getElementById('retryMistakes');
    const oldF = document.getElementById('focusedRetryBtn');
    if (oldF) oldF.remove();

    if (mistakes.length > 0) {
        const uniq = extractUniqueWords(mistakes);
        retry.classList.remove('hidden');
        retry.textContent = `Ripeti errori (${uniq.length})`;
        const counts = {hanzi_to_pinyin: 0, hanzi_to_italiano: 0, italiano_to_hanzi: 0};
        mistakes.forEach(e => counts[e.tipo]++);
        const dom = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
        if (dom[1] >= 2) {
            const labels = {
                hanzi_to_pinyin: 'pinyin',
                hanzi_to_italiano: 'significato',
                italiano_to_hanzi: 'caratteri'
            };
            const fb = document.createElement('button');
            fb.id = 'focusedRetryBtn';
            fb.className = 'outline-btn focused-btn';
            const filt = extractUniqueWords(mistakes.filter(e => e.tipo === dom[0])).slice(0, 5);
            fb.textContent = `Focus ${labels[dom[0]]} (${filt.length})`;
            fb.addEventListener('click', () => startQuiz(session.lesson, filt));
            retry.parentNode.insertBefore(fb, retry);
        }
    } else {
        retry.classList.add('hidden');
    }
}

function startQuiz(lesson, wordsOverride = null) {
    const parole = wordsOverride || getParolePerCapitolo(lesson);
    if (!parole.length) return;
    initSession(parole, lesson);
    updateQuizScore();
    showScreen('quiz');
    nextQuestion();
}

function startSmartReview() {
    const words = getSmartReviewWords();
    if (!words.length) {
        alert('Niente da ripassare, sei avanti!');
        return;
    }
    initSession(words, 'smart');
    updateQuizScore();
    showScreen('quiz');
    nextQuestion();
}

// ===== STUDIO =====
let studioState = {attivo: false, parole: [], indice: 0, fronte: true, completato: false};

function iniziaStudio(capitolo, paroleOverride = null) {
    let paroleCapitolo;
    if (paroleOverride) {
        paroleCapitolo = paroleOverride;
    } else if (capitolo === 'libro1') {
        paroleCapitolo = vocaboli.filter(v => v.capitolo >= 1 && v.capitolo <= 21);
    } else if (capitolo === 'libro2') {
        paroleCapitolo = vocaboli.filter(v => v.capitolo >= 22 && v.capitolo <= 35);
    } else {
        paroleCapitolo = (capitolo === 'all') ? [...vocaboli] : vocaboli.filter(v => v.capitolo == capitolo);
    }

    if (paroleCapitolo.length === 0) return;
    const stato = initLeitnerState();
    paroleCapitolo.sort((a, b) => (stato[a.id] || 1) - (stato[b.id] || 1));
    studioState = {attivo: true, parole: paroleCapitolo, indice: 0, fronte: true, completato: false};
    renderStudio();
    showScreen('studio');
}

function renderStudio() {
    if (!studioState.attivo || studioState.completato) {
        showScreen('lesson');
        return;
    }
    const p = studioState.parole[studioState.indice];
    document.getElementById('studioHanzi').textContent = p.hanzi;
    document.getElementById('studioPinyin').textContent = p.pinyin;
    document.getElementById('studioItaliano').textContent = p.italiano;
    document.getElementById('studioProgress').textContent = `${studioState.indice + 1} di ${studioState.parole.length}`;

    const retro = document.getElementById('studioRetro'), btns = document.getElementById('studioButtons');
    if (studioState.fronte) {
        document.getElementById('studioHanzi').style.display = 'block';
        retro.style.display = 'none';
        btns.classList.add('hidden');
    } else {
        document.getElementById('studioHanzi').style.display = 'none';
        retro.style.display = 'block';
        btns.classList.remove('hidden');
    }
}

function giraFlashcard() {
    if (!studioState.attivo || !studioState.fronte) return;
    studioState.fronte = false;
    pronunciaCinese(studioState.parole[studioState.indice].hanzi);
    renderStudio();
}

function rispondiStudio(ok) {
    if (!studioState.attivo || !studioState.fronte) return;
    const parola = studioState.parole[studioState.indice];
    aggiornaParola(parola.id, ok);
    updateMeta(parola.id, ok);
    updateStatsOnAnswer(ok);
    studioState.indice++;
    if (studioState.indice >= studioState.parole.length) {
        studioState.completato = true;
        studioState.attivo = false;
        updateStreakOnSession();
        showScreen('lesson');
    } else {
        studioState.fronte = true;
        renderStudio();
    }
}

// ===== DASHBOARD =====
function ottieniStatisticheCapitolo(cap) {
    const st = initLeitnerState();
    let list = (cap === 'all' || cap === 'smart') ? [...vocaboli] : vocaboli.filter(v => v.capitolo == cap);
    const tot = list.length;
    const cnt = {1: 0, 2: 0, 3: 0, 4: 0, 5: 0};
    list.forEach(p => {
        cnt[st[p.id] || 1]++;
    });
    const livelli = [1, 2, 3, 4, 5].map(l => ({
        livello: l, conteggio: cnt[l], percentuale: tot ? Math.round(cnt[l] / tot * 100) : 0
    }));
    return {totale: tot, livelli, conteggi: cnt};
}

function getLevelColor(l) {
    switch (l) {
        case 1:
            return '#ff3b30';
        case 2:
            return '#ff9500';
        case 3:
            return '#ffcc00';
        case 4:
            return '#34c759';
        case 5:
            return '#007aff';
        default:
            return '#8e8e93';
    }
}

function renderDashboard(stats) {
    const c = document.getElementById('dashboardContainer');
    c.innerHTML = '<div class="dash-card"><h3>Livelli di memoria</h3><div id="bars"></div></div>';
    const bars = c.querySelector('#bars');
    const max = Math.max(...stats.livelli.map(x => x.conteggio), 1);
    stats.livelli.forEach(it => {
        const w = document.createElement('div');
        w.className = 'bar-wrapper';
        w.innerHTML = `<span class="bar-label">Liv ${it.livello}</span><div class="bar-outer"><div class="bar-inner" style="width:${it.conteggio / max * 100}%; background:${getLevelColor(it.livello)};"></div></div><span class="bar-count">${it.conteggio} (${it.percentuale}%)</span>`;
        bars.appendChild(w);
    });
}

// ===== GENERATORE LIBRI =====
function generaLibriConPaginazione() {
    const container = document.getElementById('booksContainer');
    if (!container) return;

    const libri = [
        {id: 1, nome: '📘 Libro 1', min: 1, max: 21, classe: 'book-1'},
        {id: 2, nome: '📙 Libro 2', min: 22, max: 35, classe: 'book-2'}
    ];

    container.innerHTML = '';

    libri.forEach(libro => {
        const capitoliDisponibili = [];
        for (let i = libro.min; i <= libro.max; i++) {
            if (wordsByLesson[i] && wordsByLesson[i].length > 0) capitoliDisponibili.push(i);
        }
        if (capitoliDisponibili.length === 0) return;

        const totaleVocaboli = capitoliDisponibili.reduce((sum, cap) => sum + (wordsByLesson[cap]?.length || 0), 0);

        const section = document.createElement('div');
        section.className = `book-section ${libro.classe}`;

        const header = document.createElement('div');
        header.className = 'book-header';
        header.innerHTML = `
      <div class="book-header-left">
        <h3>${libro.nome}</h3>
        <span class="book-badge">${capitoliDisponibili.length} cap. • ${totaleVocaboli} vocaboli</span>
      </div>
      <div class="book-toggle">▼</div>
    `;

        const content = document.createElement('div');
        content.className = 'book-content';

        const paginationWrapper = document.createElement('div');
        paginationWrapper.className = 'pagination-wrapper';

        const track = document.createElement('div');
        track.className = 'pagination-track';

        const CAPITOLI_PER_PAGINA = window.innerWidth >= 768 ? 12 : 9;
        const numPagine = Math.ceil(capitoliDisponibili.length / CAPITOLI_PER_PAGINA);

        for (let pagina = 0; pagina < numPagine; pagina++) {
            const pageDiv = document.createElement('div');
            pageDiv.className = 'pagination-page';
            const startIdx = pagina * CAPITOLI_PER_PAGINA;
            const endIdx = Math.min(startIdx + CAPITOLI_PER_PAGINA, capitoliDisponibili.length);
            const capitoliPagina = capitoliDisponibili.slice(startIdx, endIdx);

            capitoliPagina.forEach(cap => {
                const btn = document.createElement('button');
                btn.className = 'lesson-btn';
                btn.dataset.lesson = cap;
                const numVocaboli = wordsByLesson[cap]?.length || 0;
                btn.innerHTML = `<span>${cap}</span><small>Capitolo</small><em id="prog-${cap}">${numVocaboli} par.</em>`;
                pageDiv.appendChild(btn);
            });
            track.appendChild(pageDiv);
        }

        paginationWrapper.appendChild(track);

        const allBtn = document.createElement('button');
        allBtn.className = 'lesson-btn all all-books-btn';
        allBtn.dataset.lesson = libro.id === 1 ? 'libro1' : 'libro2';
        allBtn.innerHTML = `<span>📚</span><small>Tutto ${libro.nome.replace(/[^\w\s]/g, '').trim()}</small><em>${totaleVocaboli} parole</em>`;

        content.appendChild(paginationWrapper);
        content.appendChild(allBtn);

        if (numPagine > 1) {
            const controls = document.createElement('div');
            controls.className = 'pagination-controls';

            const prevBtn = document.createElement('button');
            prevBtn.className = 'page-btn prev-btn';
            prevBtn.innerHTML = `<svg viewBox="0 0 24 24"><polyline points="15 18 9 12 15 6"></polyline></svg>`;
            prevBtn.disabled = true;

            const dots = document.createElement('div');
            dots.className = 'page-dots';
            for (let i = 0; i < numPagine; i++) {
                const dot = document.createElement('div');
                dot.className = 'page-dot' + (i === 0 ? ' active' : '');
                dots.appendChild(dot);
            }

            const nextBtn = document.createElement('button');
            nextBtn.className = 'page-btn next-btn';
            nextBtn.innerHTML = `<svg viewBox="0 0 24 24"><polyline points="9 18 15 12 9 6"></polyline></svg>`;
            nextBtn.disabled = numPagine === 1;

            controls.appendChild(prevBtn);
            controls.appendChild(dots);
            controls.appendChild(nextBtn);
            content.appendChild(controls);

            let currentPage = 0;

            function updatePagination() {
                track.style.transform = `translateX(-${currentPage * 100}%)`;
                prevBtn.disabled = currentPage === 0;
                nextBtn.disabled = currentPage === numPagine - 1;
                const allDots = dots.querySelectorAll('.page-dot');
                allDots.forEach((dot, idx) => dot.classList.toggle('active', idx === currentPage));
            }

            prevBtn.addEventListener('click', () => {
                if (currentPage > 0) {
                    currentPage--;
                    updatePagination();
                }
            });
            nextBtn.addEventListener('click', () => {
                if (currentPage < numPagine - 1) {
                    currentPage++;
                    updatePagination();
                }
            });
            dots.querySelectorAll('.page-dot').forEach((dot, idx) => {
                dot.addEventListener('click', () => {
                    currentPage = idx;
                    updatePagination();
                });
            });
        }

        header.addEventListener('click', () => {
            header.classList.toggle('collapsed');
            content.classList.toggle('collapsed');
        });

        section.appendChild(header);
        section.appendChild(content);
        container.appendChild(section);
    });

    const generalAllBtn = document.createElement('button');
    generalAllBtn.className = 'lesson-btn all';
    generalAllBtn.dataset.lesson = 'all';
    generalAllBtn.innerHTML = `<span>📚</span><small>Tutti i vocaboli</small><em id="allCount">${vocaboli.length} parole</em>`;
    container.appendChild(generalAllBtn);

    attachLessonButtonListeners();
}

function attachLessonButtonListeners() {
    document.querySelectorAll('.lesson-btn').forEach(btn => {
        const newBtn = btn.cloneNode(true);
        btn.parentNode.replaceChild(newBtn, btn);
        newBtn.addEventListener('click', () => {
            const lesson = newBtn.dataset.lesson;
            if (lesson === 'libro1') {
                const paroleLibro1 = vocaboli.filter(v => v.capitolo >= 1 && v.capitolo <= 21);
                if (currentMode === 'quiz') startQuiz('all', paroleLibro1);
                else iniziaStudio('libro1', paroleLibro1);
                return;
            }
            if (lesson === 'libro2') {
                const paroleLibro2 = vocaboli.filter(v => v.capitolo >= 22 && v.capitolo <= 35);
                if (currentMode === 'quiz') startQuiz('all', paroleLibro2);
                else iniziaStudio('libro2', paroleLibro2);
                return;
            }
            if (currentMode === 'quiz') startQuiz(lesson);
            else iniziaStudio(lesson);
        });
    });
}

// ===== PROFILO UTENTE =====
function setupUserProfile() {
    const profileToggle = document.getElementById('profileToggle');
    const profileContent = document.getElementById('profileContent');
    const userCodeDisplay = document.getElementById('userCodeDisplay');
    const copyCodeBtn = document.getElementById('copyCodeBtn');
    const restoreBtn = document.getElementById('restoreBtn');
    const restoreInput = document.getElementById('restoreCodeInput');

    if (!profileToggle) return;

    const userCode = getUserCode();
    if (userCodeDisplay) userCodeDisplay.textContent = userCode;

    profileToggle.addEventListener('click', () => {
        const isHidden = profileContent.style.display === 'none';
        profileContent.style.display = isHidden ? 'block' : 'none';
        profileToggle.classList.toggle('collapsed', !isHidden);
    });

    if (copyCodeBtn) {
        copyCodeBtn.addEventListener('click', async () => {
            try {
                await navigator.clipboard.writeText(userCode);
                copyCodeBtn.textContent = '✓ Copiato!';
                setTimeout(() => {
                    copyCodeBtn.textContent = '📋 Copia';
                }, 2000);
            } catch (err) {
                alert('Codice: ' + userCode);
            }
        });
    }

    if (restoreBtn) {
        restoreBtn.addEventListener('click', async () => {
            const code = restoreInput.value.trim().toUpperCase();
            if (!code) {
                alert('Inserisci un codice valido');
                return;
            }

            restoreBtn.disabled = true;
            restoreBtn.textContent = 'Caricamento...';

            try {
                const leitner = await loadFromCode(code, 'leitner');
                const meta = await loadFromCode(code, 'meta');
                const stats = await loadFromCode(code, 'stats');

                if (leitner || meta || stats) {
                    if (leitner) localStorage.setItem(LEITNER_KEY, JSON.stringify(leitner));
                    if (meta) localStorage.setItem(META_KEY, JSON.stringify(meta));
                    if (stats) localStorage.setItem(STATS_KEY, JSON.stringify(stats));
                    localStorage.setItem(USER_CODE_KEY, code);
                    currentUserCode = code;
                    leitnerCache = null;
                    metaCache = null;
                    statsCache = null;

                    const msg = document.createElement('div');
                    msg.className = 'restore-message success';
                    msg.textContent = '✓ Progressi ripristinati! Ricarico...';
                    restoreBtn.parentNode.appendChild(msg);
                    setTimeout(() => location.reload(), 1500);
                } else {
                    throw new Error('Nessun dato');
                }
            } catch (err) {
                const msg = document.createElement('div');
                msg.className = 'restore-message error';
                msg.textContent = '✗ Codice non valido';
                restoreBtn.parentNode.appendChild(msg);
                setTimeout(() => msg.remove(), 3000);
            } finally {
                restoreBtn.disabled = false;
                restoreBtn.textContent = 'Ripristina progressi';
            }
        });
    }
}

// ===== CARICAMENTO DATI FIREBASE =====
async function loadUserData() {
    if (!window.db) {
        console.log('ℹ️ Firebase non disponibile, uso localStorage');
        return;
    }
    try {
        const leitner = await loadFromFirebase('leitner');
        const meta = await loadFromFirebase('meta');
        const stats = await loadFromFirebase('stats');

        if (leitner) {
            localStorage.setItem(LEITNER_KEY, JSON.stringify(leitner));
            leitnerCache = null;
        }
        if (meta) {
            localStorage.setItem(META_KEY, JSON.stringify(meta));
            metaCache = null;
        }
        if (stats) {
            localStorage.setItem(STATS_KEY, JSON.stringify(stats));
            statsCache = null;
        }
        console.log('✅ Dati caricati da Firebase');
    } catch (err) {
        console.warn('⚠️ Errore Firebase:', err.message);
    }
}


// ==================== SISTEMA SEGNALAZIONE ====================
// ===== SISTEMA SEGNALAZIONE =====
function setupReportSystem() {
    const fab = document.getElementById('reportFab');
    const modal = document.getElementById('reportModal');
    const closeBtn = document.getElementById('reportClose');
    const form = document.getElementById('reportForm');
    const textarea = document.getElementById('reportMessage');
    const charCount = document.getElementById('charCount');
    const successMsg = document.getElementById('reportSuccess');

    if (!fab || !modal) return;

    // Apri modale
    fab.addEventListener('click', () => {
        modal.classList.add('active');
        document.body.style.overflow = 'hidden';
    });

    // Chiudi modale
    const closeModal = () => {
        modal.classList.remove('active');
        document.body.style.overflow = '';
    };

    closeBtn.addEventListener('click', closeModal);

    // Chiudi cliccando fuori
    modal.addEventListener('click', (e) => {
        if (e.target === modal) closeModal();
    });

    // Chiudi con ESC
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && modal.classList.contains('active')) closeModal();
    });

    // Contatore caratteri
    textarea.addEventListener('input', () => {
        charCount.textContent = textarea.value.length;
    });

    // Invio form
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const submitBtn = form.querySelector('.report-submit');
        submitBtn.disabled = true;
        submitBtn.textContent = 'Invio...';

        const report = {
            type: document.getElementById('reportType').value,
            message: textarea.value.trim(),
            email: document.getElementById('reportEmail').value.trim() || null,
            userCode: typeof getUserCode === 'function' ? getUserCode() : 'anonymous',
            screen: document.querySelector('.screen.active')?.id || 'unknown',
            timestamp: Date.now(),
            date: new Date().toISOString(),
            url: window.location.href
        };

        try {
            if (window.db) {
                await window.db.ref('reports').push(report);
            }
            form.style.display = 'none';
            successMsg.style.display = 'block';

            setTimeout(() => {
                form.reset();
                charCount.textContent = '0';
                form.style.display = 'flex';
                successMsg.style.display = 'none';
                submitBtn.disabled = false;
                submitBtn.textContent = 'Invia segnalazione';
                closeModal();
            }, 2500);
        } catch (err) {
            console.error('Errore invio:', err);
            alert('Errore invio. Riprova.');
            submitBtn.disabled = false;
            submitBtn.textContent = 'Invia segnalazione';
        }
    });
}

// ===== INIT =====
document.getElementById('modeQuizBtn').addEventListener('click', function () {
    currentMode = 'quiz';
    this.classList.add('active-mode');
    document.getElementById('modeStudioBtn').classList.remove('active-mode');
});

document.getElementById('modeStudioBtn').addEventListener('click', function () {
    currentMode = 'studio';
    this.classList.add('active-mode');
    document.getElementById('modeQuizBtn').classList.remove('active-mode');
});

document.getElementById('expertCheckbox').addEventListener('change', function () {
    modalitaEsperto = this.checked;
});

generaLibriConPaginazione();
setupUserProfile();
setupReportSystem();

document.getElementById('nextButton').addEventListener('click', nextQuestion);
document.getElementById('studioCard').addEventListener('click', giraFlashcard);
document.getElementById('studioKnowBtn').addEventListener('click', () => rispondiStudio(true));
document.getElementById('studioDontKnowBtn').addEventListener('click', () => rispondiStudio(false));
document.getElementById('retryMistakes').addEventListener('click', () => startQuiz(session.lesson, session.mistakes));
// Bottone "Scegli capitolo" nella schermata finale
document.getElementById('changeLesson').addEventListener('click', () => {
    showScreen('lesson');
});

// Bottone "✕ Esci" nella schermata quiz
document.getElementById('exitQuiz').addEventListener('click', () => {
    showScreen('lesson');
});
// Bottone "✕ Esci" nella schermata studio
document.getElementById('exitStudio').addEventListener('click', () => {
    showScreen('lesson');
});
document.getElementById('smartBtn').addEventListener('click', startSmartReview);

// AVVIO
loadUserData().then(() => {
    initLeitnerState();
    initMeta();
    showScreen('lesson');
});
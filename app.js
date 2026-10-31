// =================================================================================
// app.js — Logika Utama Frontend
// =================================================================================

const GAS_API_URL = "https://script.google.com/macros/s/AKfycbw9OuINRFF7myho9hwc66cCP2Z5xINDoSVEI123PKsQH817YjQslAW7yv1WmQ5RWg0q/exec"; 

let AUTH_TOKEN = localStorage.getItem("reader_token") || "";
let CURRENT_BOOK = null;
let CURRENT_CHAPTER = 0;
let CHAPTER_LIST = [];
let PLAY_QUEUE = [];
let CURRENT_IDX = 0;
let CURRENT_SELECTED_SEQ = -1;
let isPlaying = false;
let audioCtx = null;
let currentSource = null;
let CURRENT_EDIT_SEQ = 0;

const ttsWorker = new Worker('tts.worker.js'); 
const playBtn = document.getElementById('playBtn');
if (playBtn) playBtn.innerText = "⏳ Menyiapkan...";

ttsWorker.onmessage = function (e) {
    if (e.data.type === 'progress') {
        if (e.data.phase === 'init') {
            if (playBtn) playBtn.innerText = "⚙️ Memuat Model...";
            console.log("[Worker] Menginisialisasi Model...");
        } else {
            const percent = Math.round((e.data.loaded / e.data.total) * 100);
            if (playBtn) playBtn.innerText = `⏳ Unduh Model: ${percent}%`;
        }
    } 
    else if (e.data.type === 'ready') {
        console.log("✅ Mesin TTS Siap!");
        if (playBtn) {
            playBtn.disabled = false;
            playBtn.innerText = "▶ Play";
        }
    } 
    else if (e.data.type === 'result') {
        playAudioBuffer(e.data.audio, e.data.sampleRate);
    } 
    else if (e.data.type === 'error') {
        console.error("❌ Error TTS:", e.data.error);
        if (playBtn) {
            playBtn.innerText = "❌ Gagal";
            playBtn.disabled = false;
        }
        isPlaying = false;
    }
};

const MODEL_BASE_URL = './models/vits-piper-id_ID-news_tts-medium-fp16/';
ttsWorker.postMessage({ type: 'init', modelBaseUrl: MODEL_BASE_URL });

// ══ UTILITY & UI ══
function showToast(msg) {
    const el = document.getElementById('toast');
    if (!el) return;
    el.textContent = msg; el.style.display = 'block';
    setTimeout(() => el.style.display = 'none', 3000);
}
function showLoading(show) { document.getElementById('loadingOverlay').style.display = show ? 'flex' : 'none'; }
function closeModal(id) { document.getElementById(id).classList.remove('active'); }
function showConfirm(title, msg, cb) {
    document.getElementById('confirmTitle').textContent = title;
    document.getElementById('confirmMessage').textContent = msg;
    document.getElementById('customConfirmOverlay').style.display = 'flex';
    document.getElementById('confirmBtnYes').onclick = () => { document.getElementById('customConfirmOverlay').style.display = 'none'; cb(); };
    document.getElementById('confirmBtnCancel').onclick = () => { document.getElementById('customConfirmOverlay').style.display = 'none'; };
}
function updateSpeedLabel() { document.getElementById('speedLabel').textContent = parseFloat(document.getElementById('speedSlider').value).toFixed(1) + '×'; }
function updatePitchLabel() { document.getElementById('pitchLabel').textContent = parseFloat(document.getElementById('pitchSlider').value).toFixed(1) + '×'; }

async function apiCall(action, payload = {}) {
    payload.action = action; payload.token = AUTH_TOKEN;
    const res = await fetch(GAS_API_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(payload) });
    return await res.json();
}

async function doLogin() {
    const u = document.getElementById("username").value;
    const p = document.getElementById("password").value;
    const btn = document.getElementById("loginBtn");
    btn.innerText = "⏳..."; btn.disabled = true;
    const res = await apiCall("login", { username: u, password: p });
    btn.innerText = "🔐 MASUK"; btn.disabled = false;
    if (res.ok) {
        AUTH_TOKEN = res.token;
        localStorage.setItem("reader_token", AUTH_TOKEN);
        document.getElementById("loginView").classList.remove("active");
        document.getElementById("readerView").classList.add("active");
        document.getElementById("addBtn").style.display = res.user.create ? "flex" : "none";
        loadLibrary();
    } else {
        const err = document.getElementById("loginError");
        err.textContent = "Username atau password salah."; err.classList.add("show");
    }
}

function doLogout() { localStorage.removeItem("reader_token"); location.reload(); }

async function loadLibrary() {
    if (isPlaying) stopTTS();
    document.getElementById("headerTitle").innerText = "📖 Library";
    document.getElementById("contentArea").innerHTML = '<div style="text-align:center;">Memuat buku...</div>';
    document.getElementById("ttsBar").style.display = "none";
    const res = await apiCall("getBooks");
    if (!res.ok) return showToast("Gagal load buku: " + res.error);
    let html = "";
    res.data.forEach(b => {
        html += `<div class="reader-card" onclick="openBook('${b.book_id}', '${b.book_title}')">
                    <h3>${b.book_title}</h3>
                 </div>`;
    });
    document.getElementById("contentArea").innerHTML = html;
}

async function openBook(bookId, title) {
    CURRENT_BOOK = bookId;
    document.getElementById("headerTitle").innerText = title;
    document.getElementById("contentArea").innerHTML = '<div style="text-align:center;">Memuat bab...</div>';
    const res = await apiCall("getChapters", { bookId: bookId });
    if (!res.ok) return showToast("Gagal load bab: " + res.error);
    CHAPTER_LIST = res.data;
    let html = "";
    res.data.forEach(c => {
        html += `<div class="reader-card" onclick="openChapter(${c.chapter})">
                    <h3>Bab ${c.chapter} - ${c.chapter_title}</h3>
                 </div>`;
    });
    document.getElementById("contentArea").innerHTML = html;
}

async function openChapter(chapter) {
    CURRENT_CHAPTER = chapter;
    document.getElementById("headerTitle").innerText = `Bab ${chapter}`;
    document.getElementById("contentArea").innerHTML = '<div style="text-align:center;">Memuat cerita...</div>';
    document.getElementById("ttsBar").style.display = "flex";
    
    if (isPlaying) stopTTS();
    PLAY_QUEUE = []; CURRENT_IDX = 0; CURRENT_SELECTED_SEQ = -1;
    
    const res = await apiCall("getContent", { bookId: CURRENT_BOOK, chapter: chapter });
    if (!res.ok) return showToast("Gagal load cerita: " + res.error);
    
    let html = "";
    let chunkIdx = 0;
    res.data.forEach(row => {
        const sentences = row.text.split(/(?<=[.!?…])\s+/);
        const canEdit = res.user && res.user.update ? `<button class="reader-edit-btn" onclick="openEditTagModal(event, ${row.seq})">⚙️</button>` : '';
        html += `<div class="reader-card" data-seq="${row.seq}" onclick="selectCard(${row.seq}, ${chunkIdx})">${canEdit}<div class="reader-paragraph">`;
        sentences.forEach(s => {
            html += `<span class="reader-sentence" data-idx="${chunkIdx}">${s} </span>`;
            PLAY_QUEUE.push({ text: s, gender: row.gender, lang: row.lang_tag, seq: row.seq, idx: chunkIdx });
            chunkIdx++;
        });
        html += `</div></div>`;
    });
    document.getElementById("contentArea").innerHTML = html;
}

function selectCard(seq, startIdx) {
    CURRENT_SELECTED_SEQ = seq;
    document.querySelectorAll('.reader-card').forEach(c => c.classList.remove('selected'));
    const card = document.querySelector(`.reader-card[data-seq="${seq}"]`);
    if(card) card.classList.add('selected');
    CURRENT_IDX = startIdx;
    if (isPlaying) { stopTTS(); togglePlay(); }
}

function navigateParagraph(dir) {
    if (PLAY_QUEUE.length === 0) return;
    let currentSeq = CURRENT_SELECTED_SEQ !== -1 ? CURRENT_SELECTED_SEQ : PLAY_QUEUE[CURRENT_IDX].seq;
    let uniqueSeqs = [...new Set(PLAY_QUEUE.map(p => p.seq))].sort((a,b) => a-b);
    let pos = uniqueSeqs.indexOf(currentSeq);
    let newPos = dir === 'prev' ? Math.max(0, pos - 1) : Math.min(uniqueSeqs.length - 1, pos + 1);
    let targetSeq = uniqueSeqs[newPos];
    if (targetSeq !== currentSeq || CURRENT_SELECTED_SEQ === -1) {
        let startIdx = PLAY_QUEUE.findIndex(p => p.seq === targetSeq);
        selectCard(targetSeq, startIdx);
        const el = document.querySelector(`.reader-card[data-seq="${targetSeq}"]`);
        if(el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
}

function togglePlay() {
    if (playBtn.disabled) return;
    if (isPlaying) {
        isPlaying = false;
        playBtn.innerText = "▶ Play";
        if (currentSource) { currentSource.stop(); currentSource = null; }
    } else {
        if (PLAY_QUEUE.length === 0) return showToast("Tidak ada konten.");
        isPlaying = true;
        playBtn.innerText = "⏸ Pause";
        speakNext();
    }
}

function stopTTS() {
    isPlaying = false;
    if (playBtn) playBtn.innerText = "▶ Play";
    if (currentSource) { currentSource.stop(); currentSource = null; }
    document.querySelectorAll('.reader-sentence').forEach(el => el.classList.remove('reading-active'));
    CURRENT_IDX = 0;
}

function speakNext() {
    if (!isPlaying || CURRENT_IDX >= PLAY_QUEUE.length) {
        isPlaying = false;
        if (playBtn) playBtn.innerText = "▶ Play";
        return;
    }
    const chunk = PLAY_QUEUE[CURRENT_IDX];
    const speed = parseFloat(document.getElementById("speedSlider").value);
    document.querySelectorAll('.reader-sentence').forEach(el => el.classList.remove('reading-active'));
    const span = document.querySelector(`.reader-sentence[data-idx="${chunk.idx}"]`);
    if (span) { span.classList.add('reading-active'); span.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
    ttsWorker.postMessage({ type: 'generate', text: chunk.text, speed: speed });
}

function playAudioBuffer(float32Data, sampleRate) {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const buffer = audioCtx.createBuffer(1, float32Data.length, sampleRate);
    buffer.copyToChannel(float32Data, 0);
    if (currentSource) currentSource.stop();
    currentSource = audioCtx.createBufferSource();
    currentSource.buffer = buffer;
    const pitch = parseFloat(document.getElementById("pitchSlider").value);
    currentSource.playbackRate.value = pitch; 
    currentSource.connect(audioCtx.destination);
    currentSource.onended = () => { if (isPlaying) { CURRENT_IDX++; speakNext(); } };
    currentSource.start();
}

function openEditTagModal(e, seq) {
    e.stopPropagation();
    CURRENT_EDIT_SEQ = seq;
    const chunk = PLAY_QUEUE.find(p => p.seq === seq);
    if (!chunk) return;
    document.getElementById('editWhoTag').value = 'NARRATOR';
    document.getElementById('editGender').value = chunk.gender || 'FEMALE';
    document.getElementById('editLangTag').value = chunk.lang || 'ms';
    document.getElementById('editTagOverlay').classList.add('active');
}

async function saveTagToSheet() {
    showLoading(true);
    const res = await apiCall("updateTags", {
        bookId: CURRENT_BOOK, chapter: CURRENT_CHAPTER, seq: CURRENT_EDIT_SEQ,
        whoTag: document.getElementById('editWhoTag').value,
        gender: document.getElementById('editGender').value,
        langTag: document.getElementById('editLangTag').value
    });
    showLoading(false);
    if (res.ok) { closeModal('editTagOverlay'); showToast("✅ Tag disimpan"); openChapter(CURRENT_CHAPTER); }
    else showToast("❌ Gagal: " + res.error);
}

function deleteParagraph() {
    showConfirm("Hapus Paragraf?", "Data akan dihapus permanen.", async () => {
        showLoading(true);
        const res = await apiCall("deleteStory", { bookId: CURRENT_BOOK, chapter: CURRENT_CHAPTER, seq: CURRENT_EDIT_SEQ });
        showLoading(false);
        if (res.ok) { closeModal('editTagOverlay'); showToast("✅ Dihapus"); openChapter(CURRENT_CHAPTER); }
        else showToast("❌ Gagal: " + res.error);
    });
}

async function moveParagraph(dir) {
    showLoading(true);
    const res = await apiCall("moveStory", { bookId: CURRENT_BOOK, chapter: CURRENT_CHAPTER, seq: CURRENT_EDIT_SEQ, direction: dir });
    showLoading(false);
    if (res.ok) { closeModal('editTagOverlay'); showToast("✅ Dipindahkan"); openChapter(CURRENT_CHAPTER); }
    else showToast("⚠️ " + res.error);
}

function openAddParagraphModal() {
    document.getElementById('addBookId').value = CURRENT_BOOK || "";
    document.getElementById('addChapterNum').value = CURRENT_CHAPTER || 1;
    document.getElementById('addText').value = "";
    document.getElementById('addParagraphOverlay').classList.add('active');
}

async function saveNewParagraph() {
    const data = {
        book_id: document.getElementById('addBookId').value,
        book_title: "Judul Buku",
        chapter: parseInt(document.getElementById('addChapterNum').value),
        chapter_title: "Bab " + document.getElementById('addChapterNum').value,
        who_tag: document.getElementById('addWhoTag').value,
        gender: document.getElementById('addGender').value,
        lang_tag: document.getElementById('addLangTag').value,
        text: document.getElementById('addText').value
    };
    if (!data.text || !data.book_id) return showToast("Teks dan ID wajib diisi.");
    showLoading(true);
    const res = await apiCall("createStory", { data });
    showLoading(false);
    if (res.ok) { closeModal('addParagraphOverlay'); showToast("✅ Ditambahkan"); openChapter(data.chapter); }
    else showToast("❌ Gagal: " + res.error);
}

window.onload = () => {
    if (AUTH_TOKEN) {
        apiCall("getSession").then(res => {
            if (res.ok) {
                document.getElementById("loginView").classList.remove("active");
                document.getElementById("readerView").classList.add("active");
                document.getElementById("addBtn").style.display = res.user.create ? "flex" : "none";
                loadLibrary();
            } else { localStorage.removeItem("reader_token"); }
        });
    }
};
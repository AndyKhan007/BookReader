// =================================================================================
// app.js — Logika Utama Frontend (Fetch API & Pemutar Audio)
// =================================================================================

// ⚠️ GANTI DENGAN URL WEB APP APPS SCRIPT ANDA
const GAS_API_URL = "https://script.google.com/macros/s/AKfycbw9OuINRFF7myho9hwc66cCP2Z5xINDoSVEI123PKsQH817YjQslAW7yv1WmQ5RWg0q/exec";

let AUTH_TOKEN = localStorage.getItem("reader_token") || "";
let CURRENT_BOOK = null;
let CURRENT_CHAPTER = 0;
let PLAY_QUEUE = [];
let CURRENT_IDX = 0;
let isPlaying = false;
let audioCtx = null;
let currentSource = null;

// =================================================================================
// 1. INISIALISASI WORKER TTS
// =================================================================================
const ttsWorker = new Worker('tts.worker.js', { type: 'module' });

ttsWorker.onmessage = function (e) {
    if (e.data.type === 'ready') {
        console.log("✅ Mesin TTS Sherpa-onnx Siap!");
        document.getElementById('playBtn').disabled = false;
    } else if (e.data.type === 'result') {
        playAudioBuffer(e.data.audio, e.data.sampleRate);
    } else if (e.data.type === 'error') {
        console.error("❌ Error TTS:", e.data.error);
        alert("Gagal memproses suara: " + (e.data.error || "Tidak diketahui"));
        isPlaying = false;
        document.getElementById('playBtn').innerText = "▶ Play";
    }
};

// Path Model (Sudah disesuaikan dengan folder models Anda)
const MODEL_BASE_URL = './models/vits-piper-id_ID-news_tts-medium-fp16/';

// Kirim perintah inisialisasi ke Worker
ttsWorker.postMessage({
    type: 'init',
    modelBaseUrl: MODEL_BASE_URL
});

document.getElementById('playBtn').disabled = true;

// =================================================================================
// 2. FUNGSI FETCH API
// =================================================================================
async function apiCall(action, payload = {}) {
    payload.action = action;
    payload.token = AUTH_TOKEN;
    
    const res = await fetch(GAS_API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(payload)
    });
    return await res.json();
}

// =================================================================================
// 3. LOGIKA AUTHENTICATION & UI
// =================================================================================
async function doLogin() {
    const u = document.getElementById("username").value;
    const p = document.getElementById("password").value;
    const res = await apiCall("login", { username: u, password: p });
    
    if (res.ok) {
        AUTH_TOKEN = res.token;
        localStorage.setItem("reader_token", AUTH_TOKEN);
        document.getElementById("loginView").classList.remove("active");
        document.getElementById("readerView").classList.add("active");
        loadLibrary();
    } else {
        alert("Login Gagal: " + (res.error || "Username/Password salah"));
    }
}

function doLogout() {
    localStorage.removeItem("reader_token");
    location.reload();
}

async function loadLibrary() {
    const res = await apiCall("getBooks");
    if (!res.ok) return alert("Gagal load books: " + (res.error || "Unknown"));
    
    let html = "";
    // Data sekarang diambil dari res.data
    res.data.forEach(b => {
        html += `<div class="reader-card" onclick="openBook('${b.book_id}', '${b.book_title}')">
                    <h3>${b.book_title}</h3>
                 </div>`;
    });
    document.getElementById("contentArea").innerHTML = html;
    document.getElementById("headerTitle").innerText = "Library";
}

async function openBook(bookId, title) {
    CURRENT_BOOK = bookId;
    const res = await apiCall("getChapters", { bookId: bookId });
    if (!res.ok) return alert("Gagal load chapters: " + (res.error || "Unknown"));
    
    let html = "";
    res.data.forEach(c => {
        html += `<div class="reader-card" onclick="openChapter(${c.chapter})">
                    <h3>Bab ${c.chapter} - ${c.chapter_title}</h3>
                 </div>`;
    });
    document.getElementById("contentArea").innerHTML = html;
    document.getElementById("headerTitle").innerText = title;
}

async function openChapter(chapter) {
    CURRENT_CHAPTER = chapter;
    const res = await apiCall("getContent", { bookId: CURRENT_BOOK, chapter: chapter });
    if (!res.ok) return alert("Gagal load content: " + (res.error || "Unknown"));
    
    PLAY_QUEUE = [];
    CURRENT_IDX = 0;
    let html = "";
    
    res.data.forEach(row => {
        const sentences = row.text.split(/(?<=[.!?])\s+/);
        html += `<div class="reader-card">`;
        sentences.forEach(s => {
            html += `<span>${s} </span>`;
            PLAY_QUEUE.push({ text: s, gender: row.gender, lang: row.lang_tag });
        });
        html += `</div>`;
    });
    
    document.getElementById("contentArea").innerHTML = html;
    document.getElementById("headerTitle").innerText = `Bab ${chapter}`;
}

// =================================================================================
// 4. LOGIKA PEMUTARAN AUDIO
// =================================================================================
function togglePlay() {
    if (isPlaying) {
        isPlaying = false;
        document.getElementById("playBtn").innerText = "▶ Play";
        if (currentSource) {
            currentSource.stop();
            currentSource = null;
        }
    } else {
        if (PLAY_QUEUE.length === 0) {
            alert("Tidak ada konten untuk dibaca.");
            return;
        }
        isPlaying = true;
        document.getElementById("playBtn").innerText = "⏸ Pause";
        speakNext();
    }
}

function speakNext() {
    if (!isPlaying || CURRENT_IDX >= PLAY_QUEUE.length) {
        isPlaying = false;
        document.getElementById("playBtn").innerText = "▶ Play";
        return;
    }
    
    const chunk = PLAY_QUEUE[CURRENT_IDX];
    const speed = parseFloat(document.getElementById("speedSlider").value);
    
    ttsWorker.postMessage({
        type: 'generate',
        text: chunk.text,
        speed: speed
    });
}

function playAudioBuffer(float32Data, sampleRate) {
    if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    
    const buffer = audioCtx.createBuffer(1, float32Data.length, sampleRate);
    buffer.copyToChannel(float32Data, 0);
    
    if (currentSource) {
        currentSource.stop();
    }
    currentSource = audioCtx.createBufferSource();
    currentSource.buffer = buffer;
    
    const pitch = parseFloat(document.getElementById("pitchSlider").value);
    currentSource.playbackRate.value = pitch; 
    
    currentSource.connect(audioCtx.destination);
    
    currentSource.onended = () => {
        CURRENT_IDX++;
        speakNext();
    };
    
    currentSource.start();
}

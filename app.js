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
let currentSource = null; // Untuk menghentikan audio yang sedang berjalan

// =================================================================================
// 1. INISIALISASI WORKER TTS
// =================================================================================
// Muat Worker sebagai module agar bisa menggunakan import
const ttsWorker = new Worker('tts.worker.js', { type: 'module' });

ttsWorker.onmessage = function (e) {
    if (e.data.type === 'ready') {
        console.log("✅ Mesin TTS Sherpa-onnx Siap!");
        document.getElementById('playBtn').disabled = false;
    } else if (e.data.type === 'result') {
        playAudioBuffer(e.data.audio, e.data.sampleRate);
    } else if (e.data.type === 'error') {
        console.error("❌ Error TTS:", e.data.error);
        alert("Gagal memproses suara: " + e.data.error);
        isPlaying = false;
        document.getElementById('playBtn').innerText = "▶ Play";
    }
};

// Tentukan path folder model Anda di GitHub Pages
// Pastikan trailing slash (/) di akhir
const MODEL_BASE_URL = './models/vits-piper-id_ID-news_tts-medium-fp16/';

// Kirim perintah inisialisasi ke Worker
ttsWorker.postMessage({
    type: 'init',
    modelBaseUrl: MODEL_BASE_URL
});

// Nonaktifkan tombol play sampai model siap
document.getElementById('playBtn').disabled = true;

// =================================================================================
// 2. FUNGSI FETCH API (CORS Workaround)
// =================================================================================
async function apiCall(action, payload = {}) {
    payload.action = action;
    payload.token = AUTH_TOKEN;
    
    const res = await fetch(GAS_API_URL, {
        method: 'POST',
        // Gunakan text/plain untuk menghindari preflight CORS
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
        alert("Login Gagal: " + res.error);
    }
}

function doLogout() {
    localStorage.removeItem("reader_token");
    location.reload();
}

async function loadLibrary() {
    const res = await apiCall("getBooks");
    if (!res.ok) return alert(res.error);
    
    let html = "";
    res.forEach(b => {
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
    if (!res.ok) return alert(res.error);
    
    let html = "";
    res.forEach(c => {
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
    if (!res.ok) return alert(res.error);
    
    PLAY_QUEUE = [];
    CURRENT_IDX = 0;
    let html = "";
    
    res.forEach(row => {
        // Pecah teks menjadi kalimat untuk antrean TTS
        const sentences = row.text.split(/(?<=[.!?])\s+/);
        html += `<div class="reader-card">`;
        sentences.forEach(s => {
            html += `<span>${s} </span>`;
            // Simpan metadata gender dan bahasa untuk referensi
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
        // Pause
        isPlaying = false;
        document.getElementById("playBtn").innerText = "▶ Play";
        if (currentSource) {
            currentSource.stop();
            currentSource = null;
        }
    } else {
        // Play
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
    
    // Kirim teks ke Worker untuk disintesis
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
    
    // Buat buffer audio
    const buffer = audioCtx.createBuffer(1, float32Data.length, sampleRate);
    buffer.copyToChannel(float32Data, 0);
    
    // Siapkan sumber audio
    if (currentSource) {
        currentSource.stop();
    }
    currentSource = audioCtx.createBufferSource();
    currentSource.buffer = buffer;
    
    // Terapkan Pitch (Mengubah playbackRate akan mengubah pitch dan speed)
    const pitch = parseFloat(document.getElementById("pitchSlider").value);
    // Kita bagi dengan speed karena source.playbackRate mempercepat/memperlambat sekaligus
    // Untuk memisahkan pitch dan speed, kita perlu trik khusus, namun untuk sederhananya:
    // kita atur playbackRate = pitch, dan speed dari TTS diatur oleh parameter di Worker.
    currentSource.playbackRate.value = pitch; 
    
    currentSource.connect(audioCtx.destination);
    
    currentSource.onended = () => {
        CURRENT_IDX++;
        speakNext();
    };
    
    currentSource.start();
}
// =================================================================================
// app.js — Logika Utama Frontend dengan Revolab Edge
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

const ttsWorker = new Worker('tts.worker.js', { type: 'module' }); 
const playBtn = document.getElementById('playBtn');

ttsWorker.onmessage = function (e) {
    if (e.data.type === 'ready') {
        console.log("✅ Mesin TTS Revolab Siap!");
        if (playBtn) {
            playBtn.disabled = false;
            playBtn.innerText = "▶ Play";
        }
    } 
    else if (e.data.type === 'result') {
        playAudioBuffer(e.data.samples, e.data.sampleRate);
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

// ══ FUNGSI API & UTILITAS (Sama seperti sebelumnya) ══
// ... (apiCall, doLogin, loadLibrary, openBook, openChapter, dll) ...

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
        html += `<div class="reader-card" data-seq="${row.seq}" onclick="selectCard(${row.seq}, ${chunkIdx})"><div class="reader-paragraph">`;
        sentences.forEach(s => {
            html += `<span class="reader-sentence" data-idx="${chunkIdx}">${s} </span>`;
            // Kita menyimpan teks dan index saja. Suara diambil dari dropdown UI.
            PLAY_QUEUE.push({ text: s, seq: row.seq, idx: chunkIdx });
            chunkIdx++;
        });
        html += `</div></div>`;
    });
    document.getElementById("contentArea").innerHTML = html;
}

// ══ PEMUTARAN AUDIO ══
function speakNext() {
    if (!isPlaying || CURRENT_IDX >= PLAY_QUEUE.length) {
        isPlaying = false;
        if (playBtn) playBtn.innerText = "▶ Play";
        return;
    }
    const chunk = PLAY_QUEUE[CURRENT_IDX];
    const speed = parseFloat(document.getElementById("speedSlider").value);
    const voice = document.getElementById("voiceSelector").value; // Ambil dari dropdown

    document.querySelectorAll('.reader-sentence').forEach(el => el.classList.remove('reading-active'));
    const span = document.querySelector(`.reader-sentence[data-idx="${chunk.idx}"]`);
    if (span) { span.classList.add('reading-active'); span.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
    
    // Kirim perintah ke Worker
    ttsWorker.postMessage({ 
        type: 'generate', 
        text: chunk.text, 
        voice: voice,
        speed: speed 
    });
}

// Sisa fungsi UI (togglePlay, stopTTS, selectCard, dll) tetap sama
// =================================================================================
// tts.worker.js — Mengunduh Data Dulu, Baru Menjalankan WASM
// =================================================================================

const DATA_FILE_URL = "https://huggingface.co/spaces/grbandy02/grbandy02space/resolve/main/sherpa-onnx-wasm-main-tts.data"; // ⚠️ GANTI DENGAN URL ANDA
const CACHE_NAME = 'tts-model-cache-v1';

let ttsInstance = null;
let blobDataUrl = null;

var Module = {
    locateFile: function(path) {
        if (path.endsWith('.wasm')) return './sherpa-onnx-wasm-main-tts.wasm';
        if (path.endsWith('.data')) return blobDataUrl;
        return path;
    },
    onRuntimeInitialized: function() {
        console.log("✅ [Worker] WASM Runtime Siap! Memulai inisialisasi model...");
        // Beri tahu UI bahwa kita masuk fase loading model (fake progress)
        self.postMessage({ type: 'progress', phase: 'init' }); 
        initTTS();
    }
};

async function downloadDataFile() {
    try {
        const cache = await caches.open(CACHE_NAME);
        let response = await cache.match(DATA_FILE_URL);
        
        if (response) {
            console.log("⚡ [Worker] Menggunakan file .data dari Cache lokal.");
            const blob = await response.blob();
            blobDataUrl = URL.createObjectURL(blob);
            return;
        }

        console.log("⬇️ [Worker] Mengunduh file .data baru...");
        response = await fetch(DATA_FILE_URL);
        if (!response.ok) throw new Error("Gagal terhubung ke server model.");
        
        const contentLength = response.headers.get('content-length');
        const total = parseInt(contentLength, 10);
        let loaded = 0;
        const reader = response.body.getReader();
        const chunks = [];

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            chunks.push(value);
            loaded += value.length;
            self.postMessage({ type: 'progress', loaded: loaded, total: total });
        }

        const blob = new Blob(chunks, { type: 'application/octet-stream' });
        await cache.put(DATA_FILE_URL, new Response(blob));
        blobDataUrl = URL.createObjectURL(blob);
        console.log("✅ [Worker] Unduhan selesai dan disimpan di Cache.");
    } catch (err) {
        console.error("❌ [Worker] Gagal mengunduh:", err);
        self.postMessage({ type: 'error', error: 'Gagal mengunduh: ' + err.message });
    }
}

async function initTTS() {
    try {
        const response = await fetch('./tts_config.json');
        const config = await response.json();
        
        let tts = null;
        // Cek berbagai kemungkinan API yang di-expose oleh Emscripten Sherpa-onnx
        if (typeof createOfflineTts === 'function') {
            tts = createOfflineTts(config);
        } else if (typeof OfflineTts === 'function') {
            tts = new OfflineTts(config);
        } else if (typeof Module.createOfflineTts === 'function') {
            tts = Module.createOfflineTts(config);
        } else {
            throw new Error("API createOfflineTts / OfflineTts tidak ditemukan di WASM.");
        }

        ttsInstance = tts;
        self.postMessage({ type: 'ready' });
        console.log("✅ [Worker] TTS Model Siap Digunakan!");
    } catch (err) {
        console.error("❌ [Worker] Gagal inisialisasi:", err);
        self.postMessage({ type: 'error', error: 'Gagal load model: ' + err.message });
    }
}

self.onmessage = async function (e) {
    if (e.data.type === 'init') {
        await downloadDataFile();
        console.log("📦 [Worker] Memuat script WASM...");
        importScripts('./sherpa-onnx-wasm-main-tts.js');
        // Inisialisasi model akan otomatis dipanggil oleh Module.onRuntimeInitialized
    } 
    else if (e.data.type === 'generate') {
        if (!ttsInstance) return self.postMessage({ type: 'error', error: 'TTS belum siap' });
        
        try {
            const audio = ttsInstance.generate({
                text: e.data.text,
                sid: 0,
                speed: e.data.speed || 1.0
            });
            self.postMessage({ type: 'result', audio: audio.samples, sampleRate: audio.sampleRate });
        } catch (err) {
            self.postMessage({ type: 'error', error: err.message });
        }
    }
};
// =================================================================================
// tts.worker.js — Urutan Inisialisasi Emscripten yang Benar
// =================================================================================

const DATA_FILE_URL = "https://huggingface.co/spaces/grbandy02/grbandy02space/resolve/main/sherpa-onnx-wasm-main-tts.data"; // ⚠️ GANTI DENGAN URL ANDA
const CACHE_NAME = 'tts-model-cache-v1';

let ttsInstance = null;
let blobDataUrl = null;
let configData = null;
let scriptLoaded = false;

// 1. Definisikan Module SEBELUM importScripts
var Module = {
    locateFile: function(path) {
        if (path.endsWith('.wasm')) {
            return './sherpa-onnx-wasm-main-tts.wasm';
        }
        if (path.endsWith('.data')) {
            if (!blobDataUrl) console.error("❌ [Worker] Data belum siap, tapi diminta WASM!");
            return blobDataUrl; // Blob URL yang sudah siap
        }
        return path;
    },
    onRuntimeInitialized: function() {
        console.log("✅ [Worker] WASM Runtime Siap!");
    }
};

// 2. Fungsi Download File .data
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
        if (!contentLength) throw new Error("Server tidak mengirim info ukuran file.");
        
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

// 3. Fungsi Menunggu API WASM Siap
function waitForWasm() {
    return new Promise(resolve => {
        const check = () => {
            if (typeof Module.createOfflineTts === 'function') {
                resolve();
            } else {
                setTimeout(check, 100);
            }
        };
        check();
    });
}

// 4. Inisialisasi Model TTS
async function initTTS() {
    try {
        self.postMessage({ type: 'progress', loaded: 100, total: 100, phase: 'init' });
        const response = await fetch('./tts_config.json');
        const config = await response.json();
        
        ttsInstance = Module.createOfflineTts(config);
        
        self.postMessage({ type: 'ready' });
        console.log("✅ [Worker] TTS Model Siap Digunakan!");
    } catch (err) {
        console.error("❌ [Worker] Gagal inisialisasi:", err);
        self.postMessage({ type: 'error', error: 'Gagal load model: ' + err.message });
    }
}

// 5. Alur Utama Worker (MENUNGGU UNDUHAN SEBELUM IMPORT SCRIPT)
self.onmessage = async function (e) {
    if (e.data.type === 'init') {
        configData = e.data;
        
        // LANGKAH 1: Unduh file .data DULU
        await downloadDataFile();
        
        // LANGKAH 2: Muat script WASM SETELAH blobDataUrl siap
        if (!scriptLoaded) {
            console.log("📦 [Worker] Memuat script WASM...");
            importScripts('./sherpa-onnx-wasm-main-tts.js');
            scriptLoaded = true;
        }
        
        // LANGKAH 3: Tunggu API createOfflineTts tersedia
        await waitForWasm();
        
        // LANGKAH 4: Buat instance TTS
        await initTTS();
    } 
    else if (e.data.type === 'generate') {
        if (!ttsInstance) {
            self.postMessage({ type: 'error', error: 'TTS belum siap' });
            return;
        }
        
        try {
            const audio = ttsInstance.generate({
                text: e.data.text,
                sid: 0,
                speed: e.data.speed || 1.0
            });

            self.postMessage({
                type: 'result',
                audio: audio.samples,
                sampleRate: audio.sampleRate
            });
        } catch (err) {
            self.postMessage({ type: 'error', error: err.message });
        }
    }
};
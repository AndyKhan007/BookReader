// =================================================================================
// tts.worker.js — Download Manager & WASM Loader
// =================================================================================

const DATA_FILE_URL = "https://huggingface.co/spaces/grbandy02/grbandy02space/resolve/main/sherpa-onnx-wasm-main-tts.data"; // ⚠️ MASUKKAN URL HUGGING FACE DARI LANGKAH SEBELUMNYA
const CACHE_NAME = 'tts-model-cache-v1';

let ttsInstance = null;
let isReady = false;
let blobDataUrl = null;

var Module = {
    locateFile: function(path) {
        if (path.endsWith('.data')) {
            return blobDataUrl; // Gunakan URL Blob lokal setelah diunduh
        }
        return path;
    },
    onRuntimeInitialized: function() {
        console.log("✅ [Worker] WASM Runtime Siap!");
        checkReady();
    }
};

// Fungsi mengunduh dengan Progress
async function downloadDataFile() {
    try {
        const cache = await caches.open(CACHE_NAME);
        let response = await cache.match(DATA_FILE_URL);
        
        if (response) {
            console.log("⚡ [Worker] Menggunakan file .data dari Cache lokal.");
            const blob = await response.blob();
            blobDataUrl = URL.createObjectURL(blob);
            return; // Selesai, lanjut ke load WASM
        }

        console.log("⬇️ [Worker] Mengunduh file .data baru (371 MB)...");
        response = await fetch(DATA_FILE_URL);
        
        if (!response.ok) throw new Error("Gagal terhubung ke server model.");
        
        const contentLength = response.headers.get('content-length');
        if (!contentLength) throw new Error("Server tidak mengirim info ukuran file.");
        
        const total = parseInt(contentLength, 10);
        let loaded = 0;
        
        // Baca dalam bentuk potongan (chunks)
        const reader = response.body.getReader();
        const chunks = [];

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            chunks.push(value);
            loaded += value.length;
            
            // Kirim progress ke app.js
            self.postMessage({ type: 'progress', loaded: loaded, total: total });
        }

        // Gabungkan dan simpan ke Cache
        const blob = new Blob(chunks, { type: 'application/octet-stream' });
        const cacheResponse = new Response(blob, {
            headers: { 'Content-Length': total, 'Content-Type': 'application/octet-stream' }
        });
        await cache.put(DATA_FILE_URL, cacheResponse);
        
        blobDataUrl = URL.createObjectURL(blob);
        console.log("✅ [Worker] Unduhan selesai dan disimpan di Cache.");

    } catch (err) {
        console.error("❌ [Worker] Gagal mengunduh file .data:", err);
        self.postMessage({ type: 'error', error: 'Gagal mengunduh model: ' + err.message });
    }
}

let configData = null;

function checkReady() {
    if (configData && typeof Module.createOfflineTts === 'function' && !ttsInstance) {
        initTTS();
    }
}

async function initTTS() {
    try {
        console.log("⚙️ [Worker] Menginisialisasi Model TTS...");
        const response = await fetch('./tts_config.json');
        const config = await response.json();
        
        ttsInstance = Module.createOfflineTts(config);
        isReady = true;
        
        self.postMessage({ type: 'ready' });
        console.log("✅ [Worker] TTS Model Siap Digunakan!");
    } catch (err) {
        console.error("❌ [Worker] Gagal inisialisasi:", err);
        self.postMessage({ type: 'error', error: 'Gagal load model: ' + err.message });
    }
}

self.onmessage = async function (e) {
    if (e.data.type === 'init') {
        configData = e.data;
        
        // 1. Unduh file .data terlebih dahulu (dengan progress bar)
        await downloadDataFile();
        
        // 2. Muat script utama Sherpa-onnx setelah data siap
        importScripts('./sherpa-onnx-wasm-main-tts.js');
        
        // 3. Panggil checkReady (jika WASM sudah siap duluan)
        checkReady();
    } 
    else if (e.data.type === 'generate') {
        if (!isReady || !ttsInstance) {
            self.postMessage({ type: 'error', error: 'TTS belum siap, mohon tunggu.' });
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
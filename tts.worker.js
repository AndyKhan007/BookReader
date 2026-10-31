// =================================================================================
// tts.worker.js — Memuat API Wrapper dan Konfigurasi Objek yang Benar
// =================================================================================

const DATA_FILE_URL = "https://huggingface.co/spaces/grbandy02/grbandy02space/resolve/main/sherpa-onnx-wasm-main-tts.data"; // ⚠️ GANTI DENGAN URL ANDA
const CACHE_NAME = 'tts-model-cache-v1';

let ttsInstance = null;
let blobDataUrl = null;
let scriptLoaded = false;

// 1. Definisikan Module
var Module = {
    locateFile: function(path) {
        if (path.endsWith('.wasm')) return './sherpa-onnx-wasm-main-tts.wasm';
        if (path.endsWith('.data')) return blobDataUrl;
        return path;
    },
    onRuntimeInitialized: function() {
        console.log("✅ [Worker] WASM Runtime Siap! Memulai inisialisasi model...");
        self.postMessage({ type: 'progress', phase: 'init' }); 
        initTTS();
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

// 3. Inisialisasi Model TTS dengan Konfigurasi Objek
async function initTTS() {
    try {
        console.log("⚙️ [Worker] Membuat instance TTS...");
        
        // Konfigurasi lengkap sesuai dengan referensi Sherpa-onnx WASM
        const config = {
            offlineTtsModelConfig: {
                offlineTtsVitsModelConfig: {
                    model: './id_ID-news_tts-medium.onnx', // Nama file harus persis seperti di dalam .data
                    lexicon: '',
                    tokens: './tokens.txt',
                    dataDir: './espeak-ng-data',
                    noiseScale: 0.667,
                    noiseScaleW: 0.8,
                    lengthScale: 1.0,
                },
                offlineTtsMatchaModelConfig: {
                    acousticModel: '', vocoder: '', lexicon: '', tokens: '', dataDir: '', noiseScale: 0.667, lengthScale: 1.0,
                },
                offlineTtsKokoroModelConfig: {
                    model: '', voices: '', tokens: '', dataDir: '', lengthScale: 1.0, lexicon: '', lang: '',
                },
                offlineTtsKittenModelConfig: {
                    model: '', voices: '', tokens: '', dataDir: '', lengthScale: 1.0,
                },
                numThreads: 1,
                debug: 1,
                provider: 'cpu',
            },
            ruleFsts: '',
            ruleFars: '',
            maxNumSentences: 1,
        };

        // Panggil API global createOfflineTts
        ttsInstance = createOfflineTts(Module, config);
        
        self.postMessage({ type: 'ready' });
        console.log("✅ [Worker] TTS Model Siap Digunakan!");
    } catch (err) {
        console.error("❌ [Worker] Gagal inisialisasi:", err);
        self.postMessage({ type: 'error', error: 'Gagal load model: ' + err.message });
    }
}

// 4. Alur Utama Worker
self.onmessage = async function (e) {
    if (e.data.type === 'init') {
        await downloadDataFile();
        
        if (!scriptLoaded) {
            console.log("📦 [Worker] Memuat script WASM & API TTS...");
            // WAJIB memuat DUA file: main dan tts.js
            importScripts(
                './sherpa-onnx-wasm-main-tts.js',
                './sherpa-onnx-tts.js' // File yang baru Anda unduh
            );
            scriptLoaded = true;
        }
    } 
    else if (e.data.type === 'generate') {
        if (!ttsInstance) return self.postMessage({ type: 'error', error: 'TTS belum siap' });
        
        try {
            const audio = ttsInstance.generate({
                text: e.data.text,
                sid: 0,
                speed: e.data.speed || 1.0
            });
            
            // Kirim buffer dengan transferable objects untuk performa (zero-copy)
            self.postMessage(
                { type: 'result', samples: audio.samples, sampleRate: audio.sampleRate },
                [audio.samples.buffer]
            );
        } catch (err) {
            self.postMessage({ type: 'error', error: err.message });
        }
    }
};
// =================================================================================
// tts.worker.js — Mengambil file .data dari Hugging Face (Bypass limit GitHub)
// =================================================================================

// ⚠️ GANTI URL INI DENGAN LINK HUGGING FACE ANDA NANTI
const DATA_FILE_URL = "https://huggingface.co/spaces/grbandy02/grbandy02space/resolve/main/sherpa-onnx-wasm-main-tts.data";

var Module = {
    // Memberitahu Emscripten untuk mengambil file .data dari URL Hugging Face
    locateFile: function(path) {
        if (path.endsWith('.data')) {
            console.log("⬇️ Mengunduh file .data dari server eksternal...");
            return DATA_FILE_URL;
        }
        return path;
    },
    onRuntimeInitialized: function() {
        console.log("✅ [Worker] WASM Runtime Siap!");
        checkReady();
    }
};

// Muat script utama Sherpa-onnx (pastikan file .js ini ada di GitHub Anda)
importScripts('./sherpa-onnx-wasm-main-tts.js');

let ttsInstance = null;
let isReady = false;
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

self.onmessage = function (e) {
    if (e.data.type === 'init') {
        configData = e.data;
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
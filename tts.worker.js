// =================================================================================
// tts.worker.js — Menggunakan Mesin Resmi Sherpa-onnx WASM (Classic Worker)
// =================================================================================

var Module = {
    onRuntimeInitialized: function() {
        console.log("✅ [Worker] WASM Runtime Siap!");
        checkReady();
    }
};

// Muat script utama Sherpa-onnx
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
        // Ambil konfigurasi
        const response = await fetch('./tts_config.json');
        const config = await response.json();
        
        // Buat instance TTS
        ttsInstance = Module.createOfflineTts(config);
        isReady = true;
        
        self.postMessage({ type: 'ready' });
        console.log("✅ [Worker] TTS Model (Piper) Siap Digunakan!");
    } catch (err) {
        console.error("❌ [Worker] Gagal inisialisasi:", err);
        self.postMessage({ type: 'error', error: 'Gagal load model: ' + err.message });
    }
}

self.onmessage = function (e) {
    if (e.data.type === 'init') {
        configData = e.data;
        checkReady(); // Jika WASM sudah siap duluan
    } 
    else if (e.data.type === 'generate') {
        if (!isReady || !ttsInstance) {
            self.postMessage({ type: 'error', error: 'TTS belum siap, mohon tunggu.' });
            return;
        }
        
        try {
            const audio = ttsInstance.generate({
                text: e.data.text,
                sid: 0, // Speaker ID
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
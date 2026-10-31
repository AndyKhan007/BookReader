// =================================================================================
// tts.worker.js — Worker untuk Sherpa-onnx TTS (Piper)
// =================================================================================

import { RunAnywhere } from 'https://esm.sh/@runanywhere/web@latest';
import { ONNX, TTS } from 'https://esm.sh/@runanywhere/web-onnx@latest';

let isReady = false;

self.onmessage = async function (e) {
    if (e.data.type === 'init') {
        try {
            // 1. Inisialisasi Core SDK RunAnywhere
            await RunAnywhere.initialize({ environment: 'production' });
            
            // 2. Daftarkan backend ONNX (WASM)
            await ONNX.register();

            // 3. Muat model suara (Voice) dari URL GitHub Pages Anda
            // Pastikan path ini sesuai dengan struktur folder di repo Anda.
            // e.data.modelBaseUrl harus diakhiri dengan '/'
            await TTS.loadVoice({
                voiceId: 'piper-id',
                modelPath: e.data.modelBaseUrl + 'id_ID-news_tts-medium.onnx', // Atau model.fp16.onnx
                tokensPath: e.data.modelBaseUrl + 'tokens.txt',
                dataDir: e.data.modelBaseUrl + 'espeak-ng-data',
            });

            isReady = true;
            self.postMessage({ type: 'ready' });
            console.log('[Worker] TTS Model (Piper) Siap!');
        } catch (err) {
            console.error('[Worker] Gagal inisialisasi:', err);
            self.postMessage({ type: 'error', error: 'Gagal memuat model: ' + err.message });
        }
    } 
    else if (e.data.type === 'generate') {
        if (!isReady) {
            self.postMessage({ type: 'error', error: 'TTS belum siap' });
            return;
        }
        
        try {
            // 4. Sintesis teks menjadi audio
            // Catatan: Parameter 'speed' mungkin didukung, sesuaikan dengan dokumentasi RunAnywhere
            const speech = await TTS.synthesize(e.data.text, {
                // speed: e.data.speed || 1.0, // Uncomment jika API mendukung
            });

            // 5. Kirim hasil audio (Float32Array) dan sample rate ke main thread
            self.postMessage({
                type: 'result',
                audio: speech.audioData, // Float32Array
                sampleRate: speech.sampleRate
            });
        } catch (err) {
            console.error('[Worker] Gagal sintesis:', err);
            self.postMessage({ type: 'error', error: err.message });
        }
    }
};
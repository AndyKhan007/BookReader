// =================================================================================
// tts.worker.js — Revolab Edge TTS Engine
// =================================================================================

import { RevolabEdge } from 'https://esm.sh/@revolab/revolab-edge@latest';
import { KNOWN_VOICES } from 'https://esm.sh/@revolab/revolab-edge@latest';

let ttsInstance = null;

// Inisialisasi Revolab Edge
async function initRevolab() {
    try {
        console.log("⚙️ [Worker] Memuat Revolab Edge...");
        // assetBase diarahkan ke CDN resmi agar tidak perlu upload file manual
        ttsInstance = await RevolabEdge.load({ 
            assetBase: 'https://unpkg.com/@revolab/revolab-edge/' 
        });
        
        // Muat suara pria (budi) secara eksplisit jika belum ada di KNOWN_VOICES bawaan
        // Paket @revolab/voice-budi biasanya sudah terintegrasi jika kita memanggil loadVoice('budi')
        
        self.postMessage({ type: 'ready' });
        console.log("✅ [Worker] Revolab Edge Siap Digunakan!");
    } catch (err) {
        console.error("❌ [Worker] Gagal memuat Revolab:", err);
        self.postMessage({ type: 'error', error: err.message });
    }
}

initRevolab();

// Menangani permintaan sintesis dari app.js
self.onmessage = async function (e) {
    if (e.data.type === 'generate') {
        if (!ttsInstance) {
            self.postMessage({ type: 'error', error: 'TTS belum siap' });
            return;
        }
        
        try {
            const { text, voice, speed } = e.data;
            
            // Konversi speed slider (0.5 - 2.0) ke lengthScale Revolab (2.0 - 0.5)
            // Semakin besar lengthScale, semakin lambat.
            const lengthScale = speed ? (1 / speed) : 1.0;

            // Prefetch suara jika belum dimuat (misal: suara 'budi' atau 'paan')
            await ttsInstance.loadVoice(voice);

            const result = await ttsInstance.synthesize(text, { 
                voice: voice,
                lengthScale: lengthScale
            });

            self.postMessage({
                type: 'result',
                samples: result.samples, // Float32Array
                sampleRate: result.sampleRate
            });

        } catch (err) {
            console.error("❌ [Worker] Gagal sintesis:", err);
            self.postMessage({ type: 'error', error: err.message });
        }
    }
};
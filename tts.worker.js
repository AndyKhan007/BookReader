// =================================================================================
// tts.worker.js — Revolab Edge TTS Engine
// =================================================================================

import { RevolabEdge } from 'https://esm.sh/@revolab/revolab-edge@latest';

let ttsInstance = null;

async function initRevolab() {
    try {
        console.log("⚙️ [Worker] Memuat Revolab Edge...");
        ttsInstance = await RevolabEdge.load({ 
            assetBase: 'https://unpkg.com/@revolab/revolab-edge/' 
        });
        self.postMessage({ type: 'ready' });
        console.log("✅ [Worker] Revolab Edge Siap Digunakan!");
    } catch (err) {
        console.error("❌ [Worker] Gagal memuat Revolab:", err);
        self.postMessage({ type: 'error', error: err.message });
    }
}

initRevolab();

self.onmessage = async function (e) {
    if (e.data.type === 'generate') {
        if (!ttsInstance) {
            self.postMessage({ type: 'error', error: 'TTS belum siap' });
            return;
        }
        
        try {
            const { text, voice, speed, id } = e.data; // Ambil ID
            const lengthScale = speed ? (1 / speed) : 1.0;

            await ttsInstance.loadVoice(voice);

            const result = await ttsInstance.synthesize(text, { 
                voice: voice,
                lengthScale: lengthScale
            });

            // Kembalikan ID beserta hasil suaranya
            self.postMessage({
                type: 'result',
                id: id, 
                samples: result.samples,
                sampleRate: result.sampleRate
            });

        } catch (err) {
            console.error("❌ [Worker] Gagal sintesis:", err);
            self.postMessage({ type: 'error', error: err.message });
        }
    }
};
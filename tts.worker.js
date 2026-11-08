// =================================================================================
// tts.worker.js — Revolab Edge TTS Engine (Fixed Local Voice Base)
// =================================================================================

import { RevolabEdge } from './revolab-assets/revovoice.js';

let ttsInstance = null;

async function initRevolab() {
    try {
        console.log("⚙️ [Worker] Memuat Revolab Edge dari aset lokal...");
        
        ttsInstance = await RevolabEdge.load({ 
            assetBase: './revolab-assets/' 
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
            const { text, voice, speed, id } = e.data;
            const lengthScale = speed ? (1 / speed) : 1.0;

            // PERBAIKAN: voiceBase harus mengarah ke folder revolab-assets/
            const voiceOptions = {
                voiceBase: './revolab-assets/', 
                quantized: false
            };

            await ttsInstance.loadVoice(voice, voiceOptions);

            const result = await ttsInstance.synthesize(text, { 
                voice: voice,
                lengthScale: lengthScale
            });

            self.postMessage({
                type: 'result',
                id: id, 
                samples: result.samples,
                sampleRate: result.sampleRate
            }, [result.samples.buffer]); 

        } catch (err) {
            console.error("❌ [Worker] Gagal sintesis:", err);
            self.postMessage({ type: 'error', error: err.message });
        }
    }
};
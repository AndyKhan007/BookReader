// =================================================================================
// tts.worker.js — Revolab Edge TTS Engine (Explicit Local VoiceBase)
// =================================================================================

import { RevolabEdge } from './revolab-assets/revovoice.js';

let ttsInstance = null;

async function initRevolab() {
    try {
        console.log("⚙️ [Worker] Memuat Revolab Edge dari aset lokal...");
        
        // 1. Tentukan base path untuk semua aset (wasm, g2p.json)
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

            // 2. Kunci Perbaikan: Definisikan voiceBase ke folder lokal
            const voiceOptions = {
                voice: voice,
                voiceBase: './revolab-assets/voices/',
                quantized: false
            };

            await ttsInstance.loadVoice(voice, voiceOptions);

            const result = await ttsInstance.synthesize(text, { 
                voice: voice,
                voiceBase: './revolab-assets/voices/', // Sertakan juga di sini untuk memastikan
                lengthScale: lengthScale
            });

            // 3. Kirim data audio menggunakan Transferable Objects
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
// =================================================================================
// tts.worker.js — Revolab Edge TTS Engine (100% Local & Optimized)
// =================================================================================

// 1. Import mesin dari file lokal yang ada di folder revolab-assets
import { RevolabEdge } from './revolab-assets/revovoice.js';

let ttsInstance = null;

async function initRevolab() {
    try {
        console.log("⚙️ [Worker] Memuat Revolab Edge dari aset lokal...");
        
        // 2. Arahkan assetBase ke folder lokal
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
            
            // 3. Konversi speed slider (0.5 - 2.0) ke lengthScale Revolab
            const lengthScale = speed ? (1 / speed) : 1.0;

            // 4. Muat suara dengan quantized: false (karena kita menggunakan file .bin, bukan .qbin)
            await ttsInstance.loadVoice(voice, { quantized: false });

            const result = await ttsInstance.synthesize(text, { 
                voice: voice,
                lengthScale: lengthScale
            });

            // 5. TRANSFERABLE OBJECTS: Kirim data tanpa menyalin memori (instan)
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
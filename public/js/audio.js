/* ============================================================
   ALPHA.BET 2026 COMPETITION - AUDIO & PRONUNCIATION ENGINE
   ============================================================ */

class SoundEngine {
    constructor() {
        this.audioCtx = null;
        this.synth = window.speechSynthesis;
        this.preferredVoice = null;
        this.initVoice();
    }

    initAudioContext() {
        if (!this.audioCtx) {
            const AudioContext = window.AudioContext || window.webkitAudioContext;
            if (AudioContext) {
                this.audioCtx = new AudioContext();
            }
        }
        if (this.audioCtx && this.audioCtx.state === 'suspended') {
            this.audioCtx.resume();
        }
    }

    initVoice() {
        if (!this.synth) return;
        const setVoice = () => {
            const voices = this.synth.getVoices();
            // Look for natural English voice (UK or US)
            this.preferredVoice = voices.find(v => v.lang === 'en-GB' || v.name.includes('UK') || v.name.includes('British')) ||
                                 voices.find(v => v.lang.startsWith('en')) ||
                                 voices[0];
        };
        setVoice();
        if (this.synth.onvoiceschanged !== undefined) {
            this.synth.onvoiceschanged = setVoice;
        }
    }

    // Play synthetic sound effect
    playSound(type) {
        try {
            this.initAudioContext();
            if (!this.audioCtx) return;

            const now = this.audioCtx.currentTime;

            if (type === 'select') {
                // High-tech blip
                const osc = this.audioCtx.createOscillator();
                const gain = this.audioCtx.createGain();
                osc.type = 'sine';
                osc.frequency.setValueAtTime(587.33, now); // D5
                osc.frequency.exponentialRampToValueAtTime(880, now + 0.08); // A5
                gain.gain.setValueAtTime(0.2, now);
                gain.gain.exponentialRampToValueAtTime(0.01, now + 0.08);
                osc.connect(gain);
                gain.connect(this.audioCtx.destination);
                osc.start(now);
                osc.stop(now + 0.08);
            } else if (type === 'submit') {
                // Futuristic confirm
                const osc = this.audioCtx.createOscillator();
                const gain = this.audioCtx.createGain();
                osc.type = 'triangle';
                osc.frequency.setValueAtTime(440, now);
                osc.frequency.exponentialRampToValueAtTime(659.25, now + 0.15);
                gain.gain.setValueAtTime(0.25, now);
                gain.gain.exponentialRampToValueAtTime(0.01, now + 0.15);
                osc.connect(gain);
                gain.connect(this.audioCtx.destination);
                osc.start(now);
                osc.stop(now + 0.15);
            } else if (type === 'correct') {
                // Victory Chime Major Arpeggio (C5 -> E5 -> G5 -> C6)
                const notes = [523.25, 659.25, 783.99, 1046.50];
                notes.forEach((freq, idx) => {
                    const osc = this.audioCtx.createOscillator();
                    const gain = this.audioCtx.createGain();
                    const t = now + (idx * 0.09);
                    osc.type = 'sine';
                    osc.frequency.setValueAtTime(freq, t);
                    gain.gain.setValueAtTime(0.25, t);
                    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
                    osc.connect(gain);
                    gain.connect(this.audioCtx.destination);
                    osc.start(t);
                    osc.stop(t + 0.35);
                });
            } else if (type === 'wrong') {
                // Low descending buzz
                const osc = this.audioCtx.createOscillator();
                const gain = this.audioCtx.createGain();
                osc.type = 'sawtooth';
                osc.frequency.setValueAtTime(180, now);
                osc.frequency.linearRampToValueAtTime(110, now + 0.35);
                gain.gain.setValueAtTime(0.3, now);
                gain.gain.exponentialRampToValueAtTime(0.01, now + 0.35);
                osc.connect(gain);
                gain.connect(this.audioCtx.destination);
                osc.start(now);
                osc.stop(now + 0.35);
            } else if (type === 'round_change') {
                // Fanfare fanfare
                const freqs = [392, 523.25, 659.25, 783.99];
                freqs.forEach((f, i) => {
                    const osc = this.audioCtx.createOscillator();
                    const gain = this.audioCtx.createGain();
                    const t = now + (i * 0.12);
                    osc.type = 'triangle';
                    osc.frequency.setValueAtTime(f, t);
                    gain.gain.setValueAtTime(0.25, t);
                    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
                    osc.connect(gain);
                    gain.connect(this.audioCtx.destination);
                    osc.start(t);
                    osc.stop(t + 0.4);
                });
            }
        } catch (err) {
            console.warn('Audio effect error:', err);
        }
    }

    // Pronounce Word: checks local /audio/ folder, fallback to Web Speech
    speakWord(word, onStart, onEnd) {
        if (!word) return;
        const cleanWord = word.trim();

        // Try local audio file
        const audioUrl = `/audio/${encodeURIComponent(cleanWord.toLowerCase())}.mp3`;
        const audio = new Audio(audioUrl);

        audio.onplay = () => {
            if (onStart) onStart();
        };
        audio.onended = () => {
            if (onEnd) onEnd();
        };

        const playPromise = audio.play();
        if (playPromise !== undefined) {
            playPromise.then(() => {
                // Audio file played successfully
            }).catch(() => {
                // Fallback to Web Speech API
                this.speakWithSynthesis(cleanWord, onStart, onEnd);
            });
        } else {
            this.speakWithSynthesis(cleanWord, onStart, onEnd);
        }
    }

    speakWithSynthesis(text, onStart, onEnd) {
        if (!this.synth) return;
        this.synth.cancel(); // Stop any pending speech

        const utterance = new SpeechSynthesisUtterance(text);
        if (this.preferredVoice) {
            utterance.voice = this.preferredVoice;
        }
        utterance.rate = 0.85; // slightly slower for clear competition spelling
        utterance.pitch = 1.0;

        utterance.onstart = () => {
            if (onStart) onStart();
        };
        utterance.onend = () => {
            if (onEnd) onEnd();
        };
        utterance.onerror = () => {
            if (onEnd) onEnd();
        };

        this.synth.speak(utterance);
    }
}

window.soundEngine = new SoundEngine();

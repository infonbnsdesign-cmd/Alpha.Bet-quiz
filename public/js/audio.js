/* ============================================================
   ALPHA.BET 2026 COMPETITION - AUDIO & PRONUNCIATION ENGINE
   With Android audio unlock, preloading, and caching
   ============================================================ */

class SoundEngine {
    constructor() {
        this.audioCtx = null;
        this.synth = window.speechSynthesis;
        this.preferredVoice = null;
        this.audioUnlocked = false;
        this.preloadedAudio = null;     // Preloaded Audio element for current word
        this.preloadedWord = null;      // Which word is preloaded
        this.initVoice();

        // Auto-unlock audio on ANY user interaction (critical for Android)
        this._unlockHandler = () => this.unlockAudio();
        document.addEventListener('click', this._unlockHandler, { once: false });
        document.addEventListener('touchstart', this._unlockHandler, { once: false });
        document.addEventListener('touchend', this._unlockHandler, { once: false });
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

    // Unlock audio for Android/iOS — must be called during a user gesture
    unlockAudio() {
        if (this.audioUnlocked) return;

        try {
            // 1. Resume AudioContext
            this.initAudioContext();

            // 2. Play a tiny silent sound to unlock HTML5 Audio on Android
            const silentAudio = new Audio('data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=');
            silentAudio.volume = 0.01;
            const playPromise = silentAudio.play();
            if (playPromise) {
                playPromise.then(() => {
                    silentAudio.pause();
                    silentAudio.currentTime = 0;
                    this.audioUnlocked = true;
                    console.log('[Audio] Android audio unlocked via user gesture');
                }).catch(() => {
                    // Still blocked, will try again on next gesture
                });
            }

            // 3. Also create a silent oscillator to fully unlock Web Audio API
            if (this.audioCtx && this.audioCtx.state === 'running') {
                const osc = this.audioCtx.createOscillator();
                const gain = this.audioCtx.createGain();
                gain.gain.value = 0;
                osc.connect(gain);
                gain.connect(this.audioCtx.destination);
                osc.start();
                osc.stop(this.audioCtx.currentTime + 0.001);
                this.audioUnlocked = true;
            }
        } catch (e) {
            console.warn('[Audio] Unlock attempt failed:', e);
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

    // Preload audio for a word so it plays instantly when triggered
    preloadAudio(word) {
        if (!word) return;
        const cleanWord = word.trim();
        if (this.preloadedWord === cleanWord && this.preloadedAudio) return; // Already preloaded

        // Clean up previous preloaded audio
        if (this.preloadedAudio) {
            this.preloadedAudio.pause();
            this.preloadedAudio.removeAttribute('src');
            this.preloadedAudio.load();
        }

        const audioUrl = `/api/audio-lookup/${encodeURIComponent(cleanWord)}`;
        const audio = new Audio();
        audio.preload = 'auto';
        audio.src = audioUrl;
        // Start loading immediately
        audio.load();

        this.preloadedAudio = audio;
        this.preloadedWord = cleanWord;
        console.log(`[Audio] Preloading audio for: ${cleanWord}`);
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

    // Pronounce Word: uses preloaded audio if available, otherwise fetches fresh
    speakWord(word, onStart, onEnd) {
        if (!word) return;
        const cleanWord = word.trim();

        let audio;

        // Use preloaded audio if it matches the word
        if (this.preloadedWord === cleanWord && this.preloadedAudio) {
            audio = this.preloadedAudio;
            audio.currentTime = 0; // Reset to start in case it was played before
            console.log(`[Audio] Using preloaded audio for: ${cleanWord}`);
        } else {
            // Fetch fresh if not preloaded
            const audioUrl = `/api/audio-lookup/${encodeURIComponent(cleanWord)}`;
            audio = new Audio(audioUrl);
            audio.preload = 'auto';
        }

        let hasStarted = false;

        audio.onplay = () => {
            hasStarted = true;
            if (onStart) onStart();
        };
        audio.onended = () => {
            if (onEnd) onEnd();
        };
        audio.onerror = () => {
            if (!hasStarted) {
                // Audio file not found or failed, fallback to Speech Synthesis
                this.speakWithSynthesis(cleanWord, onStart, onEnd);
            } else if (onEnd) {
                onEnd();
            }
        };

        const playPromise = audio.play();
        if (playPromise !== undefined) {
            playPromise.then(() => {
                // Audio file playing
            }).catch(() => {
                if (!hasStarted) {
                    this.speakWithSynthesis(cleanWord, onStart, onEnd);
                }
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

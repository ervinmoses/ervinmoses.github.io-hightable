// ========================================================
// HIGHTABLE AUDIO & VOICE ALERT SYSTEM
// ========================================================

let yourTurnAudio = null;
let lastPlayedTimestamp = 0;
let isAudioUnlocked = false;

// Initialize the Audio instance
function getAudioInstance() {
    if (!yourTurnAudio) {
        yourTurnAudio = new Audio('assets/audio/your_turn.wav?v=1');
        yourTurnAudio.preload = 'auto';
    }
    return yourTurnAudio;
}

// Unlock audio playback on first user gesture (Safari & Chrome autoplay policies)
export function unlockAudio() {
    if (isAudioUnlocked) return;
    const audio = getAudioInstance();
    if (audio) {
        audio.volume = 0.01;
        const promise = audio.play();
        if (promise !== undefined) {
            promise.then(() => {
                audio.pause();
                audio.currentTime = 0;
                audio.volume = 1.0;
                isAudioUnlocked = true;
            }).catch(() => {
                // Will retry on next interaction
            });
        }
    }
}

// Listen globally for first interaction to unlock audio
if (typeof window !== 'undefined') {
    const unlockHandler = () => {
        unlockAudio();
        window.removeEventListener('click', unlockHandler);
        window.removeEventListener('touchstart', unlockHandler);
        window.removeEventListener('keydown', unlockHandler);
    };
    window.addEventListener('click', unlockHandler, { passive: true });
    window.addEventListener('touchstart', unlockHandler, { passive: true });
    window.addEventListener('keydown', unlockHandler, { passive: true });
}

// Fallback voice synthesis via Web Speech API
function fallbackSpeech() {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        try {
            window.speechSynthesis.cancel();
            const utterance = new SpeechSynthesisUtterance('Your turn');
            utterance.rate = 1.0;
            utterance.pitch = 1.0;
            utterance.volume = 1.0;
            window.speechSynthesis.speak(utterance);
        } catch (e) {
            console.warn('Speech synthesis fallback error:', e);
        }
    }
}

// Telegram WebApp vibration / haptic notification
function triggerTelegramTurnHaptic() {
    if (typeof window !== 'undefined' && window.Telegram?.WebApp?.HapticFeedback) {
        try {
            window.Telegram.WebApp.HapticFeedback.notificationOccurred('warning');
            setTimeout(() => {
                window.Telegram?.WebApp?.HapticFeedback?.impactOccurred('heavy');
            }, 250);
        } catch (e) {}
    }
}

// Visual screen flash & alert toast
function triggerVisualTurnAlert() {
    if (typeof document === 'undefined') return;

    // Show glowing turn banner
    const toast = document.getElementById('toastNotice');
    if (toast) {
        toast.textContent = "⚡ IT'S YOUR TURN!";
        toast.classList.add('show', 'turn-alert');
        setTimeout(() => toast.classList.remove('show', 'turn-alert'), 3200);
    }

    // Pulse gold border on whole screen
    document.body.classList.add('my-turn-active');
    setTimeout(() => {
        document.body.classList.remove('my-turn-active');
    }, 2200);
}

/**
 * Main function: Plays "Your Turn" voice alert with sound, vibration, and visual pulse.
 * Has a 3-second debounce cooldown to prevent audio overlapping.
 */
export function playYourTurnAlert() {
    const now = Date.now();
    if (now - lastPlayedTimestamp < 3000) return; // Debounce 3s
    lastPlayedTimestamp = now;

    // 1. Vibration & Visual alerts
    triggerTelegramTurnHaptic();
    triggerVisualTurnAlert();

    // 2. Play Audio File with Speech Synthesis Fallback
    const audio = getAudioInstance();
    if (audio) {
        audio.currentTime = 0;
        audio.volume = 1.0;
        const playPromise = audio.play();
        if (playPromise !== undefined) {
            playPromise.catch((err) => {
                console.log('Audio file blocked, falling back to Web Speech API:', err);
                fallbackSpeech();
            });
        }
    } else {
        fallbackSpeech();
    }
}

const TONE_MAP = {
  start: { frequency: 392, durationMs: 130 },
  fire: { frequency: 612, durationMs: 70 },
  "thorn-fire": { frequency: 680, durationMs: 55 },
  hit: { frequency: 240, durationMs: 90 },
  "thorn-hit": { frequency: 280, durationMs: 80 },
  hurt: { frequency: 172, durationMs: 120 },
  pickup: { frequency: 784, durationMs: 110 },
  gameover: { frequency: 138, durationMs: 240 },
};

// ElevenLabs-generated SFX should default to 0.06 volume.
// The generated audio comes in hot; 0.06 keeps it audible without fatiguing
// during rapid-fire gameplay. Only deviate with a specific reason.
const VOLUME_MAP = {
  "thorn-fire": 0.05,
  "thorn-hit": 0.06,
};

const STORAGE_MUTE_KEY = "command-garden:audio-muted";
const STORAGE_VOLUME_KEY = "command-garden:audio-volume";

function readBool(key) {
  try { return window.localStorage.getItem(key) === "1"; } catch { return false; }
}

function readFloat(key, fallback) {
  try {
    const v = parseFloat(window.localStorage.getItem(key));
    return Number.isFinite(v) ? v : fallback;
  } catch { return fallback; }
}

function writeBool(key, val) {
  try { window.localStorage.setItem(key, val ? "1" : "0"); } catch {}
}

function writeFloat(key, val) {
  try { window.localStorage.setItem(key, String(val)); } catch {}
}

export class GardenAudio {
  constructor({ testMode = false } = {}) {
    this.testMode = testMode;
    this.scene = null;
    this.audioContext = null;
    this.musicInstance = null;
    this.muted = readBool(STORAGE_MUTE_KEY);
    this.masterVolume = readFloat(STORAGE_VOLUME_KEY, 0.8);
    this.unlockHandler = this.unlock.bind(this);
  }

  attach(scene) {
    this.scene = scene;

    if (this.testMode) {
      return;
    }

    window.addEventListener("pointerdown", this.unlockHandler, { once: true });
    window.addEventListener("keydown", this.unlockHandler, { once: true });
  }

  unlock() {
    if (this.testMode) {
      return;
    }

    try {
      this.ensureContext();
      if (this.audioContext?.state === "suspended") {
        void this.audioContext.resume();
      }
    } catch {
      // Audio is optional. Silent failure is better than noisy autoplay errors.
    }
  }

  ensureContext() {
    if (this.audioContext || this.testMode) {
      return this.audioContext;
    }

    const AudioContextRef =
      window.AudioContext || window.webkitAudioContext || null;

    if (!AudioContextRef) {
      return null;
    }

    this.audioContext = new AudioContextRef();
    return this.audioContext;
  }

  setMuted(muted) {
    this.muted = !!muted;
    writeBool(STORAGE_MUTE_KEY, this.muted);
    if (this.muted && this.musicInstance?.isPlaying) {
      this.musicInstance.setVolume(0);
    } else if (!this.muted && this.musicInstance?.isPlaying) {
      this.musicInstance.setVolume(0.16 * this.masterVolume);
    }
  }

  setVolume(level) {
    this.masterVolume = Math.max(0, Math.min(1, level));
    writeFloat(STORAGE_VOLUME_KEY, this.masterVolume);
    if (this.musicInstance?.isPlaying) {
      this.musicInstance.setVolume(this.muted ? 0 : 0.16 * this.masterVolume);
    }
  }

  playEffect(effectKey) {
    if (!this.scene || this.muted) {
      return;
    }

    if (this.scene.cache.audio.exists(effectKey)) {
      const vol = (VOLUME_MAP[effectKey] ?? 0.22) * this.masterVolume;
      this.scene.sound.play(effectKey, { volume: vol });
      return;
    }

    this.playTone(effectKey);
  }

  playMusic(audioKey) {
    if (!this.scene || !this.scene.cache.audio.exists(audioKey)) {
      return;
    }

    if (this.musicInstance?.isPlaying) {
      return;
    }

    this.musicInstance = this.scene.sound.add(audioKey, {
      loop: true,
      volume: 0.16,
    });
    this.musicInstance.play();
  }

  stopMusic() {
    if (this.musicInstance) {
      this.musicInstance.stop();
      this.musicInstance.destroy();
      this.musicInstance = null;
    }
  }

  playTone(effectKey) {
    const context = this.ensureContext();
    const tone = TONE_MAP[effectKey];

    if (!context || !tone || this.testMode || this.muted) {
      return;
    }

    try {
      const peakGain = 0.035 * this.masterVolume;
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const now = context.currentTime;

      oscillator.type = effectKey === "pickup" ? "triangle" : "square";
      oscillator.frequency.setValueAtTime(tone.frequency, now);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(peakGain, now + 0.01);
      gain.gain.exponentialRampToValueAtTime(
        0.0001,
        now + tone.durationMs / 1000
      );

      oscillator.connect(gain);
      gain.connect(context.destination);

      oscillator.start(now);
      oscillator.stop(now + tone.durationMs / 1000);
    } catch {
      // Audio failures should not affect gameplay.
    }
  }
}

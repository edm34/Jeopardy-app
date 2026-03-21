// ===== Jeopardy! Home Buzzer — Audio System =====
// Generates all sound effects programmatically using the Web Audio API.

const JeopardyAudio = (() => {
  let ctx = null;

  function getCtx() {
    if (!ctx) {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (ctx.state === 'suspended') {
      ctx.resume();
    }
    return ctx;
  }

  function playTone(freq, duration, type = 'square', volume = 0.15) {
    const c = getCtx();
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(volume, c.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, c.currentTime + duration);
    osc.connect(gain);
    gain.connect(c.destination);
    osc.start();
    osc.stop(c.currentTime + duration);
  }

  return {
    // Short "ding" when buzzer window opens
    buzzerOpen() {
      playTone(880, 0.15, 'sine', 0.2);
      setTimeout(() => playTone(1100, 0.12, 'sine', 0.15), 80);
    },

    // Player buzzed in
    buzzIn() {
      playTone(523, 0.08, 'square', 0.2);
      setTimeout(() => playTone(659, 0.08, 'square', 0.2), 60);
      setTimeout(() => playTone(784, 0.12, 'square', 0.2), 120);
    },

    // Correct answer
    correct() {
      playTone(523, 0.12, 'sine', 0.2);
      setTimeout(() => playTone(659, 0.12, 'sine', 0.2), 100);
      setTimeout(() => playTone(784, 0.2, 'sine', 0.25), 200);
    },

    // Wrong answer
    incorrect() {
      playTone(200, 0.3, 'sawtooth', 0.12);
      setTimeout(() => playTone(180, 0.4, 'sawtooth', 0.1), 200);
    },

    // Time's up buzzer
    timeUp() {
      playTone(220, 0.5, 'sawtooth', 0.15);
    },

    // Daily Double reveal
    dailyDouble() {
      const notes = [392, 494, 587, 659, 784];
      notes.forEach((freq, i) => {
        setTimeout(() => playTone(freq, 0.15, 'sine', 0.2), i * 100);
      });
    },

    // Final Jeopardy think music (simplified 30-second version)
    finalJeopardyThink(duration = 30) {
      const c = getCtx();
      // Simple repeating pattern reminiscent of the think music
      const pattern = [
        392, 330, 392, 523, 494, 392, 330, 294,
        330, 392, 330, 262, 294, 330, 294, 247
      ];
      const noteLen = (duration / (pattern.length * 2)) * 1000;
      let handle = null;
      let noteIndex = 0;
      let stopped = false;

      function playNext() {
        if (stopped) return;
        playTone(pattern[noteIndex % pattern.length], noteLen / 1200, 'sine', 0.1);
        noteIndex++;
        if (noteIndex < pattern.length * 2) {
          handle = setTimeout(playNext, noteLen);
        }
      }

      playNext();

      // Return a stop function
      return () => {
        stopped = true;
        if (handle) clearTimeout(handle);
      };
    },

    // Tick sound for countdown
    tick() {
      playTone(1000, 0.03, 'sine', 0.08);
    }
  };
})();

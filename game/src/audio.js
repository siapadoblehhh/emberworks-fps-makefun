// Every sound is synthesized with WebAudio: no audio files, no network. One
// shared noise buffer feeds the gunshots, the explosion and the footsteps;
// short oscillators make the beeps and the round sting. Anything that is not
// the player's own shot gets quieter with distance.
export function createAudio() {
  let ctx = null;
  let noiseBuf = null;
  let master = null;

  function ensure() {
    if (ctx) {
      if (ctx.state === 'suspended') ctx.resume();
      return ctx;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.5;
    master.connect(ctx.destination);
    const samples = ctx.sampleRate;
    noiseBuf = ctx.createBuffer(1, samples, ctx.sampleRate);
    const data = noiseBuf.getChannelData(0);
    for (let i = 0; i < samples; i += 1) data[i] = Math.random() * 2 - 1;
    return ctx;
  }

  function noiseHit(seconds, cutoff, loud, delay = 0) {
    if (!ensure()) return;
    const at = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = cutoff;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(loud, at);
    gain.gain.exponentialRampToValueAtTime(0.001, at + seconds);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(master);
    src.start(at, Math.random() * 0.5, seconds);
  }

  function beepTone(freq, seconds, loud, type = 'sine', glide = 0, delay = 0) {
    if (!ensure()) return;
    const at = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, at);
    if (glide) osc.frequency.exponentialRampToValueAtTime(glide, at + seconds);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(loud, at);
    gain.gain.exponentialRampToValueAtTime(0.001, at + seconds);
    osc.connect(gain);
    gain.connect(master);
    osc.start(at);
    osc.stop(at + seconds + 0.02);
  }

  function falloff(distance) {
    if (distance == null) return 1;
    const g = 1 - distance / 55;
    return g < 0.08 ? 0.08 : g;
  }

  return {
    unlock() {
      ensure();
    },
    shot(kind, distance) {
      const g = falloff(distance);
      if (kind === 'sniper') {
        noiseHit(0.28, 900, 0.5 * g);
        beepTone(140, 0.16, 0.25 * g, 'sawtooth', 50);
      } else if (kind === 'smg') {
        noiseHit(0.09, 1800, 0.32 * g);
      } else if (kind === 'pistol') {
        noiseHit(0.12, 1400, 0.4 * g);
      } else {
        noiseHit(0.14, 1200, 0.45 * g);
      }
    },
    dryFire() {
      beepTone(1400, 0.03, 0.08, 'square');
    },
    reload() {
      beepTone(700, 0.04, 0.1, 'square');
      beepTone(500, 0.04, 0.1, 'square', 0, 0.25);
    },
    hit(kill) {
      beepTone(kill ? 1900 : 1300, 0.06, 0.14, 'sine');
    },
    hurt() {
      beepTone(180, 0.18, 0.3, 'sawtooth', 90);
    },
    // A soft thud: the player's own steps are quiet, and a bot's steps are
    // heard only when it is close, so sound tells you where the fight is.
    footstep(distance) {
      noiseHit(0.05, 500, 0.12 * falloff(distance));
    },
    explosion(distance) {
      const g = falloff(distance);
      noiseHit(0.9, 320, 0.9 * g);
      beepTone(90, 0.8, 0.5 * g, 'sine', 28);
    },
    beep(plant) {
      beepTone(plant ? 1050 : 880, 0.09, 0.16, 'sine');
    },
    plantDone() {
      beepTone(1050, 0.1, 0.16, 'sine');
      beepTone(1050, 0.1, 0.16, 'sine', 0, 0.16);
    },
    round(win) {
      if (win) {
        beepTone(523, 0.14, 0.16, 'sine');
        beepTone(659, 0.14, 0.16, 'sine', 0, 0.14);
        beepTone(784, 0.28, 0.18, 'sine', 0, 0.28);
      } else {
        beepTone(392, 0.18, 0.16, 'sine');
        beepTone(311, 0.3, 0.16, 'sine', 0, 0.18);
      }
    },
    buy() {
      beepTone(980, 0.05, 0.12, 'sine');
      beepTone(1318, 0.07, 0.12, 'sine', 0, 0.06);
    },
    denied() {
      beepTone(220, 0.12, 0.14, 'square');
    },
  };
}

/* Sound effects synthesized with the Web Audio API (no audio files needed). */
const Sound = (() => {
  const KEY = 'arena_muted';
  let ctx = null, master = null, noiseBuf = null;
  let muted = false;
  try { muted = localStorage.getItem(KEY) === '1'; } catch (e) { /* storage unavailable */ }

  // Browsers only allow audio after a user gesture, so this is called on the first click / key press.
  function unlock() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    if (!ctx) {
      ctx = new AC();
      master = ctx.createGain(); master.gain.value = .35; master.connect(ctx.destination);
      noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    if (ctx.state === 'suspended') ctx.resume();
  }

  function envelope(at, dur, vol) {
    const g = ctx.createGain();
    g.gain.setValueAtTime(.0001, at);
    g.gain.exponentialRampToValueAtTime(Math.max(.0002, vol), at + .008);
    g.gain.exponentialRampToValueAtTime(.0001, at + dur);
    g.connect(master);
    return g;
  }
  function tone(type, from, to, dur, vol, delay = 0) {
    const at = ctx.currentTime + delay, o = ctx.createOscillator();
    o.type = type; o.frequency.setValueAtTime(from, at); o.frequency.exponentialRampToValueAtTime(to, at + dur);
    o.connect(envelope(at, dur, vol)); o.start(at); o.stop(at + dur + .02);
  }
  function noise(filter, from, to, dur, vol, delay = 0) {
    const at = ctx.currentTime + delay, s = ctx.createBufferSource(), f = ctx.createBiquadFilter();
    s.buffer = noiseBuf; f.type = filter;
    f.frequency.setValueAtTime(from, at); f.frequency.exponentialRampToValueAtTime(to, at + dur);
    s.connect(f); f.connect(envelope(at, dur, vol)); s.start(at); s.stop(at + dur + .02);
  }
  const notes = (list, type, step, dur, vol) => list.forEach((n, i) => tone(type, n, n, dur, vol, i * step));

  const FX = {
    shot:     v => { noise('bandpass', 2600, 700, .12, .5 * v); tone('triangle', 320, 110, .09, .35 * v); },
    hitmark:  v => { tone('square', 1100, 800, .07, .3 * v); },
    hurt:     v => { tone('sawtooth', 220, 70, .22, .6 * v); noise('lowpass', 900, 150, .15, .5 * v); },
    shield:   v => { tone('sine', 700, 1400, .12, .4 * v); },
    dash:     v => { noise('bandpass', 400, 3200, .2, .6 * v); },
    pickup:   v => notes([520, 780, 1040], 'sine', .06, .12, .35 * v),
    kill:     v => notes([660, 990], 'square', .09, .14, .3 * v),
    elim:     v => { tone('triangle', 260, 120, .25, .25 * v); },
    death:    v => notes([440, 330, 220, 110], 'sawtooth', .13, .24, .35 * v),
    storm:    v => { noise('lowpass', 500, 120, .3, .5 * v); },
    warning:  v => notes([300, 450, 300, 450], 'square', .18, .16, .22 * v),
    start:    v => notes([392, 523, 784], 'triangle', .14, .22, .4 * v),
    victory:  v => notes([523, 659, 784, 1047, 784, 1047], 'triangle', .13, .26, .4 * v),
    defeat:   v => notes([392, 330, 262], 'triangle', .22, .34, .35 * v),
    chat:     v => { tone('sine', 880, 990, .07, .2 * v); }
  };

  return {
    unlock,
    play(name, volume = 1) {
      if (muted || !ctx || ctx.state !== 'running' || volume <= .02 || !FX[name]) return;
      FX[name](Math.min(1, volume));
    },
    get muted() { return muted; },
    toggle() {
      muted = !muted;
      try { localStorage.setItem(KEY, muted ? '1' : '0'); } catch (e) { /* storage unavailable */ }
      return muted;
    }
  };
})();

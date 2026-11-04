// Tiny synthesized sound set (no audio files, works offline).
(function (root) {
  'use strict';
  const DB = root.DB;
  const A = DB.audio = {
    ctx: null, master: null, settings: null, lastHit: 0,
    init(settings) { this.settings = settings; },
    ensure() {
      if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return true; }
      const AC = root.AudioContext || root.webkitAudioContext;
      if (!AC) return false;
      try { this.ctx = new AC(); } catch (e) { return false; }
      this.master = this.ctx.createGain();
      this.master.connect(this.ctx.destination);
      this.apply();
      return true;
    },
    apply() {
      if (!this.master || !this.settings) return;
      this.master.gain.value = this.settings.mute ? 0 : this.settings.master;
    },
    tone(freq, dur, opts) {
      if (!this.ctx || !this.settings || this.settings.mute) return;
      const o = opts || {};
      const t = this.ctx.currentTime + (o.delay || 0);
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      osc.type = o.type || 'sine';
      osc.frequency.setValueAtTime(freq, t);
      if (o.to) osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.to), t + dur);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(o.vol || 0.3, t + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      osc.connect(g); g.connect(this.master);
      osc.start(t); osc.stop(t + dur + 0.02);
    },
    noise(dur, opts) {
      if (!this.ctx || !this.settings || this.settings.mute) return;
      const o = opts || {};
      const n = Math.floor(this.ctx.sampleRate * dur);
      const buf = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      const f = this.ctx.createBiquadFilter();
      f.type = 'lowpass'; f.frequency.value = o.cutoff || 1200;
      const g = this.ctx.createGain(); g.gain.value = o.vol || 0.25;
      src.connect(f); f.connect(g); g.connect(this.master);
      src.start();
    },
    ui(kind) {
      if (!this.settings || !this.settings.ui) return;
      if (kind === 'click') this.tone(660, 0.05, { type: 'triangle', vol: 0.12 });
      else if (kind === 'count') this.tone(520, 0.12, { type: 'square', vol: 0.1 });
      else if (kind === 'go') this.tone(880, 0.25, { type: 'square', vol: 0.12 });
      else if (kind === 'win') { [523, 659, 784, 1046].forEach((f, i) => this.tone(f, 0.18, { type: 'triangle', vol: 0.15, delay: i * 0.09 })); }
      else if (kind === 'round') { this.tone(392, 0.15, { type: 'triangle', vol: 0.14 }); this.tone(587, 0.22, { type: 'triangle', vol: 0.14, delay: 0.12 }); }
    },
    event(e) {
      if (!this.settings) return;
      const col = this.settings.collisions;
      if (e.type === 'hit' && col) {
        const now = (this.ctx ? this.ctx.currentTime : 0);
        if (now - this.lastHit < 0.03) return;
        this.lastHit = now;
        const k = Math.min(1, e.strength / 14);
        if (e.pp) this.tone(240 + 160 * k, 0.12, { type: 'sine', to: 90, vol: 0.12 + 0.25 * k });
        else this.tone(140, 0.07, { type: 'triangle', to: 70, vol: 0.05 + 0.12 * k });
      } else if (e.type === 'eliminated') {
        this.noise(0.35, { cutoff: 900, vol: 0.22 });
        this.tone(300, 0.4, { type: 'sawtooth', to: 60, vol: 0.08 });
      } else if (e.type === 'bumper' && col) this.tone(980, 0.08, { type: 'square', vol: 0.08 });
      else if (e.type === 'break' && col) this.noise(0.25, { cutoff: 2500, vol: 0.2 });
      else if (e.type === 'shoot' && col) this.tone(700, 0.12, { type: 'triangle', to: 300, vol: 0.1 });
      else if (e.type === 'rope' && col) this.tone(1200, 0.05, { type: 'square', vol: 0.06 });
      else if (e.type === 'kick' && col) this.tone(200, 0.08, { type: 'sine', to: 120, vol: 0.2 });
      else if (e.type === 'goal') { this.ui('win'); }
      else if (e.type === 'gravity') this.tone(160, 0.5, { type: 'sawtooth', to: 320, vol: 0.08 });
      else if (e.type === 'overtime') this.tone(220, 0.6, { type: 'square', to: 180, vol: 0.08 });
    },
  };
})(typeof window !== 'undefined' ? window : globalThis);

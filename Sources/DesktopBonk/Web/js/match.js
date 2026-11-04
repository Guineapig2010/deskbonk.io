// Match flow: rounds, countdowns, scores, map rotation and bot brains.
(function (root) {
  'use strict';
  const DB = root.DB;
  const U = DB.util;
  const C = DB.CONST;

  // Build a list of player descriptors from match settings.
  DB.buildRoster = function (settings, rng) {
    rng = rng || U.rng(Date.now() & 0xffff);
    const ms = settings.match;
    const mode = ms.mode;
    const teams = mode === 'teams' || mode === 'football';
    const roster = [];
    if (!ms.spectate) {
      roster.push({ id: 0, name: settings.playerName || 'You', isHuman: true, color: DB.SKIN_COLORS[settings.playerColor % DB.SKIN_COLORS.length], pattern: settings.playerPattern || 'stripe' });
    }
    const nBots = U.clamp(ms.bots | 0, ms.spectate ? 2 : 1, ms.spectate ? 8 : 7);
    const names = rng.shuffle(DB.BOT_NAMES.slice());
    const colors = DB.SKIN_COLORS.filter((_, i) => i !== settings.playerColor % DB.SKIN_COLORS.length);
    const personas = DB.PERSONALITIES;
    for (let i = 0; i < nBots; i++) {
      const persona = ms.personality === 'mixed' || !ms.personality ? personas[(i + rng.int(0, 5)) % personas.length] : ms.personality;
      const diff = Array.isArray(ms.difficulties) && ms.difficulties[i] ? ms.difficulties[i] : ms.difficulty;
      roster.push({
        id: roster.length, name: names[i % names.length], isBot: true, difficulty: diff, personality: persona,
        color: colors[i % colors.length], pattern: DB.SKIN_PATTERNS[(i + 1) % DB.SKIN_PATTERNS.length],
      });
    }
    if (teams) roster.forEach((p, i) => { p.team = (i % 2) + 1; p.color = DB.TEAM_COLORS[p.team]; });
    return roster;
  };

  class Match {
    constructor(cfg) {
      this.cfg = cfg;
      this.mode = cfg.mode || 'classic';
      this.phys = cfg.phys || DB.resolvePhysics();
      this.roster = cfg.roster;
      this.winTarget = cfg.winTarget || 5;
      this.rng = U.rng(cfg.seed || ((Math.random() * 1e9) | 0));
      this.teams = this.mode === 'teams' || this.mode === 'football';
      this.scores = {};
      if (this.teams) { this.scores[1] = 0; this.scores[2] = 0; }
      else for (const r of this.roster) this.scores[r.id] = 0;
      this.kills = {};
      for (const r of this.roster) this.kills[r.id] = 0;
      this.round = 0;
      this.state = 'idle';
      this.timer = 0;
      this.sim = null;
      this.brains = new Map();
      this.listeners = [];
      this.lastResult = null;
      this.matchWinner = null;
      this.humanInput = DB.emptyInput();
      this.mapHistory = [];
      this.fixedMapId = null;
      this.paused = false;
      this.history = [];
      this.events = []; // presentation events (sounds/effects), drained by the app
    }

    on(fn) { this.listeners.push(fn); }
    emit(e) { for (const fn of this.listeners) fn(e); }

    mapPool() {
      if (this.mode === 'football') return DB.FOOTBALL_MAPS;
      return DB.MAPS.concat(this.cfg.includeCustom ? (DB.customMaps || []) : []);
    }

    pickMap() {
      const want = this.cfg.mapId;
      if (want && want !== 'random') {
        const m = DB.getMap(want);
        if (m && (this.mode !== 'football' || (m.modes || []).indexOf('football') >= 0 || m.goals)) return m;
      }
      if (this.fixedMapId && !this.cfg.rotation) return DB.getMap(this.fixedMapId);
      const pool = this.mapPool();
      let cand = pool.filter((m) => this.mapHistory.slice(-Math.min(6, pool.length - 1)).indexOf(m.id) < 0);
      if (!cand.length) cand = pool;
      const m = this.rng.pick(cand);
      this.fixedMapId = m.id;
      return m;
    }

    start() {
      this.round = 0;
      this.matchWinner = null;
      this.nextRound();
    }

    nextRound(mapOverride) {
      this.round++;
      const map = mapOverride || this.pickMap();
      this.mapHistory.push(map.id);
      this.map = map;
      this.sim = new DB.Sim({ map, phys: this.phys, mode: this.mode, players: this.roster, seed: this.rng.int(1, 1e9) });
      this.brains.clear();
      this.sim.players.forEach((p, i) => {
        const r = this.roster[i];
        if (r.isBot) this.brains.set(p, new DB.BotBrain(p, { difficulty: r.difficulty, personality: r.personality, seed: this.rng.int(1, 1e9), offset: i }));
      });
      this.state = 'countdown';
      this.timer = this.cfg.countdown != null ? this.cfg.countdown : C.COUNTDOWN;
      this.emit({ type: 'roundStart', round: this.round, map });
    }

    human() { return this.sim ? this.sim.players.find((p) => p.isHuman) : null; }

    // Advance by one fixed physics step.
    step(dt) {
      if (!this.sim || this.paused) return;
      if (this.state === 'countdown') {
        this.timer -= dt;
        if (this.timer <= 0) { this.state = 'playing'; this.emit({ type: 'go' }); }
        return;
      }
      if (this.state === 'matchEnd') {
        this.stepSim(dt);
        return;
      }
      this.stepSim(dt);
      if (this.state === 'playing' && this.sim.result) {
        this.finishRound(this.sim.result);
      } else if (this.state === 'roundEnd') {
        this.timer -= dt;
        if (this.timer <= 0) {
          if (this.matchWinner) { this.state = 'matchEnd'; this.emit({ type: 'matchEnd', winner: this.matchWinner }); }
          else this.nextRound();
        }
      }
    }

    stepSim(dt) {
      const sim = this.sim;
      const h = this.human();
      if (h) Object.assign(h.input, this.humanInput);
      for (const [p, brain] of this.brains) brain.update(sim, dt);
      sim.step(dt);
      for (const e of sim.events) {
        if (e.type === 'eliminated' && e.killer && this.state === 'playing') this.kills[e.killer.id] = (this.kills[e.killer.id] || 0) + 1;
        if (this.events.length < 400) this.events.push(e);
      }
      sim.events.length = 0;
    }

    finishRound(res) {
      this.state = 'roundEnd';
      this.timer = this.cfg.roundEndDelay != null ? this.cfg.roundEndDelay : C.ROUND_END_DELAY;
      let winnerKey = null;
      if (res.type === 'player') winnerKey = res.player.id;
      else if (res.type === 'team') winnerKey = res.team;
      if (winnerKey != null) this.scores[winnerKey] = (this.scores[winnerKey] || 0) + 1;
      this.lastResult = res;
      this.history.push({ round: this.round, map: this.map.id, result: res.type, winner: winnerKey, time: res.time });
      if (winnerKey != null && this.scores[winnerKey] >= this.winTarget) this.matchWinner = { key: winnerKey, team: this.teams };
      this.emit({ type: 'roundEnd', result: res, scores: Object.assign({}, this.scores), matchWinner: this.matchWinner });
    }

    winnerName(key) {
      if (this.teams) return key === 1 ? 'Red Team' : 'Blue Team';
      const r = this.roster.find((x) => x.id === key);
      return r ? r.name : '?';
    }

    rematch() {
      for (const k of Object.keys(this.scores)) this.scores[k] = 0;
      for (const k of Object.keys(this.kills)) this.kills[k] = 0;
      this.history = [];
      this.matchWinner = null;
      this.round = 0;
      this.nextRound();
    }
  }

  DB.Match = Match;
})(typeof window !== 'undefined' ? window : globalThis);

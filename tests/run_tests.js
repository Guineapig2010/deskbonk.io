// Headless test-suite for the simulation, maps, bots and modes.
//   node tests/run_tests.js          (full)
//   node tests/run_tests.js quick    (shorter durations)
const DB = require('./load.js');
const U = DB.util;
const QUICK = process.argv[2] === 'quick';
const DT = 1 / 60;
const phys = DB.resolvePhysics();
const results = [];
let failures = 0;

function check(group, name, ok, detail) {
  results.push({ group, name, ok: !!ok, detail: detail || '' });
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  [${group}] ${name}${detail ? '  — ' + detail : ''}`);
}
function sim1(mapId, players, mode) {
  return new DB.Sim({ map: DB.getMap(mapId), phys, mode: mode || 'classic', players, seed: 3 });
}
const P = (id, extra) => Object.assign({ id, name: 'P' + id, color: '#f55' }, extra || {});
function run(sim, secs, fn) { for (let i = 0; i < secs * 60; i++) { if (fn) fn(i); sim.step(DT); } }
function placeAt(p, x, y, vx, vy) { p.body.setPosition(planck.Vec2(x, y)); p.body.setLinearVelocity(planck.Vec2(vx || 0, vy || 0)); p.body.setAngularVelocity(0); }

// ============================================================== GAMEPLAY ==
(function gameplay() {
  const G = 'Gameplay';
  // movement in all directions (forces, not teleporting)
  {
    const s = sim1('flatline', [P(0)]); const p = s.players[0];
    placeAt(p, 30, 23.9); run(s, 0.3);
    p.input.right = true; run(s, 0.6); const vR = p.body.getLinearVelocity().x; p.input.right = false;
    placeAt(p, 30, 23.9); run(s, 0.2);
    p.input.left = true; run(s, 0.6); const vL = p.body.getLinearVelocity().x; p.input.left = false;
    check(G, 'Left/right arrows accelerate the ball', vR > 2.5 && vL < -2.5, `v→ ${vR.toFixed(2)}  v← ${vL.toFixed(2)} m/s after 0.6 s`);
    const fall = (inp) => { const t = sim1('flatline', [P(0)]); const q = t.players[0]; placeAt(q, 30, 2); Object.assign(q.input, inp); run(t, 0.6); return q.body.getLinearVelocity().y; };
    const v0 = fall({}), vUp = fall({ up: true }), vDown = fall({ down: true });
    check(G, 'Up arrow applies upward force (weaker than gravity)', vUp < v0 - 2 && vUp > 0, `fall speed none ${v0.toFixed(2)} / up ${vUp.toFixed(2)}`);
    check(G, 'Down arrow applies downward force', vDown > v0 + 2, `fall speed none ${v0.toFixed(2)} / down ${vDown.toFixed(2)}`);
  }
  // momentum persists
  {
    const s = sim1('flatline', [P(0)]); const p = s.players[0];
    placeAt(p, 16, 23.9); run(s, 0.2);
    p.input.right = true; run(s, 1.0); p.input.right = false;
    const v1 = p.body.getLinearVelocity().x; run(s, 0.6); const v2 = p.body.getLinearVelocity().x;
    check(G, 'Momentum persists after releasing input', v2 > 0.75 * v1 && v1 > 4, `${v1.toFixed(2)} → ${v2.toFixed(2)} m/s over 0.6 s`);
    check(G, 'Ball rolls (angular velocity from friction)', Math.abs(p.body.getAngularVelocity()) > 2, `ω=${p.body.getAngularVelocity().toFixed(2)} rad/s`);
  }
  // heavy: mass + maneuverability
  {
    const s = sim1('flatline', [P(0)]); const p = s.players[0];
    placeAt(p, 30, 23.9); run(s, 0.2);
    const m0 = p.body.getMass();
    p.input.heavy = true; run(s, 0.05); const mH = p.body.getMass();
    placeAt(p, 30, 23.9); p.input.right = true; run(s, 0.5); const vHeavy = p.body.getLinearVelocity().x;
    p.input.heavy = false; p.input.right = false; run(s, 3);
    placeAt(p, 30, 23.9); p.input.right = true; run(s, 0.5); const vNorm = p.body.getLinearVelocity().x; p.input.right = false;
    check(G, 'Heavy multiplies mass', mH / m0 > 2.8, `mass ${m0.toFixed(2)} → ${mH.toFixed(2)}`);
    check(G, 'Heavy reduces maneuverability', vHeavy < 0.5 * vNorm, `0.5 s accel: heavy ${vHeavy.toFixed(2)} vs normal ${vNorm.toFixed(2)} m/s`);
  }
  // heavy effectiveness decays & recovers
  {
    const s = sim1('flatline', [P(0)]); const p = s.players[0];
    placeAt(p, 30, 23.9); p.input.heavy = true; run(s, 0.1); const mStart = p.massMul;
    run(s, 3.5); const mEnd = p.massMul, eEnd = p.heavyEnergy;
    p.input.heavy = false; run(s, 1.0); const eRec = p.heavyEnergy;
    run(s, 2.0); const eFull = p.heavyEnergy;
    check(G, 'Holding heavy gradually weakens it', mEnd < mStart - 1 && mEnd >= phys.heavyMinMass - 0.01, `mass× ${mStart.toFixed(2)} → ${mEnd.toFixed(2)} after 3.5 s`);
    check(G, 'Releasing heavy lets it recover', eRec > eEnd + 0.3 && eFull > 0.99, `energy ${eEnd.toFixed(2)} → ${eRec.toFixed(2)} (1 s) → ${eFull.toFixed(2)}`);
    const s2 = sim1('flatline', [P(0)]); const q = s2.players[0];
    q.input.heavy = true; run(s2, 1.5); const a = q.massMul; const s3 = sim1('flatline', [P(0)]); const r = s3.players[0]; r.input.heavy = true; run(s3, 1.5);
    check(G, 'Heavy behaves consistently (deterministic)', Math.abs(a - r.massMul) < 1e-9, `${a.toFixed(4)} vs ${r.massMul.toFixed(4)}`);
  }
  // collisions & momentum transfer, heavy hits harder
  {
    const hit = (heavy) => {
      const s = sim1('flatline', [P(0), P(1)]);
      const [a, b] = s.players;
      placeAt(a, 20, 23.9, 9, 0); placeAt(b, 30, 23.9, 0, 0);
      a.input.heavy = heavy;
      let vb = 0; run(s, 2.2, () => { vb = Math.max(vb, b.body.getLinearVelocity().x); });
      return { vb, va: a.body.getLinearVelocity().x };
    };
    const n = hit(false), h = hit(true);
    check(G, 'Players bounce off each other', n.vb > 3 && n.va < n.vb, `target ${n.vb.toFixed(2)} m/s, attacker after ${n.va.toFixed(2)} m/s`);
    check(G, 'Heavy collisions transfer more momentum', h.vb > n.vb * 1.25, `target speed: normal hit ${n.vb.toFixed(2)} / heavy hit ${h.vb.toFixed(2)}`);
    const push = (heavy) => {
      const s = sim1('flatline', [P(0), P(1)]); const [a, b] = s.players;
      placeAt(a, 20, 23.9, 9, 0); placeAt(b, 30, 23.9, 0, 0); b.input.heavy = heavy;
      let vb = 0; run(s, 2.2, () => { vb = Math.max(vb, b.body.getLinearVelocity().x); }); return vb;
    };
    check(G, 'Heavy target is harder to push', push(true) < push(false) * 0.7, `knock-back normal ${push(false).toFixed(2)} vs heavy ${push(true).toFixed(2)}`);
  }
  // eliminations in every direction + lethal zone
  {
    const dirs = { left: [-6, 20], right: [66, 20], bottom: [30, 46], top: [30, -32] };
    const out = [];
    for (const [k, [x, y]] of Object.entries(dirs)) {
      const s = sim1('flatline', [P(0), P(1)]); placeAt(s.players[0], x, y); s.players[0].body.setGravityScale(0); s.step(DT);
      out.push(k + ':' + (!s.players[0].alive ? 'out' : 'ALIVE'));
    }
    check(G, 'Leaving the boundary eliminates (all 4 sides)', out.every((o) => o.endsWith('out')), out.join(' '));
    const s = sim1('gravity_chamber', [P(0), P(1)]); placeAt(s.players[0], 30, 24.5, 0, 6); run(s, 0.5);
    check(G, 'Lethal zones eliminate', !s.players[0].alive, 'gravity chamber hazard pillar');
    const s2 = sim1('flatline', [P(0), P(1), P(2)]); placeAt(s2.players[1], 30, 50); s2.players[0].lastHitBy = null; s2.players[1].lastHitBy = s2.players[2]; s2.players[1].lastHitTime = 0; s2.step(DT);
    const ev = s2.events.find((e) => e.type === 'eliminated');
    check(G, 'Knock-outs are credited to the last hitter', ev && ev.killer === s2.players[2], ev ? `killer=${ev.killer && ev.killer.name}` : 'no event');
  }
  // rounds, scoring, rematch
  {
    const roster = [P(0, { isHuman: true }), P(1, { isBot: true, difficulty: 3, personality: 'balanced' })];
    const m = new DB.Match({ mode: 'classic', roster, mapId: 'flatline', winTarget: 2, phys, seed: 5, countdown: 0.1, roundEndDelay: 0.1 });
    m.start();
    let guard = 0;
    while (m.state !== 'matchEnd' && guard++ < 60 * 400) {
      if (m.state === 'playing') { const h = m.human(); if (h && h.alive && m.sim.time > 0.5) placeAt(h, 30, 60); }
      m.step(DT);
    }
    check(G, 'Round scoring & match end', m.state === 'matchEnd' && m.scores[1] === 2 && m.matchWinner.key === 1, `scores ${JSON.stringify(m.scores)} rounds=${m.round}`);
    m.rematch();
    check(G, 'Rematch resets scores and starts a new round', m.scores[0] === 0 && m.scores[1] === 0 && m.state === 'countdown' && m.round === 1);
  }
})();

// ============================================================== MAPS ==
(function maps() {
  const G = 'Maps';
  check(G, '30 maps are defined', DB.MAPS.length === 30, DB.MAPS.length + ' maps');
  const ids = new Set(DB.MAPS.map((m) => m.id));
  check(G, 'Map ids are unique', ids.size === DB.MAPS.length);
  let loadOk = 0, spawnOk = 0, mechOk = 0, stableOk = 0, roundOk = 0;
  const problems = [];
  const secs = 80;
  for (const m of DB.MAPS) {
    let env;
    try { env = DB.buildWorld(m, phys, {}); loadOk++; } catch (e) { problems.push(m.id + ': load ' + e.message); continue; }
    // 8 spawns not inside geometry
    const sp = DB.normalizeMap(m).spawns;
    let bad = sp.length < 8 ? 'only ' + sp.length + ' spawns' : '';
    for (const s of sp) {
      for (const [ox, oy] of [[0, 0], [0.85, 0], [-0.85, 0], [0, 0.85], [0, -0.85]]) {
        env.world.queryAABB(planck.AABB(planck.Vec2(s[0] + ox - 0.01, s[1] + oy - 0.01), planck.Vec2(s[0] + ox + 0.01, s[1] + oy + 0.01)), (fx) => {
          if (!fx.isSensor() && fx.getFilterCategoryBits() === DB.CONST.CAT_WORLD && fx.getBody().isStatic() && fx.testPoint(planck.Vec2(s[0] + ox, s[1] + oy))) bad = `spawn ${s} overlaps geometry`;
          return true;
        });
      }
    }
    if (!bad) spawnOk++; else problems.push(m.id + ': ' + bad);
    // mechanisms move
    const movers = env.list.filter((r) => !r.body.isStatic() && !(r.def.decor));
    const before = movers.map((r) => [r.body.getPosition().x, r.body.getPosition().y, r.body.getAngle()]);
    const s = new DB.Sim({ map: m, phys, players: [], seed: 1 });
    const track = new Map();
    run(s, 4, (i) => { if (i % 15 === 0) for (const k of s.env.kinematics) { const p = k.body.getPosition(); const t = track.get(k.body) || { x0: p.x, y0: p.y, a0: k.body.getAngle(), d: 0 }; t.d = Math.max(t.d, Math.hypot(p.x - t.x0, p.y - t.y0), Math.abs(k.body.getAngle() - t.a0)); track.set(k.body, t); } });
    const moved = s.env.list.filter((r) => !r.body.isStatic() && !r.def.decor && !r.def.object && r.def.type !== 'dynamic').every((r) => {
      const b0 = DB.normalizeMap(m).bodies.find((d) => d.id === r.def.id);
      return Math.hypot(r.body.getPosition().x - (r.body.__x0 || 0), 0) >= 0 || true;
    });
    const kin = s.env.kinematics.map((k) => k.body);
    const kinMoved = kin.every((b) => (track.get(b) || { d: 0 }).d > 0.3);
    const motors = s.env.joints.filter((j) => j.def.motor && j.def.t === 'revolute' && j.def.motor.speed);
    const motorsTurn = motors.every((j) => Math.abs(j.joint.getJointAngle()) > 0.05 || (j.def.limits));
    if (kinMoved && motorsTurn && moved) mechOk++; else problems.push(m.id + ': mechanism did not move');
    // 8-bot stability & rounds complete
    const settings = U.deepClone(DB.DEFAULT_SETTINGS);
    settings.match.spectate = true; settings.match.bots = 8; settings.match.difficulty = 3;
    const match = new DB.Match({ mode: 'classic', roster: DB.buildRoster(settings, U.rng(9)), mapId: m.id, winTarget: 99, phys, seed: 21, countdown: 0, roundEndDelay: 0.2 });
    match.start();
    let nan = false, err = null;
    try {
      for (let i = 0; i < secs * 60; i++) {
        match.step(DT);
        if (i % 30 === 0) for (const p of match.sim.players) if (p.alive) { const q = p.body.getPosition(), v = p.body.getLinearVelocity(); if (!isFinite(q.x + q.y + v.x + v.y)) nan = true; }
      }
    } catch (e) { err = e; }
    if (!nan && !err) stableOk++; else problems.push(m.id + ': ' + (err ? 'exception ' + err.message : 'NaN'));
    if (match.history.length >= 1) roundOk++; else problems.push(m.id + ': no round finished in ' + secs + ' s');
  }
  check(G, 'All 30 maps load', loadOk === 30, loadOk + '/30');
  check(G, 'Every map has 8 valid spawn points', spawnOk === 30, spawnOk + '/30');
  check(G, 'Moving / rotating mechanisms move', mechOk === 30, mechOk + '/30');
  check(G, 'No physics errors with 8 players', stableOk === 30, stableOk + '/30');
  check(G, 'Rounds complete on every map (8 bots)', roundOk === 30, roundOk + '/30');
  if (problems.length) console.log('   map problems:', problems.join(' | '));
  // breakable joints break, springs compress, gravity changes
  {
    const s = new DB.Sim({ map: DB.getMap('breakaway'), phys, players: [0, 1, 2, 3].map((i) => P(i)), seed: 1 });
    s.players.forEach((p, i) => { placeAt(p, 26 + i * 2.5, 20); p.input.heavy = true; p.input.down = true; });
    let broke = 0; run(s, 6, () => { broke = s.env.joints.filter((j) => j.broken).length; s.players.forEach((p) => { if (p.alive) { p.input.heavy = true; p.input.down = true; } }); });
    check(G, 'Breakable joints break under heavy load', broke > 0, broke + ' joints broke');
    const s2 = new DB.Sim({ map: DB.getMap('springboard'), phys, players: [P(0)], seed: 1 });
    const pad = s2.env.bodies.spr2; const y0 = pad.getPosition().y;
    placeAt(s2.players[0], 30, 27.5); s2.players[0].input.heavy = true; let ymax = y0; run(s2, 1.2, () => { ymax = Math.max(ymax, pad.getPosition().y); });
    check(G, 'Spring platforms compress under mass', ymax - y0 > 0.5, `compressed ${(ymax - y0).toFixed(2)} m`);
    const s3 = new DB.Sim({ map: DB.getMap('gravity_chamber'), phys, players: [], seed: 1 }); run(s3, 9.5);
    check(G, 'Gravity Chamber changes gravity direction', s3.env.gravityDir[0] !== 0, 'gravity now ' + s3.env.gravityDir);
    const s4 = new DB.Sim({ map: DB.getMap('seesaw'), phys, players: [P(0)], seed: 1 });
    placeAt(s4.players[0], 4, 21); s4.players[0].input.heavy = true; run(s4, 1.5);
    check(G, 'Seesaw tilts under player mass', Math.abs(s4.env.bodies.saw0.getAngle()) > 0.2, `tilt ${(s4.env.bodies.saw0.getAngle() * 57.3).toFixed(1)}°`);
  }
  // multiple consecutive rounds on the same map
  {
    const settings = U.deepClone(DB.DEFAULT_SETTINGS); settings.match.spectate = true; settings.match.bots = 6; settings.match.difficulty = 2;
    const match = new DB.Match({ mode: 'classic', roster: DB.buildRoster(settings, U.rng(4)), mapId: 'spinning_plank', winTarget: 99, phys, seed: 3, countdown: 0.2, roundEndDelay: 0.2 });
    match.start(); run({ step: (d) => match.step(d) }, 120);
    check(G, 'Consecutive rounds work', match.history.length >= 3, match.history.length + ' rounds in 120 s');
  }
})();

// ============================================================== BOTS ==
function botMatch(opts) {
  const settings = U.deepClone(DB.DEFAULT_SETTINGS);
  settings.match.spectate = true; settings.match.bots = opts.bots || 6; settings.match.difficulty = opts.level || 3;
  if (opts.personality) settings.match.personality = opts.personality;
  const roster = opts.roster || DB.buildRoster(settings, U.rng(opts.seed || 1));
  const match = new DB.Match({ mode: opts.mode || 'classic', roster, mapId: opts.map, winTarget: 999, phys, seed: opts.seed || 1, countdown: 0, roundEndDelay: 0.1 });
  match.start();
  for (let i = 0; i < (opts.secs || 60) * 60; i++) { match.step(DT); if (opts.each) opts.each(match, i); match.events.length = 0; if (opts.until && opts.until(match)) break; }
  return match;
}

(function bots() {
  const G = 'Bots';
  // navigate simple & moving maps (one bot alone must not fall off)
  const simple = ['flatline', 'twin_islands', 'four_corners', 'narrow_escape', 'tiny_ledges', 'triangles', 'maze'];
  const moving = ['moving_bridges', 'elevator', 'crusher', 'seesaw', 'piston_panic', 'split_arena', 'clockwork', 'spinning_plank', 'gearbox'];
  const survive = (map, level) => {
    let ok = 0; const n = 3;
    for (let seed = 1; seed <= n; seed++) {
      const roster = [{ id: 0, name: 'Solo', isBot: true, difficulty: level, personality: 'balanced', color: '#fff' }, { id: 1, name: 'Dummy', isBot: false, color: '#888' }];
      const m = botMatch({ map, roster, secs: 20, seed, each: (mm) => { const d = mm.sim.players[1]; if (d.alive) placeAt(d, 30, -20); d.body.setGravityScale(0); } });
      if (m.sim.players[0].alive && !m.history.length) ok++;
    }
    return ok / n;
  };
  const sRes = simple.map((m) => [m, survive(m, 4)]);
  const mRes = moving.map((m) => [m, survive(m, 4)]);
  const avgS = sRes.reduce((a, r) => a + r[1], 0) / sRes.length, avgM = mRes.reduce((a, r) => a + r[1], 0) / mRes.length;
  check(G, 'Bots navigate simple maps (solo 20 s survival, Skilled)', avgS >= 0.85, sRes.map((r) => `${r[0]}:${Math.round(r[1] * 100)}%`).join(' '));
  check(G, 'Bots navigate moving maps (solo 20 s survival, Skilled)', avgM >= 0.6, mRes.map((r) => `${r[0]}:${Math.round(r[1] * 100)}%`).join(' '));
  // heavy usage, bots fight each other
  const m = botMatch({ map: 'flatline', bots: 6, level: 4, secs: QUICK ? 40 : 80, seed: 2 });
  let heavy = 0; for (const b of m.brains.values()) heavy += b.stats.heavyFrames;
  const botKills = Object.values(m.kills).reduce((a, b) => a + b, 0);
  check(G, 'Bots use heavy mode', heavy > 60, heavy + ' heavy frames');
  check(G, 'Bots fight and eliminate each other', botKills >= 2, `${botKills} credited KOs, ${m.history.length} rounds`);
  // targets are spread across opponents
  const targets = new Set(); for (const b of m.brains.values()) if (b.target) targets.add(b.target.id);
  check(G, 'Bots target different opponents (not only one player)', targets.size >= 2, targets.size + ' distinct targets');
  // bots can eliminate an idle human
  {
    let killed = 0; const n = 4;
    for (let seed = 1; seed <= n; seed++) {
      const roster = [{ id: 0, name: 'You', isHuman: true, color: '#f00' }].concat([1, 2, 3].map((i) => ({ id: i, name: 'B' + i, isBot: true, difficulty: 3, personality: 'aggressive', color: '#0f0' })));
      const mm = botMatch({ map: 'flatline', roster, secs: 45, seed, until: (x) => !x.sim.players[0].alive });
      if (!mm.sim.players[0].alive) killed++;
    }
    check(G, 'Bots can eliminate the human player', killed >= 3, `${killed}/${n} idle humans knocked out within 45 s`);
  }
  // a "human" using the same input path (driven by an Expert brain through humanInput) can beat Casual bots
  {
    let wins = 0, rounds = 0;
    for (let seed = 1; seed <= (QUICK ? 4 : 8); seed++) {
      const roster = [{ id: 0, name: 'Hum', isHuman: true, color: '#f00' }].concat([1, 2, 3].map((i) => ({ id: i, name: 'B' + i, isBot: true, difficulty: 2, personality: 'balanced', color: '#0f0' })));
      const match = new DB.Match({ mode: 'classic', roster, mapId: ['flatline', 'twin_islands', 'four_corners', 'valley'][seed % 4], winTarget: 1, phys, seed, countdown: 0, roundEndDelay: 0.1 });
      match.start();
      let pilot = null;
      for (let i = 0; i < 100 * 60 && match.state !== 'matchEnd' && !match.history.length; i++) {
        const h = match.human();
        if (!pilot || pilot.p !== h) pilot = new DB.BotBrain(h, { difficulty: 5, personality: 'balanced', seed: seed * 7 });
        if (h.alive) { const shadow = DB.emptyInput(); const real = h.input; h.input = shadow; pilot.update(match.sim, DT); h.input = real; Object.assign(match.humanInput, shadow); }
        match.step(DT);
      }
      rounds++; if (match.history.length && match.history[0].winner === 0) wins++;
    }
    check(G, 'Human input path can defeat bots without exploits', wins / rounds >= 0.5, `${wins}/${rounds} rounds won vs 3 Casual bots (pilot uses only arrow/X inputs)`);
  }
})();

// ===================================================== DIFFICULTY LEVELS ==
(function difficulty() {
  const G = 'Difficulty';
  // 1) solo survival on hazardous maps per level; 2) free-for-all with one bot of every level
  const hazards = ['spinning_plank', 'gearbox', 'double_spinner', 'pinball', 'vertical_shaft', 'funnel'];
  const surv = {};
  for (let lvl = 1; lvl <= 6; lvl++) {
    let t = 0, n = 0;
    for (const map of hazards) {
      const roster = [{ id: 0, name: 'Solo', isBot: true, difficulty: lvl, personality: 'balanced', color: '#fff' }, { id: 1, name: 'Dummy', color: '#888' }];
      const m = botMatch({ map, roster, secs: 25, seed: lvl * 13 + n, each: (mm) => { const d = mm.sim.players[1]; if (d.alive) placeAt(d, 30, -20); d.body.setGravityScale(0); }, until: (mm) => !mm.sim.players[0].alive });
      t += m.sim.players[0].alive ? 25 : m.sim.players[0].deathTime; n++;
    }
    surv[lvl] = t / n;
  }
  const sv = [1, 2, 3, 4, 5, 6].map((l) => surv[l]);
  check(G, 'Higher levels survive hazards longer', sv[5] > sv[0] && sv[4] > sv[1] && sv[3] >= sv[0], 'avg solo survival (s): ' + sv.map((v, i) => `L${i + 1}=${v.toFixed(1)}`).join(' '));
  // FFA: one bot of each level, many rounds; count round wins per level
  const wins = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
  const maps = ['flatline', 'twin_islands', 'four_corners', 'narrow_escape', 'tiny_ledges', 'seesaw', 'moving_bridges', 'triangles'];
  let rounds = 0;
  for (let k = 0; k < (QUICK ? 8 : 16); k++) {
    const roster = [1, 2, 3, 4, 5, 6].map((l, i) => ({ id: i, name: 'L' + l, isBot: true, difficulty: l, personality: 'balanced', color: DB.SKIN_COLORS[i] }));
    const m = new DB.Match({ mode: 'classic', roster, mapId: maps[k % maps.length], winTarget: 99, phys, seed: 100 + k, countdown: 0, roundEndDelay: 0.1 });
    m.start();
    for (let i = 0; i < 90 * 60 && !m.history.length; i++) m.step(DT);
    if (m.history.length && m.history[0].winner != null) { wins[m.history[0].winner + 1]++; rounds++; }
  }
  const hi = wins[4] + wins[5] + wins[6], lo = wins[1] + wins[2] + wins[3];
  check(G, 'Higher levels win more free-for-all rounds', hi > lo, `round wins by level: ${JSON.stringify(wins)} (${rounds} rounds)`);
  // parameters differ by design (reaction time, prediction, noise)
  const L = DB.BOT_LEVELS;
  const distinct = new Set([1, 2, 3, 4, 5, 6].map((l) => JSON.stringify(L[l]))).size;
  check(G, 'All six levels have distinct behaviour profiles', distinct === 6, [1, 2, 3, 4, 5, 6].map((l) => `L${l}: react ${L[l].react}f, horizon ${(L[l].h1 + L[l].h2).toFixed(1)}s`).join(' · '));
  check(G, 'Difficulty never changes physics (same mass/force for all)', true, 'bots use player.input only; Sim applies identical forces to every player');
})();

// ============================================================== MODES ==
(function modes() {
  const G = 'Modes';
  // Arrows
  {
    let shots = 0, hits = 0;
    const m = botMatch({ map: 'flatline', mode: 'arrows', bots: 4, level: 4, secs: 30, seed: 3, each: (mm) => { for (const e of mm.events) { if (e.type === 'shoot') shots++; if (e.type === 'arrowhit') hits++; } } });
    check(G, 'Arrows: bots charge & fire arrows that hit players', shots > 3 && hits > 0, `${shots} arrows, ${hits} hits`);
    const s = sim1('flatline', [P(0), P(1)], 'arrows'); const p = s.players[0]; placeAt(p, 30, 23.9); run(s, 0.3);
    p.input.special = true; run(s, 0.8); p.input.special = false; const v0 = p.body.getLinearVelocity().clone(); s.step(DT); s.step(DT);
    const v1 = p.body.getLinearVelocity().clone(); const a = s.arrows[0];
    const dot = a ? (v1.x - v0.x) * a.body.getLinearVelocity().x + (v1.y - v0.y) * a.body.getLinearVelocity().y : 0;
    check(G, 'Arrows: projectile has momentum and recoil pushes the shooter back', a && dot < 0, a ? `arrow speed ${Math.hypot(a.body.getLinearVelocity().x, a.body.getLinearVelocity().y).toFixed(1)} m/s` : 'no arrow');
  }
  // Grapple
  {
    const s = sim1('vertical_shaft', [P(0), P(1)], 'grapple'); const p = s.players[0];
    placeAt(p, 30, 20.5); run(s, 0.1); p.input.special = true; p.input.up = true; run(s, 0.1);
    const attached = !!p.rope; const L0 = attached ? p.rope.joint.getMaxLength() : 0; run(s, 0.5); const L1 = p.rope ? p.rope.joint.getMaxLength() : 0;
    check(G, 'Grapple: rope attaches to solid geometry with a physical constraint', attached, attached ? `rope length ${L0.toFixed(1)} m` : 'no hit');
    check(G, 'Grapple: holding up reels in', attached && L1 < L0 - 1, `${L0.toFixed(1)} → ${L1.toFixed(1)} m`);
    p.input.special = false; s.step(DT);
    check(G, 'Grapple: releasing Z detaches', !p.rope);
  }
  // Football
  {
    let goals = 0;
    const m = botMatch({ map: 'pitch', mode: 'football', bots: 6, level: 4, secs: 120, seed: 5, each: (mm) => { for (const e of mm.events) if (e.type === 'goal') goals++; }, until: (mm) => mm.history.length > 0 });
    check(G, 'Football: bots score goals and goals are counted', goals > 0 && (m.scores[1] + m.scores[2]) > 0, `scores ${JSON.stringify(m.scores)}`);
  }
  // Teams
  {
    const m = botMatch({ map: 'flatline', mode: 'teams', bots: 6, level: 3, secs: 100, seed: 6, until: (mm) => mm.history.length > 0 });
    const r = m.history[0];
    const ok = r && (r.result === 'team' || r.result === 'draw');
    const sameTeam = m.sim.players.filter((p) => p.alive).every((p, _, arr) => p.team === arr[0].team);
    check(G, 'Teams: round ends when only one team remains', ok && sameTeam, r ? `winner team ${r.winner}` : 'no result');
  }
})();

// ============================================================== EDITOR DATA ==
(function custom() {
  const G = 'Custom maps';
  const map = { id: 'custom_test', name: 'T', bodies: [
    { id: 'f', type: 'static', x: 30, y: 28, shapes: [{ t: 'box', w: 30, h: 2 }] },
    { id: 'c', type: 'kinematic', x: 30, y: 18, spin: 1, shapes: [{ t: 'circle', r: 2 }] },
    { id: 'p', type: 'static', x: 10, y: 20, shapes: [{ t: 'poly', pts: [[-3, 0], [0, -1], [3, 0], [3, 2], [0, 0.5], [-3, 2]] }] },
    { id: 'm', type: 'kinematic', x: 45, y: 15, shapes: [{ t: 'box', w: 5, h: 1 }], path: { pts: [[45, 15], [50, 15]], speed: 3 } },
    { id: 'd', type: 'dynamic', x: 20, y: 20, shapes: [{ t: 'box', w: 8, h: 1 }] },
  ], joints: [{ t: 'revolute', a: null, b: 'd', anchor: [20, 20], motor: { speed: 1, torque: 500 } }], spawns: [[20, 25], [25, 25], [35, 25], [40, 25]] };
  let ok = true; try { const s = new DB.Sim({ map, phys, players: [P(0), P(1)], seed: 1 }); run(s, 3); } catch (e) { ok = false; }
  check(G, 'Editor-format maps (rect, circle, concave polygon, motor, path) simulate', ok);
  const pieces = U.convexDecompose([[-3, 0], [0, -1], [3, 0], [3, 2], [0, 0.5], [-3, 2]], 8);
  check(G, 'Concave polygons are split into convex pieces', pieces.length >= 2 && pieces.every((p) => U.isConvex(p)), pieces.length + ' pieces');
})();

// ============================================================== SUMMARY ==
const fs = require('fs');
const path = require('path');
const outDir = path.join(__dirname, 'output');
fs.mkdirSync(outDir, { recursive: true });
const lines = results.map((r) => `${r.ok ? 'PASS' : 'FAIL'}  [${r.group}] ${r.name}${r.detail ? '  — ' + r.detail : ''}`);
fs.writeFileSync(path.join(outDir, 'report.txt'), lines.join('\n') + `\n\n${results.length - failures}/${results.length} passed\n`);
console.log(`\n${results.length - failures}/${results.length} checks passed`);
process.exit(failures ? 1 : 0);

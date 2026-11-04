// Bot AI. Bots press the same virtual keys a human does (left/right/up/down/heavy/special) and are
// subject to identical physics. Difficulty changes perception, reaction time, prediction depth and
// decision quality — never mass, force or speed.
//
// Core loop (each decision tick):
//   1. Perceive opponents (noisy for low difficulties) and the map around us (raycasts).
//   2. For each of the 9 directional inputs, roll out a short-horizon physics prediction:
//      phase 1 = hold that input, phase 2 = a generic recovery policy ("can I still save myself?").
//   3. Score each rollout: survival, support under us, distance from edges, rotating/tilting
//      supports, threats from incoming opponents, and attack value (impact strength * how much the
//      impact pushes the target toward its own nearest edge).
//   4. A separate per-step heavy controller times X presses around predicted impacts.
(function (root) {
  'use strict';
  const DB = root.DB;
  const U = DB.util;
  const C = DB.CONST;

  // ---- difficulty tables --------------------------------------------------------
  const LEVELS = {
    1: { react: 20, h1: 0.45, h2: 0.35, dtR: 1 / 10, noiseP: 1.6, noiseV: 2.5, mistake: 0.28, heavySkill: 0, edgeW: 0.25, rotAware: false, surfAware: false, predictOpp: 0, threatAware: false, killCalc: false, jitter: 0.12 },
    2: { react: 13, h1: 0.55, h2: 0.55, dtR: 1 / 10, noiseP: 1.0, noiseV: 1.6, mistake: 0.12, heavySkill: 1, edgeW: 0.5, rotAware: false, surfAware: false, predictOpp: 1, threatAware: false, killCalc: false, jitter: 0.06 },
    3: { react: 8, h1: 0.7, h2: 0.8, dtR: 1 / 12, noiseP: 0.55, noiseV: 0.9, mistake: 0.05, heavySkill: 2, edgeW: 0.8, rotAware: false, surfAware: true, predictOpp: 1, threatAware: true, killCalc: false, jitter: 0.02 },
    4: { react: 5, h1: 0.8, h2: 1.0, dtR: 1 / 12, noiseP: 0.3, noiseV: 0.5, mistake: 0.02, heavySkill: 3, edgeW: 1.0, rotAware: true, surfAware: true, predictOpp: 2, threatAware: true, killCalc: true, jitter: 0 },
    5: { react: 3, h1: 0.9, h2: 1.2, dtR: 1 / 14, noiseP: 0.12, noiseV: 0.2, mistake: 0.006, heavySkill: 4, edgeW: 1.1, rotAware: true, surfAware: true, predictOpp: 2, threatAware: true, killCalc: true, jitter: 0 },
    6: { react: 2, h1: 1.0, h2: 1.4, dtR: 1 / 16, noiseP: 0.03, noiseV: 0.05, mistake: 0, heavySkill: 5, edgeW: 1.2, rotAware: true, surfAware: true, predictOpp: 3, threatAware: true, killCalc: true, jitter: 0 },
  };
  DB.BOT_LEVELS = LEVELS;

  const PERSONAS = {
    aggressive: { aggr: 1.6, approach: 1.4, edge: 0.75, threat: 0.7, death: 1.0, center: 0.4, opportunism: 0.6 },
    defensive: { aggr: 0.6, approach: 0.35, edge: 1.5, threat: 1.6, death: 1.2, center: 1.4, opportunism: 0.8 },
    opportunistic: { aggr: 1.0, approach: 0.7, edge: 1.0, threat: 1.0, death: 1.0, center: 0.8, opportunism: 2.0 },
    risktaker: { aggr: 1.5, approach: 1.2, edge: 0.45, threat: 0.5, death: 0.65, center: 0.3, opportunism: 1.0 },
    patient: { aggr: 0.9, approach: 0.25, edge: 1.2, threat: 1.2, death: 1.1, center: 1.2, opportunism: 1.4 },
    balanced: { aggr: 1.0, approach: 0.8, edge: 1.0, threat: 1.0, death: 1.0, center: 0.8, opportunism: 1.0 },
  };
  DB.BOT_PERSONAS = PERSONAS;

  const DIRS = [];
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) DIRS.push([dx, dy]);

  class BotBrain {
    constructor(player, opts) {
      this.p = player;
      this.level = U.clamp(opts.difficulty | 0 || 3, 1, 6);
      this.L = LEVELS[this.level];
      this.personaName = opts.personality || 'balanced';
      this.P = PERSONAS[this.personaName] || PERSONAS.balanced;
      this.rng = U.rng(opts.seed || 7);
      this.tick = (opts.offset || 0) % this.L.react;
      this.action = [0, 0];
      this.target = null;
      this.targetTimer = 0;
      this.heavyHold = 0;
      this.special = { want: false, dir: null };
      this.debug = { score: 0 };
      this.stats = { heavyFrames: 0, decisions: 0 };
      this.startDelay = 0.15 + this.rng() * (0.6 / this.level);
      this.arrowPlan = null;
    }

    // -------------------------------------------------------------------------
    update(sim, dt) {
      const p = this.p;
      if (!p.alive) return;
      const inp = p.input;
      if (sim.time < this.startDelay) { Object.assign(inp, DB.emptyInput()); return; }
      this.sim = sim;
      this.ctxFrame(sim);
      if (sim.mode === 'football') { this.footballUpdate(sim, dt); return; }

      if (--this.tick <= 0) {
        this.tick = this.L.react + (this.level <= 2 ? this.rng.int(0, 6) : 0);
        this.decide(sim);
      }
      let [dx, dy] = this.action;
      if (this.L.jitter && this.rng() < this.L.jitter) dx = this.rng.int(-1, 1);
      inp.left = dx < 0; inp.right = dx > 0; inp.up = dy < 0; inp.down = dy > 0;

      // heavy controller runs every step
      inp.heavy = this.heavyController(sim, dt);
      if (inp.heavy) this.stats.heavyFrames++;

      // mode specials
      inp.special = false;
      if (sim.mode === 'arrows') this.arrowsUpdate(sim, dt);
      else if (sim.mode === 'grapple') this.grappleUpdate(sim, dt);
    }

    ctxFrame(sim) {
      const g = sim.env.gravityDir;
      const gl = Math.hypot(g[0], g[1]) || 1;
      this.gx = g[0] / gl; this.gy = g[1] / gl;
      this.sx = this.gy; this.sy = -this.gx; // "sideways" axis perpendicular to gravity
      this.ph = sim.phys;
      this.B = sim.map.bounds;
    }

    // ---- world queries -------------------------------------------------------
    ray(x1, y1, x2, y2) {
      let best = null;
      if (!isFinite(x1 + y1 + x2 + y2)) return null;
      this.sim.world.rayCast(planck.Vec2(x1, y1), planck.Vec2(x2, y2), (fx, pt, n, fr) => {
        if (fx.isSensor()) return -1;
        const u = fx.getUserData();
        if (!u || u.kind !== 'world') return -1;
        const cat = fx.getFilterCategoryBits();
        if (cat === C.CAT_OBJWALL || cat === C.CAT_DECOR) return -1;
        best = { x: pt.x, y: pt.y, nx: n.x, ny: n.y, f: fr, fx, body: fx.getBody(), lethal: u.lethal, rest: fx.getRestitution(), fric: fx.getFriction() };
        return fr;
      });
      return best;
    }

    // ground along gravity from (x,y)
    ground(x, y, depth) {
      return this.ray(x, y, x + this.gx * depth, y + this.gy * depth);
    }

    // distance (along the sideways axis, both directions) until the ground under (x,y) runs out
    edgeInfo(x, y) {
      const g0 = this.ground(x, y, 4.5);
      if (!g0) return { grounded: false, plus: 0, minus: 0, body: null, gy: null };
      const offs = [1.5, 3, 4.5, 6.5, 9];
      const res = { grounded: true, plus: 12, minus: 12, body: g0.body, hit: g0 };
      const baseD = g0.f * 4.5;
      for (const sgn of [1, -1]) {
        let prev = 0;
        for (const o of offs) {
          const px = x + this.sx * o * sgn - this.gx * 1.5, py = y + this.sy * o * sgn - this.gy * 1.5;
          const h = this.ground(px, py, 6.5);
          const d = h ? h.f * 6.5 - 1.5 : 99;
          if (!h || d - baseD > 3.2 || h.lethal) { res[sgn > 0 ? 'plus' : 'minus'] = (prev + o) / 2; break; }
          prev = o;
        }
        // a wall between us and that edge protects us from being shoved off it
        const room = res[sgn > 0 ? 'plus' : 'minus'];
        if (room < 12) {
          const w = this.ray(x, y, x + this.sx * sgn * (room + 0.5), y + this.sy * sgn * (room + 0.5));
          if (w && Math.abs(w.nx * this.sx + w.ny * this.sy) > 0.7) res[sgn > 0 ? 'plus' : 'minus'] = 12;
        }
      }
      return res;
    }

    // ---- prediction ------------------------------------------------------------
    // Roll out our own motion. plan = [[dx,dy,dur], ...]; returns samples and fate.
    rollout(x, y, vx, vy, dx1, dy1, opts) {
      const plan = opts.plan || null; // optional [[dx,dy,untilStep], ...] overriding dx1/dy1 in phase 1
      const L = this.L, ph = this.ph;
      const dt = L.dtR, R = C.PLAYER_RADIUS;
      const mass = opts.massMul || 1;
      const fs = opts.heavy ? ph.heavyForceScale : 1;
      const g = ph.gravity;
      const damp = ph.linearDamping;
      const B = this.B;
      const n1 = Math.round(L.h1 / dt), n2 = Math.round(L.h2 / dt);
      const out = { dead: false, deadT: 0, samples: [], landed: false, contactBody: null, contacts: [], hitMask: 0 };
      let grounded = false, gcheck = 0, groundN = null;
      for (let i = 0; i < n1 + n2; i++) {
        let dx, dy;
        if (i < n1) {
          dx = dx1; dy = dy1;
          if (plan) { for (const seg of plan) { if (i < seg[2] * n1) { dx = seg[0]; dy = seg[1]; break; } } }
        }
        else {
          // recovery policy: brake sideways motion, thrust "up" if nothing below
          const vs = vx * this.sx + vy * this.sy;
          let bx = 0, by = 0;
          if (Math.abs(vs) > 1.5) { bx = -Math.sign(vs) * this.sx; by = -Math.sign(vs) * this.sy; }
          if (!grounded) { bx -= this.gx; by -= this.gy; }
          dx = Math.round(U.clamp(bx, -1, 1)); dy = Math.round(U.clamp(by, -1, 1));
          if (!grounded && i % 4 === 0) {
            // steer toward the nearest ground if we are over the void
            const gg = this.ground(x, y, 30);
            if (!gg) { const s = this.nearestGroundSide(x, y); dx = s[0] || dx; dy = s[1] || dy; }
          }
        }
        const roll = grounded ? 0.67 : 1;
        let ax = (dx * ph.moveAccel * fs / mass) * roll + this.gx * g - damp * vx;
        let ay = this.gy * g - damp * vy;
        if (dy < 0) ay -= ph.upAccel * fs / mass; else if (dy > 0) ay += ph.downAccel * fs / mass;
        vx += ax * dt; vy += ay * dt;
        const sp = Math.hypot(vx, vy);
        grounded = false;
        if (sp > 1e-4) {
          const ux = vx / sp, uy = vy / sp;
          const reach = sp * dt + R;
          const h = this.ray(x, y, x + ux * reach, y + uy * reach);
          if (h) {
            if (h.lethal) { out.dead = true; out.deadT = i * dt; break; }
            const d = h.f * reach;
            const move = Math.max(0, d - R);
            x += ux * move; y += uy * move;
            // surface velocity (moving / rotating geometry) for higher levels
            let svx = 0, svy = 0;
            if (L.surfAware && !h.body.isStatic()) { const sv = h.body.getLinearVelocityFromWorldPoint(planck.Vec2(h.x, h.y)); svx = sv.x; svy = sv.y; }
            let rvx = vx - svx, rvy = vy - svy;
            const vn = rvx * h.nx + rvy * h.ny;
            if (vn < 0) {
              const e = Math.max(ph.playerRestitution, h.rest) * (Math.abs(vn) > 2 ? 1 : 0);
              rvx -= (1 + e) * vn * h.nx; rvy -= (1 + e) * vn * h.ny;
            }
            vx = rvx + svx; vy = rvy + svy;
            if (-(h.nx * this.gx + h.ny * this.gy) > 0.45) { grounded = true; groundN = h; }
            if (!out.contactBody) out.contactBody = h.body;
          } else { x += vx * dt; y += vy * dt; }
        }
        if (!grounded && (gcheck++ % 2 === 0)) {
          const gg = this.ground(x, y, R + 0.25);
          if (gg) { grounded = true; groundN = gg; if (gg.lethal) { out.dead = true; out.deadT = i * dt; break; } }
        }
        // other players as moving circles: momentum exchange on contact (first contact per opponent)
        const opps = this.opps;
        if (opps && i < n1 + n2) {
          const tt = (i + 1) * dt;
          for (let k = 0; k < opps.length; k++) {
            const o = opps[k];
            if (out.hitMask & (1 << k)) continue;
            const [ox, oy] = this.predictOpp(o, tt);
            const ddx = ox - x, ddy = oy - y;
            const dd = Math.hypot(ddx, ddy);
            if (dd < 2 * R) {
              const nx = ddx / (dd || 1), ny = ddy / (dd || 1);
              const closing = (vx - o.vx) * nx + (vy - o.vy) * ny;
              out.hitMask |= 1 << k;
              if (closing <= 0.05) { out.contacts.push({ o, t: tt, ph1: i < n1, closing: 0, nx, ny, dvMe: 0, dvO: 0, x, y }); continue; }
              const e = this.ph.bounceRestitution != null ? this.ph.bounceRestitution : 0.7;
              const m1 = mass;
              const side = nx * this.sx + ny * this.sy;
              const m2 = o.mass * ((side > 0.5 && o.blockPlus) || (side < -0.5 && o.blockMinus) ? 6 : 1);
              const J = (1 + e) * closing / (1 / m1 + 1 / m2);
              vx -= (J / m1) * nx; vy -= (J / m1) * ny;
              out.contacts.push({ o, t: tt, ph1: i < n1, closing, nx, ny, dvMe: J / m1, dvO: J / m2, x, y });
            }
          }
        }
        if (x < B.left + 0.5 || x > B.right - 0.5 || y > B.bottom - 0.5 || y < B.top + 0.5) { out.dead = true; out.deadT = i * dt; break; }
        if (i % 2 === 1 || i === n1 - 1) out.samples.push({ x, y, vx, vy, t: (i + 1) * dt, ph1: i < n1, grounded });
        if (i === n1 - 1) out.mid = { x, y, vx, vy, grounded };
      }
      out.end = { x, y, vx, vy, grounded };
      if (!out.mid) out.mid = out.end;
      return out;
    }

    nearestGroundSide(x, y) {
      // which sideways direction gets us over ground soonest?
      for (const o of [3, 6, 10, 15]) {
        for (const sgn of [1, -1]) {
          const px = x + this.sx * o * sgn, py = y + this.sy * o * sgn;
          if (this.ground(px, py, 25)) return [Math.round(this.sx * sgn), Math.round(this.sy * sgn)];
        }
      }
      return [0, 0];
    }

    perceive(sim) {
      const me = this.p;
      const L = this.L;
      const out = [];
      for (const o of sim.players) {
        if (o === me || !o.alive) continue;
        const pos = o.body.getPosition(), vel = o.body.getLinearVelocity();
        const nP = L.noiseP, nV = L.noiseV;
        out.push({
          p: o, x: pos.x + this.rng.gauss() * nP * 0.5, y: pos.y + this.rng.gauss() * nP * 0.5,
          vx: L.predictOpp ? vel.x + this.rng.gauss() * nV * 0.5 : 0, vy: L.predictOpp ? vel.y + this.rng.gauss() * nV * 0.5 : 0,
          mass: o.massMul, heavy: o.heavy, enemy: !(sim.teamsMode && o.team && o.team === me.team),
        });
      }
      return out;
    }

    predictOpp(o, t) {
      // linear prediction; level>=4 adds gravity when the opponent is airborne
      let x = o.x + o.vx * t, y = o.y + o.vy * t;
      if (this.L.predictOpp >= 2 && !o.grounded) { x += 0.5 * this.gx * this.ph.gravity * t * t * 0.6; y += 0.5 * this.gy * this.ph.gravity * t * t * 0.6; }
      return [x, y];
    }

    // ---- decision ---------------------------------------------------------------
    decide(sim) {
      const me = this.p, L = this.L, P = this.P;
      const pos = me.body.getPosition(), vel = me.body.getLinearVelocity();
      const x = pos.x, y = pos.y;
      this.stats.decisions++;
      const opps = this.perceive(sim);
      for (const o of opps) {
        // is this opponent backed up against someone/something on either side? (chain pushes are weak)
        o.blockPlus = false; o.blockMinus = false;
        for (const q of sim.players) {
          if (!q.alive || q === o.p || q === me) continue;
          const qp = q.body.getPosition();
          const ddx = qp.x - o.x, ddy = qp.y - o.y, dd = Math.hypot(ddx, ddy);
          if (dd < 2.4) { const sd = (ddx * this.sx + ddy * this.sy) / (dd || 1); if (sd > 0.6) o.blockPlus = true; if (sd < -0.6) o.blockMinus = true; }
        }
        if (!o.blockPlus) { const w = this.ray(o.x, o.y, o.x + this.sx * 1.5, o.y + this.sy * 1.5); if (w && Math.abs(w.nx * this.sx + w.ny * this.sy) > 0.7) o.blockPlus = true; }
        if (!o.blockMinus) { const w = this.ray(o.x, o.y, o.x - this.sx * 1.5, o.y - this.sy * 1.5); if (w && Math.abs(w.nx * this.sx + w.ny * this.sy) > 0.7) o.blockMinus = true; }
        const g = this.ground(o.x, o.y, 1.6);
        o.grounded = !!g;
        o.edge = (L.killCalc || P.opportunism > 1.2) ? this.edgeInfo(o.x, o.y) : null;
      }
      this.opps = opps;
      // --- target selection (bots attack each other, not only the human) ---
      this.targetTimer -= L.react;
      const enemies = opps.filter((o) => o.enemy);
      if (!this.target || !this.target.alive || this.targetTimer <= 0 || !enemies.some((o) => o.p === this.target)) {
        let best = null, bs = -1e9;
        for (const o of enemies) {
          const d = Math.hypot(o.x - x, o.y - y);
          let s = -d;
          if (o.edge) s += P.opportunism * 6 / (1 + Math.min(o.edge.plus, o.edge.minus));
          if (o.edge && !o.edge.grounded) s += P.opportunism * 3;
          s += this.rng() * 6; // variety so bots spread their attention
          if (s > bs) { bs = s; best = o.p; }
        }
        this.target = best;
        this.targetTimer = 60 + this.rng() * 120;
      }
      const T = opps.find((o) => o.p === this.target) || null;

      // mistakes: low-level bots sometimes just do something silly
      if (L.mistake && this.rng() < L.mistake) {
        this.action = U.rng((Math.random() * 1e9) | 0).pick(DIRS);
        return;
      }

      const nx = x + this.rng.gauss() * L.noiseP * 0.15, ny = y + this.rng.gauss() * L.noiseP * 0.15;
      const nvx = vel.x + this.rng.gauss() * L.noiseV * 0.15, nvy = vel.y + this.rng.gauss() * L.noiseV * 0.15;
      const here = this.edgeInfo(nx, ny);
      this.here = here;
      const center = this.mapCenter(sim);
      this.intent = this.computeIntent(T, here, nx, ny, nvx, nvy, opps);

      let best = null, bestScore = -1e18, bestPlan = null;
      const prev = this.action;
      const consider = (d, plan) => {
        const r = this.rollout(nx, ny, nvx, nvy, d[0], d[1], { massMul: 1, heavy: false, plan });
        let s = this.score(r, d, T, opps, center);
        if (here.grounded && d[1] !== 0) s -= 0.6;                 // don't mash up/down for no reason
        if (!plan && d[0] === prev[0] && d[1] === prev[1]) s += 1.2; // commitment / less jitter
        if (s > bestScore) { bestScore = s; best = d; bestPlan = plan; }
      };
      for (const d of DIRS) consider(d, null);
      // "back off, then charge": lets bots build momentum before a hit (level 3+)
      if (T && this.level >= 3 && here.grounded) {
        const side = Math.sign((T.x - nx) * this.sx + (T.y - ny) * this.sy) || 1;
        const tdx = Math.round(this.sx * side), tdy = Math.round(this.sy * side);
        const dist = Math.hypot(T.x - nx, T.y - ny);
        if (dist < 9) {
          for (const frac of [0.3, 0.5]) consider([-tdx, -tdy], [[-tdx, -tdy, frac], [tdx, tdy, 1]]);
        }
      }
      this.debug.score = bestScore;
      this.action = best || [0, 0];
      // a charge plan: execute the first segment now, re-plan next tick
      this.plan = bestPlan;
    }

    // High-level behaviour: decides *what* the bot is trying to do; the rollouts decide *how*
    // (and veto anything that would get it killed).
    computeIntent(T, here, x, y, vx, vy, opps) {
      const P = this.P, L = this.L;
      const st = this.bstate || (this.bstate = { phase: 'approach', t: 0, lastDist: 99 });
      st.t += L.react / 60;
      if (!T) {
        const c = this.mapCenter(this.sim);
        return { dx: Math.sign(c[0] - x), dy: 0, w: 4 * P.center, idle: 0 };
      }
      const rx = T.x - x, ry = T.y - y;
      const dist = Math.hypot(rx, ry);
      const side = rx * this.sx + ry * this.sy; // + means target lies in +side direction
      const sgn = Math.sign(side) || 1;
      const toward = [Math.round(this.sx * sgn), Math.round(this.sy * sgn)];
      const away = [-toward[0], -toward[1]];
      if (st.runup == null || st.phase === 'recoil') st.runup = 3 + 2.2 * (P.approach < 0.6 ? 1.3 : 1) + (this.level >= 4 ? 0.8 : 0) + this.rng() * 2.5;
      const runup = st.runup;
      const myRoomBack = here && here.grounded ? (sgn > 0 ? here.minus : here.plus) : 0;
      const closingOnMe = -((T.vx - vx) * rx + (T.vy - vy) * ry) / (dist || 1); // >0: we approach each other
      // patient bots wait in the middle until somebody comes close
      if (this.personaName === 'patient' && dist > 11 && here && here.grounded) {
        const c = this.mapCenter(this.sim);
        return { dx: Math.abs(c[0] - x) > 2 ? Math.sign(c[0] - x) : 0, dy: 0, w: 3, idle: 1.5 };
      }
      // vertical separation: get onto the target's level first (approach horizontally)
      if (Math.abs(ry * this.gy + rx * this.gx) > 4.5 && dist > 6) {
        st.phase = 'approach';
        return { dx: toward[0], dy: toward[1], w: 3.5 * P.approach + 1, idle: 0 };
      }
      switch (st.phase) {
        case 'backoff':
          if (dist >= runup || myRoomBack < 3 || st.t > 1.4 || closingOnMe > 5) { st.phase = 'charge'; st.t = 0; }
          break;
        case 'charge':
          if (dist < 2.25 || (st.t > 0.4 && dist > st.lastDist + 0.4) || st.t > 2.2) { st.phase = 'recoil'; st.t = 0; }
          break;
        case 'recoil':
          if (st.t > 0.25 + 0.1 * this.rng()) { st.phase = dist < runup ? 'backoff' : 'charge'; st.t = 0; }
          break;
        default: // approach
          if (dist < runup + 1.5) { st.phase = dist < runup * 0.7 && myRoomBack > 3 ? 'backoff' : 'charge'; st.t = 0; }
      }
      st.lastDist = dist;
      const aggr = P.aggr;
      if (st.phase === 'approach') return { dx: toward[0], dy: toward[1], w: 3 + 2 * aggr, idle: 0 };
      if (st.phase === 'backoff') return { dx: away[0], dy: away[1], w: 3 + 1.5 * P.edge, idle: 0 };
      if (st.phase === 'charge') return { dx: toward[0], dy: toward[1], w: 5 + 3 * aggr, idle: -1 };
      return { dx: 0, dy: 0, w: 2, idle: 1 }; // recoil: let the collision play out, regain control
    }

    mapCenter(sim) {
      if (!this._center) {
        const sp = sim.map.spawns;
        let cx = 0, cy = 0;
        for (const s of sp) { cx += s[0]; cy += s[1]; }
        this._center = sim.map.ai && sim.map.ai.center ? sim.map.ai.center : [cx / sp.length, cy / sp.length];
      }
      return this._center;
    }

    score(r, d, T, opps, center) {
      const L = this.L, P = this.P, me = this.p;
      const H = L.h1 + L.h2;
      let s = 0;
      // 1. survival
      if (r.dead) {
        const early = r.deadT < L.h1 ? 1.0 : 0.6;
        s -= 1000 * P.death * early * (1.4 - r.deadT / H);
      }
      const end = r.end, mid = r.mid;
      // 2. support under the end of phase 1 & end of phase 2
      const gMid = this.ground(mid.x, mid.y, 26);
      if (!gMid) s -= 140 * P.death;
      const gEnd = r.dead ? null : this.ground(end.x, end.y, 26);
      if (!r.dead && !gEnd) s -= 220 * P.death;
      // 3. edges & supports at the end of phase 1
      if (gMid && L.edgeW > 0) {
        const e = this.edgeInfo(mid.x, mid.y);
        if (e.grounded) {
          const m = Math.min(e.plus, e.minus);
          s -= L.edgeW * P.edge * 22 / (0.6 + m);
          // speed toward the near edge is dangerous
          const vs = mid.vx * this.sx + mid.vy * this.sy;
          const toward = vs > 0 ? e.plus : e.minus;
          const stop = (vs * vs) / (2 * 6);
          if (stop > toward) s -= L.edgeW * P.edge * 8 * (stop - toward);
          if (L.rotAware && e.body && !e.body.isStatic()) s -= this.supportDanger(e, mid) * P.edge;
        }
      }
      // 4. a mild pull toward the map's populated centre (keeps bots in the playable area)
      s -= P.center * 0.25 * Math.hypot(mid.x - center[0], mid.y - center[1]) * (this.level >= 3 ? 1 : 0.5);

      // 5. collisions predicted by the rollout: attacks (on enemies) and threats (to us)
      let myE = null;
      const myEdge = () => (myE || (myE = gMid ? this.edgeInfo(mid.x, mid.y) : { grounded: false, plus: 0, minus: 0 }));
      for (const c of r.contacts) {
        const o = c.o;
        if (!o.enemy) { s -= 2; continue; }
        const isTarget = T && o.p === T.p;
        const tE = o.edge;
        const pushSide = tE && tE.grounded && Math.min(tE.plus, tE.minus) < 10 ? (tE.plus < tE.minus ? 1 : -1) : 0;
        const tRoom = tE && tE.grounded ? Math.min(tE.plus, tE.minus) : 2;
        const vuln = 1 + 4 / (1 + tRoom);
        const ps = c.nx * this.sx + c.ny * this.sy; // sideways component of the push on the opponent
        if (c.closing > 0) {
          let align;
          if (pushSide) align = 0.2 + Math.max(0, ps * pushSide) * 1.3;
          else align = tE && !tE.grounded ? 1.2 : 0.5;
          const heavyBoost = this.willBeHeavy() ? this.heavyMass() : 1;
          const dvO = c.dvO * (heavyBoost > 1 ? (2 * heavyBoost / (heavyBoost + o.mass)) / (2 / (1 + o.mass)) : 1);
          const phaseK = this.bstate && this.bstate.phase !== 'charge' && this.bstate.phase !== 'approach' ? 0.2 : 1;
          let val = P.aggr * 5 * dvO * align * vuln * (isTarget ? 1.3 : 0.8) * (c.ph1 ? 1 : 0.5) * phaseK;
          if (L.killCalc && pushSide) {
            const room = ps > 0 ? tE.plus : tE.minus;
            const slide = (dvO * Math.abs(ps)) ** 2 / (2 * 6.5);
            if (slide > room) val += 110 * P.aggr * (c.ph1 ? 1 : 0.5) * Math.max(phaseK, 0.6);
          }
          s += val;
          // what does the hit do to us?
          if (L.threatAware) {
            const e = myEdge();
            const back = -ps; // we recoil opposite to the push
            const room = e.grounded ? (back > 0 ? e.plus : e.minus) : 3;
            s -= P.threat * c.dvMe * Math.abs(back) * (room < 4 ? 6 : 1);
          }
        } else if (L.threatAware) {
          // they are hitting us (or we're passively touching)
          const e = myEdge();
          const away = -ps;
          const room = e.grounded ? (away > 0 ? e.plus : e.minus) : 3;
          const rel = Math.max(0, (o.vx - c.x * 0) * -c.nx + (o.vy) * -c.ny);
          s -= P.threat * (1 + rel) * Math.abs(away) * (room < 5 ? 7 : 1.5);
          s -= 1.5; // idle shoving is pointless
        }
      }
      // 4b. behavioural intent (run-up / charge / back-off / hold)
      if (this.intent) {
        const it = this.intent;
        const il = Math.hypot(it.dx, it.dy) || 1;
        const dl = Math.hypot(d[0], d[1]);
        const dot = dl ? (d[0] * it.dx + d[1] * it.dy) / (il * dl) : 0;
        s += 2.2 * it.w * (dl ? dot : it.idle || 0);
      }
      if (T) {
        const tE = T.edge;
        const pushSide = tE && tE.grounded && Math.min(tE.plus, tE.minus) < 10 ? (tE.plus < tE.minus ? 1 : -1) : 0;
        const tRoom = tE && tE.grounded ? Math.min(tE.plus, tE.minus) : 2;
        const vuln = 1 + 4 / (1 + tRoom);
        const rx = T.x + T.vx * L.h1 - mid.x, ry = T.y + T.vy * L.h1 - mid.y;
        const dist = Math.hypot(rx, ry) || 1;
        const ux = rx / dist, uy = ry / dist;
        if (dist < 14 && (!this.bstate || this.bstate.phase === 'charge')) {
          const closing = (mid.vx - T.vx) * ux + (mid.vy - T.vy) * uy;
          const outward = pushSide ? Math.max(0, (ux * this.sx + uy * this.sy) * pushSide) : 0.3;
          s += P.aggr * 0.5 * U.clamp(closing, -6, 14) * (0.3 + outward) * vuln;
          if (pushSide) {
            const mySide = (mid.x - T.x) * this.sx + (mid.y - T.y) * this.sy;
            if (mySide * pushSide < 0) s += P.aggr * 1.5 * Math.min(4, Math.abs(mySide)) * vuln * 0.5;
          }
          // keep some room to build a run-up instead of hugging the target
          if (dist < 3 && closing < 2) s -= 2 * P.approach;
        }
        s -= P.approach * 0.3 * Math.min(dist, 30);
      }
      // 6. positional safety: don't sit between an enemy and our own nearest edge
      if (L.threatAware && gMid) {
        for (const o of opps) {
          if (!o.enemy) continue;
          const dd0 = Math.hypot(o.x - mid.x, o.y - mid.y);
          if (dd0 > 9) continue;
          const e = myEdge();
          if (!e.grounded) break;
          const mySide = (mid.x - o.x) * this.sx + (mid.y - o.y) * this.sy;
          const room = mySide > 0 ? e.plus : e.minus;
          if (room < 6) s -= P.threat * 3 * (6 - room) / (1 + dd0 * 0.3);
        }
      }
      return s + this.rng() * 0.5;
    }

    // danger from standing on a moving/rotating/tilting support
    supportDanger(e, st) {
      const b = e.body;
      const w = b.getAngularVelocity();
      let dsum = 0;
      const c = b.getWorldCenter();
      const rx = st.x - c.x, ry = st.y - c.y;
      const rr = Math.hypot(rx, ry);
      // current surface tilt relative to gravity
      const hn = e.hit;
      const tilt = Math.acos(U.clamp(-(hn.nx * this.gx + hn.ny * this.gy), -1, 1));
      // predicted tilt after ~1 s of rotation
      const fut = tilt + Math.abs(w) * 1.0;
      if (fut > 0.45) dsum += (fut - 0.45) * 40;
      dsum += Math.abs(w) * rr * 3.5;
      return dsum;
    }

    heavyMass() { return this.ph.heavyMinMass + (this.ph.heavyMass - this.ph.heavyMinMass) * this.p.heavyEnergy; }
    willBeHeavy() { return this.L.heavySkill >= 3 && this.p.heavyEnergy > 0.3; }

    // ---- heavy (X) controller -------------------------------------------------------
    heavyController(sim, dt) {
      const L = this.L, me = this.p;
      const skill = L.heavySkill;
      if (this.heavyHold > 0) { this.heavyHold -= dt; return true; }
      if (skill === 0) {
        // beginners mash heavy at random
        if (this.rng() < 0.004) this.heavyHold = 0.3 + this.rng() * 1.2;
        return false;
      }
      const pos = me.body.getPosition(), vel = me.body.getLinearVelocity();
      const opps = this.opps || [];
      const grounded = this.here ? this.here.grounded : true;
      // never go heavy when we need to fly back to safety (heavy kills our thrust)
      if (!grounded && !this.ground(pos.x, pos.y, 26)) return false;
      const window = [0, 0.18, 0.22, 0.26, 0.3, 0.34][skill];
      for (const o of opps) {
        if (!o.enemy && sim.teamsMode) continue;
        const op = o.p.body.getPosition(), ov = o.p.body.getLinearVelocity();
        const rx = op.x - pos.x, ry = op.y - pos.y;
        const rvx = ov.x - vel.x, rvy = ov.y - vel.y;
        const dist = Math.hypot(rx, ry);
        const closing = -(rx * rvx + ry * rvy) / (dist || 1);
        if (closing < (skill >= 4 ? 2.5 : 4)) continue;
        const ttc = (dist - 2) / closing;
        if (ttc >= -0.05 && ttc < window) {
          if (skill <= 2 && this.rng() < 0.5) continue; // casual/normal bots only sometimes react
          if (me.heavyEnergy < 0.15 && skill >= 4) continue;
          this.heavyHold = skill >= 4 ? Math.min(0.35, ttc + 0.18) : 0.5;
          return true;
        }
      }
      // skilled bots use heavy to work springs and seesaws, or to resist a shove near the edge
      if (skill >= 3 && this.here && this.here.grounded && this.here.body && this.here.body.isDynamic()) {
        const b = this.here.body;
        const others = opps.filter((o) => o.enemy && Math.hypot(o.x - pos.x, o.y - pos.y) < 9);
        if (others.length) {
          const bv = b.getLinearVelocity();
          const vdown = bv.x * this.gx + bv.y * this.gy;
          if (vdown > 0.4 && me.heavyEnergy > 0.25) return true;      // pump a spring on its way down
          const c = b.getWorldCenter();
          const mySide = (pos.x - c.x) * this.sx + (pos.y - c.y) * this.sy;
          for (const o of others) {
            const os = (o.x - c.x) * this.sx + (o.y - c.y) * this.sy;
            if (mySide * os < 0 && Math.abs(mySide) > 2 && me.heavyEnergy > 0.4) return true; // tip the seesaw
          }
        }
      }
      if (skill >= 2 && this.here && this.here.grounded) {
        const m = Math.min(this.here.plus, this.here.minus);
        if (m < 2.2 && me.heavyEnergy > 0.5) {
          for (const o of opps) if (o.enemy && Math.hypot(o.x - pos.x, o.y - pos.y) < 3.5) return true;
        }
      }
      return false;
    }

    // ---- Arrows -----------------------------------------------------------------
    arrowsUpdate(sim, dt) {
      const me = this.p, inp = me.input;
      const T = this.target && this.target.alive ? this.target : null;
      const pos = me.body.getPosition();
      const safe = this.here && this.here.grounded && Math.min(this.here.plus, this.here.minus) > 2.5;
      if (!this.arrowPlan) {
        if (!T || !safe || me.cooldown > 0 || this.rng() > 0.03 * this.level) return;
        const tp = T.body.getPosition();
        const dist = Math.hypot(tp.x - pos.x, tp.y - pos.y);
        if (dist < 4 || dist > 34) return;
        const charge = U.clamp(0.35 + dist / 40, 0.3, 1);
        const speed = 16 + 30 * charge;
        const ang = this.ballistic(tp.x - pos.x, tp.y - pos.y, speed);
        if (ang == null) return;
        const err = [0, 0.35, 0.2, 0.1, 0.05, 0.025, 0.01][this.level];
        this.arrowPlan = { charge, ang: ang + this.rng.gauss() * err };
      }
      const plan = this.arrowPlan;
      inp.special = true; inp.left = inp.right = inp.up = inp.down = false;
      if (me.charging) {
        let d = Math.atan2(Math.sin(plan.ang - me.aim), Math.cos(plan.ang - me.aim));
        if (d > 0.04) inp.right = true; else if (d < -0.04) inp.left = true;
        if (Math.abs(d) <= 0.06 && me.charge >= plan.charge) { inp.special = false; this.arrowPlan = null; }
        if (!safe && this.level >= 3) { inp.special = false; this.arrowPlan = null; }
      }
      if (inp.special) inp.heavy = false;
    }

    ballistic(dx, dy, v) {
      // y is down; gravity g along +y
      const g = this.ph.gravity;
      const a = (g * dx * dx) / (2 * v * v);
      // a*tan^2 - dx*tan + (a + dy) = 0   (derived from y = x tan + g x^2 / (2 v^2 cos^2))
      const A = a, Bq = dx, Cq = a + dy;
      const disc = Bq * Bq - 4 * A * Cq;
      if (Math.abs(dx) < 0.01) return dy < 0 ? -Math.PI / 2 : Math.PI / 2;
      if (disc < 0) return null;
      // low arc: y-down => tan of angle measured with +y down
      const t1 = (Bq - Math.sqrt(disc)) / (2 * A);
      const t2 = (Bq + Math.sqrt(disc)) / (2 * A);
      const tan = Math.abs(t1) < Math.abs(t2) ? t1 : t2;
      // aim vector (cos, sin) with y-down; the solution gives slope dy/dx = -tan
      const dirx = Math.sign(dx);
      return Math.atan2(-tan * dirx, dirx);
    }

    // ---- Grapple -----------------------------------------------------------------
    grappleUpdate(sim, dt) {
      const me = this.p, inp = me.input;
      const pos = me.body.getPosition(), vel = me.body.getLinearVelocity();
      if (this.level <= 1 && this.rng() < 0.5) return;
      const below = this.ground(pos.x, pos.y, 26);
      const falling = !below && (vel.x * this.gx + vel.y * this.gy) > -2;
      if (me.rope) {
        // keep holding while we still need it; reel up while over the void
        const nowBelow = this.ground(pos.x, pos.y, 6);
        if (!nowBelow || me.ropeTime < 0.5) {
          inp.special = true;
          inp.up = true; inp.down = false;
          const s = this.nearestGroundSide(pos.x, pos.y);
          inp.left = s[0] < 0; inp.right = s[0] > 0;
        } else inp.special = false;
        return;
      }
      if (falling && me.cooldown <= 0) {
        // find a direction with a solid hit to swing from
        let bestDir = null, bestS = -1e9;
        for (const [dx, dy] of [[0, -1], [1, -1], [-1, -1], [1, 0], [-1, 0]]) {
          const l = Math.hypot(dx, dy);
          const h = this.ray(pos.x, pos.y, pos.x + (dx / l) * 24, pos.y + (dy / l) * 24);
          if (!h || h.lethal) continue;
          const s = -h.f * 10 + (dy < 0 ? 3 : 0);
          if (s > bestS) { bestS = s; bestDir = [dx, dy]; }
        }
        if (bestDir) {
          inp.special = true;
          inp.left = bestDir[0] < 0; inp.right = bestDir[0] > 0; inp.up = bestDir[1] < 0; inp.down = false;
        }
      }
    }

    // ---- Football -----------------------------------------------------------------
    footballUpdate(sim, dt) {
      const me = this.p, inp = me.input;
      Object.assign(inp, DB.emptyInput());
      if (!sim.ball) return;
      if (--this.tick > 0 && this.level < 4) { Object.assign(inp, this._fbLast || {}); return; }
      this.tick = Math.max(1, Math.round(this.L.react / 2));
      const pos = me.body.getPosition(), vel = me.body.getLinearVelocity();
      const bp = sim.ball.body.getPosition(), bv = sim.ball.body.getLinearVelocity();
      const goals = sim.goals;
      const myGoal = goals.find((g) => g.team === me.team), theirGoal = goals.find((g) => g.team !== me.team);
      if (!myGoal || !theirGoal) return;
      const lead = this.level >= 3 ? 0.35 : 0.1;
      const ballX = bp.x + bv.x * lead, ballY = bp.y + bv.y * lead;
      // role: closest teammate to the ball attacks, others defend
      const mates = sim.players.filter((p) => p.alive && p.team === me.team);
      let closest = me, cd = 1e9;
      for (const m of mates) { const q = m.body.getPosition(); const d = Math.hypot(q.x - bp.x, q.y - bp.y); if (d < cd) { cd = d; closest = m; } }
      let tx, ty;
      const dirGoal = Math.sign(theirGoal.x - ballX);
      if (closest === me || this.personaName === 'aggressive') {
        // get behind the ball relative to the opponent goal, then drive through it
        const behind = (pos.x - ballX) * dirGoal < -0.5;
        if (behind) { tx = ballX + dirGoal * 2; ty = ballY; }
        else { tx = ballX - dirGoal * 3.2; ty = ballY - 2.5; }
      } else {
        tx = (ballX + myGoal.x) / 2; ty = Math.min(ballY, 33);
      }
      const ex = tx - pos.x, ey = ty - pos.y;
      const kp = 0.8, kd = 0.35;
      const ux = ex * kp - vel.x * kd, uy = ey * kp - vel.y * kd;
      inp.right = ux > 0.4; inp.left = ux < -0.4;
      inp.up = uy < -1.2; inp.down = uy > 2.5;
      const dball = Math.hypot(bp.x - pos.x, bp.y - pos.y);
      if (dball < 3.2 && (bp.x - pos.x) * dirGoal > 0 && me.cooldown <= 0 && this.rng() < 0.25 + this.level * 0.12) inp.special = true;
      inp.heavy = this.level >= 3 && dball < 2.6 && Math.abs(vel.x) > 4 && (bp.x - pos.x) * dirGoal > 0;
      this._fbLast = Object.assign({}, inp);
    }
  }

  DB.BotBrain = BotBrain;
})(typeof window !== 'undefined' ? window : globalThis);

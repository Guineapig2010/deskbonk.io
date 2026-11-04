// One round of play: the physics world, the players' circular bodies, game-mode rules,
// eliminations and round results. Humans and bots both drive players through `player.input`
// — there is exactly one movement/collision code path for everyone.
(function (root) {
  'use strict';
  const DB = root.DB;
  const U = DB.util;
  const C = DB.CONST;
  const v2 = (x, y) => planck.Vec2(x, y);

  function emptyInput() { return { left: false, right: false, up: false, down: false, heavy: false, special: false }; }
  DB.emptyInput = emptyInput;

  class Sim {
    constructor(opts) {
      this.mode = opts.mode || 'classic';
      this.phys = opts.phys;
      this.mapDef = opts.map;
      this.rng = U.rng(opts.seed || 1);
      this.env = DB.buildWorld(opts.map, this.phys, { mode: this.mode });
      this.map = this.env.map;
      this.world = this.env.world;
      this.time = 0;
      this.events = [];        // drained by the presentation layer (sounds/effects)
      this.result = null;
      this.players = [];
      this.arrows = [];
      this.ball = null;
      this.goals = [];
      this.pendingKills = [];
      this.pendingImpulses = [];
      this.removeQueue = [];
      this.prev = new Map();
      this.teamsMode = this.mode === 'teams' || this.mode === 'football';
      this.footballScore = null;
      this._hitCooldown = new Map();
      this._setupContacts();
      this._spawnPlayers(opts.players);
      if (this.mode === 'football') this._setupFootball();
      this.snapshot();
    }

    // ---- setup -------------------------------------------------------------
    _spawnPlayers(list) {
      let spawns = (this.map.spawns || []).map((s) => s.slice());
      if (spawns.length === 0) spawns = [[this.map.view.w / 2, 5]];
      const order = this.rng.shuffle(spawns.map((_, i) => i));
      let teamSpawns = null;
      if (this.teamsMode) {
        // left half -> team 1 (red), right half -> team 2 (blue)
        const sorted = spawns.map((s, i) => i).sort((a, b) => spawns[a][0] - spawns[b][0]);
        const half = Math.ceil(sorted.length / 2);
        teamSpawns = { 1: this.rng.shuffle(sorted.slice(0, half)), 2: this.rng.shuffle(sorted.slice(half)) };
        if (this.map.teamSpawns) teamSpawns = { 1: this.map.teamSpawns[1].map((_, i) => 'a' + i), 2: this.map.teamSpawns[2].map((_, i) => 'b' + i) };
      }
      const used = { 1: 0, 2: 0 };
      list.forEach((pd, i) => {
        let sp;
        if (teamSpawns && pd.team) {
          const arr = teamSpawns[pd.team];
          const k = arr[used[pd.team]++ % arr.length];
          if (typeof k === 'string') {
            const ts = this.map.teamSpawns[pd.team][parseInt(k.slice(1), 10)];
            sp = ts;
          } else sp = spawns[k];
          // if more players than spawns on a side, offset slightly upward
          if (used[pd.team] > arr.length) sp = [sp[0], sp[1] - 2.2 * Math.floor((used[pd.team] - 1) / arr.length)];
        } else {
          sp = spawns[order[i % order.length]];
          if (i >= order.length) sp = [sp[0], sp[1] - 2.2 * Math.floor(i / order.length)];
        }
        this.players.push(this._makePlayer(pd, sp));
      });
    }

    _makePlayer(pd, sp) {
      const R = C.PLAYER_RADIUS;
      const body = this.world.createBody({
        type: 'dynamic', position: v2(sp[0], sp[1]), bullet: true,
        linearDamping: this.phys.linearDamping, angularDamping: this.phys.angularDamping,
      });
      const baseDensity = 1 / (Math.PI * R * R); // mass = 1 at normal weight
      const fx = body.createFixture({
        shape: planck.Circle(R), density: baseDensity,
        friction: this.phys.playerFriction * this.phys.frictionMul,
        restitution: Math.min(1, this.phys.playerRestitution * this.phys.restitutionMul),
        filterCategoryBits: C.CAT_PLAYER, filterMaskBits: 0xffff & ~C.CAT_OBJWALL,
      });
      const p = {
        id: pd.id, name: pd.name, color: pd.color, pattern: pd.pattern || 'solid', team: pd.team || 0,
        isBot: !!pd.isBot, isHuman: !!pd.isHuman,
        body, fixture: fx, baseDensity, radius: R,
        alive: true, deathTime: 0, deathPos: null,
        input: emptyInput(), prevSpecial: false,
        heavyEnergy: 1, heavy: false, massMul: 1,
        facing: 1, aim: -0.6, charge: 0, charging: false, cooldown: 0,
        rope: null, ropeTime: 0, kickFlash: 0,
        lastHitBy: null, lastHitTime: -99,
        spawn: sp.slice(),
      };
      body.setUserData({ kind: 'player', player: p });
      fx.setUserData({ kind: 'player', player: p });
      return p;
    }

    _setupFootball() {
      const m = this.map;
      const b = m.ball || { x: m.view.w / 2, y: m.view.h / 2, r: 1.3 };
      const body = this.world.createBody({ type: 'dynamic', position: v2(b.x, b.y), bullet: true, linearDamping: 0.25, angularDamping: 0.4 });
      body.createFixture({
        shape: planck.Circle(b.r), density: 0.6 / (Math.PI * b.r * b.r), friction: 0.4, restitution: 0.55,
        filterCategoryBits: C.CAT_BALL, filterMaskBits: 0xffff,
      }).setUserData({ kind: 'ball' });
      body.setUserData({ kind: 'ball' });
      this.ball = { body, r: b.r, start: [b.x, b.y] };
      for (const g of m.goals || []) {
        const gb = this.world.createBody({ type: 'static', position: v2(g.x, g.y) });
        gb.createFixture({ shape: planck.Box(g.w / 2, g.h / 2), isSensor: true }).setUserData({ kind: 'goal', team: g.team });
        this.goals.push(g);
      }
    }

    _setupContacts() {
      const self = this;
      const kindOf = (f) => { const u = f.getUserData(); return u ? u.kind : null; };
      this.world.on('pre-solve', (contact) => {
        const fa = contact.getFixtureA(), fb = contact.getFixtureB();
        const ua = fa.getUserData(), ub = fb.getUserData();
        // ball-to-ball contacts are nearly frictionless (otherwise touching rolling balls jam like gears)
        if (ua && ub && ua.kind === 'player' && ub.kind === 'player') { contact.setFriction(0.04); contact.setRestitution(self.phys.bounceRestitution != null ? self.phys.bounceRestitution : 0.7); }
        // no wall-clinging: contacts against steep walls are slippery for balls
        if (ua && ub && (ua.kind === 'player') !== (ub.kind === 'player') && (ua.kind === 'world' || ub.kind === 'world')) {
          const wm = contact.getWorldManifold(null);
          if (wm) {
            const g = self.env.gravityDir;
            const gl = Math.hypot(g[0], g[1]) || 1;
            if (Math.abs(wm.normal.x * g[0] + wm.normal.y * g[1]) / gl < 0.45) contact.setFriction(0.03);
          }
        }
        // arrows don't hit their shooter for a moment after firing
        for (const [u, o] of [[ua, ub], [ub, ua]]) {
          if (u && u.kind === 'arrow' && o && o.kind === 'player' && o.player === u.arrow.owner && self.time - u.arrow.born < 0.3) contact.setEnabled(false);
          if (u && u.kind === 'arrow' && u.arrow.dead) contact.setEnabled(false);
        }
      });
      this.world.on('begin-contact', (contact) => {
        const fa = contact.getFixtureA(), fb = contact.getFixtureB();
        const ua = fa.getUserData() || {}, ub = fb.getUserData() || {};
        const pairs = [[ua, ub, fa, fb, 1], [ub, ua, fb, fa, -1]];
        for (const [u, o, fu, fo, sgn] of pairs) {
          if (u.kind === 'player') {
            const p = u.player;
            if (o.lethal && self.mode !== 'football') self.pendingKills.push(p);
            if (o.bumper) {
              const wm = contact.getWorldManifold(null);
              if (wm) {
                // manifold normal points from A to B
                let nx = wm.normal.x * -sgn, ny = wm.normal.y * -sgn;
                self.pendingImpulses.push({ body: p.body, x: nx * o.bumper, y: ny * o.bumper });
                self.events.push({ type: 'bumper', x: p.body.getPosition().x, y: p.body.getPosition().y });
              }
            }
            if (o.kind === 'player') {
              p.lastHitBy = o.player; p.lastHitTime = self.time;
            }
            if (o.kind === 'arrow' && !o.arrow.dead && o.arrow.owner !== p) {
              p.lastHitBy = o.arrow.owner; p.lastHitTime = self.time;
              o.arrow.dead = true; o.arrow.hitPlayer = true;
              self.events.push({ type: 'arrowhit', x: p.body.getPosition().x, y: p.body.getPosition().y });
            }
          }
          if (u.kind === 'arrow' && o.kind !== 'player' && !fo.isSensor()) {
            u.arrow.stuck = true;
          }
          if (u.kind === 'ball' && o.kind === 'goal' && !self.result) {
            self._goal(o.team);
          }
        }
      });
      this.world.on('post-solve', (contact, impulse) => {
        const fa = contact.getFixtureA(), fb = contact.getFixtureB();
        const ka = kindOf(fa), kb = kindOf(fb);
        if (ka !== 'player' && kb !== 'player' && ka !== 'ball' && kb !== 'ball') return;
        let imp = 0;
        for (let i = 0; i < impulse.normalImpulses.length; i++) imp = Math.max(imp, impulse.normalImpulses[i]);
        if (imp < 2.2) return;
        const key = (fa.__id || (fa.__id = Math.random())) + (fb.__id || (fb.__id = Math.random()));
        const last = self._hitCooldown.get(key) || -1;
        if (self.time - last < 0.12) return;
        self._hitCooldown.set(key, self.time);
        const wm = contact.getWorldManifold(null);
        const pt = wm && wm.points[0] ? wm.points[0] : fa.getBody().getPosition();
        self.events.push({ type: 'hit', x: pt.x, y: pt.y, strength: imp, pp: ka === 'player' && kb === 'player' });
      });
    }

    // ---- per-step ------------------------------------------------------------
    snapshot() {
      // previous transforms for render interpolation
      for (let b = this.world.getBodyList(); b; b = b.getNext()) {
        if (b.isStatic()) continue;
        const p = b.getPosition();
        let s = this.prev.get(b);
        if (!s) { s = { x: 0, y: 0, a: 0 }; this.prev.set(b, s); }
        s.x = p.x; s.y = p.y; s.a = b.getAngle();
      }
    }

    alivePlayers() { return this.players.filter((p) => p.alive); }

    step(dt) {
      if (this.result && this.result.final) return;
      this.snapshot();
      const ph = this.phys;
      DB.updateMechanisms(this.env, dt, this.events);
      for (const p of this.players) if (p.alive) this._applyPlayer(p, dt);
      if (this.mode === 'arrows') this._updateArrows(dt);
      for (const im of this.pendingImpulses) im.body.applyLinearImpulse(v2(im.x, im.y), im.body.getWorldCenter(), true);
      this.pendingImpulses.length = 0;

      this.world.step(dt, C.VEL_ITERS, C.POS_ITERS);
      DB.postStepMechanisms(this.env, dt, this.events);
      this.time += dt;

      for (const b of this.removeQueue) this.world.destroyBody(b);
      this.removeQueue.length = 0;

      // speed sanity clamp (prevents runaway impulses from ever producing absurd launches)
      for (const p of this.players) {
        if (!p.alive) continue;
        const v = p.body.getLinearVelocity();
        const s = Math.hypot(v.x, v.y);
        if (s > 75) p.body.setLinearVelocity(v2((v.x / s) * 75, (v.y / s) * 75));
        if (!isFinite(s)) this.pendingKills.push(p);
      }

      // eliminations: lethal contacts + leaving the arena boundary in any direction
      const B = this.map.bounds;
      for (const p of this.players) {
        if (!p.alive) continue;
        const pos = p.body.getPosition();
        if (this.mode !== 'football' && (pos.x < B.left || pos.x > B.right || pos.y < B.top || pos.y > B.bottom)) this.pendingKills.push(p);
        if (this.mode === 'football') {
          // keep footballers in play: respawn if they somehow leave
          if (pos.x < B.left || pos.x > B.right || pos.y < B.top || pos.y > B.bottom) {
            p.body.setPosition(v2(p.spawn[0], p.spawn[1])); p.body.setLinearVelocity(v2(0, 0));
          }
        }
      }
      for (const p of this.pendingKills) this._eliminate(p);
      this.pendingKills.length = 0;

      if (this.ball && !this.result) {
        const bp = this.ball.body.getPosition();
        if (bp.x < B.left || bp.x > B.right || bp.y > B.bottom || bp.y < B.top) {
          this.ball.body.setPosition(v2(this.ball.start[0], this.ball.start[1]));
          this.ball.body.setLinearVelocity(v2(0, 0));
        }
      }
      this._checkRoundEnd();
    }

    _applyPlayer(p, dt) {
      const ph = this.phys;
      const inp = p.input;
      const body = p.body;
      // --- heavy mechanic ---
      const wantHeavy = !!inp.heavy;
      if (wantHeavy) {
        p.heavyEnergy = Math.max(0, p.heavyEnergy - ph.heavyDrain * dt);
      } else {
        p.heavyEnergy = Math.min(1, p.heavyEnergy + ph.heavyRecover * dt);
      }
      const targetMul = wantHeavy ? ph.heavyMinMass + (ph.heavyMass - ph.heavyMinMass) * p.heavyEnergy : 1;
      p.heavy = wantHeavy;
      if (Math.abs(targetMul - p.massMul) > 0.02) {
        p.massMul = targetMul;
        p.fixture.setDensity(p.baseDensity * targetMul);
        body.resetMassData();
      }
      // --- movement forces (identical for humans and bots) ---
      const m0 = 1; // base mass; force does NOT grow with heavy mass -> heavy is less agile
      const fScale = wantHeavy ? ph.heavyForceScale : 1;
      let fx = 0, fy = 0;
      const dx = (inp.right ? 1 : 0) - (inp.left ? 1 : 0);
      const dy = (inp.down ? 1 : 0) - (inp.up ? 1 : 0);
      if (dx !== 0) p.facing = dx;
      let moveLocked = false;
      if (this.mode === 'arrows') moveLocked = this._arrowsInput(p, dt);
      else if (this.mode === 'grapple') this._grappleInput(p, dt);
      else if (this.mode === 'football') this._kickInput(p, dt);
      if (!moveLocked) {
        fx = dx * ph.moveAccel * m0 * fScale;
        if (dy < 0) fy = -ph.upAccel * m0 * fScale;
        else if (dy > 0) fy = ph.downAccel * m0 * fScale;
        if (fx || fy) body.applyForceToCenter(v2(fx, fy), true);
      }
      p.prevSpecial = !!inp.special;
      if (p.cooldown > 0) p.cooldown -= dt;
      if (p.kickFlash > 0) p.kickFlash -= dt;
    }

    // ---- Arrows mode ---------------------------------------------------------
    _arrowsInput(p, dt) {
      const inp = p.input;
      if (inp.special && p.cooldown <= 0) {
        if (!p.charging) { p.charging = true; p.charge = 0; p.aim = p.facing > 0 ? -0.5 : Math.PI + 0.5; }
        p.charge = Math.min(1, p.charge + dt / 0.9);
        // aim with left/right (rotate), up/down also rotate toward up/down
        const rotSpeed = 2.6;
        if (inp.left) p.aim -= rotSpeed * dt;
        if (inp.right) p.aim += rotSpeed * dt;
        return true; // movement locked while drawing the bow
      }
      if (!inp.special && p.charging) {
        p.charging = false;
        this._fireArrow(p);
        p.cooldown = 0.35;
        p.charge = 0;
      }
      return false;
    }

    _fireArrow(p) {
      const mine = this.arrows.filter((a) => a.owner === p && !a.dead);
      if (mine.length >= 3) { mine[0].dead = true; }
      const dir = v2(Math.cos(p.aim), Math.sin(p.aim));
      const pos = p.body.getPosition();
      const speed = 16 + 30 * p.charge;
      const start = v2(pos.x + dir.x * (p.radius + 0.7), pos.y + dir.y * (p.radius + 0.7));
      const ab = this.world.createBody({ type: 'dynamic', position: start, angle: p.aim, bullet: true, angularDamping: 2 });
      const fx = ab.createFixture({ shape: planck.Box(0.55, 0.09), density: 2.2, friction: 0.3, restitution: 0.1,
        filterCategoryBits: C.CAT_ARROW, filterMaskBits: 0xffff & ~C.CAT_OBJWALL & ~C.CAT_ARROW });
      const pv = p.body.getLinearVelocity();
      ab.setLinearVelocity(v2(pv.x + dir.x * speed, pv.y + dir.y * speed));
      const arrow = { body: ab, owner: p, born: this.time, dead: false, stuck: false, stuckTime: 0 };
      fx.setUserData({ kind: 'arrow', arrow });
      ab.setUserData({ kind: 'arrow', arrow });
      this.arrows.push(arrow);
      // recoil: equal and opposite momentum
      const m = ab.getMass();
      p.body.applyLinearImpulse(v2(-dir.x * speed * m * C.ARROW_RECOIL, -dir.y * speed * m * C.ARROW_RECOIL), p.body.getWorldCenter(), true);
      this.events.push({ type: 'shoot', x: pos.x, y: pos.y, strength: p.charge });
    }

    _updateArrows(dt) {
      for (const a of this.arrows) {
        if (a.removed) continue;
        const age = this.time - a.born;
        if (a.stuck) a.stuckTime += dt;
        if (!a.dead && !a.stuck) {
          // align arrow with its flight path (simple aerodynamic stabilisation)
          const v = a.body.getLinearVelocity();
          if (v.x * v.x + v.y * v.y > 4) {
            const target = Math.atan2(v.y, v.x);
            let d = target - a.body.getAngle();
            d = Math.atan2(Math.sin(d), Math.cos(d));
            a.body.setAngularVelocity(d * 12);
          }
        }
        if (a.dead || a.stuckTime > 0.8 || age > 5) {
          a.removed = true;
          this.removeQueue.push(a.body);
        }
      }
      this.arrows = this.arrows.filter((a) => !a.removed);
    }

    // ---- Grapple mode --------------------------------------------------------
    _grappleInput(p, dt) {
      const inp = p.input;
      if (inp.special && !p.prevSpecial && !p.rope && p.cooldown <= 0) this._shootRope(p);
      if (p.rope) {
        p.ropeTime += dt;
        const j = p.rope.joint;
        let L = j.getMaxLength();
        if (inp.up) L = Math.max(2.2, L - 11 * dt);
        if (inp.down) L = Math.min(24, L + 8 * dt);
        j.setMaxLength(L);
        if (!inp.special || p.ropeTime > 3.2 || !p.rope.body.isActive()) this._releaseRope(p);
      }
    }

    _shootRope(p) {
      const inp = p.input;
      let dx = (inp.right ? 1 : 0) - (inp.left ? 1 : 0), dy = (inp.down ? 1 : 0) - (inp.up ? 1 : 0);
      if (dx === 0 && dy === 0) { dx = p.facing * 0.55; dy = -1; }
      const l = Math.hypot(dx, dy); dx /= l; dy /= l;
      const pos = p.body.getPosition();
      const hit = this.raycastWorld(pos, v2(pos.x + dx * 24, pos.y + dy * 24), true);
      p.cooldown = 0.5;
      if (!hit) { this.events.push({ type: 'ropemiss', x: pos.x, y: pos.y, dx, dy }); p.ropeMiss = { t: this.time, dx, dy }; return; }
      const anchorLocal = hit.body.getLocalPoint(hit.point);
      const j = this.world.createJoint(planck.RopeJoint({ maxLength: Math.max(2.2, hit.dist), localAnchorA: v2(0, 0), localAnchorB: anchorLocal }, p.body, hit.body));
      p.rope = { joint: j, body: hit.body, local: anchorLocal };
      p.ropeTime = 0;
      this.events.push({ type: 'rope', x: hit.point.x, y: hit.point.y });
    }

    _releaseRope(p) {
      if (!p.rope) return;
      try { this.world.destroyJoint(p.rope.joint); } catch (e) { /* already gone */ }
      p.rope = null;
      p.cooldown = 0.6;
    }

    // ---- Football ------------------------------------------------------------
    _kickInput(p, dt) {
      const inp = p.input;
      if (inp.special && !p.prevSpecial && p.cooldown <= 0 && this.ball) {
        p.cooldown = 0.45;
        p.kickFlash = 0.15;
        const bp = this.ball.body.getPosition(), pp = p.body.getPosition();
        const dx = bp.x - pp.x, dy = bp.y - pp.y, d = Math.hypot(dx, dy);
        if (d < p.radius + this.ball.r + 1.1) {
          const s = 7 / Math.max(0.01, d);
          this.ball.body.applyLinearImpulse(v2(dx * s, dy * s - 0.6), this.ball.body.getWorldCenter(), true);
          p.body.applyLinearImpulse(v2(-dx * s * 0.2, -dy * s * 0.2), p.body.getWorldCenter(), true);
          this.events.push({ type: 'kick', x: bp.x, y: bp.y });
        }
      }
    }

    _goal(team) {
      // team = goal owner; the *other* team scores
      const scorer = team === 1 ? 2 : 1;
      this.result = { type: 'team', team: scorer, goal: true, time: this.time };
      this.events.push({ type: 'goal', team: scorer });
    }

    // ---- elimination & results -------------------------------------------------
    _eliminate(p) {
      if (!p.alive) return;
      p.alive = false;
      p.deathTime = this.time;
      const pos = p.body.getPosition();
      p.deathPos = { x: U.clamp(pos.x, 0, this.map.view.w), y: U.clamp(pos.y, 0, this.map.view.h) };
      if (p.rope) this._releaseRope(p);
      let killer = null;
      if (p.lastHitBy && this.time - p.lastHitTime < 4 && p.lastHitBy !== p) killer = p.lastHitBy;
      p.killedBy = killer;
      this.events.push({ type: 'eliminated', player: p, killer, x: p.deathPos.x, y: p.deathPos.y });
      this.world.destroyBody(p.body);
    }

    _checkRoundEnd() {
      if (this.result) return;
      const alive = this.alivePlayers();
      if (this.mode === 'football') {
        if (this.time > C.ROUND_TIME_LIMIT) this.result = { type: 'draw', time: this.time };
        return;
      }
      if (this.mode === 'teams') {
        const teams = new Set(alive.map((p) => p.team));
        if (teams.size <= 1) this.result = teams.size === 1 ? { type: 'team', team: [...teams][0], time: this.time } : { type: 'draw', time: this.time };
      } else if (this.players.length > 1 && alive.length <= 1) {
        this.result = alive.length === 1 ? { type: 'player', player: alive[0], time: this.time } : { type: 'draw', time: this.time };
      } else if (this.players.length === 1 && alive.length === 0) {
        this.result = { type: 'draw', time: this.time };
      }
      if (!this.result && this.time > C.ROUND_TIME_LIMIT) this.result = { type: 'draw', timeout: true, time: this.time };
      // Overtime: after a while the side kill-boundaries close in, so every round ends.
      if (!this.result && this.time > C.OVERTIME_START) {
        const B = this.map.bounds, cx = this.map.view.w / 2;
        if (!this.overtime) { this.overtime = true; this.events.push({ type: 'overtime' }); }
        const v = C.OVERTIME_SPEED * (1 / 60);
        B.left = Math.min(cx - 1.2, B.left + v);
        B.right = Math.max(cx + 1.2, B.right - v);
      }
    }

    // ---- queries (used by bots, grapple & renderer) ----------------------------
    // Closest hit on solid level geometry (ignores players, arrows, balls, sensors, decor).
    raycastWorld(p1, p2, includeDynamic) {
      let best = null;
      this.world.rayCast(p1, p2, (fixture, point, normal, fraction) => {
        if (fixture.isSensor()) return -1;
        const u = fixture.getUserData();
        if (!u || u.kind !== 'world') return -1;
        const cat = fixture.getFilterCategoryBits();
        if (cat === C.CAT_OBJWALL || cat === C.CAT_DECOR) return -1;
        if (!includeDynamic && fixture.getBody().isDynamic() && !u.def.platform) { /* still count dynamic platforms */ }
        best = { fixture, body: fixture.getBody(), point: v2(point.x, point.y), normal: v2(normal.x, normal.y), fraction, lethal: u.lethal };
        return fraction;
      });
      if (best) best.dist = Math.hypot(best.point.x - p1.x, best.point.y - p1.y);
      return best;
    }

    interp(body, alpha) {
      const p = body.getPosition();
      const s = this.prev.get(body);
      if (!s) return { x: p.x, y: p.y, a: body.getAngle() };
      let da = body.getAngle() - s.a;
      return { x: s.x + (p.x - s.x) * alpha, y: s.y + (p.y - s.y) * alpha, a: s.a + da * alpha };
    }
  }

  DB.Sim = Sim;
})(typeof window !== 'undefined' ? window : globalThis);

// Data-driven map -> planck.js (Box2D) world builder and mechanism runtime.
// Every one of the 30 maps (and custom editor maps) goes through this single builder.
(function (root) {
  'use strict';
  const DB = root.DB;
  const U = DB.util;
  const C = DB.CONST;

  const DEFAULT_COLORS = { static: '#cfd6e6', kinematic: '#8fd3ff', dynamic: '#ffc978' };

  // Fill in defaults so maps can be terse.
  DB.normalizeMap = function (m) {
    const map = U.deepClone(m);
    map.view = map.view || { w: C.VIEW_W, h: C.VIEW_H };
    const w = map.view.w, h = map.view.h;
    map.bounds = Object.assign({ left: -4, right: w + 4, top: -30, bottom: h + 4 }, map.bounds || {});
    map.gravity = map.gravity || [0, 1];
    map.bodies = map.bodies || [];
    map.joints = map.joints || [];
    map.spawns = map.spawns || [];
    map.events = map.events || [];
    map.ai = map.ai || {};
    let n = 0;
    for (const b of map.bodies) {
      if (!b.id) b.id = 'b' + n;
      n++;
      b.type = b.type || 'static';
      b.x = b.x || 0; b.y = b.y || 0; b.a = b.a || 0;
      b.shapes = b.shapes || [];
    }
    return map;
  };

  function v2(x, y) { return planck.Vec2(x, y); }

  // Expand an editor/map shape definition into primitive fixture geometries (body-local).
  function expandShape(s) {
    const out = [];
    const rot = (px, py, a, ox, oy) => {
      const c = Math.cos(a), sn = Math.sin(a);
      return [ox + px * c - py * sn, oy + px * sn + py * c];
    };
    if (s.t === 'box') {
      const a = U.deg(s.a || 0), hw = s.w / 2, hh = s.h / 2, ox = s.x || 0, oy = s.y || 0;
      out.push({ kind: 'poly', pts: [rot(-hw, -hh, a, ox, oy), rot(hw, -hh, a, ox, oy), rot(hw, hh, a, ox, oy), rot(-hw, hh, a, ox, oy)] });
    } else if (s.t === 'circle') {
      out.push({ kind: 'circle', cx: s.x || 0, cy: s.y || 0, r: s.r });
    } else if (s.t === 'poly') {
      const pieces = U.convexDecompose(s.pts, 8);
      // keep outline for rendering on the first piece
      pieces.forEach((p, i) => out.push({ kind: 'poly', pts: p, outline: i === 0 ? s.pts : null, part: i > 0 }));
    } else if (s.t === 'arc') {
      const n = s.n || 12;
      const quads = U.arcQuads(s.x || 0, s.y || 0, s.r0, s.r1, U.deg(s.a0), U.deg(s.a1), n);
      if (s.smooth) {
        // smooth collision surface (chain along the playing face) + visual-only thickness
        const r = s.smooth === 'outer' ? s.r1 : s.r0;
        const pts = [];
        for (let i = 0; i <= n; i++) {
          const a = U.deg(s.a0) + ((U.deg(s.a1) - U.deg(s.a0)) * i) / n;
          pts.push([(s.x || 0) + Math.cos(a) * r, (s.y || 0) + Math.sin(a) * r]);
        }
        out.push({ kind: 'chain', pts, loop: false, hidden: true });
        for (const q of quads) out.push({ kind: 'poly', pts: q, decor: true });
      } else {
        for (const q of quads) out.push({ kind: 'poly', pts: q });
      }
    } else if (s.t === 'chain') {
      out.push({ kind: 'chain', pts: s.pts, loop: !!s.loop });
    }
    for (const g of out) { g.src = s; }
    return out;
  }
  DB.expandShape = expandShape;

  // ---------------------------------------------------------------------------
  // Path evaluation for kinematic path-followers. Returns position at time t.
  function pathPos(path, t) {
    const pts = path.pts;
    if (pts.length === 1) return pts[0];
    // segment lengths
    if (!path._len) {
      path._seg = [];
      let L = 0;
      const n = path.mode === 'loop' ? pts.length : pts.length - 1;
      for (let i = 0; i < n; i++) {
        const a = pts[i], b = pts[(i + 1) % pts.length];
        const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
        path._seg.push(l); L += l;
      }
      path._len = L;
      const travel = path.period ? path.period : L / (path.speed || 4);
      path._travel = travel;
    }
    const wait = path.wait || 0;
    const segs = path._seg;
    const travel = path._travel;
    // each segment gets time proportional to its length plus a wait at its end
    const segTimes = segs.map((l) => (l / path._len) * travel);
    const legTime = segTimes.reduce((a, b) => a + b, 0) + wait * segs.length;
    let cycle, forward = true;
    let tt = t + (path.phase || 0) * legTime;
    if (path.mode === 'loop') {
      cycle = ((tt % legTime) + legTime) % legTime;
    } else {
      const c2 = ((tt % (2 * legTime)) + 2 * legTime) % (2 * legTime);
      if (c2 < legTime) cycle = c2; else { cycle = c2 - legTime; forward = false; }
    }
    const order = forward ? segs.map((_, i) => i) : segs.map((_, i) => segs.length - 1 - i);
    for (const i of order) {
      const st = segTimes[i];
      let a = pts[i], b = pts[(i + 1) % pts.length];
      if (!forward) { const tmp = a; a = b; b = tmp; }
      if (cycle <= st) {
        let u = st > 0 ? cycle / st : 1;
        if (path.ease !== false) u = 0.5 - 0.5 * Math.cos(Math.PI * u);
        return [U.lerp(a[0], b[0], u), U.lerp(a[1], b[1], u)];
      }
      cycle -= st;
      if (cycle <= wait) return b;
      cycle -= wait;
    }
    return forward ? (path.mode === 'loop' ? pts[0] : pts[pts.length - 1]) : pts[0];
  }
  DB.pathPos = pathPos;

  // Piston timing: rest -> fast extend (out) -> hold -> retract (back) -> rest ...
  function pistonPos(pc, t) {
    const cyc = (pc.rest || 1.5) + (pc.out || 0.35) + (pc.hold || 0.8) + (pc.back || 1.2);
    let u = ((t + (pc.phase || 0) * cyc) % cyc + cyc) % cyc;
    let k;
    if (u < pc.rest) k = 0;
    else if ((u -= pc.rest) < pc.out) k = 0.5 - 0.5 * Math.cos(Math.PI * (u / pc.out));
    else if ((u -= pc.out) < pc.hold) k = 1;
    else { u -= pc.hold; k = 0.5 + 0.5 * Math.cos(Math.PI * Math.min(1, u / pc.back)); }
    return [U.lerp(pc.from[0], pc.to[0], k), U.lerp(pc.from[1], pc.to[1], k)];
  }
  DB.pistonPos = pistonPos;

  // ---------------------------------------------------------------------------
  // Build a world for one round.
  DB.buildWorld = function (mapIn, phys, opts) {
    opts = opts || {};
    const map = DB.normalizeMap(mapIn);
    const world = planck.World({ gravity: v2(map.gravity[0] * phys.gravity, map.gravity[1] * phys.gravity) });
    const ground = world.createBody();
    const env = {
      map, world, ground, phys,
      bodies: {},         // id -> planck body
      list: [],           // render list of {body, def}
      joints: [],         // {joint, def, broken, damage}
      kinematics: [],     // {body, def, base:{x,y,a}}
      keepers: [],
      drifters: [],
      bumpers: [],
      gravityDir: map.gravity.slice(),
      gravityWarn: null,
      time: 0,
      events: map.events.map((e) => Object.assign({ _next: e.period || 10, _idx: 0 }, e)),
      mode: opts.mode || 'classic',
    };

    for (const def of map.bodies) {
      if (def.modes && def.modes.indexOf(env.mode) < 0) continue;
      const type = def.type === 'objwall' ? 'static' : def.type;
      let px = def.x, py = def.y, pa = U.deg(def.a);
      if (type === 'kinematic' && def.piston) { const q = pistonPos(def.piston, 0); px = q[0]; py = q[1]; }
      else if (type === 'kinematic' && def.path) { const q = pathPos(def.path, 0); px = q[0]; py = q[1]; }
      if (type === 'kinematic' && def.swing) pa += U.deg(def.swing.amp) * Math.sin(def.swing.phase || 0);
      const body = world.createBody({
        type,
        position: v2(px, py),
        angle: pa,
        bullet: !!def.bullet,
        fixedRotation: !!def.fixedRotation,
        gravityScale: def.gravityScale != null ? def.gravityScale : 1,
        linearDamping: def.linearDamping || 0,
        angularDamping: def.angularDamping != null ? def.angularDamping : (type === 'dynamic' ? 0.05 : 0),
      });
      const geoms = [];
      for (const s of def.shapes) {
        for (const g of expandShape(s)) {
          let shape;
          if (g.kind === 'circle') shape = planck.Circle(v2(g.cx, g.cy), g.r);
          else if (g.kind === 'poly') shape = planck.Polygon(g.pts.map((p) => v2(p[0], p[1])));
          else if (g.kind === 'chain') shape = planck.Chain(g.pts.map((p) => v2(p[0], p[1])), g.loop);
          if (!shape) continue;
          const decor = def.decor || s.decor || g.decor;
          let cat = C.CAT_WORLD, mask = 0xffff;
          if (def.type === 'objwall') { cat = C.CAT_OBJWALL; mask = C.CAT_OBJECT | C.CAT_BALL; }
          else if (decor) { cat = C.CAT_DECOR; mask = 0; }
          else if (def.object) { cat = C.CAT_OBJECT; mask = 0xffff; }
          const fx = body.createFixture({
            shape,
            density: def.density != null ? def.density : 1,
            friction: (s.friction != null ? s.friction : def.friction != null ? def.friction : 0.6) * phys.frictionMul,
            restitution: Math.min(1.25, (s.restitution != null ? s.restitution : def.restitution != null ? def.restitution : 0.15) * phys.restitutionMul),
            isSensor: !!(def.sensor || s.sensor),
            filterCategoryBits: cat,
            filterMaskBits: mask,
          });
          const ud = { geom: g, def, shapeDef: s, lethal: !!(def.lethal || s.lethal), bumper: def.bumper || s.bumper || 0, kind: 'world' };
          fx.setUserData(ud);
          geoms.push(g);
        }
      }
      body.setUserData({ kind: 'world', def });
      env.bodies[def.id] = body;
      if (def.type !== 'objwall') env.list.push({ body, def, geoms });
      if (type === 'kinematic') env.kinematics.push({ body, def, base: { x: def.x, y: def.y, a: U.deg(def.a) } });
      if (def.keeper) env.keepers.push({ body, def, cfg: def.keeper });
      if (def.drift) env.drifters.push({ body, def, cfg: def.drift, home: [def.x, def.y], seed: Math.random() * 100 });
      if (def.velocity) body.setLinearVelocity(v2(def.velocity[0], def.velocity[1]));
      if (def.angularVelocity) body.setAngularVelocity(def.angularVelocity);
    }

    const bodyOf = (id) => (id == null || id === 'ground' ? ground : env.bodies[id]);
    for (const jd of map.joints) {
      const A = bodyOf(jd.a), B = bodyOf(jd.b);
      if (!A || !B) continue;
      let joint = null;
      if (jd.t === 'revolute') {
        const o = {};
        if (jd.motor) { o.enableMotor = true; o.motorSpeed = jd.motor.speed; o.maxMotorTorque = jd.motor.torque; }
        if (jd.limits) { o.enableLimit = true; o.lowerAngle = U.deg(jd.limits[0]); o.upperAngle = U.deg(jd.limits[1]); }
        joint = world.createJoint(planck.RevoluteJoint(o, A, B, v2(jd.anchor[0], jd.anchor[1])));
      } else if (jd.t === 'prismatic') {
        const o = {};
        if (jd.limits) { o.enableLimit = true; o.lowerTranslation = jd.limits[0]; o.upperTranslation = jd.limits[1]; }
        if (jd.motor) { o.enableMotor = true; o.motorSpeed = jd.motor.speed; o.maxMotorForce = jd.motor.force; }
        joint = world.createJoint(planck.PrismaticJoint(o, A, B, v2(jd.anchor[0], jd.anchor[1]), v2(jd.axis[0], jd.axis[1])));
      } else if (jd.t === 'spring') {
        const aA = jd.anchorA || [A.getPosition().x, A.getPosition().y];
        const aB = jd.anchorB || [B.getPosition().x, B.getPosition().y];
        const o = { frequencyHz: jd.hz != null ? jd.hz : 3, dampingRatio: jd.damping != null ? jd.damping : 0.2 };
        if (jd.length != null) o.length = jd.length;
        joint = world.createJoint(planck.DistanceJoint(o, A, B, v2(aA[0], aA[1]), v2(aB[0], aB[1])));
      } else if (jd.t === 'weld') {
        joint = world.createJoint(planck.WeldJoint({ frequencyHz: jd.hz || 0, dampingRatio: 0.7 }, A, B, v2(jd.anchor[0], jd.anchor[1])));
      } else if (jd.t === 'rope') {
        const aA = jd.anchorA, aB = jd.anchorB;
        joint = world.createJoint(planck.RopeJoint({ maxLength: jd.max, localAnchorA: A.getLocalPoint(v2(aA[0], aA[1])), localAnchorB: B.getLocalPoint(v2(aB[0], aB[1])) }, A, B));
      }
      if (joint) {
        const rec = { joint, def: jd, broken: false, damage: 0 };
        joint.setUserData(rec);
        env.joints.push(rec);
      }
    }
    return env;
  };

  // ---------------------------------------------------------------------------
  // Per-step mechanism update (before world.step). dt is the fixed timestep.
  DB.updateMechanisms = function (env, dt, out) {
    const t = env.time;
    for (const k of env.kinematics) {
      const d = k.def;
      const b = k.body;
      if (d.piston) {
        const p1 = pistonPos(d.piston, t + dt);
        const p = b.getPosition();
        b.setLinearVelocity(v2((p1[0] - p.x) / dt, (p1[1] - p.y) / dt));
      } else if (d.path) {
        const p1 = pathPos(d.path, t + dt);
        const p = b.getPosition();
        b.setLinearVelocity(v2((p1[0] - p.x) / dt, (p1[1] - p.y) / dt));
      }
      if (d.spin) {
        b.setAngularVelocity(d.spin);
      } else if (d.swing) {
        const s = d.swing;
        const target = k.base.a + U.deg(s.amp) * Math.sin((U.TAU * (t + dt)) / s.period + (s.phase || 0));
        b.setAngularVelocity((target - b.getAngle()) / dt);
      }
    }
    for (const rec of env.joints) {
      const sc = rec.def.schedule;
      if (!sc || rec.broken) continue;
      const total = sc.reduce((a, s2) => a + s2[1], 0);
      let u = ((t + (rec.def.schedulePhase || 0)) % total + total) % total;
      for (const s2 of sc) {
        if (u < s2[1]) { if (rec.joint.getMotorSpeed() !== s2[0]) { rec.joint.setMotorSpeed(s2[0]); rec.joint.getBodyB().setAwake(true); } break; }
        u -= s2[1];
      }
    }
    for (const k of env.keepers) {
      // Keeps a pendulum's mechanical energy roughly constant by nudging it along its swing.
      const b = k.body, cfg = k.cfg;
      const w = b.getAngularVelocity();
      const I = b.getInertia();
      const pivot = cfg.pivot;
      const c = b.getWorldCenter();
      const h = -(c.y - pivot[1]); // height above pivot (y down)
      const g = env.phys.gravity;
      const dCom = Math.hypot(c.x - pivot[0], c.y - pivot[1]);
      const lv = b.getLinearVelocity();
      const E = 0.5 * b.getMass() * (lv.x * lv.x + lv.y * lv.y) + 0.5 * I * w * w + b.getMass() * g * h;
      const target = -g * dCom * Math.cos(U.deg(cfg.amp)) * b.getMass();
      if (E < target && Math.abs(w) > 0.05) b.applyTorque(U.sign(w) * cfg.torque, true);
      else if (Math.abs(w) <= 0.05 && E < target * 0.3) b.applyTorque(cfg.torque, true);
    }
    for (const d of env.drifters) {
      const b = d.body, cfg = d.cfg;
      const p = b.getPosition();
      const tt = t * (cfg.speed || 0.35) + d.seed;
      const hx = d.home[0] + Math.sin(tt * 1.3) * (cfg.range || 6);
      const hy = d.home[1] + Math.cos(tt * 0.9) * (cfg.range || 6) * 0.5;
      const m = b.getMass();
      const vel = b.getLinearVelocity();
      b.applyForceToCenter(v2((hx - p.x) * (cfg.k || 1.5) * m - vel.x * m * 0.6, (hy - p.y) * (cfg.k || 1.5) * m - vel.y * m * 0.6), true);
      b.applyTorque(-b.getAngularVelocity() * b.getInertia() * 0.5, true);
    }
    // timed events (gravity changes etc.)
    for (const e of env.events) {
      if (e.type === 'gravityCycle') {
        if (t >= e._next - (e.warn || 2) && t < e._next) {
          const nextDir = e.dirs[(e._idx + 1) % e.dirs.length];
          env.gravityWarn = { dir: nextDir, remaining: e._next - t };
        }
        if (t >= e._next) {
          e._idx = (e._idx + 1) % e.dirs.length;
          const d = e.dirs[e._idx];
          env.gravityDir = d.slice();
          env.world.setGravity(v2(d[0] * env.phys.gravity, d[1] * env.phys.gravity));
          env.gravityWarn = null;
          e._next += e.period || 10;
          if (out) out.push({ type: 'gravity', dir: d });
        }
      }
    }
  };

  // After world.step: breakable joints.
  DB.postStepMechanisms = function (env, dt, out) {
    const invDt = 1 / dt;
    for (const rec of env.joints) {
      if (rec.broken || !rec.def.break) continue;
      const f = rec.joint.getReactionForce(invDt).length();
      const lim = rec.def.break;
      if (f > lim * 0.35) rec.damage += (f / lim) * dt;
      if (f > lim || (rec.def.fatigue && rec.damage > rec.def.fatigue)) {
        rec.broken = true;
        const a = rec.joint.getAnchorA();
        env.world.destroyJoint(rec.joint);
        if (out) out.push({ type: 'break', x: a.x, y: a.y });
      }
    }
    // remove level debris that has fallen far outside the arena
    if (env.list.length && ((env._sweep = (env._sweep || 0) + 1) % 30 === 0)) {
      const B = env.map.bounds;
      env.list = env.list.filter((r) => {
        if (!r.body.isDynamic()) return true;
        const p = r.body.getPosition();
        if (p.y > B.bottom + 25 || p.x < B.left - 25 || p.x > B.right + 25 || p.y < B.top - 25) {
          for (const rec of env.joints) {
            if (!rec.broken && (rec.joint.getBodyA() === r.body || rec.joint.getBodyB() === r.body)) rec.broken = true;
          }
          env.world.destroyBody(r.body);
          r.removed = true;
          return false;
        }
        return true;
      });
      env.drifters = env.drifters.filter((d) => env.list.some((r) => r.body === d.body));
      env.keepers = env.keepers.filter((d) => env.list.some((r) => r.body === d.body));
    }
    env.time += dt;
  };
})(typeof window !== 'undefined' ? window : globalThis);

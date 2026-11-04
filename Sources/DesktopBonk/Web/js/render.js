// Canvas renderer. Rendering is fully separate from simulation: it reads body transforms
// (interpolated between fixed physics steps) and draws the arena at any window size.
(function (root) {
  'use strict';
  const DB = root.DB;
  const U = DB.util;

  const TYPE_COLORS = { static: '#d7deee', kinematic: '#8fd3ff', dynamic: '#ffc978' };

  class Renderer {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.effects = [];
      this.opts = Object.assign({}, DB.DEFAULT_SETTINGS.desktop);
      this.dpr = 1;
      this.W = canvas.width; this.H = canvas.height;
      this.time = 0;
    }

    setOptions(o) { Object.assign(this.opts, o); }

    resize(cssW, cssH, dpr) {
      this.dpr = dpr || 1;
      this.W = cssW; this.H = cssH;
      this.canvas.width = Math.max(1, Math.round(cssW * this.dpr));
      this.canvas.height = Math.max(1, Math.round(cssH * this.dpr));
      this.canvas.style.width = cssW + 'px';
      this.canvas.style.height = cssH + 'px';
    }

    // camera: fit the map view into the canvas (minus a top margin for the toolbar)
    camera(map, rect) {
      const vw = map.view.w, vh = map.view.h;
      const r = rect || { x: 0, y: 0, w: this.W, h: this.H };
      const pad = 6;
      const s = Math.min((r.w - pad * 2) / vw, (r.h - pad * 2) / vh);
      const ox = r.x + (r.w - vw * s) / 2, oy = r.y + (r.h - vh * s) / 2;
      return { s, ox, oy, vw, vh };
    }

    outlineColors() {
      const o = this.opts.outlineColor;
      const map = { white: ['#ffffff', 'rgba(0,0,0,0.55)'], black: ['#111111', 'rgba(255,255,255,0.6)'], cyan: ['#4ff0ff', 'rgba(0,0,0,0.6)'], magenta: ['#ff5cf0', 'rgba(0,0,0,0.6)'], yellow: ['#ffe14f', 'rgba(0,0,0,0.6)'] };
      return map[o] || ['rgba(255,255,255,0.95)', 'rgba(0,0,0,0.6)'];
    }

    // ------------------------------------------------------------------------
    draw(match, alpha, rect) {
      const ctx = this.ctx;
      const dpr = this.dpr;
      this.time += 1 / 60;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, this.W, this.H);
      if (!match || !match.sim) return;
      const sim = match.sim;
      const map = sim.map;
      const cam = this.camera(map, rect);
      this.cam = cam;
      // background
      const bg = this.opts.background;
      if (bg !== 'transparent') {
        ctx.fillStyle = bg === 'solid' ? '#141823' : 'rgba(12,14,22,0.58)';
        this.roundRect(ctx, cam.ox - 4, cam.oy - 4, cam.vw * cam.s + 8, cam.vh * cam.s + 8, 10);
        ctx.fill();
      }
      ctx.save();
      ctx.translate(cam.ox, cam.oy);
      ctx.scale(cam.s, cam.s);
      const px = 1 / cam.s; // one CSS pixel in world units
      this.px = px;
      this.drawBounds(ctx, map, px);
      this.drawGoals(ctx, sim, px);
      this.drawWorld(ctx, sim, alpha, px);
      this.drawJoints(ctx, sim, alpha, px);
      this.drawBall(ctx, sim, alpha, px);
      this.drawArrows(ctx, sim, alpha, px);
      this.drawPlayers(ctx, sim, alpha, px, match);
      this.drawEffects(ctx, px);
      this.drawGravityWarning(ctx, sim, px);
      ctx.restore();
    }

    roundRect(ctx, x, y, w, h, r) {
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + w, y, x + w, y + h, r);
      ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r);
      ctx.arcTo(x, y, x + w, y, r);
      ctx.closePath();
    }

    drawBounds(ctx, map, px) {
      if (!this.opts.showBounds) return;
      const B = map.bounds, w = map.view.w, h = map.view.h;
      ctx.save();
      ctx.lineWidth = 2 * px;
      ctx.setLineDash([6 * px, 5 * px]);
      ctx.strokeStyle = 'rgba(255,70,70,0.75)';
      const near = 7;
      const line = (x1, y1, x2, y2) => { ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); };
      // kill boundaries just beyond the view are drawn on the view edge
      if (B.left > 0.01 || B.right < w - 0.01) {
        ctx.save(); ctx.setLineDash([]);
        ctx.fillStyle = 'rgba(255,40,40,0.18)';
        if (B.left > 0) ctx.fillRect(0, 0, B.left, h);
        if (B.right < w) ctx.fillRect(B.right, 0, w - B.right, h);
        ctx.restore();
      }
      if (B.bottom - h < near) line(0, Math.min(h, B.bottom), w, Math.min(h, B.bottom));
      if (-B.top < near) line(0, Math.max(0, B.top), w, Math.max(0, B.top));
      if (-B.left < near) line(Math.max(0, B.left), 0, Math.max(0, B.left), h);
      if (B.right - w < near) line(Math.min(w, B.right), 0, Math.min(w, B.right), h);
      ctx.setLineDash([]);
      // subtle corner ticks so the arena extent is readable over any desktop
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.lineWidth = 1.5 * px;
      const t = 2;
      for (const [cx, cy, sx, sy] of [[0, 0, 1, 1], [w, 0, -1, 1], [0, h, 1, -1], [w, h, -1, -1]]) {
        ctx.beginPath(); ctx.moveTo(cx + sx * t, cy); ctx.lineTo(cx, cy); ctx.lineTo(cx, cy + sy * t); ctx.stroke();
      }
      ctx.restore();
    }

    styleFor(def, geom, fixture) {
      const ud = fixture ? fixture.getUserData() : null;
      let color = def.color || TYPE_COLORS[def.type === 'objwall' ? 'static' : def.type] || TYPE_COLORS.static;
      let kind = 'normal';
      const lethal = def.lethal || (geom.src && geom.src.lethal);
      const rest = def.restitution != null ? def.restitution : 0;
      if (lethal) { color = '#ff3b3b'; kind = 'lethal'; }
      else if (def.bumper) kind = 'bumper';
      else if (rest >= 0.8 && !def.color) color = '#ff9ef0';
      else if (def.friction === 0 && !def.color) color = '#bff4ff';
      return { color, kind };
    }

    pathGeom(ctx, g) {
      ctx.beginPath();
      if (g.kind === 'circle') ctx.arc(g.cx, g.cy, g.r, 0, U.TAU);
      else if (g.kind === 'poly') {
        const pts = g.outline || g.pts;
        ctx.moveTo(pts[0][0], pts[0][1]);
        for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
        ctx.closePath();
      } else if (g.kind === 'chain') {
        ctx.moveTo(g.pts[0][0], g.pts[0][1]);
        for (let i = 1; i < g.pts.length; i++) ctx.lineTo(g.pts[i][0], g.pts[i][1]);
        if (g.loop) ctx.closePath();
      }
    }

    drawWorld(ctx, sim, alpha, px) {
      const [lightC, darkC] = this.outlineColors();
      const outlineOnly = this.opts.platformStyle === 'outline';
      const env = sim.env;
      // kinematic tracks
      ctx.save();
      ctx.setLineDash([3 * px, 4 * px]);
      ctx.lineWidth = 1.2 * px;
      ctx.strokeStyle = 'rgba(143,211,255,0.45)';
      for (const k of env.kinematics) {
        const d = k.def;
        const pts = d.path ? d.path.pts : d.piston ? [d.piston.from, d.piston.to] : null;
        if (!pts) continue;
        ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]);
        for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
        if (d.path && d.path.mode === 'loop') ctx.closePath();
        ctx.stroke();
      }
      ctx.restore();

      for (const rec of env.list) {
        if (rec.removed) continue;
        const b = rec.body;
        const tf = b.isStatic() ? { x: b.getPosition().x, y: b.getPosition().y, a: b.getAngle() } : sim.interp(b, alpha);
        ctx.save();
        ctx.translate(tf.x, tf.y);
        ctx.rotate(tf.a);
        // decor first, then solids
        for (const pass of [0, 1]) {
          for (const g of rec.geoms) {
            if (g.hidden || g.part) continue;
            const isDecor = !!(g.decor || rec.def.decor || (g.src && g.src.decor));
            if ((pass === 0) !== isDecor) continue;
            const st = this.styleFor(rec.def, g);
            this.pathGeom(ctx, g);
            if (g.kind === 'chain') {
              ctx.lineWidth = 3 * px; ctx.strokeStyle = darkC; ctx.stroke();
              ctx.lineWidth = 1.5 * px; ctx.strokeStyle = st.color; ctx.stroke();
              continue;
            }
            if (isDecor && rec.def.decor) {
              ctx.fillStyle = this.withAlpha(st.color, 0.35); ctx.fill();
              continue;
            }
            if (!outlineOnly) { ctx.fillStyle = this.withAlpha(st.color, isDecor ? 0.82 : 0.82); ctx.fill(); }
            else { ctx.fillStyle = this.withAlpha(st.color, 0.12); ctx.fill(); }
            if (st.kind === 'lethal') this.hazardStripes(ctx, g, px);
            if (isDecor) {
              // seamless arc visuals: soft outline only on the outer edges
              ctx.lineWidth = 1 * px; ctx.strokeStyle = this.withAlpha(st.color, 0.9); ctx.stroke();
              continue;
            }
            ctx.lineWidth = 3.2 * px; ctx.strokeStyle = darkC; ctx.stroke();
            ctx.lineWidth = 1.5 * px; ctx.strokeStyle = outlineOnly ? st.color : lightC; ctx.stroke();
            if (st.kind === 'bumper') {
              ctx.lineWidth = 2 * px; ctx.strokeStyle = '#fff';
              ctx.beginPath(); ctx.arc(g.cx, g.cy, g.r * 0.55, 0, U.TAU); ctx.stroke();
            }
          }
        }
        // spinning discs get a hub mark so rotation is readable
        if (!b.isStatic() && rec.geoms[0] && rec.geoms[0].kind === 'circle') {
          const g = rec.geoms[0];
          ctx.strokeStyle = darkC; ctx.lineWidth = 2 * px;
          ctx.beginPath(); ctx.moveTo(g.cx, g.cy); ctx.lineTo(g.cx + g.r * 0.8, g.cy); ctx.stroke();
        }
        ctx.restore();
      }
    }

    hazardStripes(ctx, g, px) {
      ctx.save();
      ctx.clip();
      ctx.strokeStyle = 'rgba(0,0,0,0.35)';
      ctx.lineWidth = 0.35;
      for (let i = -40; i < 40; i += 1.1) { ctx.beginPath(); ctx.moveTo(i, -20); ctx.lineTo(i + 20, 20); ctx.stroke(); }
      ctx.restore();
    }

    withAlpha(hex, a) {
      if (hex.startsWith('rgba') || hex.startsWith('rgb')) return hex;
      const h = hex.replace('#', '');
      const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
      return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
    }

    drawJoints(ctx, sim, alpha, px) {
      const env = sim.env;
      ctx.save();
      for (const rec of env.joints) {
        if (rec.broken) continue;
        const d = rec.def, j = rec.joint;
        if (d.t === 'revolute') {
          const a = j.getAnchorA();
          ctx.fillStyle = 'rgba(20,20,30,0.85)';
          ctx.beginPath(); ctx.arc(a.x, a.y, 0.45, 0, U.TAU); ctx.fill();
          ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.2 * px; ctx.stroke();
        } else if (d.t === 'spring') {
          const a = j.getAnchorA(), b = j.getAnchorB();
          this.zigzag(ctx, a.x, a.y, b.x, b.y, 9, 0.55, px);
        } else if (d.t === 'weld' && d.break) {
          const a = j.getAnchorA();
          const stress = U.clamp(rec.damage / (d.fatigue || 3), 0, 1);
          ctx.strokeStyle = `rgba(255,${Math.round(220 - 180 * stress)},${Math.round(120 - 100 * stress)},0.9)`;
          ctx.lineWidth = 1.5 * px;
          ctx.beginPath(); ctx.moveTo(a.x - 0.35, a.y - 0.35); ctx.lineTo(a.x + 0.35, a.y + 0.35);
          ctx.moveTo(a.x + 0.35, a.y - 0.35); ctx.lineTo(a.x - 0.35, a.y + 0.35); ctx.stroke();
        } else if (d.t === 'prismatic') {
          // drawn implicitly by the spring
        }
      }
      ctx.restore();
    }

    zigzag(ctx, x1, y1, x2, y2, n, amp, px) {
      const dx = x2 - x1, dy = y2 - y1, L = Math.hypot(dx, dy) || 1;
      const nx = -dy / L, ny = dx / L;
      ctx.beginPath(); ctx.moveTo(x1, y1);
      for (let i = 1; i < n; i++) {
        const t = i / n, s = i % 2 ? amp : -amp;
        ctx.lineTo(x1 + dx * t + nx * s, y1 + dy * t + ny * s);
      }
      ctx.lineTo(x2, y2);
      ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = 3 * px; ctx.stroke();
      ctx.strokeStyle = '#7dffb0'; ctx.lineWidth = 1.6 * px; ctx.stroke();
    }

    drawGoals(ctx, sim, px) {
      for (const g of sim.goals) {
        ctx.save();
        const c = DB.TEAM_COLORS[g.team];
        ctx.fillStyle = this.withAlpha(c, 0.22);
        ctx.fillRect(g.x - g.w / 2, g.y - g.h / 2, g.w, g.h);
        ctx.strokeStyle = this.withAlpha(c, 0.7); ctx.lineWidth = 1 * px;
        for (let x = g.x - g.w / 2; x <= g.x + g.w / 2 + 1e-6; x += 0.9) { ctx.beginPath(); ctx.moveTo(x, g.y - g.h / 2); ctx.lineTo(x, g.y + g.h / 2); ctx.stroke(); }
        for (let y = g.y - g.h / 2; y <= g.y + g.h / 2 + 1e-6; y += 0.9) { ctx.beginPath(); ctx.moveTo(g.x - g.w / 2, y); ctx.lineTo(g.x + g.w / 2, y); ctx.stroke(); }
        ctx.restore();
      }
    }

    drawBall(ctx, sim, alpha, px) {
      if (!sim.ball) return;
      const tf = sim.interp(sim.ball.body, alpha), r = sim.ball.r;
      ctx.save(); ctx.translate(tf.x, tf.y); ctx.rotate(tf.a);
      ctx.beginPath(); ctx.arc(0, 0, r, 0, U.TAU);
      ctx.fillStyle = '#ffffff'; ctx.fill();
      ctx.lineWidth = 3 * px; ctx.strokeStyle = 'rgba(0,0,0,0.7)'; ctx.stroke();
      ctx.fillStyle = '#222';
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * U.TAU;
        ctx.beginPath(); ctx.arc(Math.cos(a) * r * 0.62, Math.sin(a) * r * 0.62, r * 0.2, 0, U.TAU); ctx.fill();
      }
      ctx.beginPath(); ctx.arc(0, 0, r * 0.25, 0, U.TAU); ctx.fill();
      ctx.restore();
    }

    drawArrows(ctx, sim, alpha, px) {
      for (const a of sim.arrows) {
        if (a.removed) continue;
        const tf = sim.interp(a.body, alpha);
        ctx.save(); ctx.translate(tf.x, tf.y); ctx.rotate(tf.a);
        ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = 3.5 * px;
        ctx.beginPath(); ctx.moveTo(-0.55, 0); ctx.lineTo(0.55, 0); ctx.stroke();
        ctx.strokeStyle = a.owner.color; ctx.lineWidth = 2 * px; ctx.stroke();
        ctx.fillStyle = '#fff';
        ctx.beginPath(); ctx.moveTo(0.75, 0); ctx.lineTo(0.4, -0.22); ctx.lineTo(0.4, 0.22); ctx.closePath(); ctx.fill();
        ctx.restore();
      }
    }

    drawPlayers(ctx, sim, alpha, px, match) {
      const showNames = this.opts.showNames !== false;
      for (const p of sim.players) {
        if (!p.alive) continue;
        const tf = sim.interp(p.body, alpha);
        const R = p.radius;
        // grapple rope
        if (p.rope) {
          const a = p.rope.body.getWorldPoint(p.rope.local);
          ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = 3 * px;
          ctx.beginPath(); ctx.moveTo(tf.x, tf.y); ctx.lineTo(a.x, a.y); ctx.stroke();
          ctx.strokeStyle = '#ffe9a8'; ctx.lineWidth = 1.5 * px; ctx.stroke();
          ctx.fillStyle = '#ffe9a8'; ctx.beginPath(); ctx.arc(a.x, a.y, 0.25, 0, U.TAU); ctx.fill();
        }
        if (p.ropeMiss && sim.time - p.ropeMiss.t < 0.25) {
          ctx.strokeStyle = 'rgba(255,233,168,0.5)'; ctx.lineWidth = 1 * px; ctx.setLineDash([2 * px, 3 * px]);
          ctx.beginPath(); ctx.moveTo(tf.x, tf.y); ctx.lineTo(tf.x + p.ropeMiss.dx * 24, tf.y + p.ropeMiss.dy * 24); ctx.stroke();
          ctx.setLineDash([]);
        }
        ctx.save();
        ctx.translate(tf.x, tf.y);
        // heavy: bright outline whose strength follows heavy effectiveness
        if (p.heavy) {
          const k = U.clamp((p.massMul - 1) / 2.2, 0.15, 1);
          ctx.beginPath(); ctx.arc(0, 0, R + (2 + 3 * k) * px, 0, U.TAU);
          ctx.fillStyle = `rgba(255,255,255,${0.25 + 0.35 * k})`; ctx.fill();
          ctx.lineWidth = (1.5 + 2.5 * k) * px; ctx.strokeStyle = '#ffffff'; ctx.stroke();
        }
        ctx.save();
        ctx.rotate(tf.a);
        ctx.beginPath(); ctx.arc(0, 0, R, 0, U.TAU);
        ctx.fillStyle = p.color; ctx.fill();
        ctx.save(); ctx.clip(); this.drawPattern(ctx, p, R, px); ctx.restore();
        ctx.restore();
        // contrast rings: dark outer + team/light inner
        ctx.beginPath(); ctx.arc(0, 0, R, 0, U.TAU);
        ctx.lineWidth = 2.6 * px; ctx.strokeStyle = 'rgba(0,0,0,0.75)'; ctx.stroke();
        ctx.beginPath(); ctx.arc(0, 0, R - 1.6 * px, 0, U.TAU);
        ctx.lineWidth = 1 * px; ctx.strokeStyle = p.team ? DB.TEAM_COLORS[p.team] : 'rgba(255,255,255,0.55)'; ctx.stroke();
        if (p.kickFlash > 0) { ctx.beginPath(); ctx.arc(0, 0, R + 0.5, 0, U.TAU); ctx.strokeStyle = 'rgba(255,255,255,0.8)'; ctx.lineWidth = 2 * px; ctx.stroke(); }
        // arrows-mode aim
        if (p.charging) {
          const L = 1.6 + 2.6 * p.charge;
          ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = 3 * px;
          ctx.beginPath(); ctx.moveTo(Math.cos(p.aim) * (R + 0.2), Math.sin(p.aim) * (R + 0.2)); ctx.lineTo(Math.cos(p.aim) * (R + L), Math.sin(p.aim) * (R + L)); ctx.stroke();
          ctx.strokeStyle = `hsl(${120 - 120 * p.charge},100%,60%)`; ctx.lineWidth = 1.8 * px; ctx.stroke();
        }
        ctx.restore();
        if (showNames) {
          const fs = Math.max(9, Math.min(13, 0.75 / px));
          ctx.save();
          ctx.translate(tf.x, tf.y - R - 0.45);
          ctx.scale(px, px);
          ctx.font = `600 ${fs}px -apple-system, "SF Pro Text", "Helvetica Neue", Arial, sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'bottom';
          ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,0.85)'; ctx.lineJoin = 'round';
          const label = p.name;
          ctx.strokeText(label, 0, 0);
          ctx.fillStyle = p.isHuman ? '#fff27a' : '#ffffff';
          ctx.fillText(label, 0, 0);
          ctx.restore();
        }
      }
    }

    drawPattern(ctx, p, R, px) {
      const dark = 'rgba(0,0,0,0.28)', light = 'rgba(255,255,255,0.55)';
      switch (p.pattern) {
        case 'stripe': ctx.fillStyle = dark; ctx.fillRect(-R, -0.22 * R, 2 * R, 0.44 * R); break;
        case 'half': ctx.fillStyle = dark; ctx.fillRect(-R, 0, 2 * R, R); break;
        case 'dot': ctx.fillStyle = light; ctx.beginPath(); ctx.arc(0.45 * R, 0, 0.28 * R, 0, U.TAU); ctx.fill(); break;
        case 'ring': ctx.strokeStyle = dark; ctx.lineWidth = 0.18 * R; ctx.beginPath(); ctx.arc(0, 0, 0.55 * R, 0, U.TAU); ctx.stroke(); break;
        case 'cross': ctx.fillStyle = dark; ctx.fillRect(-R, -0.13 * R, 2 * R, 0.26 * R); ctx.fillRect(-0.13 * R, -R, 0.26 * R, 2 * R); break;
        case 'split': ctx.fillStyle = light; ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, R, 0, Math.PI / 2); ctx.closePath(); ctx.fill();
          ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, R, Math.PI, Math.PI * 1.5); ctx.closePath(); ctx.fill(); break;
        case 'eyes': ctx.fillStyle = '#fff'; for (const sx of [-0.32, 0.32]) { ctx.beginPath(); ctx.arc(sx * R, -0.2 * R, 0.2 * R, 0, U.TAU); ctx.fill(); }
          ctx.fillStyle = '#111'; for (const sx of [-0.28, 0.36]) { ctx.beginPath(); ctx.arc(sx * R, -0.2 * R, 0.09 * R, 0, U.TAU); ctx.fill(); } break;
        default: ctx.fillStyle = light; ctx.beginPath(); ctx.arc(-0.35 * R, -0.35 * R, 0.18 * R, 0, U.TAU); ctx.fill();
      }
    }

    // ---- effects ----------------------------------------------------------------
    addEvent(e) {
      if (e.type === 'hit') {
        const k = U.clamp(e.strength / 12, 0.2, 1.4);
        this.effects.push({ type: 'ring', x: e.x, y: e.y, t: 0, life: 0.28, r0: 0.3, r1: 0.9 + 1.3 * k, color: e.pp ? '255,255,255' : '200,220,255', w: 1 + 2 * k });
      } else if (e.type === 'eliminated') {
        this.effects.push({ type: 'burst', x: e.x, y: e.y, t: 0, life: 0.9, color: e.player.color, name: e.player.name });
      } else if (e.type === 'bumper') {
        this.effects.push({ type: 'ring', x: e.x, y: e.y, t: 0, life: 0.3, r0: 0.5, r1: 2.6, color: '255,95,210', w: 3 });
      } else if (e.type === 'break') {
        this.effects.push({ type: 'ring', x: e.x, y: e.y, t: 0, life: 0.5, r0: 0.3, r1: 3, color: '255,200,120', w: 3 });
      } else if (e.type === 'goal') {
        this.effects.push({ type: 'flash', t: 0, life: 0.6, color: DB.TEAM_COLORS[e.team] });
      } else if (e.type === 'shoot' || e.type === 'kick') {
        this.effects.push({ type: 'ring', x: e.x, y: e.y, t: 0, life: 0.2, r0: 0.6, r1: 1.6, color: '255,255,255', w: 1.5 });
      }
      if (this.effects.length > 80) this.effects.splice(0, this.effects.length - 80);
    }

    drawEffects(ctx, px) {
      const dt = 1 / 60;
      for (const f of this.effects) {
        f.t += dt;
        const k = f.t / f.life;
        if (k >= 1) continue;
        if (f.type === 'ring') {
          ctx.beginPath(); ctx.arc(f.x, f.y, U.lerp(f.r0, f.r1, k), 0, U.TAU);
          ctx.strokeStyle = `rgba(${f.color},${1 - k})`; ctx.lineWidth = f.w * px * (1 - k * 0.5); ctx.stroke();
        } else if (f.type === 'burst') {
          for (let i = 0; i < 10; i++) {
            const a = (i / 10) * U.TAU + 0.3;
            const r = 0.5 + 4 * k;
            ctx.fillStyle = this.withAlpha(f.color, 1 - k);
            ctx.beginPath(); ctx.arc(f.x + Math.cos(a) * r, f.y + Math.sin(a) * r, 0.35 * (1 - k) + 0.1, 0, U.TAU); ctx.fill();
          }
          ctx.beginPath(); ctx.arc(f.x, f.y, 1 + 3 * k, 0, U.TAU);
          ctx.strokeStyle = `rgba(255,80,80,${1 - k})`; ctx.lineWidth = 3 * px; ctx.stroke();
        } else if (f.type === 'flash') {
          const c = this.cam;
          ctx.fillStyle = this.withAlpha(f.color, 0.25 * (1 - k));
          ctx.fillRect(0, 0, c.vw, c.vh);
        }
      }
      this.effects = this.effects.filter((f) => f.t < f.life);
    }

    drawGravityWarning(ctx, sim, px) {
      const w = sim.env.gravityWarn;
      const map = sim.map;
      const cx = map.view.w / 2, cy = map.view.h / 2;
      const dir = w ? w.dir : sim.env.gravityDir;
      if (!sim.map.events.length) return;
      const pulse = w ? 0.5 + 0.5 * Math.sin(this.time * 18) : 0.35;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(Math.atan2(dir[1], dir[0]));
      ctx.globalAlpha = w ? 0.4 + 0.5 * pulse : 0.25;
      ctx.fillStyle = w ? '#ffdd55' : '#ffffff';
      ctx.beginPath();
      ctx.moveTo(4, 0); ctx.lineTo(0.8, -2.4); ctx.lineTo(0.8, -1); ctx.lineTo(-3, -1); ctx.lineTo(-3, 1); ctx.lineTo(0.8, 1); ctx.lineTo(0.8, 2.4); ctx.closePath();
      ctx.fill();
      ctx.lineWidth = 2 * px; ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.stroke();
      ctx.restore();
    }

    // ---- map thumbnail (generated from the real map geometry) ----------------------
    static thumbnail(map, w, h, opts) {
      const canvas = (typeof document !== 'undefined') ? document.createElement('canvas') : null;
      if (!canvas) return null;
      const r = new Renderer(canvas);
      r.resize(w, h, 2);
      r.setOptions(Object.assign({ background: 'solid', showNames: false, showBounds: true, platformStyle: 'filled', outlineColor: 'auto' }, opts || {}));
      const sim = new DB.Sim({ map, phys: DB.resolvePhysics(), mode: map.modes ? 'football' : 'classic', players: [], seed: 1 });
      // let mechanisms settle into position for one frame
      sim.step(1 / 60);
      const fake = { sim };
      r.draw(fake, 1);
      // spawn markers
      const cam = r.cam, ctx = r.ctx;
      ctx.setTransform(2, 0, 0, 2, 0, 0);
      for (const sp of (sim.map.spawns || []).slice(0, 8)) {
        ctx.beginPath(); ctx.arc(cam.ox + sp[0] * cam.s, cam.oy + sp[1] * cam.s, Math.max(1.6, cam.s * 0.8), 0, U.TAU);
        ctx.fillStyle = 'rgba(255,230,90,0.9)'; ctx.fill();
      }
      return canvas.toDataURL('image/png');
    }
  }

  DB.Renderer = Renderer;
})(typeof window !== 'undefined' ? window : globalThis);

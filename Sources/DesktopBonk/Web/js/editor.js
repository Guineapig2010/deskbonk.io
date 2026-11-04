// Compact Bonk-style map editor. Maps are edited as the same plain data the built-in maps use,
// rendered live through the real physics builder, test-played against bots, and saved locally.
(function (root) {
  'use strict';
  const DB = root.DB;
  const U = DB.util;
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const TOOLS = [
    ['select', 'Select/Move', 'V'], ['rect', 'Rect', 'R'], ['circle', 'Circle', 'C'], ['poly', 'Polygon', 'P'],
    ['spawn', 'Spawn', 'S'], ['pivot', 'Pivot/Motor', 'J'], ['spring', 'Spring', 'K'], ['path', 'Path', 'M'],
    ['bounds', 'Kill bounds', 'B'], ['delete', 'Delete', 'X'],
  ];

  function blankMap() {
    return {
      id: 'custom_' + Date.now().toString(36), name: 'My Map', category: 'Custom', desc: 'A custom map.',
      view: { w: 60, h: 40 }, bounds: { left: -4, right: 64, top: -30, bottom: 44 },
      bodies: [{ id: 'floor', type: 'static', x: 30, y: 28, a: 0, shapes: [{ t: 'box', w: 36, h: 2 }], friction: 0.6, restitution: 0.15, density: 1 }],
      joints: [], spawns: [[18, 25], [24, 25], [30, 25], [36, 25], [42, 25]], custom: true,
    };
  }

  const E = DB.editor = {
    app: null, map: null, sim: null, tool: 'select', sel: null, drag: null, poly: [], pending: null,
    undo: [], dirty: false, mouse: { x: 0, y: 0 }, snap: 0.5, savedOnce: false,

    open(app, map) {
      this.app = app;
      if (map) this.map = U.deepClone(map);
      else if (!this.map) this.map = blankMap();
      if (app.match && !app.demo) app.match.paused = true;
      app.showScreen('editor');
      this.buildUi();
      this.rebuild();
      app.reportRects(true);
      DB.native.post('setSize', { width: Math.max(app.settings.desktop.width, 900), height: Math.max(app.settings.desktop.height, 620) });
    },
    close() {
      this.teardownUi();
      this.app.showScreen('main');
      this.app.ACTIONS.menu();
      DB.native.post('setSize', { width: this.app.settings.desktop.width, height: this.app.settings.desktop.height });
    },
    teardownUi() {
      for (const id of ['editorBar', 'editorProps', 'editorStatus']) { const el = document.getElementById(id); if (el) el.remove(); }
      const c = $('#game');
      c.onmousedown = c.onmousemove = c.onmouseup = c.ondblclick = null;
    },

    snapshot() { this.undo.push(JSON.stringify(this.map)); if (this.undo.length > 60) this.undo.shift(); this.dirty = true; },
    doUndo() { if (!this.undo.length) return; this.map = JSON.parse(this.undo.pop()); this.sel = null; this.rebuild(); this.renderProps(); },

    rebuild() {
      try {
        this.sim = new DB.Sim({ map: this.map, phys: DB.resolvePhysics(this.app.settings.physics), mode: 'classic', players: [], seed: 1 });
        this.error = null;
      } catch (e) { this.error = String(e.message || e); }
    },

    buildUi() {
      this.teardownUi();
      const app = document.getElementById('app');
      const bar = document.createElement('div');
      bar.id = 'editorBar'; bar.className = 'ia';
      bar.innerHTML = TOOLS.map(([k, n, key]) => `<button data-tool="${k}" title="${n} (${key})">${n}</button>`).join('') +
        `<span style="flex:1"></span><button data-ed="undo" title="Undo (⌘Z)">Undo</button><button data-ed="new">New</button><button data-ed="load">Load…</button><button data-ed="save" class="primary">Save</button><button data-ed="test" class="primary">▶ Test vs bots</button><button data-ed="exit">Exit</button>`;
      app.appendChild(bar);
      const props = document.createElement('div'); props.id = 'editorProps'; props.className = 'ia'; app.appendChild(props);
      const st = document.createElement('div'); st.id = 'editorStatus'; app.appendChild(st);
      bar.addEventListener('click', (e) => {
        const t = e.target.closest('[data-tool]');
        if (t) { this.setTool(t.dataset.tool); return; }
        const a = e.target.closest('[data-ed]');
        if (a) this.action(a.dataset.ed);
      });
      props.addEventListener('change', (e) => this.onProp(e.target));
      props.addEventListener('click', (e) => { const a = e.target.closest('[data-pa]'); if (a) this.propAction(a.dataset.pa, a); });
      const c = $('#game');
      c.onmousedown = (e) => this.onMouse(e, 'down');
      c.onmousemove = (e) => this.onMouse(e, 'move');
      c.onmouseup = (e) => this.onMouse(e, 'up');
      c.ondblclick = (e) => { if (this.tool === 'poly') this.finishPoly(); };
      this.setTool(this.tool);
      this.renderProps();
    },

    setTool(t) {
      this.tool = t; this.poly = []; this.pending = null;
      document.querySelectorAll('#editorBar [data-tool]').forEach((b) => b.classList.toggle('sel', b.dataset.tool === t));
      const tips = {
        select: 'Click to select · drag to move · Delete key removes · arrow keys nudge',
        rect: 'Drag to draw a rectangle platform', circle: 'Drag from the centre to draw a circle',
        poly: 'Click to add points · double-click or Enter to finish (concave shapes are auto-split)',
        spawn: 'Click to place a spawn point (up to 8)', pivot: 'Click a platform to pin it on a pivot (becomes dynamic; add a motor in the panel)',
        spring: 'Click a platform, then click the anchor point — it will ride on a spring', path: 'Select a platform, then click points to make it follow a path (becomes kinematic)',
        bounds: 'Drag a rectangle: leaving it eliminates a player', delete: 'Click a platform, spawn or joint to delete it',
      };
      this.status(tips[t] || '');
    },
    status(msg) { const el = $('#editorStatus'); if (el) el.textContent = msg + (this.error ? '  ⚠ ' + this.error : ''); },

    cam() { return this.app.renderer.camera(this.map, this.rect || { x: 0, y: 30, w: this.app.renderer.W, h: this.app.renderer.H - 30 }); },
    toWorld(e) {
      const r = $('#game').getBoundingClientRect();
      const c = this.cam();
      return { x: (e.clientX - r.left - c.ox) / c.s, y: (e.clientY - r.top - c.oy) / c.s };
    },
    sn(v) { return Math.round(v / this.snap) * this.snap; },

    pick(p) {
      // spawns, joints, then bodies (topmost last-drawn first)
      const m = this.map;
      for (let i = 0; i < m.spawns.length; i++) if (Math.hypot(m.spawns[i][0] - p.x, m.spawns[i][1] - p.y) < 1.1) return { kind: 'spawn', i };
      for (let i = 0; i < m.joints.length; i++) {
        const j = m.joints[i], a = j.anchor || j.anchorA;
        if (a && Math.hypot(a[0] - p.x, a[1] - p.y) < 0.8) return { kind: 'joint', i };
      }
      if (!this.sim) return null;
      let found = null;
      this.sim.world.queryAABB(planck.AABB(planck.Vec2(p.x - 0.01, p.y - 0.01), planck.Vec2(p.x + 0.01, p.y + 0.01)), (fx) => {
        const u = fx.getUserData();
        if (u && u.def && fx.testPoint(planck.Vec2(p.x, p.y))) { found = u.def; }
        return true;
      });
      if (found) { const i = m.bodies.findIndex((b) => b.id === found.id); if (i >= 0) return { kind: 'body', i }; }
      return null;
    },

    onMouse(e, kind) {
      const p = this.toWorld(e);
      this.mouse = p;
      const m = this.map;
      if (kind === 'down') {
        e.preventDefault();
        const t = this.tool;
        if (t === 'select') {
          this.sel = this.pick(p);
          if (this.sel) { this.snapshot(); this.drag = { start: p, orig: JSON.stringify(this.selObj()) }; }
          this.renderProps();
        } else if (t === 'rect' || t === 'circle' || t === 'bounds') {
          this.drag = { start: { x: this.sn(p.x), y: this.sn(p.y) } };
        } else if (t === 'poly') {
          this.poly.push([this.sn(p.x), this.sn(p.y)]);
          this.status(`${this.poly.length} points — double-click or Enter to finish`);
        } else if (t === 'spawn') {
          if (m.spawns.length >= 8) { this.status('Maximum of 8 spawn points'); return; }
          this.snapshot(); m.spawns.push([this.sn(p.x), this.sn(p.y)]); this.rebuild();
        } else if (t === 'delete') {
          const s = this.pick(p);
          if (!s) return;
          this.snapshot();
          if (s.kind === 'spawn') m.spawns.splice(s.i, 1);
          else if (s.kind === 'joint') m.joints.splice(s.i, 1);
          else { const id = m.bodies[s.i].id; m.bodies.splice(s.i, 1); m.joints = m.joints.filter((j) => j.a !== id && j.b !== id); }
          this.sel = null; this.rebuild(); this.renderProps();
        } else if (t === 'pivot') {
          const s = this.pick(p);
          if (!s || s.kind !== 'body') { this.status('Click on a platform to add a pivot'); return; }
          this.snapshot();
          const b = m.bodies[s.i];
          b.type = 'dynamic'; delete b.path; delete b.spin;
          m.joints.push({ t: 'revolute', a: null, b: b.id, anchor: [this.sn(p.x), this.sn(p.y)] });
          this.sel = { kind: 'joint', i: m.joints.length - 1 }; this.rebuild(); this.renderProps();
        } else if (t === 'spring') {
          if (!this.pending) {
            const s = this.pick(p);
            if (!s || s.kind !== 'body') { this.status('Click on a platform first'); return; }
            this.pending = { body: m.bodies[s.i].id, at: [p.x, p.y] };
            this.status('Now click the spring anchor point (usually below the platform)');
          } else {
            this.snapshot();
            const b = m.bodies.find((x) => x.id === this.pending.body);
            b.type = 'dynamic';
            const ax = this.sn(p.x), ay = this.sn(p.y);
            const dx = b.x - ax, dy = b.y - ay, L = Math.hypot(dx, dy) || 1;
            m.joints.push({ t: 'prismatic', a: null, b: b.id, anchor: [b.x, b.y], axis: [dx / L, dy / L], limits: [-L * 0.6, L * 0.4] });
            m.joints.push({ t: 'spring', a: null, b: b.id, anchorA: [ax, ay], anchorB: [b.x, b.y], hz: 0.8, damping: 0.08 });
            b.gravityScale = 0; b.fixedRotation = true;
            this.pending = null; this.sel = { kind: 'joint', i: m.joints.length - 1 }; this.rebuild(); this.renderProps();
            this.setTool('select');
          }
        } else if (t === 'path') {
          if (!this.sel || this.sel.kind !== 'body') {
            const s = this.pick(p);
            if (s && s.kind === 'body') { this.sel = s; this.renderProps(); this.status('Click points for the path; the platform moves between them'); }
            return;
          }
          this.snapshot();
          const b = m.bodies[this.sel.i];
          b.type = 'kinematic';
          m.joints = m.joints.filter((j) => j.b !== b.id);
          b.path = b.path || { pts: [[b.x, b.y]], speed: 4, wait: 0.5, mode: 'pingpong' };
          b.path.pts.push([this.sn(p.x), this.sn(p.y)]);
          this.rebuild(); this.renderProps();
        }
      } else if (kind === 'move') {
        if (!this.drag) return;
        if (this.tool === 'select' && this.sel) {
          const o = JSON.parse(this.drag.orig);
          const dx = this.sn(p.x - this.drag.start.x), dy = this.sn(p.y - this.drag.start.y);
          this.moveSel(o, dx, dy);
          this.rebuild();
        }
      } else if (kind === 'up') {
        const d = this.drag;
        this.drag = null;
        if (!d) return;
        const a = d.start, b = { x: this.sn(p.x), y: this.sn(p.y) };
        if (this.tool === 'rect') {
          const w = Math.abs(b.x - a.x), h = Math.abs(b.y - a.y);
          if (w < 0.5 || h < 0.5) return;
          this.snapshot();
          m.bodies.push({ id: 'b' + Date.now().toString(36), type: 'static', x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, a: 0, shapes: [{ t: 'box', w, h }], friction: 0.6, restitution: 0.15, density: 1 });
          this.sel = { kind: 'body', i: m.bodies.length - 1 }; this.rebuild(); this.renderProps();
        } else if (this.tool === 'circle') {
          const r = Math.hypot(b.x - a.x, b.y - a.y);
          if (r < 0.3) return;
          this.snapshot();
          m.bodies.push({ id: 'b' + Date.now().toString(36), type: 'static', x: a.x, y: a.y, a: 0, shapes: [{ t: 'circle', r: Math.round(r * 10) / 10 }], friction: 0.6, restitution: 0.15, density: 1 });
          this.sel = { kind: 'body', i: m.bodies.length - 1 }; this.rebuild(); this.renderProps();
        } else if (this.tool === 'bounds') {
          if (Math.abs(b.x - a.x) < 4 || Math.abs(b.y - a.y) < 4) return;
          this.snapshot();
          m.bounds = { left: Math.min(a.x, b.x), right: Math.max(a.x, b.x), top: Math.min(a.y, b.y), bottom: Math.max(a.y, b.y) };
          this.rebuild(); this.status('Kill boundary updated');
        }
      }
    },

    selObj() {
      const s = this.sel, m = this.map;
      if (!s) return null;
      return s.kind === 'body' ? m.bodies[s.i] : s.kind === 'joint' ? m.joints[s.i] : m.spawns[s.i];
    },
    moveSel(o, dx, dy) {
      const s = this.sel, m = this.map;
      if (s.kind === 'spawn') { m.spawns[s.i] = [o[0] + dx, o[1] + dy]; return; }
      if (s.kind === 'joint') {
        const j = m.joints[s.i];
        if (o.anchor) j.anchor = [o.anchor[0] + dx, o.anchor[1] + dy];
        if (o.anchorA) j.anchorA = [o.anchorA[0] + dx, o.anchorA[1] + dy];
        return;
      }
      const b = m.bodies[s.i];
      b.x = o.x + dx; b.y = o.y + dy;
      if (o.path) b.path.pts = o.path.pts.map((q) => [q[0] + dx, q[1] + dy]);
      if (o.shapes[0].t === 'poly') { /* polygon points are body-local, nothing to do */ }
      // joints attached to this body move with it
      for (const j of m.joints) if (j.b === b.id && j.anchor && j.t !== 'revolute') { /* keep */ }
    },

    finishPoly() {
      if (this.poly.length < 3) { this.status('A polygon needs at least 3 points'); return; }
      this.snapshot();
      const cx = this.poly.reduce((a, p) => a + p[0], 0) / this.poly.length, cy = this.poly.reduce((a, p) => a + p[1], 0) / this.poly.length;
      const pts = this.poly.map((p) => [p[0] - cx, p[1] - cy]);
      this.map.bodies.push({ id: 'b' + Date.now().toString(36), type: 'static', x: cx, y: cy, a: 0, shapes: [{ t: 'poly', pts }], friction: 0.6, restitution: 0.15, density: 1 });
      this.poly = [];
      this.sel = { kind: 'body', i: this.map.bodies.length - 1 };
      this.rebuild(); this.renderProps();
    },

    onKey(e, down) {
      if (!down) return true;
      const k = e.key;
      if ((e.metaKey || e.ctrlKey) && k.toLowerCase() === 'z') { this.doUndo(); return true; }
      if ((e.metaKey || e.ctrlKey) && k.toLowerCase() === 's') { this.action('save'); return true; }
      if (k === 'Enter' && this.tool === 'poly') { this.finishPoly(); return true; }
      if (k === 'Escape') { if (this.poly.length || this.pending) { this.poly = []; this.pending = null; this.setTool(this.tool); } else this.setTool('select'); return true; }
      if ((k === 'Delete' || k === 'Backspace') && this.sel) {
        this.snapshot();
        const m = this.map, s = this.sel;
        if (s.kind === 'spawn') m.spawns.splice(s.i, 1);
        else if (s.kind === 'joint') m.joints.splice(s.i, 1);
        else { const id = m.bodies[s.i].id; m.bodies.splice(s.i, 1); m.joints = m.joints.filter((j) => j.a !== id && j.b !== id); }
        this.sel = null; this.rebuild(); this.renderProps(); return true;
      }
      if (k.startsWith('Arrow') && this.sel && this.sel.kind === 'body') {
        this.snapshot();
        const b = this.map.bodies[this.sel.i], st = e.shiftKey ? 2 : 0.5;
        const dx = k === 'ArrowLeft' ? -st : k === 'ArrowRight' ? st : 0, dy = k === 'ArrowUp' ? -st : k === 'ArrowDown' ? st : 0;
        this.moveSel(JSON.parse(JSON.stringify(b)), dx, dy);
        this.rebuild(); this.renderProps(); return true;
      }
      const t = TOOLS.find((x) => x[2] === k.toUpperCase());
      if (t && !e.metaKey && !e.ctrlKey) { this.setTool(t[0]); return true; }
      return true; // the editor swallows keys
    },

    // ---------------------------------------------------------- properties ---
    renderProps() {
      const el = $('#editorProps');
      if (!el) return;
      const m = this.map, s = this.sel;
      const num = (k, v, step) => `<input type="number" data-p="${k}" value="${Math.round(v * 100) / 100}" step="${step || 0.5}">`;
      let h = `<div class="form"><label>Name</label><input type="text" data-p="map.name" value="${esc(m.name)}" maxlength="24">
        <label>Info</label><input type="text" data-p="map.desc" value="${esc(m.desc || '')}" maxlength="120"></div>`;
      if (!s) {
        h += `<h3 style="margin:8px 0 4px;font-size:11px">Map</h3><div class="note">${m.bodies.length} platforms · ${m.spawns.length}/8 spawns · ${m.joints.length} joints</div>
          <div class="form" style="margin-top:4px"><label>Gravity ×</label><input type="number" step="0.1" data-p="map.gravityY" value="${m.gravity ? m.gravity[1] : 1}">
          <label>Bounds</label><div class="note">${Math.round(m.bounds.left)},${Math.round(m.bounds.top)} → ${Math.round(m.bounds.right)},${Math.round(m.bounds.bottom)}</div></div>
          <div class="note" style="margin-top:6px">Tip: select a platform to edit friction, bounciness, density, motion and hazards.</div>`;
      } else if (s.kind === 'body') {
        const b = m.bodies[s.i], sh = b.shapes[0];
        h += `<h3 style="margin:8px 0 4px;font-size:11px">Platform</h3><div class="form">
          <label>Type</label><select data-p="type">${['static', 'kinematic', 'dynamic'].map((t) => `<option ${b.type === t ? 'selected' : ''}>${t}</option>`).join('')}</select>
          <label>X</label>${num('x', b.x)}<label>Y</label>${num('y', b.y)}<label>Angle°</label>${num('a', b.a || 0, 5)}
          ${sh.t === 'box' ? `<label>Width</label>${num('w', sh.w)}<label>Height</label>${num('h', sh.h, 0.1)}` : ''}
          ${sh.t === 'circle' ? `<label>Radius</label>${num('r', sh.r, 0.1)}` : ''}
          <label>Friction</label>${num('friction', b.friction != null ? b.friction : 0.6, 0.05)}
          <label>Bounce</label>${num('restitution', b.restitution != null ? b.restitution : 0.15, 0.05)}
          <label>Density</label>${num('density', b.density != null ? b.density : 1, 0.1)}
          <label>Color</label><input type="text" data-p="color" value="${esc(b.color || '')}" placeholder="auto">
          <label>Hazard</label><select data-p="lethal"><option value="false">no</option><option value="true" ${b.lethal ? 'selected' : ''}>lethal</option></select>
          <label>Collides</label><select data-p="decor"><option value="false">yes</option><option value="true" ${b.decor ? 'selected' : ''}>no (decor)</option></select>
          <label>Bumper</label>${num('bumper', b.bumper || 0, 1)}
          ${b.type === 'kinematic' ? `<label>Spin rad/s</label>${num('spin', b.spin || 0, 0.1)}` : ''}
          ${b.type === 'kinematic' && b.path ? `<label>Path speed</label>${num('pathSpeed', b.path.speed || 4, 0.5)}<label>Path wait</label>${num('pathWait', b.path.wait || 0, 0.1)}
            <label>Path mode</label><select data-p="pathMode"><option ${b.path.mode !== 'loop' ? 'selected' : ''}>pingpong</option><option ${b.path.mode === 'loop' ? 'selected' : ''}>loop</option></select>` : ''}
          ${b.type === 'dynamic' ? `<label>Gravity ×</label>${num('gravityScale', b.gravityScale != null ? b.gravityScale : 1, 0.1)}` : ''}
          </div><div class="foot" style="justify-content:flex-start">${b.path ? '<button data-pa="clearpath">Clear path</button>' : ''}<button data-pa="dup">Duplicate</button><button data-pa="mirror">Mirror copy</button></div>`;
      } else if (s.kind === 'joint') {
        const j = m.joints[s.i];
        h += `<h3 style="margin:8px 0 4px;font-size:11px">Joint: ${j.t}</h3><div class="form">`;
        if (j.t === 'revolute') {
          h += `<label>Motor</label><select data-p="j.motorOn"><option value="false">off</option><option value="true" ${j.motor ? 'selected' : ''}>on</option></select>
            ${j.motor ? `<label>Speed</label>${num('j.speed', j.motor.speed, 0.1)}<label>Torque</label>${num('j.torque', j.motor.torque, 100)}` : ''}
            <label>Limits</label><select data-p="j.limOn"><option value="false">free</option><option value="true" ${j.limits ? 'selected' : ''}>limited</option></select>
            ${j.limits ? `<label>Min°</label>${num('j.lo', j.limits[0], 5)}<label>Max°</label>${num('j.hi', j.limits[1], 5)}` : ''}`;
        } else if (j.t === 'spring') {
          h += `<label>Stiffness Hz</label>${num('j.hz', j.hz, 0.1)}<label>Damping</label>${num('j.damping', j.damping, 0.05)}`;
        }
        h += `<label>Break force</label>${num('j.break', j.break || 0, 100)}</div><div class="note">0 = unbreakable</div>`;
      } else {
        h += `<h3 style="margin:8px 0 4px;font-size:11px">Spawn ${s.i + 1}</h3><div class="note">Drag to move · Delete to remove</div>`;
      }
      el.innerHTML = h;
    },

    onProp(t) {
      const k = t.dataset.p;
      if (!k) return;
      const m = this.map;
      this.snapshot();
      const v = t.type === 'number' ? parseFloat(t.value) : t.value;
      if (k === 'map.name') m.name = String(v).slice(0, 24) || 'My Map';
      else if (k === 'map.desc') m.desc = String(v).slice(0, 120);
      else if (k === 'map.gravityY') m.gravity = [0, isFinite(v) ? v : 1];
      else if (this.sel && this.sel.kind === 'body') {
        const b = m.bodies[this.sel.i], sh = b.shapes[0];
        if (k === 'type') {
          b.type = v;
          if (v !== 'kinematic') { delete b.path; delete b.spin; }
          if (v === 'static') m.joints = m.joints.filter((j) => j.b !== b.id);
        } else if (k === 'w' || k === 'h' || k === 'r') { if (isFinite(v) && v > 0.05) sh[k] = v; }
        else if (k === 'lethal' || k === 'decor') b[k] = v === 'true';
        else if (k === 'color') { if (v) b.color = v; else delete b.color; }
        else if (k === 'pathSpeed') { b.path.speed = Math.max(0.2, v); delete b.path._len; }
        else if (k === 'pathWait') b.path.wait = Math.max(0, v);
        else if (k === 'pathMode') b.path.mode = v;
        else if (isFinite(v)) b[k] = v;
      } else if (this.sel && this.sel.kind === 'joint') {
        const j = m.joints[this.sel.i];
        if (k === 'j.motorOn') { if (v === 'true') j.motor = { speed: 1, torque: 2000 }; else delete j.motor; }
        else if (k === 'j.speed') j.motor.speed = v;
        else if (k === 'j.torque') j.motor.torque = Math.max(0, v);
        else if (k === 'j.limOn') { if (v === 'true') j.limits = [-30, 30]; else delete j.limits; }
        else if (k === 'j.lo') j.limits[0] = v;
        else if (k === 'j.hi') j.limits[1] = v;
        else if (k === 'j.hz') j.hz = Math.max(0.05, v);
        else if (k === 'j.damping') j.damping = U.clamp(v, 0, 2);
        else if (k === 'j.break') { if (v > 0) j.break = v; else delete j.break; }
      }
      this.rebuild();
      this.renderProps();
    },

    propAction(a) {
      const m = this.map;
      if (!this.sel || this.sel.kind !== 'body') return;
      this.snapshot();
      const b = m.bodies[this.sel.i];
      if (a === 'clearpath') { delete b.path; }
      else if (a === 'dup' || a === 'mirror') {
        const c = U.deepClone(b);
        c.id = 'b' + Date.now().toString(36);
        if (a === 'dup') { c.x += 2; c.y += 2; if (c.path) c.path.pts = c.path.pts.map((p) => [p[0] + 2, p[1] + 2]); }
        else {
          c.x = m.view.w - c.x; c.a = -(c.a || 0);
          if (c.shapes[0].t === 'poly') c.shapes[0].pts = c.shapes[0].pts.map((p) => [-p[0], p[1]]);
          if (c.path) c.path.pts = c.path.pts.map((p) => [m.view.w - p[0], p[1]]);
          if (c.spin) c.spin = -c.spin;
        }
        m.bodies.push(c);
        this.sel = { kind: 'body', i: m.bodies.length - 1 };
      }
      this.rebuild(); this.renderProps();
    },

    // ------------------------------------------------------------- actions ---
    validate() {
      const m = this.map;
      if (m.spawns.length < 2) return 'Add at least 2 spawn points (8 recommended).';
      if (!m.bodies.some((b) => !b.decor)) return 'Add at least one solid platform.';
      return null;
    },
    action(a) {
      const app = this.app;
      if (a === 'undo') this.doUndo();
      else if (a === 'new') { if (!this.dirty || confirm('Discard this map and start a new one?')) { this.map = blankMap(); this.undo = []; this.sel = null; this.dirty = false; this.rebuild(); this.renderProps(); } }
      else if (a === 'save') {
        const list = DB.store.get('customMaps', []) || [];
        const i = list.findIndex((x) => x.id === this.map.id);
        const clean = JSON.parse(JSON.stringify(this.map, (k, v) => (k.startsWith('_') ? undefined : v)));
        if (i >= 0) list[i] = clean; else list.push(clean);
        DB.store.set('customMaps', list);
        app.loadCustomMaps();
        this.dirty = false;
        app.flash(`Saved “${this.map.name}”`);
      } else if (a === 'load') this.showLoad();
      else if (a === 'test') {
        const err = this.validate();
        if (err) { app.flash(err); return; }
        this.teardownUi();
        app.returnToEditor = true;
        const map = JSON.parse(JSON.stringify(this.map, (k, v) => (k.startsWith('_') ? undefined : v)));
        app.startMatch({ mapId: map.id, rotation: false, mode: 'classic', spectate: false, bots: Math.min(7, Math.max(1, map.spawns.length - 1)), winTarget: 99 }, { map });
        app.flash('Testing — Esc → “Back to editor”');
      } else if (a === 'exit') {
        if (this.dirty && !confirm('Leave without saving?')) return;
        this.close();
      }
    },
    showLoad() {
      const list = DB.store.get('customMaps', []) || [];
      const el = $('#editorProps');
      el.innerHTML = `<h3 style="margin:0 0 6px;font-size:11px">Saved maps</h3>` + (list.length ? list.map((mm, i) => `<div style="display:flex;gap:4px;margin-bottom:4px"><button data-pa="" style="flex:1;text-align:left" data-load="${i}">${esc(mm.name)}</button><button data-del="${i}" title="Delete">✕</button></div>`).join('') : '<div class="note">No saved maps yet.</div>') +
        `<h3 style="margin:8px 0 6px;font-size:11px">Start from a built-in map</h3><select id="edBase">${DB.MAPS.map((mm) => `<option value="${mm.id}">${esc(mm.name)}</option>`).join('')}</select> <button id="edBaseGo">Copy</button>
         <div class="foot"><button id="edBack">Back</button></div>`;
      el.querySelectorAll('[data-load]').forEach((b) => b.onclick = () => { this.map = U.deepClone(list[+b.dataset.load]); this.undo = []; this.sel = null; this.dirty = false; this.rebuild(); this.renderProps(); });
      el.querySelectorAll('[data-del]').forEach((b) => b.onclick = () => { if (confirm('Delete this map?')) { list.splice(+b.dataset.del, 1); DB.store.set('customMaps', list); this.app.loadCustomMaps(); this.showLoad(); } });
      $('#edBaseGo').onclick = () => {
        const base = DB.normalizeMap(DB.getMap($('#edBase').value));
        const copy = JSON.parse(JSON.stringify(base, (k, v) => (k.startsWith('_') ? undefined : v)));
        copy.id = 'custom_' + Date.now().toString(36); copy.name = base.name + ' (copy)'; copy.category = 'Custom'; copy.custom = true;
        this.map = copy; this.undo = []; this.sel = null; this.dirty = true; this.rebuild(); this.renderProps();
      };
      $('#edBack').onclick = () => this.renderProps();
    },

    // -------------------------------------------------------------- drawing ---
    draw(renderer, rect) {
      this.rect = rect;
      const ctx = renderer.ctx;
      if (this.sim) {
        const prev = renderer.opts.background;
        renderer.opts.background = 'translucent';
        renderer.draw({ sim: this.sim }, 1, rect);
        renderer.opts.background = prev;
      } else {
        ctx.setTransform(renderer.dpr, 0, 0, renderer.dpr, 0, 0);
        ctx.clearRect(0, 0, renderer.W, renderer.H);
      }
      const c = this.cam(), m = this.map;
      ctx.save();
      ctx.setTransform(renderer.dpr, 0, 0, renderer.dpr, 0, 0);
      ctx.translate(c.ox, c.oy); ctx.scale(c.s, c.s);
      const px = 1 / c.s;
      // grid
      ctx.strokeStyle = 'rgba(255,255,255,0.07)'; ctx.lineWidth = px;
      for (let x = 0; x <= m.view.w; x += 2) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, m.view.h); ctx.stroke(); }
      for (let y = 0; y <= m.view.h; y += 2) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(m.view.w, y); ctx.stroke(); }
      // kill bounds
      const B = m.bounds;
      ctx.strokeStyle = 'rgba(255,80,80,0.9)'; ctx.setLineDash([5 * px, 4 * px]); ctx.lineWidth = 1.5 * px;
      ctx.strokeRect(B.left, B.top, B.right - B.left, B.bottom - B.top); ctx.setLineDash([]);
      // spawns
      m.spawns.forEach((sp, i) => {
        ctx.beginPath(); ctx.arc(sp[0], sp[1], 1, 0, U.TAU);
        ctx.fillStyle = 'rgba(255,230,90,0.35)'; ctx.fill(); ctx.strokeStyle = '#ffe65a'; ctx.lineWidth = 1.5 * px; ctx.stroke();
        ctx.save(); ctx.translate(sp[0], sp[1]); ctx.scale(px, px); ctx.fillStyle = '#ffe65a'; ctx.font = '700 10px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(String(i + 1), 0, 0); ctx.restore();
      });
      // joints
      m.joints.forEach((j, i) => {
        const a = j.anchor || j.anchorA;
        if (!a) return;
        ctx.beginPath(); ctx.arc(a[0], a[1], 0.6, 0, U.TAU);
        ctx.strokeStyle = j.t === 'spring' ? '#7dffb0' : '#ffffff'; ctx.lineWidth = 1.5 * px; ctx.stroke();
        if (j.motor) { ctx.beginPath(); ctx.arc(a[0], a[1], 0.95, -1, 1.6); ctx.stroke(); }
      });
      // path points
      for (const b of m.bodies) if (b.path) {
        ctx.strokeStyle = '#8fd3ff'; ctx.lineWidth = 1.2 * px; ctx.beginPath();
        b.path.pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))); ctx.stroke();
        for (const p of b.path.pts) { ctx.fillStyle = '#8fd3ff'; ctx.fillRect(p[0] - 0.25, p[1] - 0.25, 0.5, 0.5); }
      }
      // selection highlight
      const s = this.sel;
      if (s) {
        ctx.strokeStyle = '#ffd23f'; ctx.lineWidth = 2 * px; ctx.setLineDash([4 * px, 3 * px]);
        if (s.kind === 'body' && this.sim) {
          const def = m.bodies[s.i];
          const body = this.sim.env.bodies[def.id];
          if (body) {
            let lo = [1e9, 1e9], hi = [-1e9, -1e9];
            for (let f = body.getFixtureList(); f; f = f.getNext()) { const bb = f.getAABB(0); lo = [Math.min(lo[0], bb.lowerBound.x), Math.min(lo[1], bb.lowerBound.y)]; hi = [Math.max(hi[0], bb.upperBound.x), Math.max(hi[1], bb.upperBound.y)]; }
            ctx.strokeRect(lo[0] - 0.3, lo[1] - 0.3, hi[0] - lo[0] + 0.6, hi[1] - lo[1] + 0.6);
          }
        } else if (s.kind === 'spawn') { const sp = m.spawns[s.i]; ctx.beginPath(); ctx.arc(sp[0], sp[1], 1.4, 0, U.TAU); ctx.stroke(); }
        else if (s.kind === 'joint') { const j = m.joints[s.i], a = j.anchor || j.anchorA; ctx.beginPath(); ctx.arc(a[0], a[1], 1.1, 0, U.TAU); ctx.stroke(); }
        ctx.setLineDash([]);
      }
      // in-progress drawing
      const mp = { x: this.sn(this.mouse.x), y: this.sn(this.mouse.y) };
      ctx.strokeStyle = '#ffd23f'; ctx.lineWidth = 1.5 * px;
      if (this.drag && (this.tool === 'rect' || this.tool === 'bounds')) { const a = this.drag.start; ctx.strokeRect(Math.min(a.x, mp.x), Math.min(a.y, mp.y), Math.abs(mp.x - a.x), Math.abs(mp.y - a.y)); }
      if (this.drag && this.tool === 'circle') { const a = this.drag.start; ctx.beginPath(); ctx.arc(a.x, a.y, Math.hypot(mp.x - a.x, mp.y - a.y), 0, U.TAU); ctx.stroke(); }
      if (this.poly.length) { ctx.beginPath(); this.poly.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))); ctx.lineTo(mp.x, mp.y); ctx.stroke(); }
      if (this.pending) { ctx.beginPath(); ctx.moveTo(this.pending.at[0], this.pending.at[1]); ctx.lineTo(mp.x, mp.y); ctx.stroke(); }
      ctx.restore();
    },
  };
})(window);

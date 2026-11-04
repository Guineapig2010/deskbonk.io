// Application shell: main loop, keyboard input, HUD, menus, settings, desktop-overlay integration.
(function (root) {
  'use strict';
  const DB = root.DB;
  const U = DB.util;
  const C = DB.CONST;
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const App = DB.app = {
    settings: null, match: null, demo: false, renderer: null, screen: 'main', screenArg: null,
    focused: true, hidden: false, keys: {}, acc: 0, last: 0, lastDraw: 0, thumbs: {}, ff: false,
    goTimer: 0, hudTick: 0, lastRects: '', returnToEditor: false, hintTimer: 0, settingsTab: 'match',
  };

  // ---------------------------------------------------------------- settings ----
  function loadSettings() {
    const s = U.deepClone(DB.DEFAULT_SETTINGS);
    U.deepMerge(s, DB.store.get('settings', {}) || {});
    return s;
  }
  function saveSettings() { DB.store.set('settings', App.settings); applySettings(); }
  App.saveSettings = saveSettings;

  function applySettings() {
    const d = App.settings.desktop;
    App.renderer.setOptions({ background: d.background, platformStyle: d.platformStyle, outlineColor: d.outlineColor, showNames: d.showNames, showBounds: d.showBounds });
    DB.audio.settings = App.settings.audio; DB.audio.apply();
    DB.native.post('setLevel', { alwaysOnTop: !!d.alwaysOnTop });
    DB.native.post('setHideOnDeactivate', { hide: !d.visibleWhenInactive });
    DB.native.post('setClickThrough', { enabled: !!d.clickThrough });
    DB.native.post('setHotkeys', { toggle: d.hotkeyToggle, focus: d.hotkeyFocus });
    reportRects(true);
  }

  function loadCustomMaps() {
    DB.customMaps = (DB.store.get('customMaps', []) || []).filter((m) => m && m.id && m.bodies);
  }
  App.loadCustomMaps = loadCustomMaps;

  // ------------------------------------------------------------------ matches ----
  function matchConfig(overrides) {
    const s = App.settings;
    const ms = Object.assign({}, s.match, overrides || {});
    const roster = DB.buildRoster(Object.assign({}, s, { match: ms }));
    return {
      mode: ms.mode, roster, mapId: ms.mapId, rotation: ms.rotation, winTarget: ms.winTarget,
      phys: DB.resolvePhysics(s.physics), includeCustom: true,
    };
  }

  function startMatch(overrides, opts) {
    opts = opts || {};
    DB.audio.ensure();
    const cfg = matchConfig(overrides);
    if (opts.map) cfg.mapId = opts.map.id;
    App.match = new DB.Match(cfg);
    App.demo = !!opts.demo;
    App.match.on(onMatchEvent);
    if (opts.map && !DB.getMap(opts.map.id)) { App.match.start = function () { this.round = 0; this.matchWinner = null; this.nextRound(opts.map); }; App.match.pickMap = () => opts.map; }
    App.match.start();
    App.acc = 0;
    App.renderer.effects = [];
    if (!App.demo) { showScreen(null); DB.audio.ui('round'); requestFocus(); }
    App.hintTimer = 5;
  }
  App.startMatch = startMatch;

  function quickMatch() {
    // Quick Match: 1 human + 5 bots, Normal, random map rotation, Classic, first to 5 — unless the user changed defaults.
    const q = App.settings.quick || {};
    startMatch(Object.assign({ mode: 'classic', bots: 5, difficulty: 3, personality: 'mixed', mapId: 'random', rotation: true, winTarget: 5, spectate: false }, q));
  }
  App.quickMatch = quickMatch;

  function startDemo() {
    const pool = DB.MAPS;
    const map = pool[(Math.random() * pool.length) | 0];
    startMatch({ mode: 'classic', bots: 5, difficulty: 4, personality: 'mixed', mapId: map.id, rotation: true, winTarget: 999, spectate: true }, { demo: true });
  }

  function onMatchEvent(e) {
    if (App.demo) return;
    if (e.type === 'go') { App.goTimer = 0.7; DB.audio.ui('go'); }
    else if (e.type === 'roundEnd') DB.audio.ui(e.matchWinner ? 'win' : 'round');
    else if (e.type === 'roundStart') App.hintTimer = Math.max(App.hintTimer, 3.5);
  }

  // -------------------------------------------------------------------- input ----
  const KEYMAP = {
    ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down', KeyX: 'heavy', KeyZ: 'special',
  };
  const WASD = { KeyA: 'left', KeyD: 'right', KeyW: 'up', KeyS: 'down' };

  function isTyping(e) {
    const t = e.target;
    return t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA');
  }
  function updateHumanInput() {
    if (!App.match) return;
    const inp = App.match.humanInput;
    for (const k of ['left', 'right', 'up', 'down', 'heavy', 'special']) inp[k] = false;
    if (!App.focused) return;
    for (const code in App.keys) {
      if (!App.keys[code]) continue;
      const a = KEYMAP[code] || (App.settings.controls.wasd ? WASD[code] : null);
      if (a) inp[a] = true;
    }
  }
  function onKeyDown(e) {
    DB.audio.ensure();
    if (isTyping(e)) { if (e.code === 'Escape') e.target.blur(); return; }
    if (App.screen === 'editor' && DB.editor && DB.editor.onKey(e, true)) { e.preventDefault(); return; }
    const gameKey = KEYMAP[e.code] || (App.settings.controls.wasd && WASD[e.code]);
    if (gameKey || e.code === 'Space') e.preventDefault();
    App.keys[e.code] = true;
    if (e.code === 'Space') App.ff = true;
    if (e.code === 'Escape') {
      e.preventDefault();
      if (App.screen === 'editor') return;
      if (App.screen && App.screen !== 'main' && App.match && !App.demo) { showScreen(null); return; }
      if (App.screen === null && App.match && !App.demo) { showScreen('pause'); return; }
      if (App.screen && App.screen !== 'main') { showScreen('main'); return; }
    }
    if (e.code === 'Enter' && !e.repeat) {
      if (App.screen === 'main') { quickMatch(); e.preventDefault(); }
      else if (App.match && App.match.state === 'matchEnd' && !App.demo) { App.match.rematch(); e.preventDefault(); }
    }
    updateHumanInput();
  }
  function onKeyUp(e) {
    App.keys[e.code] = false;
    if (e.code === 'Space') App.ff = false;
    if (App.screen === 'editor' && DB.editor) DB.editor.onKey(e, false);
    updateHumanInput();
  }
  function releaseAllKeys() { App.keys = {}; App.ff = false; updateHumanInput(); }

  function setFocused(f) {
    App.focused = f;
    if (!f) releaseAllKeys();
    document.body.classList.toggle('unfocused', !f);
  }
  function requestFocus() {
    if (!DB.native.post('focus')) { try { window.focus(); } catch (e) { /* ignore */ } }
    setFocused(true);
  }
  App.requestFocus = requestFocus;

  // ---------------------------------------------------------------------- loop ----
  function frame(ts) {
    requestAnimationFrame(frame);
    const fpsLimit = App.settings.desktop.fpsLimit || 60;
    if (fpsLimit < 120 && ts - App.lastDraw < 1000 / fpsLimit - 2) return;
    const dt = Math.min(0.1, (ts - (App.last || ts)) / 1000);
    App.last = ts; App.lastDraw = ts;
    const m = App.match;
    const pausedByMenu = App.screen && App.screen !== 'main' && !App.demo;
    const pausedByBlur = !App.focused && App.settings.desktop.pauseOnBlur && !App.demo && !!m && m.state !== 'matchEnd' && !App.noBlurPause;
    const paused = App.hidden || pausedByMenu || pausedByBlur || App.screen === 'editor';
    if (m && !paused) {
      const human = m.human();
      const spectating = !human || !human.alive || App.demo;
      const speed = App.ff && spectating ? 3 : 1;
      App.acc += dt * speed;
      let n = 0;
      while (App.acc >= C.DT && n < 6 * speed) { m.step(C.DT); App.acc -= C.DT; n++; }
      if (n >= 6 * speed) App.acc = 0;
      for (const e of m.events) { App.renderer.addEvent(e); if (!App.demo) DB.audio.event(e); }
      m.events.length = 0;
      if (App.demo && m.state === 'roundEnd' && m.round > 2) { /* keep the demo rolling */ }
    }
    const rect = arenaRect();
    if (App.screen === 'editor' && DB.editor) DB.editor.draw(App.renderer, rect);
    else App.renderer.draw(m, U.clamp(App.acc / C.DT, 0, 1), rect);
    App.goTimer = Math.max(0, App.goTimer - dt);
    App.hintTimer = Math.max(0, App.hintTimer - dt);
    updateHud(dt);
  }

  function arenaRect() {
    const top = 30;
    return { x: 0, y: top, w: App.renderer.W, h: App.renderer.H - top };
  }

  function resize() {
    const w = window.innerWidth, h = window.innerHeight;
    App.renderer.resize(w, h, window.devicePixelRatio || 1);
    document.body.classList.toggle('compact', w < 560);
    reportRects(true);
  }

  // ----------------------------------------------------------------------- HUD ----
  function updateHud(dt) {
    const m = App.match;
    const hud = $('#hud');
    const show = m && !App.demo && App.screen !== 'editor';
    hud.style.display = show ? '' : 'none';
    document.body.classList.toggle('playing', !!(show && m.state === 'playing'));
    $('#focusHint').classList.toggle('hidden', !(show && !App.focused && m.state !== 'matchEnd' && !App.screen));
    if (!show) { reportRects(); return; }
    const sim = m.sim;
    // heavy meter
    const h = m.human();
    const hv = $('#heavy');
    if (h && h.alive) {
      hv.style.display = '';
      $('#heavyFill').style.width = Math.round(h.heavyEnergy * 100) + '%';
      hv.classList.toggle('active', !!h.heavy);
    } else hv.style.display = 'none';
    // throttle the rest
    App.hudTick -= dt;
    if (App.hudTick > 0) return;
    App.hudTick = 0.1;
    const scores = $('#scores');
    let html = '';
    if (m.teams) {
      for (const t of [1, 2]) {
        const alive = sim.players.filter((p) => p.team === t && p.alive).length;
        html += `<div class="chip"><span class="dot" style="background:${DB.TEAM_COLORS[t]}"></span>${t === 1 ? 'Red' : 'Blue'} <span class="pips">${m.scores[t]}</span><span class="note">${m.mode === 'football' ? '' : alive + ' left'}</span></div>`;
      }
    } else {
      const list = sim.players.slice().sort((a, b) => (m.scores[b.id] || 0) - (m.scores[a.id] || 0));
      for (const p of list) {
        html += `<div class="chip ${p.alive ? '' : 'dead'} ${p.isHuman ? 'me' : ''}"><span class="dot" style="background:${p.color}"></span>${esc(p.name)} <span class="pips">${m.scores[p.id] || 0}</span></div>`;
      }
    }
    html += `<div class="note" style="padding-left:4px;text-shadow:0 1px 1px #000">First to ${m.winTarget} · Round ${m.round}</div>`;
    if (scores.innerHTML !== html) scores.innerHTML = html;
    const mapName = `${esc(m.map.name)} · ${esc(DB.MODES[m.mode].name)}${sim.overtime ? ' · <b style="color:#ff6b6b">OVERTIME</b>' : ''}`;
    if ($('#mapName').innerHTML !== mapName) $('#mapName').innerHTML = mapName;
    // centre messages
    let c = '';
    if (m.state === 'countdown') c = `<div class="big">${Math.max(1, Math.ceil(m.timer / (C.COUNTDOWN / 3)))}</div><div class="banner" style="padding:4px 10px;min-width:0"><b>${esc(m.map.name)}</b><div class="sub">${esc(m.map.desc || '')}</div></div>`;
    else if (App.goTimer > 0) c = '<div class="big">BONK!</div>';
    else if (m.state === 'roundEnd' || m.state === 'matchEnd') {
      const r = m.lastResult;
      let title = 'Draw!';
      let color = '#fff';
      if (r && r.type === 'player') { title = `${esc(r.player.name)} wins the round`; color = r.player.color; }
      if (r && r.type === 'team') { title = `${r.team === 1 ? 'Red' : 'Blue'} ${r.goal ? 'scores!' : 'team wins the round'}`; color = DB.TEAM_COLORS[r.team]; }
      if (r && r.timeout) title = 'Time up — draw';
      let table = '';
      const rows = m.teams ? [1, 2].map((t) => [t === 1 ? 'Red' : 'Blue', m.scores[t], DB.TEAM_COLORS[t]])
        : m.roster.map((p) => [p.name, m.scores[p.id] || 0, p.color, m.kills[p.id] || 0]).sort((a, b) => b[1] - a[1]);
      table = '<table>' + rows.map((rw) => `<tr><td><span class="dot" style="display:inline-block;width:9px;height:9px;border-radius:50%;background:${rw[2]};border:1px solid #000"></span> ${esc(rw[0])}</td><td><b>${rw[1]}</b></td>${rw[3] != null ? `<td class="note">${rw[3]} KO</td>` : ''}</tr>`).join('') + '</table>';
      if (m.state === 'matchEnd' || m.matchWinner) {
        const w = m.matchWinner;
        const wname = esc(m.winnerName(w.key));
        const wcol = m.teams ? DB.TEAM_COLORS[w.key] : (m.roster.find((p) => p.id === w.key) || {}).color;
        c = `<div class="banner"><h2 style="color:${wcol}">${wname} win${m.teams ? '' : 's'} the match!</h2>${table}
          <div class="row ia"><button class="primary" data-a="rematch">Rematch</button><button data-a="newmap">New map</button><button data-a="menu">Menu</button>${App.returnToEditor ? '<button data-a="backeditor">Editor</button>' : '<button data-a="minimize">Minimize</button>'}</div></div>`;
        if (m.state !== 'matchEnd') c = `<div class="banner"><h2 style="color:${wcol}">${wname} win${m.teams ? '' : 's'} the match!</h2>${table}</div>`;
      } else {
        c = `<div class="banner"><h2 style="color:${color}">${title}</h2>${table}<div class="sub">Next round in ${Math.ceil(m.timer + C.COUNTDOWN)}…</div></div>`;
      }
    } else if (h && !h.alive && m.state === 'playing') {
      c = `<div class="banner" style="padding:5px 12px;min-width:0"><b>Bonked!</b> <span class="sub">Hold <span class="kbd">Space</span> to fast-forward · <span class="kbd">Esc</span> menu</span></div>`;
    }
    const center = $('#center');
    if (center.innerHTML !== c) { center.innerHTML = c; reportRects(true); }
    const hints = {
      classic: '← → ↑ ↓ move · hold <span class="kbd">X</span> heavy · <span class="kbd">Esc</span> menu',
      teams: 'Red vs Blue · ← → ↑ ↓ move · hold <span class="kbd">X</span> heavy',
      arrows: 'Hold <span class="kbd">Z</span>, aim ← →, release to fire · <span class="kbd">X</span> heavy',
      grapple: 'Hold <span class="kbd">Z</span> + direction to grapple · ↑ ↓ reel · <span class="kbd">X</span> heavy',
      football: 'Push the ball into the other goal · <span class="kbd">Z</span> kick · <span class="kbd">X</span> heavy',
    };
    const hint = $('#hint');
    const hh = hints[m.mode] || '';
    if (hint.innerHTML !== hh) hint.innerHTML = hh;
    hint.style.opacity = App.hintTimer > 0 || m.state === 'countdown' ? 1 : 0;
    reportRects();
  }

  // ---------------------------------------------------- click-through regions ----
  // The host makes the window ignore mouse events except over these rectangles, so clicks on the
  // transparent parts of the arena fall through to Safari (or whatever is underneath).
  function reportRects(force) {
    if (!DB.native.isNative) return;
    const all = App.screen === 'editor';
    const rects = [];
    if (!all) {
      document.querySelectorAll('.ia').forEach((el) => {
        if (el.offsetParent === null && el.id !== 'panel') return;
        if (el.classList.contains('hidden')) return;
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) rects.push([Math.floor(r.left) - 2, Math.floor(r.top) - 2, Math.ceil(r.width) + 4, Math.ceil(r.height) + 4]);
      });
    }
    const key = (all ? 'all' : '') + JSON.stringify(rects);
    if (!force && key === App.lastRects) return;
    App.lastRects = key;
    DB.native.post('interactive', { rects, all });
  }
  App.reportRects = reportRects;

  // ----------------------------------------------------------------- screens ----
  const DIFF_NAMES = ['', 'Beginner', 'Casual', 'Normal', 'Skilled', 'Expert', 'Insane'];

  function seg(name, options, cur, fmt) {
    return `<div class="seg">${options.map((o) => `<button data-a="set" data-k="${name}" data-v="${o}" class="${String(o) === String(cur) ? 'sel' : ''}">${fmt ? fmt(o) : o}</button>`).join('')}</div>`;
  }
  function toggle(name, cur, label) {
    return `<div class="seg"><button data-a="set" data-k="${name}" data-v="true" class="${cur ? 'sel' : ''}">${label ? label[0] : 'On'}</button><button data-a="set" data-k="${name}" data-v="false" class="${!cur ? 'sel' : ''}">${label ? label[1] : 'Off'}</button></div>`;
  }
  function range(name, cur, min, max, step) {
    return `<div style="display:flex;align-items:center"><input type="range" data-k="${name}" min="${min}" max="${max}" step="${step}" value="${cur}"><span class="val">${cur}</span></div>`;
  }

  function quickSummary() {
    const s = App.settings.quick || {};
    const bots = s.bots != null ? s.bots : 5, d = s.difficulty || 3, w = s.winTarget || 5;
    return `You + ${bots} bots · ${DIFF_NAMES[d]} · ${DB.MODES[s.mode || 'classic'].name} · First to ${w} · Random map`;
  }

  const SCREENS = {
    main() {
      return `<h1>DESKTOP BONK</h1><div class="tag">Bonk-style physics brawls, floating over your desktop.</div>
        <button class="primary quick" data-a="quick">QUICK MATCH<small>${quickSummary()}</small></button>
        <div class="menu-grid">
          <button data-a="go" data-v="custom">Custom match</button>
          <button data-a="go" data-v="maps">Maps (${DB.MAPS.length + (DB.customMaps || []).length})</button>
          <button data-a="editor">Map editor</button>
          <button data-a="go" data-v="settings">Settings</button>
          <button data-a="go" data-v="help">How to play</button>
          ${DB.native.isNative ? '<button data-a="minimize">Minimize</button><button data-a="quit">Quit</button>' : ''}
        </div>
        <div class="note" style="margin-top:8px">Press <span class="kbd">Enter</span> for Quick Match. Global shortcuts: <b>${esc(fmtHot(App.settings.desktop.hotkeyToggle))}</b> show/hide · <b>${esc(fmtHot(App.settings.desktop.hotkeyFocus))}</b> focus game.</div>`;
    },
    custom() {
      const ms = App.settings.match;
      const map = ms.mapId === 'random' ? null : DB.getMap(ms.mapId);
      return `<h1>Custom match</h1>
        <div class="form">
          <label>Mode</label>${seg('match.mode', Object.keys(DB.MODES), ms.mode, (k) => DB.MODES[k].name)}
          <label></label><div class="note">${esc(DB.MODES[ms.mode].desc)}</div>
          <label>Players</label>${toggle('match.spectate', !ms.spectate, ['You + bots', 'Bots only (spectate)'])}
          <label>Bots</label>${seg('match.bots', ms.spectate ? [2, 3, 4, 5, 6, 7, 8] : [1, 2, 3, 4, 5, 6, 7], ms.bots)}
          <label>Difficulty</label>${seg('match.difficulty', [1, 2, 3, 4, 5, 6], ms.difficulty, (d) => DIFF_NAMES[d])}
          <label>Personality</label>${seg('match.personality', ['mixed'].concat(DB.PERSONALITIES), ms.personality, (p) => p[0].toUpperCase() + p.slice(1))}
          <label>Win target</label><div style="display:flex;gap:6px;align-items:center">${seg('match.winTarget', [3, 5, 10], ms.winTarget)}<input type="number" min="1" max="99" data-k="match.winTarget" value="${ms.winTarget}" style="width:52px" title="Custom target"></div>
          <label>Map</label><div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap"><button data-a="go" data-v="maps" data-arg="pick">${ms.mapId === 'random' ? 'Random' : esc(map ? map.name : ms.mapId)} ▾</button>${ms.mapId !== 'random' ? '<button data-a="set" data-k="match.mapId" data-v="random">Use random</button>' : ''}</div>
          <label>Rotation</label>${toggle('match.rotation', ms.rotation, ['New map each round', 'Keep map'])}
          <label>Physics</label>${seg('physics.preset', Object.keys(DB.PHYSICS_PRESETS), App.settings.physics.preset, (k) => DB.PHYSICS_PRESETS[k].label)}
        </div>
        <div class="foot"><button data-a="setquick">Use as Quick Match defaults</button><button data-a="go" data-v="main">Back</button><button class="primary" data-a="startcustom">Start match</button></div>`;
    },
    maps(arg) {
      const pick = arg === 'pick';
      const cur = App.settings.match.mapId;
      let html = `<h1>Maps</h1><div class="tag">${pick ? 'Choose a map for your custom match.' : 'Click a map to play it right away.'}</div>`;
      const groups = DB.MAP_CATEGORIES.map((cat) => [cat, DB.MAPS.filter((m) => m.category === cat)]);
      if ((DB.customMaps || []).length) groups.push(['Custom', DB.customMaps]);
      groups.push(['Football', DB.FOOTBALL_MAPS]);
      for (const [cat, list] of groups) {
        html += `<h3>${cat}</h3><div class="maps">`;
        for (const m of list) {
          html += `<button class="map ${cur === m.id ? 'sel' : ''}" data-a="${pick ? 'pickmap' : 'playmap'}" data-v="${esc(m.id)}"><img data-thumb="${esc(m.id)}" alt=""><b>${esc(m.name)}</b><span>${esc(m.desc || '')}</span></button>`;
        }
        html += '</div>';
      }
      html += `<div class="foot"><button data-a="go" data-v="${pick ? 'custom' : 'main'}">Back</button></div>`;
      return html;
    },
    pause() {
      return `<h1>Paused</h1><div class="tag">${esc(App.match.map.name)} · ${esc(DB.MODES[App.match.mode].name)} · Round ${App.match.round}</div>
        <div class="menu-grid">
          <button class="primary" data-a="resume">Resume</button>
          <button data-a="rematch">Restart match</button>
          <button data-a="skipround">Skip round</button>
          <button data-a="go" data-v="maps" data-arg="pick">Change map</button>
          <button data-a="go" data-v="settings">Settings</button>
          ${App.returnToEditor ? '<button data-a="backeditor">Back to editor</button>' : ''}
          <button data-a="menu">Main menu</button>
          ${DB.native.isNative ? '<button data-a="minimize">Minimize</button>' : ''}
        </div>`;
    },
    help() {
      return `<h1>How to play</h1>
        <div class="help">
          <b>Goal:</b> stay inside the arena and knock everyone else out. Leave the boundary (any side) or touch a red hazard and you're out. Last ball rolling wins the round.<br>
          <span class="kbd">←</span><span class="kbd">→</span> push yourself sideways · <span class="kbd">↑</span> upward thrust (weaker than gravity — it softens falls and boosts bounces) · <span class="kbd">↓</span> slam down.<br>
          Hold <span class="kbd">X</span> to go <b>heavy</b>: you become ~3× the mass — much harder to push and you hit far harder — but you accelerate slowly. Holding it drains its strength; let go to recharge (meter bottom-left).<br>
          <span class="kbd">Z</span> is the special key in Arrows (charge &amp; aim), Grapple (rope) and Football (kick).<br>
          <span class="kbd">Esc</span> pause/menu · <span class="kbd">Enter</span> quick match / rematch · <span class="kbd">Space</span> fast-forward while spectating.<br>
          ${App.settings.controls.wasd ? 'WASD also moves (toggle in Settings → Controls).' : 'Enable WASD in Settings → Controls.'}<br>
          <b>Overtime:</b> after ${C.OVERTIME_START}s the side boundaries start closing in.<br>
          <b>Desktop:</b> drag ⠿ to move, the corner grip to resize, – to shrink to a launcher. When you click another app, typing goes to that app; click the arena's <b>⌨ Focus</b> button (or the global shortcut) to come back.
        </div><div class="foot"><button data-a="go" data-v="main">Back</button></div>`;
    },
    settings() {
      const s = App.settings, t = App.settingsTab;
      const tabs = ['match', 'physics', 'desktop', 'audio', 'controls'];
      let body = '';
      if (t === 'match') {
        const ms = s.match;
        body = `<div class="form">
          <label>Your name</label><input type="text" data-k="playerName" value="${esc(s.playerName)}" maxlength="14">
          <label>Your color</label><div class="seg">${DB.SKIN_COLORS.map((c, i) => `<button data-a="set" data-k="playerColor" data-v="${i}" class="${s.playerColor === i ? 'sel' : ''}" style="background:${c};width:20px;height:18px;padding:0"></button>`).join('')}</div>
          <label>Skin</label>${seg('playerPattern', DB.SKIN_PATTERNS, s.playerPattern)}
          <label>Game mode</label>${seg('match.mode', Object.keys(DB.MODES), ms.mode, (k) => DB.MODES[k].name)}
          <label>Bots</label>${seg('match.bots', [1, 2, 3, 4, 5, 6, 7], ms.bots)}
          <label>Difficulty</label>${seg('match.difficulty', [1, 2, 3, 4, 5, 6], ms.difficulty, (d) => DIFF_NAMES[d])}
          <label>Personalities</label>${seg('match.personality', ['mixed'].concat(DB.PERSONALITIES), ms.personality, (p) => p[0].toUpperCase() + p.slice(1))}
          <label>Rounds to win</label><div style="display:flex;gap:6px;align-items:center">${seg('match.winTarget', [3, 5, 10], ms.winTarget)}<input type="number" min="1" max="99" data-k="match.winTarget" value="${ms.winTarget}" style="width:52px"></div>
          <label>Map rotation</label>${toggle('match.rotation', ms.rotation, ['Random each round', 'Keep map'])}
          <label>Teams</label>${seg('match.teamsBalance', ['auto', 'humanRed'], ms.teamsBalance, (v) => v === 'auto' ? 'Alternate (balanced)' : 'You on Red')}
          <label>Quick Match</label><div><button data-a="setquick">Use these as Quick Match defaults</button> <button data-a="resetquick">Reset Quick Match</button></div>
        </div>`;
      } else if (t === 'physics') {
        const p = s.physics;
        const eff = DB.resolvePhysics(p);
        body = `<div class="form">
          <label>Preset</label>${seg('physics.preset', Object.keys(DB.PHYSICS_PRESETS), p.preset, (k) => DB.PHYSICS_PRESETS[k].label)}
          <label>Custom values</label>${toggle('physics.custom', p.custom, ['Use custom', 'Preset only'])}
          <label>Gravity</label>${range('physics.gravity', p.custom ? p.gravity : eff.gravity, 4, 30, 0.5)}
          <label>Move force</label>${range('physics.moveAccel', p.custom ? p.moveAccel : eff.moveAccel, 4, 24, 0.5)}
          <label>Up thrust</label>${range('physics.upAccel', p.custom ? p.upAccel : eff.upAccel, 0, 20, 0.5)}
          <label>Down thrust</label>${range('physics.downAccel', p.custom ? p.downAccel : eff.downAccel, 0, 24, 0.5)}
          <label>Friction ×</label>${range('physics.frictionMul', p.custom ? p.frictionMul : eff.frictionMul, 0, 2, 0.05)}
          <label>Bounciness ×</label>${range('physics.restitutionMul', p.custom ? p.restitutionMul : eff.restitutionMul, 0, 2.5, 0.05)}
          <label>Heavy mass ×</label>${range('physics.heavyMass', p.custom ? p.heavyMass : eff.heavyMass, 1.5, 6, 0.1)}
          <label>Heavy drain /s</label>${range('physics.heavyDrain', p.custom ? p.heavyDrain : eff.heavyDrain, 0, 1, 0.02)}
          <label>Heavy recover /s</label>${range('physics.heavyRecover', p.custom ? p.heavyRecover : eff.heavyRecover, 0.05, 2, 0.05)}
        </div><div class="note" style="margin-top:6px">Custom values only apply when “Use custom” is selected. Changes take effect from the next match. Bots always use exactly the same physics as you.</div>`;
      } else if (t === 'desktop') {
        const d = s.desktop;
        body = `<div class="form">
          <label>Arena size</label>${seg('desktop.size', ['small', 'medium', 'large', 'custom'], d.size, (v) => v[0].toUpperCase() + v.slice(1))}
          <label>Width</label>${range('desktop.width', d.width, 360, 1600, 10)}
          <label>Height</label>${range('desktop.height', d.height, 280, 1100, 10)}
          <label>Position</label>${seg('desktop.position', ['bottom-right', 'bottom-left', 'top-right', 'top-left', 'center'], d.position)}
          <label>Background</label>${seg('desktop.background', ['transparent', 'translucent', 'solid'], d.background, (v) => v[0].toUpperCase() + v.slice(1))}
          <label>Platforms</label>${seg('desktop.platformStyle', ['filled', 'outline'], d.platformStyle, (v) => v === 'filled' ? 'Translucent filled' : 'Outlines only')}
          <label>Outline color</label>${seg('desktop.outlineColor', ['auto', 'white', 'black', 'cyan', 'magenta', 'yellow'], d.outlineColor)}
          <label>Always on top</label>${toggle('desktop.alwaysOnTop', d.alwaysOnTop)}
          <label>Other app focused</label>${toggle('desktop.visibleWhenInactive', d.visibleWhenInactive, ['Stay visible', 'Hide'])}
          <label>Pause when unfocused</label>${toggle('desktop.pauseOnBlur', d.pauseOnBlur)}
          <label>Click-through</label>${toggle('desktop.clickThrough', d.clickThrough, ['Transparent areas pass clicks', 'Whole arena catches clicks'])}
          <label>Frame-rate limit</label>${seg('desktop.fpsLimit', [30, 60, 120], d.fpsLimit)}
          <label>Names</label>${toggle('desktop.showNames', d.showNames)}
          <label>Boundary lines</label>${toggle('desktop.showBounds', d.showBounds)}
        </div>${DB.native.isNative ? '' : '<div class="note" style="margin-top:6px">Window options apply in the macOS app; in a browser the page simply fills the window.</div>'}`;
      } else if (t === 'audio') {
        const a = s.audio;
        body = `<div class="form">
          <label>Master volume</label>${range('audio.master', a.master, 0, 1, 0.05)}
          <label>Collision sounds</label>${toggle('audio.collisions', a.collisions)}
          <label>Interface sounds</label>${toggle('audio.ui', a.ui)}
          <label>Mute</label>${toggle('audio.mute', a.mute)}
        </div>`;
      } else {
        const d = s.desktop;
        const presets = ['ctrl+alt+b', 'ctrl+cmd+b', 'cmd+shift+b', 'ctrl+alt+space', 'none'];
        const fpresets = ['ctrl+alt+g', 'ctrl+cmd+g', 'cmd+shift+g', 'none'];
        body = `<div class="form">
          <label>WASD</label>${toggle('controls.wasd', s.controls.wasd, ['Enabled', 'Arrows only'])}
          <label>Show / hide</label>${seg('desktop.hotkeyToggle', presets, d.hotkeyToggle, fmtHot)}
          <label>Focus game</label>${seg('desktop.hotkeyFocus', fpresets, d.hotkeyFocus, fmtHot)}
        </div>
        <div class="help" style="margin-top:8px">In game: ← → ↑ ↓ move · X heavy · Z special · Esc pause · Enter quick match / rematch · Space fast-forward when spectating. Global shortcuts work from any app (no Accessibility permission needed).</div>`;
      }
      return `<h1>Settings</h1><div class="tabs">${tabs.map((x) => `<button data-a="tab" data-v="${x}" class="${t === x ? 'sel' : ''}">${x[0].toUpperCase() + x.slice(1)}</button>`).join('')}</div>${body}
        <div class="foot"><button data-a="resetall">Reset all settings</button><button class="primary" data-a="back">Done</button></div>`;
    },
  };

  function fmtHot(h) {
    if (!h || h === 'none') return 'None';
    return h.split('+').map((k) => ({ ctrl: '⌃', alt: '⌥', cmd: '⌘', shift: '⇧', space: 'Space' }[k] || k.toUpperCase())).join('');
  }

  function showScreen(name, arg) {
    const prev = App.screen;
    if (name && name !== 'settings' && name !== 'maps') App.prevScreen = name;
    if (name === 'settings' || name === 'maps') App.backTo = prev && prev !== name ? prev : App.backTo || 'main';
    App.screen = name;
    App.screenArg = arg;
    const panel = $('#panel');
    if (!name || name === 'editor') { panel.classList.add('hidden'); panel.innerHTML = ''; reportRects(true); return; }
    panel.innerHTML = SCREENS[name](arg);
    panel.classList.remove('hidden');
    panel.scrollTop = 0;
    if (name === 'maps') loadThumbs();
    releaseAllKeys();
    reportRects(true);
  }
  App.showScreen = showScreen;

  function loadThumbs() {
    const imgs = Array.from(document.querySelectorAll('img[data-thumb]'));
    let i = 0;
    const next = () => {
      if (i >= imgs.length || App.screen !== 'maps') return;
      const img = imgs[i++];
      const id = img.getAttribute('data-thumb');
      if (!App.thumbs[id]) { const m = DB.getMap(id); if (m) { try { App.thumbs[id] = DB.Renderer.thumbnail(m, 120, 80); } catch (e) { console.error('thumb', id, e); } } }
      if (App.thumbs[id]) img.src = App.thumbs[id];
      setTimeout(next, 0);
    };
    next();
  }

  function setPath(obj, path, val) {
    const parts = path.split('.');
    let o = obj;
    for (let i = 0; i < parts.length - 1; i++) o = o[parts[i]] = o[parts[i]] || {};
    const k = parts[parts.length - 1];
    const old = o[k];
    if (typeof old === 'number') val = Number(val);
    else if (typeof old === 'boolean') val = val === true || val === 'true';
    else if (val === 'true' || val === 'false') val = val === 'true';
    else if (!isNaN(val) && val !== '' && typeof old !== 'string') val = Number(val);
    o[k] = val;
  }

  function onSetting(key, val) {
    if (key === 'match.spectate') val = !(val === true || val === 'true'); // toggle labelled "You + bots"
    setPath(App.settings, key, val);
    const s = App.settings;
    if (key === 'match.spectate') s.match.bots = s.match.spectate ? Math.max(2, s.match.bots) : Math.min(7, Math.max(1, s.match.bots));
    if (key === 'match.winTarget') s.match.winTarget = U.clamp(Math.round(s.match.winTarget) || 5, 1, 99);
    if (key.startsWith('physics.') && key !== 'physics.preset' && key !== 'physics.custom') s.physics.custom = true;
    if (key === 'physics.custom' && s.physics.custom) {
      const eff = DB.resolvePhysics({ preset: s.physics.preset });
      for (const k of ['gravity', 'moveAccel', 'upAccel', 'downAccel', 'frictionMul', 'restitutionMul', 'heavyMass', 'heavyDrain', 'heavyRecover']) if (s.physics[k] == null) s.physics[k] = eff[k];
    }
    if (key === 'desktop.size' && DB.SIZE_PRESETS[val]) { s.desktop.width = DB.SIZE_PRESETS[val].width; s.desktop.height = DB.SIZE_PRESETS[val].height; DB.native.post('setSize', { width: s.desktop.width, height: s.desktop.height }); }
    if (key === 'desktop.width' || key === 'desktop.height') { s.desktop.size = 'custom'; DB.native.post('setSize', { width: s.desktop.width, height: s.desktop.height }); }
    if (key === 'desktop.position') DB.native.post('setPosition', { preset: val });
    if (key === 'playerName') s.playerName = String(val).slice(0, 14) || 'You';
    saveSettings();
  }

  const ACTIONS = {
    quick: () => quickMatch(),
    go: (el) => showScreen(el.dataset.v, el.dataset.arg),
    back: () => {
      if (App.backTo === 'pause' && App.match && !App.demo) showScreen('pause');
      else if (App.backTo === 'custom') showScreen('custom');
      else showScreen('main');
    },
    tab: (el) => { App.settingsTab = el.dataset.v; showScreen('settings'); },
    set: (el) => { onSetting(el.dataset.k, el.dataset.v); showScreen(App.screen, App.screenArg); },
    startcustom: () => { const ms = App.settings.match; startMatch(Object.assign({}, ms)); },
    setquick: () => { const ms = App.settings.match; App.settings.quick = { mode: ms.mode, bots: ms.spectate ? 5 : ms.bots, difficulty: ms.difficulty, personality: ms.personality, winTarget: ms.winTarget, mapId: ms.mapId, rotation: ms.rotation, spectate: false }; saveSettings(); flash('Quick Match defaults saved'); },
    resetquick: () => { delete App.settings.quick; saveSettings(); flash('Quick Match reset to defaults'); },
    pickmap: (el) => {
      App.settings.match.mapId = el.dataset.v; saveSettings();
      if (App.backTo === 'pause' && App.match && !App.demo) {
        // change map immediately in the running match
        App.match.cfg.mapId = el.dataset.v; App.match.fixedMapId = el.dataset.v; App.match.nextRound(DB.getMap(el.dataset.v)); App.match.round--; showScreen(null);
      } else showScreen('custom');
    },
    playmap: (el) => {
      const m = DB.getMap(el.dataset.v);
      const football = m && (m.goals || (m.modes || []).indexOf('football') >= 0);
      startMatch({ mapId: el.dataset.v, rotation: false, mode: football ? 'football' : (App.settings.match.mode === 'football' ? 'classic' : App.settings.match.mode), spectate: false, bots: App.settings.match.spectate ? 5 : App.settings.match.bots });
    },
    resume: () => { showScreen(null); requestFocus(); },
    rematch: () => { if (App.match && !App.demo) { App.match.rematch(); showScreen(null); requestFocus(); } },
    skipround: () => { if (App.match && !App.demo) { App.match.nextRound(); showScreen(null); } },
    newmap: () => { if (App.match) { App.match.cfg.mapId = 'random'; App.match.fixedMapId = null; App.match.rematch(); requestFocus(); } },
    menu: () => { App.returnToEditor = false; showScreen('main'); startDemo(); },
    minimize: () => { DB.native.post('minimize'); },
    quit: () => { DB.native.post('quit'); },
    editor: () => { if (DB.editor) DB.editor.open(App); },
    backeditor: () => { App.returnToEditor = false; App.match = null; DB.editor.open(App); },
    resetall: () => { if (confirm('Reset all settings to defaults?')) { App.settings = U.deepClone(DB.DEFAULT_SETTINGS); saveSettings(); showScreen('settings'); } },
  };
  App.ACTIONS = ACTIONS;

  function flash(msg) {
    const el = document.createElement('div');
    el.className = 'banner';
    el.style.cssText = 'position:absolute;left:50%;bottom:30px;transform:translateX(-50%);min-width:0;padding:4px 12px;pointer-events:none;z-index:9';
    el.textContent = msg;
    document.getElementById('app').appendChild(el);
    setTimeout(() => el.remove(), 1400);
  }
  App.flash = flash;

  function bindUi() {
    document.addEventListener('click', (e) => {
      DB.audio.ensure();
      const el = e.target.closest('[data-a]');
      if (!el) return;
      const fn = ACTIONS[el.dataset.a];
      if (fn) { DB.audio.ui('click'); fn(el); }
    });
    document.addEventListener('input', (e) => {
      const el = e.target;
      if (!el.dataset || !el.dataset.k) return;
      if (el.type === 'range') { const v = el.nextElementSibling; if (v) v.textContent = el.value; }
    });
    document.addEventListener('change', (e) => {
      const el = e.target;
      if (!el.dataset || !el.dataset.k) return;
      onSetting(el.dataset.k, el.value);
      if (el.type !== 'text') showScreen(App.screen, App.screenArg);
    });
    $('#tbQuick').onclick = () => { DB.audio.ui('click'); quickMatch(); };
    $('#tbMenu').onclick = () => {
      DB.audio.ui('click');
      if (App.screen === 'editor') { DB.editor.close(); return; }
      if (App.match && !App.demo) showScreen(App.screen === 'pause' ? null : 'pause');
      else showScreen('main');
    };
    $('#tbFocus').onclick = () => requestFocus();
    $('#focusHint').onclick = () => requestFocus();
    $('#tbMin').onclick = () => DB.native.post('minimize') || flash('Minimize works in the macOS app');
    $('#tbHide').onclick = () => DB.native.post('hide') || flash('Hide works in the macOS app');
    document.querySelectorAll('#toolbar .sizes button').forEach((b) => {
      b.onclick = () => { onSetting('desktop.size', b.dataset.size); if (App.screen === 'settings') showScreen('settings'); };
    });
    $('#drag').addEventListener('mousedown', (e) => { e.preventDefault(); DB.native.post('dragStart'); });
    $('#grip').addEventListener('mousedown', (e) => { e.preventDefault(); DB.native.post('resizeStart'); });
    // clicking the arena itself gives the game focus (when the window catches the click)
    document.getElementById('game').addEventListener('mousedown', () => { if (!App.focused) requestFocus(); });
    window.addEventListener('keydown', onKeyDown, { capture: true });
    window.addEventListener('keyup', onKeyUp, { capture: true });
    window.addEventListener('blur', () => setFocused(false));
    window.addEventListener('focus', () => setFocused(true));
    document.addEventListener('visibilitychange', () => { App.hidden = document.hidden; if (document.hidden) releaseAllKeys(); });
    window.addEventListener('resize', resize);
    DB.native.on((e) => {
      if (e.type === 'focus') setFocused(true);
      else if (e.type === 'blur') setFocused(false);
      else if (e.type === 'hidden') { App.hidden = true; releaseAllKeys(); }
      else if (e.type === 'shown') { App.hidden = false; }
      else if (e.type === 'command') {
        if (e.name === 'quick') quickMatch();
        else if (e.name === 'menu') { if (App.match && !App.demo) showScreen('pause'); else showScreen('main'); }
        else if (e.name === 'settings') showScreen('settings');
        else if (e.name === 'editor') ACTIONS.editor();
      } else if (e.type === 'size') {
        App.settings.desktop.width = e.width; App.settings.desktop.height = e.height;
        if (e.preset) App.settings.desktop.size = e.preset;
        DB.store.set('settings', App.settings);
      }
    });
    // keep the click-through regions fresh
    setInterval(() => reportRects(), 500);
  }

  // ------------------------------------------------------------------- boot ----
  function boot() {
    App.settings = loadSettings();
    App.settings.controls = Object.assign({ wasd: true }, App.settings.controls || {});
    loadCustomMaps();
    App.renderer = new DB.Renderer($('#game'));
    DB.audio.init(App.settings.audio);
    bindUi();
    resize();
    applySettings();
    showScreen('main');
    startDemo();
    requestAnimationFrame(frame);
    DB.native.post('ready', { desktop: App.settings.desktop });
    // test hooks: ?quick, ?map=<id>, ?spectate=<id>
    const q = new URLSearchParams(location.search);
    if (q.has('nopause')) App.noBlurPause = true;
    if (q.has('quick')) quickMatch();
    if (q.get('map')) startMatch({ mapId: q.get('map'), rotation: false });
    if (q.get('spectate')) startMatch({ mapId: q.get('spectate'), rotation: false, spectate: true, bots: +(q.get('bots') || 6), difficulty: +(q.get('level') || 3) });
    if (q.get('screen')) showScreen(q.get('screen'), q.get('arg'));
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})(window);

// Physics presets, game constants and default settings.
(function (root) {
  'use strict';
  const DB = root.DB;

  // World units are metres. A standard arena view is 60 x 40 m; players are 1 m radius
  // circles (roughly the proportions of a classic Bonk-style 730x500 arena).
  DB.PHYSICS_PRESETS = {
    bonk: {
      label: 'Bonk Classic',
      gravity: 13,            // m/s^2 downward
      moveAccel: 10,          // horizontal acceleration from arrow keys at normal mass (m/s^2)
      upAccel: 8.5,           // upward thrust: weaker than gravity, so you float/hop but cannot fly
      downAccel: 12,          // downward thrust: slam down quickly
      linearDamping: 0.12,    // very light air drag -> long momentum
      angularDamping: 0.25,
      playerFriction: 0.55,
      playerRestitution: 0.42,
      bounceRestitution: 0.85, // ball-vs-ball bounce (bonks!)
      heavyMass: 3.2,         // mass multiplier when heavy at full effectiveness
      heavyMinMass: 1.45,     // multiplier when effectiveness is fully drained
      heavyDrain: 0.34,       // effectiveness lost per second while held (≈3 s to drain)
      heavyRecover: 0.5,      // effectiveness regained per second while released
      heavyForceScale: 1.0,   // fraction of normal *force* available while heavy (accel = F / mass)
      frictionMul: 1,
      restitutionMul: 1,
    },
    floaty: {
      label: 'Floaty', gravity: 8, moveAccel: 9, upAccel: 6.5, downAccel: 9, linearDamping: 0.08,
      angularDamping: 0.2, playerFriction: 0.5, playerRestitution: 0.5, heavyMass: 3.2, heavyMinMass: 1.45,
      heavyDrain: 0.34, heavyRecover: 0.5, heavyForceScale: 1, frictionMul: 1, restitutionMul: 1,
    },
    heavyworld: {
      label: 'High Gravity', gravity: 20, moveAccel: 14, upAccel: 12, downAccel: 14, linearDamping: 0.15,
      angularDamping: 0.3, playerFriction: 0.6, playerRestitution: 0.35, heavyMass: 3.2, heavyMinMass: 1.45,
      heavyDrain: 0.34, heavyRecover: 0.5, heavyForceScale: 1, frictionMul: 1, restitutionMul: 1,
    },
    bouncy: {
      label: 'Super Bouncy', gravity: 13, moveAccel: 11, upAccel: 8.5, downAccel: 12, linearDamping: 0.1,
      angularDamping: 0.25, playerFriction: 0.4, playerRestitution: 0.8, heavyMass: 3.2, heavyMinMass: 1.45,
      heavyDrain: 0.34, heavyRecover: 0.5, heavyForceScale: 1, frictionMul: 0.8, restitutionMul: 1.6,
    },
  };

  DB.CONST = {
    DT: 1 / 60,
    VEL_ITERS: 10,
    POS_ITERS: 4,
    PLAYER_RADIUS: 1,
    VIEW_W: 60,
    VIEW_H: 40,
    COUNTDOWN: 2.4,         // seconds before a round starts
    ROUND_END_DELAY: 2.6,   // seconds the winner banner shows before next countdown
    ROUND_TIME_LIMIT: 100,  // a round with no winner after this long is a draw
    OVERTIME_START: 35,     // seconds; then the side boundaries start closing in
    OVERTIME_SPEED: 0.8,    // m/s per side
    MAX_PLAYERS: 8,
    ARROW_RECOIL: 0.35,     // fraction of the arrow's momentum pushed back into the archer
    // collision categories
    CAT_WORLD: 0x0001,
    CAT_PLAYER: 0x0002,
    CAT_OBJWALL: 0x0004,    // invisible walls that only stop free-floating objects / balls
    CAT_BALL: 0x0008,
    CAT_ARROW: 0x0010,
    CAT_OBJECT: 0x0020,     // free-floating dynamic objects
    CAT_DECOR: 0x0040,
  };

  DB.SKIN_COLORS = ['#ff5a5a', '#4aa8ff', '#ffd23f', '#5ee08a', '#c779ff', '#ff9d3f', '#3fe0d8', '#ff6fc1',
    '#9ad94a', '#f2f2f2', '#7f8cff', '#b0835a'];
  DB.SKIN_PATTERNS = ['solid', 'stripe', 'half', 'dot', 'ring', 'cross', 'split', 'eyes'];
  DB.TEAM_COLORS = { 1: '#ff4f4f', 2: '#3d8bff' };
  DB.BOT_NAMES = ['Bonkers', 'Rolly', 'Pebble', 'Nudge', 'Orbit', 'Puck', 'Marble', 'Bumper', 'Wobble', 'Tumble',
    'Glide', 'Plonk', 'Zoomy', 'Biscuit', 'Comet', 'Mochi', 'Gumball', 'Kiwi', 'Sprocket', 'Dumpling'];

  DB.DIFFICULTIES = [
    { level: 1, name: 'Beginner' }, { level: 2, name: 'Casual' }, { level: 3, name: 'Normal' },
    { level: 4, name: 'Skilled' }, { level: 5, name: 'Expert' }, { level: 6, name: 'Insane' },
  ];
  DB.PERSONALITIES = ['aggressive', 'defensive', 'opportunistic', 'risktaker', 'patient', 'balanced'];

  DB.MODES = {
    classic: { name: 'Classic', desc: 'Last ball rolling wins. Arrows move, hold X to go heavy.' },
    teams: { name: 'Teams', desc: 'Red vs Blue. Last team with a survivor wins the round.' },
    arrows: { name: 'Arrows', desc: 'Hold Z to charge an arrow, aim with arrow keys, release to fire.' },
    grapple: { name: 'Grapple', desc: 'Hold Z to shoot a rope toward the direction you hold. Up/Down reels.' },
    football: { name: 'Football', desc: 'Push the ball into the other team’s goal. Z kicks.' },
  };

  DB.DEFAULT_SETTINGS = {
    version: 1,
    playerName: 'You',
    playerColor: 0,
    playerPattern: 'stripe',
    match: {
      mode: 'classic',
      bots: 5,
      difficulty: 3,
      personality: 'mixed',    // 'mixed' or one of DB.PERSONALITIES
      mapId: 'random',         // 'random' or a map id
      rotation: true,          // pick a new random map every round
      winTarget: 5,
      teamsBalance: 'auto',    // 'auto' | 'humanRed'
      spectate: false,         // bot-only match
    },
    physics: {
      preset: 'bonk',
      custom: false,
      gravity: 13, moveAccel: 10, upAccel: 8.5, downAccel: 12,
      frictionMul: 1, restitutionMul: 1,
      heavyMass: 3.2, heavyDrain: 0.34, heavyRecover: 0.5,
    },
    desktop: {
      size: 'medium',           // small | medium | large | custom
      width: 720, height: 520,
      position: 'bottom-right', // bottom-right | bottom-left | top-right | top-left | center | free
      background: 'transparent',// transparent | translucent | solid
      platformStyle: 'filled',  // filled | outline
      outlineColor: 'auto',     // auto | white | black | cyan | magenta | yellow
      alwaysOnTop: true,
      visibleWhenInactive: true,
      clickThrough: true,       // clicks on transparent arena areas reach apps below
      pauseOnBlur: true,
      fpsLimit: 60,
      showNames: true,
      showBounds: true,
      hotkeyToggle: 'ctrl+alt+b',
      hotkeyFocus: 'ctrl+alt+g',
    },
    audio: { master: 0.6, collisions: true, ui: true, mute: false },
  };

  DB.SIZE_PRESETS = {
    small: { width: 480, height: 360 },
    medium: { width: 720, height: 520 },
    large: { width: 960, height: 680 },
  };

  // Resolve the effective physics parameter set from settings.
  DB.resolvePhysics = function (physSettings) {
    const s = physSettings || DB.DEFAULT_SETTINGS.physics;
    const base = DB.util.deepClone(DB.PHYSICS_PRESETS[s.preset] || DB.PHYSICS_PRESETS.bonk);
    if (s.custom) {
      for (const k of ['gravity', 'moveAccel', 'upAccel', 'downAccel', 'frictionMul', 'restitutionMul', 'heavyMass',
        'heavyDrain', 'heavyRecover']) {
        if (typeof s[k] === 'number' && isFinite(s[k])) base[k] = s[k];
      }
      base.heavyMinMass = Math.min(base.heavyMinMass, Math.max(1, base.heavyMass * 0.45));
    }
    return base;
  };
})(typeof window !== 'undefined' ? window : globalThis);

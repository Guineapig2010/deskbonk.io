// The 30 built-in maps (+ football pitches). Every map is plain data consumed by DB.buildWorld.
// Coordinates: metres, origin top-left, +y is DOWN. Standard view is 60 x 40.
// Body types: static | kinematic (path / piston / spin / swing) | dynamic (+ joints).
(function (root) {
  'use strict';
  const DB = root.DB;
  const U = DB.util;

  // ---- tiny authoring helpers (they only produce data) -------------------------
  let uid = 0;
  const id = (p) => (p || 'b') + (++uid);
  const box = (x, y, w, h, o) => Object.assign({ id: id('box'), type: 'static', x, y, shapes: [{ t: 'box', w, h }] }, o || {});
  const circ = (x, y, r, o) => Object.assign({ id: id('cir'), type: 'static', x, y, shapes: [{ t: 'circle', r }] }, o || {});
  const poly = (pts, o) => Object.assign({ id: id('pol'), type: 'static', x: 0, y: 0, shapes: [{ t: 'poly', pts }] }, o || {});
  // thick slab between two points (sloped platform)
  const slab = (x1, y1, x2, y2, th, o) => {
    const dx = x2 - x1, dy = y2 - y1, L = Math.hypot(dx, dy);
    const nx = -dy / L, ny = dx / L; // normal pointing "down" for left->right
    return poly([[x1, y1], [x2, y2], [x2 + nx * th, y2 + ny * th], [x1 + nx * th, y1 + ny * th]], o);
  };
  const on = (top, xs) => xs.map((x) => [x, top - 1.6]);
  const slopeY = (x1, y1, x2, y2, x) => y1 + ((y2 - y1) * (x - x1)) / (x2 - x1);

  const maps = [];
  const add = (m) => { maps.push(m); return m; };

  // ============================== CLASSIC =====================================
  add({
    id: 'flatline', name: 'Flatline', category: 'Classic',
    desc: 'One long platform over the void with two small raised blocks hanging near the edges — bounce off them for surprise hits. Pure movement and heavy timing.',
    bodies: [
      box(30, 26, 46, 2, { id: 'floor' }),
      box(11, 20.6, 3.2, 1.2), box(49, 20.6, 3.2, 1.2),
    ],
    spawns: on(25, [14, 18.5, 23, 27.5, 32.5, 37, 41.5, 46]),
    ai: { tip: 'flat' },
  });

  add({
    id: 'twin_islands', name: 'Twin Islands', category: 'Classic',
    desc: 'Two islands split by a gap. A sliding raft in the middle can be pushed around — momentum gets you across.',
    bodies: [
      box(12, 26, 20, 3), box(48, 26, 20, 3),
      { id: 'raft', type: 'dynamic', x: 30, y: 24.5, density: 0.6, friction: 0.7, shapes: [{ t: 'box', w: 7, h: 1.2 }] },
    ],
    joints: [{ t: 'prismatic', a: null, b: 'raft', anchor: [30, 24.5], axis: [1, 0], limits: [-4.2, 4.2], motor: { speed: 0, force: 6 } }],
    spawns: on(24.5, [5, 9, 13, 17, 43, 47, 51, 55]),
  });

  (function () {
    const L = slab(14, 22.5, 30.5, 30, 2.2, { id: 'rampL', friction: 0.5 });
    const R = slab(29.5, 30, 46, 22.5, 2.2, { id: 'rampR', friction: 0.5 });
    const sp = [16.5, 19.5, 22.5, 25.5].map((x) => [x, slopeY(14, 22.5, 30.5, 30, x) - 1.5])
      .concat([34.5, 37.5, 40.5, 43.5].map((x) => [x, slopeY(29.5, 30, 46, 22.5, x) - 1.5]));
    add({
      id: 'valley', name: 'The Valley', category: 'Classic',
      desc: 'Two ramps meet in a deep V. Everyone collides at the bottom — win the clash to launch rivals up and off the far ends.',
      bodies: [L, R], spawns: sp,
    });
  })();

  add({
    id: 'four_corners', name: 'Four Corners', category: 'Classic',
    desc: 'Four islands around an empty middle, linked by thin sloped bridges. Every edge is exposed.',
    bodies: [
      box(7, 23, 10, 2), box(53, 23, 10, 2), box(30, 17, 12, 2), box(30, 29, 12, 2),
      slab(12, 22, 24, 16, 0.8), slab(36, 16, 48, 22, 0.8),
      slab(12, 22, 24, 28, 0.8), slab(36, 28, 48, 22, 0.8),
    ],
    spawns: on(22, [4.5, 9.5, 50.5, 55.5]).concat(on(16, [27, 33])).concat(on(28, [27, 33])),
  });

  add({
    id: 'narrow_escape', name: 'Narrow Escape', category: 'Classic',
    desc: 'A long, thin beam broken by small gaps, with little launch ramps. Roll fast over the gaps — or fall in.',
    bodies: [
      box(8.5, 26, 11, 1), box(22.6, 26, 12.4, 1), box(37.4, 26, 12.4, 1), box(51.5, 26, 11, 1),
      poly([[11, 25.5], [14, 25.5], [14, 24.4]]), poly([[46, 25.5], [49, 25.5], [46, 24.4]]),
      poly([[26, 25.5], [28.8, 25.5], [28.8, 24.6]]), poly([[31.2, 25.5], [34, 25.5], [31.2, 24.6]]),
    ],
    spawns: on(25.5, [5, 9, 18, 23, 37, 42, 51, 55]),
  });

  (function () {
    const spawns = [56, 64, 72, 80, 100, 108, 116, 124].map((a) => [30 + Math.cos(U.deg(a)) * 30.4, -3 + Math.sin(U.deg(a)) * 30.4]);
    add({
      id: 'bowl', name: 'The Bowl', category: 'Classic',
      desc: 'A smooth round bowl. Roll down the sides, build speed and meet in the middle at full tilt.',
      bodies: [{ id: 'bowl', type: 'static', x: 0, y: 0, friction: 0.5, shapes: [{ t: 'arc', x: 30, y: -3, r0: 32, r1: 33.8, a0: 52, a1: 128, n: 30, smooth: 'inner' }] }],
      spawns,
    });
  })();

  // ============================ MOVING PLATFORMS ===============================
  add({
    id: 'spinning_plank', name: 'Spinning Plank', category: 'Moving',
    desc: 'A long motor-driven beam slowly turning around a hub. Stay near the middle, ride the hub as it flips, or drop to the catch ledges — the beam tips sweep them.',
    bodies: [
      { id: 'hub', type: 'static', x: 30, y: 20, shapes: [{ t: 'circle', r: 2.4 }], friction: 0.8 },
      { id: 'plank', type: 'dynamic', x: 30, y: 20, density: 0.5, friction: 0.7, angularDamping: 0, shapes: [{ t: 'box', w: 42, h: 1.6 }] },
      box(6.5, 32.6, 12, 1.4), box(53.5, 32.6, 12, 1.4),
    ],
    joints: [{ t: 'revolute', a: 'hub', b: 'plank', anchor: [30, 20], motor: { speed: 0.2, torque: 9000 } }],
    spawns: on(19.2, [13, 17, 21, 25.5, 34.5, 39, 43, 47]),
    ai: { rotating: true, safe: [[6.5, 30.6], [53.5, 30.6]] },
  });

  add({
    id: 'double_spinner', name: 'Double Spinner', category: 'Moving',
    desc: 'Two beams spinning in opposite directions side by side, with a small safety ledge between them.',
    bodies: [
      { id: 'hubL', type: 'static', x: 17, y: 20, shapes: [{ t: 'circle', r: 1.6 }] },
      { id: 'hubR', type: 'static', x: 43, y: 20, shapes: [{ t: 'circle', r: 1.6 }] },
      { id: 'spL', type: 'dynamic', x: 17, y: 20, density: 0.5, friction: 0.7, shapes: [{ t: 'box', w: 22, h: 1.4 }] },
      { id: 'spR', type: 'dynamic', x: 43, y: 20, density: 0.5, friction: 0.7, shapes: [{ t: 'box', w: 22, h: 1.4 }] },
      box(30, 31, 7, 1.2),
    ],
    joints: [
      { t: 'revolute', a: 'hubL', b: 'spL', anchor: [17, 20], motor: { speed: 0.42, torque: 6000 } },
      { t: 'revolute', a: 'hubR', b: 'spR', anchor: [43, 20], motor: { speed: -0.42, torque: 6000 } },
    ],
    spawns: on(19.3, [9, 12.5, 21.5, 25, 35, 38.5, 47.5, 51]),
    ai: { rotating: true },
  });

  add({
    id: 'moving_bridges', name: 'Moving Bridges', category: 'Moving',
    desc: 'Three bridges glide back and forth on fixed tracks. The gaps between them open and close in rhythm.',
    bodies: [
      box(3.5, 24, 5, 1.5), box(56.5, 24, 5, 1.5),
      { id: 'br1', type: 'kinematic', x: 12, y: 24, friction: 0.8, shapes: [{ t: 'box', w: 11, h: 1.5 }], path: { pts: [[12, 24], [16, 24]], period: 3.2, wait: 0.6 } },
      { id: 'br2', type: 'kinematic', x: 30, y: 22, friction: 0.8, shapes: [{ t: 'box', w: 10, h: 1.5 }], path: { pts: [[27, 22], [33, 22]], period: 4.0, wait: 0.5, phase: 0.5 } },
      { id: 'br3', type: 'kinematic', x: 48, y: 24, friction: 0.8, shapes: [{ t: 'box', w: 11, h: 1.5 }], path: { pts: [[48, 24], [44, 24]], period: 3.2, wait: 0.6 } },
    ],
    spawns: [[3.5, 21.6], [56.5, 21.6], [10.5, 21.6], [15.5, 21.6], [27, 19.6], [33, 19.6], [44.5, 21.6], [49.5, 21.6]],
    ai: { moving: true },
  });

  add({
    id: 'elevator', name: 'The Elevator', category: 'Moving',
    desc: 'Ledges on three levels and lifts running between them. Ride up, jump off at the top of the stroke.',
    bodies: [
      box(5, 33, 10, 1.6), box(5, 21, 10, 1.6), box(5, 9, 10, 1.6),
      box(55, 33, 10, 1.6), box(55, 21, 10, 1.6), box(55, 9, 10, 1.6),
      { id: 'el1', type: 'kinematic', x: 17, y: 33, friction: 0.9, shapes: [{ t: 'box', w: 7, h: 1 }], path: { pts: [[17, 33], [17, 9]], period: 4.5, wait: 1.2 } },
      { id: 'el2', type: 'kinematic', x: 30, y: 9, friction: 0.9, shapes: [{ t: 'box', w: 7, h: 1 }], path: { pts: [[30, 33.5], [30, 9]], period: 4.5, wait: 1.2, phase: 0.5 } },
      { id: 'el3', type: 'kinematic', x: 43, y: 33, friction: 0.9, shapes: [{ t: 'box', w: 7, h: 1 }], path: { pts: [[43, 33], [43, 15]], period: 3.5, wait: 1.0, phase: 0.25 } },
    ],
    spawns: [[3, 30.6], [7, 30.6], [53, 30.6], [57, 30.6], [4, 18.6], [56, 18.6], [17, 30.6], [43, 30.6]],
    ai: { moving: true },
  });

  (function () {
    const bodies = [], joints = [], spawns = [];
    [10, 30, 50].forEach((x, i) => {
      bodies.push({ id: 'ful' + i, type: 'static', x: 0, y: 0, shapes: [{ t: 'poly', pts: [[x - 2, 28], [x + 2, 28], [x, 24.8]] }] });
      bodies.push({ id: 'saw' + i, type: 'dynamic', x, y: 24.2, density: 0.32, friction: 0.75, angularDamping: 0.6, shapes: [{ t: 'box', w: 17, h: 1.2 }] });
      joints.push({ t: 'revolute', a: 'ful' + i, b: 'saw' + i, anchor: [x, 24.2], limits: [-24, 24] });
    });
    [4, 8, 12, 16].forEach((dx, k) => spawns.push([10 + (dx - 10) * 0.9 + (k < 2 ? 0 : 0), 21.9]));
    add({
      id: 'seesaw', name: 'Seesaw Showdown', category: 'Moving',
      desc: 'Three seesaws on pivots. Your mass tips them — go heavy on one end to catapult whoever is on the other.',
      bodies, joints,
      spawns: [[5, 21.8], [15, 21.8], [25, 21.8], [35, 21.8], [45, 21.8], [55, 21.8], [27.5, 21.8], [32.5, 21.8]],
      ai: { tilting: true },
    });
  })();

  (function () {
    const gear = (gid, x, y, r, spin, teeth) => {
      const shapes = [{ t: 'circle', r }];
      for (let i = 0; i < teeth; i++) {
        const a = (360 / teeth) * i;
        shapes.push({ t: 'box', w: 2.6, h: 1.1, x: Math.cos(U.deg(a)) * (r + 0.2), y: Math.sin(U.deg(a)) * (r + 0.2), a: a + 90 });
      }
      return { id: gid, type: 'kinematic', x, y, spin, friction: 0.9, shapes };
    };
    add({
      id: 'gearbox', name: 'Gearbox', category: 'Moving',
      desc: 'Three big turning discs with blocks bolted to their rims, each spinning at its own speed and direction. Two small catch ledges sit below.',
      bodies: [gear('g1', 13, 25, 6, 0.3, 4), gear('g2', 30, 19, 5, -0.42, 3), gear('g3', 47, 25, 6, 0.22, 5),
        box(22, 34, 5.5, 1.2), box(38, 34, 5.5, 1.2)],
      spawns: [[11, 16.5], [15, 16.5], [28.2, 11], [31.8, 11], [45, 16.5], [49, 16.5], [8.5, 18], [51.5, 18]],
      ai: { rotating: true, safe: [[22, 32], [38, 32]] },
    });
  })();

  // ================================ MECHANICAL ==================================
  add({
    id: 'pinball', name: 'Pinball', category: 'Mechanical',
    desc: 'Bumpers, elastic walls and a drain in the middle. Expect fast rebounds from every direction.',
    bodies: [
      box(1.5, 17, 2, 22, { restitution: 0.8 }), box(58.5, 17, 2, 22, { restitution: 0.8 }),
      slab(0.5, 28, 24, 35, 1.6, { restitution: 0.35, friction: 0.4 }),
      slab(36, 35, 59.5, 28, 1.6, { restitution: 0.35, friction: 0.4 }),
      circ(19, 15, 2.2, { bumper: 10, restitution: 0.9, color: '#ff5fd2' }),
      circ(41, 15, 2.2, { bumper: 10, restitution: 0.9, color: '#ff5fd2' }),
      circ(30, 23, 2.4, { bumper: 12, restitution: 0.9, color: '#ff5fd2' }),
      box(10, 21, 8, 1, { a: 14, restitution: 1.0, color: '#ff9ef0' }),
      box(50, 21, 8, 1, { a: -14, restitution: 1.0, color: '#ff9ef0' }),
      box(30, 8, 9, 1, { restitution: 1.0, color: '#ff9ef0' }),
      circ(24, 35.6, 0.9, { restitution: 1.0, color: '#ff9ef0' }), circ(36, 35.6, 0.9, { restitution: 1.0, color: '#ff9ef0' }),
    ],
    spawns: [[6, 27.2], [11, 28.5], [16, 30], [44, 30], [49, 28.5], [54, 27.2], [8, 18.2], [52, 18.2]],
    ai: { bouncy: true },
  });

  add({
    id: 'crusher', name: 'The Crusher', category: 'Mechanical',
    desc: 'Two giant walls slide in and out across the floor. Get through the middle, or ride a wall top — before it retracts.',
    bodies: [
      box(30, 30, 44, 2, { id: 'floor' }),
      { id: 'wl', type: 'kinematic', x: 3, y: 20, friction: 0.6, color: '#ff8a5c', shapes: [{ t: 'box', w: 6, h: 18 }], path: { pts: [[3, 20], [24, 20]], period: 3.6, wait: 1.6 } },
      { id: 'wr', type: 'kinematic', x: 57, y: 20, friction: 0.6, color: '#ff8a5c', shapes: [{ t: 'box', w: 6, h: 18 }], path: { pts: [[57, 20], [36, 20]], period: 3.6, wait: 1.6 } },
    ],
    spawns: on(29, [12, 16, 20, 25, 35, 40, 44, 48]),
    ai: { moving: true, crusher: true },
  });

  (function () {
    const bodies = [], joints = [];
    [6, 15, 25, 35, 45, 54].forEach((x) => bodies.push(box(x, 30.5, 6, 1.2)));
    [15, 30, 45].forEach((x, i) => {
      const L = 23.4, amp = 34;
      bodies.push({
        id: 'pend' + i, type: 'dynamic', x, y: 4, a: 34, density: 1, angularDamping: 0, friction: 0.3, restitution: 0.3,
        keeper: { pivot: [x, 4], amp, torque: 1400 },
        color: '#c9a6ff',
        shapes: [{ t: 'box', w: 0.4, h: L, y: L / 2, decor: true }, { t: 'circle', r: 2.3, y: L, }],
        densityNote: 'bob',
      });
      joints.push({ t: 'revolute', a: null, b: 'pend' + i, anchor: [x, 4] });
      bodies.push(circ(x, 4, 0.8, { decor: true }));
    });
    add({
      id: 'pendulum_pit', name: 'Pendulum Pit', category: 'Mechanical',
      desc: 'Heavy pendulums sweep low over a row of narrow platforms. Duck the swing or use it to bat rivals away.',
      bodies, joints,
      spawns: on(29.9, [5, 7, 15, 25, 35, 45, 53, 55]),
      ai: { pendulums: true },
    });
  })();

  (function () {
    const bodies = [box(4, 13, 8, 1.4), box(56, 13, 8, 1.4)], joints = [];
    const xs = [8, 18, 30, 42, 52];
    xs.forEach((x, i) => {
      const y = i === 2 ? 30 : 29;
      bodies.push({ id: 'spr' + i, type: 'dynamic', x, y, density: 0.2, gravityScale: 0, friction: 0.8, color: '#7dffb0', shapes: [{ t: 'box', w: 7, h: 1 }] });
      bodies.push(box(x, y + 7.5, 2.2, 1, { decor: true, color: '#556' }));
      joints.push({ t: 'prismatic', a: null, b: 'spr' + i, anchor: [x, y], axis: [0, 1], limits: [-1.2, 4.2] });
      joints.push({ t: 'spring', a: null, b: 'spr' + i, anchorA: [x, y + 7], anchorB: [x, y + 0.5], hz: 0.6, damping: 0.05 });
    });
    add({
      id: 'springboard', name: 'Springboard', category: 'Mechanical',
      desc: 'Platforms on springs. Land heavy to compress one; the rebound throws everyone on it skyward.',
      bodies, joints,
      spawns: [[6, 26.8], [10, 26.8], [18, 26.8], [28, 27.8], [32, 27.8], [42, 26.8], [50, 26.8], [54, 26.8]],
      ai: { springs: true },
    });
  })();

  (function () {
    const bodies = [box(6.5, 26, 11, 2.4, { id: 'ledgeL' }), box(53.5, 26, 11, 2.4, { id: 'ledgeR' })], joints = [];
    const n = 6, w = 36 / n;
    for (let i = 0; i < n; i++) {
      const x = 12 + w / 2 + i * w;
      bodies.push({ id: 'pc' + i, type: 'dynamic', x, y: 25.6, density: 0.55, friction: 0.7, color: '#ffd59a', shapes: [{ t: 'box', w: w - 0.04, h: 1.6 }] });
    }
    for (let i = 0; i <= n; i++) {
      const x = 12 + i * w;
      const a = i === 0 ? 'ledgeL' : 'pc' + (i - 1), b = i === n ? 'ledgeR' : 'pc' + i;
      joints.push({ t: 'weld', a, b, anchor: [x, 25.6], break: i === 0 || i === n ? 1500 : 1150, fatigue: 2.2 });
    }
    add({
      id: 'breakaway', name: 'Breakaway', category: 'Mechanical',
      desc: 'The central bridge is held together by breakable joints. Heavy slams and pile-ups tear pieces loose.',
      bodies, joints,
      spawns: on(24.8, [4, 8, 17, 24, 36, 43, 52, 56]),
      ai: { breakable: true },
    });
  })();

  add({
    id: 'piston_panic', name: 'Piston Panic', category: 'Mechanical',
    desc: 'Pistons punch out of the side housings and up through the floor on a timed pattern.',
    bodies: [
      box(15.2, 30.5, 10.4, 2), box(30, 30.5, 8.8, 2, { id: 'floorM' }), box(44.8, 30.5, 10.4, 2),
      box(3, 22, 6, 12, { color: '#8790a8' }), box(57, 22, 6, 12, { color: '#8790a8' }),
      { id: 'pl1', type: 'kinematic', x: 2, y: 27.3, color: '#ff8a5c', shapes: [{ t: 'box', w: 10, h: 2.6 }], piston: { from: [2, 27.3], to: [15, 27.3], rest: 2.2, out: 0.35, hold: 0.7, back: 1.4, phase: 0 } },
      { id: 'pr1', type: 'kinematic', x: 58, y: 27.3, color: '#ff8a5c', shapes: [{ t: 'box', w: 10, h: 2.6 }], piston: { from: [58, 27.3], to: [45, 27.3], rest: 2.2, out: 0.35, hold: 0.7, back: 1.4, phase: 0.5 } },
      { id: 'pl2', type: 'kinematic', x: 2, y: 19, color: '#ff8a5c', shapes: [{ t: 'box', w: 10, h: 2.4 }], piston: { from: [2, 19], to: [13, 19], rest: 3.0, out: 0.4, hold: 0.6, back: 1.4, phase: 0.25 } },
      { id: 'pr2', type: 'kinematic', x: 58, y: 19, color: '#ff8a5c', shapes: [{ t: 'box', w: 10, h: 2.4 }], piston: { from: [58, 19], to: [47, 19], rest: 3.0, out: 0.4, hold: 0.6, back: 1.4, phase: 0.75 } },
      { id: 'pf1', type: 'kinematic', x: 23, y: 31.5, color: '#ff8a5c', shapes: [{ t: 'box', w: 5, h: 4 }], piston: { from: [23, 31.5], to: [23, 26.5], rest: 2.6, out: 0.3, hold: 0.5, back: 1.0, phase: 0.1 } },
      { id: 'pf2', type: 'kinematic', x: 37, y: 31.5, color: '#ff8a5c', shapes: [{ t: 'box', w: 5, h: 4 }], piston: { from: [37, 31.5], to: [37, 26.5], rest: 2.6, out: 0.3, hold: 0.5, back: 1.0, phase: 0.6 } },
    ],
    spawns: on(29.5, [12, 16, 20, 27, 33, 40, 44, 48]),
    ai: { pistons: true },
  });

  // ============================= TRICKY GEOMETRY =================================
  add({
    id: 'gravity_chamber', name: 'Gravity Chamber', category: 'Tricky',
    desc: 'A walled chamber with narrow openings. Every few seconds gravity swings to a new direction — watch the arrow.',
    bounds: { left: -3, right: 63, top: -3, bottom: 43 },
    bodies: [
      box(19.25, 4.5, 20.5, 1.5), box(42.25, 4.5, 19.5, 1.5),      // top wall: opening 29.5..32.5
      box(16.75, 35.5, 17.5, 1.5), box(30.75, 35.5, 4.5, 1.5), box(45, 35.5, 16, 1.5), // bottom: openings 25.5..28.5, 33..37
      box(8.75, 11, 1.5, 14), box(8.75, 29, 1.5, 12),              // left wall: opening 18..23
      box(51.25, 9.5, 1.5, 11), box(51.25, 27, 1.5, 16),           // right wall: opening 15..19
      box(20, 20, 6, 1.2), box(40, 22, 6, 1.2), box(30, 13, 5, 1.2), box(30, 28, 1.2, 5, { lethal: true }),
    ],
    events: [{ type: 'gravityCycle', dirs: [[0, 1], [-1, 0], [0, -1], [1, 0]], period: 9, warn: 2.2 }],
    spawns: [[14, 32.8], [18, 32.8], [22, 32.8], [42, 32.8], [46, 32.8], [49, 32.8], [20, 17.6], [40, 19.6]],
    ai: { gravity: true },
  });

  add({
    id: 'maze', name: 'The Maze', category: 'Tricky',
    desc: 'Tunnels, blocks, ramps and open shafts that drop to the void. Trap rivals over a shaft.',
    bodies: [
      box(1, 22, 2, 24), box(59, 22, 2, 24),
      box(8, 33, 12, 2), box(23, 33, 10, 2), box(37, 33, 10, 2), box(52, 33, 12, 2),
      box(14, 25.5, 12, 3), box(30, 25.5, 8, 3), box(46, 25.5, 12, 3),
      box(18, 16, 8, 2), box(42, 16, 8, 2), box(30, 10, 10, 2),
      poly([[2, 32], [7, 32], [2, 29]]), poly([[53, 32], [58, 32], [58, 29]]),
      poly([[26, 24], [30, 24], [26, 22]]), poly([[30, 24], [34, 24], [34, 22]]),
    ],
    spawns: [[9, 30.4], [12, 30.4], [22, 30.4], [38, 30.4], [48, 30.4], [51, 30.4], [14, 22.4], [46, 22.4]],
    ai: { maze: true },
  });

  (function () {
    const ledges = [];
    const rows = [[12, [9, 21, 33, 45, 57 - 6]], [19, [4, 15, 27, 39, 51]], [26, [9.5, 21, 33, 44.5, 55]], [33, [15, 30, 45]]];
    for (const [y, xs] of rows) for (const x of xs) ledges.push(box(x, y, 3.6, 0.9));
    add({
      id: 'tiny_ledges', name: 'Tiny Ledges', category: 'Tricky',
      desc: 'Dozens of tiny platforms and awkward gaps. Angled collisions decide everything.',
      bodies: ledges,
      spawns: [[9, 10.4], [21, 10.4], [33, 10.4], [45, 10.4], [4, 17.4], [27, 17.4], [51, 17.4], [21, 24.4]],
    });
  })();

  add({
    id: 'vertical_shaft', name: 'Vertical Shaft', category: 'Tricky',
    desc: 'A tall shaft with staggered ledges and two rotating barriers. Fall, recover, climb back.',
    bodies: [
      box(15, 20, 2, 40), box(45, 20, 2, 40),
      box(21, 9, 10, 1.2), box(39, 17, 10, 1.2), box(21, 25, 10, 1.2), box(39, 33, 10, 1.2), box(30, 38.5, 6, 1, { lethal: true }),
      { id: 'rot1', type: 'kinematic', x: 30, y: 13, spin: 0.9, color: '#8fd3ff', shapes: [{ t: 'box', w: 9, h: 0.8 }] },
      { id: 'rot2', type: 'kinematic', x: 30, y: 29, spin: -0.75, color: '#8fd3ff', shapes: [{ t: 'box', w: 9, h: 0.8 }] },
    ],
    spawns: [[18, 7.4], [23, 7.4], [37, 15.4], [42, 15.4], [18, 23.4], [23, 23.4], [37, 31.4], [42, 31.4]],
    ai: { rotating: true },
  });

  (function () {
    const R0 = 15, cx = 30, cy = 19.5;
    const arcs = [[57, 123], [147, 249], [291, 393]];
    const shapes = arcs.map(([a0, a1]) => ({ t: 'arc', x: cx, y: cy, r0: R0, r1: R0 + 1.6, a0, a1, n: Math.round((a1 - a0) / 6), smooth: 'inner' }));
    const spawns = [63, 71, 79, 86, 94, 101, 109, 117].map((a) => [cx + Math.cos(U.deg(a)) * (R0 - 1.4), cy + Math.sin(U.deg(a)) * (R0 - 1.4)]);
    add({
      id: 'ring', name: 'The Ring', category: 'Tricky',
      desc: 'Fight on the inside of a big ring. Openings low on each side and at the top — shove rivals up the curve and out.',
      bodies: [{ id: 'ring', type: 'static', x: 0, y: 0, friction: 0.6, shapes }],
      spawns,
    });
  })();

  add({
    id: 'triangles', name: 'Triangles', category: 'Tricky',
    desc: 'Wedges, ramps and floating triangles. Every collision redirects you along a new angle.',
    bodies: [
      poly([[3, 30], [19, 30], [3, 22]]), poly([[41, 30], [57, 30], [57, 22]]),
      poly([[22, 32], [38, 32], [30, 26]]),
      poly([[12, 16], [20, 16], [16, 12]]), poly([[40, 16], [48, 16], [44, 12]]),
      poly([[26, 14], [34, 14], [30, 18]]),
      poly([[19, 30], [22, 32], [19, 32]]), poly([[38, 32], [41, 30], [41, 32]]),
      { id: 'tspin', type: 'kinematic', x: 30, y: 8, swing: { amp: 25, period: 6 }, shapes: [{ t: 'poly', pts: [[-4, 1], [4, 1], [0, -2.5]] }] },
    ],
    spawns: [[6, 22.3], [11, 24.8], [16, 27.3], [44, 27.3], [49, 24.8], [54, 22.3], [27, 27.0], [33, 27.0]],
  });

  // ================================= ADVANCED ====================================
  add({
    id: 'ice_slide', name: 'Ice Slide', category: 'Advanced',
    desc: 'Frictionless ramps and floating ice. Momentum lasts forever — plan every correction early.',
    bodies: [
      slab(2, 18, 16, 30, 1.6, { friction: 0, color: '#bff4ff' }), box(30, 30.8, 28, 1.6, { friction: 0, color: '#bff4ff' }),
      slab(44, 30, 58, 18, 1.6, { friction: 0, color: '#bff4ff' }),
      box(18, 17, 7, 1, { friction: 0, color: '#bff4ff', a: 8 }), box(42, 17, 7, 1, { friction: 0, color: '#bff4ff', a: -8 }),
      box(30, 21, 6, 1, { friction: 0.02, color: '#bff4ff' }),
    ],
    spawns: [[20, 28.4], [24, 28.4], [28, 28.4], [32, 28.4], [36, 28.4], [40, 28.4], [30, 18.8], [18, 14.8]],
    ai: { ice: true },
  });

  (function () {
    const objs = [
      { t: 'box', w: 6, h: 1.4 }, { t: 'circle', r: 1.8 }, { t: 'poly', pts: [[-2.5, 1.2], [2.5, 1.2], [0, -2]] },
      { t: 'box', w: 4, h: 4 }, { t: 'box', w: 7, h: 1.2 }, { t: 'circle', r: 2.4 }, { t: 'poly', pts: [[-2, -1], [2, -1], [3, 1], [-3, 1]] },
    ];
    const homes = [[12, 14], [48, 13], [30, 10], [18, 22], [42, 22], [8, 26], [52, 27]];
    const bodies = [box(30, 28, 14, 1.6, { id: 'core' })];
    objs.forEach((s, i) => bodies.push({
      id: 'fl' + i, type: 'dynamic', object: true, x: homes[i][0], y: homes[i][1], gravityScale: 0, density: 0.6, friction: 0.7,
      color: '#a7f0c9', drift: { k: 1.1, range: 4 + (i % 3), speed: 0.25 + 0.04 * i }, shapes: [s],
    }));
    // invisible walls that keep the floating objects inside (players pass through them)
    bodies.push(box(-1, 20, 2, 60, { type: 'objwall' }), box(61, 20, 2, 60, { type: 'objwall' }), box(30, -1, 64, 2, { type: 'objwall' }), box(30, 41, 64, 2, { type: 'objwall' }));
    add({
      id: 'floating_chaos', name: 'Floating Chaos', category: 'Advanced',
      desc: 'Free-floating blocks drift around a small core platform. Shove them, ride them, use them as shields.',
      bodies,
      spawns: [[26, 25.6], [30, 25.6], [34, 25.6], [12, 11.6], [48, 10.6], [18, 18.5], [42, 18.5], [30, 6.6]],
      ai: { floating: true },
    });
  })();

  add({
    id: 'split_arena', name: 'Split Arena', category: 'Advanced',
    desc: 'Two chambers joined by a motorised drawbridge. When it lifts, the middle becomes a pit.',
    bodies: [
      box(14, 30, 22, 2, { id: 'floorL' }), box(46, 30, 22, 2, { id: 'floorR' }),
      box(4, 22, 2, 14), box(56, 22, 2, 14),
      box(10, 14.5, 10, 1.2), box(50, 14.5, 10, 1.2),
      { id: 'dbL', type: 'dynamic', x: 27.5, y: 29.6, density: 0.8, friction: 0.7, color: '#ffc978', shapes: [{ t: 'box', w: 4.9, h: 1.0 }] },
      { id: 'dbR', type: 'dynamic', x: 32.5, y: 29.6, density: 0.8, friction: 0.7, color: '#ffc978', shapes: [{ t: 'box', w: 4.9, h: 1.0 }] },
    ],
    joints: [
      { t: 'revolute', a: 'floorL', b: 'dbL', anchor: [25, 29.6], limits: [-80, 0], motor: { speed: 0.9, torque: 2600 }, schedule: [[0.9, 6], [-1.2, 3.5]] },
      { t: 'revolute', a: 'floorR', b: 'dbR', anchor: [35, 29.6], limits: [0, 80], motor: { speed: -0.9, torque: 2600 }, schedule: [[-0.9, 6], [1.2, 3.5]] },
    ],
    spawns: on(29, [7, 11, 15, 20, 40, 45, 49, 53]),
    ai: { bridge: true },
  });

  add({
    id: 'funnel', name: 'The Funnel', category: 'Advanced',
    desc: 'Huge slopes pour everyone into a tiny central pad guarded by a spinning cross.',
    bodies: [
      slab(2, 9, 24.5, 28, 1.8, { friction: 0.45 }), slab(35.5, 28, 58, 9, 1.8, { friction: 0.45 }),
      box(30, 31, 8, 1.4, { id: 'pad' }),
      { id: 'cross', type: 'kinematic', x: 30, y: 22.5, spin: 1.1, color: '#8fd3ff', shapes: [{ t: 'box', w: 8, h: 0.9 }, { t: 'box', w: 0.9, h: 8 }] },
    ],
    spawns: [6, 10, 14, 18].map((x) => [x, slopeY(2, 9, 24.5, 28, x) - 1.5]).concat([42, 46, 50, 54].map((x) => [x, slopeY(35.5, 28, 58, 9, x) - 1.5])),
    ai: { funnel: true },
  });

  (function () {
    const gear = (gid, x, y, r, spin, teeth) => {
      const shapes = [{ t: 'circle', r }];
      for (let i = 0; i < teeth; i++) {
        const a = (360 / teeth) * i;
        shapes.push({ t: 'box', w: 1.2, h: 1.6, x: Math.cos(U.deg(a)) * (r + 0.5), y: Math.sin(U.deg(a)) * (r + 0.5), a: a + 90 });
      }
      return { id: gid, type: 'kinematic', x, y, spin, friction: 0.9, color: '#c3b6ff', shapes };
    };
    add({
      id: 'clockwork', name: 'Clockwork', category: 'Advanced',
      desc: 'Gears, rotating arms and sliding bars all on a fixed beat. Learn the timing and the machine works for you.',
      bodies: [
        gear('cg1', 12, 27, 4, 0.55, 6), gear('cg2', 30, 31, 4, -0.55, 6), gear('cg3', 48, 27, 4, 0.55, 6),
        { id: 'arm1', type: 'kinematic', x: 21, y: 16, spin: 0.4, color: '#8fd3ff', shapes: [{ t: 'box', w: 10, h: 1 }] },
        { id: 'arm2', type: 'kinematic', x: 39, y: 16, spin: -0.4, color: '#8fd3ff', shapes: [{ t: 'box', w: 10, h: 1 }] },
        { id: 'bar1', type: 'kinematic', x: 24, y: 22, color: '#8fd3ff', shapes: [{ t: 'box', w: 6, h: 0.9 }], path: { pts: [[24, 22], [36, 22]], period: 2.6, wait: 0.7 } },
        box(4, 19, 7, 1.2), box(56, 19, 7, 1.2), box(30, 8, 8, 1.2),
      ],
      spawns: [[4, 16.6], [56, 16.6], [10.3, 19.5], [13.7, 19.5], [46.3, 19.5], [49.7, 19.5], [28, 5.6], [32, 5.6]],
      ai: { rotating: true, moving: true },
    });
  })();

  (function () {
    const bodies = [
      slab(1.5, 21, 13, 25.5, 1.6), slab(47, 25.5, 58.5, 21, 1.6),
      { id: 'uhub', type: 'static', x: 30, y: 21, shapes: [{ t: 'circle', r: 1.3 }] },
      { id: 'ubeam', type: 'dynamic', x: 30, y: 21, density: 0.5, friction: 0.7, shapes: [{ t: 'box', w: 15, h: 1.2 }] },
      { id: 'us1', type: 'dynamic', x: 17.5, y: 30, density: 0.2, gravityScale: 0, color: '#7dffb0', shapes: [{ t: 'box', w: 6, h: 0.9 }] },
      { id: 'us2', type: 'dynamic', x: 42.5, y: 30, density: 0.2, gravityScale: 0, color: '#7dffb0', shapes: [{ t: 'box', w: 6, h: 0.9 }] },
      box(23.3, 34, 1.4, 3, { id: 'postL' }), box(36.7, 34, 1.4, 3, { id: 'postR' }),
      { id: 'ub0', type: 'dynamic', x: 26.25, y: 33, density: 0.5, color: '#ffd59a', shapes: [{ t: 'box', w: 4.4, h: 1 }] },
      { id: 'ub1', type: 'dynamic', x: 30, y: 33, density: 0.5, color: '#ffd59a', shapes: [{ t: 'box', w: 3, h: 1 }] },
      { id: 'ub2', type: 'dynamic', x: 33.75, y: 33, density: 0.5, color: '#ffd59a', shapes: [{ t: 'box', w: 4.4, h: 1 }] },
      { id: 'um1', type: 'kinematic', x: 10, y: 12, color: '#8fd3ff', shapes: [{ t: 'box', w: 7, h: 1 }], path: { pts: [[9, 12], [21, 12]], period: 4, wait: 0.8 } },
      { id: 'um2', type: 'kinematic', x: 50, y: 12, color: '#8fd3ff', shapes: [{ t: 'box', w: 7, h: 1 }], path: { pts: [[51, 12], [39, 12]], period: 4, wait: 0.8 } },
    ];
    const joints = [
      { t: 'revolute', a: 'uhub', b: 'ubeam', anchor: [30, 21], motor: { speed: 0.35, torque: 4000 } },
      { t: 'prismatic', a: null, b: 'us1', anchor: [17.5, 30], axis: [0, 1], limits: [-1, 3.5] },
      { t: 'spring', a: null, b: 'us1', anchorA: [17.5, 37], anchorB: [17.5, 30.4], hz: 0.9, damping: 0.06 },
      { t: 'prismatic', a: null, b: 'us2', anchor: [42.5, 30], axis: [0, 1], limits: [-1, 3.5] },
      { t: 'spring', a: null, b: 'us2', anchorA: [42.5, 37], anchorB: [42.5, 30.4], hz: 0.9, damping: 0.06 },
      { t: 'weld', a: 'postL', b: 'ub0', anchor: [24, 33], break: 1000, fatigue: 2 },
      { t: 'weld', a: 'ub0', b: 'ub1', anchor: [28.5, 33], break: 800, fatigue: 2 },
      { t: 'weld', a: 'ub1', b: 'ub2', anchor: [31.5, 33], break: 800, fatigue: 2 },
      { t: 'weld', a: 'ub2', b: 'postR', anchor: [36, 33], break: 1000, fatigue: 2 },
    ];
    add({
      id: 'ultimate_bonk', name: 'Ultimate Bonk', category: 'Advanced',
      desc: 'Everything at once — a rotating beam, springs, sliding platforms, slopes and a breakable floor — but fair and readable.',
      bodies, joints,
      spawns: [[5, slopeY(1.5, 21, 13, 25.5, 5) - 1.3], [9, slopeY(1.5, 21, 13, 25.5, 9) - 1.3], [51, slopeY(47, 25.5, 58.5, 21, 51) - 1.3], [55, slopeY(47, 25.5, 58.5, 21, 55) - 1.3], [16, 27.8], [44, 27.8], [28, 30.9], [32, 30.9]],
      ai: { rotating: true, springs: true, breakable: true },
    });
  })();

  // ================================ FOOTBALL ======================================
  const football = [];
  football.push({
    id: 'pitch', name: 'Pitch', category: 'Football', modes: ['football'],
    desc: 'Enclosed pitch with goals at both ends.',
    bounds: { left: -6, right: 66, top: -10, bottom: 46 },
    bodies: [
      box(30, 37, 60, 2), box(30, 1, 60, 2), box(-0.5, 18, 1, 40), box(60.5, 18, 1, 40),
      box(3.2, 24.6, 6.4, 0.7), box(56.8, 24.6, 6.4, 0.7),
      poly([[-0.1, 2], [6, 2], [-0.1, 6]]), poly([[54, 2], [60.1, 2], [60.1, 6]]),
    ],
    goals: [{ team: 1, x: 2.6, y: 30.5, w: 4.6, h: 10.4 }, { team: 2, x: 57.4, y: 30.5, w: 4.6, h: 10.4 }],
    ball: { x: 30, y: 26, r: 1.3 },
    spawns: [[10, 33.4], [16, 33.4], [22, 33.4], [13, 28], [38, 33.4], [44, 33.4], [50, 33.4], [47, 28]],
  });
  football.push({
    id: 'pitch_hill', name: 'Hill Pitch', category: 'Football', modes: ['football'],
    desc: 'A pitch with a bump in the middle and a floating bar.',
    bounds: { left: -6, right: 66, top: -10, bottom: 46 },
    bodies: [
      box(30, 37, 60, 2), box(30, 1, 60, 2), box(-0.5, 18, 1, 40), box(60.5, 18, 1, 40),
      box(3.2, 24.6, 6.4, 0.7), box(56.8, 24.6, 6.4, 0.7),
      poly([[22, 36.05], [38, 36.05], [30, 32.5]]), box(30, 17, 10, 0.8),
    ],
    goals: [{ team: 1, x: 2.6, y: 30.5, w: 4.6, h: 10.4 }, { team: 2, x: 57.4, y: 30.5, w: 4.6, h: 10.4 }],
    ball: { x: 30, y: 26, r: 1.3 },
    spawns: [[10, 33.4], [15, 33.4], [20, 33.4], [12, 28], [40, 33.4], [45, 33.4], [50, 33.4], [48, 28]],
  });

  DB.MAPS = maps;
  DB.FOOTBALL_MAPS = football;
  DB.MAP_CATEGORIES = ['Classic', 'Moving', 'Mechanical', 'Tricky', 'Advanced'];
  DB.getMap = function (mid) {
    return maps.find((m) => m.id === mid) || football.find((m) => m.id === mid) || (DB.customMaps || []).find((m) => m.id === mid) || null;
  };
})(typeof window !== 'undefined' ? window : globalThis);

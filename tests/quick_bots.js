// quick bot-only simulation across maps: node tests/quick_bots.js [level] [seconds]
const DB = require('./load.js');
const lvl = +(process.argv[2] || 3), secs = +(process.argv[3] || 40);
const phys = DB.resolvePhysics();
const only = process.argv[4];
let totalT = 0;
for (const m of DB.MAPS) {
  if (only && m.id !== only) continue;
  const settings = DB.util.deepClone(DB.DEFAULT_SETTINGS);
  settings.match.spectate = true; settings.match.bots = 8; settings.match.difficulty = lvl;
  const roster = DB.buildRoster(settings, DB.util.rng(5));
  const match = new DB.Match({ mode: 'classic', roster, mapId: m.id, winTarget: 99, phys, seed: 11, countdown: 0, roundEndDelay: 0.1 });
  match.start();
  const t0 = Date.now();
  let steps = 0;
  const rounds = [];
  while (steps < secs * 60) { match.step(1 / 60); steps++; if (match.history.length > rounds.length) rounds.push(match.history[match.history.length - 1]); }
  const dur = Date.now() - t0; totalT += dur;
  const kills = Object.values(match.kills).reduce((a, b) => a + b, 0);
  let heavy = 0, dec = 0; for (const b of match.brains.values()) { heavy += b.stats.heavyFrames; dec += b.stats.decisions; }
  const avg = rounds.length ? (rounds.reduce((a, r) => a + r.time, 0) / rounds.length).toFixed(1) : '-';
  console.log(m.id.padEnd(16), 'rounds', String(rounds.length).padStart(2), 'avgT', String(avg).padStart(5), 'draws', rounds.filter(r => r.result === 'draw').length, 'kills', kills, 'ms/simsec', (dur / secs).toFixed(1));
}
console.log('total ms', totalT);

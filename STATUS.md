# Status: what is verified, and what isn't yet

This file says plainly what has been tested and what hasn't. I wrote and tested the project in a Linux container that has **no macOS SDK and no Swift compiler**, so the native part could not be compiled or run here.

## Verified here

**Simulation, maps, bots and modes.** `node tests/run_tests.js` runs the real game code headlessly. The latest results are in `tests/output/report.txt`. It covers:

* force-based movement in all four directions, momentum persistence, and rolling
* heavy mode: about 3.2× mass, reduced acceleration, drains while held, recovers when released, deterministic
* ball collisions: bounce, heavy hits transfer more momentum, a heavy target is harder to push
* elimination on all four sides, lethal zones, knock-out credit, round scoring, match end, rematch
* all 30 maps: they load, have 8 spawns clear of geometry, their mechanisms (paths, pistons, spinners, motors) move, there are no NaN or physics errors in 8-bot matches, and rounds finish (80 s each)
* breakable joints break, springs compress, gravity rotates, seesaws tilt, consecutive rounds work
* bots navigate simple and moving maps, use heavy, fight and eliminate each other, spread their targets, and can eliminate an idle human
* a "human" driven only through the human input path can beat Casual bots
* difficulty: higher levels survive hazard maps longer and win more free-for-all rounds, and all 6 behaviour profiles are distinct
* Arrows (shots, hits, recoil), Grapple (rope attaches, reels in, releases), Football (goals counted), Teams (round ends when one team remains)
* custom (editor-format) maps simulate, and concave polygons decompose

**Web UI in Chromium (Playwright).** The main menu, Quick Match, HUD (scores, countdown, banners, heavy meter, hints), pause menu, maps browser with generated thumbnails, settings, and the map editor (draw rectangle/circle/polygon, pivot, save, test vs bots) were exercised and screenshotted over a white "Safari-like" page and over a dark desktop. There were no JS errors.

**Swift sources.** All six files pass a Swift *syntax* parse (tree-sitter-swift). They have **not** been type-checked or compiled.

## Not verified here (needs a Mac)

These are written to standard AppKit/WebKit APIs, but nobody has run them yet:

* `./build_app.sh` and building through Xcode. Expect a possible small compile fix on the first build, since the code was never compiled.
* That the window is actually transparent over Safari (WKWebView `drawsBackground = false` on a clear borderless `NSWindow`)
* Click-through switching (`ignoresMouseEvents` toggled from the page's interactive rectangles)
* Keyboard focus handover between the arena and Safari, and the Focus button
* Native drag, resize and S/M/L sizes; the launcher bubble; the menu-bar item
* The global shortcuts (Carbon `RegisterEventHotKey`, ⌃⌥B / ⌃⌥G)
* Settings persistence to `~/Library/Application Support/DesktopBonk/store.json`
* Frame rate and CPU use in Safari's JavaScriptCore. In Node, 8 Normal bots cost about 0.5–3 ms per physics step depending on the map; the Bowl and The Ring are the heaviest.

## Known limitations and honest notes

* **Bonk.io research:** www.bonk.io itself was blocked by the sandbox's network policy. The controls and mechanics follow publicly described Bonk.io gameplay (arrow-key forces, up/down vertical forces, hold X to go heavy, knock others off, last one standing) plus my knowledge of the game. The physics constants are my own tuning, not values taken from Bonk.io.
* **Up arrow:** up gives an upward force *weaker than gravity*. It lets you float, soften landings and get more out of bounces, but you can't fly or jump from standstill. That is my reading of Bonk's movement; change it under Settings ▸ Physics if you prefer.
* **Spinning Plank** turns continuously, so nobody can stay on the beam indefinitely. Its survival route is to work toward the hub and drop to the two catch ledges before the plank gets steep (Expert bots do this). **Double Spinner** and **Gearbox** have similar catch ledges.
* **Overtime** (my addition, not a Bonk rule): after 35 s the side boundaries close in, and a round still unresolved at 100 s is a draw. This stops bot-vs-bot stalemates from running forever.
* **Bot quality:** bots are reasonable but not human-perfect. Rounds between 6–8 bots often run into overtime on large flat maps such as The Valley and The Bowl. Bot difficulty never changes physics.
* **Football / Arrows / Grapple bots** use simpler dedicated logic than the Classic bots.
* The game runs in a WKWebView, with Box2D physics through planck.js (a faithful JavaScript port of Box2D), instead of SpriteKit plus native Box2D. That keeps one codebase you can test in any browser, and the macOS shell is native Swift/AppKit. The spec allowed a different implementation if it supports a real transparent overlay.

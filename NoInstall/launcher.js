// Desktop Bonk "no-install" launcher.
// Runs with macOS's built-in JavaScript for Automation (osascript) — no Xcode, no compiling.
// It creates the same transparent, always-on-top overlay window around the game.
ObjC.import('Cocoa');
ObjC.import('WebKit');

function run(argv) {
  const webDir = argv[0];
  const app = $.NSApplication.sharedApplication;
  app.setActivationPolicy($.NSApplicationActivationPolicyAccessory);

  // ---- persistent store (same file as the full app) ----
  const fm = $.NSFileManager.defaultManager;
  const supportDir = $.NSHomeDirectory().js + '/Library/Application Support/DesktopBonk';
  fm.createDirectoryAtPathWithIntermediateDirectoriesAttributesError($(supportDir), true, $(), $());
  const storePath = supportDir + '/store.json';
  let store = {};
  try {
    const raw = $.NSString.stringWithContentsOfFileEncodingError($(storePath), $.NSUTF8StringEncoding, $());
    if (raw && !raw.isNil()) store = JSON.parse(raw.js) || {};
  } catch (e) { store = {}; }
  function saveStore() { $(JSON.stringify(store)).writeToFileAtomicallyEncodingError($(storePath), true, $.NSUTF8StringEncoding, $()); }
  let desk = {};
  try { desk = (JSON.parse(store.settings || '{}').desktop) || {}; } catch (e) { desk = {}; }

  // ---- window: borderless, transparent, floating, able to take keyboard focus ----
  ObjC.registerSubclass({
    name: 'DBOverlayWindow', superclass: 'NSWindow',
    methods: {
      canBecomeKeyWindow: { types: ['bool', []], implementation: function () { return true; } },
      canBecomeMainWindow: { types: ['bool', []], implementation: function () { return true; } },
    },
  });
  const W = desk.width || 720, H = desk.height || 520;
  const screen = $.NSScreen.mainScreen.visibleFrame;
  const startX = screen.origin.x + screen.size.width - W - 12, startY = screen.origin.y + 12;
  const win = $.DBOverlayWindow.alloc.initWithContentRectStyleMaskBackingDefer(
    $.NSMakeRect(startX, startY, W, H), $.NSWindowStyleMaskBorderless, $.NSBackingStoreBuffered, false);
  win.opaque = false;
  win.backgroundColor = $.NSColor.clearColor;
  win.hasShadow = false;
  win.level = desk.alwaysOnTop === false ? $.NSNormalWindowLevel : $.NSFloatingWindowLevel;
  win.collectionBehavior = $.NSWindowCollectionBehaviorCanJoinAllSpaces | $.NSWindowCollectionBehaviorFullScreenAuxiliary;
  win.releasedWhenClosed = false;

  // ---- controller: JS bridge + timer (click-through, drag, resize) ----
  let web = null, clickThrough = desk.clickThrough !== false, allInteractive = false, rects = [];
  let track = null;
  function send(obj) {
    if (web) web.evaluateJavaScriptCompletionHandler($('window.DB && DB.native && DB.native._event(' + JSON.stringify(obj) + ');'), null);
  }
  function focusGame() {
    app.activateIgnoringOtherApps(true);
    win.makeKeyAndOrderFront(null);
    win.makeFirstResponder(web);
    send({ type: 'focus' });
  }
  function setSize(w, h) {
    const f = win.frame, vf = win.screen ? win.screen.visibleFrame : screen;
    w = Math.max(360, Math.min(w, vf.size.width)); h = Math.max(280, Math.min(h, vf.size.height));
    const right = f.origin.x + f.size.width / 2 > vf.origin.x + vf.size.width / 2;
    const bottom = f.origin.y + f.size.height / 2 < vf.origin.y + vf.size.height / 2;
    const x = right ? f.origin.x + f.size.width - w : f.origin.x;
    const y = bottom ? f.origin.y : f.origin.y + f.size.height - h;
    win.setFrameDisplay($.NSMakeRect(x, y, w, h), true);
  }
  function place(preset) {
    const f = win.frame, vf = win.screen ? win.screen.visibleFrame : screen, m = 12, w = f.size.width, h = f.size.height;
    let x = vf.origin.x + vf.size.width - w - m, y = vf.origin.y + m;
    if (preset === 'bottom-left') x = vf.origin.x + m;
    if (preset === 'top-right') y = vf.origin.y + vf.size.height - h - m;
    if (preset === 'top-left') { x = vf.origin.x + m; y = vf.origin.y + vf.size.height - h - m; }
    if (preset === 'center') { x = vf.origin.x + (vf.size.width - w) / 2; y = vf.origin.y + (vf.size.height - h) / 2; }
    win.setFrameOrigin($.NSMakePoint(x, y));
  }

  ObjC.registerSubclass({
    name: 'DBController', superclass: 'NSObject', protocols: ['WKScriptMessageHandler'],
    methods: {
      'userContentController:didReceiveScriptMessage:': {
        types: ['void', ['id', 'id']],
        implementation: function (ucc, message) {
          let m;
          try { m = ObjC.deepUnwrap(message.body); } catch (e) { return; }
          if (!m || !m.type) return;
          switch (m.type) {
            case 'store': store[m.key] = m.value; saveStore(); break;
            case 'dragStart': case 'resizeStart': {
              const p = $.NSEvent.mouseLocation, f = win.frame;
              track = { resize: m.type === 'resizeStart', mx: p.x, my: p.y, x: f.origin.x, y: f.origin.y, w: f.size.width, h: f.size.height };
              win.ignoresMouseEvents = false;
              break;
            }
            case 'setSize': setSize(m.width || 720, m.height || 520); break;
            case 'setPosition': place(m.preset); break;
            case 'setLevel': win.level = m.alwaysOnTop === false ? $.NSNormalWindowLevel : $.NSFloatingWindowLevel; break;
            case 'setHideOnDeactivate': win.hidesOnDeactivate = !!m.hide; break;
            case 'setClickThrough': clickThrough = !!m.enabled; if (!clickThrough) win.ignoresMouseEvents = false; break;
            case 'interactive': allInteractive = !!m.all; rects = m.rects || []; break;
            case 'focus': focusGame(); break;
            case 'minimize': case 'hide': win.orderOut(null); send({ type: 'hidden' }); break;
            case 'quit': app.terminate(null); break;
            default: break;
          }
        },
      },
      'tick:': {
        types: ['void', ['id']],
        implementation: function (timer) {
          const p = $.NSEvent.mouseLocation;
          if (track) {
            if (($.NSEvent.pressedMouseButtons & 1) === 0) {
              if (track.resize) { const f = win.frame; send({ type: 'size', width: Math.round(f.size.width), height: Math.round(f.size.height), preset: 'custom' }); }
              track = null; return;
            }
            const dx = p.x - track.mx, dy = p.y - track.my;
            if (track.resize) {
              const w = Math.max(360, track.w + dx), h = Math.max(280, track.h - dy);
              win.setFrameDisplay($.NSMakeRect(track.x, track.y + track.h - h, w, h), true);
            } else win.setFrameOrigin($.NSMakePoint(track.x + dx, track.y + dy));
            return;
          }
          if (!win.isVisible) return;
          if (!clickThrough || allInteractive) { if (win.ignoresMouseEvents) win.ignoresMouseEvents = false; return; }
          const f = win.frame;
          if (p.x < f.origin.x || p.x > f.origin.x + f.size.width || p.y < f.origin.y || p.y > f.origin.y + f.size.height) return;
          if ($.NSEvent.pressedMouseButtons !== 0 && !win.ignoresMouseEvents) return;
          const lx = p.x - f.origin.x, ly = f.origin.y + f.size.height - p.y;
          let over = false;
          for (const r of rects) if (lx >= r[0] && lx <= r[0] + r[2] && ly >= r[1] && ly <= r[1] + r[3]) { over = true; break; }
          if (win.ignoresMouseEvents === over) win.ignoresMouseEvents = !over;
        },
      },
      'toggleArena:': {
        types: ['void', ['id']],
        implementation: function () { if (win.isVisible) { win.orderOut(null); send({ type: 'hidden' }); } else { win.orderFrontRegardless; send({ type: 'shown' }); focusGame(); } },
      },
      'quitApp:': { types: ['void', ['id']], implementation: function () { app.terminate(null); } },
    },
  });
  const ctrl = $.DBController.alloc.init;

  // ---- web view ----
  const config = $.WKWebViewConfiguration.alloc.init;
  const ucc = config.userContentController;
  const boot = 'window.__DB_NATIVE__ = { version: "lite", store: ' + JSON.stringify(store) + ' };';
  ucc.addUserScript($.WKUserScript.alloc.initWithSourceInjectionTimeForMainFrameOnly($(boot), $.WKUserScriptInjectionTimeAtDocumentStart, true));
  ucc.addScriptMessageHandlerName(ctrl, $('bonk'));
  web = $.WKWebView.alloc.initWithFrameConfiguration($.NSMakeRect(0, 0, W, H), config);
  web.setValueForKey($.NSNumber.numberWithBool(false), $('drawsBackground'));
  web.autoresizingMask = $.NSViewWidthSizable | $.NSViewHeightSizable;
  win.contentView = web;
  const dirURL = $.NSURL.fileURLWithPathIsDirectory($(webDir), true);
  web.loadFileURLAllowingReadAccessToURL($.NSURL.fileURLWithPath($(webDir + '/index.html')), dirURL);

  // ---- menu bar item (show/hide, quit) ----
  const item = $.NSStatusBar.systemStatusBar.statusItemWithLength(-1);
  item.button.title = $('● Bonk');
  const menu = $.NSMenu.alloc.init;
  const mi1 = $.NSMenuItem.alloc.initWithTitleActionKeyEquivalent($('Show / Hide Arena'), 'toggleArena:', $(''));
  mi1.target = ctrl; menu.addItem(mi1);
  const mi2 = $.NSMenuItem.alloc.initWithTitleActionKeyEquivalent($('Quit Desktop Bonk'), 'quitApp:', $('q'));
  mi2.target = ctrl; menu.addItem(mi2);
  item.menu = menu;

  $.NSTimer.scheduledTimerWithTimeIntervalTargetSelectorUserInfoRepeats(1 / 60, ctrl, 'tick:', null, true);

  win.makeKeyAndOrderFront(null);
  focusGame();
  app.run;
}

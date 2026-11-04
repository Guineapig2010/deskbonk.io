import Cocoa
import WebKit

/// Borderless, fully transparent window. It can become key (so the game gets keyboard input)
/// and swallows the "no responder" beep for unhandled keys.
final class OverlayWindow: NSWindow {
    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { true }

    override func noResponder(for eventSelector: Selector) {
        // Intentionally silent: game keys are handled in the web view.
    }

    override func sendEvent(_ event: NSEvent) {
        if event.type == .leftMouseDown || event.type == .rightMouseDown {
            // A click on the arena's UI takes keyboard focus for the game.
            if !NSApp.isActive { NSApp.activate(ignoringOtherApps: true) }
            if !isKeyWindow { makeKey() }
        }
        super.sendEvent(event)
    }
}

/// WKWebView that accepts the first click even when the window is inactive.
final class GameWebView: WKWebView {
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
}

/// Owns the overlay window, the web view running the game and the JS <-> native bridge.
final class OverlayController: NSObject, WKScriptMessageHandler, WKNavigationDelegate, NSWindowDelegate {
    let window: OverlayWindow
    let webView: GameWebView
    var onMinimize: (() -> Void)?
    var onHide: (() -> Void)?
    var onQuit: (() -> Void)?
    var onHotkeysChanged: ((String, String) -> Void)?

    private var clickThrough = true
    private var interactiveAll = false
    private var interactiveRects: [CGRect] = []
    private var passthroughTimer: Timer?
    private var trackTimer: Timer?
    private var positionPreset = "bottom-right"
    private let minSize = NSSize(width: 360, height: 280)

    init(webDirectory: URL) {
        let desk = Store.shared.desktopSettings()
        let w = CGFloat((desk["width"] as? NSNumber)?.doubleValue ?? 720)
        let h = CGFloat((desk["height"] as? NSNumber)?.doubleValue ?? 520)

        let win = OverlayWindow(contentRect: NSRect(x: 0, y: 0, width: w, height: h),
                                styleMask: [.borderless, .resizable],
                                backing: .buffered, defer: false)
        win.isOpaque = false
        win.backgroundColor = .clear
        win.hasShadow = false
        win.level = (desk["alwaysOnTop"] as? Bool) == false ? .normal : .floating
        win.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        win.isReleasedWhenClosed = false
        win.hidesOnDeactivate = (desk["visibleWhenInactive"] as? Bool) == false
        win.minSize = NSSize(width: 360, height: 280)
        win.title = "Desktop Bonk"

        let config = WKWebViewConfiguration()
        let ucc = WKUserContentController()
        let version = (Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String) ?? "1.0"
        let boot = "window.__DB_NATIVE__ = { version: '\(version)', store: \(Store.shared.injectionJSON()) };"
        ucc.addUserScript(WKUserScript(source: boot, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        config.userContentController = ucc
        config.mediaTypesRequiringUserActionForPlayback = []
        let web = GameWebView(frame: NSRect(x: 0, y: 0, width: w, height: h), configuration: config)

        window = win
        webView = web
        super.init()

        positionPreset = (desk["position"] as? String) ?? "bottom-right"
        clickThrough = (desk["clickThrough"] as? Bool) ?? true
        ucc.add(self, name: "bonk")
        webView.setValue(false, forKey: "drawsBackground") // transparent page background
        if #available(macOS 12.0, *) { webView.underPageBackgroundColor = .clear }
        webView.autoresizingMask = [.width, .height]
        webView.navigationDelegate = self
        window.contentView = webView
        window.delegate = self

        if let frameString = UserDefaults.standard.string(forKey: "overlayFrame"), positionPreset == "free" {
            let f = NSRectFromString(frameString)
            if f.width >= minSize.width && f.height >= minSize.height && NSScreen.screens.contains(where: { $0.visibleFrame.intersects(f) }) {
                window.setFrame(f, display: false)
            } else { place(preset: "bottom-right") }
        } else {
            place(preset: positionPreset)
        }

        let index = webDirectory.appendingPathComponent("index.html")
        webView.loadFileURL(index, allowingReadAccessTo: webDirectory)

        passthroughTimer = Timer(timeInterval: 1.0 / 30.0, repeats: true) { [weak self] _ in self?.updateMousePassthrough() }
        RunLoop.main.add(passthroughTimer!, forMode: .common)
    }

    // MARK: - Showing / focus

    func show(focus: Bool) {
        window.orderFrontRegardless()
        send(["type": "shown"])
        if focus { focusGame() }
    }

    func hide() {
        window.orderOut(nil)
        send(["type": "hidden"])
    }

    var isVisible: Bool { window.isVisible }

    func focusGame() {
        NSApp.activate(ignoringOtherApps: true)
        window.makeKeyAndOrderFront(nil)
        window.makeFirstResponder(webView)
        send(["type": "focus"])
    }

    func command(_ name: String) {
        send(["type": "command", "name": name])
    }

    // MARK: - Geometry

    private func targetScreen() -> NSScreen {
        let center = NSPoint(x: window.frame.midX, y: window.frame.midY)
        return NSScreen.screens.first(where: { $0.frame.contains(center) }) ?? NSScreen.main ?? NSScreen.screens[0]
    }

    func place(preset: String) {
        positionPreset = preset
        let vf = targetScreen().visibleFrame
        let m: CGFloat = 12
        var f = window.frame
        f.size.width = min(f.width, vf.width - 2 * m)
        f.size.height = min(f.height, vf.height - 2 * m)
        switch preset {
        case "bottom-left": f.origin = NSPoint(x: vf.minX + m, y: vf.minY + m)
        case "top-right": f.origin = NSPoint(x: vf.maxX - f.width - m, y: vf.maxY - f.height - m)
        case "top-left": f.origin = NSPoint(x: vf.minX + m, y: vf.maxY - f.height - m)
        case "center": f.origin = NSPoint(x: vf.midX - f.width / 2, y: vf.midY - f.height / 2)
        default: f.origin = NSPoint(x: vf.maxX - f.width - m, y: vf.minY + m)
        }
        window.setFrame(f, display: true)
    }

    func setSize(width: CGFloat, height: CGFloat) {
        let vf = targetScreen().visibleFrame
        let w = max(minSize.width, min(width, vf.width))
        let h = max(minSize.height, min(height, vf.height))
        var f = window.frame
        // keep the corner nearest the screen corner fixed, so a bottom-right arena grows up/left
        let right = f.midX > vf.midX, bottom = f.midY < vf.midY
        let newX = right ? f.maxX - w : f.minX
        let newY = bottom ? f.minY : f.maxY - h
        f = NSRect(x: newX, y: newY, width: w, height: h)
        // stay on screen
        f.origin.x = max(vf.minX, min(f.origin.x, vf.maxX - w))
        f.origin.y = max(vf.minY, min(f.origin.y, vf.maxY - h))
        window.setFrame(f, display: true, animate: false)
        saveFrame()
    }

    private func saveFrame() {
        UserDefaults.standard.set(NSStringFromRect(window.frame), forKey: "overlayFrame")
    }

    /// Native drag / resize loop, started from the page's drag handle or resize grip.
    private func beginTracking(resize: Bool) {
        let startMouse = NSEvent.mouseLocation
        let startFrame = window.frame
        trackTimer?.invalidate()
        window.ignoresMouseEvents = false
        let t = Timer(timeInterval: 1.0 / 120.0, repeats: true) { [weak self] timer in
            guard let self = self else { timer.invalidate(); return }
            if NSEvent.pressedMouseButtons & 1 == 0 {
                timer.invalidate()
                self.trackTimer = nil
                self.saveFrame()
                if resize {
                    self.send(["type": "size", "width": Int(self.window.frame.width), "height": Int(self.window.frame.height), "preset": "custom"])
                } else {
                    self.positionPreset = "free"
                }
                return
            }
            let m = NSEvent.mouseLocation
            let dx = m.x - startMouse.x, dy = m.y - startMouse.y
            if resize {
                let w = max(self.minSize.width, startFrame.width + dx)
                let h = max(self.minSize.height, startFrame.height - dy)
                self.window.setFrame(NSRect(x: startFrame.minX, y: startFrame.maxY - h, width: w, height: h), display: true)
            } else {
                self.window.setFrameOrigin(NSPoint(x: startFrame.minX + dx, y: startFrame.minY + dy))
            }
        }
        trackTimer = t
        RunLoop.main.add(t, forMode: .common)
    }

    // MARK: - Click-through

    /// Mouse events reach the game only over its interactive UI (toolbar, menus, buttons) unless
    /// click-through is disabled; everywhere else they fall through to the app underneath.
    private func updateMousePassthrough() {
        guard window.isVisible, trackTimer == nil else { return }
        if !clickThrough || interactiveAll {
            if window.ignoresMouseEvents { window.ignoresMouseEvents = false }
            return
        }
        let p = NSEvent.mouseLocation
        let f = window.frame
        guard f.contains(p) else { return }
        if NSEvent.pressedMouseButtons != 0 && !window.ignoresMouseEvents { return } // don't flip mid-drag
        let local = CGPoint(x: p.x - f.minX, y: f.maxY - p.y) // page coordinates (top-left origin)
        let overUI = interactiveRects.contains { $0.contains(local) }
        if window.ignoresMouseEvents == overUI { window.ignoresMouseEvents = !overUI }
    }

    // MARK: - Bridge

    func send(_ payload: [String: Any]) {
        guard let data = try? JSONSerialization.data(withJSONObject: payload, options: []),
              let json = String(data: data, encoding: .utf8) else { return }
        webView.evaluateJavaScript("window.DB && DB.native && DB.native._event(\(json));", completionHandler: nil)
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any], let type = body["type"] as? String else { return }
        switch type {
        case "ready":
            if let desk = body["desktop"] as? [String: Any], let pos = desk["position"] as? String, pos != positionPreset, pos != "free" {
                positionPreset = pos
            }
        case "store":
            if let key = body["key"] as? String, let value = body["value"] as? String { Store.shared.set(key, value) }
        case "dragStart":
            beginTracking(resize: false)
        case "resizeStart":
            beginTracking(resize: true)
        case "setSize":
            let w = (body["width"] as? NSNumber)?.doubleValue ?? 720
            let h = (body["height"] as? NSNumber)?.doubleValue ?? 520
            setSize(width: CGFloat(w), height: CGFloat(h))
        case "setPosition":
            if let p = body["preset"] as? String { place(preset: p); saveFrame() }
        case "setLevel":
            let top = (body["alwaysOnTop"] as? Bool) ?? true
            window.level = top ? .floating : .normal
        case "setHideOnDeactivate":
            window.hidesOnDeactivate = (body["hide"] as? Bool) ?? false
        case "setClickThrough":
            clickThrough = (body["enabled"] as? Bool) ?? true
            if !clickThrough { window.ignoresMouseEvents = false }
        case "interactive":
            interactiveAll = (body["all"] as? Bool) ?? false
            if let rects = body["rects"] as? [[NSNumber]] {
                interactiveRects = rects.compactMap { r in
                    guard r.count == 4 else { return nil }
                    return CGRect(x: r[0].doubleValue, y: r[1].doubleValue, width: r[2].doubleValue, height: r[3].doubleValue)
                }
            }
            updateMousePassthrough()
        case "focus":
            focusGame()
        case "minimize":
            onMinimize?()
        case "hide":
            onHide?()
        case "quit":
            onQuit?()
        case "setHotkeys":
            onHotkeysChanged?((body["toggle"] as? String) ?? "ctrl+alt+b", (body["focus"] as? String) ?? "ctrl+alt+g")
        default:
            break
        }
    }

    // MARK: - Window delegate

    func windowDidBecomeKey(_ notification: Notification) {
        window.makeFirstResponder(webView)
        send(["type": "focus"])
    }

    func windowDidResignKey(_ notification: Notification) {
        send(["type": "blur"])
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        window.makeFirstResponder(webView)
    }
}

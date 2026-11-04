import Cocoa

/// The tiny floating "minimized" launcher: a small bonk ball you can drag around; click to restore.
final class LauncherPanel: NSPanel {
    var onActivate: (() -> Void)?

    convenience init() {
        self.init(contentRect: NSRect(x: 0, y: 0, width: 46, height: 46),
                  styleMask: [.borderless, .nonactivatingPanel],
                  backing: .buffered, defer: false)
        isOpaque = false
        backgroundColor = .clear
        hasShadow = true
        level = .floating
        collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        isReleasedWhenClosed = false
        hidesOnDeactivate = false
        let view = LauncherView(frame: NSRect(x: 0, y: 0, width: 46, height: 46))
        view.panel = self
        contentView = view
    }

    override var canBecomeKey: Bool { false }

    func show(near frame: NSRect) {
        let screen = NSScreen.screens.first(where: { $0.frame.intersects(frame) }) ?? NSScreen.main
        let vf = screen?.visibleFrame ?? frame
        var origin = NSPoint(x: frame.maxX - 58, y: frame.minY + 12)
        origin.x = max(vf.minX + 4, min(origin.x, vf.maxX - 50))
        origin.y = max(vf.minY + 4, min(origin.y, vf.maxY - 50))
        if let saved = UserDefaults.standard.string(forKey: "launcherOrigin") {
            let p = NSPointFromString(saved)
            if NSScreen.screens.contains(where: { $0.visibleFrame.contains(p) }) { origin = p }
        }
        setFrameOrigin(origin)
        orderFrontRegardless()
    }
}

final class LauncherView: NSView {
    weak var panel: LauncherPanel?

    override func draw(_ dirtyRect: NSRect) {
        let r = bounds.insetBy(dx: 5, dy: 5)
        let ball = NSBezierPath(ovalIn: r)
        NSColor(calibratedRed: 1.0, green: 0.35, blue: 0.35, alpha: 1).setFill()
        ball.fill()
        NSColor.black.withAlphaComponent(0.75).setStroke()
        ball.lineWidth = 2.5
        ball.stroke()
        // stripe, like an in-game skin
        NSGraphicsContext.saveGraphicsState()
        ball.addClip()
        NSColor.black.withAlphaComponent(0.25).setFill()
        NSBezierPath(rect: NSRect(x: r.minX, y: r.midY - 4, width: r.width, height: 8)).fill()
        NSGraphicsContext.restoreGraphicsState()
        let ring = NSBezierPath(ovalIn: r.insetBy(dx: 2, dy: 2))
        NSColor.white.withAlphaComponent(0.6).setStroke()
        ring.lineWidth = 1
        ring.stroke()
    }

    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }

    override func mouseDown(with event: NSEvent) {
        guard let panel = panel else { return }
        let before = panel.frame.origin
        panel.performDrag(with: event) // returns when the mouse is released
        let after = panel.frame.origin
        if hypot(after.x - before.x, after.y - before.y) < 3 {
            panel.onActivate?()
        } else {
            UserDefaults.standard.set(NSStringFromPoint(after), forKey: "launcherOrigin")
        }
    }
}

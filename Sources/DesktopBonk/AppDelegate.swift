import Cocoa

final class AppDelegate: NSObject, NSApplicationDelegate, NSMenuDelegate {
    private var overlay: OverlayController!
    private let launcher = LauncherPanel()
    private var statusItem: NSStatusItem!
    private var topItem: NSMenuItem?

    func applicationDidFinishLaunching(_ notification: Notification) {
        guard let web = AppDelegate.findWebDirectory() else {
            let alert = NSAlert()
            alert.messageText = "Desktop Bonk could not find its game files (Web/index.html)."
            alert.runModal()
            NSApp.terminate(nil)
            return
        }
        buildMainMenu()
        overlay = OverlayController(webDirectory: web)
        overlay.onMinimize = { [weak self] in self?.minimize() }
        overlay.onHide = { [weak self] in self?.overlay.hide() }
        overlay.onQuit = { NSApp.terminate(nil) }
        overlay.onHotkeysChanged = { [weak self] toggle, focus in self?.registerHotkeys(toggle: toggle, focus: focus) }
        launcher.onActivate = { [weak self] in self?.restore() }

        let desk = Store.shared.desktopSettings()
        registerHotkeys(toggle: (desk["hotkeyToggle"] as? String) ?? "ctrl+alt+b",
                        focus: (desk["hotkeyFocus"] as? String) ?? "ctrl+alt+g")
        buildStatusItem()
        overlay.show(focus: true)
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { false }

    func applicationWillTerminate(_ notification: Notification) {
        Store.shared.flush()
    }

    func applicationDidResignActive(_ notification: Notification) {
        overlay?.send(["type": "blur"])
    }

    // MARK: - Visibility

    @objc func toggleVisibility() {
        if overlay.isVisible { overlay.hide() } else { restore() }
    }

    @objc func restore() {
        launcher.orderOut(nil)
        overlay.show(focus: true)
    }

    @objc func minimize() {
        let frame = overlay.window.frame
        overlay.hide()
        launcher.show(near: frame)
    }

    @objc func focusGame() {
        if !overlay.isVisible { restore() } else { overlay.focusGame() }
    }

    private func registerHotkeys(toggle: String, focus: String) {
        HotKeys.shared.unregisterAll()
        HotKeys.shared.register(toggle, id: 1) { [weak self] in self?.toggleVisibility() }
        HotKeys.shared.register(focus, id: 2) { [weak self] in self?.focusGame() }
    }

    // MARK: - Menus

    private func buildMainMenu() {
        let main = NSMenu()
        let appItem = NSMenuItem()
        main.addItem(appItem)
        let appMenu = NSMenu()
        appMenu.addItem(withTitle: "Hide Desktop Bonk", action: #selector(toggleVisibility), keyEquivalent: "h").target = self
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "Quit Desktop Bonk", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        appItem.submenu = appMenu
        // Edit menu so copy/paste work in the map editor's text fields
        let editItem = NSMenuItem()
        main.addItem(editItem)
        let edit = NSMenu(title: "Edit")
        edit.addItem(withTitle: "Undo", action: Selector(("undo:")), keyEquivalent: "z")
        edit.addItem(withTitle: "Cut", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        edit.addItem(withTitle: "Copy", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        edit.addItem(withTitle: "Paste", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        edit.addItem(withTitle: "Select All", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
        editItem.submenu = edit
        NSApp.mainMenu = main
    }

    private func buildStatusItem() {
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        if let button = statusItem.button {
            let img = NSImage(size: NSSize(width: 16, height: 16), flipped: false) { rect in
                let p = NSBezierPath(ovalIn: rect.insetBy(dx: 2, dy: 2))
                NSColor.black.setFill()
                p.fill()
                return true
            }
            img.isTemplate = true
            button.image = img
            button.toolTip = "Desktop Bonk"
        }
        let menu = NSMenu()
        menu.delegate = self
        func item(_ title: String, _ action: Selector, _ key: String = "") -> NSMenuItem {
            let i = NSMenuItem(title: title, action: action, keyEquivalent: key)
            i.target = self
            menu.addItem(i)
            return i
        }
        _ = item("Show / Hide Arena", #selector(toggleVisibility))
        _ = item("Focus Game", #selector(focusGame))
        _ = item("Minimize to Launcher", #selector(minimize))
        menu.addItem(.separator())
        _ = item("Quick Match", #selector(cmdQuick))
        _ = item("Main Menu", #selector(cmdMenu))
        _ = item("Settings…", #selector(cmdSettings))
        _ = item("Map Editor", #selector(cmdEditor))
        menu.addItem(.separator())
        _ = item("Small Arena", #selector(sizeSmall))
        _ = item("Medium Arena", #selector(sizeMedium))
        _ = item("Large Arena", #selector(sizeLarge))
        topItem = item("Always on Top", #selector(toggleTop))
        menu.addItem(.separator())
        let quit = NSMenuItem(title: "Quit Desktop Bonk", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        menu.addItem(quit)
        statusItem.menu = menu
    }

    func menuWillOpen(_ menu: NSMenu) {
        topItem?.state = overlay.window.level == .floating ? .on : .off
    }

    @objc private func cmdQuick() { restore(); overlay.command("quick") }
    @objc private func cmdMenu() { restore(); overlay.command("menu") }
    @objc private func cmdSettings() { restore(); overlay.command("settings") }
    @objc private func cmdEditor() { restore(); overlay.command("editor") }
    @objc private func sizeSmall() { resize(480, 360, "small") }
    @objc private func sizeMedium() { resize(720, 520, "medium") }
    @objc private func sizeLarge() { resize(960, 680, "large") }
    @objc private func toggleTop() {
        overlay.window.level = overlay.window.level == .floating ? .normal : .floating
    }

    private func resize(_ w: CGFloat, _ h: CGFloat, _ preset: String) {
        restore()
        overlay.setSize(width: w, height: h)
        overlay.send(["type": "size", "width": Int(w), "height": Int(h), "preset": preset])
    }

    // MARK: - Resources

    static func findWebDirectory() -> URL? {
        let fm = FileManager.default
        var candidates: [URL] = []
        if let env = ProcessInfo.processInfo.environment["DESKBONK_WEB"] { candidates.append(URL(fileURLWithPath: env)) }
        if let res = Bundle.main.resourceURL { candidates.append(res.appendingPathComponent("Web")) }
        #if SWIFT_PACKAGE
        if let mod = Bundle.module.resourceURL { candidates.append(mod.appendingPathComponent("Web")) }
        #endif
        // running from a source checkout
        let exe = URL(fileURLWithPath: CommandLine.arguments[0]).deletingLastPathComponent()
        candidates.append(exe.appendingPathComponent("Web"))
        candidates.append(URL(fileURLWithPath: fm.currentDirectoryPath).appendingPathComponent("Sources/DesktopBonk/Web"))
        return candidates.first { fm.fileExists(atPath: $0.appendingPathComponent("index.html").path) }
    }
}

// Desktop Bonk — macOS host.
// A transparent, borderless, always-on-top window hosting the game (WKWebView, no opaque
// background), a tiny floating launcher, a menu-bar item and global shortcuts.
import Cocoa

let application = NSApplication.shared
let appDelegate = AppDelegate()
application.delegate = appDelegate
application.setActivationPolicy(.accessory) // no Dock icon; lives in the menu bar + over the desktop
application.run()

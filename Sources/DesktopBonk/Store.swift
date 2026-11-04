import Foundation

/// Tiny persistent key/value store (values are JSON strings written by the game).
/// File: ~/Library/Application Support/DesktopBonk/store.json
final class Store {
    static let shared = Store()

    private(set) var values: [String: String] = [:]
    private let url: URL
    private var saveScheduled = false

    private init() {
        let fm = FileManager.default
        let support = fm.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
            ?? URL(fileURLWithPath: NSHomeDirectory()).appendingPathComponent("Library/Application Support")
        let dir = support.appendingPathComponent("DesktopBonk", isDirectory: true)
        try? fm.createDirectory(at: dir, withIntermediateDirectories: true)
        url = dir.appendingPathComponent("store.json")
        if let data = try? Data(contentsOf: url),
           let obj = try? JSONSerialization.jsonObject(with: data) as? [String: String] {
            values = obj
        }
    }

    func set(_ key: String, _ value: String) {
        values[key] = value
        guard !saveScheduled else { return }
        saveScheduled = true
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) { [weak self] in
            self?.saveScheduled = false
            self?.flush()
        }
    }

    func flush() {
        guard let data = try? JSONSerialization.data(withJSONObject: values, options: [.prettyPrinted, .sortedKeys]) else { return }
        try? data.write(to: url, options: .atomic)
    }

    /// JSON object literal injected into the page before any game script runs.
    func injectionJSON() -> String {
        guard let data = try? JSONSerialization.data(withJSONObject: values, options: []),
              let s = String(data: data, encoding: .utf8) else { return "{}" }
        return s
    }

    /// The game's saved "desktop" settings (size, position, flags), if any.
    func desktopSettings() -> [String: Any] {
        guard let raw = values["settings"], let data = raw.data(using: .utf8),
              let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let desk = obj["desktop"] as? [String: Any] else { return [:] }
        return desk
    }
}

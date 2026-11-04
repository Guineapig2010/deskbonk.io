import Cocoa
import Carbon.HIToolbox

/// System-wide keyboard shortcuts via Carbon RegisterEventHotKey.
/// This needs no Accessibility or Input Monitoring permission.
final class HotKeys {
    static let shared = HotKeys()

    private var refs: [EventHotKeyRef] = []
    private var handlers: [UInt32: () -> Void] = [:]
    private var handlerInstalled = false

    private init() {}

    func fire(_ id: UInt32) {
        if let h = handlers[id] { DispatchQueue.main.async(execute: h) }
    }

    func unregisterAll() {
        for r in refs { UnregisterEventHotKey(r) }
        refs.removeAll()
        handlers.removeAll()
    }

    /// Register a shortcut written like "ctrl+alt+b" or "cmd+shift+space". Returns false if invalid/taken.
    @discardableResult
    func register(_ spec: String, id: UInt32, handler: @escaping () -> Void) -> Bool {
        guard let parsed = HotKeys.parse(spec) else { return false }
        let (code, mods) = parsed
        installHandlerIfNeeded()
        var ref: EventHotKeyRef?
        let hkID = EventHotKeyID(signature: OSType(0x44424B21), id: id) // 'DBK!'
        let status = RegisterEventHotKey(code, mods, hkID, GetApplicationEventTarget(), 0, &ref)
        guard status == noErr, let r = ref else { return false }
        refs.append(r)
        handlers[id] = handler
        return true
    }

    private func installHandlerIfNeeded() {
        guard !handlerInstalled else { return }
        handlerInstalled = true
        var spec = EventTypeSpec(eventClass: OSType(kEventClassKeyboard), eventKind: UInt32(kEventHotKeyPressed))
        InstallEventHandler(GetApplicationEventTarget(), { (_, event, _) -> OSStatus in
            var hk = EventHotKeyID()
            let err = GetEventParameter(event, EventParamName(kEventParamDirectObject), EventParamType(typeEventHotKeyID),
                                        nil, MemoryLayout<EventHotKeyID>.size, nil, &hk)
            if err == noErr { HotKeys.shared.fire(hk.id) }
            return noErr
        }, 1, &spec, nil, nil)
    }

    static func parse(_ spec: String) -> (UInt32, UInt32)? {
        let parts = spec.lowercased().split(separator: "+").map { String($0).trimmingCharacters(in: .whitespaces) }
        guard let keyName = parts.last, keyName != "none", !keyName.isEmpty else { return nil }
        var mods: UInt32 = 0
        for p in parts.dropLast() {
            switch p {
            case "ctrl", "control": mods |= UInt32(controlKey)
            case "alt", "opt", "option": mods |= UInt32(optionKey)
            case "cmd", "command": mods |= UInt32(cmdKey)
            case "shift": mods |= UInt32(shiftKey)
            default: return nil
            }
        }
        guard mods != 0, let code = keyCodes[keyName] else { return nil }
        return (UInt32(code), mods)
    }

    private static let keyCodes: [String: Int] = [
        "a": kVK_ANSI_A, "b": kVK_ANSI_B, "c": kVK_ANSI_C, "d": kVK_ANSI_D, "e": kVK_ANSI_E, "f": kVK_ANSI_F,
        "g": kVK_ANSI_G, "h": kVK_ANSI_H, "i": kVK_ANSI_I, "j": kVK_ANSI_J, "k": kVK_ANSI_K, "l": kVK_ANSI_L,
        "m": kVK_ANSI_M, "n": kVK_ANSI_N, "o": kVK_ANSI_O, "p": kVK_ANSI_P, "q": kVK_ANSI_Q, "r": kVK_ANSI_R,
        "s": kVK_ANSI_S, "t": kVK_ANSI_T, "u": kVK_ANSI_U, "v": kVK_ANSI_V, "w": kVK_ANSI_W, "x": kVK_ANSI_X,
        "y": kVK_ANSI_Y, "z": kVK_ANSI_Z, "space": kVK_Space,
        "0": kVK_ANSI_0, "1": kVK_ANSI_1, "2": kVK_ANSI_2, "3": kVK_ANSI_3, "4": kVK_ANSI_4,
        "5": kVK_ANSI_5, "6": kVK_ANSI_6, "7": kVK_ANSI_7, "8": kVK_ANSI_8, "9": kVK_ANSI_9,
    ]
}

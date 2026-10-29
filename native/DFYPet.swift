import AppKit
import Foundation

// 大肥鱼原生本体：宠物 + 对话 + 播放器在同一个进程里。
// 走和原 helper 一样的 stdin JSON 协议（每行一条消息），可以直接替换它。

struct ClipInfo {
    let frames: [NSImage]
    let frameMs: Int
    let loop: Bool
}

final class PetView: NSView {
    weak var app: AppDelegate?

    override func draw(_ dirtyRect: NSRect) {
        guard let app = app else { return }
        NSColor.clear.set()
        dirtyRect.fill()
        if let image = app.currentFrame() {
            let size = image.size
            let target = NSRect(x: (bounds.width - size.width) / 2,
                                y: 0,
                                width: size.width,
                                height: size.height)
            image.draw(in: target)
        }
        if app.bubbleVisible, let bubble = app.bubbleText as String? {
            app.drawBubble(text: bubble, in: bounds)
        }
    }

    override func mouseDown(with event: NSEvent) {
        app?.startDrag(event)
    }

    override func mouseDragged(with event: NSEvent) {
        app?.drag(event)
    }

    override func mouseUp(with event: NSEvent) {
        app?.endDrag(event)
    }
}

final class ChatWindow: NSPanel, NSTextFieldDelegate {
    weak var app: AppDelegate?
    private let logView = NSTextView()
    private let input = NSTextField()
    private var timer: Timer?

    init(app: AppDelegate) {
        self.app = app
        let rect = NSRect(x: 0, y: 0, width: 340, height: 320)
        super.init(contentRect: rect, styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
        self.isFloatingPanel = true
        self.level = .floating
        self.backgroundColor = NSColor(calibratedWhite: 0.09, alpha: 0.96)
        self.isOpaque = false
        self.hasShadow = true
        self.isMovableByWindowBackground = false

        let container = NSView(frame: rect)
        container.wantsLayer = true
        container.layer?.cornerRadius = 16
        container.layer?.borderWidth = 1
        container.layer?.borderColor = NSColor(calibratedWhite: 1, alpha: 0.14).cgColor
        container.layer?.backgroundColor = NSColor(calibratedWhite: 0.09, alpha: 0.96).cgColor

        let scroll = NSScrollView(frame: NSRect(x: 10, y: 54, width: 320, height: 256))
        scroll.hasVerticalScroller = true
        scroll.drawsBackground = false
        scroll.borderType = .noBorder
        logView.frame = NSRect(x: 0, y: 0, width: 320, height: 256)
        logView.isEditable = false
        logView.drawsBackground = false
        logView.textColor = NSColor(calibratedWhite: 0.94, alpha: 1)
        logView.font = NSFont.systemFont(ofSize: 13)
        logView.textContainerInset = NSSize(width: 6, height: 6)
        scroll.documentView = logView
        container.addSubview(scroll)

        input.frame = NSRect(x: 10, y: 14, width: 196, height: 30)
        input.placeholderString = "说点什么…"
        input.font = NSFont.systemFont(ofSize: 13)
        input.textColor = NSColor(calibratedWhite: 0.95, alpha: 1)
        input.backgroundColor = NSColor(calibratedWhite: 0.18, alpha: 1)
        input.isBordered = false
        input.wantsLayer = true
        input.layer?.cornerRadius = 8
        input.delegate = self
        container.addSubview(input)

        let send = makeButton(title: "发送", frame: NSRect(x: 212, y: 14, width: 44, height: 30), action: #selector(sendTapped))
        let stop = makeButton(title: "停止", frame: NSRect(x: 258, y: 14, width: 44, height: 30), action: #selector(stopTapped))
        stop.contentTintColor = .systemRed
        let player = makeButton(title: "▶", frame: NSRect(x: 304, y: 14, width: 32, height: 30), action: #selector(playerTapped))
        container.addSubview(send)
        container.addSubview(stop)
        container.addSubview(player)

        self.contentView = container
        self.setFrame(rect, display: true)
    }

    private func makeButton(title: String, frame: NSRect, action: Selector) -> NSButton {
        let button = NSButton(frame: frame)
        button.title = title
        button.bezelStyle = .rounded
        button.target = self
        button.action = action
        return button
    }

    @objc private func sendTapped() {
        let text = input.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
        if text.isEmpty { return }
        input.stringValue = ""
        app?.post("/plugins/dsh-dafeiyu/chat/send", ["text": text])
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) { self.refresh() }
    }

    @objc private func stopTapped() {
        app?.post("/plugins/dsh-dafeiyu/chat/stop", [:])
    }

    @objc private func playerTapped() {
        app?.openPlayer()
    }

    func control(_ control: NSControl, textView: NSTextView, doCommandBy selector: Selector) -> Bool {
        if selector == #selector(NSResponder.insertNewline(_:)) {
            sendTapped()
            return true
        }
        return false
    }

    func startPolling() {
        timer?.invalidate()
        timer = Timer.scheduledTimer(withTimeInterval: 1.6, repeats: true) { _ in self.refresh() }
        refresh()
    }

    func stopPolling() {
        timer?.invalidate()
        timer = nil
    }

    func refresh() {
        guard let data = app?.get("/plugins/dsh-dafeiyu/chat/state"),
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return }
        let messages = (object["messages"] as? [[String: Any]]) ?? []
        var lines: [String] = []
        for message in messages.suffix(40) {
            var text = (message["text"] as? String) ?? ""
            if let range = text.range(of: "</dfy-context>") { text = String(text[range.upperBound...]) }
            text = text.trimmingCharacters(in: .whitespacesAndNewlines)
            if text.isEmpty { continue }
            let who = (message["role"] as? String) == "user" ? "我" : "大肥鱼"
            lines.append("\(who)：\(text)")
        }
        logView.string = lines.isEmpty ? "还没有消息" : lines.joined(separator: "\n\n")
        if let end = logView.string.endIndex as String.Index? {
            logView.scrollRangeToVisible(NSRange(location: logView.string.count, length: 0))
            _ = end
        }
    }
}

final class AppDelegate: NSObject, NSApplicationDelegate {
    var window: NSWindow!
    var petView: PetView!
    var chatWindow: ChatWindow?
    var clips: [String: ClipInfo] = [:]
    var stateMap: [String: String] = [:]
    var currentClip = "idle"
    var frameIndex = 0
    var lastFrameAt = Date()
    var bubbleText = ""
    var bubbleVisible = false
    var bubbleUntil = Date()
    var baseURL = URL(string: "http://127.0.0.1:3080")!
    var assetRoot: URL!
    var dragOrigin: NSPoint?
    var windowOrigin: NSPoint?

    func applicationDidFinishLaunching(_ notification: Notification) {
        let env = ProcessInfo.processInfo.environment
        if let webui = env["DSH_DAFEIYU_WEBUI_URL"], let url = URL(string: webui) {
            var components = URLComponents(url: url, resolvingAgainstBaseURL: false)
            components?.path = ""
            if let base = components?.url { baseURL = base }
        }
        // 资产目录：优先环境变量，否则按 .app 位置推导（<pkg>/runtime/bin/darwin/xxx.app/Contents/MacOS）
        let derivedRoot = (Bundle.main.executableURL ?? Bundle.main.bundleURL)
            .deletingLastPathComponent() // MacOS
            .deletingLastPathComponent() // Contents
            .deletingLastPathComponent() // .app
            .deletingLastPathComponent() // darwin
            .deletingLastPathComponent() // bin
            .deletingLastPathComponent() // runtime
            .deletingLastPathComponent() // dsh-dafeiyu（包根）
            .appendingPathComponent("assets")
        let bundleRoot = URL(fileURLWithPath: env["DSH_DAFEIYU_ASSETS"] ?? derivedRoot.path)
        assetRoot = bundleRoot.appendingPathComponent("pet")
        loadManifest(from: bundleRoot.appendingPathComponent("pet-manifest.json"))

        let size = NSSize(width: 412, height: 344)
        window = NSWindow(contentRect: NSRect(origin: .zero, size: size),
                          styleMask: [.borderless], backing: .buffered, defer: false)
        window.isOpaque = false
        window.backgroundColor = .clear
        window.hasShadow = false
        window.level = .floating
        window.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        petView = PetView(frame: NSRect(origin: .zero, size: size))
        petView.app = self
        window.contentView = petView
        positionWindow()
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)

        Timer.scheduledTimer(withTimeInterval: 0.02, repeats: true) { _ in self.tick(0.02) }
        startStdin()
        respond("ready")
        FileHandle.standardError.write(Data("clips=\(clips.count) assets=\(bundleRoot.path) window=\(window.frame)\n".utf8))
    }

    func positionWindow() {
        guard let screen = NSScreen.main else { return }
        let visible = screen.visibleFrame
        let size = window.frame.size
        window.setFrameOrigin(NSPoint(x: visible.maxX - size.width - 24, y: visible.minY + 24))
    }

    func loadManifest(from url: URL) {
        guard let data = try? Data(contentsOf: url),
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return }
        stateMap = (object["stateMap"] as? [String: String]) ?? [:]
        guard let clipObjects = object["clips"] as? [String: [String: Any]] else { return }
        for (name, info) in clipObjects {
            let frames = (info["frames"] as? [String]) ?? []
            let frameMs = (info["frameMs"] as? Int) ?? 42
            let loop = (info["loop"] as? Bool) ?? true
            var images: [NSImage] = []
            for frame in frames {
                let path = assetRoot.appendingPathComponent(frame)
                if let image = NSImage(contentsOf: path) { images.append(image) }
            }
            if !images.isEmpty { clips[name] = ClipInfo(frames: images, frameMs: frameMs, loop: loop) }
        }
    }

    func currentFrame() -> NSImage? {
        guard let clip = clips[currentClip] ?? clips["idle"], !clip.frames.isEmpty else { return nil }
        return clip.frames[frameIndex % clip.frames.count]
    }

    func tick(_ interval: TimeInterval) {
        guard let clip = clips[currentClip] ?? clips["idle"] else { return }
        let elapsed = Date().timeIntervalSince(lastFrameAt)
        if elapsed >= Double(clip.frameMs) / 1000.0 {
            lastFrameAt = Date()
            frameIndex += 1
            if frameIndex >= clip.frames.count {
                frameIndex = clip.loop ? 0 : clip.frames.count - 1
            }
        }
        if bubbleVisible && Date() > bubbleUntil { bubbleVisible = false }
        petView.needsDisplay = true
    }

    func setState(_ state: String) {
        let clip = stateMap[state] ?? "idle"
        if clips[clip] != nil, clip != currentClip {
            currentClip = clip
            frameIndex = 0
            lastFrameAt = Date()
        }
    }

    func showBubble(_ text: String, seconds: TimeInterval) {
        bubbleText = text
        bubbleVisible = true
        bubbleUntil = Date().addingTimeInterval(seconds)
        petView.needsDisplay = true
    }

    func drawBubble(text: String, in bounds: NSRect) {
        let font = NSFont.systemFont(ofSize: 13)
        let attributes: [NSAttributedString.Key: Any] = [.font: font, .foregroundColor: NSColor(calibratedWhite: 0.95, alpha: 1)]
        let maxWidth: CGFloat = 260
        let rect = (text as NSString).boundingRect(with: NSSize(width: maxWidth, height: 400),
                                                   options: [.usesLineFragmentOrigin], attributes: attributes)
        let size = NSSize(width: min(maxWidth, rect.width + 22), height: rect.height + 16)
        let origin = NSPoint(x: bounds.midX - size.width / 2, y: bounds.height - size.height - 12)
        let bubbleRect = NSRect(origin: origin, size: size)
        let path = NSBezierPath(roundedRect: bubbleRect, xRadius: 12, yRadius: 12)
        NSColor(calibratedWhite: 0.08, alpha: 0.92).setFill()
        path.fill()
        (text as NSString).draw(with: NSRect(x: origin.x + 11, y: origin.y + 8, width: size.width - 22, height: size.height - 16),
                                options: [.usesLineFragmentOrigin], attributes: attributes)
    }

    // ---- stdin 协议 ----
    func startStdin() {
        let handle = FileHandle.standardInput
        handle.readabilityHandler = { handle in
            let data = handle.availableData
            if data.isEmpty { DispatchQueue.main.async { NSApp.terminate(nil) }; return }
            guard let text = String(data: data, encoding: .utf8) else { return }
            for line in text.split(separator: "\n") {
                guard let payload = try? JSONSerialization.jsonObject(with: Data(line.utf8)) as? [String: Any] else { continue }
                DispatchQueue.main.async { self.handle(payload) }
            }
        }
    }

    func handle(_ message: [String: Any]) {
        let kind = (message["kind"] as? String) ?? ""
        switch kind {
        case "state":
            if let state = message["state"] as? String { setState(state) }
        case "pulse":
            if let text = message["message"] as? String {
                let ttl = (message["ttlMs"] as? Double ?? 6000) / 1000
                showBubble(text, seconds: ttl)
                if let state = message["state"] as? String { setState(state) }
            }
        case "config":
            if let urlString = message["webuiUrl"] as? String, let url = URL(string: urlString) {
                var components = URLComponents(url: url, resolvingAgainstBaseURL: false)
                components?.path = ""
                if let base = components?.url { baseURL = base }
            }
        case "ping":
            respond("pong")
        case "shutdown":
            NSApp.terminate(nil)
        default:
            break
        }
    }

    func respond(_ kind: String) {
        let line = "{\"kind\":\"\(kind)\",\"protocolVersion\":1}\n"
        FileHandle.standardOutput.write(Data(line.utf8))
    }

    // ---- 交互 ----
    func startDrag(_ event: NSEvent) {
        dragOrigin = NSEvent.mouseLocation
        windowOrigin = window.frame.origin
        if let clip = clips["dragging"] { currentClip = clip.frames.isEmpty ? currentClip : "dragging"; frameIndex = 0 }
    }

    func drag(_ event: NSEvent) {
        guard let origin = dragOrigin, let windowOrigin = windowOrigin else { return }
        let delta = NSEvent.mouseLocation
        window.setFrameOrigin(NSPoint(x: windowOrigin.x + delta.x - origin.x,
                                      y: windowOrigin.y + delta.y - origin.y))
        if let chat = chatWindow, chat.isVisible { placeChat(chat) }
    }

    func endDrag(_ event: NSEvent) {
        let moved = abs((NSEvent.mouseLocation.x - (dragOrigin?.x ?? 0))) + abs((NSEvent.mouseLocation.y - (dragOrigin?.y ?? 0)))
        dragOrigin = nil
        windowOrigin = nil
        if currentClip == "dragging" { setState("IDLE") }
        if moved < 4 { toggleChat() }
    }

    func toggleChat() {
        if chatWindow == nil { chatWindow = ChatWindow(app: self) }
        guard let chat = chatWindow else { return }
        if chat.isVisible {
            chat.orderOut(nil)
            chat.stopPolling()
        } else {
            placeChat(chat)
            chat.orderFront(nil)
            chat.startPolling()
        }
    }

    func placeChat(_ chat: ChatWindow) {
        let pet = window.frame
        var frame = chat.frame
        frame.origin = NSPoint(x: pet.maxX - frame.width, y: pet.maxY + 8)
        if let screen = NSScreen.main, frame.maxY > screen.visibleFrame.maxY {
            frame.origin.y = pet.minY - frame.height - 8
        }
        chat.setFrame(frame, display: true)
    }

    func openPlayer() {
        NSWorkspace.shared.open(URL(string: "http://127.0.0.1:7788/")!)
    }

    // ---- HTTP ----
    func get(_ path: String) -> Data? {
        var result: Data?
        let semaphore = DispatchSemaphore(value: 0)
        var request = URLRequest(url: baseURL.appendingPathComponent(path))
        request.timeoutInterval = 4
        URLSession.shared.dataTask(with: request) { data, _, _ in
            result = data
            semaphore.signal()
        }.resume()
        _ = semaphore.wait(timeout: .now() + 5)
        return result
    }

    func post(_ path: String, _ payload: [String: Any]) {
        var request = URLRequest(url: baseURL.appendingPathComponent(path))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "content-type")
        request.httpBody = try? JSONSerialization.data(withJSONObject: payload)
        request.timeoutInterval = 8
        URLSession.shared.dataTask(with: request) { _, _, _ in }.resume()
    }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.accessory)
app.run()

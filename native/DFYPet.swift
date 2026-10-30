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
        app.drawEvolution(in: bounds)
        app.drawStatusCard(in: bounds)
        if app.bubbleVisible, let bubble = app.bubbleText as String? {
            app.drawBubble(text: bubble, in: bounds)
        }
    }

    override func mouseDown(with event: NSEvent) {
        if let app = app {
            let point = event.locationInWindow
            if app.feedButtonRect.contains(point) {
                app.feed()
                return
            }
        }
        if event.clickCount == 2 {
            app?.openChat()
            return
        }
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
    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { true }
    weak var app: AppDelegate?
    private let logView = NSTextView()
    private let input = NSTextField()
    private let titleLabel = NSTextField(labelWithString: "大肥鱼")
    private let stateLabel = NSTextField(labelWithString: "待命")
    private let balanceLabel = NSTextField(labelWithString: "")
    private let taskLabel = NSTextField(labelWithString: "")
    private var timer: Timer?
    private var idleTimer: Timer?
    private var idleSeconds: TimeInterval {
        Double(ProcessInfo.processInfo.environment["DSH_DAFEIYU_CHAT_IDLE_SEC"] ?? "") ?? 45
    }
    private var expanded = false
    private let expandedSize = NSSize(width: 360, height: 400)
    private let collapsedSize = NSSize(width: 220, height: 46)
    private var summaryLabel: NSTextField!

    init(app: AppDelegate) {
        self.app = app
        let rect = NSRect(x: 0, y: 0, width: 360, height: 400)
        super.init(contentRect: rect, styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
        self.isFloatingPanel = true
        self.becomesKeyOnlyIfNeeded = false
        self.level = .floating
        self.isOpaque = false
        self.hasShadow = true
        self.backgroundColor = .clear
        self.appearance = NSAppearance(named: .aqua)

        let effect = NSView(frame: rect)
        effect.wantsLayer = true
        effect.layer?.backgroundColor = NSColor(calibratedWhite: 0.99, alpha: 1).cgColor
        effect.layer?.cornerRadius = 18
        effect.layer?.masksToBounds = true
        effect.layer?.borderWidth = 1
        effect.layer?.borderColor = NSColor(calibratedWhite: 0, alpha: 0.14).cgColor

        func label(_ text: String, size: CGFloat, weight: NSFont.Weight, alpha: CGFloat) -> NSTextField {
            let field = NSTextField(labelWithString: text)
            field.font = NSFont.systemFont(ofSize: size, weight: weight)
            field.textColor = NSColor(calibratedWhite: 0.96, alpha: alpha)
            return field
        }

        titleLabel.font = NSFont.systemFont(ofSize: 14, weight: .semibold)
        titleLabel.textColor = NSColor(calibratedWhite: 0.10, alpha: 1)
        titleLabel.frame = NSRect(x: 16, y: rect.height - 30, width: 120, height: 18)
        effect.addSubview(titleLabel)

        stateLabel.font = NSFont.systemFont(ofSize: 11.5)
        stateLabel.textColor = NSColor(calibratedWhite: 0.35, alpha: 1)
        stateLabel.frame = NSRect(x: 16, y: rect.height - 50, width: 200, height: 16)
        effect.addSubview(stateLabel)

        balanceLabel.font = NSFont.systemFont(ofSize: 11.5)
        balanceLabel.textColor = NSColor(calibratedWhite: 0.30, alpha: 1)
        balanceLabel.alignment = .right
        balanceLabel.frame = NSRect(x: rect.width - 170, y: rect.height - 30, width: 154, height: 16)
        effect.addSubview(balanceLabel)

        taskLabel.font = NSFont.systemFont(ofSize: 11.5)
        taskLabel.textColor = NSColor(calibratedWhite: 0.40, alpha: 1)
        taskLabel.alignment = .right
        taskLabel.frame = NSRect(x: rect.width - 170, y: rect.height - 50, width: 154, height: 16)
        effect.addSubview(taskLabel)

        let separator = NSBox(frame: NSRect(x: 12, y: rect.height - 62, width: rect.width - 24, height: 1))
        separator.boxType = .separator
        effect.addSubview(separator)

        let scroll = NSScrollView(frame: NSRect(x: 12, y: 84, width: rect.width - 24, height: rect.height - 152))
        scroll.hasVerticalScroller = true
        scroll.drawsBackground = false
        scroll.borderType = .noBorder
        logView.frame = NSRect(x: 0, y: 0, width: rect.width - 24, height: rect.height - 152)
        logView.isEditable = false
        logView.isSelectable = true
        logView.isRichText = true
        logView.allowsUndo = false
        logView.drawsBackground = false
        logView.textColor = NSColor(calibratedWhite: 0.12, alpha: 1)
        logView.font = NSFont.systemFont(ofSize: 13)
        logView.textContainerInset = NSSize(width: 4, height: 8)
        logView.isAutomaticQuoteSubstitutionEnabled = false
        scroll.documentView = logView
        effect.addSubview(scroll)

        input.frame = NSRect(x: 12, y: 16, width: rect.width - 160, height: 30)
        input.placeholderString = "说点什么…"
        input.font = NSFont.systemFont(ofSize: 13)
        input.textColor = NSColor(calibratedWhite: 0.12, alpha: 1)
        input.backgroundColor = NSColor(calibratedWhite: 0.94, alpha: 1)
        input.isBordered = false
        input.wantsLayer = true
        input.layer?.cornerRadius = 9
        input.delegate = self
        effect.addSubview(input)

        let chipY: CGFloat = 52
        let chipWidth: CGFloat = 76
        let chips = ["展开说说", "换个说法", "接着说"]
        for (index, title) in chips.enumerated() {
            let chip = NSButton(frame: NSRect(x: 12 + CGFloat(index) * (chipWidth + 6), y: chipY, width: chipWidth, height: 24))
            chip.title = title
            chip.bezelStyle = .inline
            chip.font = NSFont.systemFont(ofSize: 11.5)
            chip.target = self
            chip.action = #selector(chipTapped(_:))
            effect.addSubview(chip)
        }
        let send = makeButton(title: "发送", frame: NSRect(x: rect.width - 144, y: 16, width: 44, height: 30), action: #selector(sendTapped))
        let stop = makeButton(title: "停止", frame: NSRect(x: rect.width - 96, y: 16, width: 44, height: 30), action: #selector(stopTapped))
        stop.contentTintColor = .systemRed
        let player = makeButton(title: "▶", frame: NSRect(x: rect.width - 48, y: 16, width: 36, height: 30), action: #selector(playerTapped))
        let feed = makeButton(title: "🍚", frame: NSRect(x: rect.width - 84, y: 16, width: 32, height: 30), action: #selector(feedTapped))
        effect.addSubview(feed)
        effect.addSubview(send)
        effect.addSubview(stop)
        effect.addSubview(player)

        summaryLabel = NSTextField(labelWithString: "待命")
        summaryLabel.font = NSFont.systemFont(ofSize: 12, weight: .medium)
        summaryLabel.textColor = NSColor(calibratedWhite: 0.2, alpha: 1)
        summaryLabel.alignment = .center
        summaryLabel.frame = NSRect(x: 10, y: 13, width: rect.width - 20, height: 20)
        summaryLabel.isHidden = true
        effect.addSubview(summaryLabel)

        let click = NSClickGestureRecognizer(target: self, action: #selector(summaryClicked))
        summaryLabel.addGestureRecognizer(click)

        self.contentView = effect
        self.setFrame(rect, display: true)
    }

    @objc private func summaryClicked() {
        setExpanded(!expanded)
    }

    // 一段时间没操作就自动收回成小条
    func resetIdle() {
        idleTimer?.invalidate()
        guard expanded else { return }
        idleTimer = Timer.scheduledTimer(withTimeInterval: idleSeconds, repeats: false) { _ in
            guard self.expanded else { return }
            self.setExpanded(false)
        }
    }

    func setExpanded(_ value: Bool) {
        expanded = value
        if !value { idleTimer?.invalidate() }
        let target = value ? expandedSize : collapsedSize
        var frame = self.frame
        frame.size = target
        self.setFrame(frame, display: true)
        for view in contentView?.subviews ?? [] {
            if view === summaryLabel { view.isHidden = value }
            else { view.isHidden = !value }
        }
        if value {
            self.makeKeyAndOrderFront(nil)
            input.becomeFirstResponder()
            refresh()
            resetIdle()
        }
        updateSummary()
    }

    private func updateSummary() {
        var parts: [String] = []
        if !balanceLabel.stringValue.isEmpty { parts.append(balanceLabel.stringValue) }
        if !taskLabel.stringValue.isEmpty { parts.append(taskLabel.stringValue) }
        if parts.isEmpty { parts.append(stateLabel.stringValue.isEmpty ? "大肥鱼" : stateLabel.stringValue) }
        summaryLabel.stringValue = parts.joined(separator: " · ")
    }

    private func makeButton(title: String, frame: NSRect, action: Selector) -> NSButton {
        let button = NSButton(frame: frame)
        button.title = title
        button.bezelStyle = .rounded
        button.target = self
        button.action = action
        return button
    }

    func updateStatus(state: String?, balance: String?, tasks: String?) {
        if let state = state { stateLabel.stringValue = state }
        if let balance = balance { balanceLabel.stringValue = balance }
        if let tasks = tasks { taskLabel.stringValue = tasks }
        updateSummary()
    }

    func showCollapsed() {
        setExpanded(false)
    }

    func showExpanded() {
        setExpanded(true)
    }

    func controlTextDidChange(_ obj: Notification) {
        resetIdle()
    }

    @objc private func sendTapped() {
        resetIdle()
        let text = input.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
        if text.isEmpty { return }
        input.stringValue = ""
        app?.post("/plugins/dsh-dafeiyu/chat/send", ["text": text])
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) { self.refresh() }
    }

    @objc private func chipTapped(_ sender: NSButton) {
        resetIdle()
        let text = sender.title
        app?.post("/plugins/dsh-dafeiyu/chat/send", ["text": text])
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) { self.refresh() }
    }

    @objc private func stopTapped() { app?.post("/plugins/dsh-dafeiyu/chat/stop", [:]) }
    @objc private func playerTapped() { app?.openPlayer() }
    @objc private func feedTapped() { app?.feed() }

    func control(_ control: NSControl, textView: NSTextView, doCommandBy selector: Selector) -> Bool {
        if selector == #selector(NSResponder.insertNewline(_:)) { sendTapped(); return true }
        return false
    }

    func startPolling() {
        timer?.invalidate()
        timer = Timer.scheduledTimer(withTimeInterval: 1.6, repeats: true) { _ in self.refresh() }
        refresh()
    }

    func stopPolling() { timer?.invalidate(); timer = nil }

    func refresh() {
        guard let data = app?.get("/plugins/dsh-dafeiyu/chat/state"),
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return }
        let messages = (object["messages"] as? [[String: Any]]) ?? []
        let attributed = NSMutableAttributedString()
        let paragraph = NSMutableParagraphStyle()
        paragraph.lineSpacing = 3
        paragraph.paragraphSpacing = 8
        for message in messages.suffix(80) {
            var text = (message["text"] as? String) ?? ""
            if let range = text.range(of: "</dfy-context>") { text = String(text[range.upperBound...]) }
            text = text.trimmingCharacters(in: .whitespacesAndNewlines)
            if text.isEmpty { continue }
            let isUser = (message["role"] as? String) == "user"
            let who = isUser ? "我" : "大肥鱼"
            let header = NSMutableAttributedString(string: who + "\n", attributes: [
                .font: NSFont.systemFont(ofSize: 11.5, weight: .semibold),
                .foregroundColor: isUser ? NSColor(calibratedRed: 0.16, green: 0.36, blue: 0.85, alpha: 1)
                                        : NSColor(calibratedRed: 0.10, green: 0.50, blue: 0.36, alpha: 1),
            ])
            let body = NSAttributedString(string: text + "\n", attributes: [
                .font: NSFont.systemFont(ofSize: 13),
                .foregroundColor: NSColor(calibratedWhite: 0.13, alpha: 1),
                .paragraphStyle: paragraph,
            ])
            attributed.append(header)
            attributed.append(body)
        }
        if attributed.length == 0 {
            attributed.append(NSAttributedString(string: "还没有消息，说点什么吧。", attributes: [
                .font: NSFont.systemFont(ofSize: 13),
                .foregroundColor: NSColor(calibratedWhite: 0.45, alpha: 1),
            ]))
        }
        logView.textStorage?.setAttributedString(attributed)
        logView.scrollToEndOfDocument(nil)
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
    var lastStateText = ""
    var lastBalanceText = ""
    var lastTasksText = ""
    var lastKnownRemaining: Int? = nil
    var hunger: Double = 0
    var evoLevel: Int = 0
    var evoStage: String = "初生"
    var sparkPhase: Double = 0
    var feedButtonRect: NSRect = .zero
    var baseURL = URL(string: "http://127.0.0.1:3080")!
    var microClips: [String] = []
    var microIntervals: [String: [Int]] = [:]
    var activityLevel = "normal"
    var microTimer: Timer?
    var oneShotClip: String? = nil
    var assetRoot: URL!
    var dragOrigin: NSPoint?
    var windowOrigin: NSPoint?

    func applicationDidFinishLaunching(_ notification: Notification) {
        // 单实例：同 bundle id 已经有进程在跑就退出（避免出现两只宠物）
        if let identifier = Bundle.main.bundleIdentifier {
            let others = NSRunningApplication.runningApplications(withBundleIdentifier: identifier)
                .filter { $0.processIdentifier != ProcessInfo.processInfo.processIdentifier }
            if !others.isEmpty {
                NSApp.terminate(nil)
                return
            }
        }
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

        let size = NSSize(width: 412, height: 344 + 96)
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
        // 直接盯 NAS 上的降噪批处理状态文件（不依赖 host 推送）
        scheduleMicro()
        watchDenoise()
        fetchMood()
        fetchEvolution()
        Timer.scheduledTimer(withTimeInterval: 60, repeats: true) { _ in self.fetchMood(); self.fetchEvolution() }
        Timer.scheduledTimer(withTimeInterval: 30, repeats: true) { _ in self.watchDenoise() }
        startStdin()
        respond("ready")
        if ProcessInfo.processInfo.environment["DSH_DAFEIYU_CHAT_OPEN"] == "1" {
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.8) { self.toggleChat() }
        }
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
        microClips = (object["idleMicroClips"] as? [String]) ?? []
        microIntervals = (object["idleMicroIntervalsMs"] as? [String: [Int]]) ?? [:]
        activityLevel = ProcessInfo.processInfo.environment["DSH_DAFEIYU_ACTIVITY_LEVEL"] ?? "normal"
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
                if clip.loop {
                    frameIndex = 0
                } else {
                    frameIndex = clip.frames.count - 1
                    // 一次性动作放完就回到 idle
                    if let oneShot = oneShotClip, currentClip == oneShot {
                        oneShotClip = nil
                        setState("IDLE")
                        scheduleMicro()
                    }
                }
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
            if state == "IDLE" {
                // 先播完手头的一次性动作，再调度下一个
                if oneShotClip == nil { scheduleMicro() }
            } else {
                microTimer?.invalidate()
                microTimer = nil
                oneShotClip = nil
            }
        }
    }

    func scheduleMicro() {
        microTimer?.invalidate()
        guard !microClips.isEmpty, currentClip == "idle" else { return }
        let range = microIntervals[activityLevel] ?? microIntervals["normal"] ?? [25000, 45000]
        let delay = Double(Int.random(in: (range.first ?? 25000)...(range.last ?? 45000))) / 1000.0
        microTimer = Timer.scheduledTimer(withTimeInterval: delay, repeats: false) { _ in
            guard self.currentClip == "idle", self.clips.count > 0 else { return }
            var name = self.microClips.randomElement() ?? "idle"
            if self.hunger > 0.6, self.clips["eat_rice"] != nil, Double.random(in: 0...1) < 0.65 {
                name = "eat_rice"
            }
            self.oneShotClip = name
            self.currentClip = name
            self.frameIndex = 0
            self.lastFrameAt = Date()
        }
    }

    func playReaction(_ name: String) {
        guard clips[name] != nil else { return }
        oneShotClip = name
        currentClip = name
        frameIndex = 0
        lastFrameAt = Date()
        microTimer?.invalidate()
    }

    func showBubble(_ text: String, seconds: TimeInterval) {
        bubbleText = text
        bubbleVisible = true
        bubbleUntil = Date().addingTimeInterval(seconds)
        petView.needsDisplay = true
    }

    // 复刻原来的状态卡：标题 / 明细 / 余额
    func drawStatusCard(in bounds: NSRect) {
        let cardHeight: CGFloat = 84
        let gap: CGFloat = 12
        let card = NSRect(x: 8, y: 344 + gap, width: bounds.width - 16, height: cardHeight)
        let path = NSBezierPath(roundedRect: card, xRadius: 16, yRadius: 16)
        NSColor(calibratedWhite: 1.0, alpha: 0.97).setFill()
        path.fill()
        NSColor(calibratedWhite: 0, alpha: 0.10).setStroke()
        path.lineWidth = 1
        path.stroke()

        let title = statusTitle()
        let titleAttrs: [NSAttributedString.Key: Any] = [
            .font: NSFont.systemFont(ofSize: 14, weight: .semibold),
            .foregroundColor: NSColor(calibratedWhite: 0.10, alpha: 1),
        ]
        (title as NSString).draw(at: NSPoint(x: card.minX + 16, y: card.maxY - 30), withAttributes: titleAttrs)

        let detailAttrs: [NSAttributedString.Key: Any] = [
            .font: NSFont.systemFont(ofSize: 11.5),
            .foregroundColor: NSColor(calibratedWhite: 0.45, alpha: 1),
        ]
        (statusDetail() as NSString).draw(at: NSPoint(x: card.minX + 16, y: card.maxY - 48), withAttributes: detailAttrs)

        if !lastBalanceText.isEmpty {
            let rightAttrs: [NSAttributedString.Key: Any] = [
                .font: NSFont.systemFont(ofSize: 11.5),
                .foregroundColor: NSColor(calibratedWhite: 0.45, alpha: 1),
            ]
            let text = "账户 " + lastBalanceText as NSString
            let size = text.size(withAttributes: rightAttrs)
            text.draw(at: NSPoint(x: card.maxX - 16 - size.width, y: card.minY + 50), withAttributes: rightAttrs)
        }
        let hungerText = String(format: "饿 %.0f%% · Lv.%d %@", hunger * 100, evoLevel, evoStage)
        let hungerAttrs: [NSAttributedString.Key: Any] = [
            .font: NSFont.systemFont(ofSize: 11.5),
            .foregroundColor: hunger > 0.65 ? NSColor(calibratedRed: 0.78, green: 0.35, blue: 0.25, alpha: 1)
                                           : NSColor(calibratedWhite: 0.45, alpha: 1),
        ]
        let hungerString = hungerText as NSString
        let hungerSize = hungerString.size(withAttributes: hungerAttrs)
        hungerString.draw(at: NSPoint(x: card.maxX - 16 - hungerSize.width, y: card.minY + 12), withAttributes: hungerAttrs)
        // 左下角"🍚 喂食"按钮
        let feedRect = NSRect(x: card.minX + 12, y: card.minY + 8, width: 74, height: 24)
        feedButtonRect = feedRect
        let feedPath = NSBezierPath(roundedRect: feedRect, xRadius: 12, yRadius: 12)
        NSColor(calibratedRed: 0.95, green: 0.93, blue: 0.88, alpha: 1).setFill()
        feedPath.fill()
        NSColor(calibratedWhite: 0.35, alpha: 0.25).setStroke()
        feedPath.lineWidth = 1
        feedPath.stroke()
        let feedAttrs: [NSAttributedString.Key: Any] = [
            .font: NSFont.systemFont(ofSize: 11.5, weight: .medium),
            .foregroundColor: NSColor(calibratedWhite: 0.25, alpha: 1),
        ]
        ("🍚 喂食" as NSString).draw(at: NSPoint(x: feedRect.minX + 10, y: feedRect.minY + 5), withAttributes: feedAttrs)

        if !lastTasksText.isEmpty {
            let rightAttrs: [NSAttributedString.Key: Any] = [
                .font: NSFont.systemFont(ofSize: 11.5),
                .foregroundColor: NSColor(calibratedWhite: 0.45, alpha: 1),
            ]
            let text = lastTasksText as NSString
            let size = text.size(withAttributes: rightAttrs)
            text.draw(at: NSPoint(x: card.maxX - 16 - size.width, y: card.minY + 32), withAttributes: rightAttrs)
        }
    }

    func fetchEvolution() {
        guard let data = get("/plugins/dsh-dafeiyu/evolution"),
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return }
        if let level = object["level"] as? Int { evoLevel = level }
        if let stage = object["stage"] as? String { evoStage = stage }
        petView.needsDisplay = true
    }

    func fetchMood() {
        guard let data = get("/plugins/dsh-dafeiyu/mood"),
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return }
        if let value = object["hunger"] as? Double { hunger = min(1, max(0, value)) }
        petView.needsDisplay = true
    }

    // 外观进化：Lv.1 光晕，Lv.2 星点，Lv.3 头顶光环，Lv.4 传说（紫电 + 劈刀）
    func drawEvolution(in bounds: NSRect) {
        guard evoLevel > 0 else { return }
        if evoLevel >= 4 { drawLegendary(in: bounds); return }
        let center = NSPoint(x: bounds.midX, y: bounds.height * 0.42)
        let baseRadius = bounds.height * 0.30
        let glow = NSBezierPath(ovalIn: NSRect(x: center.x - baseRadius, y: center.y - baseRadius * 0.8,
                                               width: baseRadius * 2, height: baseRadius * 1.6))
        let color = evoLevel >= 4
            ? NSColor(calibratedRed: 1.0, green: 0.83, blue: 0.45, alpha: 0.18)
            : NSColor(calibratedRed: 0.55, green: 0.75, blue: 1.0, alpha: 0.16)
        color.setFill()
        glow.fill()

        if evoLevel >= 2 {
            sparkPhase += 0.06
            for index in 0..<7 {
                let angle = sparkPhase + Double(index) * (2 * Double.pi / 7)
                let radius = baseRadius * (1.05 + 0.08 * sin(sparkPhase * 1.7 + Double(index)))
                let x = center.x + CGFloat(cos(angle)) * radius
                let y = center.y + CGFloat(sin(angle)) * radius * 0.8
                let size: CGFloat = evoLevel >= 4 ? 7 : 5
                let star = NSBezierPath(ovalIn: NSRect(x: x - size / 2, y: y - size / 2, width: size, height: size))
                NSColor(calibratedRed: 1.0, green: 0.92, blue: 0.55, alpha: 0.75).setFill()
                star.fill()
            }
        }

        if evoLevel >= 3 {
            let ringRect = NSRect(x: center.x - baseRadius * 0.55, y: bounds.height * 0.78,
                                  width: baseRadius * 1.1, height: baseRadius * 0.36)
            let ring = NSBezierPath(ovalIn: ringRect)
            ring.lineWidth = 2.5
            NSColor(calibratedRed: 1.0, green: 0.85, blue: 0.4, alpha: 0.85).setStroke()
            ring.stroke()
        }
    }


    // 传说形态：紫电背景 + 斜向劈刀 + 碎片，每 3 秒来一次强闪
    func drawLegendary(in bounds: NSRect) {
        let now = Date().timeIntervalSinceReferenceDate
        let flash = max(0, sin(now * 2.1))            // 0..1 呼吸式闪光
        let burst = pow(max(0, sin(now * 0.9)), 6)     // 每 ~3.5 秒一次强劈

        // 0) 暗紫底幕，让光效更醒（只在她周围一圈）
        let auraRect = NSRect(x: bounds.midX - bounds.width * 0.40, y: bounds.height * 0.02,
                              width: bounds.width * 0.80, height: bounds.height * 0.72)
        let aura = NSBezierPath(ovalIn: auraRect)
        NSColor(calibratedRed: 0.10, green: 0.05, blue: 0.22, alpha: 0.62 + 0.10 * flash).setFill()
        aura.fill()

        // 1) 深紫径向底光
        if let gradient = NSGradient(colors: [
            NSColor(calibratedRed: 0.45, green: 0.25, blue: 0.95, alpha: 0.30 + 0.12 * flash),
            NSColor(calibratedRed: 0.20, green: 0.10, blue: 0.45, alpha: 0.10),
            NSColor(calibratedWhite: 0, alpha: 0),
        ] as [NSColor]) {
            let center = NSPoint(x: bounds.midX, y: bounds.height * 0.45)
            let radius = bounds.height * 0.55
            gradient.draw(fromCenter: center, radius: 0, toCenter: center, radius: radius, options: [])
        }

        // 2) 斜向刀光：从右下到左上的一道光刃
        let bladeStart = NSPoint(x: bounds.midX - bounds.width * 0.62, y: bounds.height * 0.05)
        let bladeEnd = NSPoint(x: bounds.midX + bounds.width * 0.62, y: bounds.height * 0.92)
        let blade = NSBezierPath()
        blade.move(to: bladeStart)
        blade.line(to: bladeEnd)
        blade.lineWidth = 10 + 22 * burst
        NSColor(calibratedRed: 0.75, green: 0.55, blue: 1.0, alpha: 0.55 + 0.35 * burst).setStroke()
        blade.stroke()
        let core = NSBezierPath()
        core.move(to: bladeStart)
        core.line(to: bladeEnd)
        core.lineWidth = 3 + 7 * burst
        NSColor(calibratedWhite: 1, alpha: 0.75 + 0.25 * burst).setStroke()
        core.stroke()

        // 2.5) 劈砍弧光
        let arc = NSBezierPath()
        arc.appendArc(withCenter: NSPoint(x: bounds.midX + bounds.width * 0.10, y: bounds.height * 0.42),
                      radius: bounds.width * 0.52, startAngle: 118, endAngle: 236, clockwise: false)
        arc.lineWidth = 5 + 16 * burst
        NSColor(calibratedRed: 0.85, green: 0.70, blue: 1.0, alpha: 0.35 + 0.45 * burst).setStroke()
        arc.stroke()

        // 3) 紫色闪电（每帧重新抖动）
        var seed = UInt64(now * 12) &* 6364136223846793005 &+ 1442695040888963407
        for _ in 0..<3 {
            let path = NSBezierPath()
            var point = NSPoint(x: CGFloat.random(in: bounds.minX...bounds.maxX), y: bounds.maxY)
            path.move(to: point)
            for _ in 0..<6 {
                seed = seed &* 6364136223846793005 &+ 1442695040888963407
                let dx = CGFloat(Int(seed >> 33) % 46) - 23
                let dy = -CGFloat(Int(seed >> 17) % 40) - 18
                point = NSPoint(x: point.x + dx, y: point.y + dy)
                path.line(to: point)
            }
            path.lineWidth = 1.4
            NSColor(calibratedRed: 0.85, green: 0.7, blue: 1.0, alpha: 0.5 + 0.4 * flash).setStroke()
            path.stroke()
        }

        // 4) 环绕碎片
        for index in 0..<8 {
            let angle = now * 0.9 + Double(index) * (2 * Double.pi / 8)
            let radius = bounds.height * (0.28 + 0.05 * sin(now * 1.3 + Double(index)))
            let x = bounds.midX + CGFloat(cos(angle)) * radius
            let y = bounds.height * 0.45 + CGFloat(sin(angle)) * radius * 0.75
            let shard = NSBezierPath()
            let size: CGFloat = 4 + CGFloat(index % 3)
            shard.move(to: NSPoint(x: x, y: y + size))
            shard.line(to: NSPoint(x: x + size * 0.6, y: y))
            shard.line(to: NSPoint(x: x, y: y - size))
            shard.line(to: NSPoint(x: x - size * 0.6, y: y))
            shard.close()
            NSColor(calibratedRed: 0.75, green: 0.6, blue: 1.0, alpha: 0.35 + 0.35 * flash).setFill()
            shard.fill()
        }
    }

    func watchDenoise() {
        let dir = ProcessInfo.processInfo.environment["DSH_DAFEIYU_DENOISE_DIR"] ?? "/Volumes/15226550291/课程"
        let statePath = dir + "/_denoise-state.json"
        guard let data = try? Data(contentsOf: URL(fileURLWithPath: statePath)),
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return }
        let done = (object["done"] as? [String: Any]) ?? [:]
        let skipped = (object["skipped"] as? [String: Any]) ?? [:]
        guard let names = try? FileManager.default.contentsOfDirectory(atPath: dir) else { return }
        var remaining = 0
        for name in names {
            if name.hasPrefix(".") || name.contains(".denoise-tmp") { continue }
            let lower = name.lowercased()
            if !(lower.hasSuffix(".mp4") || lower.hasSuffix(".mkv") || lower.hasSuffix(".mov") || lower.hasSuffix(".avi") || lower.hasSuffix(".wmv") || lower.hasSuffix(".flv") || lower.hasSuffix(".ts") || lower.hasSuffix(".webm")) { continue }
            if done[name] != nil || skipped[name] != nil { continue }
            remaining += 1
        }
        let total = done.count + skipped.count + remaining
        lastTasksText = remaining > 0 ? "任务 \(remaining)" : "空闲"
        if remaining > 0 {
            lastStateText = "降噪 \(total - remaining)/\(total)"
        } else if lastKnownRemaining ?? 0 > 0 {
            lastStateText = "降噪完成"
            lastTasksText = "空闲"
            celebrateMusic()
        }
        lastKnownRemaining = remaining
        chatWindow?.updateStatus(state: lastStateText, balance: nil, tasks: lastTasksText)
        petView.needsDisplay = true
    }

    func feed() {
        post("/plugins/dsh-dafeiyu/mood", ["action": "feed"])
        playReaction("eat_rice")
        showBubble("谢谢，真好吃！", seconds: 3)
        DispatchQueue.main.asyncAfter(deadline: .now() + 3) { self.fetchMood() }
    }

    func celebrateMusic() {
        let dir = (ProcessInfo.processInfo.environment["DSH_DAFEIYU_MUSIC_DIR"] ?? NSHomeDirectory() + "/Music/大肥鱼歌单")
        guard let names = try? FileManager.default.contentsOfDirectory(atPath: dir) else { return }
        let tracks = names.filter { name in
            let lower = name.lowercased()
            return lower.hasSuffix(".mp4") || lower.hasSuffix(".m4a") || lower.hasSuffix(".mp3") || lower.hasSuffix(".wav")
        }
        guard let track = tracks.randomElement() else { return }
        let task = Process()
        task.executableURL = URL(fileURLWithPath: "/usr/bin/afplay")
        task.arguments = ["-v", "0.5", dir + "/" + track]
        try? task.run()
        showBubble("降噪全部完成啦，放首歌庆祝一下～", seconds: 8)
    }

    func statusTitle() -> String {
        if (lastKnownRemaining ?? 0) > 0 { return "大肥鱼在帮你降噪" }
        switch lastStateText {
        case "WORKING", "干活中": return "大肥鱼正在干活"
        case "THINKING", "思考中": return "大肥鱼在思考"
        case "WAITING", "等你呢": return "大肥鱼在等你"
        case "SUCCESS", "完成啦": return "大肥鱼搞定啦"
        case "ERROR", "出问题了": return "大肥鱼遇到点问题"
        default: return "大肥鱼陪你待命"
        }
    }

    func statusDetail() -> String {
        lastStateText.isEmpty ? "DSH · 等待下一次任务" : "DSH · " + lastStateText
    }

    func openChat() {
        if chatWindow == nil { chatWindow = ChatWindow(app: self) }
        chatWindow?.showExpanded()
        placeChat(chatWindow!)
        chatWindow?.orderFront(nil)
        chatWindow?.makeKey()
        chatWindow?.startPolling()
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
        case "task":
            var detail = (message["activity"] as? String) ?? (message["state"] as? String) ?? ""
            if let text = message["detail"] as? String, !text.isEmpty { detail = text }
            lastStateText = detail
            chatWindow?.updateStatus(state: detail.isEmpty ? nil : detail, balance: nil, tasks: nil)
        case "tasks":
            let items = (message["tasks"] as? [[String: Any]]) ?? []
            let active = items.filter { (($0["state"] as? String) ?? "") != "IDLE" && (($0["state"] as? String) ?? "") != "DONE" }
            let summary = active.isEmpty ? "空闲" : "任务 \((active.count))"
            lastTasksText = summary
            chatWindow?.updateStatus(state: nil, balance: nil, tasks: summary)
        case "balance":
            if let balances = message["balances"] as? [[String: Any]],
               let cny = balances.first(where: { ($0["currency"] as? String) == "CNY" }),
               let total = cny["total"] as? String {
                let value = Double(total) ?? 0
                lastBalanceText = String(format: "余额 ¥%.2f", value)
                chatWindow?.updateStatus(state: nil, balance: lastBalanceText, tasks: nil)
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
        if moved < 4 {
            if clips["poke"] != nil { playReaction("poke") }
        }
    }

    func toggleChat() {
        if chatWindow == nil {
            chatWindow = ChatWindow(app: self)
            chatWindow?.updateStatus(state: lastStateText.isEmpty ? nil : lastStateText,
                                     balance: lastBalanceText.isEmpty ? nil : lastBalanceText,
                                     tasks: lastTasksText.isEmpty ? nil : lastTasksText)
        }
        guard let chat = chatWindow else { return }
        if chat.isVisible {
            chat.orderOut(nil)
            chat.stopPolling()
        } else {
            chat.showCollapsed()
            placeChat(chat)
            chat.orderFront(nil)
            chat.makeKey()
            chat.startPolling()
        }
    }

    func placeChat(_ chat: ChatWindow) {
        let pet = window.frame
        var frame = chat.frame
        let visible = (NSScreen.main?.visibleFrame) ?? pet
        var y = pet.maxY + 8
        if y + frame.height > visible.maxY { y = pet.minY - frame.height - 8 }
        y = max(visible.minY + 8, min(y, visible.maxY - frame.height - 8))
        var x = pet.maxX - frame.width
        x = max(visible.minX + 8, min(x, visible.maxX - frame.width - 8))
        frame.origin = NSPoint(x: x, y: y)
        chat.setFrame(frame, display: true)
    }

    func openPlayer() {
        NSWorkspace.shared.open(URL(string: "http://127.0.0.1:7788/")!)
    }

    // ---- HTTP ----
    // 端口每次启动都会变：优先读插件写下的当前地址
    func currentBaseURL() -> URL {
        let path = NSHomeDirectory() + "/.dsh/dsh-dafeiyu-webui.txt"
        if let text = try? String(contentsOfFile: path, encoding: .utf8) {
            let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
            if let url = URL(string: trimmed) { return url }
        }
        return baseURL
    }

    func get(_ path: String) -> Data? {
        var result: Data?
        let semaphore = DispatchSemaphore(value: 0)
        var request = URLRequest(url: currentBaseURL().appendingPathComponent(path))
        request.timeoutInterval = 4
        URLSession.shared.dataTask(with: request) { data, _, _ in
            result = data
            semaphore.signal()
        }.resume()
        _ = semaphore.wait(timeout: .now() + 5)
        return result
    }

    func post(_ path: String, _ payload: [String: Any]) {
        var request = URLRequest(url: currentBaseURL().appendingPathComponent(path))
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

// 把任意 SceneKit 能读的 3D 模型（.usdz/.scn/.dae/.obj）渲染成宠物尺寸的转台帧。
// 用法：render-turntable <model> <outDir> [frames] [size]
import AppKit
import SceneKit
import Foundation

let args = CommandLine.arguments
guard args.count >= 3 else {
  print("usage: render-turntable <model> <outDir> [frames] [size]")
  exit(1)
}
let modelPath = args[1]
let outDir = args[2]
let frames = args.count > 3 ? Int(args[3]) ?? 36 : 36
let size = args.count > 4 ? Int(args[4]) ?? 344 : 344

let scene: SCNScene
if modelPath == "test" {
  scene = SCNScene()
  let box = SCNBox(width: 1, height: 1.4, length: 0.8, chamferRadius: 0.08)
  box.firstMaterial?.diffuse.contents = NSColor.systemBlue
  let node = SCNNode(geometry: box)
  node.position = SCNVector3(0, 0, 0)
  scene.rootNode.addChildNode(node)
} else {
  guard let loaded = try? SCNScene(url: URL(fileURLWithPath: modelPath), options: nil) else {
    print("无法读取模型：\(modelPath)")
    exit(2)
  }
  scene = loaded
}

// 相机：正前方、略高
let camera = SCNNode()
camera.camera = SCNCamera()
camera.camera?.fieldOfView = 35
camera.camera?.usesOrthographicProjection = false
camera.position = SCNVector3(0, 0.25, 3.2)
scene.rootNode.addChildNode(camera)

// 灯光
let key = SCNNode()
key.light = SCNLight()
key.light?.type = .directional
key.light?.intensity = 900
key.eulerAngles = SCNVector3(-0.6, 0.7, 0)
scene.rootNode.addChildNode(key)
scene.background.contents = NSColor.clear

try? FileManager.default.createDirectory(atPath: outDir, withIntermediateDirectories: true)

let width = size, height = size
let renderer = SCNRenderer(device: MTLCreateSystemDefaultDevice(), options: nil)
renderer.scene = scene
renderer.pointOfView = camera

for index in 0..<frames {
  let angle = CGFloat(-Double(index) / Double(frames) * 2 * .pi)
  let rotation = SCNMatrix4MakeRotation(angle, 0, 1, 0)
  // 只转模型本身，不转相机
  if let root = scene.rootNode.childNodes.first(where: { $0.geometry != nil }) ?? scene.rootNode.childNodes.first {
    root.transform = rotation
  }
  let image = renderer.snapshot(atTime: 0, with: CGSize(width: width, height: height), antialiasingMode: .multisampling4X)
  guard let tiff = image.tiffRepresentation, let rep = NSBitmapImageRep(data: tiff),
        let png = rep.representation(using: .png, properties: [:]) else { continue }
  let file = String(format: "%@/turn3d_%03d.png", outDir, index + 1)
  try? png.write(to: URL(fileURLWithPath: file))
}
print("rendered \(frames) frames to \(outDir)")

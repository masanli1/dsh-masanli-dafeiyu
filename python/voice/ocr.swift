// 用 macOS Vision 做 OCR，批量模式：一次进程处理多张图，避免每张都重新初始化 Vision。
//
//   ocr --langs en-US,zh-Hans a.png b.png ...
//
// 输出每行：  <图片路径>\t<y 归一化坐标>\t<置信度>\t<文本>
// y 是「从上到下」的坐标（Vision 原点在左下，这里翻转过），方便按行排序。
import AppKit
import Foundation
import Vision

var args = Array(CommandLine.arguments.dropFirst())
var langs = ["en-US", "zh-Hans"]
if let index = args.firstIndex(of: "--langs"), index + 1 < args.count {
  langs = args[index + 1].split(separator: ",").map(String.init)
  args.removeSubrange(index...index + 1)
}
if args.isEmpty {
  FileHandle.standardError.write("usage: ocr [--langs a,b] <image>...\n".data(using: .utf8)!)
  exit(2)
}

func ocr(_ path: String, _ request: VNRecognizeTextRequest) -> Bool {
  guard let image = NSImage(contentsOfFile: path),
        let tiff = image.tiffRepresentation,
        let rep = NSBitmapImageRep(data: tiff),
        let cg = rep.cgImage else {
    FileHandle.standardError.write("cannot load \(path)\n".data(using: .utf8)!)
    return false
  }
  let handler = VNImageRequestHandler(cgImage: cg, options: [:])
  do { try handler.perform([request]) } catch {
    FileHandle.standardError.write("ocr failed \(path)\n".data(using: .utf8)!)
    return false
  }
  guard let results = request.results else { return true }
  for observation in results {
    guard let candidate = observation.topCandidates(1).first else { continue }
    let box = observation.boundingBox
    let y = 1.0 - box.origin.y - box.size.height
    print(String(format: "%@\t%.4f\t%.4f\t%@", path, y, candidate.confidence, candidate.string))
  }
  return true
}

let request = VNRecognizeTextRequest()
request.recognitionLevel = .accurate
request.usesLanguageCorrection = true
request.recognitionLanguages = langs
request.minimumTextHeight = 0.008

var failed = 0
for path in args where !ocr(path, request) { failed += 1 }
exit(failed == 0 ? 0 : 1)

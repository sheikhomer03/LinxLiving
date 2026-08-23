// OCR image paths (stdin, one per line) and report both the recognised lines
// and the exact box of any occurrence of a search term inside them.
//
//   ls *.jpg | ocr2 porcelanosa
//
// TSV out: path  obs  kind(line|match)  text  x  y  w  h  confidence
// `obs` ties a match back to the line it was found in.
// Boxes are normalised with a TOP-left origin, ready for ffmpeg.
import Foundation
import Vision
import AppKit

let term = CommandLine.arguments.count > 1 ? CommandLine.arguments[1].lowercased() : ""

/** Levenshtein distance, for tolerating what OCR gets slightly wrong. */
func editDistance(_ a: [Character], _ b: [Character]) -> Int {
    if a.isEmpty { return b.count }
    if b.isEmpty { return a.count }
    var prev = Array(0...b.count)
    var cur = [Int](repeating: 0, count: b.count + 1)
    for i in 1...a.count {
        cur[0] = i
        for j in 1...b.count {
            let cost = a[i - 1] == b[j - 1] ? 0 : 1
            cur[j] = min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost)
        }
        swap(&prev, &cur)
    }
    return prev[b.count]
}

/**
 * Where `term` appears in `text`, allowing for a couple of wrong characters.
 *
 * An exact search is too brittle here: Vision reads a wordmark on a showroom
 * wall as "PO CELANOSA" often enough that exact matching walks past instances
 * that are perfectly legible on screen. Windows around the term's length are
 * scored by edit distance and the best non-overlapping ones kept.
 */
func occurrences(of term: String, in text: String) -> [(String.Index, String.Index)] {
    let needle = Array(term)
    let hay = Array(text.lowercased())
    guard !needle.isEmpty, hay.count >= needle.count - 2 else { return [] }
    let slack = 2
    let maxDistance = 2

    var scored: [(start: Int, end: Int, distance: Int)] = []
    for start in 0..<max(1, hay.count) {
        for length in max(1, needle.count - slack)...(needle.count + slack) {
            let end = start + length
            if end > hay.count { break }
            let d = editDistance(Array(hay[start..<end]), needle)
            if d <= maxDistance { scored.append((start, end, d)) }
        }
    }
    // Best match first, then drop anything overlapping one already taken.
    scored.sort { $0.distance != $1.distance ? $0.distance < $1.distance : ($0.end - $0.start) < ($1.end - $1.start) }
    var taken: [(Int, Int)] = []
    for m in scored where !taken.contains(where: { m.start < $0.1 && $0.0 < m.end }) {
        taken.append((m.start, m.end))
    }
    return taken.sorted { $0.0 < $1.0 }.compactMap { (s, e) in
        guard let lo = text.index(text.startIndex, offsetBy: s, limitedBy: text.endIndex),
              let hi = text.index(text.startIndex, offsetBy: e, limitedBy: text.endIndex) else { return nil }
        return (lo, hi)
    }
}

let out = FileHandle.standardOutput
func emit(_ f: [String]) { out.write((f.joined(separator: "\t") + "\n").data(using: .utf8)!) }
func clean(_ s: String) -> String { s.replacingOccurrences(of: "\t", with: " ") }

while let line = readLine() {
    let path = line.trimmingCharacters(in: .whitespacesAndNewlines)
    if path.isEmpty { continue }
    guard let img = NSImage(contentsOfFile: path),
          let cg = img.cgImage(forProposedRect: nil, context: nil, hints: nil) else { continue }

    let req = VNRecognizeTextRequest()
    req.recognitionLevel = .accurate
    req.usesLanguageCorrection = false
    req.recognitionLanguages = ["en-US", "es-ES"]
    let handler = VNImageRequestHandler(cgImage: cg, options: [:])
    do { try handler.perform([req]) } catch { continue }

    for (n, obs) in (req.results ?? []).enumerated() {
        guard let cand = obs.topCandidates(1).first else { continue }
        let s = cand.string
        let b = obs.boundingBox
        emit([path, "\(n)", "line", clean(s), "\(b.minX)", "\(1 - b.maxY)", "\(b.width)", "\(b.height)", "\(cand.confidence)"])
        if term.isEmpty { continue }

        // Every occurrence of the term, with its own quad from Vision.
        for (lo, hi) in occurrences(of: term, in: s) {
            guard let quad = try? cand.boundingBox(for: lo..<hi) else { continue }
            let xs = [quad.topLeft.x, quad.topRight.x, quad.bottomLeft.x, quad.bottomRight.x]
            let ys = [quad.topLeft.y, quad.topRight.y, quad.bottomLeft.y, quad.bottomRight.y]
            let minX = xs.min()!, maxX = xs.max()!, minY = ys.min()!, maxY = ys.max()!
            emit([path, "\(n)", "match", clean(String(s[lo..<hi])), "\(minX)", "\(1 - maxY)", "\(maxX - minX)", "\(maxY - minY)", "\(cand.confidence)"])
        }
    }
}

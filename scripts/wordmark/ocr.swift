// OCR image paths (stdin, one per line) and report both the recognised lines
// and the exact box of any occurrence of a search term inside them.
//
//   ls *.jpg | ocr "porcelanosa,cortizo,prowarm"
//
// Terms are comma-separated. A frame is searched for all of them, and the
// longest match wins where two overlap — "cambridge skylights" beats
// "cambridge", so the replacement covers the whole name rather than half of it.
//
// TSV out: path  obs  kind(line|match)  text  x  y  w  h  confidence  [term]
// A match row carries the term that produced it, so two different names in
// one frame are never mistaken for two readings of the same one.
// `obs` ties a match back to the line it was found in.
// Boxes are normalised with a TOP-left origin, ready for ffmpeg.
import Foundation
import Vision
import AppKit

let terms: [String] = (CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "")
    .lowercased()
    .split(separator: ",")
    .map { $0.trimmingCharacters(in: .whitespaces) }
    .filter { !$0.isEmpty }
    // Longest first, so an overlap resolves to the fuller name.
    .sorted { $0.count > $1.count }

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
 *
 * The tolerance has to scale with the name, though, or it stops meaning
 * anything. Two wrong characters in "porcelanosa" is a fifth of the word; two
 * in "krion" is nearly half, and at that point the search matches "ION",
 * "TONE" and "TARES" — all of which it did, and one of which reached a film
 * before this was caught. Short names are matched exactly.
 */
func occurrences(of term: String, in text: String) -> [(String.Index, String.Index)] {
    let needle = Array(term)
    let hay = Array(text.lowercased())
    let maxDistance = needle.count <= 6 ? 0 : (needle.count <= 10 ? 1 : 2)
    let slack = maxDistance
    guard !needle.isEmpty, hay.count >= needle.count - slack else { return [] }

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
        if terms.isEmpty { continue }

        // Every occurrence of every term, with its own quad from Vision.
        // Terms run longest-first and a hit is dropped if it overlaps one
        // already taken, so "cambridge skylights" claims the span before
        // "cambridge" can take half of it.
        var claimed: [(Int, Int)] = []
        var hits: [(term: String, lo: String.Index, hi: String.Index)] = []
        for term in terms {
            for (lo, hi) in occurrences(of: term, in: s) {
                let a = s.distance(from: s.startIndex, to: lo)
                let b = s.distance(from: s.startIndex, to: hi)
                if claimed.contains(where: { a < $0.1 && $0.0 < b }) { continue }
                claimed.append((a, b))
                hits.append((term, lo, hi))
            }
        }
        for (term, lo, hi) in hits.sorted(by: { $0.lo < $1.lo }) {
            guard let quad = try? cand.boundingBox(for: lo..<hi) else { continue }
            let xs = [quad.topLeft.x, quad.topRight.x, quad.bottomLeft.x, quad.bottomRight.x]
            let ys = [quad.topLeft.y, quad.topRight.y, quad.bottomLeft.y, quad.bottomRight.y]
            let minX = xs.min()!, maxX = xs.max()!, minY = ys.min()!, maxY = ys.max()!
            emit([path, "\(n)", "match", clean(String(s[lo..<hi])), "\(minX)", "\(1 - maxY)", "\(maxX - minX)", "\(maxY - minY)", "\(cand.confidence)", term])
        }
    }
}

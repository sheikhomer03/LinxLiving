// Build a frame-sized transparent PNG that patches out a burnt-in wordmark:
// an opaque rectangle in the sampled background colour, with the "LINX SQUARE"
// lockup drawn over it at the same ink height and centre as the text it
// replaces. ffmpeg then composites it with a single `overlay ... enable=`.
//
//   mkoverlay out.png W H rectX rectY rectW rectH bgHex inkX inkY inkW inkH textHex
import Foundation
import AppKit
import CoreText

let a = CommandLine.arguments
guard a.count >= 14 else {
    FileHandle.standardError.write("usage: mkoverlay out W H rx ry rw rh bgHex ix iy iw ih textHex\n".data(using: .utf8)!)
    exit(2)
}
let outPath = a[1]
let W = Int(a[2])!, H = Int(a[3])!
let rx = CGFloat(Double(a[4])!), ry = CGFloat(Double(a[5])!)
let rw = CGFloat(Double(a[6])!), rh = CGFloat(Double(a[7])!)
let bgHex = a[8]              // "none" leaves the fill to ffmpeg's delogo
let ix = CGFloat(Double(a[9])!), iy = CGFloat(Double(a[10])!)
let iw = CGFloat(Double(a[11])!), ih = CGFloat(Double(a[12])!)
let textHex = a[13]

func color(_ h: String) -> NSColor {
    var v: UInt64 = 0
    Scanner(string: h).scanHexInt64(&v)
    return NSColor(srgbRed: CGFloat((v >> 16) & 255) / 255, green: CGFloat((v >> 8) & 255) / 255,
                   blue: CGFloat(v & 255) / 255, alpha: 1)
}

let cs = CGColorSpaceCreateDeviceRGB()
guard let ctx = CGContext(data: nil, width: W, height: H, bitsPerComponent: 8, bytesPerRow: 0,
                          space: cs, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { exit(1) }
ctx.setAllowsAntialiasing(true)

// Caller works in top-left pixel coordinates; Core Graphics is bottom-left.
func flip(_ y: CGFloat, _ h: CGFloat) -> CGFloat { CGFloat(H) - y - h }

if bgHex != "none" {
    ctx.setFillColor(color(bgHex).cgColor)
    ctx.fill(CGRect(x: rx, y: flip(ry, rh), width: rw, height: rh))
}

// The lockup, per public/linxSquarelogo.svg: Georgia, "LINX" bold with
// "SQUARE" smaller and widely tracked on the same baseline.
let big: CGFloat = 300
let small = big * 0.458
let tracking = small * 0.42
let gap = big * 0.16
let fill = color(textHex)
let bold = NSFont(name: "Georgia-Bold", size: big) ?? NSFont.boldSystemFont(ofSize: big)
let plain = NSFont(name: "Georgia", size: small) ?? NSFont.systemFont(ofSize: small)
let a1 = NSAttributedString(string: "LINX", attributes: [.font: bold, .foregroundColor: fill])
let a2 = NSAttributedString(string: "SQUARE", attributes: [.font: plain, .foregroundColor: fill, .kern: tracking])
let l1 = CTLineCreateWithAttributedString(a1)
let l2 = CTLineCreateWithAttributedString(a2)
let b1 = CTLineGetBoundsWithOptions(l1, .useGlyphPathBounds)
let b2 = CTLineGetBoundsWithOptions(l2, .useGlyphPathBounds)
let x1 = -b1.minX
let x2 = x1 + b1.width + gap
let inkW = x2 + b2.width
let inkH = max(b1.maxY, b2.maxY) - min(b1.minY, b2.minY)
let minY = min(b1.minY, b2.minY)

// Match the replaced text's ink height, but never outrun its width — inside a
// line of body copy the replacement has to sit where the old word sat without
// running into its neighbours.
let scale = min(ih / inkH, iw / inkW)
ctx.saveGState()
ctx.translateBy(x: ix + iw / 2 - inkW * scale / 2, y: flip(iy + (ih - inkH * scale) / 2, inkH * scale))
ctx.scaleBy(x: scale, y: scale)
ctx.textPosition = CGPoint(x: x1, y: -minY)
CTLineDraw(l1, ctx)
ctx.textPosition = CGPoint(x: x2 - b2.minX, y: -minY)
CTLineDraw(l2, ctx)
ctx.restoreGState()

guard let img = ctx.makeImage(), let png = NSBitmapImageRep(cgImage: img).representation(using: .png, properties: [:]) else { exit(1) }
try png.write(to: URL(fileURLWithPath: outPath))

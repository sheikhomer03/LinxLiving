/**
 * Closes any tag a scraped supplier description left open.
 *
 * Several imported descriptions are lifted straight from a supplier's
 * "read more" widget (`<div class="c-reveal ..."><div class="c-cms ...">…`)
 * with no closing `</div>` for either wrapper — the source site's own JS
 * never needed one. Rendered as-is through `dangerouslySetInnerHTML`, the
 * *browser's* HTML parser silently closes them wherever it likes while
 * streaming the rest of the page, which can fold everything after the
 * description (the "Got a Question?" block, the tabs below it) into that
 * unclosed `<div>` — a real DOM-structure corruption, not just a console
 * warning, and the reason React's hydration check flags an element that was
 * never actually touched.
 *
 * This walks the tags in order, and appends whatever is left open at the
 * end — the minimal fix that makes the markup well-formed without altering
 * anything a balanced description already had.
 */

const VOID_ELEMENTS = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input",
  "link", "meta", "param", "source", "track", "wbr",
]);

const TAG_RE = /<\/?([a-zA-Z][a-zA-Z0-9]*)\b[^>]*?(\/?)>/g;

export function balanceHtmlTags(html: string): string {
  if (!html) return html;

  const stack: string[] = [];
  TAG_RE.lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = TAG_RE.exec(html))) {
    const [full, rawName, selfClosingMark] = match;
    const name = rawName.toLowerCase();
    if (VOID_ELEMENTS.has(name) || selfClosingMark === "/") continue;

    const isClosing = full.startsWith("</");
    if (!isClosing) {
      stack.push(name);
      continue;
    }

    // Closing tag: pop back to its matching opener, same as a browser's
    // forgiving parser — an out-of-order close (or one with no opener at
    // all) is dropped rather than left to throw the rest of the stack off.
    const openIndex = stack.lastIndexOf(name);
    if (openIndex !== -1) stack.length = openIndex;
  }

  if (!stack.length) return html;

  const closing = stack
    .slice()
    .reverse()
    .map((name) => `</${name}>`)
    .join("");
  return html + closing;
}

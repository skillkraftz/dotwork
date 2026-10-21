// A small XML reader, just enough for SVG files: elements, attributes and nesting. Text, comments, processing
// instructions and the doctype are skipped. It runs the same in the browser and in tests, and never executes anything.

export interface XmlNode { name: string; attrs: Record<string, string>; children: XmlNode[] }

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const decode = (s: string) => s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e: string) => {
  if (e[0] === '#') {
    const code = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m;
  }
  return ENTITIES[e] ?? m;
});

const MAX_DEPTH = 100;

/** The root element of an XML document; throws an Error with a plain reason when the text is not well-formed. */
export function parseXml(text: string): XmlNode {
  const root: XmlNode = { name: '#document', attrs: {}, children: [] };
  const stack: XmlNode[] = [root];
  const tag = /<(!--[\s\S]*?--|!\[CDATA\[[\s\S]*?\]\]|![^>[]*(?:\[[\s\S]*?\])?[^>]*|\?[\s\S]*?\?|\/\s*([^\s>]+)\s*|([^\s/>]+)((?:\s+[^\s=/>]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'>]+))?)*)\s*(\/?))>/g;
  const attr = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
  let m: RegExpExecArray | null;
  while ((m = tag.exec(text))) {
    if (m[2] !== undefined) { // closing tag
      const top = stack.pop();
      if (!top || stack.length === 0 || top.name !== local(m[2])) throw new Error(`The closing tag </${m[2]}> doesn't match an opening tag.`);
    } else if (m[3] !== undefined) {
      const node: XmlNode = { name: local(m[3]), attrs: {}, children: [] };
      for (const a of m[4].matchAll(attr)) node.attrs[a[1]] = decode(a[2] ?? a[3] ?? a[4] ?? '');
      stack[stack.length - 1].children.push(node);
      if (!m[5]) {
        stack.push(node);
        if (stack.length > MAX_DEPTH) throw new Error('The elements are nested too deeply.');
      }
    }
  }
  if (stack.length !== 1) throw new Error(`The element <${stack[stack.length - 1].name}> is never closed.`);
  const svg = root.children.find((c) => c.name === 'svg');
  if (!svg) throw new Error('There is no <svg> element in the file.');
  return svg;
}

/** A tag name without its namespace prefix: svg:path is path. */
const local = (name: string) => name.slice(name.indexOf(':') + 1);

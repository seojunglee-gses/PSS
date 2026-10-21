// Lightweight Markdown stored in the existing text field; legacy plain text stays valid.
export type TextSection = { kind: "p" | "h2" | "h3"; size: number; text: string };
export function parseSections(value: string): TextSection[] {
  const parts: string[] = [];
  let start = 0;
  while (start <= value.length) {
    let end = value.indexOf("\n\n", start);
    if (/^<span data-font-size="(14|16|20|24)">/.test(value.slice(start))) {
      const closing = value.indexOf("</span>", start);
      if (closing >= 0) end = value.indexOf("\n\n", closing + 7);
    }
    if (end < 0) { parts.push(value.slice(start)); break; }
    parts.push(value.slice(start, end));
    start = end + 2;
    while (value[start] === "\n") start++;
  }
  return parts.map((part) => {
    const sized = part.match(/^<span data-font-size="(14|16|20|24)">([\s\S]*)<\/span>$/);
    const text = sized?.[2] ?? part;
    const heading = text.match(/^(#{1,2}) ([\s\S]*)$/);
    return { kind: heading ? heading[1].length === 1 ? "h2" : "h3" : "p", size: sized ? Number(sized[1]) : heading ? heading[1].length === 1 ? 24 : 20 : 16, text: heading?.[2] ?? text };
  });
}
export function serializeSections(sections: TextSection[]) {
  return sections.map(({ kind, size, text }) => {
    const value = `${kind === "h2" ? "# " : kind === "h3" ? "## " : ""}${text}`;
    return size === (kind === "h2" ? 24 : kind === "h3" ? 20 : 16) ? value : `<span data-font-size="${size}">${value}</span>`;
  }).join("\n\n");
}
export function inlineHtml(text: string) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>").replace(/\n/g, "<br>");
}
export function imageList(value: string = "") {
  return value.split(/\r?\n/).map((url) => url.trim()).filter((url) => /^(https?:\/\/|\/|data:image\/(?:png|jpeg|gif|webp);base64,)/i.test(url));
}

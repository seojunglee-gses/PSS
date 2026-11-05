export type ChatBlock = { kind: "text"; text: string } | {
  kind: "table"; headers: string[]; rows: string[][]; align: ("left" | "center" | "right")[];
};

function cells(line: string): string[] {
  const result: string[] = []; let value = "";
  for (let i = 0; i < line.length; i++) {
    if (line[i] === "\\" && line[i + 1] === "|") { value += "|"; i++; }
    else if (line[i] === "|") { result.push(value.trim()); value = ""; }
    else value += line[i];
  }
  result.push(value.trim());
  if (line.trimStart().startsWith("|")) result.shift();
  if (line.trimEnd().endsWith("|") && !line.trimEnd().endsWith("\\|")) result.pop();
  return result;
}
const divider = (row: string[]) => row.length > 0 && row.every(cell => /^:?-{3,}:?$/.test(cell));

export function chatBlocks(text: string): ChatBlock[] {
  const lines: string[] = []; let fenced = false;
  for (const original of text.replace(/\r\n?/g, "\n").split("\n")) {
    if (/^\s*(```|~~~)/.test(original)) fenced = !fenced;
    // Recover a flattened table only when the complete rectangular structure is clear.
    const line = original.replace(/^\s*\\\|/, "|");
    const candidate = !fenced && /\|\s*:?-{3,}:?\s*\|/.test(line) ? line.split(/\|[ \t]+\|/).map((part, i, all) => `${i ? "|" : ""}${part}${i < all.length - 1 ? "|" : ""}`) : [];
    if (candidate.length >= 2 && divider(cells(candidate[1])) && candidate.every(row => cells(row).length === cells(candidate[0]).length)) lines.push(...candidate);
    else lines.push(original);
  }
  const blocks: ChatBlock[] = []; let pending: string[] = []; fenced = false;
  const flush = () => { if (pending.length) { blocks.push({ kind: "text", text: pending.join("\n") }); pending = []; } };
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*(```|~~~)/.test(lines[i])) { fenced = !fenced; pending.push(lines[i]); continue; }
    const headers = cells(lines[i]), separators = cells(lines[i + 1] ?? "");
    if (!fenced && lines[i].includes("|") && headers.length === separators.length && divider(separators)) {
      flush(); const rows: string[][] = [];
      i++;
      while (i + 1 < lines.length && lines[i + 1].includes("|") && cells(lines[i + 1]).length === headers.length) rows.push(cells(lines[++i]));
      blocks.push({ kind: "table", headers, rows, align: separators.map(cell => cell.endsWith(":") ? cell.startsWith(":") ? "center" : "right" : "left") });
    } else pending.push(lines[i]);
  }
  flush(); return blocks;
}

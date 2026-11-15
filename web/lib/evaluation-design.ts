export type EvaluationDesignDescription = {
  elements: { text: string; origin: "participant" | "ai" | "unknown" }[];
  editRequests: string[];
  status: "ready" | "missing" | "error";
  historyIncomplete?: boolean;
  aspectRatio?: number;
};

const internal = /DESIGN TRANSLATION|PHOTO-BASED URBAN DESIGN|RESIDENT-LED IMAGE SCOPE|Confirmed resident-reviewed direction|"(?:origin|basis|interventions|residentBrief)"\s*:/i;
export function readableDesignText(value: unknown, max = 4000): string | undefined {
  return typeof value === "string" && value.trim() && value.length <= max && !internal.test(value) ? value.trim() : undefined;
}
export function designElements(value: unknown): EvaluationDesignDescription["elements"] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value.flatMap(item => {
    const text = readableDesignText(item?.text, 500);
    if (!text || seen.has(text)) return [];
    seen.add(text);
    return [{ text, origin: item.origin === "participant" ? "participant" as const : item.origin === "ai" ? "ai" as const : "unknown" as const }];
  });
}

// Read only known JSON sections in legacy prompts. Never display the surrounding prompt.
function jsonAfter(note: string, marker: string): unknown {
  const index = note.indexOf(marker); if (index < 0) return undefined;
  const text = note.slice(index + marker.length).trimStart();
  if (text[0] !== "[" && text[0] !== "{") return undefined;
  let depth = 0, quoted = false, escaped = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) { if (escaped) escaped = false; else if (c === "\\") escaped = true; else if (c === '"') quoted = false; continue; }
    if (c === '"') quoted = true;
    else if (c === "[" || c === "{") depth++;
    else if (c === "]" || c === "}") { if (--depth === 0) { try { return JSON.parse(text.slice(0, i + 1)); } catch { return undefined; } } }
  }
  return undefined;
}
export function legacyDesignElements(note: unknown): EvaluationDesignDescription["elements"] {
  if (typeof note !== "string") return [];
  const input = jsonAfter(note, "RESIDENT DESIGN INPUT:") as { direction?: { interventions?: unknown } } | undefined;
  const current = designElements(input?.direction?.interventions); if (current.length) return current;
  for (const marker of ["Confirmed resident-reviewed direction:", "Existing design context (context only, not a request to redraw it):"]) {
    const elements = designElements(jsonAfter(note, marker)); if (elements.length) return elements;
  }
  return [];
}
export function legacyEditRequest(note: unknown): string | undefined {
  if (typeof note !== "string") return undefined;
  for (const marker of ["User's edit request: ", "Latest resident edit request: "]) {
    const index = note.lastIndexOf(marker);
    if (index >= 0) return readableDesignText(note.slice(index + marker.length));
  }
  return undefined;
}

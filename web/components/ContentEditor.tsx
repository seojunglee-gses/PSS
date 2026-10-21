import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { inlineHtml, parseSections, serializeSections, type TextSection } from "../lib/content-format";

export function editableText(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? "";
  const element = node as HTMLElement;
  if (element.tagName === "BR") return "\n";
  const text = Array.from(node.childNodes).map(editableText).join("");
  if (element.tagName === "STRONG" || element.tagName === "B") return `**${text}**`;
  return text + (element.tagName === "DIV" || element.tagName === "P" ? "\n" : "");
}
function SectionInput({ section, onChange, index, disabled }: { disabled: boolean; section: TextSection; onChange: (text: string) => void; index: number }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (ref.current && document.activeElement !== ref.current) ref.current.innerHTML = inlineHtml(section.text);
  }, [section.text]);
  const update = () => { if (ref.current) onChange(Array.from(ref.current.childNodes).map(editableText).join("").replace(/\n$/, "")); };
  return <div ref={ref} role="textbox" aria-label={`본문 ${index + 1}`} aria-multiline="true" contentEditable={!disabled} suppressContentEditableWarning
    className="min-h-24 whitespace-pre-wrap rounded-lg bg-white p-3 leading-relaxed outline-none focus:ring-2 focus:ring-blue-200"
    style={{ fontSize: section.size, fontWeight: section.kind === "p" ? 400 : 600 }} onInput={update} onBlur={update}
    onPaste={(event) => { event.preventDefault(); document.execCommand("insertText", false, event.clipboardData.getData("text/plain")); update(); }} />;
}
export type ContentEditorHandle = { getValue: () => string };
const ContentEditor = forwardRef<ContentEditorHandle, { value: string; onChange: (value: string) => void; label: string; disabled?: boolean }>(function ContentEditor({ value, onChange, label, disabled = false }, forwardedRef) {
  const root = useRef<HTMLFieldSetElement>(null);
  const [draft, setDraft] = useState(() => ({ value, sections: parseSections(value) }));
  if (draft.value !== value) setDraft({ value, sections: parseSections(value) });
  const sections = draft.sections;
  const emit = (next: TextSection[]) => {
    const formatted = serializeSections(next);
    setDraft({ value: formatted, sections: next });
    onChange(formatted);
  };
  useImperativeHandle(forwardedRef, () => ({ getValue: () => {
    const fields = root.current?.querySelectorAll<HTMLElement>('[role="textbox"]');
    return serializeSections(sections.map((section, index) => ({ ...section, text: fields?.[index]
      ? Array.from(fields[index].childNodes).map(editableText).join("").replace(/\n$/, "") : section.text })));
  } }), [sections]);
  const update = (index: number, patch: Partial<TextSection>) => emit(sections.map((section, i) => i === index ? { ...section, ...patch } : section));
  return <fieldset disabled={disabled} ref={root} className="content-editor mt-4 w-full min-w-0 space-y-3 border-0 p-0" aria-label={label}>
    {sections.map((section, index) => <div key={index} className="rounded-xl border border-slate-200 bg-slate-50 p-2">
      <div className="mb-2 flex flex-wrap items-center gap-2" role="group" aria-label={`문단 ${index + 1} 서식`}>
        <select aria-label="문단 스타일" value={section.kind} onChange={(event) => update(index, { kind: event.target.value as TextSection["kind"], size: event.target.value === "h2" ? 24 : event.target.value === "h3" ? 20 : 16 })}>
          <option value="p">본문</option><option value="h2">제목</option><option value="h3">소제목</option>
        </select>
        <select aria-label="글자 크기" value={section.size} onChange={(event) => update(index, { size: Number(event.target.value) })}>
          {[14, 16, 20, 24].map((size) => <option key={size} value={size}>{size}px</option>)}
        </select>
        <button type="button" aria-label="굵게" className="font-bold" onPointerDown={(event) => event.preventDefault()}
          onClick={() => { document.execCommand("bold"); }}>굵게</button>
        {sections.length > 1 && <button type="button" onClick={() => emit(sections.filter((_, i) => i !== index))}>문단 삭제</button>}
      </div>
      <SectionInput section={section} index={index} disabled={disabled} onChange={(text) => update(index, { text })} />
    </div>)}
    <button type="button" className="rounded-full border border-slate-200 px-4 py-2 text-sm" onClick={() => emit([...sections, { kind: "p", size: 16, text: "" }])}>+ 문단 추가</button>
  </fieldset>;
});
export default ContentEditor;
export function ContentText({ value }: { value: string }) {
  return <div className="content-text mt-4 space-y-3 text-sm leading-relaxed text-slate-600">{parseSections(value).map((section, index) => {
    const Tag = section.kind;
    return <Tag key={index} style={{ fontSize: section.size }}
      className={`whitespace-pre-wrap ${section.kind === "p" ? "" : "font-semibold text-slate-800"}`} dangerouslySetInnerHTML={{ __html: inlineHtml(section.text) }} />;
  })}</div>;
}

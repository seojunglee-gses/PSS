import { Fragment, type ReactNode } from "react";
import { chatBlocks } from "../../lib/chat-format";
import { useI18n } from "../../lib/i18n";

export default function ChatMessageContent({ text, renderInline = value => value }: { text: string; renderInline?: (text: string) => ReactNode }) {
  const { t } = useI18n();
  const inline = (value: string) => value.split(/(\*\*[^*]+\*\*)/g).map((part, index) => part.startsWith("**") && part.endsWith("**")
    ? <strong key={index}>{renderInline(part.slice(2, -2))}</strong>
    : <Fragment key={index}>{renderInline(part)}</Fragment>);
  return <div className="min-w-0 max-w-full space-y-2">{chatBlocks(text).map((block, index) => block.kind === "text"
    ? <p key={index} className="whitespace-pre-line">{inline(block.text)}</p>
    : <div key={index} role="region" aria-label={t("workspace.answerTable")} tabIndex={0} className="max-w-full overflow-x-auto overscroll-contain rounded-lg border border-slate-200">
      <table className="w-full min-w-[420px] border-collapse text-left text-sm">
        <thead className="bg-slate-100"><tr>{block.headers.map((cell, col) => <th key={col} scope="col" style={{ textAlign: block.align[col] }} className="min-w-[120px] border-b border-slate-200 px-3 py-2 font-semibold [overflow-wrap:anywhere]">{inline(cell)}</th>)}</tr></thead>
        <tbody>{block.rows.map((row, n) => <tr key={n} className="border-b border-slate-200 last:border-b-0">{row.map((cell, col) => <td key={col} style={{ textAlign: block.align[col] }} className="px-3 py-2 align-top whitespace-pre-line [overflow-wrap:anywhere]">{inline(cell)}</td>)}</tr>)}</tbody>
      </table>
    </div>)}</div>;
}

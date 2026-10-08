export function formatPlainTextItems(
  headers: string[],
  rows: string[][],
): string {
  const formatValue = (value: string) => value
    .replace(/\r?\n/g, " ")
    .trim();
  return rows.map((row, rowIndex) => [
    `MẶT HÀNG ${rowIndex + 1}`,
    ...headers.map((header, columnIndex) =>
      `${header}: ${formatValue(row[columnIndex] || "—")}`,
    ),
  ].join("\r\n")).join("\r\n\r\n");
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character] ?? character);
}

export function buildHtmlEmail(
  paragraphs: string[],
  headers: string[],
  rows: string[][],
) {
  const headerCells = headers.map((header) =>
    `<th style="border:1px solid #cbd5ce;background:#edf4ef;padding:8px;text-align:left;font-weight:700;">${escapeHtml(header)}</th>`,
  ).join("");
  const tableRows = rows.map((row) =>
    `<tr>${headers.map((_, index) =>
      `<td style="border:1px solid #cbd5ce;padding:8px;vertical-align:top;">${escapeHtml(row[index] || "—")}</td>`,
    ).join("")}</tr>`,
  ).join("");
  const content = paragraphs.map((paragraph) =>
    `<p style="margin:0 0 12px;">${escapeHtml(paragraph)}</p>`,
  ).join("");
  return `<html><body style="font-family:Arial,sans-serif;font-size:14px;color:#26352b;line-height:1.5;">${content}<table style="width:100%;border-collapse:collapse;margin:16px 0;">${headerCells ? `<thead><tr>${headerCells}</tr></thead>` : ""}<tbody>${tableRows}</tbody></table></body></html>`;
}

export async function copyHtmlEmailToClipboard(html: string, plainText: string) {
  if (!navigator.clipboard?.write || typeof ClipboardItem === "undefined") {
    throw new Error("Trình duyệt không hỗ trợ sao chép nội dung email dạng HTML. Hãy dùng Chrome hoặc Edge trên HTTPS.");
  }
  await navigator.clipboard.write([
    new ClipboardItem({
      "text/html": new Blob([html], { type: "text/html" }),
      "text/plain": new Blob([plainText], { type: "text/plain" }),
    }),
  ]);
}

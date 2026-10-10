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

export interface AttachmentLink {
  name: string;
  url: string;
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
): string {
  const headerCells = headers.map((header) =>
    `<th style="border:1px solid #c5d6cb;background:linear-gradient(180deg,#e8f5ed,#d9ebe0);padding:9px 11px;text-align:left;font-weight:700;font-size:13px;color:#183827;">${escapeHtml(header)}</th>`,
  ).join("");
  const tableRows = rows.map((row, rowIndex) =>
    `<tr style="${rowIndex % 2 === 0 ? "background:#ffffff;" : "background:#f6faf7;"}">${headers.map((_, index) =>
      `<td style="border:1px solid #dfe8e2;padding:8px 11px;vertical-align:top;font-size:12.5px;line-height:1.45;color:#26372d;">${escapeHtml(row[index] || "—")}</td>`,
    ).join("")}</tr>`,
  ).join("");
  const content = paragraphs.map((paragraph) =>
    `<p style="margin:0 0 12px;font-size:14px;line-height:1.55;color:#1f3328;">${escapeHtml(paragraph)}</p>`,
  ).join("");
  return `<html><body style="font-family:Arial,'Segoe UI',Helvetica,sans-serif;font-size:14px;color:#1f3328;line-height:1.55;background:#ffffff;margin:0;padding:20px;">
    <div style="max-width:960px;margin:0 auto;">
      ${content}
      <table style="width:100%;border-collapse:collapse;margin:18px 0 8px;border-radius:10px;overflow:hidden;box-shadow:0 1px 3px #173d2810;border:1px solid #dfe8e2;">
        ${headerCells ? `<thead><tr>${headerCells}</tr></thead>` : ""}
        <tbody>${tableRows}</tbody>
      </table>
    </div>
  </body></html>`;
}

export function buildGroupedSupplierEmail(
  paragraphs: string[],
  headers: string[],
  groups: Array<{
    supplierName: string;
    submitInfo?: string;
    rows: string[][];
    attachments?: AttachmentLink[];
  }>,
): string {
  const headerCells = headers.map((header) =>
    `<th style="border:1px solid #c5d6cb;background:#d9ebe0;padding:9px 11px;text-align:left;font-weight:700;font-size:13px;color:#183827;">${escapeHtml(header)}</th>`,
  ).join("");
  const sections = groups.map((group, groupIndex) => {
    const bodyRows = group.rows.map((row, rowIndex) =>
      `<tr style="${rowIndex % 2 === 0 ? "background:#ffffff;" : "background:#f6faf7;"}">${headers.map((_, index) =>
        `<td style="border:1px solid #dfe8e2;padding:8px 11px;vertical-align:top;font-size:12.5px;line-height:1.45;color:#26372d;">${escapeHtml(row[index] || "—")}</td>`,
      ).join("")}</tr>`,
    ).join("");
    const attachmentsHtml = group.attachments && group.attachments.length > 0
      ? `<div style="margin-top:10px;padding:10px 14px;background:#fffaf2;border:1px solid #f2e6cb;border-radius:8px;font-size:12.5px;line-height:1.7;">
        <strong style="color:#7e5a12;">📎 File đính kèm ${group.supplierName}:</strong><br/>
        ${group.attachments.map((att) =>
          `<span style="display:inline-block;margin-right:14px;margin-top:4px;">📄 <a href="${escapeHtml(att.url)}" target="_blank" style="color:#1a5ea8;text-decoration:none;font-weight:600;" rel="noopener noreferrer">${escapeHtml(att.name)}</a></span>`,
        ).join("")}
      </div>`
      : "";
    return `<div style="margin:${groupIndex === 0 ? "0" : "18px 0 0"};">
      <table cellspacing="0" cellpadding="0" style="border-spacing:0;width:100%;border-collapse:collapse;margin:0;border-radius:10px;overflow:hidden;box-shadow:0 2px 6px #173d2810;border:1px solid #dfe8e2;">
        <thead>
          <tr style="background:linear-gradient(135deg,#16734d,#0f573a);">
            <th colspan="${headers.length}" style="padding:11px 14px;text-align:left;color:#ffffff;font-weight:700;font-size:14px;border:0;">
              🏢 ${escapeHtml(group.supplierName)}${group.submitInfo ? `<span style="opacity:0.85;font-weight:400;font-size:12px;margin-left:10px;">${escapeHtml(group.submitInfo)}</span>` : ""}
            </th>
          </tr>
          ${headerCells ? `<tr style="background:linear-gradient(180deg,#e8f5ed,#d9ebe0);">${headerCells}</tr>` : ""}
        </thead>
        <tbody>${bodyRows.length ? bodyRows : `<tr><td colspan="${headers.length}" style="padding:12px;text-align:center;color:#7a8981;font-style:italic;border:1px solid #dfe8e2;">(Không có dòng hàng)</td></tr>`}</tbody>
      </table>
      ${attachmentsHtml}
    </div>`;
  }).join("");
  const content = paragraphs.map((paragraph) =>
    `<p style="margin:0 0 12px;font-size:14px;line-height:1.55;color:#1f3328;">${escapeHtml(paragraph)}</p>`,
  ).join("");
  return `<html><body style="font-family:Arial,'Segoe UI',Helvetica,sans-serif;font-size:14px;color:#1f3328;line-height:1.55;background:#ffffff;margin:0;padding:20px;">
    <div style="max-width:1000px;margin:0 auto;">
      ${content}
      ${sections}
      <p style="margin-top:18px;font-size:13px;color:#5a6c62;">
        Nguồn: Tổng hợp từ hệ thống đăng ký giao hàng ExpressInfo · ${new Date().toLocaleString("vi-VN")}
      </p>
    </div>
  </body></html>`;
}

export function formatGroupedPlainEmail(
  paragraphs: string[],
  headers: string[],
  groups: Array<{
    supplierName: string;
    submitInfo?: string;
    rows: string[][];
    attachments?: AttachmentLink[];
  }>,
): string {
  const sections = groups.map((group) => [
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
    `🏢 NHÀ CUNG CẤP: ${group.supplierName}${group.submitInfo ? ` (${group.submitInfo})` : ""}`,
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
    formatPlainTextItems(headers, group.rows),
    ...(group.attachments && group.attachments.length > 0
      ? [
          "",
          `📎 File đính kèm:`,
          ...group.attachments.map((att) => `  · ${att.name}: ${att.url}`),
        ]
      : []),
  ].join("\r\n"));
  return [
    ...paragraphs,
    "",
    ...sections,
    "",
    `— Nguồn: ExpressInfo · ${new Date().toLocaleString("vi-VN")} —`,
  ].join("\r\n");
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

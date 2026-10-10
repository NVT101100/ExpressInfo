import { useEffect, useState } from "react";
import { DELIVERY_GROUP, EXCEL_TEMPLATE } from "../config";
import { formatDate, statusLabels } from "../lib/delivery";
import { buildGroupedSupplierEmail, copyHtmlEmailToClipboard, formatGroupedPlainEmail, type AttachmentLink } from "../lib/email";
import type {
  DeliveryItem,
  DeliveryRequest,
  MentionTarget,
  RequestStatus,
} from "../types";
import Pagination from "./Pagination";
import ItemsEditor from "./ItemsEditor";

const LIST_PAGE_SIZE = 10;
const EMAIL_LIST_PAGE_SIZE = 20;

interface RequestDetailProps {
  request: DeliveryRequest;
  admin: boolean;
  supplierName: string;
  items: DeliveryItem[];
  saving: boolean;
  highlightTarget?: MentionTarget | null;
  onBack: () => void;
  onSupplierName: (value: string) => void;
  onItemChange: (index: number, key: string, value: string) => void;
  onRemoveItem: (index: number) => void;
  planFileName: string;
  introductionFileName: string;
  onPlanFile: (file?: File) => void;
  onDownloadTemplate: () => void;
  onIntroductionFile: (file?: File) => void;
  onSave: () => void;
  onStatus: (status: RequestStatus) => void;
  onDelete: () => void;
}

export default function RequestDetail({
  request,
  admin,
  supplierName,
  items,
  saving,
  highlightTarget = null,
  onBack,
  onSupplierName,
  onItemChange,
  onRemoveItem,
  planFileName,
  introductionFileName,
  onPlanFile,
  onDownloadTemplate,
  onIntroductionFile,
  onSave,
  onStatus,
  onDelete,
}: RequestDetailProps) {
  const disabled = request.deleted || saving;
  const [receiverEmail, setReceiverEmail] = useState("");
  const [emailCopyMessage, setEmailCopyMessage] = useState("");
  const [selectedEmailRows, setSelectedEmailRows] = useState<Set<number>>(
    () => new Set(items.map((_, index) => index)),
  );
  const [emailRowsPage, setEmailRowsPage] = useState(0);
  const [revisionPage, setRevisionPage] = useState(0);
  const revisions = [...request.revisions].reverse();
  const visibleRevisions = revisions.slice(revisionPage * LIST_PAGE_SIZE, (revisionPage + 1) * LIST_PAGE_SIZE);
  const visibleEmailRowItems = items.slice(emailRowsPage * EMAIL_LIST_PAGE_SIZE, (emailRowsPage + 1) * EMAIL_LIST_PAGE_SIZE);

  useEffect(() => {
    setReceiverEmail("");
    setEmailRowsPage(0);
    setRevisionPage(0);
  }, [request.id]);

  useEffect(() => {
    setSelectedEmailRows(new Set(items.map((_, index) => index)));
  }, [request.id, items.length]);

  useEffect(() => {
    if (emailRowsPage * EMAIL_LIST_PAGE_SIZE >= items.length) {
      setEmailRowsPage(Math.max(0, Math.ceil(items.length / EMAIL_LIST_PAGE_SIZE) - 1));
    }
  }, [items.length, emailRowsPage]);

  useEffect(() => {
    if (revisionPage >= Math.ceil(request.revisions.length / LIST_PAGE_SIZE)) {
      setRevisionPage(Math.max(0, Math.ceil(request.revisions.length / LIST_PAGE_SIZE) - 1));
    }
  }, [request.revisions.length, revisionPage]);

  useEffect(() => {
    if (!highlightTarget || highlightTarget.requestId !== request.id) return;
    const targetId = highlightTarget.field === "item"
      ? `request-item-${highlightTarget.itemIndex}-${highlightTarget.itemKey}`
      : `request-field-${highlightTarget.field}`;
    const target = document.getElementById(targetId);
    if (!target) return;
    target.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
    target.classList.add("mention-highlight");
    const timeout = window.setTimeout(() => target.classList.remove("mention-highlight"), 5000);
    return () => window.clearTimeout(timeout);
  }, [highlightTarget, request.id]);

  const emailRows = items
    .map((item, index) => ({ item, index }))
    .filter(({ index }) => selectedEmailRows.has(index));
  const emailSubject = `Danh sách dự kiến giao hàng - ${request.supplierName}`;

  const attachmentList: AttachmentLink[] = [];
  if (request.attachments?.deliveryPlan) attachmentList.push(request.attachments.deliveryPlan);
  if (request.attachments?.companyIntroduction) attachmentList.push(request.attachments.companyIntroduction);

  const emailParagraphs = [
    "Kính gửi bộ phận nhận hàng,",
    "",
    `Dưới đây là danh sách hàng hóa dự kiến giao hàng từ nhà cung cấp ${request.supplierName}.`,
    `Trạng thái phiếu: ${statusLabels[request.status]} · Giờ gửi: ${formatDate(request.createdAt)}.`,
    "Chi tiết hàng hóa:",
  ];

  const emailBody = formatGroupedPlainEmail(
    emailParagraphs,
    EXCEL_TEMPLATE.columns.map((column) => column.label),
    [
      {
        supplierName: request.supplierName,
        submitInfo: `${statusLabels[request.status]} · Người gửi: ${request.ownerEmail}`,
        rows: emailRows.map(({ item }) => EXCEL_TEMPLATE.columns.map((column) => item[column.key] ?? "")),
        attachments: attachmentList,
      },
    ],
  );
  const emailHtml = buildGroupedSupplierEmail(
    emailParagraphs,
    EXCEL_TEMPLATE.columns.map((column) => column.label),
    [
      {
        supplierName: request.supplierName,
        submitInfo: `${statusLabels[request.status]} · Người gửi: ${request.ownerEmail} · Gửi ${formatDate(request.createdAt)}`,
        rows: emailRows.map(({ item }) => EXCEL_TEMPLATE.columns.map((column) => item[column.key] ?? "")),
        attachments: attachmentList,
      },
    ],
  );
  const validReceiverEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(receiverEmail.trim());
  const encodeQueryValue = (value: string) => encodeURIComponent(value)
    .replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
  const outlookComposeHref = validReceiverEmail && emailRows.length > 0
    ? `https://outlook.office.com/mail/deeplink/compose?to=${encodeQueryValue(receiverEmail.trim())}&subject=${encodeQueryValue(emailSubject)}`
    : undefined;
  const mailtoHref = validReceiverEmail && emailRows.length > 0
    ? `mailto:${receiverEmail.trim()}?subject=${encodeQueryValue(emailSubject)}`
    : undefined;
  async function copyRichEmail() {
    try {
      await copyHtmlEmailToClipboard(emailHtml, emailBody);
      setEmailCopyMessage("Đã sao chép nội dung có bảng HTML. Mở Outlook và dán vào nội dung thư (Ctrl+V).");
    } catch (cause) {
      setEmailCopyMessage(cause instanceof Error ? cause.message : "Không sao chép được nội dung email.");
    }
  }

  return (
    <div className="detail-page">
      <button className="back-link" onClick={onBack}>← Quay lại danh sách</button>
      <div className="page-heading detail-heading">
        <div>
          <p className="eyebrow">{admin ? "CHI TIẾT PHIẾU" : "LỊCH SỬ ĐĂNG KÝ"}</p>
          <h1>{request.supplierName}</h1>
          <p className="muted">{request.ownerEmail} · Gửi {formatDate(request.createdAt)}</p>
        </div>
        <div className="detail-status-stack">
          <span className={`status status-${request.status}`}>{statusLabels[request.status]}</span>
        </div>
      </div>
      <div className="panel detail-panel">
        <div className="section-title">
          <span className="step">01</span>
          <div><h2>Thông tin đăng ký giao hàng</h2><p>Các chỉnh sửa được ghi vào lịch sử riêng, không ghi đè phiếu gốc.</p></div>
        </div>
        <div className="form-fields-grid">
          <label className="field">
            <span className="field-label">Tên nhà cung cấp</span>
            <input id="request-field-supplierName" className="text-input" value={supplierName} onChange={(event) => onSupplierName(event.target.value)} disabled={disabled} required />
          </label>
          <label className="field">
            <span className="field-label">Nhóm hàng hóa</span>
            <input className="text-input" value={request.deliveryGroup || DELIVERY_GROUP} readOnly />
          </label>
        </div>
        <section className="request-attachments">
          <strong>File đính kèm</strong>
          {request.attachments?.deliveryPlan
            ? <div className="request-attachment-link"><span>File kế hoạch: {request.attachments.deliveryPlan.name}</span><a className="button table-action" href={request.attachments.deliveryPlan.url} target="_blank" rel="noopener noreferrer">Mở file ↗</a></div>
            : <span className="muted small">Chưa có file kế hoạch.</span>}
          {request.attachments?.companyIntroduction
            ? <div className="request-attachment-link"><span>Giấy giới thiệu: {request.attachments.companyIntroduction.name}</span><a className="button table-action" href={request.attachments.companyIntroduction.url} target="_blank" rel="noopener noreferrer">Mở file ↗</a></div>
            : <span className="muted small">Chưa có giấy giới thiệu.</span>}
        </section>
        <div className="section-title detail-items-title">
          <span className="step">02</span>
          <div><h2>Danh sách hàng hóa</h2><p>{items.length} dòng · Nhập trực tiếp để chỉnh sửa.</p></div>
        </div>
        {!admin && !request.deleted && (
          <>
          <div className="supplier-plan-upload edit-items-upload">
            <label className="upload-zone">
              <input type="file" accept=".xlsx" disabled={saving} onChange={(event) => {
                onPlanFile(event.target.files?.[0]);
                event.currentTarget.value = "";
              }} />
              <span className="upload-icon">↑</span>
              <strong>{planFileName || "Thay file kế hoạch giao hàng (.xlsx)"}</strong>
              <span className="muted small">File mới sẽ được lưu lên Drive khi lưu phiếu.</span>
            </label>
            <button type="button" className="button secondary" onClick={onDownloadTemplate}>↓ Tải file Excel mẫu</button>
          </div>
          <label className="upload-zone edit-items-upload">
            <input type="file" accept=".pdf,.doc,.docx,.jpg,.jpeg,.png" disabled={saving} onChange={(event) => {
              onIntroductionFile(event.target.files?.[0]);
              event.currentTarget.value = "";
            }} />
            <span className="upload-icon">↑</span>
            <strong>{introductionFileName || "Thay giấy giới thiệu của công ty"}</strong>
            <span className="muted small">PDF, Word hoặc ảnh · tải lên Drive khi lưu.</span>
          </label>
          </>
        )}
        <ItemsEditor items={items} onChange={onItemChange} onRemove={onRemoveItem} highlightTarget={highlightTarget} disabled={disabled} />
        {admin && !request.deleted && (
          <section className="email-draft-panel" aria-label="Soạn email thông báo giao hàng">
            <div className="section-title">
              <span className="step">✉</span>
              <div>
                <h2>Soạn email danh sách dự kiến giao hàng</h2>
                <p>Mở Outlook bằng liên kết soạn thư, rồi bấm “Sao chép email” và dán vào nội dung thư để giữ bảng có định dạng. Cần đăng nhập Outlook; kiểm tra nội dung trước khi gửi.</p>
              </div>
            </div>
            <label className="field email-recipient-field">
              <span className="field-label">Email bên nhận hàng</span>
              <input
                className="text-input"
                type="email"
                autoComplete="email"
                placeholder="nguoi.nhan@example.com"
                value={receiverEmail}
                onChange={(event) => setReceiverEmail(event.target.value)}
              />
            </label>
            <div className="email-row-controls">
              <strong>Chọn dòng hàng ({emailRows.length}/{items.length})</strong>
              <button
                type="button"
                className="clear-filters"
                onClick={() => setSelectedEmailRows(new Set(items.map((_, index) => index)))}
              >
                Chọn tất cả
              </button>
              <button
                type="button"
                className="clear-filters"
                onClick={() => setSelectedEmailRows(new Set())}
              >
                Bỏ chọn
              </button>
            </div>
            <div className="email-row-list">
              {visibleEmailRowItems.map((item, pageIndex) => {
                const index = emailRowsPage * EMAIL_LIST_PAGE_SIZE + pageIndex;
                return (
                <label className="email-row-option" key={index}>
                  <input
                    type="checkbox"
                    checked={selectedEmailRows.has(index)}
                    onChange={(event) => setSelectedEmailRows((current) => {
                      const next = new Set(current);
                      if (event.target.checked) next.add(index);
                      else next.delete(index);
                      return next;
                    })}
                  />
                  <span>
                    <strong>Dòng {index + 1}</strong>
                    {EXCEL_TEMPLATE.columns.map((column) => item[column.key] && (
                      <small key={column.key}>{column.label}: {item[column.key]}</small>
                    ))}
                  </span>
                </label>
                );
              })}
            </div>
            <Pagination page={emailRowsPage} pageSize={EMAIL_LIST_PAGE_SIZE} total={items.length} onPageChange={setEmailRowsPage} />
            {validReceiverEmail && emailRows.length > 0 ? (
              <>
                <a
                  className="button primary email-compose-link"
                  href={outlookComposeHref}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Mở Outlook soạn email
                </a>
                <button type="button" className="button secondary email-compose-link" onClick={copyRichEmail}>
                  Sao chép bảng HTML
                </button>
                {emailCopyMessage && <p className="email-copy-message" role="status">{emailCopyMessage}</p>}
                <a className="email-mailto-fallback" href={mailtoHref}>
                  Thử mở bằng ứng dụng email mặc định (có thể lỗi font)
                </a>
              </>
            ) : (
              <button className="button primary email-compose-link" disabled>
                {!validReceiverEmail ? "Nhập email bên nhận hàng hợp lệ" : "Chọn ít nhất một dòng hàng"}
              </button>
            )}
          </section>
        )}
        {!request.deleted && (
          <div className="detail-actions">
            <button className="button primary" disabled={saving} onClick={onSave}>{saving ? "Đang lưu…" : "Lưu thay đổi"}</button>
            {admin && <>
              {request.status === "pending" && (
                <>
                  <button type="button" className="button row-action approve" disabled={saving} onClick={() => onStatus("approved")}>Duyệt</button>
                  <button type="button" className="button row-action reject" disabled={saving} onClick={() => onStatus("rejected")}>Từ chối</button>
                </>
              )}
              {request.status === "approved" && (
                <span className="button row-action confirm disabled-button">Đã duyệt</span>
              )}
              {request.status === "rejected" && (
                <span className="button row-action reject disabled-button">Đã từ chối</span>
              )}
              <button className="button danger" disabled={saving} onClick={onDelete}>Xóa mềm</button>
            </>}
          </div>
        )}
      </div>
      <div className="panel history-panel">
        <div className="section-title"><span className="step">03</span><div><h2>Lịch sử thay đổi</h2><p>Nhật ký chỉ ghi các trường đã thay đổi.</p></div></div>
        {request.revisions.length === 0 ? <p className="muted small">Chưa có thay đổi nào.</p> : (
          <div className="timeline">
            {visibleRevisions.map((revision) => {
              const editedFields = [
                ...(revision.changes?.supplierName !== undefined ? ["tên nhà cung cấp"] : []),
                ...(revision.changes?.deliveryDate !== undefined ? ["ngày giao"] : []),
                ...(revision.changes?.deliveryTime !== undefined ? ["giờ giao"] : []),
                ...(revision.changes?.recipientEmail !== undefined ? ["người nhận form"] : []),
                ...(revision.changes?.notes !== undefined ? ["ghi chú"] : []),
                ...(revision.changes?.itemChanges ?? []).map((change) => {
                  const label = EXCEL_TEMPLATE.columns.find((column) => column.key === change.key)?.label ?? change.key;
                  return `${label}, dòng ${change.index + 1}`;
                }),
              ];
              return <div className="timeline-entry" key={revision.id}>
                <span className="timeline-dot" /><div>
                  <strong>{revision.actorEmail}</strong><span className="muted small">{formatDate(revision.createdAt)}</span>
                  <p>{revision.deleted ? "Đã xóa mềm phiếu" : revision.status ? `Trạng thái: ${statusLabels[revision.status]}` : `Đã cập nhật ${editedFields.join("; ")}`}</p>
                </div>
              </div>;
            })}
          </div>
        )}
        <Pagination page={revisionPage} pageSize={LIST_PAGE_SIZE} total={revisions.length} onPageChange={setRevisionPage} />
      </div>
    </div>
  );
}

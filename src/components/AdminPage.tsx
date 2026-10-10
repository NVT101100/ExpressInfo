import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { EXCEL_TEMPLATE } from "../config";
import { formatDate, formatSubmitDateKey, statusLabels } from "../lib/delivery";
import { buildGroupedSupplierEmail, copyHtmlEmailToClipboard, formatGroupedPlainEmail, type AttachmentLink } from "../lib/email";
import type { DeliveryRequest, RequestStatus } from "../types";

interface AdminPageProps {
  requests: DeliveryRequest[];
  loading: boolean;
  selectedId: string | null;
  focusRequestId?: string | null;
  onSelect: (id: string) => void;
  onStatusChange: (id: string, status: RequestStatus) => Promise<void>;
  onExport: (requests: DeliveryRequest[], mode: "filtered" | "all") => void;
}

export default function AdminPage({
  requests,
  loading,
  selectedId,
  focusRequestId = null,
  onSelect,
  onStatusChange,
  onExport,
}: AdminPageProps) {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [supplier, setSupplier] = useState("all");
  const [submitFrom, setSubmitFrom] = useState("");
  const [submitTo, setSubmitTo] = useState("");
  const [activeDate, setActiveDate] = useState<string | null>(null);
  const [activeSupplierUid, setActiveSupplierUid] = useState<string | null>(null);
  const [dayView, setDayView] = useState<"suppliers" | "items">("suppliers");
  const [dayEmailAddress, setDayEmailAddress] = useState("");
  const [dayEmailCopyMessage, setDayEmailCopyMessage] = useState("");
  const [showDayEmailDialog, setShowDayEmailDialog] = useState(false);
  const emailPreviewRef = useRef<HTMLDivElement>(null);
  const [listPage, setListPage] = useState(0);
  const [busyRequestIds, setBusyRequestIds] = useState<Set<string>>(() => new Set());
  const [today, setToday] = useState(() => new Date());
  const todayKey = [
    today.getFullYear(),
    String(today.getMonth() + 1).padStart(2, "0"),
    String(today.getDate()).padStart(2, "0"),
  ].join("-");

  const activeRequests = useMemo(
    () => requests.filter((request) => !request.deleted),
    [requests],
  );

  const filteredRequests = useMemo(() => {
    const term = search.trim().toLocaleLowerCase();
    return activeRequests
      .filter((request) => status === "all" || request.status === status)
      .filter((request) => supplier === "all" || request.ownerUid === supplier)
      .filter((request) => {
        const submitKey = formatSubmitDateKey(request.createdAt || Date.now());
        return (!submitFrom || submitKey >= submitFrom)
          && (!submitTo || submitKey <= submitTo);
      })
      .filter((request) => {
        if (!term) return true;
        return [
          request.supplierName,
          request.ownerEmail,
          ...request.items.flatMap((item) => Object.values(item)),
        ].join(" ").toLocaleLowerCase().includes(term);
      });
  }, [activeRequests, search, status, supplier, submitFrom, submitTo]);

  useEffect(() => {
    const nextMidnight = new Date();
    nextMidnight.setHours(24, 0, 1, 0);
    const timeout = window.setTimeout(
      () => setToday(new Date()),
      Math.max(1000, nextMidnight.getTime() - Date.now()),
    );
    return () => window.clearTimeout(timeout);
  }, [today]);

  useEffect(() => {
    if (!focusRequestId) return;
    const focusedRequest = filteredRequests.find((request) => request.id === focusRequestId);
    if (!focusedRequest) {
      if (!activeRequests.some((request) => request.id === focusRequestId)) return;
      setSearch("");
      setStatus("all");
      setSupplier("all");
      setSubmitFrom("");
      setSubmitTo("");
      return;
    }
    const date = formatSubmitDateKey(focusedRequest.createdAt || Date.now());
    setActiveDate(date);
    setActiveSupplierUid(focusedRequest.ownerUid);
    setListPage(0);
  }, [activeRequests, filteredRequests, focusRequestId]);

  const requestsBySubmitDate = useMemo(() => {
    const dates = new Map<string, Map<string, { supplierName: string; ownerEmail: string; requests: DeliveryRequest[] }>>();
    for (const request of filteredRequests) {
      const submitDate = formatSubmitDateKey(request.createdAt || Date.now());
      if ((submitFrom && submitDate < submitFrom) || (submitTo && submitDate > submitTo)) continue;
      const dateSuppliers = dates.get(submitDate) ?? new Map();
      const supplierGroup = dateSuppliers.get(request.ownerUid) ?? {
        supplierName: request.supplierName,
        ownerEmail: request.ownerEmail,
        requests: [],
      };
      supplierGroup.requests.push(request);
      dateSuppliers.set(request.ownerUid, supplierGroup);
      dates.set(submitDate, dateSuppliers);
    }
    return [...dates.entries()].sort(([dateA], [dateB]) => dateB.localeCompare(dateA));
  }, [filteredRequests, submitFrom, submitTo]);

  const selectedDateGroup = requestsBySubmitDate.find(([date]) => date === activeDate);
  const selectedSuppliers = selectedDateGroup
    ? [...selectedDateGroup[1].entries()].sort(([, a], [, b]) => a.supplierName.localeCompare(b.supplierName))
    : [];
  const selectedSupplierGroup = selectedSuppliers.find(([uid]) => uid === activeSupplierUid);
  const selectedSupplierRequests = selectedSupplierGroup
    ? [...selectedSupplierGroup[1].requests].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
    : [];
  const selectedDayRequests = activeDate
    ? filteredRequests
      .filter((request) => formatSubmitDateKey(request.createdAt || Date.now()) === activeDate)
      .sort((a, b) => a.supplierName.localeCompare(b.supplierName))
    : [];
  const selectedDayItems = selectedDayRequests.flatMap((request) =>
    request.items.map((item, index) => ({ request, item, index })),
  );
  const encodeQueryValue = (value: string) => encodeURIComponent(value)
    .replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);

  const emailParagraphs = [
    "Kính gửi bộ phận nhận hàng,",
    `Dưới đây là danh sách hàng hóa dự kiến giao hàng, tổng hợp từ các phiếu được gửi ngày ${activeDate ?? ""}. Mỗi nhà cung cấp được nhóm riêng kèm file đính kèm (nếu có).`,
    "Trân trọng.",
  ];

  const dayEmailGroups = selectedDayRequests.map((request) => {
    const requestItems = selectedDayItems.filter((entry) => entry.request.id === request.id);
    const attachments: AttachmentLink[] = [];
    if (request.attachments?.deliveryPlan) attachments.push(request.attachments.deliveryPlan);
    if (request.attachments?.companyIntroduction) attachments.push(request.attachments.companyIntroduction);
    return {
      supplierName: request.supplierName,
      submitInfo: `Gửi ${formatDate(request.createdAt)} · ${statusLabels[request.status]}`,
      rows: requestItems.map(({ item }) => EXCEL_TEMPLATE.columns.map((column) => item[column.key] ?? "")),
      attachments,
    };
  });

  const dayEmailBody = formatGroupedPlainEmail(
    emailParagraphs,
    EXCEL_TEMPLATE.columns.map((column) => column.label),
    dayEmailGroups,
  );

  const dayEmailHtml = buildGroupedSupplierEmail(
    emailParagraphs,
    EXCEL_TEMPLATE.columns.map((column) => column.label),
    dayEmailGroups,
  );
  const validDayEmailAddress = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(dayEmailAddress.trim());
  const dayEmailHref = validDayEmailAddress && selectedDayItems.length > 0 && activeDate
    ? `https://outlook.office.com/mail/deeplink/compose?to=${encodeQueryValue(dayEmailAddress.trim())}&subject=${encodeQueryValue(`Danh sách dự kiến giao hàng - Phiếu gửi ngày ${activeDate}`)}`
    : undefined;
  async function copyDayRichEmail() {
    try {
      const editedPreview = emailPreviewRef.current;
      await copyHtmlEmailToClipboard(
        editedPreview?.innerHTML ?? dayEmailHtml,
        editedPreview?.innerText ?? dayEmailBody,
      );
      setDayEmailCopyMessage("Đã sao chép email.");
    } catch (cause) {
      setDayEmailCopyMessage(cause instanceof Error ? cause.message : "Không sao chép được nội dung email.");
    }
  }

  async function openDayEmailDialog() {
    if (!validDayEmailAddress || !selectedDayItems.length || !activeDate) return;
    setShowDayEmailDialog(true);
    setDayEmailCopyMessage("");
  }

  async function openOutlookFromDayEmail() {
    if (!dayEmailHref) return;
    try {
      await copyDayRichEmail();
      setShowDayEmailDialog(false);
      window.open(dayEmailHref, "_blank", "noopener,noreferrer");
    } catch (cause) {
      setDayEmailCopyMessage(cause instanceof Error ? cause.message : "Không mở được Outlook.");
    }
  }
  const PAGE_SIZE = 50;
  const currentList = !activeDate
    ? requestsBySubmitDate
    : !activeSupplierUid
      ? dayView === "items" ? selectedDayItems : selectedSuppliers
      : selectedSupplierRequests;
  const pageCount = Math.max(1, Math.ceil(currentList.length / PAGE_SIZE));
  const paginatedList = currentList.slice(listPage * PAGE_SIZE, (listPage + 1) * PAGE_SIZE);

  function submitDateTone(date: string) {
    if (date === todayKey) return "today";
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayKey = [
      yesterday.getFullYear(),
      String(yesterday.getMonth() + 1).padStart(2, "0"),
      String(yesterday.getDate()).padStart(2, "0"),
    ].join("-");
    if (date === yesterdayKey) return "soon";
    return "upcoming";
  }

  async function runRequestAction(requestId: string, action: () => Promise<void>) {
    setBusyRequestIds((current) => new Set(current).add(requestId));
    try {
      await action();
    } finally {
      setBusyRequestIds((current) => {
        const next = new Set(current);
        next.delete(requestId);
        return next;
      });
    }
  }

  useEffect(() => {
    if (activeDate && !selectedDateGroup) {
      setActiveDate(null);
      setActiveSupplierUid(null);
      setListPage(0);
    } else if (activeSupplierUid && !selectedSupplierGroup) {
      setActiveSupplierUid(null);
      setListPage(0);
    }
  }, [activeDate, activeSupplierUid, selectedDateGroup, selectedSupplierGroup]);

  useEffect(() => {
    setListPage(0);
  }, [search, status, supplier, submitFrom, submitTo]);

  useEffect(() => {
    if (!focusRequestId || !selectedSupplierRequests.some((request) => request.id === focusRequestId)) return;
    document.getElementById(`admin-request-${focusRequestId}`)
      ?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [focusRequestId, selectedSupplierRequests]);

  function formatDateLabel(dateKey: string) {
    return new Intl.DateTimeFormat("vi-VN", { dateStyle: "full" }).format(new Date(`${dateKey}T00:00:00`));
  }

  const todayRequests = activeRequests.filter((request) => formatSubmitDateKey(request.createdAt || Date.now()) === todayKey);

  return (
    <section className="admin-page">
      <div className="page-heading admin-heading">
        <div><p className="eyebrow">QUẢN TRỊ</p><h1>Tổng hợp đăng ký giao hàng</h1><p className="muted">Quản lý theo ngày gửi phiếu, duyệt và soạn email danh sách dự kiến giao hàng.</p></div>
        <div className="export-actions">
          <button className="button secondary" onClick={() => onExport(filteredRequests, "filtered")}>
            <svg className="admin-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v11m0 0 4-4m-4 4-4-4M5 16v4h14v-4" /></svg>
            Xuất kết quả lọc ({filteredRequests.length})
          </button>
          <button className="button secondary" onClick={() => onExport(activeRequests, "all")}>
            <svg className="admin-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v11m0 0 4-4m-4 4-4-4M5 16v4h14v-4" /></svg>
            Xuất tất cả ({activeRequests.length})
          </button>
        </div>
      </div>

      <div className="admin-today-summary" aria-label="Thông tin hôm nay">
        <span>
          <svg className="admin-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3v3m10-3v3M4 9h16M6 5h12a2 2 0 0 1 2 2v12H4V7a2 2 0 0 1 2-2Zm2 8h3v3H8z" /></svg>
          Hôm nay đã nhận <strong>{todayRequests.length}</strong> phiếu
        </span>
      </div>

      <div className="panel table-panel">
        <div className="toolbar admin-toolbar-sticky">
          <div className="toolbar-title-wrap">
            <h2>Danh sách phiếu</h2>
            <p className="muted small">Dữ liệu cập nhật theo thời gian thực</p>
          </div>
          <div className="filters admin-filters-wrap">
            <input className="text-input search-input" placeholder="Tìm NCC, email, mã hàng…" value={search} onChange={(event) => setSearch(event.target.value)} />
            <select className="text-input filter-select" value={status} onChange={(event) => setStatus(event.target.value)}>
              <option value="all">Tất cả trạng thái</option>
              <option value="pending">Chờ duyệt</option>
              <option value="approved">Đã duyệt</option>
              <option value="rejected">Từ chối</option>
            </select>
            <select className="text-input filter-select" value={supplier} onChange={(event) => setSupplier(event.target.value)}>
              <option value="all">Tất cả nhà cung cấp</option>
              {[...new Map(activeRequests.map((request) => [request.ownerUid, request.supplierName])).entries()].map(([uid, name]) => <option key={uid} value={uid}>{name}</option>)}
            </select>
            <label className="filter-date"><span>Từ ngày gửi</span><input className="text-input" type="date" value={submitFrom} onChange={(event) => setSubmitFrom(event.target.value)} /></label>
            <label className="filter-date"><span>Đến ngày gửi</span><input className="text-input" type="date" value={submitTo} onChange={(event) => setSubmitTo(event.target.value)} /></label>
          </div>
        </div>
        <nav className="admin-tabs admin-breadcrumbs" aria-label="Điều hướng phiếu">
          <button type="button" className={!activeDate ? "active" : ""} onClick={() => { setActiveDate(null); setActiveSupplierUid(null); setListPage(0); }}>
            Ngày gửi
          </button>
          {activeDate && <span className="breadcrumb-separator">›</span>}
          {activeDate && <button type="button" className={!activeSupplierUid ? "active" : ""} onClick={() => { setActiveSupplierUid(null); setListPage(0); }}>
            {formatDateLabel(activeDate)}
          </button>}
          {activeSupplierUid && <span className="breadcrumb-separator">›</span>}
          {activeSupplierUid && <button type="button" className="active" onClick={() => setListPage(0)}>
            {selectedSupplierGroup?.[1].supplierName ?? "Nhà cung cấp"}
          </button>}
          {activeSupplierUid && <span className="breadcrumb-separator">›</span>}
          {activeSupplierUid && <button type="button" className="active current-path" onClick={() => setListPage(0)}>
            Phiếu
          </button>}
        </nav>
        {activeDate && !activeSupplierUid && (
          <div className="day-tools">
            <div className="day-view-switch" role="group" aria-label="Kiểu danh sách trong ngày">
              <button className={dayView === "suppliers" ? "active" : ""} onClick={() => { setDayView("suppliers"); setListPage(0); }}>Theo nhà cung cấp</button>
              <button className={dayView === "items" ? "active" : ""} onClick={() => { setDayView("items"); setListPage(0); }}>Toàn bộ danh sách hàng ({selectedDayItems.length})</button>
            </div>
            <div className="day-email-tools">
              <input className="text-input" type="email" value={dayEmailAddress} onChange={(event) => setDayEmailAddress(event.target.value)} placeholder="Email bên nhận hàng" aria-label="Email bên nhận hàng cho danh sách cả ngày" />
              <button type="button" className="button primary" disabled={!validDayEmailAddress || !selectedDayItems.length || !activeDate} onClick={() => void openDayEmailDialog()}>
                {validDayEmailAddress && selectedDayItems.length > 0 && activeDate ? "Soạn email danh sách dự kiến giao" : validDayEmailAddress ? "Ngày này chưa có dòng hàng" : "Nhập email để soạn mail cả ngày"}
              </button>
              <button type="button" className="button secondary" onClick={() => void copyDayRichEmail()}>Sao chép email</button>
            </div>
            {dayEmailCopyMessage && <p className="email-copy-message" role="status">{dayEmailCopyMessage}</p>}
          </div>
        )}
        {showDayEmailDialog && activeDate && createPortal(
          <div className="email-dialog-backdrop" onClick={() => setShowDayEmailDialog(false)}>
            <div className="email-dialog" role="dialog" aria-modal="true" aria-label="Soạn email" onClick={(event) => event.stopPropagation()}>
              <div className="email-dialog-header">
                <strong>Soạn email danh sách dự kiến giao</strong>
                <button type="button" className="button plain" aria-label="Đóng dialog" onClick={() => setShowDayEmailDialog(false)}>
                  <svg className="admin-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>
                </button>
              </div>
              <p className="muted small">Bạn có thể chỉnh sửa trực tiếp nội dung và bảng bên dưới. Sao chép để dán vào email, hoặc mở Outlook sau khi hoàn tất.</p>
              <div
                ref={emailPreviewRef}
                className="email-dialog-preview"
                contentEditable
                suppressContentEditableWarning
                role="textbox"
                aria-label="Nội dung email có thể chỉnh sửa"
                aria-multiline="true"
                dangerouslySetInnerHTML={{ __html: dayEmailHtml }}
              />
              {dayEmailCopyMessage && <p className="email-copy-message" role="status">{dayEmailCopyMessage}</p>}
              <div className="email-dialog-actions">
                <button type="button" className="button secondary" onClick={() => void copyDayRichEmail()}>
                  <svg className="admin-icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="12" height="13" rx="2" /><path d="M16 8V5a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h2" /></svg>
                  Sao chép email
                </button>
                <button type="button" className="button primary" disabled={!dayEmailHref} onClick={() => void openOutlookFromDayEmail()}>
                  <svg className="admin-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 5h18v14H3zM3 6l9 7 9-7" /></svg>
                  Gửi bằng Outlook
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}
        <div className="admin-tab-panel">
          <h3>
            {!activeDate ? "Chọn ngày gửi phiếu" : !activeSupplierUid ? dayView === "items" ? "Toàn bộ hàng hóa (danh sách dự kiến giao)" : "Chọn nhà cung cấp" : `${selectedSupplierGroup?.[1].supplierName ?? ""} · Danh sách phiếu`}
          </h3>
          {!filteredRequests.length ? <p className="empty-row">{loading ? "Đang tải danh sách…" : "Không tìm thấy phiếu phù hợp."}</p> : (
            <div className="admin-form-list">
              {paginatedList.map((entry) => {
                if (!activeDate) {
                  const [date, suppliers] = entry as typeof requestsBySubmitDate[number];
                  const count = [...suppliers.values()].reduce((sum, group) => sum + group.requests.length, 0);
                  const pendingCount = [...suppliers.values()].flatMap((group) => group.requests).filter((r) => r.status === "pending").length;
                  return <button className={`admin-tab-entry date-tab-${submitDateTone(date)}`} key={date} onClick={() => { setActiveDate(date); setActiveSupplierUid(null); setListPage(0); }}>
                    <strong>{formatDateLabel(date)}</strong><span>{count} phiếu · {suppliers.size} NCC{pendingCount > 0 ? ` · ${pendingCount} chờ duyệt` : ""}</span><span className="button table-action">Chi tiết →</span>
                  </button>;
                }
                if (!activeSupplierUid) {
                  if (dayView === "items") {
                    const { request, item, index } = entry as typeof selectedDayItems[number];
                    return <div className="admin-day-item" key={`${request.id}:${index}`}>
                      <div><strong>{item.materialName || item.name || Object.values(item).find(Boolean) || `Dòng ${index + 1}`}</strong>
                        <span>{request.supplierName} · {statusLabels[request.status]}</span>
                      </div>
                      <div className="admin-day-item-fields">{EXCEL_TEMPLATE.columns.map((column) => (
                        <span key={column.key}><small>{column.label}</small><strong>{item[column.key] || "—"}</strong></span>
                      ))}</div>
                      <button type="button" className="button table-action" onClick={() => { setDayView("suppliers"); setActiveSupplierUid(request.ownerUid); onSelect(request.id); }}>Mở phiếu →</button>
                    </div>;
                  }
                  const [ownerUid, group] = entry as typeof selectedSuppliers[number];
                  const pending = group.requests.filter((r) => r.status === "pending").length;
                  return <button className="admin-tab-entry" key={ownerUid} onClick={() => { setActiveSupplierUid(ownerUid); setListPage(0); }}>
                    <strong>{group.supplierName}</strong><span>{group.ownerEmail} · {group.requests.length} phiếu{pending > 0 ? ` · ${pending} chờ duyệt` : ""}</span><span className="button table-action">Xem phiếu →</span>
                  </button>;
                }
                const request = entry as DeliveryRequest;
                const busy = busyRequestIds.size > 0;
                return <div
                  key={request.id}
                  id={`admin-request-${request.id}`}
                  className={`admin-form-entry ${selectedId === request.id ? "selected-row" : ""} ${focusRequestId === request.id ? "mention-highlight-row" : ""}`}
                >
                  <span className="admin-form-description">
                    <strong>{request.supplierName}</strong>
                    <small>{request.items.length} dòng hàng · Gửi {formatDate(request.createdAt)}</small>
                  </span>
                  <span className={`status status-${request.status}`}>{statusLabels[request.status]}</span>
                  <div className="admin-row-actions">
                    {request.status === "pending" && <>
                      <button type="button" className="button row-action approve" disabled={busy} onClick={() => runRequestAction(request.id, () => onStatusChange(request.id, "approved"))}>Duyệt</button>
                      <button type="button" className="button row-action reject" disabled={busy} onClick={() => runRequestAction(request.id, () => onStatusChange(request.id, "rejected"))}>Từ chối</button>
                    </>}
                    {request.status === "approved" && (
                      <span className="button row-action confirm disabled-button">Đã duyệt</span>
                    )}
                    {request.status === "rejected" && (
                      <span className="button row-action reject disabled-button">Đã từ chối</span>
                    )}
                    <button type="button" className="button table-action" onClick={() => onSelect(request.id)}>Chi tiết →</button>
                  </div>
                </div>;
              })}
            </div>
          )}
          <div className="filter-summary">
            <span>Đang hiển thị <strong>{filteredRequests.length}</strong> / {activeRequests.length} phiếu</span>
            {search || status !== "all" || supplier !== "all" || submitFrom || submitTo ? (
              <button className="clear-filters clear-filters-btn" onClick={() => { setSearch(""); setStatus("all"); setSupplier("all"); setSubmitFrom(""); setSubmitTo(""); }}>✕ Xóa bộ lọc</button>
            ) : null}
          </div>
          {currentList.length > PAGE_SIZE && <div className="list-pagination">
            <button className="button secondary" disabled={listPage === 0} onClick={() => setListPage((page) => page - 1)}>← Trước</button>
            <span>Trang {listPage + 1} / {pageCount} · {currentList.length} mục</span>
            <button className="button secondary" disabled={listPage + 1 >= pageCount} onClick={() => setListPage((page) => page + 1)}>Sau →</button>
          </div>}
        </div>
      </div>
    </section>
  );
}

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { EXCEL_TEMPLATE } from "../config";
import { formatDate, formatSubmitDateKey, statusLabels } from "../lib/delivery";
import { buildGroupedSupplierEmail, copyHtmlEmailToClipboard, formatGroupedPlainEmail, type AttachmentLink } from "../lib/email";
import type { DeliveryRequest, RequestStatus } from "../types";

interface AdminPageProps {
  requests: DeliveryRequest[];
  readRequestIds: Set<string>;
  requestReadsLoaded: boolean;
  loading: boolean;
  selectedId: string | null;
  focusRequestId?: string | null;
  onSelect: (id: string) => void;
  onStatusChange: (id: string, status: RequestStatus) => Promise<void>;
  onTrackingStatusChange: (
    ids: string[],
    status: "deliveryEmailSent" | "invoiceIssued",
    marked: boolean,
  ) => Promise<void>;
  onExport: (requests: DeliveryRequest[], mode: "filtered" | "all") => void;
}

export default function AdminPage({
  requests,
  readRequestIds,
  requestReadsLoaded,
  loading,
  selectedId,
  focusRequestId = null,
  onSelect,
  onStatusChange,
  onTrackingStatusChange,
  onExport,
}: AdminPageProps) {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [supplier, setSupplier] = useState("all");
  const [submitFrom, setSubmitFrom] = useState("");
  const [submitTo, setSubmitTo] = useState("");
  const [activeDate, setActiveDate] = useState<string | null>(null);
  const [invoiceView, setInvoiceView] = useState(false);
  const [selectedDates, setSelectedDates] = useState<Set<string>>(() => new Set());
  const [selectedRequestIds, setSelectedRequestIds] = useState<Set<string>>(() => new Set());
  const [activeSupplierUid, setActiveSupplierUid] = useState<string | null>(null);
  const [dayView, setDayView] = useState<"suppliers" | "items">("suppliers");
  const [dayEmailAddress, setDayEmailAddress] = useState("");
  const [dayEmailCopyMessage, setDayEmailCopyMessage] = useState("");
  const [showDayEmailDialog, setShowDayEmailDialog] = useState(false);
  const [emailDialogRequestIds, setEmailDialogRequestIds] = useState<string[] | null>(null);
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
  const visibleRequests = useMemo(
    () => invoiceView
      ? activeRequests.filter((request) => request.invoiceIssuedAt)
      : activeRequests,
    [activeRequests, invoiceView],
  );

  const filteredRequests = useMemo(() => {
    const term = search.trim().toLocaleLowerCase();
    return visibleRequests
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
  }, [visibleRequests, search, status, supplier, submitFrom, submitTo]);
  const hasActiveFilters = !!(
    search.trim() || status !== "all" || supplier !== "all" || submitFrom || submitTo
  );

  function requestGroupDate(request: DeliveryRequest) {
    const timestamp = invoiceView ? request.invoiceIssuedAt : request.createdAt;
    return formatSubmitDateKey(timestamp || Date.now());
  }

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
      const targetRequest = activeRequests.find((request) => request.id === focusRequestId);
      if (!targetRequest) return;
      if (invoiceView && !targetRequest.invoiceIssuedAt) setInvoiceView(false);
      setSearch("");
      setStatus("all");
      setSupplier("all");
      setSubmitFrom("");
      setSubmitTo("");
      return;
    }
    const date = requestGroupDate(focusedRequest);
    setActiveDate(date);
    setActiveSupplierUid(focusedRequest.ownerUid);
    setListPage(0);
  }, [activeRequests, filteredRequests, focusRequestId, invoiceView]);

  const requestsBySubmitDate = useMemo(() => {
    const dates = new Map<string, Map<string, { supplierName: string; ownerEmail: string; requests: DeliveryRequest[] }>>();
    for (const request of filteredRequests) {
      const submitDate = requestGroupDate(request);
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
  }, [filteredRequests, submitFrom, submitTo, invoiceView]);

  const selectedDateGroup = requestsBySubmitDate.find(([date]) => date === activeDate);
  const selectedSuppliers = selectedDateGroup
    ? [...selectedDateGroup[1].entries()].sort(([, a], [, b]) => a.supplierName.localeCompare(b.supplierName))
    : [];
  const selectedSupplierGroup = selectedSuppliers.find(([uid]) => uid === activeSupplierUid);
  const selectedSupplierRequests = selectedSupplierGroup
    ? [...selectedSupplierGroup[1].requests].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
    : [];
  const bulkRequestSource = invoiceView ? visibleRequests : activeRequests;
  const selectedDayRequests = activeDate
    ? filteredRequests
      .filter((request) => requestGroupDate(request) === activeDate)
      .sort((a, b) => a.supplierName.localeCompare(b.supplierName))
    : [];
  const requestsInSelectedDay = activeDate
    ? bulkRequestSource.filter((request) => requestGroupDate(request) === activeDate)
    : [];
  const selectedDayItems = selectedDayRequests.flatMap((request) =>
    request.items.map((item, index) => ({ request, item, index })),
  );
  const selectedRequests = filteredRequests.filter((request) => selectedRequestIds.has(request.id));
  const emailDialogRequests = showDayEmailDialog && emailDialogRequestIds
    ? emailDialogRequestIds
      .map((id) => requests.find((request) => request.id === id))
      .filter((request): request is DeliveryRequest => !!request && !request.deleted)
    : selectedDayRequests;
  const encodeQueryValue = (value: string) => encodeURIComponent(value)
    .replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);

  const emailParagraphs = [
    "Kính gửi bộ phận nhận hàng,",
    emailDialogRequests.length === 1
      ? `Dưới đây là danh sách hàng hóa của phiếu gửi ngày ${formatDateLabel(formatSubmitDateKey(emailDialogRequests[0]?.createdAt || Date.now()))}.`
      : `Dưới đây là danh sách hàng hóa dự kiến giao hàng, tổng hợp từ ${emailDialogRequests.length} phiếu đã chọn. Mỗi nhà cung cấp được nhóm riêng kèm file đính kèm (nếu có).`,
    "Trân trọng.",
  ];

  const emailGroups = emailDialogRequests.map((request) => {
    const attachments: AttachmentLink[] = [];
    if (request.attachments?.deliveryPlan) attachments.push(request.attachments.deliveryPlan);
    if (request.attachments?.companyIntroduction) attachments.push(request.attachments.companyIntroduction);
    return {
      supplierName: request.supplierName,
      submitInfo: `Gửi ${formatDate(request.createdAt)} · ${statusLabels[request.status]}`,
      rows: request.items.map((item) => EXCEL_TEMPLATE.columns.map((column) => item[column.key] ?? "")),
      attachments,
    };
  });

  const emailBody = formatGroupedPlainEmail(
    emailParagraphs,
    EXCEL_TEMPLATE.columns.map((column) => column.label),
    emailGroups,
  );

  const emailHtml = buildGroupedSupplierEmail(
    emailParagraphs,
    EXCEL_TEMPLATE.columns.map((column) => column.label),
    emailGroups,
  );
  const validEmailAddress = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(dayEmailAddress.trim());
  const emailDates = [...new Set(emailDialogRequests.map((request) => formatSubmitDateKey(request.createdAt || Date.now())))];
  const emailSubject = emailDates.length === 1
    ? `Danh sách dự kiến giao hàng - Phiếu gửi ngày ${emailDates[0]}`
    : `Danh sách dự kiến giao hàng - ${emailDialogRequests.length} phiếu đã chọn`;
  const emailHref = validEmailAddress && emailDialogRequests.length > 0
    ? `https://outlook.office.com/mail/deeplink/compose?to=${encodeQueryValue(dayEmailAddress.trim())}&subject=${encodeQueryValue(emailSubject)}`
    : undefined;
  async function copyRichEmail() {
    try {
      const editedPreview = emailPreviewRef.current;
      await copyHtmlEmailToClipboard(
        editedPreview?.innerHTML ?? emailHtml,
        editedPreview?.innerText ?? emailBody,
      );
      setDayEmailCopyMessage("Đã sao chép email.");
    } catch (cause) {
      setDayEmailCopyMessage(cause instanceof Error ? cause.message : "Không sao chép được nội dung email.");
    }
  }

  function openEmailDialog(requestIds: string[]) {
    if (!requestIds.length) return;
    setEmailDialogRequestIds(requestIds);
    setShowDayEmailDialog(true);
    setDayEmailCopyMessage("");
  }

  async function openOutlookFromEmail() {
    if (!emailHref) return;
    try {
      await copyRichEmail();
      setShowDayEmailDialog(false);
      window.open(emailHref, "_blank", "noopener,noreferrer");
    } catch (cause) {
      setDayEmailCopyMessage(cause instanceof Error ? cause.message : "Không mở được Outlook.");
    }
  }
  const PAGE_SIZE = 50;
  const currentList = hasActiveFilters
    ? filteredRequests
    : !activeDate
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

  async function updateTrackingStatus(
    ids: string[],
    trackingStatus: "deliveryEmailSent" | "invoiceIssued",
    marked = true,
  ) {
    if (!ids.length) return;
    await runRequestAction("tracking-bulk", () =>
      onTrackingStatusChange(ids, trackingStatus, marked),
    );
    setSelectedDates(new Set());
    setSelectedRequestIds(new Set());
  }

  function toggleSelectedDate(date: string) {
    setSelectedDates((current) => {
      const next = new Set(current);
      if (next.has(date)) next.delete(date);
      else next.add(date);
      return next;
    });
  }

  function toggleSelectedRequest(requestId: string) {
    setSelectedRequestIds((current) => {
      const next = new Set(current);
      if (next.has(requestId)) next.delete(requestId);
      else next.add(requestId);
      return next;
    });
  }

  const selectedDateRequestIds = bulkRequestSource
    .filter((request) => selectedDates.has(requestGroupDate(request)))
    .map((request) => request.id);

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
    setSelectedDates(new Set());
    setSelectedRequestIds(new Set());
  }, [search, status, supplier, submitFrom, submitTo]);

  useEffect(() => {
    if (!focusRequestId || !selectedSupplierRequests.some((request) => request.id === focusRequestId)) return;
    document.getElementById(`admin-request-${focusRequestId}`)
      ?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [focusRequestId, selectedSupplierRequests]);

  function formatDateLabel(dateKey: string) {
    return new Intl.DateTimeFormat("vi-VN", { dateStyle: "full" }).format(new Date(`${dateKey}T00:00:00`));
  }

  function resetListNavigation() {
    setActiveDate(null);
    setActiveSupplierUid(null);
  }

  function renderRequestEntry(request: DeliveryRequest) {
    const busy = busyRequestIds.size > 0;
    return <div
      key={request.id}
      id={`admin-request-${request.id}`}
      className={`admin-form-entry ${selectedId === request.id ? "selected-row" : ""} ${focusRequestId === request.id ? "mention-highlight-row" : ""}`}
    >
      <label className="admin-request-checkbox" aria-label={`Chọn phiếu ${request.supplierName}`}>
        <input
          type="checkbox"
          checked={selectedRequestIds.has(request.id)}
          onChange={() => toggleSelectedRequest(request.id)}
        />
      </label>
      <span className="admin-form-description">
        <strong>{request.supplierName}</strong>
        {requestReadsLoaded && !readRequestIds.has(request.id) && (
          <span className="request-unread-dot" role="img" aria-label="Chưa xem" />
        )}
        <small>{request.items.length} dòng hàng · Gửi form {formatDate(request.createdAt)}</small>
      </span>
      <span className={`status status-${request.status}`}>{statusLabels[request.status]}</span>
      <span className="tracking-badges">
        {request.deliveryEmailSentAt && <span className="tracking-badge">Đã gửi mail</span>}
        {request.invoiceIssuedAt && <span className="tracking-badge invoiced">Đã xuất hóa đơn</span>}
      </span>
      <div className="admin-row-actions">
        {!request.deliveryEmailSentAt && (
          <button type="button" className="button row-action" disabled={busy} onClick={() => void updateTrackingStatus([request.id], "deliveryEmailSent")}>
            Đã gửi mail
          </button>
        )}
        {request.deliveryEmailSentAt && !request.invoiceIssuedAt && (
          <button type="button" className="button row-action" disabled={busy} onClick={() => void updateTrackingStatus([request.id], "deliveryEmailSent", false)}>
            Bỏ gửi mail
          </button>
        )}
        {!request.invoiceIssuedAt ? (
          <button type="button" className="button row-action confirm" disabled={busy} onClick={() => void updateTrackingStatus([request.id], "invoiceIssued")}>
            Đã xuất hóa đơn
          </button>
        ) : (
          <button type="button" className="button row-action reject" disabled={busy} onClick={() => void updateTrackingStatus([request.id], "invoiceIssued", false)}>
            Bỏ xuất hóa đơn
          </button>
        )}
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
            <h2>{invoiceView ? "Quản lý phiếu đã xuất hóa đơn" : "Danh sách phiếu"}</h2>
            <p className="muted small">Dữ liệu cập nhật theo thời gian thực</p>
          </div>
          <div className="filters admin-filters-wrap">
            <input className="text-input search-input" placeholder="Tìm NCC, email, mã hàng…" value={search} onChange={(event) => { setSearch(event.target.value); resetListNavigation(); }} />
            <select className="text-input filter-select" value={status} onChange={(event) => { setStatus(event.target.value); resetListNavigation(); }}>
              <option value="all">Tất cả trạng thái</option>
              <option value="pending">Chờ duyệt</option>
              <option value="approved">Đã duyệt</option>
              <option value="rejected">Từ chối</option>
            </select>
            <select className="text-input filter-select" value={supplier} onChange={(event) => { setSupplier(event.target.value); resetListNavigation(); }}>
              <option value="all">Tất cả nhà cung cấp</option>
              {[...new Map(activeRequests.map((request) => [request.ownerUid, request.supplierName])).entries()].map(([uid, name]) => <option key={uid} value={uid}>{name}</option>)}
            </select>
            <label className="filter-date"><span>Từ ngày gửi</span><input className="text-input" type="date" value={submitFrom} onChange={(event) => { setSubmitFrom(event.target.value); resetListNavigation(); }} /></label>
            <label className="filter-date"><span>Đến ngày gửi</span><input className="text-input" type="date" value={submitTo} onChange={(event) => { setSubmitTo(event.target.value); resetListNavigation(); }} /></label>
          </div>
        </div>
        <nav className="admin-tabs tracking-tabs" aria-label="Loại phiếu">
          <button
            type="button"
            className={!invoiceView ? "active" : ""}
            onClick={() => {
              setInvoiceView(false);
              setActiveDate(null);
              setActiveSupplierUid(null);
              setSelectedDates(new Set());
              setSelectedRequestIds(new Set());
              setListPage(0);
            }}
          >
            Phiếu giao hàng
          </button>
          <button
            type="button"
            className={invoiceView ? "active" : ""}
            onClick={() => {
              setInvoiceView(true);
              setActiveDate(null);
              setActiveSupplierUid(null);
              setSelectedDates(new Set());
              setSelectedRequestIds(new Set());
              setListPage(0);
            }}
          >
            Đã xuất hóa đơn ({activeRequests.filter((request) => request.invoiceIssuedAt).length})
          </button>
        </nav>
        {!hasActiveFilters && <nav className="admin-tabs admin-breadcrumbs" aria-label="Điều hướng phiếu">
          <button type="button" className={!activeDate ? "active" : ""} onClick={() => { setActiveDate(null); setActiveSupplierUid(null); setSelectedDates(new Set()); setSelectedRequestIds(new Set()); setListPage(0); }}>
            {invoiceView ? "Ngày xuất hóa đơn" : "Ngày gửi"}
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
        </nav>}
        {selectedRequests.length > 0 && (
          <div className="tracking-actions" role="group" aria-label="Cập nhật trạng thái các phiếu đã chọn">
            <span>Đã chọn {selectedRequests.length} phiếu</span>
            <button
              type="button"
              className="button secondary"
              disabled={busyRequestIds.size > 0}
              onClick={() => void updateTrackingStatus(selectedRequests.map((request) => request.id), "deliveryEmailSent")}
            >
              Đã gửi mail giao hàng
            </button>
            <button
              type="button"
              className="button primary"
              disabled={busyRequestIds.size > 0}
              onClick={() => void updateTrackingStatus(selectedRequests.map((request) => request.id), "invoiceIssued")}
            >
              Đã xuất hóa đơn
            </button>
            <button
              type="button"
              className="button secondary"
              onClick={() => openEmailDialog(selectedRequests.map((request) => request.id))}
            >
              Soạn email giao hàng
            </button>
            <button type="button" className="button plain" onClick={() => setSelectedRequestIds(new Set())}>
              Bỏ chọn
            </button>
          </div>
        )}
        {!hasActiveFilters && !activeDate && selectedDates.size > 0 && (
          <div className="tracking-actions" role="group" aria-label="Cập nhật trạng thái các ngày đã chọn">
            <span>Đã chọn {selectedDates.size} ngày · {selectedDateRequestIds.length} phiếu</span>
            <button
              type="button"
              className="button secondary"
              disabled={busyRequestIds.size > 0 || !selectedDateRequestIds.length}
              onClick={() => void updateTrackingStatus(selectedDateRequestIds, "deliveryEmailSent")}
            >
              Đánh dấu đã gửi mail
            </button>
            <button
              type="button"
              className="button primary"
              disabled={busyRequestIds.size > 0 || !selectedDateRequestIds.length}
              onClick={() => void updateTrackingStatus(selectedDateRequestIds, "invoiceIssued")}
            >
              Đánh dấu đã xuất hóa đơn
            </button>
          </div>
        )}
        {!hasActiveFilters && activeDate && !activeSupplierUid && (
          <div className="tracking-actions" role="group" aria-label="Cập nhật trạng thái cả ngày">
            <span>{formatDateLabel(activeDate)} · {requestsInSelectedDay.length} phiếu</span>
            <button
              type="button"
              className="button secondary"
              disabled={busyRequestIds.size > 0 || !requestsInSelectedDay.length}
              onClick={() => void updateTrackingStatus(requestsInSelectedDay.map((request) => request.id), "deliveryEmailSent")}
            >
              Đánh dấu cả ngày đã gửi mail
            </button>
            <button
              type="button"
              className="button primary"
              disabled={busyRequestIds.size > 0 || !requestsInSelectedDay.length}
              onClick={() => void updateTrackingStatus(requestsInSelectedDay.map((request) => request.id), "invoiceIssued")}
            >
              Đánh dấu cả ngày đã xuất hóa đơn
            </button>
          </div>
        )}
        {!hasActiveFilters && activeDate && !activeSupplierUid && (
          !invoiceView && <div className="day-tools">
            <div className="day-view-switch" role="group" aria-label="Kiểu danh sách trong ngày">
              <button className={dayView === "suppliers" ? "active" : ""} onClick={() => { setDayView("suppliers"); setListPage(0); }}>Theo nhà cung cấp</button>
              <button className={dayView === "items" ? "active" : ""} onClick={() => { setDayView("items"); setListPage(0); }}>Toàn bộ danh sách hàng ({selectedDayItems.length})</button>
            </div>
            <div className="day-email-tools">
              <input className="text-input" type="email" value={dayEmailAddress} onChange={(event) => setDayEmailAddress(event.target.value)} placeholder="Email bên nhận hàng" aria-label="Email bên nhận hàng cho danh sách cả ngày" />
              <button type="button" className="button primary" disabled={!validEmailAddress || !selectedDayItems.length || !activeDate} onClick={() => openEmailDialog(selectedDayRequests.map((request) => request.id))}>
                {validEmailAddress && selectedDayItems.length > 0 && activeDate ? "Soạn email danh sách dự kiến giao" : validEmailAddress ? "Ngày này chưa có dòng hàng" : "Nhập email để soạn mail cả ngày"}
              </button>
              <button type="button" className="button secondary" onClick={() => void copyRichEmail()}>Sao chép email</button>
            </div>
            {dayEmailCopyMessage && <p className="email-copy-message" role="status">{dayEmailCopyMessage}</p>}
          </div>
        )}
        {showDayEmailDialog && createPortal(
          <div className="email-dialog-backdrop" onClick={() => setShowDayEmailDialog(false)}>
            <div className="email-dialog" role="dialog" aria-modal="true" aria-label="Soạn email" onClick={(event) => event.stopPropagation()}>
              <div className="email-dialog-header">
                <strong>Soạn email giao hàng</strong>
                <button type="button" className="button plain" aria-label="Đóng dialog" onClick={() => setShowDayEmailDialog(false)}>
                  <svg className="admin-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>
                </button>
              </div>
              <p className="muted small">Bạn có thể chỉnh sửa trực tiếp nội dung và bảng bên dưới. Sao chép để dán vào email, hoặc mở Outlook sau khi hoàn tất.</p>
              <label className="email-dialog-recipient">
                <span>Email bên nhận hàng</span>
                <input
                  className="text-input"
                  type="email"
                  value={dayEmailAddress}
                  onChange={(event) => setDayEmailAddress(event.target.value)}
                  placeholder="nhan-hang@example.com"
                />
              </label>
              <div
                ref={emailPreviewRef}
                className="email-dialog-preview"
                contentEditable
                suppressContentEditableWarning
                role="textbox"
                aria-label="Nội dung email có thể chỉnh sửa"
                aria-multiline="true"
                dangerouslySetInnerHTML={{ __html: emailHtml }}
              />
              {dayEmailCopyMessage && <p className="email-copy-message" role="status">{dayEmailCopyMessage}</p>}
              <div className="email-dialog-actions">
                <button type="button" className="button secondary" onClick={() => void copyRichEmail()}>
                  <svg className="admin-icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="12" height="13" rx="2" /><path d="M16 8V5a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h2" /></svg>
                  Sao chép email
                </button>
                <button type="button" className="button primary" disabled={!emailHref} onClick={() => void openOutlookFromEmail()}>
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
            {hasActiveFilters
              ? `Kết quả lọc (${filteredRequests.length} phiếu)`
              : !activeDate ? invoiceView ? "Chọn ngày xuất hóa đơn" : "Chọn ngày gửi phiếu" : !activeSupplierUid ? dayView === "items" ? "Toàn bộ hàng hóa (danh sách dự kiến giao)" : "Chọn nhà cung cấp" : `${selectedSupplierGroup?.[1].supplierName ?? ""} · Danh sách phiếu`}
          </h3>
          {!filteredRequests.length ? <p className="empty-row">{loading ? "Đang tải danh sách…" : "Không tìm thấy phiếu phù hợp."}</p> : (
            <div className="admin-form-list">
              {paginatedList.map((entry) => {
                if (hasActiveFilters) {
                  return renderRequestEntry(entry as DeliveryRequest);
                }
                if (!activeDate) {
                  const [date, suppliers] = entry as typeof requestsBySubmitDate[number];
                  const dayRequests = [...suppliers.values()].flatMap((group) => group.requests);
                  const count = dayRequests.length;
                  const pendingCount = [...suppliers.values()].flatMap((group) => group.requests).filter((r) => r.status === "pending").length;
                  const invoiceCount = dayRequests.filter((request) => request.invoiceIssuedAt).length;
                  const emailCount = dayRequests.filter((request) => request.deliveryEmailSentAt).length;
                  const hasUnreadRequests = requestReadsLoaded
                    && dayRequests.some((request) => !readRequestIds.has(request.id));
                  return <div className="admin-date-selection" key={date}>
                    <label aria-label={`Chọn ngày ${formatDateLabel(date)}`}>
                      <input
                        type="checkbox"
                        checked={selectedDates.has(date)}
                        onChange={() => toggleSelectedDate(date)}
                      />
                    </label>
                    <button type="button" className={`admin-tab-entry date-tab-${submitDateTone(date)}`} onClick={() => { setActiveDate(date); setActiveSupplierUid(null); setListPage(0); }}>
                      <strong>
                        {invoiceView ? `Xuất hóa đơn · ${formatDateLabel(date)}` : formatDateLabel(date)}
                        {hasUnreadRequests && <span className="request-unread-dot" role="img" aria-label="Có phiếu chưa xem" />}
                      </strong>
                      <span>{count} phiếu · {suppliers.size} NCC{pendingCount > 0 ? ` · ${pendingCount} chờ duyệt` : ""}</span>
                      <span className="tracking-counts">{emailCount} đã gửi mail · {invoiceCount} đã xuất hóa đơn</span>
                      <span className="button table-action">Chi tiết →</span>
                    </button>
                  </div>;
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
                  const hasUnreadRequests = requestReadsLoaded
                    && group.requests.some((request) => !readRequestIds.has(request.id));
                  return <button className="admin-tab-entry" key={ownerUid} onClick={() => { setActiveSupplierUid(ownerUid); setListPage(0); }}>
                    <strong>
                      {group.supplierName}
                      {hasUnreadRequests && <span className="request-unread-dot" role="img" aria-label="Có phiếu chưa xem" />}
                    </strong><span>{group.ownerEmail} · {group.requests.length} phiếu{pending > 0 ? ` · ${pending} chờ duyệt` : ""}</span><span className="button table-action">Xem phiếu →</span>
                  </button>;
                }
                return renderRequestEntry(entry as DeliveryRequest);
              })}
            </div>
          )}
          <div className="filter-summary">
            <span>Đang hiển thị <strong>{filteredRequests.length}</strong> / {visibleRequests.length} phiếu</span>
            {search || status !== "all" || supplier !== "all" || submitFrom || submitTo ? (
              <button className="clear-filters clear-filters-btn" onClick={() => { setSearch(""); setStatus("all"); setSupplier("all"); setSubmitFrom(""); setSubmitTo(""); resetListNavigation(); }}>✕ Xóa bộ lọc</button>
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

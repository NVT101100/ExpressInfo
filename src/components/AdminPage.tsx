import { useEffect, useMemo, useRef, useState } from "react";
import { EXCEL_TEMPLATE } from "../config";
import { daysUntilDelivery, deliveryCountdownLabel, deliveryTone, formatDate, statusLabels } from "../lib/delivery";
import { buildHtmlEmail, copyHtmlEmailToClipboard, formatPlainTextItems } from "../lib/email";
import type { DeliveryRequest, RequestStatus } from "../types";

interface AdminPageProps {
  requests: DeliveryRequest[];
  loading: boolean;
  selectedId: string | null;
  focusRequestId?: string | null;
  onSelect: (id: string) => void;
  onStatusChange: (id: string, status: RequestStatus) => Promise<void>;
  onDeliveryReminder: (id: string) => Promise<void>;
  onDeliveryConfirmation: (id: string) => Promise<void>;
  onExport: (requests: DeliveryRequest[], mode: "filtered" | "all") => void;
  onSeedDemo: () => void;
  seedingDemo: boolean;
}

export default function AdminPage({
  requests,
  loading,
  selectedId,
  focusRequestId = null,
  onSelect,
  onStatusChange,
  onDeliveryReminder,
  onDeliveryConfirmation,
  onExport,
  onSeedDemo,
  seedingDemo,
}: AdminPageProps) {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [supplier, setSupplier] = useState("all");
  const [deliveryFrom, setDeliveryFrom] = useState("");
  const [deliveryTo, setDeliveryTo] = useState("");
  const [activeDate, setActiveDate] = useState<string | null>(null);
  const [activeSupplierUid, setActiveSupplierUid] = useState<string | null>(null);
  const [dayView, setDayView] = useState<"suppliers" | "items">("suppliers");
  const [dayEmailAddress, setDayEmailAddress] = useState("");
  const [dayEmailCopyMessage, setDayEmailCopyMessage] = useState("");
  const [listPage, setListPage] = useState(0);
  const [busyRequestIds, setBusyRequestIds] = useState<Set<string>>(() => new Set());
  const [today, setToday] = useState(() => new Date());
  const remindedDate = useRef("");
  const todayKey = [
    today.getFullYear(),
    String(today.getMonth() + 1).padStart(2, "0"),
    String(today.getDate()).padStart(2, "0"),
  ].join("-");

  const activeRequests = useMemo(
    () => requests.filter((request) => !request.deleted),
    [requests],
  );
  const hasDemoRequests = requests.some((request) => request.supplierName.startsWith("[DEMO]"));

  const filteredRequests = useMemo(() => {
    const term = search.trim().toLocaleLowerCase();
    return activeRequests
      .filter((request) => status === "all" || request.status === status)
      .filter((request) => supplier === "all" || request.ownerUid === supplier)
      .filter((request) => {
        const dates = request.items
          .map((item) => item.expectedDeliveryDate)
          .filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date ?? ""));
        const deliveryDates = dates.length ? dates : [request.deliveryDate];
        return deliveryDates.some((date) =>
          (!deliveryFrom || date >= deliveryFrom)
          && (!deliveryTo || date <= deliveryTo),
        );
      })
      .filter((request) => {
        if (!term) return true;
        return [
          request.supplierName,
          request.ownerEmail,
          request.deliveryDate,
          ...request.items.flatMap((item) => Object.values(item)),
        ].join(" ").toLocaleLowerCase().includes(term);
      });
  }, [activeRequests, deliveryFrom, deliveryTo, search, status, supplier]);

  useEffect(() => {
    const nextMidnight = new Date();
    nextMidnight.setHours(24, 0, 1, 0);
    const timeout = window.setTimeout(
      () => setToday(new Date()),
      Math.max(1000, nextMidnight.getTime() - Date.now()),
    );
    return () => window.clearTimeout(timeout);
  }, [today]);

  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowDate = [
    tomorrow.getFullYear(),
    String(tomorrow.getMonth() + 1).padStart(2, "0"),
    String(tomorrow.getDate()).padStart(2, "0"),
  ].join("-");
  const tomorrowRequests = activeRequests
    .filter((request) =>
      (request.items.some((item) => item.expectedDeliveryDate === tomorrowDate)
        || (!request.items.some((item) => item.expectedDeliveryDate) && request.deliveryDate === tomorrowDate))
      && (request.status === "approved" || request.status === "reminded"),
    )
    .sort((a, b) => a.deliveryDate.localeCompare(b.deliveryDate));
  const overdueRequests = activeRequests
    .filter((request) => request.status === "overdue")
    .sort((a, b) => a.deliveryDate.localeCompare(b.deliveryDate));

  useEffect(() => {
    if (
      !tomorrowRequests.length
      || typeof Notification === "undefined"
      || Notification.permission !== "granted"
      || remindedDate.current === tomorrowDate
    ) return;
    try {
      const notification = new Notification("Nhắc soạn email giao hàng", {
        body: `Ngày mai có ${tomorrowRequests.length} phiếu giao hàng cần thông báo bên nhận.`,
        tag: `delivery-email-reminder-${tomorrowDate}`,
      });
      notification.onclick = () => window.focus();
      remindedDate.current = tomorrowDate;
    } catch (cause) {
      console.error("Không hiển thị được nhắc soạn email giao hàng.", cause);
    }
  }, [tomorrowDate, tomorrowRequests]);

  const notifiedOverdueIds = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
    for (const request of overdueRequests) {
      if (notifiedOverdueIds.current.has(request.id)) continue;
      try {
        const notification = new Notification("Phiếu giao hàng trễ hạn", {
          body: `${request.supplierName} · Lịch giao ${request.deliveryDate} chưa xác nhận hoàn tất.`,
          tag: `delivery-overdue-${request.id}`,
        });
        notification.onclick = () => {
          window.focus();
          onSelect(request.id);
        };
        notifiedOverdueIds.current.add(request.id);
      } catch (cause) {
        console.error(`Không hiển thị được thông báo trễ giao cho ${request.id}.`, cause);
      }
    }
  }, [onSelect, overdueRequests]);

  useEffect(() => {
    if (!focusRequestId) return;
    const focusedRequest = filteredRequests.find((request) => request.id === focusRequestId);
    if (!focusedRequest) {
      if (!activeRequests.some((request) => request.id === focusRequestId)) return;
      setSearch("");
      setStatus("all");
      setSupplier("all");
      setDeliveryFrom("");
      setDeliveryTo("");
      return;
    }
    const date = focusedRequest.deliveryDate || "unknown";
    setActiveDate(date);
    setActiveSupplierUid(focusedRequest.ownerUid);
    setListPage(0);
  }, [activeRequests, filteredRequests, focusRequestId]);

  const requestsByDate = useMemo(() => {
    const dates = new Map<string, Map<string, { supplierName: string; ownerEmail: string; requests: DeliveryRequest[] }>>();
    for (const request of filteredRequests) {
      const deliveryDates = [...new Set(request.items
        .map((item) => item.expectedDeliveryDate)
        .filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date ?? "")))];
      const datesForRequest = (deliveryDates.length ? deliveryDates : [request.deliveryDate || "unknown"])
        .filter((date) => (!deliveryFrom || date >= deliveryFrom) && (!deliveryTo || date <= deliveryTo));
      for (const date of datesForRequest) {
        const dateSuppliers = dates.get(date) ?? new Map();
        const supplierGroup = dateSuppliers.get(request.ownerUid) ?? {
          supplierName: request.supplierName,
          ownerEmail: request.ownerEmail,
          requests: [],
        };
        supplierGroup.requests.push(request);
        dateSuppliers.set(request.ownerUid, supplierGroup);
        dates.set(date, dateSuppliers);
      }
    }
    const priority = (date: string, dateSuppliers: Map<string, { supplierName: string; ownerEmail: string; requests: DeliveryRequest[] }>) => {
      const requestsForDate = [...dateSuppliers.values()].flatMap((group) => group.requests);
      if (date === todayKey) return 0;
      const tones = requestsForDate.map((request) => deliveryTone(date, request.status, today));
      if (tones.includes("overdue")) return 1;
      if (tones.includes("soon")) return 2;
      if (tones.every((tone) => tone === "delivered")) return 3;
      if (tones.includes("upcoming")) return 4;
      return 5;
    };
    return [...dates.entries()].sort(([dateA, suppliersA], [dateB, suppliersB]) =>
      priority(dateA, suppliersA) - priority(dateB, suppliersB)
      || dateA.localeCompare(dateB),
    );
  }, [deliveryFrom, deliveryTo, filteredRequests, today, todayKey]);
  const selectedDateGroup = requestsByDate.find(([date]) => date === activeDate);
  const selectedSuppliers = selectedDateGroup
    ? [...selectedDateGroup[1].entries()].sort(([, a], [, b]) => a.supplierName.localeCompare(b.supplierName))
    : [];
  const selectedSupplierGroup = selectedSuppliers.find(([uid]) => uid === activeSupplierUid);
  const selectedSupplierRequests = selectedSupplierGroup
    ? [...selectedSupplierGroup[1].requests].sort((a, b) => a.deliveryDate.localeCompare(b.deliveryDate))
    : [];
  const selectedDayRequests = activeDate
    ? filteredRequests
      .filter((request) => request.items.some((item) => item.expectedDeliveryDate === activeDate)
        || (!request.items.some((item) => item.expectedDeliveryDate) && (request.deliveryDate || "unknown") === activeDate))
      .sort((a, b) => a.supplierName.localeCompare(b.supplierName))
    : [];
  const selectedDayItems = selectedDayRequests.flatMap((request) =>
    request.items.flatMap((item, index) =>
      item.expectedDeliveryDate === activeDate
        ? [{ request, item, index }]
        : !request.items.some((entry) => entry.expectedDeliveryDate) && (request.deliveryDate || "unknown") === activeDate
          ? [{ request, item, index }]
          : [],
    ),
  );
  const encodeQueryValue = (value: string) => encodeURIComponent(value)
    .replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
  const dayEmailBody = selectedDayRequests.flatMap((request) => [
    `Nhà cung cấp: ${request.supplierName} · ${activeDate} · ${statusLabels[request.status]}`,
    formatPlainTextItems(
      EXCEL_TEMPLATE.columns.map((column) => column.label),
      selectedDayItems
        .filter((entry) => entry.request.id === request.id)
        .map(({ item }) => EXCEL_TEMPLATE.columns.map((column) => item[column.key] ?? "")),
    ),
    "",
  ]).join("\r\n");
  const dayEmailHtml = buildHtmlEmail([
    "Kính gửi bộ phận nhận hàng,",
    `Danh sách hàng hóa dự kiến giao ngày ${activeDate ?? ""}:`,
    "Trân trọng.",
  ], ["Nhà cung cấp", ...EXCEL_TEMPLATE.columns.map((column) => column.label)],
  selectedDayItems.map(({ request, item }) => [
    request.supplierName,
    ...EXCEL_TEMPLATE.columns.map((column) => item[column.key] ?? ""),
  ]));
  const validDayEmailAddress = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(dayEmailAddress.trim());
  const dayEmailHref = validDayEmailAddress && selectedDayItems.length > 0 && activeDate
    ? `https://outlook.office.com/mail/deeplink/compose?to=${encodeQueryValue(dayEmailAddress.trim())}&subject=${encodeQueryValue(`Danh sách giao hàng ngày ${activeDate}`)}&body=${encodeQueryValue(dayEmailBody)}`
    : undefined;
  async function copyDayRichEmail() {
    try {
      await copyHtmlEmailToClipboard(dayEmailHtml, dayEmailBody);
      setDayEmailCopyMessage("Đã sao chép email.");
    } catch (cause) {
      setDayEmailCopyMessage(cause instanceof Error ? cause.message : "Không sao chép được nội dung email.");
    }
  }
  const PAGE_SIZE = 50;
  const currentList = !activeDate
    ? requestsByDate
    : !activeSupplierUid
      ? dayView === "items" ? selectedDayItems : selectedSuppliers
      : selectedSupplierRequests;
  const pageCount = Math.max(1, Math.ceil(currentList.length / PAGE_SIZE));
  const paginatedList = currentList.slice(listPage * PAGE_SIZE, (listPage + 1) * PAGE_SIZE);
  function dateTone(date: string, dateRequests: DeliveryRequest[]) {
    const tones = dateRequests.map((request) => deliveryTone(date, request.status, today));
    if (tones.length > 0 && tones.every((tone) => tone === "delivered")) return "delivered";
    if (date === todayKey) return "today";
    if (tones.includes("overdue")) return "overdue";
    if (tones.includes("soon")) return "soon";
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
  }, [search, status, supplier, deliveryFrom, deliveryTo]);

  useEffect(() => {
    if (!focusRequestId || !selectedSupplierRequests.some((request) => request.id === focusRequestId)) return;
    document.getElementById(`admin-request-${focusRequestId}`)
      ?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [focusRequestId, selectedSupplierRequests]);

  return (
    <section className="admin-page">
      <div className="page-heading admin-heading">
        <div><p className="eyebrow">QUẢN TRỊ</p><h1>Tổng hợp đăng ký</h1><p className="muted">Lọc phiếu theo tiêu chí, duyệt và xuất dữ liệu.</p></div>
        <div className="export-actions">
          <button
            className="button secondary"
            disabled={loading || seedingDemo || hasDemoRequests}
            title={hasDemoRequests ? "Đã có phiếu demo trong cơ sở dữ liệu." : "Tạo 5 phiếu mẫu trong Realtime Database."}
            onClick={onSeedDemo}
          >
            {seedingDemo ? "Đang tạo phiếu mẫu…" : hasDemoRequests ? "Đã có phiếu mẫu" : "+ Thêm 5 phiếu mẫu"}
          </button>
          <button className="button secondary" onClick={() => onExport(filteredRequests, "filtered")}>↓ Xuất kết quả lọc ({filteredRequests.length})</button>
          <button className="button secondary" onClick={() => onExport(activeRequests, "all")}>↓ Xuất tất cả ({activeRequests.length})</button>
        </div>
      </div>
      {!hasDemoRequests && (
        <p className="demo-data-note">Phiếu mẫu được đánh dấu <strong>[DEMO]</strong>, chỉ dùng thử giao diện và có thể xóa mềm như phiếu thường.</p>
      )}
      {tomorrowRequests.length > 0 && (
        <section className="upcoming-mail-reminder" aria-label="Nhắc soạn email giao hàng">
          <div className="upcoming-mail-copy">
            <strong>Nhắc soạn email cho bên nhận hàng — ngày mai</strong>
            <span>{tomorrowRequests.length} phiếu đã duyệt sắp đến lịch giao. Mở từng phiếu để chọn các dòng hàng và tạo email.</span>
          </div>
          <div className="upcoming-mail-list">
            {tomorrowRequests.map((request) => (
              <button
                type="button"
                className="upcoming-mail-request"
                key={request.id}
                onClick={() => onSelect(request.id)}
              >
                <span><strong>{request.supplierName}</strong> · {request.deliveryDate}</span>
                <span className="button secondary">Mở phiếu →</span>
              </button>
            ))}
          </div>
        </section>
      )}
      {overdueRequests.length > 0 && (
        <section className="overdue-alert" aria-label="Phiếu giao hàng quá hạn">
          <div>
            <strong>⚠ {overdueRequests.length} phiếu đã trễ giao, chưa xác nhận hoàn tất</strong>
            <span>Nhà cung cấp đã được gửi thông báo; admin có thể nhắc giao hoặc xác nhận ngay trong danh sách phiếu.</span>
          </div>
          <div className="overdue-alert-list">
            {overdueRequests.slice(0, 8).map((request) => (
              <button key={request.id} onClick={() => onSelect(request.id)}>
                <strong>{request.supplierName}</strong>
                <span>{request.deliveryDate} · {deliveryCountdownLabel(daysUntilDelivery(request.deliveryDate))}</span>
              </button>
            ))}
            {overdueRequests.length > 8 && <span className="muted small">Còn {overdueRequests.length - 8} phiếu trễ khác trong danh sách.</span>}
          </div>
        </section>
      )}
      <div className="stats-row">
        <StatCard label="Tổng phiếu" value={activeRequests.length} tone="blue" />
        <StatCard label="Chờ duyệt" value={activeRequests.filter((request) => request.status === "pending").length} tone="amber" />
        <StatCard label="Đang chờ giao" value={activeRequests.filter((request) => request.status === "approved" || request.status === "reminded" || request.status === "overdue").length} tone="green" />
        <StatCard label="Đã giao hàng" value={activeRequests.filter((request) => request.status === "delivered").length} tone="blue" />
        <StatCard label="Nhà cung cấp" value={new Set(activeRequests.map((request) => request.ownerUid)).size} tone="purple" />
      </div>
      <div className="panel table-panel">
        <div className="toolbar">
          <div><h2>Danh sách phiếu</h2><p className="muted small">Dữ liệu cập nhật theo thời gian thực</p></div>
          <div className="filters">
            <input className="text-input search-input" placeholder="Tìm NCC, email, mã hàng…" value={search} onChange={(event) => setSearch(event.target.value)} />
            <select className="text-input filter-select" value={status} onChange={(event) => setStatus(event.target.value)}>
              <option value="all">Tất cả trạng thái</option>
              <option value="pending">Chờ duyệt</option>
              <option value="approved">Đã duyệt</option>
              <option value="reminded">Đã nhắc giao</option>
              <option value="delivered">Đã giao hàng</option>
              <option value="rejected">Từ chối</option>
            </select>
            <select className="text-input filter-select" value={supplier} onChange={(event) => setSupplier(event.target.value)}>
              <option value="all">Tất cả nhà cung cấp</option>
              {[...new Map(activeRequests.map((request) => [request.ownerUid, request.supplierName])).entries()].map(([uid, name]) => <option key={uid} value={uid}>{name}</option>)}
            </select>
            <label className="filter-date"><span>Từ ngày giao</span><input className="text-input" type="date" value={deliveryFrom} onChange={(event) => setDeliveryFrom(event.target.value)} /></label>
            <label className="filter-date"><span>Đến ngày giao</span><input className="text-input" type="date" value={deliveryTo} onChange={(event) => setDeliveryTo(event.target.value)} /></label>
          </div>
        </div>
        <div className="filter-summary">
          <span>Đang hiển thị <strong>{filteredRequests.length}</strong> / {activeRequests.length} phiếu</span>
          <button className="clear-filters" onClick={() => { setSearch(""); setStatus("all"); setSupplier("all"); setDeliveryFrom(""); setDeliveryTo(""); }}>Xóa bộ lọc</button>
        </div>
        <nav className="admin-tabs" aria-label="Điều hướng phiếu">
          <button className={!activeDate ? "active" : ""} onClick={() => { setActiveDate(null); setActiveSupplierUid(null); setListPage(0); }}>
            Ngày giao <span>{requestsByDate.length}</span>
          </button>
          {activeDate && <button className={!activeSupplierUid ? "active" : ""} onClick={() => { setActiveSupplierUid(null); setListPage(0); }}>
            {activeDate === "unknown" ? "Chưa có ngày giao" : new Intl.DateTimeFormat("vi-VN", { dateStyle: "full" }).format(new Date(`${activeDate}T00:00:00`))}
          </button>}
          {activeSupplierUid && <button className="active" onClick={() => setListPage(0)}>
            {selectedSupplierGroup?.[1].supplierName ?? "Nhà cung cấp"} · Phiếu
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
              {dayEmailHref
                ? <>
                    <a className="button primary" href={dayEmailHref} target="_blank" rel="noopener noreferrer">Soạn email toàn bộ hàng trong ngày</a>
                    <button type="button" className="button secondary" onClick={copyDayRichEmail}>Sao chép email</button>
                  </>
                : <button className="button primary" disabled>{validDayEmailAddress ? "Ngày này chưa có dòng hàng" : "Nhập email để soạn mail cả ngày"}</button>}
            </div>
            {dayEmailCopyMessage && <p className="email-copy-message" role="status">{dayEmailCopyMessage}</p>}
          </div>
        )}
        <div className="admin-tab-panel">
          <h3>
            {!activeDate ? "Chọn ngày giao hàng" : !activeSupplierUid ? dayView === "items" ? "Toàn bộ hàng hóa trong ngày" : "Chọn nhà cung cấp" : `${selectedSupplierGroup?.[1].supplierName ?? ""} · Danh sách phiếu`}
          </h3>
          {!filteredRequests.length ? <p className="empty-row">{loading ? "Đang tải danh sách…" : "Không tìm thấy phiếu phù hợp."}</p> : (
            <div className="admin-form-list">
              {paginatedList.map((entry) => {
                if (!activeDate) {
                  const [date, suppliers] = entry as typeof requestsByDate[number];
                  const count = [...suppliers.values()].reduce((sum, group) => sum + group.requests.length, 0);
                  const dateLabel = date === "unknown"
                    ? "Chưa có ngày giao"
                    : new Intl.DateTimeFormat("vi-VN", { dateStyle: "full" }).format(new Date(`${date}T00:00:00`));
                  const dateRequests = [...suppliers.values()].flatMap((group) => group.requests);
                  return <button className={`admin-tab-entry date-tab-${dateTone(date, dateRequests)}`} key={date} onClick={() => { setActiveDate(date); setActiveSupplierUid(null); setListPage(0); }}>
                    <strong>{dateLabel}</strong><span>{count} phiếu · {suppliers.size} nhà cung cấp</span><span className="button table-action">Nhà cung cấp →</span>
                  </button>;
                }
                if (!activeSupplierUid) {
                  if (dayView === "items") {
                    const { request, item, index } = entry as typeof selectedDayItems[number];
                    return <div className="admin-day-item" key={`${request.id}:${index}`}>
                      <div><strong>{item.name || Object.values(item).find(Boolean) || `Dòng ${index + 1}`}</strong>
                        <span>{request.supplierName} · {statusLabels[request.status]}</span>
                        <span className={`delivery-countdown delivery-${deliveryTone(item.expectedDeliveryDate || request.deliveryDate, request.status, today)}`}>{request.status === "delivered" ? "Đã giao" : deliveryCountdownLabel(daysUntilDelivery(item.expectedDeliveryDate || request.deliveryDate, today))}</span>
                      </div>
                      <div className="admin-day-item-fields">{EXCEL_TEMPLATE.columns.map((column) => (
                        <span key={column.key}><small>{column.label}</small><strong>{item[column.key] || "—"}</strong></span>
                      ))}</div>
                      <button type="button" className="button table-action" onClick={() => { setDayView("suppliers"); setActiveSupplierUid(request.ownerUid); onSelect(request.id); }}>Mở phiếu →</button>
                    </div>;
                  }
                  const [ownerUid, group] = entry as typeof selectedSuppliers[number];
                  return <button className="admin-tab-entry" key={ownerUid} onClick={() => { setActiveSupplierUid(ownerUid); setListPage(0); }}>
                    <strong>{group.supplierName}</strong><span>{group.ownerEmail} · {group.requests.length} phiếu</span><span className="button table-action">Xem phiếu →</span>
                  </button>;
                }
                const request = entry as DeliveryRequest;
                const days = daysUntilDelivery(request.deliveryDate);
                const busy = busyRequestIds.size > 0;
                return <div
                  key={request.id}
                  id={`admin-request-${request.id}`}
                  className={`admin-form-entry ${selectedId === request.id ? "selected-row" : ""} ${focusRequestId === request.id ? "mention-highlight-row" : ""}`}
                >
                  <span className="admin-form-description">
                    <strong>{request.supplierName}</strong>
                    <small>{request.items.length} dòng hàng · Gửi {formatDate(request.createdAt)}</small>
                    <span className={`delivery-countdown delivery-${deliveryTone(activeDate || request.deliveryDate, request.status, today)}`}>{request.status === "delivered" ? "Đã giao" : deliveryCountdownLabel(activeDate ? daysUntilDelivery(activeDate, today) : days)}</span>
                  </span>
                  <span className={`status status-${request.status}`}>{statusLabels[request.status]}</span>
                  <div className="admin-row-actions">
                    {request.status === "pending" && <>
                      <button type="button" className="button row-action approve" disabled={busy} onClick={() => runRequestAction(request.id, () => onStatusChange(request.id, "approved"))}>Duyệt</button>
                      <button type="button" className="button row-action reject" disabled={busy} onClick={() => runRequestAction(request.id, () => onStatusChange(request.id, "rejected"))}>Từ chối</button>
                    </>}
                    {["approved", "reminded", "overdue"].includes(request.status) && <>
                      <button type="button" className="button row-action remind" disabled={busy} onClick={() => runRequestAction(request.id, () => onDeliveryReminder(request.id))}>Hối giao</button>
                      <button type="button" className="button row-action confirm" disabled={busy} onClick={() => runRequestAction(request.id, () => onDeliveryConfirmation(request.id))}>Xác nhận giao</button>
                    </>}
                    <button type="button" className="button table-action" onClick={() => onSelect(request.id)}>Chi tiết →</button>
                  </div>
                </div>;
              })}
            </div>
          )}
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

function StatCard({ label, value, tone }: { label: string; value: number; tone: string }) {
  return <div className={`stat-card tone-${tone}`}><span>{label}</span><strong>{value}</strong><i /></div>;
}

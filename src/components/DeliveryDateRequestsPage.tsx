import { useMemo, useState } from "react";
import { EXCEL_TEMPLATE } from "../config";
import { statusLabels } from "../lib/delivery";
import Pagination from "./Pagination";
import type { DeliveryDateChangeSelection, DeliveryRequest } from "../types";

const PAGE_SIZE = 12;

interface DeliveryDateRequestsPageProps {
  requests: DeliveryRequest[];
  admin: boolean;
  currentUserUid: string;
  saving: boolean;
  onSubmit: (selection: DeliveryDateChangeSelection[]) => void;
  onRespond: (requestId: string, proposalId: string, accept: boolean) => void;
  onOpenRequest: (requestId: string) => void;
}

function proposalStatus(status: "pending" | "accepted" | "rejected") {
  if (status === "pending") return "Chờ nhà cung cấp";
  return status === "accepted" ? "Đã chấp nhận" : "Đã từ chối";
}

export default function DeliveryDateRequestsPage({
  requests,
  admin,
  currentUserUid,
  saving,
  onSubmit,
  onRespond,
  onOpenRequest,
}: DeliveryDateRequestsPageProps) {
  const [selectedItems, setSelectedItems] = useState<Record<string, string>>({});
  const [requestPage, setRequestPage] = useState(0);
  const [inboxPage, setInboxPage] = useState(0);
  const [historyPage, setHistoryPage] = useState(0);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [supplier, setSupplier] = useState("all");
  const [deliveryFrom, setDeliveryFrom] = useState("");
  const [deliveryTo, setDeliveryTo] = useState("");

  const suppliers = useMemo(
    () => [...new Map(requests.map((request) => [request.ownerUid, request.supplierName])).entries()],
    [requests],
  );

  const filteredRequests = useMemo(() => {
    const term = search.trim().toLocaleLowerCase();
    return requests.filter((request) => {
      if (status !== "all" && request.status !== status) return false;
      if (supplier !== "all" && request.ownerUid !== supplier) return false;

      const itemDates = request.items
        .map((item) => item.expectedDeliveryDate)
        .filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date ?? ""));
      const deliveryDates = itemDates.length ? itemDates : [request.deliveryDate];
      if ((deliveryFrom || deliveryTo) && !deliveryDates.some((date) =>
        /^\d{4}-\d{2}-\d{2}$/.test(date ?? "")
        && (!deliveryFrom || date >= deliveryFrom)
        && (!deliveryTo || date <= deliveryTo),
      )) return false;

      if (!term) return true;
      const proposalValues = request.deliveryDateRequests.flatMap((proposal) => [
        proposal.itemName,
        proposal.itemSku,
        proposal.currentDate,
        proposal.requestedDate,
      ]);
      return [
        request.supplierName,
        request.ownerEmail,
        request.deliveryDate,
        ...request.items.flatMap((item) => Object.values(item)),
        ...proposalValues,
      ].join(" ").toLocaleLowerCase().includes(term);
    });
  }, [deliveryFrom, deliveryTo, requests, search, status, supplier]);

  const rows = useMemo(() => {
    const term = search.trim().toLocaleLowerCase();
    return filteredRequests.flatMap((request) =>
      request.items.flatMap((item, itemIndex) => {
        const itemDate = /^\d{4}-\d{2}-\d{2}$/.test(item.expectedDeliveryDate ?? "")
          ? item.expectedDeliveryDate
          : request.deliveryDate;
        if (
          (deliveryFrom || deliveryTo)
          && (!/^\d{4}-\d{2}-\d{2}$/.test(itemDate ?? "")
            || (!!deliveryFrom && (itemDate ?? "") < deliveryFrom)
            || (!!deliveryTo && (itemDate ?? "") > deliveryTo))
        ) return [];
        if (term) {
          const matchesRequest = [request.supplierName, request.ownerEmail, request.deliveryDate]
            .join(" ").toLocaleLowerCase().includes(term);
          if (!matchesRequest && !Object.values(item).join(" ").toLocaleLowerCase().includes(term)) return [];
        }
        const pending = request.deliveryDateRequests.find((proposal) =>
          proposal.itemIndex === itemIndex && proposal.status === "pending",
        );
        const key = `${request.id}:${itemIndex}`;
        return [{ request, item, itemIndex, pending, key, itemDate }];
      }),
    );
  }, [deliveryFrom, deliveryTo, filteredRequests, search]);

  const pendingProposals = useMemo(() => requests.flatMap((request) =>
    request.deliveryDateRequests
      .filter((proposal) => proposal.status === "pending")
      .map((proposal) => ({ request, proposal })),
  ).filter(({ request, proposal }) => filteredRequests.some((entry) => entry.id === request.id)
    && (!deliveryFrom || proposal.currentDate >= deliveryFrom)
    && (!deliveryTo || proposal.currentDate <= deliveryTo)), [deliveryFrom, deliveryTo, filteredRequests, requests]);

  const receivedPendingProposals = pendingProposals.filter(({ proposal }) => proposal.createdByUid !== currentUserUid);
  const sentPendingProposals = pendingProposals.filter(({ proposal }) => proposal.createdByUid === currentUserUid);
  const proposalHistory = useMemo(() => requests.flatMap((request) =>
    request.deliveryDateRequests
      .filter((proposal) => proposal.status !== "pending")
      .map((proposal) => ({ request, proposal })),
  ).filter(({ request, proposal }) => filteredRequests.some((entry) => entry.id === request.id)
    && (!deliveryFrom || proposal.currentDate >= deliveryFrom)
    && (!deliveryTo || proposal.currentDate <= deliveryTo)), [deliveryFrom, deliveryTo, filteredRequests, requests]);

  const visibleRows = rows.slice(requestPage * PAGE_SIZE, (requestPage + 1) * PAGE_SIZE);
  const visibleReceivedPendingProposals = receivedPendingProposals.slice(inboxPage * PAGE_SIZE, (inboxPage + 1) * PAGE_SIZE);
  const visibleSentPendingProposals = sentPendingProposals.slice(inboxPage * PAGE_SIZE, (inboxPage + 1) * PAGE_SIZE);
  const visibleProposalHistory = proposalHistory.slice(historyPage * PAGE_SIZE, (historyPage + 1) * PAGE_SIZE);
  const selectedCount = Object.keys(selectedItems).length;

  function resetFilters() {
    setSearch("");
    setStatus("all");
    setSupplier("all");
    setDeliveryFrom("");
    setDeliveryTo("");
    setRequestPage(0);
    setInboxPage(0);
    setHistoryPage(0);
  }

  function formatDeliveryDate(value?: string) {
    if (!value) return "Chưa có ngày";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
    return new Intl.DateTimeFormat("vi-VN", { dateStyle: "long" }).format(new Date(`${value}T00:00:00`));
  }

  function toggleItem(key: string, checked: boolean) {
    setSelectedItems((current) => {
      const next = { ...current };
      if (checked) next[key] = next[key] || "";
      else delete next[key];
      return next;
    });
  }

  function toggleRequest(request: DeliveryRequest, checked: boolean) {
    setSelectedItems((current) => {
      const next = { ...current };
      request.items.forEach((_, itemIndex) => {
        const key = `${request.id}:${itemIndex}`;
        const hasPending = request.deliveryDateRequests.some((proposal) =>
          proposal.itemIndex === itemIndex && proposal.status === "pending",
        );
        if (checked && !hasPending) next[key] = next[key] || "";
        else if (!checked) delete next[key];
      });
      return next;
    });
  }

  function submit() {
    const selection = Object.entries(selectedItems).map(([key, requestedDate]) => {
      const [requestId, index] = key.split(":");
      return { requestId, itemIndex: Number(index), requestedDate };
    });
    onSubmit(selection);
  }

  const selectionReady = Object.keys(selectedItems).length > 0
    && Object.entries(selectedItems).every(([key, date]) => {
      const [requestId, index] = key.split(":");
      const request = requests.find((entry) => entry.id === requestId);
      const itemIndex = Number(index);
      const item = request?.items[itemIndex];
      const hasPending = request?.deliveryDateRequests.some((proposal) =>
        proposal.itemIndex === itemIndex && proposal.status === "pending",
      );
      return !!item && !hasPending && !!date && /^\d{4}-\d{2}-\d{2}$/.test(date)
        && date !== item.expectedDeliveryDate;
    });

  return (
    <section className="delivery-date-page">
      <div className="page-heading">
        <div>
          <p className="eyebrow">ĐIỀU CHỈNH KẾ HOẠCH</p>
          <h1>Đổi ngày giao hàng</h1>
          <p className="muted">{admin
            ? "Chọn nhiều mặt hàng ở các phiếu khác nhau, hoặc chọn toàn bộ mặt hàng của một phiếu."
            : "Gửi đề nghị đổi ngày cho các phiếu của bạn; admin sẽ xem xét và phản hồi."
          }</p>
        </div>
        {!admin && <span className="count">{receivedPendingProposals.length} yêu cầu chờ bạn phản hồi</span>}
      </div>

      <div className="panel delivery-date-filters-panel">
        <div className="filters">
          <input
            className="text-input search-input"
            placeholder="Tìm NCC, email, mã hàng…"
            value={search}
            onChange={(event) => { setSearch(event.target.value); setRequestPage(0); setInboxPage(0); setHistoryPage(0); }}
          />
          <select className="text-input filter-select" value={status} onChange={(event) => { setStatus(event.target.value); setRequestPage(0); setInboxPage(0); setHistoryPage(0); }}>
            <option value="all">Tất cả trạng thái</option>
            <option value="pending">Chờ duyệt</option>
            <option value="approved">Đã duyệt</option>
            <option value="reminded">Đã nhắc giao</option>
            <option value="overdue">Trễ giao</option>
            <option value="delivered">Đã giao hàng</option>
            <option value="rejected">Từ chối</option>
          </select>
          <select className="text-input filter-select" value={supplier} onChange={(event) => { setSupplier(event.target.value); setRequestPage(0); setInboxPage(0); setHistoryPage(0); }}>
            <option value="all">Tất cả nhà cung cấp</option>
            {suppliers.map(([uid, name]) => <option key={uid} value={uid}>{name}</option>)}
          </select>
          <label className="filter-date"><span>Từ ngày giao</span><input className="text-input" type="date" value={deliveryFrom} onChange={(event) => { setDeliveryFrom(event.target.value); setRequestPage(0); setInboxPage(0); setHistoryPage(0); }} /></label>
          <label className="filter-date"><span>Đến ngày giao</span><input className="text-input" type="date" value={deliveryTo} onChange={(event) => { setDeliveryTo(event.target.value); setRequestPage(0); setInboxPage(0); setHistoryPage(0); }} /></label>
        </div>
        <div className="filter-summary">
          <span>Đang hiển thị <strong>{admin ? rows.length : pendingProposals.length + proposalHistory.length}</strong> mục</span>
          <button className="clear-filters" type="button" onClick={resetFilters}>Xóa bộ lọc</button>
        </div>
      </div>

          <section className="panel delivery-date-selection-panel">
            <div className="delivery-date-selection-heading">
              <div><h2>{admin ? "Chọn phiếu và mặt hàng" : "Chọn mặt hàng trong phiếu của bạn"}</h2><p className="muted small">Ngày mới được thiết lập riêng cho từng mặt hàng; bên còn lại sẽ duyệt đề nghị.</p></div>
              <span className="count">{selectedCount} mặt hàng đã chọn</span>
            </div>
            <div className="delivery-date-selection-list">
              {visibleRows.length === 0 ? <p className="muted small">Không tìm thấy mặt hàng phù hợp.</p> : visibleRows.map(({ request, item, itemIndex, pending, key, itemDate }) => {
                const requestKeys = request.items.map((_, index) => `${request.id}:${index}`);
                const selectableKeys = requestKeys.filter((entryKey) => {
                  const index = Number(entryKey.split(":")[1]);
                  return !request.deliveryDateRequests.some((proposal) => proposal.itemIndex === index && proposal.status === "pending");
                });
                const allSelected = selectableKeys.length > 0 && selectableKeys.every((entryKey) => entryKey in selectedItems);
                return (
                  <article className="delivery-date-select-row" key={key}>
                    <label className="delivery-date-checkbox">
                      <input
                        type="checkbox"
                        checked={key in selectedItems}
                        disabled={!!pending}
                        onChange={(event) => toggleItem(key, event.target.checked)}
                      />
                    </label>
                    <div className="delivery-date-select-info">
                      <div className="delivery-date-select-request">
                        <button type="button" className="delivery-date-request-link" onClick={() => onOpenRequest(request.id)}>
                          {request.supplierName} · Phiếu ngày {formatDeliveryDate(request.deliveryDate)}
                        </button>
                        <button type="button" className="delivery-date-select-all" disabled={selectableKeys.length === 0} onClick={() => toggleRequest(request, !allSelected)}>
                          {allSelected ? "Bỏ chọn phiếu" : "Chọn cả phiếu"}
                        </button>
                      </div>
                      <strong>{item.materialName || item.name || `Mặt hàng dòng ${itemIndex + 1}`}{item.sku ? ` · ${item.sku}` : ""}</strong>
                      {admin && <span>Nhà cung cấp: {request.supplierName} · {request.ownerEmail}</span>}
                      <span>Trạng thái phiếu: {statusLabels[request.status]}</span>
                      <span>Ngày giao của dòng hàng: {formatDeliveryDate(itemDate)}</span>
                      <div className="delivery-date-item-details">
                        {EXCEL_TEMPLATE.columns.map((column) => (
                          <span key={column.key}><small>{column.label}</small><strong>{column.key === "expectedDeliveryDate" ? formatDeliveryDate(item[column.key] || request.deliveryDate) : item[column.key] || "—"}</strong></span>
                        ))}
                      </div>
                      {pending && <small className="delivery-date-proposal-status pending">Đang chờ phản hồi cho ngày {pending.requestedDate}</small>}
                    </div>
                    {key in selectedItems && (
                      <label className="delivery-date-new-date">
                        <span>Ngày mới</span>
                        <input
                          className="text-input"
                          type="date"
                          value={selectedItems[key]}
                          onChange={(event) => setSelectedItems((current) => ({ ...current, [key]: event.target.value }))}
                        />
                      </label>
                    )}
                  </article>
                );
              })}
            </div>
            <Pagination page={requestPage} pageSize={PAGE_SIZE} total={rows.length} onPageChange={setRequestPage} />
            <div className="delivery-date-submit-row">
              <button type="button" className="button secondary" onClick={() => setSelectedItems({})} disabled={!selectedCount || saving}>Bỏ chọn tất cả</button>
              <button type="button" className="button primary" onClick={submit} disabled={!selectionReady || saving}>
                {saving ? "Đang gửi yêu cầu…" : `Gửi ${selectedCount} đề nghị đổi ngày`}
              </button>
            </div>
          </section>

          {sentPendingProposals.length > 0 && (
            <section className="panel delivery-date-history-panel">
              <h2>Đề nghị đang chờ phản hồi</h2>
              {visibleSentPendingProposals.map(({ request, proposal }) => (
                <article className="delivery-date-history-row" key={`${request.id}:${proposal.id}`}>
                  <div>
                    <strong>{request.supplierName} · {proposal.itemName || request.items[proposal.itemIndex]?.materialName || `Mặt hàng dòng ${proposal.itemIndex + 1}`}</strong>
                    <span>{formatDeliveryDate(proposal.currentDate)} → {formatDeliveryDate(proposal.requestedDate)}</span>
                  </div>
                  <small className="delivery-date-proposal-status pending">Chờ bên kia phản hồi</small>
                </article>
              ))}
              <Pagination page={inboxPage} pageSize={PAGE_SIZE} total={sentPendingProposals.length} onPageChange={setInboxPage} />
            </section>
          )}

          <section className="panel delivery-date-inbox">
            <h2>{admin ? "Đề nghị từ nhà cung cấp cần duyệt" : "Đề nghị từ admin cần phản hồi"}</h2>
            {receivedPendingProposals.length === 0 ? <p className="muted small">Không có đề nghị nào đang chờ bạn phản hồi.</p> : visibleReceivedPendingProposals.map(({ request, proposal }) => (
              <article className="delivery-date-inbox-row" key={`${request.id}:${proposal.id}`}>
                <div className="delivery-date-proposal-copy">
                  <button type="button" className="delivery-date-request-link" onClick={() => onOpenRequest(request.id)}>
                    {request.supplierName} · {proposal.itemName || request.items[proposal.itemIndex]?.materialName || `Mặt hàng dòng ${proposal.itemIndex + 1}`}
                  </button>
                  <span>{proposal.itemSku ? `Mã ${proposal.itemSku} · ` : ""}Ngày hiện tại: {formatDeliveryDate(proposal.currentDate)} → Đề xuất: {formatDeliveryDate(proposal.requestedDate)}</span>
                  <small>Đề nghị bởi {proposal.createdByEmail}</small>
                </div>
                <div className="delivery-date-proposal-actions">
                  <button type="button" className="button primary" disabled={saving} onClick={() => onRespond(request.id, proposal.id, true)}>Chấp nhận</button>
                  <button type="button" className="button secondary" disabled={saving} onClick={() => onRespond(request.id, proposal.id, false)}>Từ chối</button>
                </div>
              </article>
            ))}
            <Pagination page={inboxPage} pageSize={PAGE_SIZE} total={receivedPendingProposals.length} onPageChange={setInboxPage} />
          </section>

          <section className="panel delivery-date-history-panel">
            <h2>Lịch sử phản hồi</h2>
            {proposalHistory.length === 0 ? <p className="muted small">Chưa có đề nghị nào được phản hồi.</p> : visibleProposalHistory.map(({ request, proposal }) => (
              <article className="delivery-date-history-row" key={`${request.id}:${proposal.id}`}>
                <div>
                  <strong>{request.supplierName} · {proposal.itemName || request.items[proposal.itemIndex]?.materialName || `Mặt hàng dòng ${proposal.itemIndex + 1}`}</strong>
                  <span>{formatDeliveryDate(proposal.currentDate)} → {formatDeliveryDate(proposal.requestedDate)}</span>
                </div>
                <small className={`delivery-date-proposal-status ${proposal.status}`}>{proposalStatus(proposal.status)}</small>
              </article>
            ))}
            <Pagination page={historyPage} pageSize={PAGE_SIZE} total={proposalHistory.length} onPageChange={setHistoryPage} />
          </section>
    </section>
  );
}

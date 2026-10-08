import { useMemo, useState } from "react";
import Pagination from "./Pagination";
import type { DeliveryDateChangeSelection, DeliveryRequest } from "../types";

const PAGE_SIZE = 12;

interface DeliveryDateRequestsPageProps {
  requests: DeliveryRequest[];
  admin: boolean;
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
  saving,
  onSubmit,
  onRespond,
  onOpenRequest,
}: DeliveryDateRequestsPageProps) {
  const [selectedItems, setSelectedItems] = useState<Record<string, string>>({});
  const [requestPage, setRequestPage] = useState(0);
  const [inboxPage, setInboxPage] = useState(0);
  const [historyPage, setHistoryPage] = useState(0);

  const rows = useMemo(() => requests.flatMap((request) =>
    request.items.map((item, itemIndex) => {
      const pending = request.deliveryDateRequests.find((proposal) =>
        proposal.itemIndex === itemIndex && proposal.status === "pending",
      );
      const key = `${request.id}:${itemIndex}`;
      return { request, item, itemIndex, pending, key };
    }),
  ), [requests]);

  const pendingProposals = useMemo(() => requests.flatMap((request) =>
    request.deliveryDateRequests
      .filter((proposal) => proposal.status === "pending")
      .map((proposal) => ({ request, proposal })),
  ), [requests]);

  const proposalHistory = useMemo(() => requests.flatMap((request) =>
    request.deliveryDateRequests
      .filter((proposal) => proposal.status !== "pending")
      .map((proposal) => ({ request, proposal })),
  ), [requests]);

  const visibleRows = rows.slice(requestPage * PAGE_SIZE, (requestPage + 1) * PAGE_SIZE);
  const visiblePendingProposals = pendingProposals.slice(inboxPage * PAGE_SIZE, (inboxPage + 1) * PAGE_SIZE);
  const visibleProposalHistory = proposalHistory.slice(historyPage * PAGE_SIZE, (historyPage + 1) * PAGE_SIZE);
  const selectedCount = Object.keys(selectedItems).length;

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
      const row = rows.find((entry) => entry.request.id === requestId && entry.itemIndex === Number(index));
      return !!row && !!date && /^\d{4}-\d{2}-\d{2}$/.test(date)
        && date !== row.item.expectedDeliveryDate;
    });

  return (
    <section className="delivery-date-page">
      <div className="page-heading">
        <div>
          <p className="eyebrow">ĐIỀU CHỈNH KẾ HOẠCH</p>
          <h1>Đổi ngày giao hàng</h1>
          <p className="muted">{admin
            ? "Chọn nhiều mặt hàng ở các phiếu khác nhau, hoặc chọn toàn bộ mặt hàng của một phiếu."
            : "Xem yêu cầu đổi ngày giao từ admin, sau đó chấp nhận hoặc từ chối."
          }</p>
        </div>
        {!admin && <span className="count">{pendingProposals.length} yêu cầu chờ</span>}
      </div>

      {admin ? (
        <>
          <section className="panel delivery-date-selection-panel">
            <div className="delivery-date-selection-heading">
              <div><h2>Chọn phiếu và mặt hàng</h2><p className="muted small">Ngày mới được thiết lập riêng cho từng mặt hàng đã chọn.</p></div>
              <span className="count">{selectedCount} mặt hàng đã chọn</span>
            </div>
            <div className="delivery-date-selection-list">
              {visibleRows.length === 0 ? <p className="muted small">Chưa có mặt hàng trong các phiếu.</p> : visibleRows.map(({ request, item, itemIndex, pending, key }) => {
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
                          {request.supplierName} · Phiếu ngày {request.deliveryDate || "chưa xác định"}
                        </button>
                        <button type="button" className="delivery-date-select-all" disabled={selectableKeys.length === 0} onClick={() => toggleRequest(request, !allSelected)}>
                          {allSelected ? "Bỏ chọn phiếu" : "Chọn cả phiếu"}
                        </button>
                      </div>
                      <strong>{item.name || `Mặt hàng dòng ${itemIndex + 1}`}{item.sku ? ` · ${item.sku}` : ""}</strong>
                      <span>Ngày hiện tại: {item.expectedDeliveryDate || "Chưa có ngày"}</span>
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
                {saving ? "Đang gửi yêu cầu…" : `Gửi ${selectedCount} yêu cầu đổi ngày`}
              </button>
            </div>
          </section>
          <section className="panel delivery-date-history-panel">
            <h2>Yêu cầu đã gửi</h2>
            {proposalHistory.length === 0 ? <p className="muted small">Chưa có yêu cầu nào được phản hồi.</p> : visibleProposalHistory.map(({ request, proposal }) => (
              <article className="delivery-date-history-row" key={`${request.id}:${proposal.id}`}>
                <div>
                  <strong>{request.supplierName} · {proposal.itemName || `Mặt hàng ${proposal.itemIndex + 1}`}</strong>
                  <span>{proposal.currentDate} → {proposal.requestedDate}</span>
                </div>
                <small className={`delivery-date-proposal-status ${proposal.status}`}>{proposalStatus(proposal.status)}</small>
              </article>
            ))}
            <Pagination page={historyPage} pageSize={PAGE_SIZE} total={proposalHistory.length} onPageChange={setHistoryPage} />
          </section>
        </>
      ) : (
        <section className="panel delivery-date-inbox">
          <h2>Yêu cầu đang chờ phản hồi</h2>
          {pendingProposals.length === 0 ? <p className="muted small">Hiện không có yêu cầu đổi ngày giao nào đang chờ.</p> : visiblePendingProposals.map(({ request, proposal }) => (
            <article className="delivery-date-inbox-row" key={`${request.id}:${proposal.id}`}>
              <div className="delivery-date-proposal-copy">
                <button type="button" className="delivery-date-request-link" onClick={() => onOpenRequest(request.id)}>
                  {request.supplierName} · {proposal.itemName || `Mặt hàng ${proposal.itemIndex + 1}`}
                </button>
                <span>{proposal.itemSku ? `Mã ${proposal.itemSku} · ` : ""}Ngày hiện tại: {proposal.currentDate} → Đề xuất: {proposal.requestedDate}</span>
                <small>Đề nghị bởi {proposal.createdByEmail}</small>
              </div>
              <div className="delivery-date-proposal-actions">
                <button type="button" className="button primary" disabled={saving} onClick={() => onRespond(request.id, proposal.id, true)}>Chấp nhận</button>
                <button type="button" className="button secondary" disabled={saving} onClick={() => onRespond(request.id, proposal.id, false)}>Từ chối</button>
              </div>
            </article>
          ))}
          <Pagination page={inboxPage} pageSize={PAGE_SIZE} total={pendingProposals.length} onPageChange={setInboxPage} />
          <h2 className="delivery-date-history-heading">Lịch sử phản hồi</h2>
          {proposalHistory.length === 0 ? <p className="muted small">Chưa có phản hồi nào.</p> : visibleProposalHistory.map(({ request, proposal }) => (
            <article className="delivery-date-history-row" key={`${request.id}:${proposal.id}`}>
              <div>
                <strong>{request.supplierName} · {proposal.itemName || `Mặt hàng ${proposal.itemIndex + 1}`}</strong>
                <span>{proposal.currentDate} → {proposal.requestedDate}</span>
              </div>
              <small className={`delivery-date-proposal-status ${proposal.status}`}>{proposalStatus(proposal.status)}</small>
            </article>
          ))}
          <Pagination page={historyPage} pageSize={PAGE_SIZE} total={proposalHistory.length} onPageChange={setHistoryPage} />
        </section>
      )}
    </section>
  );
}

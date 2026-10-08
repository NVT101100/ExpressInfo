import { useEffect, useState } from "react";
import { EXCEL_TEMPLATE } from "../config";
import type { DeliveryItem, MentionTarget } from "../types";
import Pagination from "./Pagination";

const PAGE_SIZE = 20;

export default function ItemsEditor({
  items,
  onChange,
  onRemove,
  highlightTarget,
  disabled = false,
}: {
  items: DeliveryItem[];
  onChange: (index: number, key: string, value: string) => void;
  onRemove?: (index: number) => void;
  highlightTarget?: MentionTarget | null;
  disabled?: boolean;
}) {
  const [page, setPage] = useState(0);
  const pageCount = Math.ceil(items.length / PAGE_SIZE);
  const visibleItems = items.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  useEffect(() => {
    if (highlightTarget?.field === "item" && highlightTarget.itemIndex !== undefined) {
      setPage(Math.floor(highlightTarget.itemIndex / PAGE_SIZE));
    } else if (page >= pageCount) {
      setPage(Math.max(0, pageCount - 1));
    }
  }, [highlightTarget, page, pageCount]);

  return (
    <div className="items-editor">
      <div className="items-editor-heading">
        <strong>Kiểm tra danh sách đã đọc</strong>
        <span>{items.length} dòng</span>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              {EXCEL_TEMPLATE.columns.map((column) => (
                <th key={column.key}>{column.label.toUpperCase()}</th>
              ))}
              {onRemove && <th aria-label="Thao tác" />}
            </tr>
          </thead>
          <tbody>
            {visibleItems.map((item, pageIndex) => {
              const index = page * PAGE_SIZE + pageIndex;
              return (
              <tr
                key={index}
                className={highlightTarget?.field === "item" && highlightTarget.itemIndex === index ? "mention-highlight-row" : ""}
              >
                {EXCEL_TEMPLATE.columns.map((column) => (
                  <td
                    key={column.key}
                    className={highlightTarget?.field === "item"
                      && highlightTarget.itemIndex === index
                      && highlightTarget.itemKey === column.key
                      ? "mention-highlight-cell"
                      : ""}
                  >
                    <input
                      id={`request-item-${index}-${column.key}`}
                      aria-label={`${column.label}, dòng ${index + 1}`}
                      className={highlightTarget?.field === "item"
                        && highlightTarget.itemIndex === index
                        && highlightTarget.itemKey === column.key
                        ? "mention-highlight"
                        : ""}
                      value={item[column.key] ?? ""}
                      disabled={disabled}
                      onChange={(event) =>
                        onChange(index, column.key, event.target.value)
                      }
                    />
                  </td>
                ))}
                {onRemove && <td className="item-remove-cell">
                  <button type="button" className="button danger item-remove-button" aria-label={`Xóa dòng ${index + 1}`} title={items.length <= 1 ? "Phiếu cần ít nhất một dòng hàng." : undefined} disabled={disabled || items.length <= 1} onClick={() => onRemove(index)}>Xóa dòng</button>
                </td>}
              </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <Pagination page={page} pageSize={PAGE_SIZE} total={items.length} onPageChange={setPage} />
    </div>
  );
}

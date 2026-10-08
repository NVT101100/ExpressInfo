import { EXCEL_TEMPLATE } from "../config";
import type {
  DeliveryItem,
  DeliveryDateRequest,
  DeliveryRequest,
  RequestDocument,
  RequestStatus,
  RevisionDocument,
} from "../types";

export const statusLabels: Record<RequestStatus, string> = {
  pending: "Chờ duyệt",
  approved: "Đã duyệt",
  rejected: "Từ chối",
  reminded: "Đã nhắc giao",
  overdue: "Trễ giao",
  delivered: "Đã giao hàng",
};

export function formatDate(value?: number | null) {
  if (!value) return "Vừa xong";
  return new Intl.DateTimeFormat("vi-VN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export function daysUntilDelivery(deliveryDate: string, now = new Date()) {
  const [year, month, day] = deliveryDate.split("-").map(Number);
  if (!year || !month || !day) return null;
  const deliveryDay = new Date(year, month - 1, day);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((deliveryDay.getTime() - today.getTime()) / 86_400_000);
}

export function deliveryCountdownLabel(days: number | null) {
  if (days === null) return "Chưa có ngày giao";
  if (days < 0) return `Trễ ${Math.abs(days)} ngày`;
  if (days === 0) return "Giao hôm nay";
  if (days === 1) return "Còn 1 ngày";
  return `Còn ${days} ngày`;
}

export function deliveryTone(
  deliveryDate: string,
  status: RequestStatus,
  now = new Date(),
) {
  if (status === "delivered") return "delivered";
  const days = daysUntilDelivery(deliveryDate, now);
  if (days !== null && days < 0 && ["approved", "reminded", "overdue"].includes(status)) return "overdue";
  if (days === 0) return "today";
  if (days !== null && days > 0 && days <= 2) return "soon";
  return "upcoming";
}

function isValidIsoDate(value: string) {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return false;
  const [, yearText, monthText, dayText] = match;
  const date = new Date(Date.UTC(Number(yearText), Number(monthText) - 1, Number(dayText)));
  return date.getUTCFullYear() === Number(yearText)
    && date.getUTCMonth() === Number(monthText) - 1
    && date.getUTCDate() === Number(dayText);
}

function isoDateFromDate(date: Date) {
  if (Number.isNaN(date.getTime())) return "";
  const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  if (Number.isNaN(localDate.getTime())) return "";
  return localDate.toISOString().slice(0, 10);
}

function isoDateFromExcelSerial(serial: number) {
  const date = new Date(Date.UTC(1899, 11, 30) + Math.floor(serial) * 86_400_000);
  if (Number.isNaN(date.getTime())) return "";
  const isoDate = date.toISOString().slice(0, 10);
  return isValidIsoDate(isoDate) ? isoDate : "";
}

function normalizeDeliveryDate(value: unknown, displayValue: string) {
  if (value instanceof Date) return isoDateFromDate(value);
  if (typeof value === "number" && Number.isFinite(value)) {
    if (Number.isInteger(value) && value >= 10_000_000 && value <= 99_999_999) {
      const compactDate = String(value);
      const isoDate = `${compactDate.slice(0, 4)}-${compactDate.slice(4, 6)}-${compactDate.slice(6, 8)}`;
      return isValidIsoDate(isoDate) ? isoDate : "";
    }
    if (value >= 100_000_000_000) return isoDateFromDate(new Date(value));
    if (value >= 1_000_000_000) return isoDateFromDate(new Date(value * 1_000));
    return isoDateFromExcelSerial(value);
  }

  const raw = displayValue.trim();
  const compactDate = raw.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (compactDate) {
    const isoDate = `${compactDate[1]}-${compactDate[2]}-${compactDate[3]}`;
    return isValidIsoDate(isoDate) ? isoDate : "";
  }
  const isoDate = raw.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (isoDate) {
    const normalized = `${isoDate[1]}-${isoDate[2].padStart(2, "0")}-${isoDate[3].padStart(2, "0")}`;
    return isValidIsoDate(normalized) ? normalized : "";
  }
  const dayFirstDate = raw.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
  if (dayFirstDate) {
    const normalized = `${dayFirstDate[3]}-${dayFirstDate[2].padStart(2, "0")}-${dayFirstDate[1].padStart(2, "0")}`;
    return isValidIsoDate(normalized) ? normalized : "";
  }
  if (/^\d+$/.test(raw)) {
    const numericValue = Number(raw);
    if (Number.isSafeInteger(numericValue)) {
      return normalizeDeliveryDate(numericValue, "");
    }
  }
  return "";
}

export function requestFromSnapshot(
  id: string,
  value: Record<string, unknown>,
): DeliveryRequest {
  const original = value as unknown as RequestDocument & {
    revisions?: Record<string, Omit<RevisionDocument, "id">>;
    deliveryDateRequests?: Record<string, Omit<DeliveryDateRequest, "id">>;
  };
  const legacyDelivery = original.deliveryAt?.split("T") ?? ["", ""];
  const revisions = Object.entries(original.revisions ?? {})
    .map(([revisionId, revision]) => ({ ...revision, id: revisionId }))
    .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
  const deliveryDateRequests = Object.entries(original.deliveryDateRequests ?? {})
    .map(([proposalId, proposal]) => ({ ...proposal, id: proposalId }))
    .sort((a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id));
  const effective: DeliveryRequest = {
    ...original,
    supplierName: original.supplierName || original.ownerName,
    deliveryGroup: original.deliveryGroup || "",
    deliveryDate: original.deliveryDate || legacyDelivery[0] || "",
    id,
    revisions,
    deliveryDateRequests,
    status: "pending",
    deleted: false,
  };
  for (const revision of revisions) {
    const changes = revision.changes;
    if (!changes) {
      if (revision.status) effective.status = revision.status;
      if (revision.deleted !== undefined) effective.deleted = revision.deleted;
      continue;
    }
    if (changes.supplierName !== undefined) effective.supplierName = changes.supplierName;
    if (changes.deliveryGroup !== undefined) effective.deliveryGroup = changes.deliveryGroup;
    if (changes.deliveryDate !== undefined) effective.deliveryDate = changes.deliveryDate;
    if (changes.deliveryTime !== undefined) effective.deliveryTime = changes.deliveryTime;
    if (changes.recipientEmail !== undefined) effective.recipientEmail = changes.recipientEmail;
    if (changes.notes !== undefined) effective.notes = changes.notes;
    if (changes.items) effective.items = changes.items.map((item) => ({ ...item }));
    if (changes.attachments) {
      effective.attachments = {
        ...effective.attachments,
        ...changes.attachments,
      };
    }
    if (changes.itemChanges) {
      effective.items = effective.items.map((item, index) => {
        const changedFields = changes.itemChanges?.filter(
          (change) => change.index === index,
        );
        return changedFields?.length
          ? {
              ...item,
              ...Object.fromEntries(
                changedFields.map((change) => [change.key, change.value]),
              ),
            }
          : item;
      });
    }
    if (revision.status) effective.status = revision.status;
    if (revision.deleted !== undefined) effective.deleted = revision.deleted;
  }
  return effective;
}

export async function parseSpreadsheet(file: File): Promise<DeliveryItem[]> {
  if (!file.name.toLowerCase().endsWith(".xlsx")) {
    throw new Error("Vui lòng tải file .xlsx.");
  }
  const { default: ExcelJS } = await import("exceljs");
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await file.arrayBuffer());
  const sheet = workbook.worksheets[EXCEL_TEMPLATE.sheetIndex];
  if (!sheet) throw new Error("Không tìm thấy sheet theo cấu hình mẫu.");
  const headerIndex = EXCEL_TEMPLATE.headerRow - 1;
  const headerRow = sheet.getRow(EXCEL_TEMPLATE.headerRow);
  const headers = Array.from(
    { length: headerRow.cellCount },
    (_, index) => headerRow.getCell(index + 1).text.trim(),
  );
  const columnIndexes = EXCEL_TEMPLATE.columns.map((column) =>
    headers.findIndex(
      (header) => header.toLocaleLowerCase() === column.label.toLocaleLowerCase(),
    ),
  );
  const missing = EXCEL_TEMPLATE.columns.filter(
    (column, index) => column.key !== "unit" && columnIndexes[index] < 0,
  );
  if (missing.length) {
    throw new Error(
      `Thiếu cột: ${missing.map((column) => column.label).join(", ")}. Hãy kiểm tra EXCEL_TEMPLATE trong src/config.ts.`,
    );
  }

  const items: DeliveryItem[] = [];
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber <= headerIndex + 1) return;
    const item = Object.fromEntries(
      EXCEL_TEMPLATE.columns.map((column, index) => {
        if (columnIndexes[index] < 0) return [column.key, ""];
        const cell = row.getCell(columnIndexes[index] + 1);
        const value = cell.value;
        if (column.key === "expectedDeliveryDate") {
          return [column.key, normalizeDeliveryDate(value, cell.text)];
        }
        return [column.key, cell.text.trim()];
      }),
    ) as DeliveryItem;
    if (Object.values(item).some(Boolean)) items.push(item);
  });
  if (items.length === 0) throw new Error("File Excel không có dòng hàng hóa.");
  if (items.some((item) => !isValidIsoDate(item.expectedDeliveryDate ?? ""))) {
    throw new Error("Cột “Ngày giao dự kiến” phải có ngày hợp lệ ở tất cả các dòng.");
  }
  if (items.length > EXCEL_TEMPLATE.maxRows) {
    throw new Error(`Tối đa ${EXCEL_TEMPLATE.maxRows} dòng hàng hóa.`);
  }
  return items;
}

export async function exportRequests(requests: DeliveryRequest[]) {
  const { default: ExcelJS } = await import("exceljs");
  const rows = requests.flatMap((request) =>
    request.items.map((item) => ({
      "Nhà cung cấp": request.supplierName,
      "Nhóm hàng hóa": request.deliveryGroup ?? "",
      Email: request.ownerEmail,
      "Ngày giao": request.deliveryDate,
      "Trạng thái": statusLabels[request.status],
      "Ngày gửi": request.createdAt
        ? new Date(request.createdAt).toLocaleString("vi-VN")
        : "",
      "File kế hoạch": request.attachments?.deliveryPlan?.url ?? "",
      "Giấy giới thiệu": request.attachments?.companyIntroduction?.url ?? "",
      ...Object.fromEntries(
        EXCEL_TEMPLATE.columns.map((column) => [
          column.label,
          item[column.key] ?? "",
        ]),
      ),
    })),
  );
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet("Danh sách giao hàng");
  const headers = [
    "Nhà cung cấp",
    "Nhóm hàng hóa",
    "Email",
    "Ngày giao",
    "Trạng thái",
    "Ngày gửi",
    "File kế hoạch",
    "Giấy giới thiệu",
    ...EXCEL_TEMPLATE.columns.map((column) => column.label),
  ];
  worksheet.columns = headers.map((header) => ({
    header,
    key: header,
    width: Math.max(16, header.length + 4),
  }));
  worksheet.addRows(rows);
  const buffer = await workbook.xlsx.writeBuffer();
  const url = URL.createObjectURL(
    new Blob([buffer], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = "tong-hop-giao-hang.xlsx";
  link.click();
  URL.revokeObjectURL(url);
}

export async function downloadDeliveryTemplate() {
  const { default: ExcelJS } = await import("exceljs");
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet("Kế hoạch giao hàng");
  worksheet.columns = EXCEL_TEMPLATE.columns.map((column) => ({
    header: column.label,
    key: column.key,
    width: Math.max(18, column.label.length + 6),
  }));
  worksheet.addRow(Object.fromEntries(EXCEL_TEMPLATE.columns.map((column) => [column.key, ""])));
  worksheet.views = [{ state: "frozen", ySplit: 1 }];
  worksheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: EXCEL_TEMPLATE.columns.length },
  };
  worksheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  worksheet.getRow(1).fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF16734D" },
  };
  const buffer = await workbook.xlsx.writeBuffer();
  const url = URL.createObjectURL(
    new Blob([buffer], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = "mau-ke-hoach-giao-hang.xlsx";
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

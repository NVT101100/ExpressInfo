export const DELIVERY_GROUP = "MRO.2: Vật tư thông dụng & Công cụ dụng cụ";
export const GOOGLE_DRIVE_DELIVERY_FOLDER_ID = "12aFQCfhkFEl0dfhjODwn2X_H_a9mBm6r";

export const EXCEL_TEMPLATE = {
  sheetIndex: 0,
  headerRow: 1,
  maxRows: 500,
  columns: [
    { key: "serialNumber", label: "STT" },
    { key: "responsibleStaff", label: "Nhân sự phụ trách" },
    { key: "deliveryLocation", label: "Địa điểm giao hàng" },
    { key: "poNumber", label: "Số PO" },
    { key: "materialName", label: "Tên vật tư" },
    { key: "deliveryQuantity", label: "Số lượng giao" },
    { key: "expectedDeliveryDate", label: "Ngày giao dự kiến" },
    { key: "notes", label: "Ghi chú" },
  ],
} as const;

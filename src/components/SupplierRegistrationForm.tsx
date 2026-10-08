import type { FormEvent } from "react";
import { DELIVERY_GROUP } from "../config";
import type { DeliveryItem } from "../types";
import ItemsEditor from "./ItemsEditor";

interface SupplierRegistrationFormProps {
  supplierName: string;
  items: DeliveryItem[];
  planFileName: string;
  introductionFileName: string;
  saving: boolean;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onSupplierName: (value: string) => void;
  onPlanFile: (file?: File) => void;
  onDownloadTemplate: () => void;
  onIntroductionFile: (file?: File) => void;
  onItemChange: (index: number, key: string, value: string) => void;
  onRemoveItem: (index: number) => void;
}

export default function SupplierRegistrationForm({
  supplierName,
  items,
  planFileName,
  introductionFileName,
  saving,
  onSubmit,
  onSupplierName,
  onPlanFile,
  onDownloadTemplate,
  onIntroductionFile,
  onItemChange,
  onRemoveItem,
}: SupplierRegistrationFormProps) {
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">NHÀ CUNG CẤP</p>
          <h1>ĐĂNG KÝ GIAO HÀNG</h1>
          <p className="muted">Nhóm MRO.2: Vật tư thông dụng &amp; Công cụ dụng cụ</p>
        </div>
      </div>
      <form className="panel form-panel supplier-delivery-form" onSubmit={onSubmit}>
        <section className="supplier-guidance">
          <p>Kính gửi Quý Nhà cung cấp,</p>
          <p>Để công tác tiếp nhận hàng hóa được diễn ra thuận lợi và nhanh chóng, Quý NCC vui lòng đọc kỹ hướng dẫn và thực hiện đăng ký thông báo giao hàng theo các quy định dưới đây:</p>
          <h4>1. Thời gian gửi thông báo kế hoạch giao hàng</h4>
          <ul>
            <li><strong>Đối với hàng nặng / kềnh càng:</strong> Gửi thông báo trước ít nhất <strong>02 ngày</strong>.</li>
            <li><strong>Đối với hàng nhẹ / nhỏ lẻ:</strong> Gửi thông báo trước ít nhất <strong>01 ngày</strong>.</li>
          </ul>
          <h4>2. Hồ sơ &amp; thông tin yêu cầu</h4>
          <p>Khi thực hiện đăng ký, Quý NCC vui lòng cung cấp đầy đủ thông tin theo biểu mẫu, đính kèm file tổng hợp kế hoạch giao hàng và giấy giới thiệu của công ty.</p>
          <p><strong>Lưu ý:</strong> Vui lòng tham khảo danh sách giao hàng chi tiết để điền đầy đủ và chính xác thông tin trước khi gửi thông báo.</p>
          <p>Trân trọng cảm ơn sự hợp tác của Quý NCC!</p>
        </section>

        <div className="form-fields-grid">
          <label className="field">
            <span className="field-label">1. Nhóm hàng hóa</span>
            <input className="text-input" value={DELIVERY_GROUP} readOnly />
          </label>
          <label className="field">
            <span className="field-label">2. Tên Nhà cung cấp</span>
            <input className="text-input" value={supplierName} onChange={(event) => onSupplierName(event.target.value)} required maxLength={160} placeholder="Tên công ty / nhà cung cấp" />
          </label>
        </div>

        <div className="section-title supplier-attachment-title">
          <span className="step">03</span>
          <div><h2>Đính kèm hồ sơ</h2><p>File được lưu trong thư mục Google Drive dùng chung của công ty. Danh sách Excel cũng được parse để kiểm tra và lưu thành dữ liệu phiếu.</p></div>
        </div>
        <div className="supplier-attachment-grid">
          <div className="supplier-plan-upload">
            <label className="upload-zone">
              <input type="file" accept=".xlsx" disabled={saving} onChange={(event) => {
                onPlanFile(event.target.files?.[0]);
                event.currentTarget.value = "";
              }} />
              <span className="upload-icon">↑</span>
              <strong>{planFileName || "3. Đính kèm file kế hoạch giao hàng (.xlsx)"}</strong>
              <span className="muted small">Cột: STT, Nhân sự phụ trách, Địa điểm giao hàng, Số PO, Tên vật tư, Số lượng giao, Đơn vị tính, Ngày giao dự kiến, Ghi chú</span>
            </label>
            <button type="button" className="button secondary" onClick={onDownloadTemplate}>↓ Tải file Excel mẫu</button>
          </div>
          <label className="upload-zone">
            <input type="file" accept=".pdf,.doc,.docx,.jpg,.jpeg,.png" disabled={saving} onChange={(event) => {
              onIntroductionFile(event.target.files?.[0]);
              event.currentTarget.value = "";
            }} />
            <span className="upload-icon">↑</span>
            <strong>{introductionFileName || "4. Đính kèm giấy giới thiệu của công ty"}</strong>
            <span className="muted small">PDF, Word hoặc ảnh</span>
          </label>
        </div>
        {items.length > 0 && (
          <div className="supplier-parsed-items">
            <div className="section-title"><span className="step">05</span><div><h2>Kiểm tra danh sách giao hàng</h2><p>{items.length} dòng đã được đọc từ Excel. Có thể chỉnh sửa hoặc xóa dòng trước khi gửi.</p></div></div>
            <ItemsEditor items={items} onChange={onItemChange} onRemove={onRemoveItem} disabled={saving} />
          </div>
        )}
        <div className="form-footer">
          <span className="muted small">{items.length ? `${items.length} dòng hàng hóa · Đính kèm đủ 2 file để gửi đăng ký` : "Chọn file kế hoạch .xlsx để đọc danh sách hàng hóa."}</span>
          <button className="button primary" disabled={saving || items.length === 0 || !planFileName || !introductionFileName}>{saving ? "Đang gửi…" : "Gửi đăng ký →"}</button>
        </div>
      </form>
    </>
  );
}

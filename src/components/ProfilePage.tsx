import { useEffect, useState, type FormEvent } from "react";
import type { User } from "firebase/auth";
import type { UserProfile } from "../types";

interface ProfilePageProps {
  user: User;
  profile: UserProfile;
  saving: boolean;
  onSave: (profile: UserProfile) => void;
}

export default function ProfilePage({
  user,
  profile,
  saving,
  onSave,
}: ProfilePageProps) {
  const [draft, setDraft] = useState(profile);

  useEffect(() => setDraft(profile), [profile]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSave({
      displayName: draft.displayName.trim(),
      organization: draft.organization.trim(),
      phone: draft.phone.trim(),
    });
  }

  return (
    <section className="profile-page">
      <div className="page-heading">
        <div>
          <p className="eyebrow">TÀI KHOẢN</p>
          <h1>Hồ sơ của tôi</h1>
          <p className="muted">Cập nhật thông tin liên hệ của tài khoản nhà cung cấp hoặc quản trị viên.</p>
        </div>
      </div>
      <form className="panel profile-panel" onSubmit={handleSubmit}>
        <div className="profile-identity">
          <div className="avatar profile-avatar">{(draft.displayName || user.email || "U").slice(0, 1).toUpperCase()}</div>
          <div><strong>{user.email}</strong><span>Đăng nhập Google</span></div>
        </div>
        <div className="form-fields-grid">
          <label className="field">
            <span className="field-label">Tên hiển thị</span>
            <input className="text-input" value={draft.displayName} onChange={(event) => setDraft({ ...draft, displayName: event.target.value })} maxLength={100} required />
          </label>
          <label className="field">
            <span className="field-label">Tên công ty / nhà cung cấp</span>
            <input className="text-input" value={draft.organization} onChange={(event) => setDraft({ ...draft, organization: event.target.value })} maxLength={160} placeholder="" />
          </label>
          <label className="field">
            <span className="field-label">Số điện thoại liên hệ</span>
            <input className="text-input" type="tel" value={draft.phone} onChange={(event) => setDraft({ ...draft, phone: event.target.value })} maxLength={30} />
          </label>
          <label className="field">
            <span className="field-label">Email đăng nhập</span>
            <input className="text-input" value={user.email ?? ""} disabled />
          </label>
        </div>
        <div className="profile-footer">
          <span className="muted small">Email được xác thực bởi Google và không thể sửa tại đây.</span>
          <button className="button primary" disabled={saving}>{saving ? "Đang lưu…" : "Lưu hồ sơ"}</button>
        </div>
      </form>
    </section>
  );
}

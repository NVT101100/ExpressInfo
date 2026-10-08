import { useEffect, useMemo, useState, type FormEvent } from "react";
import { limitToLast, onValue, orderByChild, query, ref, set } from "firebase/database";
import { formatDate } from "../lib/delivery";
import { db } from "../firebase";
import type { ActivityLog } from "../types";

type ManagedRole = "admin" | "developer" | "user";
interface ManagedUser {
  role: ManagedRole;
  email: string;
  displayName?: string;
}

interface DeepAdminPageProps {
  currentUserUid: string;
}

const actionLabels: Record<ActivityLog["action"], string> = {
  request_created: "Tạo phiếu giao hàng",
  request_updated: "Sửa phiếu giao hàng",
  request_status_changed: "Đổi trạng thái",
  request_deleted: "Xóa phiếu",
  message_sent: "Gửi tin nhắn",
  spreadsheet_uploaded: "Tải bảng tính",
  spreadsheet_exported: "Xuất bảng tính",
  request_viewed: "Xem phiếu",
  page_opened: "Mở trang",
  profile_updated: "Cập nhật hồ sơ",
  signed_in: "Đăng nhập",
  signed_out: "Đăng xuất",
};

export default function DeepAdminPage({ currentUserUid }: DeepAdminPageProps) {
  const [logs, setLogs] = useState<ActivityLog[]>([]);
  const [managedUsers, setManagedUsers] = useState<Array<ManagedUser & { uid: string }>>([]);
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");
  const [roleError, setRoleError] = useState("");
  const [savingUid, setSavingUid] = useState("");
  const [newUser, setNewUser] = useState({ uid: "", email: "", displayName: "", role: "user" as ManagedRole });

  useEffect(() => {
    if (!db) return;
    return onValue(
      ref(db, "roles"),
      (snapshot) => {
        const value = snapshot.val() as Record<string, ManagedUser> | null;
        setManagedUsers(
          Object.entries(value ?? {})
            .filter(([, user]) =>
              ["admin", "developer", "user"].includes(user.role)
              && typeof user.email === "string",
            )
            .map(([uid, user]) => ({ ...user, uid }))
            .sort((a, b) => a.email.localeCompare(b.email)),
        );
        setRoleError("");
      },
      (cause) => setRoleError(`Không tải được danh sách quyền: ${cause.message}`),
    );
  }, []);

  useEffect(() => {
    if (!db) return;
    const logsQuery = query(
      ref(db, "activityLogs"),
      orderByChild("createdAt"),
      limitToLast(1000),
    );
    return onValue(
      logsQuery,
      (snapshot) => {
        const value = snapshot.val() as Record<string, Omit<ActivityLog, "id">> | null;
        setLogs(
          Object.entries(value ?? {})
            .map(([id, entry]) => ({ ...entry, id }))
            .sort((a, b) => b.createdAt - a.createdAt),
        );
        setError("");
      },
      (cause) => setError(`Không tải được activity log: ${cause.message}`),
    );
  }, []);

  const filteredLogs = useMemo(() => {
    const term = search.trim().toLocaleLowerCase();
    if (!term) return logs;
    return logs.filter((entry) =>
      [
        entry.actorEmail,
        entry.action,
        actionLabels[entry.action],
        entry.requestId ?? "",
        entry.details,
      ].join(" ").toLocaleLowerCase().includes(term),
    );
  }, [logs, search]);

  async function saveRole(uid: string, user: ManagedUser): Promise<boolean> {
    if (!db || uid === currentUserUid) return false;
    setSavingUid(uid);
    setRoleError("");
    try {
      await set(ref(db, `roles/${uid}`), user);
      return true;
    } catch (cause) {
      setRoleError(`Không lưu được quyền: ${cause instanceof Error ? cause.message : "lỗi không xác định."}`);
      return false;
    } finally {
      setSavingUid("");
    }
  }

  async function addUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const uid = newUser.uid.trim();
    const email = newUser.email.trim();
    const matchedUser = managedUsers.find(
      (managedUser) => managedUser.uid === uid && managedUser.email.toLowerCase() === email.toLowerCase(),
    );
    if (!db || !uid || !email || !matchedUser) {
      setRoleError("Không tìm thấy email trong danh sách role. Chỉ tra được UID của tài khoản đã có trong DB.");
      return;
    }
    const saved = await saveRole(uid, {
      role: newUser.role,
      email,
      ...(newUser.displayName.trim() ? { displayName: newUser.displayName.trim() } : {}),
    });
    if (saved) setNewUser({ uid: "", email: "", displayName: "", role: "user" });
  }

  return (
    <section className="admin-page deep-admin-page">
      <div className="page-heading admin-heading">
        <div>
          <p className="eyebrow">DEVELOPER CONSOLE</p>
          <h1>Deep Admin · Activity log</h1>
          <p className="muted">Nhật ký realtime toàn ứng dụng · tối đa 1.000 bản ghi gần nhất.</p>
        </div>
        <span className="developer-badge">Developer access</span>
      </div>
      {error && <div className="alert error">{error}</div>}
      <div className="panel table-panel role-management-panel">
        <div className="toolbar">
          <div><h2>Quản lý phân quyền</h2><p className="muted small">{managedUsers.length} tài khoản có role trong Realtime Database</p></div>
        </div>
        {roleError && <div className="alert error role-alert">{roleError}</div>}
        <form className="role-add-form" onSubmit={(event) => void addUser(event)}>
          <input
            className="text-input"
            type="email"
            aria-label="Tra cứu email tài khoản"
            placeholder="Nhập email tài khoản đã có trong DB"
            value={newUser.email}
            onChange={(event) => {
              const email = event.target.value;
              const matchedUser = managedUsers.find(
                (managedUser) => managedUser.email.toLowerCase() === email.trim().toLowerCase(),
              );
              setNewUser({
                uid: matchedUser?.uid ?? "",
                email,
                displayName: matchedUser?.displayName ?? "",
                role: matchedUser?.role ?? "user",
              });
              setRoleError("");
            }}
            required
          />
          <div className="role-lookup-result" aria-live="polite">
            {newUser.uid
              ? <>UID: <strong>{newUser.uid}</strong> · Role hiện tại: <strong>{newUser.role}</strong></>
              : "Nhập email chính xác để tra UID và role trong DB."}
          </div>
          <input
            className="text-input"
            aria-label="Tên hiển thị"
            placeholder="Tên hiển thị (không bắt buộc)"
            value={newUser.displayName}
            onChange={(event) => setNewUser({ ...newUser, displayName: event.target.value })}
            maxLength={160}
          />
          <select
            className="text-input"
            aria-label="Role mới"
            value={newUser.role}
            onChange={(event) => setNewUser({ ...newUser, role: event.target.value as ManagedRole })}
          >
            <option value="user">Người dùng</option>
            <option value="admin">Admin</option>
            <option value="developer">Developer</option>
          </select>
          <button className="button primary" type="submit" disabled={!!savingUid || !newUser.uid}>Cập nhật role</button>
        </form>
        <div className="table-wrap">
          <table>
            <thead><tr><th>UID</th><th>NGƯỜI DÙNG</th><th>ROLE</th></tr></thead>
            <tbody>
              {managedUsers.map((managedUser) => (
                <tr key={managedUser.uid}>
                  <td className="role-uid">{managedUser.uid}</td>
                  <td>{managedUser.displayName || managedUser.email}<br /><span className="muted small">{managedUser.email}</span></td>
                  <td>
                    <select
                      className="text-input role-select"
                      aria-label={`Role của ${managedUser.email}`}
                      value={managedUser.role}
                      disabled={managedUser.uid === currentUserUid || savingUid === managedUser.uid}
                      onChange={(event) => void saveRole(managedUser.uid, {
                        role: event.target.value as ManagedRole,
                        email: managedUser.email,
                        ...(managedUser.displayName ? { displayName: managedUser.displayName } : {}),
                      })}
                    >
                      <option value="user">Người dùng</option>
                      <option value="admin">Admin</option>
                      <option value="developer">Developer</option>
                    </select>
                  </td>
                </tr>
              ))}
              {!managedUsers.length && <tr><td colSpan={3} className="empty-row">Chưa có role nào trong Realtime Database.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
      <div className="panel table-panel">
        <div className="toolbar">
          <div><h2>Hoạt động ứng dụng</h2><p className="muted small">{filteredLogs.length} log · lưu trong Realtime Database</p></div>
          <input className="text-input search-input" placeholder="Tìm email, hành động, mã phiếu…" value={search} onChange={(event) => setSearch(event.target.value)} />
        </div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>THỜI GIAN</th><th>NGƯỜI DÙNG</th><th>HOẠT ĐỘNG</th><th>MÃ PHIẾU</th><th>CHI TIẾT</th></tr></thead>
            <tbody>
              {filteredLogs.map((entry) => <tr key={entry.id}>
                <td>{formatDate(entry.createdAt)}</td>
                <td>{entry.actorEmail}</td>
                <td><span className="activity-action">{actionLabels[entry.action] ?? entry.action}</span></td>
                <td>{entry.requestId ?? "—"}</td>
                <td className="log-details">{entry.details}</td>
              </tr>)}
              {!filteredLogs.length && <tr><td colSpan={5} className="empty-row">{search ? "Không có log phù hợp." : "Chưa có hoạt động được ghi nhận."}</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
      <p className="log-retention-note">Log được giữ trong Realtime Database. Khi cần giảm dung lượng, bật tích hợp Drive/Cloud Functions để lưu trữ ngoài DB và cấu hình chính sách lưu giữ.</p>
    </section>
  );
}

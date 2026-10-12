import { useEffect, useMemo, useState, type FormEvent } from "react";
import { get, limitToLast, onValue, orderByChild, query, ref, remove, set, update } from "firebase/database";
import { formatDate } from "../lib/delivery";
import { db } from "../firebase";
import type { User } from "firebase/auth";
import type { ActivityLog } from "../types";
import Pagination from "./Pagination";
import { useConfirmation } from "./ConfirmationProvider";
import DriveFileManager from "./DriveFileManager";

const USER_PAGE_SIZE = 25;
const LOG_PAGE_SIZE = 50;

type ManagedRole = "admin" | "developer" | "user";
interface ManagedUser {
  role: ManagedRole;
  email: string;
  displayName?: string;
}

interface DatabaseTable {
  name: string;
  value: unknown;
  childCount: number;
  recordCount: number;
}

interface DeepAdminPageProps {
  currentUserUid: string;
  user: User;
}

function countDatabaseRecords(value: unknown): number {
  if (!value || typeof value !== "object") return 1;
  const children = Object.values(value);
  return children.reduce((count, child) => count + countDatabaseRecords(child), 0);
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value).sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

const actionLabels: Record<ActivityLog["action"], string> = {
  request_created: "Tạo phiếu giao hàng",
  request_updated: "Sửa phiếu giao hàng",
  request_status_changed: "Đổi trạng thái",
  request_tracking_changed: "Cập nhật mail / hóa đơn",
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

const databaseTableDescriptions: Record<string, string> = {
  activityLogs: "Nhật ký thao tác trong cổng",
  chats: "Tin nhắn và hội thoại",
  notifications: "Thông báo người dùng",
  profiles: "Hồ sơ và thông tin liên hệ",
  requestReads: "Trạng thái đã xem phiếu",
  requests: "Phiếu giao hàng và bình luận",
  roles: "Phân quyền tài khoản",
};

export default function DeepAdminPage({ currentUserUid, user }: DeepAdminPageProps) {
  const confirm = useConfirmation();
  const [logs, setLogs] = useState<ActivityLog[]>([]);
  const [managedUsers, setManagedUsers] = useState<Array<ManagedUser & { uid: string }>>([]);
  const [search, setSearch] = useState("");
  const [userPage, setUserPage] = useState(0);
  const [logPage, setLogPage] = useState(0);
  const [error, setError] = useState("");
  const [logNotice, setLogNotice] = useState("");
  const [deletingLogId, setDeletingLogId] = useState("");
  const [deletingAllLogs, setDeletingAllLogs] = useState(false);
  const [roleError, setRoleError] = useState("");
  const [savingUid, setSavingUid] = useState("");
  const [newUser, setNewUser] = useState({ uid: "", email: "", displayName: "", role: "user" as ManagedRole });
  const [databaseTables, setDatabaseTables] = useState<DatabaseTable[]>([]);
  const [databaseLoading, setDatabaseLoading] = useState(true);
  const [databaseError, setDatabaseError] = useState("");
  const [databaseNotice, setDatabaseNotice] = useState("");
  const [selectedDatabaseTables, setSelectedDatabaseTables] = useState<Set<string>>(() => new Set());
  const [backupJson, setBackupJson] = useState<string | null>(null);
  const [creatingBackup, setCreatingBackup] = useState(false);
  const [backupAcknowledged, setBackupAcknowledged] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [cleaningDatabase, setCleaningDatabase] = useState(false);

  async function loadDatabaseTables() {
    if (!db) {
      setDatabaseError("Firebase chưa được cấu hình.");
      setDatabaseLoading(false);
      return;
    }
    setDatabaseLoading(true);
    setDatabaseError("");
    try {
      const snapshot = await get(ref(db));
      const rootValue: unknown = snapshot.val();
      const tableEntries = rootValue && typeof rootValue === "object"
        ? Object.entries(rootValue)
        : [];
      setDatabaseTables(
        tableEntries
          .filter(([, value]) => value !== null)
          .map(([name, value]) => ({
            name,
            value,
            childCount: value && typeof value === "object" ? Object.keys(value).length : 1,
            recordCount: countDatabaseRecords(value),
          }))
          .sort((a, b) => a.name.localeCompare(b.name)),
      );
    } catch (cause) {
      setDatabaseError(`Không tải được dữ liệu Realtime Database: ${cause instanceof Error ? cause.message : "lỗi không xác định."}`);
    } finally {
      setDatabaseLoading(false);
    }
  }

  useEffect(() => {
    void loadDatabaseTables();
  }, []);

  function resetDatabaseConfirmation() {
    setBackupJson(null);
    setBackupAcknowledged(false);
    setDeleteConfirmation("");
  }

  function toggleDatabaseTable(name: string) {
    setSelectedDatabaseTables((current) => {
      const next = new Set(current);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
    resetDatabaseConfirmation();
  }

  async function createDatabaseBackup() {
    if (!db || !selectedDatabaseTables.size) return;
    setDatabaseError("");
    setDatabaseNotice("");
    setCreatingBackup(true);
    try {
      const snapshot = await get(ref(db));
      const rootValue: unknown = snapshot.val();
      const latestTables = rootValue && typeof rootValue === "object"
        ? rootValue as Record<string, unknown>
        : {};
      const backup = Object.fromEntries(
        [...selectedDatabaseTables]
          .filter((name) => latestTables[name] !== undefined && latestTables[name] !== null)
          .sort()
          .map((name) => [name, latestTables[name]]),
      );
      if (Object.keys(backup).length !== selectedDatabaseTables.size) {
        throw new Error("Một số nhánh đã chọn không còn dữ liệu. Hãy tải lại danh sách.");
      }
      const content = JSON.stringify(backup, null, 2);
      const blobUrl = URL.createObjectURL(new Blob([content], { type: "application/json" }));
      const link = document.createElement("a");
      link.href = blobUrl;
      link.download = `expressinfo-realtime-backup-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
      setBackupJson(canonicalJson(backup));
      setBackupAcknowledged(false);
    } catch (cause) {
      setDatabaseError(`Không tạo được bản sao lưu: ${cause instanceof Error ? cause.message : "lỗi không xác định."}`);
    } finally {
      setCreatingBackup(false);
    }
  }

  async function deleteSelectedDatabaseTables() {
    if (!db || !selectedDatabaseTables.size || !backupJson || !backupAcknowledged || deleteConfirmation !== "XOA DU LIEU") return;
    const tableNames = [...selectedDatabaseTables].sort();
    const confirmed = await confirm({
      title: `Xóa ${tableNames.length} nhánh Realtime Database?`,
      message: `Toàn bộ dữ liệu trong các nhánh sau sẽ bị xóa vĩnh viễn: ${tableNames.map((name) => `/${name}`).join(", ")}. Hãy chắc chắn file sao lưu đã được tải và có thể mở.`,
      confirmLabel: `Xóa ${tableNames.length} nhánh`,
      destructive: true,
    });
    if (!confirmed) return;
    setCleaningDatabase(true);
    setDatabaseError("");
    setDatabaseNotice("");
    try {
      const snapshot = await get(ref(db));
      const rootValue: unknown = snapshot.val();
      const latestTables = rootValue && typeof rootValue === "object"
        ? rootValue as Record<string, unknown>
        : {};
      const latestBackup = Object.fromEntries(
        [...selectedDatabaseTables]
          .filter((name) => latestTables[name] !== undefined && latestTables[name] !== null)
          .sort()
          .map((name) => [name, latestTables[name]]),
      );
      if (canonicalJson(latestBackup) !== backupJson) {
        resetDatabaseConfirmation();
        throw new Error("Dữ liệu đã thay đổi sau khi sao lưu. Hãy tải bản sao lưu mới trước khi xóa.");
      }

      await update(ref(db), Object.fromEntries([...selectedDatabaseTables].map((name) => [name, null])));
      const deletedTables = [...selectedDatabaseTables];
      setDatabaseTables((current) => current.filter((table) => !selectedDatabaseTables.has(table.name)));
      setSelectedDatabaseTables(new Set());
      resetDatabaseConfirmation();
      setDatabaseNotice(`Đã xóa dữ liệu trong ${deletedTables.length} nhánh. Bản sao lưu JSON đã được tải xuống trước đó.`);
    } catch (cause) {
      setDatabaseError(`Không xóa được dữ liệu: ${cause instanceof Error ? cause.message : "lỗi không xác định."}`);
    } finally {
      setCleaningDatabase(false);
    }
  }

  async function deleteActivityLog(entry: ActivityLog) {
    if (!db || deletingLogId || deletingAllLogs) return;
    const confirmed = await confirm({
      title: "Xóa activity log?",
      message: `Log "${actionLabels[entry.action] ?? entry.action}" của ${entry.actorEmail} lúc ${formatDate(entry.createdAt)} sẽ bị xóa vĩnh viễn.`,
      confirmLabel: "Xóa log",
      destructive: true,
    });
    if (!confirmed) return;
    setDeletingLogId(entry.id);
    setError("");
    setLogNotice("");
    try {
      await remove(ref(db, `activityLogs/${entry.id}`));
      setLogs((current) => current.filter((log) => log.id !== entry.id));
      setLogNotice("Đã xóa activity log.");
    } catch (cause) {
      setError(`Không xóa được activity log: ${cause instanceof Error ? cause.message : "lỗi không xác định."}`);
    } finally {
      setDeletingLogId("");
    }
  }

  async function deleteAllActivityLogs() {
    if (!db || deletingLogId || deletingAllLogs) return;
    setError("");
    setLogNotice("");
    try {
      const snapshot = await get(ref(db, "activityLogs"));
      const value = snapshot.val() as Record<string, unknown> | null;
      const count = Object.keys(value ?? {}).length;
      if (count === 0) {
        setLogs([]);
        setLogNotice("Không có activity log để xóa.");
        return;
      }
      const confirmed = await confirm({
        title: "Xóa tất cả activity log?",
        message: `Toàn bộ ${count} log trong Realtime Database sẽ bị xóa vĩnh viễn. Không thể hoàn tác thao tác này.`,
        confirmLabel: `Xóa tất cả ${count} log`,
        destructive: true,
      });
      if (!confirmed) return;
      setDeletingAllLogs(true);
      await remove(ref(db, "activityLogs"));
      setLogs([]);
      setLogPage(0);
      setLogNotice(`Đã xóa tất cả ${count} activity log.`);
    } catch (cause) {
      setError(`Không xóa được activity log: ${cause instanceof Error ? cause.message : "lỗi không xác định."}`);
    } finally {
      setDeletingAllLogs(false);
    }
  }

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
  const displayedUsers = managedUsers.slice(userPage * USER_PAGE_SIZE, (userPage + 1) * USER_PAGE_SIZE);
  const displayedLogs = filteredLogs.slice(logPage * LOG_PAGE_SIZE, (logPage + 1) * LOG_PAGE_SIZE);

  useEffect(() => {
    setUserPage(0);
  }, [managedUsers.length]);

  useEffect(() => {
    setLogPage(0);
  }, [search]);

  useEffect(() => {
    if (logPage >= Math.ceil(filteredLogs.length / LOG_PAGE_SIZE)) {
      setLogPage(Math.max(0, Math.ceil(filteredLogs.length / LOG_PAGE_SIZE) - 1));
    }
  }, [filteredLogs.length, logPage]);

  async function saveRole(uid: string, user: ManagedUser): Promise<boolean> {
    if (!db || uid === currentUserUid) return false;
    const target = managedUsers.find((managedUser) => managedUser.uid === uid);
    const confirmed = await confirm({
      title: "Lưu thay đổi phân quyền?",
      message: `Quyền của ${target?.email ?? user.email} sẽ được đặt thành "${user.role}".`,
      confirmLabel: "Lưu phân quyền",
    });
    if (!confirmed) return false;
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
              {displayedUsers.map((managedUser) => (
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
        <Pagination page={userPage} pageSize={USER_PAGE_SIZE} total={managedUsers.length} onPageChange={setUserPage} />
      </div>
      <div className="panel table-panel database-cleanup-panel">
        <div className="toolbar">
          <div>
            <h2>Dọn dẹp Realtime Database</h2>
            <p className="muted small">Chọn các nhánh gốc có dữ liệu. Bản sao lưu tải xuống là JSON có thể nhập lại từ Firebase Console.</p>
          </div>
          <div className="database-cleanup-heading-actions">
            <button type="button" className="button secondary" onClick={() => void loadDatabaseTables()} disabled={databaseLoading || cleaningDatabase || creatingBackup}>
              {databaseLoading ? "Đang tải…" : creatingBackup ? "Đang tạo bản sao lưu…" : "Làm mới"}
            </button>
            <button
              type="button"
              className="button secondary"
              onClick={() => {
                setSelectedDatabaseTables(new Set(databaseTables.map((table) => table.name)));
                resetDatabaseConfirmation();
              }}
              disabled={databaseLoading || cleaningDatabase || creatingBackup || databaseTables.length === 0 || selectedDatabaseTables.size === databaseTables.length}
            >
              Chọn tất cả
            </button>
            <button
              type="button"
              className="button secondary"
              onClick={() => {
                setSelectedDatabaseTables(new Set());
                resetDatabaseConfirmation();
              }}
              disabled={selectedDatabaseTables.size === 0 || cleaningDatabase || creatingBackup}
            >
              Bỏ chọn
            </button>
          </div>
        </div>
        {databaseError && <div className="alert error role-alert">{databaseError}</div>}
        {databaseNotice && <div className="alert success role-alert" role="status">{databaseNotice}</div>}
        {databaseTables.some((table) => selectedDatabaseTables.has(table.name) && table.name === "roles") && (
          <div className="alert error role-alert">
            Cảnh báo: xóa nhánh roles sẽ xóa phân quyền tài khoản, gồm quyền Developer. Bạn có thể cần khôi phục roles từ JSON hoặc cấp lại quyền trong Firebase Console.
          </div>
        )}
        <div className="database-table-list" aria-label="Các nhánh Realtime Database có dữ liệu">
          {databaseLoading ? (
            <div className="database-empty-state"><span className="database-loading-mark" />Đang tải các nhánh dữ liệu…</div>
          ) : databaseTables.length === 0 ? (
            <div className="database-empty-state">
              <span className="database-empty-icon" aria-hidden="true">✓</span>
              <span><strong>Database đang trống</strong><small>Không có nhánh gốc nào chứa dữ liệu để dọn dẹp.</small></span>
            </div>
          ) : (
            <>
              <div className="database-list-summary">
                <span><strong>{databaseTables.length}</strong> nhánh có dữ liệu</span>
                <span className="database-selected-count">{selectedDatabaseTables.size} đang chọn</span>
              </div>
              <div className="database-table-scroll">
                <table className="database-cleanup-table">
                  <thead>
                    <tr>
                      <th className="database-select-column">Chọn</th>
                      <th>Nhánh dữ liệu</th>
                      <th className="database-number-column">Mục cấp 1</th>
                      <th className="database-number-column">Tổng giá trị</th>
                      <th className="database-state-column">Trạng thái</th>
                    </tr>
                  </thead>
                  <tbody>
                    {databaseTables.map((table) => {
                      const selected = selectedDatabaseTables.has(table.name);
                      return (
                        <tr key={table.name} className={selected ? "database-row-selected" : ""}>
                          <td className="database-select-column">
                            <input
                              type="checkbox"
                              aria-label={`Chọn nhánh ${table.name}`}
                              checked={selected}
                              disabled={cleaningDatabase || creatingBackup}
                              onChange={() => toggleDatabaseTable(table.name)}
                            />
                          </td>
                          <td>
                            <div className="database-branch-name"><span aria-hidden="true">▦</span><strong>/{table.name}</strong></div>
                            <small className="database-branch-description">{databaseTableDescriptions[table.name] ?? "Nhánh gốc trong Realtime Database"}</small>
                          </td>
                          <td className="database-number-column">{table.childCount.toLocaleString("vi-VN")}</td>
                          <td className="database-number-column">{table.recordCount.toLocaleString("vi-VN")}</td>
                          <td className="database-state-column">
                            <span className={`database-selection-badge ${selected ? "selected" : ""}`}>{selected ? "Đã chọn" : "Sẵn sàng"}</span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
        {selectedDatabaseTables.size > 0 && (
          <div className="database-cleanup-confirm">
            <p>Đã chọn <strong>{selectedDatabaseTables.size}</strong> nhánh. Hãy tải và kiểm tra JSON sao lưu trước khi xác nhận xóa.</p>
            <div className="database-cleanup-actions">
              <button
                type="button"
                className="button secondary"
                onClick={() => void createDatabaseBackup()}
                disabled={databaseLoading || cleaningDatabase || creatingBackup}
              >
                Tải bản sao lưu JSON
              </button>
              {backupJson && (
                <>
                  <label className="database-backup-ack">
                    <input
                      type="checkbox"
                      checked={backupAcknowledged}
                      onChange={(event) => setBackupAcknowledged(event.target.checked)}
                    />
                    Tôi đã tải và kiểm tra file JSON sao lưu
                  </label>
                  <label className="database-delete-confirm-field">
                    <span>Nhập <strong>XOA DU LIEU</strong> để xác nhận</span>
                    <input
                      className="text-input"
                      value={deleteConfirmation}
                      onChange={(event) => setDeleteConfirmation(event.target.value)}
                      autoComplete="off"
                      disabled={cleaningDatabase || creatingBackup}
                    />
                  </label>
                  <button
                    type="button"
                    className="button database-delete-button"
                    onClick={() => void deleteSelectedDatabaseTables()}
                    disabled={!backupAcknowledged || deleteConfirmation !== "XOA DU LIEU" || cleaningDatabase}
                  >
                    {cleaningDatabase ? "Đang xóa…" : `Xóa ${selectedDatabaseTables.size} nhánh đã chọn`}
                  </button>
                </>
              )}
            </div>
          </div>
        )}
      </div>
      <DriveFileManager user={user} />
      <div className="panel table-panel">
        <div className="toolbar">
          <div><h2>Hoạt động ứng dụng</h2><p className="muted small">{filteredLogs.length} log · lưu trong Realtime Database</p></div>
          <input className="text-input search-input" placeholder="Tìm email, hành động, mã phiếu…" value={search} onChange={(event) => setSearch(event.target.value)} />
          <button
            type="button"
            className="button danger"
            onClick={() => void deleteAllActivityLogs()}
            disabled={deletingAllLogs || !!deletingLogId}
          >
            {deletingAllLogs ? "Đang xóa tất cả…" : "Xóa tất cả log"}
          </button>
        </div>
        {logNotice && <div className="alert success" role="status">{logNotice}</div>}
        <div className="table-wrap">
          <table>
            <thead><tr><th>THỜI GIAN</th><th>NGƯỜI DÙNG</th><th>HOẠT ĐỘNG</th><th>MÃ PHIẾU</th><th>CHI TIẾT</th><th>THAO TÁC</th></tr></thead>
            <tbody>
              {displayedLogs.map((entry) => <tr key={entry.id}>
                <td>{formatDate(entry.createdAt)}</td>
                <td>{entry.actorEmail}</td>
                <td><span className="activity-action">{actionLabels[entry.action] ?? entry.action}</span></td>
                <td>{entry.requestId ?? "—"}</td>
                <td className="log-details">{entry.details}</td>
                <td>
                  <button
                    type="button"
                    className="button danger log-delete-button"
                    disabled={!!deletingLogId || deletingAllLogs}
                    onClick={() => void deleteActivityLog(entry)}
                  >
                    {deletingLogId === entry.id ? "Đang xóa…" : "Xóa"}
                  </button>
                </td>
              </tr>)}
              {!filteredLogs.length && <tr><td colSpan={6} className="empty-row">{search ? "Không có log phù hợp." : "Chưa có hoạt động được ghi nhận."}</td></tr>}
            </tbody>
          </table>
        </div>
        <Pagination page={logPage} pageSize={LOG_PAGE_SIZE} total={filteredLogs.length} onPageChange={setLogPage} />
      </div>
      <p className="log-retention-note">Log được giữ trong Realtime Database. Khi cần giảm dung lượng, bật tích hợp Drive/Cloud Functions để lưu trữ ngoài DB và cấu hình chính sách lưu giữ.</p>
    </section>
  );
}

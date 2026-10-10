import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  GoogleAuthProvider,
  type UserCredential,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  updateProfile,
  type User,
} from "firebase/auth";
import {
  get,
  push,
  ref,
  serverTimestamp,
  set,
} from "firebase/database";
import { DELIVERY_GROUP, EXCEL_TEMPLATE } from "./config";
import AdminPage from "./components/AdminPage";
import ChatWidget from "./components/ChatWidget";
import DeepAdminPage from "./components/DeepAdminPage";
import Pagination from "./components/Pagination";
import ProfilePage from "./components/ProfilePage";
import RequestDetail from "./components/RequestDetail";
import SupplierRegistrationForm from "./components/SupplierRegistrationForm";
import { auth, db, firebaseConfigured } from "./firebase";
import { usePortalData } from "./hooks/usePortalData";
import {
  exportRequests,
  downloadDeliveryTemplate,
  formatDate,
  parseSpreadsheet,
  statusLabels,
} from "./lib/delivery";
import { logActivity } from "./lib/activity";
import {
  cacheDriveAccessToken,
  createGoogleDriveProvider,
  getDriveAccessToken,
  uploadToDeliveryDrive,
} from "./lib/googleDrive";
import type {
  ActivityAction,
  DeliveryItem,
  DeliveryRequest,
  ItemFieldChange,
  MentionTarget,
  NotificationDocument,
  RequestChanges,
  RequestAttachments,
  RequestStatus,
} from "./types";

type Page = "supplier" | "admin" | "deepAdmin" | "profile" | "messages" | "notifications";

function NotificationActions({
  open,
  onToggle,
  onDelete,
}: {
  open: boolean;
  onToggle: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="notification-actions">
      <button
        type="button"
        className="notification-more-button"
        aria-label="Tùy chọn thông báo"
        aria-expanded={open}
        onClick={onToggle}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="5" cy="12" r="1.7" />
          <circle cx="12" cy="12" r="1.7" />
          <circle cx="19" cy="12" r="1.7" />
        </svg>
      </button>
      {open && (
        <div className="notification-action-menu">
          <button type="button" onClick={onDelete}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M4 7h16M10 11v6m4-6v6M6 7l1 14h10l1-14M9 7V4h6v3" />
            </svg>
            Xóa thông báo
          </button>
        </div>
      )}
    </div>
  );
}

function App() {
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [page, setPage] = useState<Page>("supplier");
  const [notificationPage, setNotificationPage] = useState(0);
  const [openNotificationMenuId, setOpenNotificationMenuId] = useState<string | null>(null);
  const [notificationFilter, setNotificationFilter] = useState<"all" | "unread">("all");
  const [markingAllRead, setMarkingAllRead] = useState(false);
  const [supplierRequestPage, setSupplierRequestPage] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [supplierName, setSupplierName] = useState("");
  const [items, setItems] = useState<DeliveryItem[]>([]);
  const [planFile, setPlanFile] = useState<File | null>(null);
  const [introductionFile, setIntroductionFile] = useState<File | null>(null);
  const [planFileName, setPlanFileName] = useState("");
  const [introductionFileName, setIntroductionFileName] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);
  const [highlightTarget, setHighlightTarget] = useState<MentionTarget | null>(null);
  const [unreadMessageCount, setUnreadMessageCount] = useState(0);
  const openMessagesPage = useCallback(() => setPage("messages"), []);

  const {
    requests,
    notifications,
    readNotificationIds,
    deletedNotificationIds,
    notificationsLoaded,
    profile,
    loadingRequests,
    role,
    adminRecipients,
  } = usePortalData(
    user,
    setError,
  );
  const admin = role === "admin";
  const effectivePage = admin && page === "supplier" ? "admin" : page;
  const developer = role === "developer"
    || user?.email?.toLowerCase() === "nvthoi19112002@gmail.com";
  const selected = requests.find((request) => request.id === selectedId) ?? null;
  const seenNotificationIds = useRef<Set<string> | null>(null);
  const notificationOwnerUid = useRef<string | null>(null);
  const unreadNotificationCount = notifications.reduce(
    (count, notification) => count + (deletedNotificationIds.has(notification.id) || readNotificationIds.has(notification.id) ? 0 : 1),
    0,
  );
  const visibleNotifications = notifications.filter((notification) => !deletedNotificationIds.has(notification.id));
  const filteredNotifications = notificationFilter === "unread"
    ? visibleNotifications.filter((notification) => !readNotificationIds.has(notification.id))
    : visibleNotifications;

  async function markAllNotificationsRead() {
    if (!db || !user || unreadNotificationCount === 0) return;
    setMarkingAllRead(true);
    try {
      const batch = visibleNotifications
        .filter((notification) => !readNotificationIds.has(notification.id))
        .slice(0, 100);
      const updates: Record<string, unknown> = {};
      const now = Date.now();
      for (const notification of batch) {
        updates[`notifications/notificationReads/${user.uid}/${notification.id}`] = now;
      }
      if (Object.keys(updates).length > 0) {
        const { update } = await import("firebase/database");
        await update(ref(db), updates);
      }
      setNotice(`Đã đánh dấu ${batch.length} thông báo là đã đọc.`);
    } catch (cause) {
      setError(`Không thể đánh dấu tất cả đã đọc: ${cause instanceof Error ? cause.message : "lỗi không xác định."}`);
    } finally {
      setMarkingAllRead(false);
    }
  }

  async function markNotificationRead(notificationId: string) {
    if (!db || !user || readNotificationIds.has(notificationId)) return;
    try {
      await set(ref(db, `notifications/notificationReads/${user.uid}/${notificationId}`), serverTimestamp());
    } catch (cause) {
      setError(`Không thể đánh dấu thông báo đã đọc: ${cause instanceof Error ? cause.message : "lỗi không xác định."}`);
    }
  }

  async function deleteNotification(notificationId: string) {
    if (!db || !user || deletedNotificationIds.has(notificationId)) return;
    try {
      await set(ref(db, `notifications/deleted/${user.uid}/${notificationId}`), serverTimestamp());
      setOpenNotificationMenuId(null);
      setNotice("Đã xóa thông báo.");
    } catch (cause) {
      setError(`Không thể xóa thông báo: ${cause instanceof Error ? cause.message : "lỗi không xác định."}`);
    }
  }

  useEffect(() => {
    if (!error) return;
    const timeout = window.setTimeout(() => setError(""), 60_000);
    return () => window.clearTimeout(timeout);
  }, [error]);

  useEffect(() => {
    if (!notice) return;
    const timeout = window.setTimeout(() => setNotice(""), 60_000);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  useEffect(() => {
    setNotificationPage(0);
  }, [user?.uid]);

  useEffect(() => {
    if (!auth) {
      setAuthLoading(false);
      return;
    }
    return onAuthStateChanged(auth, (nextUser) => {
      setUser(nextUser);
      setAuthLoading(false);
    });
  }, []);

  useEffect(() => {
    if (admin && page === "supplier") setPage("admin");
  }, [admin, page]);

  useEffect(() => {
    if (!selected) {
      if (!selectedId) {
        setSupplierName("");
        setItems([]);
        setPlanFile(null);
        setIntroductionFile(null);
        setPlanFileName("");
        setIntroductionFileName("");
      }
      return;
    }
    setSupplierName(selected.supplierName);
    setItems(selected.items.map((item) => ({ ...item })));
    setPlanFile(null);
    setIntroductionFile(null);
    setPlanFileName(selected.attachments?.deliveryPlan?.name ?? "");
    setIntroductionFileName(selected.attachments?.companyIntroduction?.name ?? "");
  }, [selected]);

  useEffect(() => {
    if (!selected && !supplierName && profile.organization) {
      setSupplierName(profile.organization);
    }
  }, [selected, supplierName, profile.organization]);

  useEffect(() => {
    if (notificationOwnerUid.current !== user?.uid) {
      notificationOwnerUid.current = user?.uid ?? null;
      seenNotificationIds.current = null;
      return;
    }
    if (!notificationsLoaded) return;
    const nextIds = new Set(visibleNotifications.map((notification) => notification.id));
    if (seenNotificationIds.current === null) {
      seenNotificationIds.current = nextIds;
      return;
    }
    if (typeof Notification !== "undefined" && Notification.permission === "granted") {
      for (const notification of visibleNotifications) {
        if (!seenNotificationIds.current.has(notification.id)) {
          try {
            const title = notification.event === "request_submitted"
              ? "Có phiếu giao hàng mới"
              : notification.event === "request_status"
                ? "Cập nhật trạng thái phiếu giao hàng"
                : "Thông báo giao hàng";
            const desktopNotification = new Notification(title, {
              body: notification.text,
              tag: `delivery-${notification.id}`,
              data: { requestId: notification.requestId },
            });
            desktopNotification.onclick = () => {
              window.focus();
              void markNotificationRead(notification.id);
              if (notification.requestId) {
                setPage(admin ? "admin" : "supplier");
                setSelectedId(notification.requestId);
              }
            };
          } catch (cause) {
            setError(cause instanceof Error ? cause.message : "Không hiển thị được thông báo trình duyệt.");
          }
        }
      }
    }
    seenNotificationIds.current = nextIds;
  }, [admin, visibleNotifications, notificationsLoaded]);

  const supplierRequests = useMemo(
    () => requests.filter((request) => !request.deleted).sort((a, b) => {
      const statusRank = (status: RequestStatus) => status === "pending" ? 0 : status === "approved" ? 1 : 2;
      return statusRank(a.status) - statusRank(b.status) || (b.createdAt || 0) - (a.createdAt || 0);
    }),
    [requests],
  );
  const supplierRequestPageCount = Math.ceil(supplierRequests.length / 8);
  const displayedSupplierRequests = supplierRequests.slice(supplierRequestPage * 8, (supplierRequestPage + 1) * 8);

  useEffect(() => {
    if (supplierRequestPage >= supplierRequestPageCount) {
      setSupplierRequestPage(Math.max(0, supplierRequestPageCount - 1));
    }
  }, [supplierRequestPage, supplierRequestPageCount]);

  async function handleSignIn() {
    if (!auth) return;
    setError("");
    try {
      const result = await signInWithPopup(auth, createGoogleDriveProvider());
      cacheDriveTokenFromCredential(result);
      try {
        await logActivity(result.user, "signed_in", "Đăng nhập vào cổng giao hàng.");
      } catch (cause) {
        setError(`Đã đăng nhập nhưng không ghi được activity log: ${cause instanceof Error ? cause.message : "lỗi không xác định."}`);
      }

    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Đăng nhập thất bại.");
    }
  }

  function cacheDriveTokenFromCredential(result: UserCredential) {
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (credential?.accessToken) {
      cacheDriveAccessToken(result.user.uid, credential.accessToken);
    }
  }

  async function handleSignOut() {
    if (!auth || !user) return;
    try {
      await logActivity(user, "signed_out", "Đăng xuất khỏi cổng giao hàng.");
    } catch (cause) {
      setError(`Không ghi được log đăng xuất: ${cause instanceof Error ? cause.message : "lỗi không xác định."}`);
    }
    await signOut(auth);
  }

  async function handleProfileSave(nextProfile: Omit<typeof profile, "updatedAt">) {
    if (!db || !user || !auth?.currentUser) return;
    setSaving(true);
    setError("");
    try {
      await set(ref(db, `profiles/${user.uid}`), {
        ...nextProfile,
        updatedAt: serverTimestamp(),
      });
      await updateProfile(auth.currentUser, {
        displayName: nextProfile.displayName,
      });
      setNotice("Đã cập nhật hồ sơ.");
      await recordActivity(
        "profile_updated",
        "Cập nhật tên hiển thị, tổ chức hoặc thông tin liên hệ.",
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Không cập nhật được hồ sơ.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDownloadTemplate() {
    try {
      await downloadDeliveryTemplate();
    } catch (cause) {
      setError(`Không tải được file Excel mẫu: ${cause instanceof Error ? cause.message : "lỗi không xác định."}`);
    }
  }

  async function notify(
    requestId: string,
    text: string,
    details: {
      event?: "request_submitted" | "request_status" | "request_updated";
      supplierName: string;
      senderName: string;
    },
    recipient: { recipientRole: "admin" } | {
      recipientRole: "supplier";
      recipientUid: string;
    },
  ) {
    const database = db;
    if (!database || !user) throw new Error("Firebase chưa sẵn sàng.");
    let recipientUids: string[];
    if (recipient.recipientRole === "admin") {
      recipientUids = adminRecipients.map((adminRecipient) => adminRecipient.uid);
      if (recipientUids.length === 0) {
        const rolesSnapshot = await get(ref(database, "roles"));
        const roles = rolesSnapshot.val();
        recipientUids = roles && typeof roles === "object"
          ? Object.entries(roles).flatMap(([uid, record]) =>
              record && typeof record === "object" && "role" in record && record.role === "admin" ? [uid] : [],
            )
          : [];
      }
    } else {
      recipientUids = [recipient.recipientUid];
    }
    if (recipientUids.length === 0) throw new Error("Chưa có người nhận thông báo.");
    await Promise.all(recipientUids.map((recipientUid) => {
      const notificationRef = push(ref(database, `notifications/users/${recipientUid}`));
      return set(notificationRef, {
        requestId,
        senderUid: user.uid,
        ...details,
        recipientRole: recipient.recipientRole,
        recipientUid,
        text,
        createdAt: serverTimestamp(),
      });
    }));
  }

  async function recordActivity(
    action: ActivityAction,
    details: string,
    requestId?: string,
  ) {
    if (!user) return;
    try {
      await logActivity(user, action, details, requestId);
    } catch (cause) {
      setError(`Dữ liệu đã lưu nhưng không ghi được activity log: ${cause instanceof Error ? cause.message : "lỗi không xác định."}`);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!db || !user) return;
    if (!supplierName.trim() || items.length === 0 || !planFile || !introductionFile) {
      setError("Hãy nhập tên nhà cung cấp, tải file kế hoạch Excel và giấy giới thiệu.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const accessToken = await getDriveAccessToken(user);
      const [deliveryPlan, companyIntroduction] = await Promise.all([
        uploadToDeliveryDrive(accessToken, planFile),
        uploadToDeliveryDrive(accessToken, introductionFile),
      ]);
      const requestRef = push(ref(db, "requests"));
      if (!requestRef.key) throw new Error("Không tạo được mã đăng ký.");
      await set(requestRef, {
        ownerUid: user.uid,
        ownerEmail: user.email ?? "",
        ownerName: user.displayName ?? user.email ?? "Nhà cung cấp",
        supplierName: supplierName.trim(),
        deliveryGroup: DELIVERY_GROUP,
        items,
        attachments: { deliveryPlan, companyIntroduction },
        createdAt: serverTimestamp(),
        templateHeaders: EXCEL_TEMPLATE.columns.map((column) => column.label),
      });
      setNotice("Đã gửi đăng ký giao hàng.");
      await recordActivity(
        "request_created",
        `Tạo phiếu giao hàng cho ${supplierName.trim()} · ${items.length} dòng hàng.`,
        requestRef.key,
      );
      setSupplierName("");
      setItems([]);
      setPlanFile(null);
      setIntroductionFile(null);
      setPlanFileName("");
      setIntroductionFileName("");
      try {
        const senderName = profile.displayName || user.displayName || user.email || "Nhà cung cấp";
        await notify(
          requestRef.key,
          `${supplierName.trim()} · ${senderName} vừa gửi đăng ký giao hàng.`,
          { event: "request_submitted", supplierName: supplierName.trim(), senderName },
          {
          recipientRole: "admin",
          },
        );
      } catch (cause) {
        setError(`Phiếu đã được lưu nhưng không tạo được thông báo cho admin: ${cause instanceof Error ? cause.message : "lỗi không xác định."}`);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Không gửi được phiếu.");
    } finally {
      setSaving(false);
    }
  }

  async function handlePlanFile(file?: File) {
    if (!file) return;
    if (file.size > 50 * 1024 * 1024) {
      setError("Dung lượng file kế hoạch không được vượt quá 50 MB.");
      return;
    }
    setError("");
    setNotice("");
    try {
      const parsed = await parseSpreadsheet(file);
      setItems(parsed);
      setPlanFile(file);
      setPlanFileName(file.name);
      await recordActivity(
        "spreadsheet_uploaded",
        `Tải và đọc file Excel "${file.name}" gồm ${parsed.length} dòng hàng.`,
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Không đọc được file Excel.");
    }
  }

  function handleIntroductionFile(file?: File) {
    if (!file) return;
    const acceptedExtension = /\.(pdf|doc|docx|jpe?g|png)$/i.test(file.name);
    if (!acceptedExtension) {
      setError("Giấy giới thiệu cần là PDF, DOC, DOCX, JPG hoặc PNG.");
      return;
    }
    if (file.size > 50 * 1024 * 1024) {
      setError("Dung lượng mỗi file không được vượt quá 50 MB.");
      return;
    }
    setError("");
    setIntroductionFile(file);
    setIntroductionFileName(file.name);
  }

  async function saveRevision(
    request: DeliveryRequest,
    changes: RequestChanges,
    status?: RequestStatus,
    deleted?: boolean,
  ) {
    if (!db || !user) return;
    const revision = {
      actorUid: user.uid,
      actorEmail: user.email ?? "",
      createdAt: serverTimestamp(),
      ...(Object.keys(changes).length ? { changes } : {}),
      ...(status ? { status } : {}),
      ...(deleted !== undefined ? { deleted } : {}),
    };
    const revisionRef = push(ref(db, `requests/${request.id}/revisions`));
    await set(revisionRef, revision);
  }

  async function handleSaveEdit() {
    if (!selected || !user) return;
    if (!supplierName.trim()) {
      setError("Tên nhà cung cấp là bắt buộc.");
      return;
    }
    if (items.length === 0) {
      setError("Phiếu cần có ít nhất một dòng hàng.");
      return;
    }
    const changes: RequestChanges = {};
    if (supplierName.trim() !== selected.supplierName) changes.supplierName = supplierName.trim();
    if (items.length !== selected.items.length) {
      changes.items = items.map((item) => ({ ...item }));
    } else {
      const itemChanges: ItemFieldChange[] = [];
      selected.items.forEach((originalItem, index) => {
        const editedItem = items[index];
        if (!editedItem) return;
        for (const column of EXCEL_TEMPLATE.columns) {
          if ((originalItem[column.key] ?? "") !== (editedItem[column.key] ?? "")) {
            itemChanges.push({ index, key: column.key, value: editedItem[column.key] ?? "" });
          }
        }
      });
      if (itemChanges.length) changes.itemChanges = itemChanges;
    }
    if (planFile || introductionFile) {
      changes.attachments = {};
    }
    if (!Object.keys(changes).length) {
      setNotice("Không có thay đổi mới.");
      return;
    }

    setSaving(true);
    setError("");
    try {
      if (planFile || introductionFile) {
        const accessToken = await getDriveAccessToken(user);
        const [deliveryPlan, companyIntroduction] = await Promise.all([
          planFile ? uploadToDeliveryDrive(accessToken, planFile) : Promise.resolve(selected.attachments?.deliveryPlan),
          introductionFile ? uploadToDeliveryDrive(accessToken, introductionFile) : Promise.resolve(selected.attachments?.companyIntroduction),
        ]);
        const updatedAttachments: RequestAttachments = {
          ...(deliveryPlan ? { deliveryPlan } : {}),
          ...(companyIntroduction ? { companyIntroduction } : {}),
        };
        changes.attachments = updatedAttachments;
      }
      await saveRevision(selected, changes);
      setNotice("Đã lưu bản sửa đổi; dữ liệu gốc được giữ nguyên.");
      setPlanFile(null);
      setIntroductionFile(null);
      const editedFields = Object.keys(changes).join(", ");
      await recordActivity(
        "request_updated",
        `Cập nhật các trường: ${editedFields}.`,
        selected.id,
      );
      try {
        await notify(
          selected.id,
          admin
            ? `${selected.supplierName} · Phiếu giao hàng đã được admin cập nhật.`
            : `${selected.supplierName} · Nhà cung cấp vừa cập nhật phiếu.`,
          {
            event: "request_updated",
            supplierName: selected.supplierName,
            senderName: profile.displayName || user.displayName || user.email || "",
          },
          admin
            ? { recipientRole: "supplier", recipientUid: selected.ownerUid }
            : { recipientRole: "admin" },
        );
      } catch (cause) {
        setError(`Thay đổi đã lưu nhưng không tạo được thông báo: ${cause instanceof Error ? cause.message : "lỗi không xác định."}`);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Không lưu được thay đổi.");
    } finally {
      setSaving(false);
    }
  }

  async function handleStatusChange(status: RequestStatus, requestId = selected?.id) {
    const targetRequest = requests.find((request) => request.id === requestId);
    if (!targetRequest || targetRequest.deleted || !admin || targetRequest.status === status) return;
    setSaving(true);
    setError("");
    try {
      await saveRevision(targetRequest, {}, status);
      setNotice(`Đã cập nhật trạng thái: ${status === "approved" ? "Đã duyệt" : status === "rejected" ? "Từ chối" : "Chờ duyệt"}.`);
      await recordActivity(
        "request_status_changed",
        `Đổi trạng thái phiếu sang ${status}.`,
        targetRequest.id,
      );
      try {
        const statusText = statusLabels[status].toLocaleLowerCase();
        await notify(
          targetRequest.id,
          `${targetRequest.supplierName} · Phiếu giao hàng: ${statusText}.`,
          {
            event: "request_status",
            supplierName: targetRequest.supplierName,
            senderName: profile.displayName || user?.displayName || user?.email || "Quản trị viên",
          },
          { recipientRole: "supplier", recipientUid: targetRequest.ownerUid },
        );
      } catch (cause) {
        setError(`Trạng thái đã lưu nhưng không tạo được thông báo cho nhà cung cấp: ${cause instanceof Error ? cause.message : "lỗi không xác định."}`);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Không cập nhật được trạng thái.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!selected || !admin) return;
    if (!window.confirm("Ẩn phiếu này khỏi danh sách? Dữ liệu gốc và lịch sử vẫn được giữ.")) return;
    setSaving(true);
    try {
      await saveRevision(selected, {}, undefined, true);
      await recordActivity("request_deleted", "Admin xóa mềm phiếu giao hàng.", selected.id);
      setSelectedId(null);
      setNotice("Đã xóa mềm phiếu.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Không xóa được phiếu.");
    } finally {
      setSaving(false);
    }
  }

  function updateItem(index: number, key: string, value: string) {
    setItems((current) =>
      current.map((item, itemIndex) =>
        itemIndex === index ? { ...item, [key]: value } : item,
      ),
    );
  }

  function removeItem(index: number) {
    setItems((current) => current.filter((_, itemIndex) => itemIndex !== index));
  }

  if (!firebaseConfigured) {
    return (
      <main className="setup-screen">
        <section className="setup-card">
          <div className="brand-mark">G</div>
          <p className="eyebrow">CỔNG NHÀ CUNG CẤP</p>
          <h1>Kết nối Firebase để bắt đầu</h1>
          <p>Tạo file <code>.env.local</code> từ <code>.env.example</code>, sau đó điền cấu hình Firebase Web App của bạn.</p>
        </section>
      </main>
    );
  }
  if (authLoading) return <main className="setup-screen"><p>Đang kết nối…</p></main>;
  if (!user) {
    return (
      <main className="setup-screen">
        <section className="setup-card login-card">
          <div className="brand-mark">G</div>
          <p className="eyebrow">ĐĂNG KÝ GIAO HÀNG</p>
          <h1>Cổng giao hàng<br />nhà cung cấp</h1>
          <p>Đăng nhập bằng Google để gửi lịch giao, theo dõi phê duyệt và trao đổi với quản trị viên.</p>
          {error && <div className="alert error">{error}</div>}
          <button className="button primary wide" onClick={() => void handleSignIn()}>Tiếp tục với Google</button>
          <span className="muted small">Trao đổi và cập nhật được đồng bộ theo thời gian thực.</span>
        </section>
      </main>
    );
  }

  const openRequest = (id: string) => {
    setSelectedId(id);
    setHighlightTarget(null);
    setError("");
    if (user) void recordActivity("request_viewed", "Mở chi tiết phiếu giao hàng.", id);
  };

  const openPage = (target: Page) => {
    const nextTarget = admin && target === "supplier" ? "admin" : target;
    setPage(nextTarget);
    setSelectedId(null);
    setHighlightTarget(null);
    void recordActivity("page_opened", `Mở trang ${nextTarget}.`);
  };

  const openNotification = (notification: NotificationDocument) => {
    void markNotificationRead(notification.id);
    setPage(admin ? "admin" : "supplier");
    if (notification.requestId) openRequest(notification.requestId);
  };

  const openMentionedContent = (target: MentionTarget) => {
    setHighlightTarget(target);
    setSelectedId(target.requestId);
    setPage(admin ? "admin" : "supplier");
    setError("");
  };

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand"><div className="brand-mark small-mark">G</div><div><strong>Giao hàng</strong><span>CỔNG NHÀ CUNG CẤP</span></div></div>
        <div className="user-menu">
          <div className="avatar">{(profile.displayName || user.displayName || user.email || "U").slice(0, 1).toUpperCase()}</div>
          <div className="user-info"><strong>{profile.displayName || user.displayName || "Người dùng"}</strong><span>{user.email}</span></div>
          <button className="button plain" onClick={() => void handleSignOut()}>Đăng xuất</button>
        </div>
      </header>
      <div className="layout">
        <aside className="sidebar">
          <p className="nav-label">KHÔNG GIAN LÀM VIỆC</p>
          {!admin && <button className={`nav-item ${effectivePage === "supplier" ? "active" : ""}`} onClick={() => openPage("supplier")}>
            <span className="nav-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M5 19V5m0 0h14M5 5l6 6" /></svg></span> Đăng ký giao hàng
          </button>}
          {admin && <button className={`nav-item ${effectivePage === "admin" ? "active" : ""}`} onClick={() => openPage("admin")}>
            <span className="nav-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><rect x="4" y="4" width="7" height="7" rx="1.5" /><rect x="13" y="4" width="7" height="7" rx="1.5" /><rect x="4" y="13" width="7" height="7" rx="1.5" /><rect x="13" y="13" width="7" height="7" rx="1.5" /></svg></span> Quản trị tổng hợp
          </button>}
          <button className={`nav-item ${effectivePage === "messages" ? "active" : ""}`} onClick={() => openPage("messages")}>
            <span className="nav-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><rect x="3.5" y="5" width="17" height="14" rx="2" /><path d="m4.5 7 7.5 6 7.5-6" /></svg></span> Tin nhắn
            {unreadMessageCount > 0 && <span className="count nav-count">{unreadMessageCount > 99 ? "99+" : unreadMessageCount}</span>}
          </button>
          <button className={`nav-item ${effectivePage === "notifications" ? "active" : ""}`} onClick={() => openPage("notifications")}>
            <span className="nav-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" /></svg></span> Thông báo
            {unreadNotificationCount > 0 && <span className="count nav-count">{unreadNotificationCount > 99 ? "99+" : unreadNotificationCount}</span>}
          </button>
          {developer && <button className={`nav-item ${effectivePage === "deepAdmin" ? "active" : ""}`} onClick={() => openPage("deepAdmin")}>
            <span className="nav-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="m8 7-5 5 5 5m8-10 5 5-5 5m-3-12-2 14" /></svg></span> Deep Admin
          </button>}
          <button className={`nav-item ${effectivePage === "profile" ? "active" : ""}`} onClick={() => openPage("profile")}>
            <span className="nav-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="3.5" /><path d="M5 20a7 7 0 0 1 14 0" /></svg></span> Hồ sơ của tôi
          </button>
          <div className="sidebar-bottom">
            <div className="notification-head">
              <button className="nav-label sidebar-link" onClick={() => openPage("notifications")}>THÔNG BÁO</button>
              <span className="count">{unreadNotificationCount}</span>
            </div>
            {visibleNotifications.length === 0 ? <p className="muted small">Chưa có thông báo.</p> : visibleNotifications.slice(0, 10).map((notification) => (
              <div key={notification.id} className="sidebar-notification">
                <button className={`notification-item ${readNotificationIds.has(notification.id) ? "read" : "unread"}`} onClick={() => openNotification(notification)}>
                  {!readNotificationIds.has(notification.id) && <span className="notification-dot" />}<span>{notification.text}<small>{formatDate(notification.createdAt)}</small></span>
                </button>
                <NotificationActions
                  open={openNotificationMenuId === notification.id}
                  onToggle={() => setOpenNotificationMenuId((openId) => openId === notification.id ? null : notification.id)}
                  onDelete={() => void deleteNotification(notification.id)}
                />
              </div>
            ))}
            {visibleNotifications.length > 10 && <button className="sidebar-link notification-more" onClick={() => openPage("notifications")}>Xem tất cả thông báo ({visibleNotifications.length})</button>}
          </div>
          <div className="sidebar-foot">Đăng nhập an toàn với Google</div>
        </aside>
        <div className="toast-stack" aria-live="polite">
          {error && <div key={`error-${error}`} className="alert error toast" role="alert"><span>{error}</span><button aria-label="Đóng thông báo lỗi" onClick={() => setError("")}>×</button><span className="toast-progress" aria-hidden="true" /></div>}
          {notice && <div key={`notice-${notice}`} className="alert success toast" role="status"><span>{notice}</span><button aria-label="Đóng thông báo" onClick={() => setNotice("")}>×</button><span className="toast-progress" aria-hidden="true" /></div>}
        </div>
        <main className={`main-content ${admin && effectivePage === "admin" ? "admin-main-content" : ""}`}>

          <ChatWidget
            user={user}
            admin={admin}
            adminRecipients={adminRecipients}
            requests={requests}
            onOpenMention={openMentionedContent}
            onUnreadCountChange={setUnreadMessageCount}
            onOpenMessages={openMessagesPage}
            active={effectivePage === "messages"}
            hidden={effectivePage !== "messages"}
            supplierDisplayName={
              supplierName.trim()
              || profile.organization
              || requests.find((request) => request.ownerUid === user.uid)?.supplierName
              || "Nhà cung cấp"
            }
          />
          {effectivePage !== "messages" && (effectivePage === "notifications" ? (
            <section className="notifications-page">
              <div className="page-heading">
                <div><p className="eyebrow">CẬP NHẬT</p><h1>Thông báo</h1><p className="muted">Toàn bộ thông báo mới nhất của bạn.</p></div>
                <div className="notification-heading-actions">
                  <span className="count-badge unread-badge" title={`${unreadNotificationCount} thông báo chưa đọc`}>● {unreadNotificationCount} chưa đọc</span>
                  <button
                    className="button secondary mark-all-read-btn"
                    onClick={() => void markAllNotificationsRead()}
                    disabled={markingAllRead || unreadNotificationCount === 0}
                  >
                    {markingAllRead ? "Đang xử lý…" : "✓ Đánh dấu tất cả đã đọc"}
                  </button>
                </div>
              </div>
              <div className="notification-filter-tabs" role="tablist">
                <button
                  className={notificationFilter === "all" ? "active" : ""}
                  onClick={() => { setNotificationFilter("all"); setNotificationPage(0); }}
                >
                  Tất cả <span>({visibleNotifications.length})</span>
                </button>
                <button
                  className={notificationFilter === "unread" ? "active" : ""}
                  onClick={() => { setNotificationFilter("unread"); setNotificationPage(0); }}
                >
                  Chưa đọc <span>({unreadNotificationCount})</span>
                </button>
              </div>
              <div className="panel notification-list">
                {filteredNotifications.length === 0 ? (
                  <div className="notification-empty-state">
                    <span className="empty-icon-large">✓</span>
                    <strong>{notificationFilter === "unread" ? "Không còn thông báo chưa đọc" : "Chưa có thông báo"}</strong>
                    <p className="muted small">{notificationFilter === "unread" ? "Bạn đã đọc hết tất cả thông báo." : "Thông báo sẽ xuất hiện ở đây khi có hoạt động mới."}</p>
                  </div>
                ) : filteredNotifications.slice(notificationPage * 20, (notificationPage + 1) * 20).map((notification) => (
                  <div key={notification.id} className="notification-row" style={{ animation: "notif-fade-in .25s ease" }}>
                    <button
                      className={`notification-item ${readNotificationIds.has(notification.id) ? "read" : "unread"}`}
                      onClick={() => {
                        openNotification(notification);
                      }}
                    >
                      <span className={`notif-avatar ${notification.event === "request_status" ? "status-bg" : notification.event === "request_submitted" ? "submit-bg" : "update-bg"}`}>
                        {notification.event === "request_submitted" ? "📤" : notification.event === "request_status" ? "📋" : "✏️"}
                      </span>
                      <div className="notif-content">
                        <span className="notif-title">
                          {notification.event === "request_submitted"
                            ? "Phiếu đăng ký mới"
                            : notification.event === "request_status"
                              ? "Trạng thái phiếu thay đổi"
                              : "Cập nhật phiếu"}
                        </span>
                        <span className="notif-text">{notification.text}</span>
                        <small>{formatDate(notification.createdAt)}</small>
                      </div>
                      {!readNotificationIds.has(notification.id) && <span className="notification-dot" aria-label="Chưa đọc" />}
                    </button>
                    <NotificationActions
                      open={openNotificationMenuId === notification.id}
                      onToggle={() => setOpenNotificationMenuId((openId) => openId === notification.id ? null : notification.id)}
                      onDelete={() => void deleteNotification(notification.id)}
                    />
                  </div>
                ))}
              </div>
              <Pagination page={notificationPage} pageSize={20} total={filteredNotifications.length} onPageChange={setNotificationPage} />
            </section>
          ) : effectivePage === "deepAdmin" && developer ? (
            <DeepAdminPage currentUserUid={user.uid} />
          ) : effectivePage === "profile" ? (
            <ProfilePage
              user={user}
              profile={profile}
              saving={saving}
              onSave={(nextProfile) => void handleProfileSave(nextProfile)}
            />
          ) : (effectivePage === "admin" || effectivePage === "supplier") && admin ? (
            <>
              <div className={selected ? "admin-list-hidden" : ""} aria-hidden={!!selected}>
                <AdminPage
                  requests={requests}
                  loading={loadingRequests}
                  selectedId={selectedId}
                  focusRequestId={highlightTarget?.requestId ?? null}
                  onSelect={openRequest}
                  onStatusChange={(id, status) => handleStatusChange(status, id)}
                  onExport={(exported, mode) => {
                    void recordActivity(
                      "spreadsheet_exported",
                      `Xuất ${mode === "all" ? "tất cả" : "danh sách đã lọc"} gồm ${exported.length} phiếu.`,
                    );
                    void exportRequests(exported).catch((cause: unknown) => setError(cause instanceof Error ? `Không xuất được Excel: ${cause.message}` : "Không xuất được Excel."));
                  }}
                />
              </div>
              {selected && <div className="admin-detail-wrap">
                <div className="admin-detail-tabbar">
                  <button className="button secondary" onClick={() => { setSelectedId(null); setHighlightTarget(null); }}>← Danh sách phiếu</button>
                  <span>{selected.supplierName} <b>›</b> Chi tiết phiếu</span>
                </div>
                <RequestDetail
                request={selected}
                admin
                supplierName={supplierName}
                items={items}
                saving={saving}
                highlightTarget={highlightTarget}
                onBack={() => { setSelectedId(null); setHighlightTarget(null); }}
                onSupplierName={setSupplierName}
                onItemChange={updateItem}
                onRemoveItem={removeItem}
                planFileName={planFileName}
                introductionFileName={introductionFileName}
                onPlanFile={(file) => void handlePlanFile(file)}
                onDownloadTemplate={() => void handleDownloadTemplate()}
                onIntroductionFile={handleIntroductionFile}
                onSave={() => void handleSaveEdit()}
                onStatus={(status) => void handleStatusChange(status)}
                onDelete={() => void handleDelete()}
              /></div>}
            </>
          ) : (
            <div className="content-grid">
              <section className="primary-column">
                {selected ? <RequestDetail
                  request={selected}
                  admin={admin}
                  supplierName={supplierName}
                  items={items}
                  saving={saving}
                  highlightTarget={highlightTarget}
                  onBack={() => { setSelectedId(null); setHighlightTarget(null); }}
                  onSupplierName={setSupplierName}
                  onItemChange={updateItem}
                  onRemoveItem={removeItem}
                  planFileName={planFileName}
                  introductionFileName={introductionFileName}
                  onPlanFile={(file) => void handlePlanFile(file)}
                  onDownloadTemplate={() => void handleDownloadTemplate()}
                  onIntroductionFile={handleIntroductionFile}
                  onSave={() => void handleSaveEdit()}
                  onStatus={(status) => void handleStatusChange(status)}
                  onDelete={() => void handleDelete()}
                /> : <SupplierRegistrationForm
                  supplierName={supplierName}
                  items={items}
                  planFileName={planFileName}
                  introductionFileName={introductionFileName}
                  saving={saving}
                  onSubmit={(event) => void handleSubmit(event)}
                  onSupplierName={setSupplierName}
                  onPlanFile={(file) => void handlePlanFile(file)}
                  onDownloadTemplate={() => void handleDownloadTemplate()}
                  onIntroductionFile={handleIntroductionFile}
                  onItemChange={updateItem}
                  onRemoveItem={removeItem}
                />}
              </section>
              <aside className="secondary-column">
                <div className="side-heading"><div><p className="eyebrow">THEO DÕI</p><h2>Phiếu của tôi</h2></div><span className="count">{supplierRequests.length}</span></div>
                {supplierRequests.length === 0 ? <div className="empty-card"><span className="empty-icon">▤</span><strong>Chưa có phiếu giao hàng</strong><p>Phiếu đã gửi sẽ xuất hiện ở đây để bạn theo dõi và chỉnh sửa.</p></div> : displayedSupplierRequests.map((request) => {
                  return <button key={request.id} className={`request-card ${selectedId === request.id ? "selected" : ""}`} onClick={() => openRequest(request.id)}>
                    <div className="request-card-top"><span className={`status status-${request.status}`}>{statusLabels[request.status]}</span><span className="muted tiny">{formatDate(request.createdAt)}</span></div>
                    <strong>{request.supplierName}</strong>
                    <span className="muted small">{request.items.length} dòng hàng hóa</span>
                    {request.revisions.length > 0 && <span className="revision-note">{request.revisions.length} lần cập nhật</span>}
                  </button>;
                })}
                <Pagination
                  page={supplierRequestPage}
                  pageSize={8}
                  total={supplierRequests.length}
                  onPageChange={setSupplierRequestPage}
                />
              </aside>
            </div>
          ))}
        </main>
      </div>
    </div>
  );
}

export default App;

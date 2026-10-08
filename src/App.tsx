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
  update,
} from "firebase/database";
import { DELIVERY_GROUP, EXCEL_TEMPLATE } from "./config";
import AdminPage from "./components/AdminPage";
import ChatWidget from "./components/ChatWidget";
import DeepAdminPage from "./components/DeepAdminPage";
import DeliveryDateRequestsPage from "./components/DeliveryDateRequestsPage";
import Pagination from "./components/Pagination";
import ProfilePage from "./components/ProfilePage";
import RequestDetail from "./components/RequestDetail";
import SupplierRegistrationForm from "./components/SupplierRegistrationForm";
import { auth, db, firebaseConfigured } from "./firebase";
import { usePortalData } from "./hooks/usePortalData";
import {
  exportRequests,
  daysUntilDelivery,
  deliveryCountdownLabel,
  deliveryTone,
  downloadDeliveryTemplate,
  formatDate,
  parseSpreadsheet,
  requestFromSnapshot,
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
  DeliveryDateChangeSelection,
  DeliveryItem,
  DeliveryRequest,
  ItemFieldChange,
  MentionTarget,
  NotificationDocument,
  RequestChanges,
  RequestAttachments,
  RequestStatus,
} from "./types";

type Page = "supplier" | "admin" | "deepAdmin" | "profile" | "messages" | "notifications" | "deliveryDateRequests";

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
  const [supplierRequestPage, setSupplierRequestPage] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [supplierName, setSupplierName] = useState("");
  const [deliveryDate, setDeliveryDate] = useState("");
  const [items, setItems] = useState<DeliveryItem[]>([]);
  const [planFile, setPlanFile] = useState<File | null>(null);
  const [introductionFile, setIntroductionFile] = useState<File | null>(null);
  const [planFileName, setPlanFileName] = useState("");
  const [introductionFileName, setIntroductionFileName] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);
  const [highlightTarget, setHighlightTarget] = useState<MentionTarget | null>(null);
  const [deliveryDateRefresh, setDeliveryDateRefresh] = useState(() => new Date());
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
  const developer = role === "developer"
    || user?.email?.toLowerCase() === "nvthoi19112002@gmail.com";
  const selected = requests.find((request) => request.id === selectedId) ?? null;
  const seenNotificationIds = useRef<Set<string> | null>(null);
  const notificationOwnerUid = useRef<string | null>(null);
  const overdueSyncInProgress = useRef<Set<string>>(new Set());
  const unreadNotificationCount = notifications.reduce(
    (count, notification) => count + (deletedNotificationIds.has(notification.id) || readNotificationIds.has(notification.id) ? 0 : 1),
    0,
  );
  const visibleNotifications = notifications.filter((notification) => !deletedNotificationIds.has(notification.id));

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
        setDeliveryDate("");
        setItems([]);
        setPlanFile(null);
        setIntroductionFile(null);
        setPlanFileName("");
        setIntroductionFileName("");
      }
      return;
    }
    setSupplierName(selected.supplierName);
    setDeliveryDate(selected.deliveryDate);
    setItems(selected.items.map((item) => ({ ...item })));
    setPlanFile(null);
    setIntroductionFile(null);
    setPlanFileName(selected.attachments?.deliveryPlan?.name ?? "");
    setIntroductionFileName(selected.attachments?.companyIntroduction?.name ?? "");
  }, [selected]);

  useEffect(() => {
    const nextMidnight = new Date();
    nextMidnight.setHours(24, 0, 1, 0);
    const timeout = window.setTimeout(
      () => setDeliveryDateRefresh(new Date()),
      Math.max(1000, nextMidnight.getTime() - Date.now()),
    );
    return () => window.clearTimeout(timeout);
  }, [deliveryDateRefresh]);

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
              : notification.event === "delivery_reminder"
                ? "Nhắc lịch giao hàng"
                : notification.event === "delivery_overdue"
                  ? "Phiếu giao hàng đã trễ hạn"
                  : notification.event === "delivery_confirmed"
                    ? "Đã xác nhận giao hàng"
                    : notification.event === "delivery_date_requested"
                      ? "Yêu cầu đổi ngày giao hàng"
                      : notification.event === "delivery_date_response"
                        ? "Phản hồi yêu cầu đổi ngày giao"
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
              if (notification.event === "delivery_date_requested" || notification.event === "delivery_date_response") {
                setSelectedId(null);
                setHighlightTarget(null);
                setPage("deliveryDateRequests");
              } else if (notification.requestId) {
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

  useEffect(() => {
    if (!admin || !user) return;
    const overdueRequests = requests.filter((request) =>
      !request.deleted
      && ["approved", "reminded"].includes(request.status)
      && daysUntilDelivery(request.deliveryDate, deliveryDateRefresh) !== null
      && daysUntilDelivery(request.deliveryDate, deliveryDateRefresh)! < 0
      && !overdueSyncInProgress.current.has(request.id),
    );
    for (const request of overdueRequests) {
      overdueSyncInProgress.current.add(request.id);
      void (async () => {
        try {
          if (!db) throw new Error("Firebase chưa sẵn sàng.");
          const latestSnapshot = await get(ref(db, `requests/${request.id}`));
          if (!latestSnapshot.exists()) return;
          const latestRequest = requestFromSnapshot(
            request.id,
            latestSnapshot.val() as Record<string, unknown>,
          );
          if (
            latestRequest.deleted
            || !["approved", "reminded"].includes(latestRequest.status)
            || daysUntilDelivery(latestRequest.deliveryDate, deliveryDateRefresh) === null
            || daysUntilDelivery(latestRequest.deliveryDate, deliveryDateRefresh)! >= 0
          ) return;
          await saveRevision(latestRequest, {}, "overdue");
          await recordActivity(
            "request_status_changed",
            "Tự động đánh dấu trễ giao vì quá ngày giao nhưng chưa xác nhận hoàn tất.",
            request.id,
          );
          await notify(
            request.id,
            `${request.supplierName} · Phiếu giao ngày ${request.deliveryDate} đã quá hạn và chưa xác nhận giao hàng. Vui lòng cập nhật tình trạng giao.`,
            {
              event: "delivery_overdue",
              supplierName: request.supplierName,
              senderName: "Hệ thống",
            },
            { recipientRole: "supplier", recipientUid: request.ownerUid },
          );
        } catch (cause) {
          setError(`Không cập nhật được cảnh báo trễ giao cho ${request.supplierName}: ${cause instanceof Error ? cause.message : "lỗi không xác định."}`);
        } finally {
          overdueSyncInProgress.current.delete(request.id);
        }
      })();
    }
  }, [admin, deliveryDateRefresh, requests, user]);

  const supplierRequests = useMemo(
    () => requests.filter((request) => !request.deleted).sort((a, b) => {
      const rank = (request: DeliveryRequest) => {
        const days = daysUntilDelivery(request.deliveryDate, deliveryDateRefresh);
        if (days === 0) return 0;
        const tone = deliveryTone(request.deliveryDate, request.status, deliveryDateRefresh);
        return tone === "overdue" ? 1 : tone === "soon" ? 2 : tone === "delivered" ? 3 : 4;
      };
      return rank(a) - rank(b) || a.deliveryDate.localeCompare(b.deliveryDate);
    }),
    [deliveryDateRefresh, requests],
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
      event?: "request_submitted" | "request_status" | "request_updated" | "delivery_reminder" | "delivery_overdue" | "delivery_confirmed" | "delivery_date_requested" | "delivery_date_response";
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
    const expectedDates = items
      .map((item) => item.expectedDeliveryDate)
      .filter((date): date is string => /^\d{4}-\d{2}-\d{2}$/.test(date ?? ""))
      .sort();
    if (!expectedDates.length || items.some((item) => !/^\d{4}-\d{2}-\d{2}$/.test(item.expectedDeliveryDate ?? ""))) {
      setError("Mỗi dòng hàng cần có ngày giao dự kiến hợp lệ trong file Excel.");
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
        deliveryDate: expectedDates[0],
        items,
        attachments: { deliveryPlan, companyIntroduction },
        createdAt: serverTimestamp(),
        templateHeaders: EXCEL_TEMPLATE.columns.map((column) => column.label),
      });
      setNotice("Đã gửi đăng ký giao hàng.");
      await recordActivity(
        "request_created",
        `Tạo phiếu giao hàng cho ${supplierName.trim()} · từ ${expectedDates[0]} · ${items.length} dòng hàng.`,
        requestRef.key,
      );
      setSupplierName("");
      setDeliveryDate("");
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
      if (parsed.some((item) => !/^\d{4}-\d{2}-\d{2}$/.test(item.expectedDeliveryDate ?? ""))) {
        throw new Error("Cột “Ngày giao dự kiến” phải có ngày hợp lệ ở tất cả các dòng.");
      }
      setItems(parsed);
      setPlanFile(file);
      setPlanFileName(file.name);
      const earliestDate = parsed
        .map((item) => item.expectedDeliveryDate)
        .filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date ?? ""))
        .sort()[0];
      if (earliestDate) setDeliveryDate(earliestDate);
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

  async function handleRequestDeliveryDateChanges(selection: DeliveryDateChangeSelection[]) {
    if (!db || !user || !admin) return;
    const database = db;
    if (selection.length === 0) {
      setError("Chọn ít nhất một mặt hàng và đặt ngày giao mới cho từng mặt hàng.");
      return;
    }
    let validated: Array<DeliveryDateChangeSelection & { request: DeliveryRequest; item: DeliveryItem }>;
    try {
      const uniqueKeys = new Set<string>();
      validated = selection.map((entry) => {
        const key = `${entry.requestId}:${entry.itemIndex}`;
        if (uniqueKeys.has(key)) throw new Error("Một mặt hàng bị chọn nhiều lần.");
        uniqueKeys.add(key);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(entry.requestedDate)) {
          throw new Error("Hãy chọn ngày giao mới hợp lệ cho tất cả mặt hàng đã chọn.");
        }
        const request = requests.find((candidate) => candidate.id === entry.requestId);
        if (!request || request.deleted) throw new Error("Không tìm thấy một trong các phiếu đã chọn.");
        const item = request.items[entry.itemIndex];
        if (!item) throw new Error("Không tìm thấy một trong các mặt hàng đã chọn.");
        if (entry.requestedDate === item.expectedDeliveryDate) {
          throw new Error("Ngày giao mới phải khác ngày hiện tại ở tất cả mặt hàng đã chọn.");
        }
        if (request.deliveryDateRequests.some((proposal) => proposal.itemIndex === entry.itemIndex && proposal.status === "pending")) {
          throw new Error("Một trong các mặt hàng đã có yêu cầu đang chờ phản hồi.");
        }
        return { ...entry, request, item };
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Các mặt hàng đã chọn không hợp lệ.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await Promise.all(validated.map(async ({ request, item, itemIndex, requestedDate }) => {
        const proposalRef = push(ref(database, `requests/${request.id}/deliveryDateRequests`));
        if (!proposalRef.key) throw new Error("Không tạo được mã yêu cầu đổi ngày.");
        await set(proposalRef, {
          itemIndex,
          itemName: item.name ?? "",
          itemSku: item.sku ?? "",
          currentDate: item.expectedDeliveryDate ?? "",
          requestedDate,
          status: "pending",
          createdAt: serverTimestamp(),
          createdByUid: user.uid,
          createdByEmail: user.email ?? "",
        });
      }));

      const byRequest = new Map<string, typeof validated>();
      for (const entry of validated) {
        const current = byRequest.get(entry.request.id) ?? [];
        current.push(entry);
        byRequest.set(entry.request.id, current);
      }
      await Promise.all([...byRequest].map(([, entriesForRequest]) => {
        const first = entriesForRequest[0];
        const summary = entriesForRequest
          .map(({ item, itemIndex, requestedDate }) => `${item.name || `dòng ${itemIndex + 1}`}: ${requestedDate}`)
          .join("; ")
          .slice(0, 330);
        return notify(
          first.request.id,
          `${first.request.supplierName} · Admin đề nghị đổi ngày cho ${entriesForRequest.length} mặt hàng: ${summary}.`,
          {
            event: "delivery_date_requested",
            supplierName: first.request.supplierName,
            senderName: profile.displayName || user.displayName || user.email || "Quản trị viên",
          },
          { recipientRole: "supplier", recipientUid: first.request.ownerUid },
        );
      }));
      setNotice(`Đã gửi ${validated.length} yêu cầu thay đổi ngày giao cho nhà cung cấp.`);
      setPage("deliveryDateRequests");
    } catch (cause) {
      setError(`Không gửi được các yêu cầu thay đổi ngày giao: ${cause instanceof Error ? cause.message : "lỗi không xác định."}`);
    } finally {
      setSaving(false);
    }
  }

  async function handleRespondToDeliveryDateChange(
    proposalId: string,
    accept: boolean,
    requestId: string,
  ) {
    const targetRequest = requests.find((request) => request.id === requestId);
    const proposal = targetRequest?.deliveryDateRequests.find((entry) => entry.id === proposalId);
    if (!db || !user || !targetRequest || targetRequest.deleted || targetRequest.ownerUid !== user.uid || !proposal) return;
    if (proposal.status !== "pending") {
      setError("Yêu cầu này đã được phản hồi trước đó.");
      return;
    }
    const item = targetRequest.items[proposal.itemIndex];
    if (accept && (!item || item.expectedDeliveryDate !== proposal.currentDate)) {
      setError("Mặt hàng hoặc ngày giao đã thay đổi sau khi admin gửi yêu cầu. Vui lòng liên hệ admin để gửi yêu cầu mới.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const updates: Record<string, unknown> = {
        [`requests/${targetRequest.id}/deliveryDateRequests/${proposalId}/status`]: accept ? "accepted" : "rejected",
        [`requests/${targetRequest.id}/deliveryDateRequests/${proposalId}/responseAt`]: serverTimestamp(),
        [`requests/${targetRequest.id}/deliveryDateRequests/${proposalId}/responseByUid`]: user.uid,
      };
      if (accept) {
        const revisionRef = push(ref(db, `requests/${targetRequest.id}/revisions`));
        if (!revisionRef.key) throw new Error("Không tạo được lịch sử cập nhật ngày giao.");
        const nextItems = targetRequest.items.map((entry, index) =>
          index === proposal.itemIndex
            ? { ...entry, expectedDeliveryDate: proposal.requestedDate }
            : entry,
        );
        const nextDeliveryDate = nextItems
          .map((entry) => entry.expectedDeliveryDate)
          .filter((date): date is string => /^\d{4}-\d{2}-\d{2}$/.test(date ?? ""))
          .sort()[0];
        updates[`requests/${targetRequest.id}/revisions/${revisionRef.key}`] = {
          actorUid: user.uid,
          actorEmail: user.email ?? "",
          createdAt: serverTimestamp(),
          changes: {
            ...(nextDeliveryDate && nextDeliveryDate !== targetRequest.deliveryDate
              ? { deliveryDate: nextDeliveryDate }
              : {}),
            itemChanges: [{
              index: proposal.itemIndex,
              key: "expectedDeliveryDate",
              value: proposal.requestedDate,
            }],
          },
        };
      }
      await update(ref(db), updates);
      const responseText = accept
        ? `Nhà cung cấp đã chấp nhận đổi ngày giao mặt hàng "${proposal.itemName || `dòng ${proposal.itemIndex + 1}`}" sang ${proposal.requestedDate}.`
        : `Nhà cung cấp đã từ chối đề nghị đổi ngày giao mặt hàng "${proposal.itemName || `dòng ${proposal.itemIndex + 1}`}".`;
      await notify(
        targetRequest.id,
        `${targetRequest.supplierName} · ${responseText}`,
        {
          event: "delivery_date_response",
          supplierName: targetRequest.supplierName,
          senderName: profile.displayName || user.displayName || user.email || "Nhà cung cấp",
        },
        { recipientRole: "admin" },
      );
      setNotice(accept ? "Đã chấp nhận yêu cầu; ngày giao mặt hàng được cập nhật." : "Đã từ chối yêu cầu thay đổi ngày giao.");
    } catch (cause) {
      setError(`Không lưu được phản hồi thay đổi ngày giao: ${cause instanceof Error ? cause.message : "lỗi không xác định."}`);
    } finally {
      setSaving(false);
    }
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
    const expectedDates = items.map((item) => item.expectedDeliveryDate).filter(Boolean).sort();
    if (items.some((item) => !/^\d{4}-\d{2}-\d{2}$/.test(item.expectedDeliveryDate ?? ""))) {
      setError("Mỗi dòng hàng cần có ngày giao dự kiến hợp lệ.");
      return;
    }
    const effectiveDeliveryDate = admin ? deliveryDate : expectedDates[0];
    if (effectiveDeliveryDate && effectiveDeliveryDate !== selected.deliveryDate) changes.deliveryDate = effectiveDeliveryDate;
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
    if (!targetRequest || targetRequest.deleted || !admin || targetRequest.status === status || status === "reminded" || status === "delivered") return;
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

  async function handleDeliveryReminder(requestId = selected?.id) {
    const targetRequest = requests.find((request) => request.id === requestId);
    if (!targetRequest || targetRequest.deleted || !admin || !user || !["approved", "reminded", "overdue"].includes(targetRequest.status)) return;
    setSaving(true);
    setError("");
    try {
      await saveRevision(targetRequest, {}, targetRequest.status === "overdue" ? "overdue" : "reminded");
      await recordActivity(
        "request_status_changed",
        "Admin gửi nhắc lịch giao hàng cho nhà cung cấp.",
        targetRequest.id,
      );
      await notify(
        targetRequest.id,
        `${targetRequest.supplierName} · Nhắc giao hàng: lịch giao ${targetRequest.deliveryDate}.`,
        {
          event: "delivery_reminder",
          supplierName: targetRequest.supplierName,
          senderName: profile.displayName || user.displayName || user.email || "Quản trị viên",
        },
        { recipientRole: "supplier", recipientUid: targetRequest.ownerUid },
      );
      setNotice(`Đã gửi nhắc giao hàng cho ${targetRequest.supplierName}.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Không gửi được nhắc giao hàng.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDeliveryConfirmation(requestId = selected?.id) {
    const targetRequest = requests.find((request) => request.id === requestId);
    if (!targetRequest || targetRequest.deleted || !user || (!admin && targetRequest.ownerUid !== user.uid)) return;
    if (!["approved", "reminded", "overdue"].includes(targetRequest.status)) return;
    setSaving(true);
    setError("");
    try {
      await saveRevision(targetRequest, {}, "delivered");
      await recordActivity(
        "request_status_changed",
        `${admin ? "Admin" : "Nhà cung cấp"} xác nhận đã giao hàng.`,
        targetRequest.id,
      );
      await notify(
        targetRequest.id,
        `${targetRequest.supplierName} · Đã xác nhận hoàn tất giao hàng.`,
        {
          event: "delivery_confirmed",
          supplierName: targetRequest.supplierName,
          senderName: profile.displayName || user.displayName || user.email || "",
        },
        admin
          ? { recipientRole: "supplier", recipientUid: targetRequest.ownerUid }
          : {
              recipientRole: "admin",
            },
      );
      setNotice(`Đã xác nhận giao hàng cho ${targetRequest.supplierName}.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Không xác nhận được giao hàng.");
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
    setPage(admin && target === "supplier" ? "admin" : target);
    setSelectedId(null);
    setHighlightTarget(null);
    void recordActivity("page_opened", `Mở trang ${target}.`);
  };

  const openNotification = (notification: NotificationDocument) => {
    void markNotificationRead(notification.id);
    if (notification.event === "delivery_date_requested" || notification.event === "delivery_date_response") {
      openPage("deliveryDateRequests");
      return;
    }
    setPage(admin ? "admin" : "supplier");
    openRequest(notification.requestId);
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
          {!admin && <button className={`nav-item ${page === "supplier" ? "active" : ""}`} onClick={() => openPage("supplier")}>
            <span className="nav-icon">↗</span> Đăng ký giao hàng
          </button>}
          {admin && <button className={`nav-item ${page === "admin" ? "active" : ""}`} onClick={() => openPage("admin")}>
            <span className="nav-icon">▦</span> Quản trị tổng hợp
          </button>}
          <button className={`nav-item ${page === "messages" ? "active" : ""}`} onClick={() => openPage("messages")}>
            <span className="nav-icon">✉</span> Tin nhắn
            {unreadMessageCount > 0 && <span className="count nav-count">{unreadMessageCount > 99 ? "99+" : unreadMessageCount}</span>}
          </button>
          <button className={`nav-item ${page === "deliveryDateRequests" ? "active" : ""}`} onClick={() => openPage("deliveryDateRequests")}>
            <span className="nav-icon">↔</span> Đổi ngày giao hàng
            {!admin && requests.reduce((count, request) => count + request.deliveryDateRequests.filter((proposal) => proposal.status === "pending").length, 0) > 0 && (
              <span className="count nav-count">
                {requests.reduce((count, request) => count + request.deliveryDateRequests.filter((proposal) => proposal.status === "pending").length, 0)}
              </span>
            )}
          </button>
          <button className={`nav-item ${page === "notifications" ? "active" : ""}`} onClick={() => openPage("notifications")}>
            <span className="nav-icon">♧</span> Thông báo
            {unreadNotificationCount > 0 && <span className="count nav-count">{unreadNotificationCount > 99 ? "99+" : unreadNotificationCount}</span>}
          </button>
          {developer && <button className={`nav-item ${page === "deepAdmin" ? "active" : ""}`} onClick={() => openPage("deepAdmin")}>
            <span className="nav-icon">⌘</span> Deep Admin
          </button>}
          <button className={`nav-item ${page === "profile" ? "active" : ""}`} onClick={() => openPage("profile")}>
            <span className="nav-icon">◎</span> Hồ sơ của tôi
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
        <main className={`main-content ${admin && page === "admin" ? "admin-main-content" : ""}`}>

          <ChatWidget
            user={user}
            admin={admin}
            adminRecipients={adminRecipients}
            requests={requests}
            onOpenMention={openMentionedContent}
            onUnreadCountChange={setUnreadMessageCount}
            onOpenMessages={openMessagesPage}
            active={page === "messages"}
            hidden={page !== "messages"}
            supplierDisplayName={
              supplierName.trim()
              || profile.organization
              || requests.find((request) => request.ownerUid === user.uid)?.supplierName
              || "Nhà cung cấp"
            }
          />
          {page !== "messages" && (page === "deliveryDateRequests" ? (
            <DeliveryDateRequestsPage
              requests={requests.filter((request) => !request.deleted)}
              admin={admin}
              saving={saving}
              onSubmit={(selection) => void handleRequestDeliveryDateChanges(selection)}
              onRespond={(requestId, proposalId, accept) => void handleRespondToDeliveryDateChange(proposalId, accept, requestId)}
              onOpenRequest={(requestId) => {
                setPage(admin ? "admin" : "supplier");
                openRequest(requestId);
              }}
            />
          ) : page === "notifications" ? (
            <section className="notifications-page">
              <div className="page-heading">
                <div><p className="eyebrow">CẬP NHẬT</p><h1>Thông báo</h1><p className="muted">Toàn bộ thông báo mới nhất của bạn.</p></div>
                <span className="count">{unreadNotificationCount} chưa đọc</span>
              </div>
              <div className="panel notification-list">
                {visibleNotifications.length === 0 ? <p className="muted small">Chưa có thông báo.</p> : visibleNotifications.slice(notificationPage * 20, (notificationPage + 1) * 20).map((notification) => (
                  <div key={notification.id} className="notification-row">
                    <button
                      className={`notification-item ${readNotificationIds.has(notification.id) ? "read" : "unread"}`}
                      onClick={() => {
                        openNotification(notification);
                      }}
                    >
                      {!readNotificationIds.has(notification.id) && <span className="notification-dot" />}
                      <span>{notification.text}<small>{formatDate(notification.createdAt)}</small></span>
                    </button>
                    <NotificationActions
                      open={openNotificationMenuId === notification.id}
                      onToggle={() => setOpenNotificationMenuId((openId) => openId === notification.id ? null : notification.id)}
                      onDelete={() => void deleteNotification(notification.id)}
                    />
                  </div>
                ))}
              </div>
              <Pagination page={notificationPage} pageSize={20} total={visibleNotifications.length} onPageChange={setNotificationPage} />
            </section>
          ) : page === "deepAdmin" && developer ? (
            <DeepAdminPage currentUserUid={user.uid} />
          ) : page === "profile" ? (
            <ProfilePage
              user={user}
              profile={profile}
              saving={saving}
              onSave={(nextProfile) => void handleProfileSave(nextProfile)}
            />
          ) : (page === "admin" || page === "supplier") && admin ? (
            <>
              <div className={selected ? "admin-list-hidden" : ""} aria-hidden={!!selected}>
                <AdminPage
                  requests={requests}
                  loading={loadingRequests}
                  selectedId={selectedId}
                  focusRequestId={highlightTarget?.requestId ?? null}
                  onSelect={openRequest}
                  onStatusChange={(id, status) => handleStatusChange(status, id)}
                  onDeliveryReminder={(id) => handleDeliveryReminder(id)}
                  onDeliveryConfirmation={(id) => handleDeliveryConfirmation(id)}
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
                  <span>Ngày giao: {selected.deliveryDate || "Chưa xác định"} <b>›</b> {selected.supplierName} <b>›</b> Chi tiết phiếu</span>
                </div>
                <RequestDetail
                request={selected}
                admin
                supplierName={supplierName}
                deliveryDate={deliveryDate}
                items={items}
                saving={saving}
                highlightTarget={highlightTarget}
                onBack={() => { setSelectedId(null); setHighlightTarget(null); }}
                onSupplierName={setSupplierName}
                onDeliveryDate={setDeliveryDate}
                onItemChange={updateItem}
                onRemoveItem={removeItem}
                planFileName={planFileName}
                introductionFileName={introductionFileName}
                onPlanFile={(file) => void handlePlanFile(file)}
                onDownloadTemplate={() => void handleDownloadTemplate()}
                onIntroductionFile={handleIntroductionFile}
                onSave={() => void handleSaveEdit()}
                onStatus={(status) => void handleStatusChange(status)}
                onDeliveryReminder={() => void handleDeliveryReminder()}
                onDeliveryConfirmation={() => void handleDeliveryConfirmation()}
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
                  deliveryDate={deliveryDate}
                  items={items}
                  saving={saving}
                  highlightTarget={highlightTarget}
                  onBack={() => { setSelectedId(null); setHighlightTarget(null); }}
                  onSupplierName={setSupplierName}
                  onDeliveryDate={setDeliveryDate}
                  onItemChange={updateItem}
                  onRemoveItem={removeItem}
                  planFileName={planFileName}
                  introductionFileName={introductionFileName}
                  onPlanFile={(file) => void handlePlanFile(file)}
                  onDownloadTemplate={() => void handleDownloadTemplate()}
                  onIntroductionFile={handleIntroductionFile}
                  onSave={() => void handleSaveEdit()}
                  onStatus={(status) => void handleStatusChange(status)}
                  onDeliveryReminder={() => void handleDeliveryReminder()}
                  onDeliveryConfirmation={() => void handleDeliveryConfirmation()}
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
                  const days = daysUntilDelivery(request.deliveryDate);
                  return <button key={request.id} className={`request-card ${selectedId === request.id ? "selected" : ""}`} onClick={() => openRequest(request.id)}>
                    <div className="request-card-top"><span className={`status status-${request.status}`}>{statusLabels[request.status]}</span><span className="muted tiny">{formatDate(request.createdAt)}</span></div>
                    <strong>{request.supplierName}</strong>
                    <span className="muted small">Kế hoạch từ {request.deliveryDate}</span>
                    <span className={`delivery-countdown delivery-${deliveryTone(request.deliveryDate, request.status)}`}>
                      {request.status === "delivered" ? "Đã hoàn tất giao hàng" : deliveryCountdownLabel(days)}
                    </span>
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

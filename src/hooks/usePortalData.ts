import { useEffect, useState, type Dispatch, type SetStateAction } from "react";
import {
  equalTo,
  onValue,
  orderByChild,
  query,
  ref,
  type DatabaseReference,
} from "firebase/database";
import type { User } from "firebase/auth";
import { db } from "../firebase";
import { requestFromSnapshot } from "../lib/delivery";
import type { DeliveryRequest, NotificationDocument, UserProfile } from "../types";

export type UserRole = "admin" | "developer" | "user";
export interface AdminRecipient {
  uid: string;
  email: string;
  label: string;
}

interface RoleRecord {
  role?: string;
  email?: string;
  displayName?: string;
}

function profileFromSnapshot(
  profile: Partial<UserProfile> | null,
  user: User,
): UserProfile {
  return {
    displayName: profile?.displayName || user.displayName || "",
    organization: profile?.organization || "",
    phone: profile?.phone || "",
    ...(profile?.updatedAt ? { updatedAt: profile.updatedAt } : {}),
  };
}

function entries<T extends object>(value: unknown): Array<[string, T]> {
  if (!value || typeof value !== "object") return [];
  return Object.entries(value) as Array<[string, T]>;
}

export function usePortalData(
  user: User | null,
  reportError: Dispatch<SetStateAction<string>>,
) {
  const [requests, setRequests] = useState<DeliveryRequest[]>([]);
  const [notifications, setNotifications] = useState<NotificationDocument[]>([]);
  const [readNotificationIds, setReadNotificationIds] = useState<Set<string>>(() => new Set());
  const [deletedNotificationIds, setDeletedNotificationIds] = useState<Set<string>>(() => new Set());
  const [notificationsLoaded, setNotificationsLoaded] = useState(false);
  const [profile, setProfile] = useState<UserProfile>({
    displayName: "",
    organization: "",
    phone: "",
  });
  const [loadingRequests, setLoadingRequests] = useState(false);
  const [role, setRole] = useState<UserRole | null>(null);
  const [adminRecipients, setAdminRecipients] = useState<AdminRecipient[]>([]);

  useEffect(() => {
    setRole(null);
    setAdminRecipients([]);
    if (!user || !db) return;
    return onValue(
      ref(db, "roles"),
      (snapshot) => {
        const roles = entries<RoleRecord>(snapshot.val());
        const ownRole = roles.find(([uid]) => uid === user.uid)?.[1]?.role;
        setRole(ownRole === "admin" || ownRole === "developer" ? ownRole : "user");
        setAdminRecipients(
          roles
            .filter(([, record]) => record.role === "admin" && typeof record.email === "string")
            .map(([uid, record]) => ({
              uid,
              email: record.email!,
              label: record.displayName || record.email!,
            })),
        );
      },
      (cause) => {
        setRole("user");
        reportError(`Không tải được phân quyền: ${cause.message}`);
      },
    );
  }, [user, reportError]);

  const admin = role === "admin";

  useEffect(() => {
    if (!user || !db) {
      setRequests([]);
      return;
    }
    setLoadingRequests(true);
    const requestsRef = ref(db, "requests");
    const requestQuery = admin
      ? requestsRef
      : query(requestsRef, orderByChild("ownerUid"), equalTo(user.uid));
    return onValue(
      requestQuery,
      (snapshot) => {
        const loaded = entries<Record<string, unknown>>(snapshot.val())
          .map(([id, data]) => requestFromSnapshot(id, data))
          .sort((a, b) => b.createdAt - a.createdAt);
        setRequests(loaded);
        setLoadingRequests(false);
        reportError("");
      },
      (cause) => {
        reportError(`Không tải được phiếu: ${cause.message}`);
        setLoadingRequests(false);
      },
    );
  }, [user, admin, reportError]);

  useEffect(() => {
    setNotificationsLoaded(false);
    setReadNotificationIds(new Set());
    if (!user || !db) {
      setNotifications([]);
      return;
    }
    const notificationPath = admin
      ? "notifications/admin"
      : `notifications/users/${user.uid}`;
    return onValue(
      ref(db, notificationPath),
      (snapshot) => {
        const loaded = entries<Omit<NotificationDocument, "id">>(snapshot.val())
          .map(([id, notification]) => ({ ...notification, id }))
          .sort((a, b) => b.createdAt - a.createdAt);
        setNotifications(loaded);
        setNotificationsLoaded(true);
      },
      (cause) => reportError(`Không tải được thông báo: ${cause.message}`),
    );
  }, [user, admin, reportError]);

  useEffect(() => {
    if (!user || !db) {
      setReadNotificationIds(new Set());
      setDeletedNotificationIds(new Set());
      return;
    }
    return onValue(
      ref(db, `notifications/notificationReads/${user.uid}`),
      (snapshot) => {
        setReadNotificationIds(new Set(Object.keys(snapshot.val() ?? {})));
      },
      (cause) => reportError(`Không tải được trạng thái đã đọc: ${cause.message}`),
    );
  }, [user, reportError]);

  useEffect(() => {
    if (!user || !db) {
      setDeletedNotificationIds(new Set());
      return;
    }
    return onValue(
      ref(db, `notifications/deleted/${user.uid}`),
      (snapshot) => setDeletedNotificationIds(new Set(Object.keys(snapshot.val() ?? {}))),
      (cause) => reportError(`Không tải được thông báo đã xóa: ${cause.message}`),
    );
  }, [user, reportError]);

  useEffect(() => {
    if (!user || !db) {
      setProfile({ displayName: "", organization: "", phone: "" });
      return;
    }
    const profileRef: DatabaseReference = ref(db, `profiles/${user.uid}`);
    return onValue(
      profileRef,
      (snapshot) =>
        setProfile(profileFromSnapshot(snapshot.val() as Partial<UserProfile> | null, user)),
      (cause) => reportError(`Không tải được hồ sơ: ${cause.message}`),
    );
  }, [user, reportError]);

  return {
    requests,
    notifications,
    readNotificationIds,
    deletedNotificationIds,
    notificationsLoaded,
    profile,
    loadingRequests,
    role,
    adminRecipients,
  };
}

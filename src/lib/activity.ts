import { push, ref, serverTimestamp, set } from "firebase/database";
import { db } from "../firebase";
import type { ActivityAction, ActivityLog } from "../types";

export async function logActivity(
  actor: { uid: string; email: string | null },
  action: ActivityAction,
  details: string,
  requestId?: string,
) {
  if (!db || !actor.email) {
    throw new Error("Không thể ghi log khi Firebase hoặc email người dùng chưa sẵn sàng.");
  }
  const logRef = push(ref(db, "activityLogs"));
  const entry: Omit<ActivityLog, "id" | "createdAt"> & {
    createdAt: ReturnType<typeof serverTimestamp>;
  } = {
    actorUid: actor.uid,
    actorEmail: actor.email,
    action,
    details: details.slice(0, 1000),
    ...(requestId ? { requestId } : {}),
    createdAt: serverTimestamp(),
  };
  await set(logRef, entry);
}

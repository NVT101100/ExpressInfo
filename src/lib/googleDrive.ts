import {
  GoogleAuthProvider,
  reauthenticateWithPopup,
  type User,
} from "firebase/auth";
import { GOOGLE_DRIVE_DELIVERY_FOLDER_ID } from "../config";
import { auth } from "../firebase";
import type { DriveFileReference } from "../types";

const DRIVE_FILE_SCOPE = "https://www.googleapis.com/auth/drive.file";
const DRIVE_TOKEN_CACHE_MS = 59 * 60 * 1000;

let cachedDriveToken: { uid: string; accessToken: string; expiresAt: number } | null = null;

function mimeTypeForFile(file: File) {
  if (file.type) return file.type;
  const extension = file.name.split(".").pop()?.toLowerCase();
  const types: Record<string, string> = {
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    pdf: "application/pdf",
    doc: "application/msword",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
  };
  return types[extension ?? ""] || "application/octet-stream";
}

export async function getDriveAccessToken(user: User) {
  if (!GOOGLE_DRIVE_DELIVERY_FOLDER_ID.trim()) {
    throw new Error("Chưa cấu hình GOOGLE_DRIVE_DELIVERY_FOLDER_ID trong src/config.ts.");
  }
  if (!auth || auth.currentUser?.uid !== user.uid) {
    throw new Error("Phiên đăng nhập không còn hợp lệ. Hãy đăng nhập lại.");
  }
  if (cachedDriveToken?.uid === user.uid && cachedDriveToken.expiresAt > Date.now()) {
    return cachedDriveToken.accessToken;
  }
  const provider = new GoogleAuthProvider();
  provider.addScope(DRIVE_FILE_SCOPE);
  const result = await reauthenticateWithPopup(user, provider);
  const credential = GoogleAuthProvider.credentialFromResult(result);
  if (!credential?.accessToken) {
    throw new Error("Google không cấp quyền truy cập Drive. Hãy thử lại và chấp thuận quyền Drive.");
  }
  cachedDriveToken = {
    uid: user.uid,
    accessToken: credential.accessToken,
    expiresAt: Date.now() + DRIVE_TOKEN_CACHE_MS,
  };
  return credential.accessToken;
}

export async function uploadToDeliveryDrive(
  accessToken: string,
  file: File,
): Promise<DriveFileReference> {
  const folderId = GOOGLE_DRIVE_DELIVERY_FOLDER_ID.trim();
  if (!folderId) {
    throw new Error("Chưa cấu hình GOOGLE_DRIVE_DELIVERY_FOLDER_ID trong src/config.ts.");
  }
  const metadata = {
    name: file.name,
    mimeType: mimeTypeForFile(file),
    parents: [folderId],
  };
  const initialize = await fetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true&fields=id,name,mimeType,webViewLink",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json; charset=UTF-8",
        "X-Upload-Content-Type": metadata.mimeType,
        "X-Upload-Content-Length": String(file.size),
      },
      body: JSON.stringify(metadata),
    },
  );
  if (!initialize.ok) {
    throw new Error(`Không tạo được tệp trên Google Drive (${initialize.status}): ${await initialize.text()}`);
  }
  const uploadUrl = initialize.headers.get("Location");
  if (!uploadUrl) throw new Error("Google Drive không trả về địa chỉ tải tệp.");
  const parsedUploadUrl = new URL(uploadUrl);
  if (parsedUploadUrl.protocol !== "https:" || parsedUploadUrl.hostname !== "www.googleapis.com") {
    throw new Error("Google Drive trả về địa chỉ upload không hợp lệ.");
  }
  const uploaded = await fetch(uploadUrl, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": metadata.mimeType,
    },
    body: file,
  });
  if (!uploaded.ok) {
    throw new Error(`Không tải được "${file.name}" lên Google Drive (${uploaded.status}): ${await uploaded.text()}`);
  }
  const result = await uploaded.json() as {
    id?: string;
    name?: string;
    mimeType?: string;
    webViewLink?: string;
  };
  if (!result.id) throw new Error(`Google Drive tải "${file.name}" lên nhưng không trả về mã tệp.`);
  return {
    id: result.id,
    name: result.name || file.name,
    url: result.webViewLink || `https://drive.google.com/open?id=${encodeURIComponent(result.id)}`,
    mimeType: result.mimeType || metadata.mimeType,
  };
}

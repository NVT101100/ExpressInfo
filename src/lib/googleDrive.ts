import {
  GoogleAuthProvider,
  reauthenticateWithPopup,
  type User,
} from "firebase/auth";
import { GOOGLE_DRIVE_DELIVERY_FOLDER_ID } from "../config";
import { auth } from "../firebase";
import type { DriveFileReference } from "../types";

const DRIVE_FILE_SCOPE = "https://www.googleapis.com/auth/drive.file";
const DRIVE_MANAGEMENT_SCOPE = "https://www.googleapis.com/auth/drive";
const DRIVE_TOKEN_CACHE_MS = 59 * 60 * 1000;
const DRIVE_FOLDER_MIME_TYPE = "application/vnd.google-apps.folder";

let cachedDriveToken: { uid: string; accessToken: string; expiresAt: number; canManageAllFiles: boolean } | null = null;

export interface ManagedDriveFile extends DriveFileReference {
  modifiedTime: string;
  size: number;
  folderPath: string;
}

export function cacheDriveAccessToken(uid: string, accessToken: string, canManageAllFiles = false) {
  cachedDriveToken = {
    uid,
    accessToken,
    expiresAt: Date.now() + DRIVE_TOKEN_CACHE_MS,
    canManageAllFiles,
  };
}

export function createGoogleDriveProvider(canManageAllFiles = false) {
  const provider = new GoogleAuthProvider();
  provider.addScope(DRIVE_FILE_SCOPE);
  if (canManageAllFiles) provider.addScope(DRIVE_MANAGEMENT_SCOPE);
  return provider;
}

function escapeDriveQueryValue(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function supplierFolderName(value: string) {
  const name = value.trim().replace(/[\\/]/g, " - ").replace(/[\u0000-\u001f<>:"|?*]/g, "").replace(/\s+/g, " ");
  return name && name !== "." && name !== ".." ? name.slice(0, 150) : "Nha cung cap";
}

export function getSubmissionDateFolderName(createdAt: number) {
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) throw new Error("Ngày gửi form không hợp lệ.");
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

async function findOrCreateFolder(accessToken: string, parentId: string, name: string) {
  const query = `'${escapeDriveQueryValue(parentId)}' in parents and name = '${escapeDriveQueryValue(name)}' and mimeType = '${DRIVE_FOLDER_MIME_TYPE}' and trashed = false`;
  const searchUrl = new URL("https://www.googleapis.com/drive/v3/files");
  searchUrl.searchParams.set("q", query);
  searchUrl.searchParams.set("pageSize", "100");
  searchUrl.searchParams.set("fields", "files(id,name)");
  searchUrl.searchParams.set("supportsAllDrives", "true");
  searchUrl.searchParams.set("includeItemsFromAllDrives", "true");
  const search = await fetch(searchUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!search.ok) {
    throw new Error(`Không tìm được thư mục "${name}" trên Google Drive (${search.status}): ${await search.text()}`);
  }
  const searchResult = await search.json() as { files?: Array<{ id?: string }> };
  const existing = searchResult.files?.find((folder) => folder.id);
  if (existing?.id) return existing.id;

  const create = await fetch(
    "https://www.googleapis.com/drive/v3/files?supportsAllDrives=true&fields=id,name",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json; charset=UTF-8",
      },
      body: JSON.stringify({
        name,
        mimeType: DRIVE_FOLDER_MIME_TYPE,
        parents: [parentId],
      }),
    },
  );
  if (!create.ok) {
    throw new Error(`Không tạo được thư mục "${name}" trên Google Drive (${create.status}): ${await create.text()}`);
  }
  const folder = await create.json() as { id?: string };
  if (!folder.id) throw new Error(`Google Drive tạo thư mục "${name}" nhưng không trả về mã thư mục.`);
  return folder.id;
}

export async function getSubmissionDriveFolder(
  accessToken: string,
  supplierName: string,
  createdAt: number,
) {
  const rootFolderId = GOOGLE_DRIVE_DELIVERY_FOLDER_ID.trim();
  if (!rootFolderId) {
    throw new Error("Chưa cấu hình GOOGLE_DRIVE_DELIVERY_FOLDER_ID trong src/config.ts.");
  }
  const supplierId = await findOrCreateFolder(accessToken, rootFolderId, supplierFolderName(supplierName));
  return findOrCreateFolder(accessToken, supplierId, getSubmissionDateFolderName(createdAt));
}

async function listFolderChildren(accessToken: string, folderId: string) {
  const files: Array<{
    id: string;
    name: string;
    mimeType: string;
    webViewLink?: string;
    modifiedTime?: string;
    size?: string;
  }> = [];
  let pageToken: string | undefined;
  do {
    const url = new URL("https://www.googleapis.com/drive/v3/files");
    url.searchParams.set("q", `'${escapeDriveQueryValue(folderId)}' in parents and trashed = false`);
    url.searchParams.set("pageSize", "1000");
    url.searchParams.set("fields", "nextPageToken,files(id,name,mimeType,webViewLink,modifiedTime,size)");
    url.searchParams.set("supportsAllDrives", "true");
    url.searchParams.set("includeItemsFromAllDrives", "true");
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) {
      throw new Error(`Không tải được danh sách file Drive (${response.status}): ${await response.text()}`);
    }
    const result = await response.json() as {
      files?: Array<{
        id?: string;
        name?: string;
        mimeType?: string;
        webViewLink?: string;
        modifiedTime?: string;
        size?: string;
      }>;
      nextPageToken?: string;
    };
    for (const file of result.files ?? []) {
      if (file.id && file.name && file.mimeType) {
        files.push({
          id: file.id,
          name: file.name,
          mimeType: file.mimeType,
          ...(file.webViewLink ? { webViewLink: file.webViewLink } : {}),
          ...(file.modifiedTime ? { modifiedTime: file.modifiedTime } : {}),
          ...(file.size ? { size: file.size } : {}),
        });
      }
    }
    pageToken = result.nextPageToken;
  } while (pageToken);
  return files;
}

export async function listDeliveryDriveFiles(accessToken: string): Promise<ManagedDriveFile[]> {
  const rootFolderId = GOOGLE_DRIVE_DELIVERY_FOLDER_ID.trim();
  if (!rootFolderId) {
    throw new Error("Chưa cấu hình GOOGLE_DRIVE_DELIVERY_FOLDER_ID trong src/config.ts.");
  }
  const queue: Array<{ id: string; path: string }> = [{ id: rootFolderId, path: "" }];
  const visitedFolders = new Set<string>();
  const files: ManagedDriveFile[] = [];
  while (queue.length) {
    const folder = queue.shift()!;
    if (visitedFolders.has(folder.id)) continue;
    visitedFolders.add(folder.id);
    const children = await listFolderChildren(accessToken, folder.id);
    for (const child of children) {
      if (child.mimeType === DRIVE_FOLDER_MIME_TYPE) {
        queue.push({
          id: child.id,
          path: folder.path ? `${folder.path}/${child.name}` : child.name,
        });
      } else {
        files.push({
          id: child.id,
          name: child.name,
          mimeType: child.mimeType,
          url: child.webViewLink || `https://drive.google.com/open?id=${encodeURIComponent(child.id)}`,
          modifiedTime: child.modifiedTime ?? "",
          size: Number(child.size) || 0,
          folderPath: folder.path || "/",
        });
      }
    }
  }
  return files.sort((a, b) => b.modifiedTime.localeCompare(a.modifiedTime) || a.name.localeCompare(b.name));
}

export async function deleteDeliveryDriveFile(accessToken: string, fileId: string) {
  const response = await fetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?supportsAllDrives=true`,
    {
      method: "DELETE",
      headers: { Authorization: `Bearer ${accessToken}` },
    },
  );
  if (!response.ok) {
    throw new Error(`Không xóa được file trên Google Drive (${response.status}): ${await response.text()}`);
  }
}

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

export async function getDriveAccessToken(user: User, canManageAllFiles = false) {
  if (!GOOGLE_DRIVE_DELIVERY_FOLDER_ID.trim()) {
    throw new Error("Chưa cấu hình GOOGLE_DRIVE_DELIVERY_FOLDER_ID trong src/config.ts.");
  }
  if (!auth || auth.currentUser?.uid !== user.uid) {
    throw new Error("Phiên đăng nhập không còn hợp lệ. Hãy đăng nhập lại.");
  }
  if (cachedDriveToken?.uid === user.uid
    && cachedDriveToken.expiresAt > Date.now()
    && (!canManageAllFiles || cachedDriveToken.canManageAllFiles)) {
    return cachedDriveToken.accessToken;
  }
  const provider = createGoogleDriveProvider(canManageAllFiles);
  const result = await reauthenticateWithPopup(user, provider);
  const credential = GoogleAuthProvider.credentialFromResult(result);
  if (!credential?.accessToken) {
    throw new Error("Google không cấp quyền truy cập Drive. Hãy thử lại và chấp thuận quyền Drive.");
  }
  cacheDriveAccessToken(user.uid, credential.accessToken, canManageAllFiles);
  return credential.accessToken;
}

export async function uploadToDeliveryDrive(
  accessToken: string,
  file: File,
  folderId: string,
): Promise<DriveFileReference> {
  if (!folderId) {
    throw new Error("Không xác định được thư mục lưu file trong Google Drive.");
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

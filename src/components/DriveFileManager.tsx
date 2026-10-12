import { useMemo, useState } from "react";
import type { User } from "firebase/auth";
import { useConfirmation } from "./ConfirmationProvider";
import { deleteDeliveryDriveFile, getDriveAccessToken, listDeliveryDriveFiles, type ManagedDriveFile } from "../lib/googleDrive";

interface DriveFileManagerProps {
  user: User;
}

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatModifiedTime(value: string) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString("vi-VN");
}

export default function DriveFileManager({ user }: DriveFileManagerProps) {
  const confirm = useConfirmation();
  const [files, setFiles] = useState<ManagedDriveFile[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [deletingFileId, setDeletingFileId] = useState("");
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);

  const filteredFiles = useMemo(() => {
    const term = search.trim().toLocaleLowerCase();
    if (!term) return files;
    return files.filter((file) =>
      file.name.toLocaleLowerCase().includes(term)
      || file.folderPath.toLocaleLowerCase().includes(term)
      || file.mimeType.toLocaleLowerCase().includes(term),
    );
  }, [files, search]);

  async function refreshFiles() {
    setLoading(true);
    setError("");
    try {
      const accessToken = await getDriveAccessToken(user, true);
      setFiles(await listDeliveryDriveFiles(accessToken));
      setLoaded(true);
    } catch (cause) {
      setError(`Không tải được danh sách file Google Drive: ${cause instanceof Error ? cause.message : "lỗi không xác định."}`);
    } finally {
      setLoading(false);
    }
  }

  async function deleteFile(file: ManagedDriveFile) {
    const confirmed = await confirm({
      title: "Xóa file Google Drive?",
      message: `File "${file.name}" trong ${file.folderPath} sẽ bị xóa khỏi thư mục dùng chung.`,
      confirmLabel: "Xóa file",
      destructive: true,
    });
    if (!confirmed) return;
    setDeletingFileId(file.id);
    setError("");
    try {
      const accessToken = await getDriveAccessToken(user, true);
      await deleteDeliveryDriveFile(accessToken, file.id);
      setFiles((current) => current.filter((entry) => entry.id !== file.id));
    } catch (cause) {
      setError(`Không xóa được file Google Drive: ${cause instanceof Error ? cause.message : "lỗi không xác định."}`);
    } finally {
      setDeletingFileId("");
    }
  }

  return (
    <section className="panel table-panel drive-file-manager">
      <div className="toolbar">
        <div>
          <h2>Quản lý file Google Drive</h2>
          <p className="muted small">Xem và xóa file trong thư mục giao hàng cùng các thư mục con.</p>
        </div>
        <div className="drive-manager-actions">
          <input
            className="text-input search-input"
            aria-label="Tìm file Drive"
            placeholder="Tìm tên file hoặc thư mục…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            disabled={!loaded}
          />
          <button type="button" className="button secondary" onClick={() => void refreshFiles()} disabled={loading || !!deletingFileId}>
            {loading ? "Đang tải…" : loaded ? "Làm mới" : "Kết nối & tải danh sách"}
          </button>
        </div>
      </div>
      {error && <div className="alert error role-alert" role="alert">{error}</div>}
      <div className="table-wrap drive-file-table-wrap">
        <table>
          <thead><tr><th>TÊN FILE</th><th>THƯ MỤC</th><th>KÍCH THƯỚC</th><th>CẬP NHẬT</th><th>THAO TÁC</th></tr></thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={5} className="empty-row">Đang tải danh sách file và thư mục con…</td></tr>
            ) : !loaded ? (
              <tr><td colSpan={5} className="empty-row">Kết nối Google Drive để xem file trong thư mục giao hàng.</td></tr>
            ) : filteredFiles.map((file) => (
              <tr key={file.id}>
                <td className="drive-file-name">
                  <strong>{file.name}</strong>
                  <small>{file.mimeType}</small>
                </td>
                <td className="drive-file-path">{file.folderPath}</td>
                <td>{formatFileSize(file.size)}</td>
                <td>{formatModifiedTime(file.modifiedTime)}</td>
                <td>
                  <div className="drive-file-actions">
                    <a className="button table-action" href={file.url} target="_blank" rel="noopener noreferrer">Xem ↗</a>
                    <button
                      type="button"
                      className="button danger drive-file-delete"
                      disabled={!!deletingFileId}
                      onClick={() => void deleteFile(file)}
                    >
                      {deletingFileId === file.id ? "Đang xóa…" : "Xóa"}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {loaded && !loading && !filteredFiles.length && (
              <tr><td colSpan={5} className="empty-row">{search ? "Không tìm thấy file phù hợp." : "Chưa có file nào trong thư mục giao hàng."}</td></tr>
            )}
          </tbody>
        </table>
      </div>
      {loaded && <p className="drive-file-count">{filteredFiles.length === files.length ? `${files.length} file` : `${filteredFiles.length} / ${files.length} file`}</p>}
    </section>
  );
}

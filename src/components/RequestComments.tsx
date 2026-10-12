import { useEffect, useMemo, useState, type FormEvent } from "react";
import { onValue, push, ref, serverTimestamp, set } from "firebase/database";
import type { User } from "firebase/auth";
import { EXCEL_TEMPLATE } from "../config";
import { db } from "../firebase";
import { formatDate } from "../lib/delivery";
import type { DeliveryRequest, MentionField, MentionTarget } from "../types";

interface RequestComment {
  id: string;
  authorUid: string;
  authorEmail: string;
  authorName: string;
  text: string;
  createdAt: number;
  mention?: MentionTarget;
}

interface RequestCommentsProps {
  request: DeliveryRequest;
  user: User;
  admin: boolean;
  onOpenMention: (target: MentionTarget) => void;
}

export default function RequestComments({ request, user, admin, onOpenMention }: RequestCommentsProps) {
  const [comments, setComments] = useState<RequestComment[]>([]);
  const [text, setText] = useState("");
  const [mentionSelection, setMentionSelection] = useState("");
  const [mentionEnabled, setMentionEnabled] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!db) {
      setError("Firebase chưa được cấu hình.");
      return;
    }
    setComments([]);
    return onValue(
      ref(db, `requests/${request.id}/comments`),
      (snapshot) => {
        const value = snapshot.val() as Record<string, Omit<RequestComment, "id">> | null;
        setComments(
          Object.entries(value ?? {})
            .map(([id, comment]) => ({ ...comment, id }))
            .sort((a, b) => a.createdAt - b.createdAt),
        );
        setError("");
      },
      (cause) => setError(`Không tải được trao đổi của phiếu: ${cause.message}`),
    );
  }, [request.id]);

  const mentionTarget = useMemo<MentionTarget | undefined>(() => {
    if (!mentionSelection) return undefined;
    const [kind, keyOrIndex] = mentionSelection.split(":");
    if (kind === "field") {
      const field = keyOrIndex as MentionField;
      const labels: Record<Exclude<MentionField, "item">, string> = {
        supplierName: "Tên nhà cung cấp",
        deliveryDate: "Ngày giao hàng",
        deliveryTime: "Giờ giao hàng",
        recipientEmail: "Người nhận form",
        notes: "Ghi chú",
      };
      const value = field === "supplierName" ? request.supplierName
        : field === "deliveryDate" ? request.deliveryDate
          : field === "deliveryTime" ? request.deliveryTime
            : field === "recipientEmail" ? request.recipientEmail
              : field === "notes" ? request.notes
                : "";
      return {
        requestId: request.id,
        field,
        label: `${labels[field as keyof typeof labels]}${value ? `: ${value.slice(0, 90)}` : ""}`,
      };
    }
    if (kind === "item") {
      const itemIndex = Number(keyOrIndex);
      const itemKey = EXCEL_TEMPLATE.columns[0]?.key ?? "";
      if (!Number.isInteger(itemIndex) || itemIndex < 0 || itemIndex >= request.items.length || !itemKey) return undefined;
      return {
        requestId: request.id,
        field: "item",
        itemIndex,
        itemKey,
        label: `Cả dòng hàng hóa · dòng ${itemIndex + 1}`,
      };
    }
    return undefined;
  }, [mentionSelection, request]);

  async function sendComment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const message = text.trim();
    if (!db || !message || sending) return;
    if (mentionEnabled && !mentionTarget) {
      setError("Hãy chọn nội dung phiếu cần đề cập.");
      return;
    }
    setSending(true);
    setError("");
    try {
      const commentRef = push(ref(db, `requests/${request.id}/comments`));
      await set(commentRef, {
        authorUid: user.uid,
        authorEmail: user.email ?? "",
        authorName: user.displayName || user.email || (admin ? "Quản trị viên" : "Nhà cung cấp"),
        text: message,
        createdAt: serverTimestamp(),
        ...(mentionEnabled && mentionTarget ? { mention: mentionTarget } : {}),
      });
      setText("");
      setMentionSelection("");
      setMentionEnabled(false);
    } catch (cause) {
      setError(`Không gửi được bình luận: ${cause instanceof Error ? cause.message : "lỗi không xác định."}`);
    } finally {
      setSending(false);
    }
  }

  return (
    <details className="panel request-comments collapsible-panel" aria-label="Trao đổi trong phiếu">
      <summary className="collapsible-summary">
        <span className="step">04</span>
        <div>
          <h2>Trao đổi trong phiếu</h2>
          <p>{comments.length} bình luận · Nhà cung cấp và quản trị viên trao đổi tại đây.</p>
        </div>
        <span className="collapsible-chevron" aria-hidden="true" />
      </summary>
      <div className="collapsible-content">
      <div className="request-comment-list" aria-live="polite">
        {comments.length === 0
          ? <p className="muted small">Chưa có trao đổi. Hãy gửi bình luận đầu tiên.</p>
          : comments.map((comment) => {
            const mention = comment.mention;
            return <article key={comment.id} className={`request-comment ${comment.authorUid === user.uid ? "own-comment" : ""}`}>
              <div className="request-comment-header">
                <strong>{comment.authorName}</strong>
                <span>{comment.authorUid === user.uid ? "Bạn" : admin ? "Nhà cung cấp" : "Quản trị viên"}</span>
                <time>{formatDate(comment.createdAt)}</time>
              </div>
              <p>{comment.text}</p>
              {mention && <button
                type="button"
                className="comment-mention"
                onClick={() => onOpenMention(mention)}
              >
                @ {mention.label}
              </button>}
            </article>
          })}
      </div>
      {error && <p className="alert error" role="alert">{error}</p>}
      <form className="request-comment-form" onSubmit={(event) => void sendComment(event)}>
        <div className="comment-mention-controls">
          <button
            type="button"
            className={`button secondary mention-toggle ${mentionEnabled ? "active" : ""}`}
            aria-label="Đề cập nội dung phiếu trong bình luận"
            aria-pressed={mentionEnabled}
            disabled={sending}
            onClick={() => {
              setMentionEnabled((enabled) => !enabled);
              setError("");
            }}
          >
            {mentionEnabled ? "✓ Đang bật @" : "@ Đề cập"}
          </button>
          {mentionEnabled && (
            <label className="field">
              <span className="field-label">Chọn nội dung phiếu</span>
              <select
                className="text-input"
                value={mentionSelection}
                disabled={sending}
                onChange={(event) => setMentionSelection(event.target.value)}
              >
                <option value="">Chọn nội dung…</option>
                <optgroup label="Thông tin phiếu">
                  <option value="field:supplierName">Tên nhà cung cấp: {request.supplierName}</option>
                  <option value="field:deliveryDate">Ngày giao hàng: {request.deliveryDate || "Chưa có ngày"}</option>
                </optgroup>
                <optgroup label="Cả dòng hàng hóa">
                  {request.items.map((item, index) => (
                    <option key={index} value={`item:${index}`}>
                      Dòng {index + 1}{item.materialName ? ` · ${item.materialName}` : ""}
                    </option>
                  ))}
                </optgroup>
              </select>
            </label>
          )}
        </div>
        {mentionEnabled && mentionTarget && (
          <div className="chat-mention-line" title={mentionTarget.label}>
            <span>Đề cập · {mentionTarget.label}</span>
            <button type="button" aria-label="Bỏ nội dung đề cập" onClick={() => setMentionSelection("")}>×</button>
          </div>
        )}
        <textarea
          className="text-input notes-input"
          aria-label="Nội dung bình luận"
          placeholder="Viết nội dung trao đổi…"
          value={text}
          onChange={(event) => setText(event.target.value)}
          maxLength={2000}
          rows={3}
          disabled={sending}
          required
        />
        <div className="request-comment-footer">
          <span className="muted small">{text.length}/2000 ký tự</span>
          <button className="button primary" type="submit" disabled={sending || !text.trim() || (mentionEnabled && !mentionTarget)}>
            {sending ? "Đang gửi…" : "Gửi bình luận"}
          </button>
        </div>
      </form>
      </div>
    </details>
  );
}

import { useEffect, useMemo, useState, type FormEvent } from "react";
import type { User } from "firebase/auth";
import { limitToLast, onValue, orderByChild, push, query, ref, remove, serverTimestamp, set } from "firebase/database";
import { EXCEL_TEMPLATE } from "../config";
import { db } from "../firebase";
import type { AdminRecipient } from "../hooks/usePortalData";
import { logActivity } from "../lib/activity";
import { daysUntilDelivery, formatDate, statusLabels } from "../lib/delivery";
import Pagination from "./Pagination";
import type { DeliveryRequest, MentionField, MentionTarget, MessageDocument } from "../types";

const CONTACT_PAGE_SIZE = 15;
const MESSAGE_PAGE_SIZE = 25;

interface ChatContact {
  uid: string;
  email: string;
  name: string;
  supplierName: string;
  role: "admin" | "user";
  lastMessage?: string;
  lastMessageAt?: number;
}

interface ChatWidgetProps {
  user: User;
  admin: boolean;
  adminRecipients: AdminRecipient[];
  requests: DeliveryRequest[];
  supplierDisplayName: string;
  onOpenMention: (target: MentionTarget) => void;
  onUnreadCountChange: (count: number) => void;
  onOpenMessages: () => void;
  active: boolean;
  hidden: boolean;
}

function entries<T extends object>(value: unknown): Array<[string, T]> {
  if (!value || typeof value !== "object") return [];
  return Object.entries(value) as Array<[string, T]>;
}

export default function ChatWidget({ user, admin, adminRecipients, requests, supplierDisplayName, onOpenMention, onUnreadCountChange, onOpenMessages, active, hidden }: ChatWidgetProps) {
  const [selectedContactUid, setSelectedContactUid] = useState("");
  const [selectedAdminUid, setSelectedAdminUid] = useState("");
  const [showNewConversation, setShowNewConversation] = useState(false);
  const [newContactUid, setNewContactUid] = useState("");
  const [contactPage, setContactPage] = useState(0);
  const [messagePage, setMessagePage] = useState(0);
  const [messages, setMessages] = useState<MessageDocument[]>([]);
  const [chatContacts, setChatContacts] = useState<ChatContact[]>([]);
  const [unreadByContact, setUnreadByContact] = useState<Record<string, number>>({});
  const [lastReadAt, setLastReadAt] = useState(0);
  const [loadedThreadKey, setLoadedThreadKey] = useState("");
  const [text, setText] = useState("");
  const [mentionDate, setMentionDate] = useState("");
  const [mentionSupplierName, setMentionSupplierName] = useState("");
  const [mentionRequestId, setMentionRequestId] = useState("");
  const [mentionSelection, setMentionSelection] = useState("");
  const [mentionEnabled, setMentionEnabled] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [permission, setPermission] = useState(
    typeof Notification === "undefined" ? "unsupported" : Notification.permission,
  );

  useEffect(() => {
    if (!admin || !db) {
      setChatContacts([]);
      return;
    }
    let knownIds: Set<string> | null = null;
    return onValue(
      ref(db, "chats"),
      (snapshot) => {
        const loaded: ChatContact[] = [];
        const previousIds = knownIds;
        const currentIds = new Set<string>();
        const unreadCounts: Record<string, number> = {};
        const adminIds = new Set(adminRecipients.map((recipient) => recipient.uid));
        const addConversation = (
          contactUid: string,
          thread: Record<string, unknown>,
        ) => {
          const threadMessages = entries<Omit<MessageDocument, "id">>(thread.messages)
            .map(([id, message]) => ({ ...message, id }))
            .sort((a, b) => b.createdAt - a.createdAt);
          const incomingMessages = threadMessages.filter((message) => message.senderUid !== user.uid);
          const readAt = Number(
            (thread.readBy as Record<string, number> | undefined)?.[user.uid] ?? 0,
          );
          unreadCounts[contactUid] = incomingMessages.filter((message) => message.createdAt > readAt).length;
          for (const message of incomingMessages) {
            const messageKey = `${contactUid}:${message.id}`;
            currentIds.add(messageKey);
            if (previousIds && !previousIds.has(messageKey) && typeof Notification !== "undefined" && Notification.permission === "granted") {
              try {
                const notification = new Notification(
                  [message.supplierName, message.senderName].filter(Boolean).join(" · ") || message.senderEmail,
                  { body: message.text, tag: `chat-${messageKey}` },
                );
                notification.onclick = () => {
                  window.focus();
                  setSelectedContactUid(contactUid);
                  onOpenMessages();
                };
              } catch (cause) {
                setError(cause instanceof Error ? cause.message : "Không hiển thị được thông báo chat.");
              }
            }
          }
          const lastMessage = threadMessages[0];
          if (!lastMessage) return;
          const contactMessage = incomingMessages[0] ?? lastMessage;
          loaded.push({
            uid: contactUid,
            email: contactMessage.senderUid === user.uid
              ? contactMessage.recipientEmail || ""
              : contactMessage.senderEmail,
            name: contactMessage.senderUid === user.uid
              ? contactMessage.supplierName || contactMessage.recipientEmail || ""
              : contactMessage.senderName || contactMessage.senderEmail,
            supplierName: adminIds.has(contactUid) ? "" : contactMessage.supplierName || "",
            role: adminIds.has(contactUid) ? "admin" : "user",
            lastMessage: lastMessage.text,
            lastMessageAt: lastMessage.createdAt,
          });
        };
        for (const [outerUid, chat] of entries<Record<string, unknown>>(snapshot.val())) {
          const threads = entries<Record<string, unknown>>(chat.threads);
          if (outerUid === user.uid) {
            for (const [threadUid, thread] of threads) {
              if (adminIds.has(threadUid)) addConversation(threadUid, thread);
            }
            continue;
          }
          const ownThread = threads.find(([threadUid]) => threadUid === user.uid);
          if (ownThread) {
            addConversation(outerUid, ownThread[1]);
          }
        }
        knownIds = currentIds;
        setUnreadByContact(unreadCounts);
        setChatContacts(loaded);
      },
      (cause) => setError(`Không tải được danh sách chat: ${cause.message}`),
    );
  }, [admin, adminRecipients, onOpenMessages, user.uid]);

  const userContacts = useMemo(() => {
    const byUid = new Map<string, ChatContact>();
    const adminUids = new Set(adminRecipients.map((recipient) => recipient.uid));
    for (const request of requests) {
      if (request.ownerUid === user.uid || adminUids.has(request.ownerUid)) continue;
      if (!byUid.has(request.ownerUid)) {
        byUid.set(request.ownerUid, {
          uid: request.ownerUid,
          email: request.ownerEmail,
          name: request.ownerName || request.ownerEmail,
          supplierName: request.supplierName || "",
          role: "user",
        });
      }
    }
    for (const contact of chatContacts) {
      if (contact.uid === user.uid || adminUids.has(contact.uid)) continue;
      const existing = byUid.get(contact.uid);
      byUid.set(contact.uid, existing
        ? { ...contact, name: existing.name || contact.name, supplierName: existing.supplierName || contact.supplierName }
        : contact);
    }
    return [...byUid.values()];
  }, [adminRecipients, chatContacts, requests, user.uid]);

  const contacts = useMemo(() => [
    ...userContacts,
    ...adminRecipients
      .filter((recipient) => recipient.uid !== user.uid)
      .map((recipient) => ({
        uid: recipient.uid,
        email: recipient.email,
        name: recipient.label,
        supplierName: "",
        role: "admin" as const,
      })),
  ].sort((a, b) => a.name.localeCompare(b.name)), [adminRecipients, userContacts, user.uid]);
  const sortedContacts = useMemo(() => [...contacts].sort((a, b) =>
    (chatContacts.find((contact) => contact.uid === b.uid)?.lastMessageAt ?? 0)
    - (chatContacts.find((contact) => contact.uid === a.uid)?.lastMessageAt ?? 0)
    || a.name.localeCompare(b.name),
  ), [chatContacts, contacts]);
  const visibleContacts = sortedContacts.slice(contactPage * CONTACT_PAGE_SIZE, (contactPage + 1) * CONTACT_PAGE_SIZE);

  useEffect(() => {
    if (admin && !contacts.some((contact) => contact.uid === selectedContactUid)) {
      setSelectedContactUid(contacts[0]?.uid ?? "");
    }
  }, [admin, contacts, selectedContactUid]);

  useEffect(() => {
    if (!admin && !adminRecipients.some((recipient) => recipient.uid === selectedAdminUid)) {
      setSelectedAdminUid(adminRecipients[0]?.uid ?? "");
    }
  }, [admin, adminRecipients, selectedAdminUid]);

  useEffect(() => {
    if (admin && !contacts.some((contact) => contact.uid === newContactUid)) {
      setNewContactUid(contacts[0]?.uid ?? "");
    }
  }, [admin, contacts, newContactUid]);

  useEffect(() => {
    setContactPage(0);
  }, [admin]);

  useEffect(() => {
    if (messagePage >= Math.ceil(messages.length / MESSAGE_PAGE_SIZE)) {
      setMessagePage(Math.max(0, Math.ceil(messages.length / MESSAGE_PAGE_SIZE) - 1));
    }
  }, [messagePage, messages.length]);

  useEffect(() => {
    if (contactPage >= Math.ceil(sortedContacts.length / CONTACT_PAGE_SIZE)) {
      setContactPage(Math.max(0, Math.ceil(sortedContacts.length / CONTACT_PAGE_SIZE) - 1));
    }
  }, [contactPage, sortedContacts.length]);

  const chatUid = admin ? selectedContactUid : user.uid;
  const threadKey = admin ? user.uid : selectedAdminUid;
  const activeContactIsAdmin = admin && adminRecipients.some((recipient) => recipient.uid === selectedContactUid);
  const conversationPath = activeContactIsAdmin
    ? `chats/${[user.uid, selectedContactUid].sort()[0]}/threads/${[user.uid, selectedContactUid].sort()[1]}`
    : `chats/${chatUid}/threads/${threadKey}`;
  const visibleMessages = messages.slice(messagePage * MESSAGE_PAGE_SIZE, (messagePage + 1) * MESSAGE_PAGE_SIZE);
  const visibleAdminRecipients = adminRecipients.slice(contactPage * CONTACT_PAGE_SIZE, (contactPage + 1) * CONTACT_PAGE_SIZE);
  useEffect(() => {
    setMessagePage(0);
  }, [conversationPath]);

  const activeContact = contacts.find((contact) => contact.uid === chatUid);
  const mentionRequests = useMemo(
    () => requests.filter((request) =>
      !request.deleted && (admin
        ? request.ownerUid === selectedContactUid
        : request.ownerUid === user.uid),
    ),
    [admin, requests, selectedContactUid, user.uid],
  );
  const mentionDates = useMemo(() => [...new Set(mentionRequests.map((request) => request.deliveryDate || "unknown"))]
    .sort((a, b) => {
      const daysA = a === "unknown" ? null : daysUntilDelivery(a);
      const daysB = b === "unknown" ? null : daysUntilDelivery(b);
      const rank = (days: number | null) => days === 0 ? 0 : days !== null && days < 0 ? 1 : days !== null && days <= 2 ? 2 : days === null ? 4 : 3;
      return rank(daysA) - rank(daysB) || (daysA ?? Number.MAX_SAFE_INTEGER) - (daysB ?? Number.MAX_SAFE_INTEGER);
    }), [mentionRequests]);
  const mentionSuppliers = useMemo(() => [...new Set(
    mentionRequests
      .filter((request) => (request.deliveryDate || "unknown") === mentionDate)
      .map((request) => request.supplierName),
  )].sort((a, b) => a.localeCompare(b)), [mentionDate, mentionRequests]);
  const mentionRequestsForSelection = useMemo(() => mentionRequests
    .filter((request) =>
      (request.deliveryDate || "unknown") === mentionDate
      && request.supplierName === mentionSupplierName,
    )
    .sort((a, b) => a.deliveryDate.localeCompare(b.deliveryDate)),
  [mentionDate, mentionRequests, mentionSupplierName]);
  useEffect(() => {
    if (!mentionDates.includes(mentionDate)) {
      setMentionDate(mentionDates[0] ?? "");
      setMentionSupplierName("");
      setMentionRequestId("");
      setMentionSelection("");
    }
  }, [mentionDate, mentionDates]);
  useEffect(() => {
    if (!mentionSuppliers.includes(mentionSupplierName)) {
      setMentionSupplierName(mentionSuppliers[0] ?? "");
      setMentionRequestId("");
      setMentionSelection("");
    }
  }, [mentionSupplierName, mentionSuppliers]);
  useEffect(() => {
    if (!mentionRequestsForSelection.some((request) => request.id === mentionRequestId)) {
      setMentionRequestId(mentionRequestsForSelection[0]?.id ?? "");
      setMentionSelection("");
    }
  }, [mentionRequestId, mentionRequestsForSelection]);
  const mentionRequest = useMemo(
    () => mentionRequests.find((request) => request.id === mentionRequestId),
    [mentionRequestId, mentionRequests],
  );
  const mentionTarget: MentionTarget | undefined = useMemo(() => {
    if (!mentionRequest || !mentionSelection) return undefined;
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
      const value = field === "supplierName" ? mentionRequest.supplierName
        : field === "deliveryDate" ? mentionRequest.deliveryDate
          : field === "deliveryTime" ? mentionRequest.deliveryTime
            : field === "recipientEmail" ? mentionRequest.recipientEmail
              : field === "notes" ? mentionRequest.notes
                : "";
      return {
        requestId: mentionRequest.id,
        field,
        label: `${labels[field as keyof typeof labels]}${value ? `: ${value.slice(0, 90)}` : ""}`,
      };
    }
    if (kind === "item") {
      const itemIndex = Number(keyOrIndex);
      const itemKey = EXCEL_TEMPLATE.columns[0]?.key ?? "";
      if (!Number.isInteger(itemIndex) || itemIndex < 0 || itemIndex >= mentionRequest.items.length || !itemKey) return undefined;
      return {
        requestId: mentionRequest.id,
        field: "item",
        itemIndex,
        itemKey,
        label: `Cả dòng hàng hóa · dòng ${itemIndex + 1}`,
      };
    }
    return undefined;
  }, [mentionRequest, mentionSelection]);
  const contactName = admin
    ? [activeContact?.supplierName, activeContact?.name].filter(Boolean).join(" · ") || activeContact?.email || "Nhà cung cấp"
    : adminRecipients.find((recipient) => recipient.uid === selectedAdminUid)?.label ?? "Quản trị viên";

  useEffect(() => {
    if (!db || !chatUid || !threadKey) {
      setMessages([]);
      setLoadedThreadKey("");
      return;
    }
    setMessages([]);
    setLastReadAt(0);
    setLoadedThreadKey("");
    let knownIds: Set<string> | null = null;
    const messagesQuery = query(
      ref(db, `${conversationPath}/messages`),
      orderByChild("createdAt"),
      limitToLast(100),
    );
    const stopMessages = onValue(
      messagesQuery,
      (snapshot) => {
        const loaded = entries<Omit<MessageDocument, "id">>(snapshot.val())
          .map(([id, message]) => ({ ...message, id }))
          .sort((a, b) => a.createdAt - b.createdAt);
        setLoadedThreadKey(conversationPath);
        const previousIds = knownIds;
        if (!admin && previousIds && typeof Notification !== "undefined" && Notification.permission === "granted") {
          for (const message of loaded) {
            if (!previousIds.has(message.id) && message.senderUid !== user.uid) {
              try {
                const notification = new Notification(
                  message.supplierName || message.senderName || message.senderEmail,
                  { body: message.text, tag: `chat-${chatUid}-${message.id}` },
                );
                notification.onclick = () => {
                  window.focus();
                  onOpenMessages();
                };
              } catch (cause) {
                setError(cause instanceof Error ? cause.message : "Không hiển thị được thông báo chat.");
              }
            }
          }
        }
        knownIds = new Set(loaded.map((message) => message.id));
        setMessages(loaded);
        setError("");
      },
      (cause) => setError(`Không tải được tin nhắn: ${cause.message}`),
    );
    const stopReadState = onValue(
      ref(db, `${conversationPath}/readBy/${user.uid}`),
      (snapshot) => setLastReadAt(Number(snapshot.val() ?? 0)),
      (cause) => setError(`Không tải được trạng thái đã đọc: ${cause.message}`),
    );
    return () => {
      stopMessages();
      stopReadState();
    };
  }, [admin, chatUid, conversationPath, onOpenMessages, threadKey, user.uid]);

  const unreadMessageCount = admin
    ? Object.values(unreadByContact).reduce((sum, count) => sum + count, 0)
    : unreadByContact[user.uid] ?? 0;

  useEffect(() => {
    onUnreadCountChange(unreadMessageCount);
  }, [onUnreadCountChange, unreadMessageCount]);

  useEffect(() => {
    if (!active || !db || !chatUid || loadedThreadKey !== conversationPath) return;
    const newestIncoming = messages.reduce(
      (latest, message) => message.senderUid !== user.uid
        ? Math.max(latest, message.createdAt)
        : latest,
      0,
    );
    if (newestIncoming <= lastReadAt) return;
    void set(ref(db, `${conversationPath}/readBy/${user.uid}`), newestIncoming)
      .catch((cause: unknown) => setError(`Không đánh dấu được tin nhắn đã đọc: ${cause instanceof Error ? cause.message : "lỗi không xác định."}`));
  }, [active, chatUid, conversationPath, lastReadAt, loadedThreadKey, messages, user.uid]);

  useEffect(() => {
    if (admin || loadedThreadKey !== conversationPath) return;
    setUnreadByContact({
      [user.uid]: messages.filter((message) => message.senderUid !== user.uid && message.createdAt > lastReadAt).length,
    });
  }, [admin, chatUid, conversationPath, lastReadAt, loadedThreadKey, messages, user.uid]);

  async function enableNotifications() {
    if (typeof Notification === "undefined") return;
    try {
      setPermission(await Notification.requestPermission());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Không bật được thông báo trình duyệt.");
    }
  }

  async function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!db || !chatUid || !threadKey || !text.trim() || sending) return;
    setSending(true);
    setError("");
    try {
      const messageRef = push(ref(db, `${conversationPath}/messages`));
      await set(messageRef, {
        senderUid: user.uid,
        senderEmail: user.email ?? "",
        senderName: admin ? (user.displayName || user.email || "Quản trị viên") : (user.displayName || user.email || "Nhà cung cấp"),
        ...(!admin ? { supplierName: supplierDisplayName, recipientEmail: adminRecipients.find((recipient) => recipient.uid === selectedAdminUid)?.email ?? "" } : {
          supplierName: activeContact?.supplierName || activeContact?.name || "",
          recipientEmail: activeContact?.email || "",
        }),
        ...(mentionTarget && !activeContactIsAdmin ? { mention: mentionTarget } : {}),
        text: text.trim(),
        createdAt: serverTimestamp(),
      });
      setText("");
      setMentionEnabled(false);
      setMentionSelection("");
      try {
        await logActivity(user, "message_sent", "Gửi tin nhắn qua cửa sổ chat.");
      } catch (cause) {
        setError(`Tin nhắn đã gửi nhưng không ghi được activity log: ${cause instanceof Error ? cause.message : "lỗi không xác định."}`);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Không gửi được tin nhắn.");
    } finally {
      setSending(false);
    }
  }

  async function deleteMessage(messageId: string) {
    if (!db || !window.confirm("Xóa tin nhắn này?")) return;
    try {
      await remove(ref(db, `${conversationPath}/messages/${messageId}`));
    } catch (cause) {
      setError(`Không xóa được tin nhắn: ${cause instanceof Error ? cause.message : "lỗi không xác định."}`);
    }
  }

  return (
    <section className="messages-page" hidden={hidden}>
      <div className="page-heading">
        <div><p className="eyebrow">HỘI THOẠI</p><h1>Tin nhắn</h1><p className="muted">Trao đổi riêng giữa quản trị viên và người dùng.</p></div>
        {permission !== "granted" && permission !== "unsupported" && (
          <button
            className="button secondary notification-permission"
            disabled={permission === "denied"}
            title={permission === "denied" ? "Cho phép thông báo trong cài đặt trình duyệt." : "Cho phép thông báo trên trình duyệt này."}
            onClick={() => void enableNotifications()}
          >
            {permission === "denied" ? "Thông báo đã bị chặn" : "Bật thông báo"}
          </button>
        )}
      </div>
      <div className="messages-layout">
        <aside className="panel conversation-list" aria-label="Danh sách cuộc trò chuyện">
          <div className="conversation-list-heading">
            <strong>{admin ? "Cuộc trò chuyện" : "Quản trị viên"}</strong>
            <span className="count">{admin ? contacts.length : adminRecipients.length}</span>
          </div>
          {admin && contacts.length > 0 && (
            <button
              className="button secondary conversation-new-button"
              onClick={() => setShowNewConversation((visible) => !visible)}
            >
              {showNewConversation ? "Đóng chọn người dùng" : "+ Cuộc trò chuyện mới"}
            </button>
          )}
          {admin && showNewConversation && (
            <div className="conversation-new-form">
              <select className="text-input" aria-label="Chọn người dùng để trò chuyện" value={newContactUid} onChange={(event) => setNewContactUid(event.target.value)}>
                {contacts.map((contact) => <option key={contact.uid} value={contact.uid}>{[contact.supplierName, contact.name].filter(Boolean).join(" · ") || contact.email}</option>)}
              </select>
              <button className="button primary" disabled={!newContactUid} onClick={() => { setSelectedContactUid(newContactUid); setShowNewConversation(false); }}>Mở hội thoại</button>
            </div>
          )}
          <div className="conversation-list-items">
            {admin ? (
              visibleContacts.map((contact) => {
                const conversation = chatContacts.find((entry) => entry.uid === contact.uid);
                return (
                  <button key={contact.uid} className={`conversation-contact ${selectedContactUid === contact.uid ? "active" : ""}`} onClick={() => setSelectedContactUid(contact.uid)}>
                    <strong>{[contact.supplierName, contact.name].filter(Boolean).join(" · ") || contact.email}</strong>
                    <span>{conversation?.lastMessage || (conversation ? contact.email : `${contact.email} · Chưa có tin nhắn`)}</span>
                    {unreadByContact[contact.uid] > 0 && <span className="conversation-unread">{unreadByContact[contact.uid]} tin chưa đọc</span>}
                  </button>
                );
              })
            ) : (
              visibleAdminRecipients.map((recipient) => (
                <button key={recipient.uid} className={`conversation-contact ${selectedAdminUid === recipient.uid ? "active" : ""}`} onClick={() => setSelectedAdminUid(recipient.uid)}>
                  <strong>{recipient.label}</strong>
                  <span>{recipient.email}</span>
                </button>
              ))
            )}
            {!admin && adminRecipients.length === 0 && <p className="muted small conversation-empty">Chưa có quản trị viên để trò chuyện.</p>}
          </div>
          <Pagination
            page={contactPage}
            pageSize={CONTACT_PAGE_SIZE}
            total={admin ? sortedContacts.length : adminRecipients.length}
            onPageChange={setContactPage}
          />
        </aside>
        <section className="chat-window panel" aria-label="Trò chuyện">
          <header className="chat-window-header">
            <div>
              <strong>{admin ? "Với người dùng" : contactName}</strong>
              <span>{admin ? activeContact?.email || "Chọn người dùng để bắt đầu hội thoại" : contactName}</span>
            </div>
          </header>
          <div className="chat-widget-messages" aria-live="polite">
            {!chatUid ? (
              <p className="muted small">Chọn một người trong danh sách để xem hoặc bắt đầu trò chuyện.</p>
            ) : messages.length === 0 ? (
              <p className="muted small">Chưa có tin nhắn. Bắt đầu trò chuyện tại đây.</p>
            ) : visibleMessages.map((message) => {
              const mention = message.mention;
              return (
                <div key={message.id} className={`message ${message.senderUid === user.uid ? "own-message" : ""}`}>
                  <div className="message-meta">
                    <strong>
                      {admin
                        ? activeContactIsAdmin
                          ? message.senderName || message.senderEmail
                          : [message.supplierName, message.senderName].filter(Boolean).join(" · ") || message.senderEmail
                        : message.senderUid === user.uid
                          ? `Bạn · ${message.supplierName || supplierDisplayName} · ${message.senderName || user.email}`
                          : message.senderName || contactName}
                    </strong>
                    <span>{formatDate(message.createdAt)}</span>
                  </div>
                  <p>{message.text}</p>
                  {message.senderUid === user.uid && (
                    <button className="message-delete" onClick={() => void deleteMessage(message.id)}>Xóa tin nhắn</button>
                  )}
                  {mention && (
                    <button
                      className="message-mention"
                      onClick={() => {
                        onOpenMention(mention);
                      }}
                    >
                      ↗ {mention.label}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
          <Pagination page={messagePage} pageSize={MESSAGE_PAGE_SIZE} total={messages.length} onPageChange={setMessagePage} />
          {error && <p className="chat-error" role="alert">{error}</p>}
          {mentionEnabled && !activeContactIsAdmin && (
            <div className="mention-composer">
              <label className="field">
                <span className="field-label">1. Chọn ngày giao</span>
                <select
                  className="text-input"
                  value={mentionDate}
                  disabled={mentionDates.length === 0}
                  onChange={(event) => {
                    setMentionDate(event.target.value);
                    setMentionSupplierName("");
                    setMentionRequestId("");
                    setMentionSelection("");
                  }}
                >
                  {mentionDates.length === 0
                    ? <option value="">Chưa có phiếu</option>
                    : mentionDates.map((date) => (
                      <option key={date} value={date}>
                        {date === "unknown" ? "Chưa có ngày giao" : date}
                      </option>
                    ))}
                </select>
              </label>
              <label className="field">
                <span className="field-label">2. Chọn nhà cung cấp</span>
                <select
                  className="text-input"
                  value={mentionSupplierName}
                  disabled={mentionSuppliers.length === 0}
                  onChange={(event) => {
                    setMentionSupplierName(event.target.value);
                    setMentionRequestId("");
                    setMentionSelection("");
                  }}
                >
                  {mentionSuppliers.length === 0
                    ? <option value="">Chưa có nhà cung cấp</option>
                    : mentionSuppliers.map((name) => <option key={name} value={name}>{name}</option>)}
                </select>
              </label>
              <label className="field">
                <span className="field-label">3. Chọn phiếu</span>
                <select
                  className="text-input"
                  value={mentionRequestId}
                  disabled={mentionRequestsForSelection.length === 0}
                  onChange={(event) => {
                    setMentionRequestId(event.target.value);
                    setMentionSelection("");
                  }}
                >
                  {mentionRequestsForSelection.length === 0
                    ? <option value="">Chưa có phiếu</option>
                    : mentionRequestsForSelection.map((request) => (
                      <option key={request.id} value={request.id}>
                        {request.deliveryDate || "Chưa có ngày"} · {request.items.length} dòng · {statusLabels[request.status]}
                      </option>
                    ))}
                </select>
              </label>
              {mentionRequest && (
                <label className="field">
                  <span className="field-label">4. Nội dung đề cập</span>
                  <select
                    className="text-input"
                    value={mentionSelection}
                    onChange={(event) => setMentionSelection(event.target.value)}
                  >
                    <option value="">Chọn nội dung…</option>
                    <optgroup label="Thông tin giao hàng">
                      <option value="field:supplierName">Tên nhà cung cấp: {mentionRequest.supplierName}</option>
                      <option value="field:deliveryDate">Ngày giao hàng: {mentionRequest.deliveryDate}</option>
                    </optgroup>
                    <optgroup label="Cả dòng hàng hóa">
                      {mentionRequest.items.map((item, index) => (
                        <option key={index} value={`item:${index}`}>
                          Dòng {index + 1}{item.materialName ? ` · ${item.materialName}` : ""}
                        </option>
                      ))}
                    </optgroup>
                  </select>
                </label>
              )}
              {mentionTarget && <span className="mention-preview">Đề cập: {mentionTarget.label}</span>}
            </div>
          )}
          <form className="chat-form" onSubmit={(event) => void sendMessage(event)}>
            <div className="chat-compose-input">
              <button type="button" className={`mention-toggle ${mentionEnabled ? "active" : ""}`} disabled={!chatUid || sending || activeContactIsAdmin || mentionRequests.length === 0} aria-label="Đề cập nội dung phiếu" title={activeContactIsAdmin ? "Không đề cập phiếu trong chat giữa admin." : "Đề cập nội dung phiếu"} onClick={() => setMentionEnabled((enabled) => !enabled)}>@</button>
              <input
                className="text-input"
                aria-label="Tin nhắn"
                placeholder="Viết tin nhắn…"
                value={text}
                onChange={(event) => setText(event.target.value)}
                maxLength={4000}
                disabled={!chatUid || sending}
              />
            </div>
            <button className="button primary" disabled={!chatUid || sending || !text.trim()}>
              {sending ? "…" : "Gửi"}
            </button>
          </form>
        </section>
      </div>
    </section>
  );
}

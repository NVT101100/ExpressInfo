export type DeliveryItem = Record<string, string>;
export type RequestStatus = "pending" | "approved" | "rejected" | "reminded" | "overdue" | "delivered";
export interface ItemFieldChange {
  index: number;
  key: string;
  value: string;
}
export interface RequestChanges {
  deliveryGroup?: string;
  supplierName?: string;
  deliveryDate?: string;
  deliveryTime?: string;
  recipientEmail?: string;
  notes?: string;
  itemChanges?: ItemFieldChange[];
  items?: DeliveryItem[];
  attachments?: RequestAttachments;
}

export interface DriveFileReference {
  id: string;
  name: string;
  url: string;
  mimeType: string;
}

export interface RequestAttachments {
  deliveryPlan?: DriveFileReference;
  companyIntroduction?: DriveFileReference;
}

export interface RequestDocument {
  ownerUid: string;
  ownerEmail: string;
  ownerName: string;
  supplierName: string;
  deliveryGroup?: string;
  deliveryDate: string;
  deliveryTime?: string;
  recipientEmail?: string;
  notes?: string;
  deliveryAt?: string;
  items: DeliveryItem[];
  attachments?: RequestAttachments;
  createdAt: number;
  templateHeaders: string[];
}

export interface RevisionDocument {
  id: string;
  actorUid: string;
  actorEmail: string;
  createdAt: number;
  changes?: RequestChanges;
  status?: RequestStatus;
  deleted?: boolean;
}

export interface DeliveryRequest extends RequestDocument {
  id: string;
  revisions: RevisionDocument[];
  status: RequestStatus;
  deleted: boolean;
}

export interface NotificationDocument {
  id: string;
  requestId: string;
  senderUid: string;
  senderName?: string;
  supplierName?: string;
  recipientRole?: "admin" | "supplier";
  recipientUid?: string | null;
  event?: "request_submitted" | "request_status" | "request_updated" | "delivery_reminder" | "delivery_overdue" | "delivery_confirmed";
  text: string;
  createdAt: number;
}

export interface MessageDocument {
  id: string;
  senderUid: string;
  senderEmail: string;
  senderName?: string;
  supplierName?: string;
  recipientEmail?: string;
  mention?: MentionTarget;
  text: string;
  createdAt: number;
}

export type MentionField =
  | "supplierName"
  | "deliveryDate"
  | "deliveryTime"
  | "recipientEmail"
  | "notes"
  | "item";

export interface MentionTarget {
  requestId: string;
  field: MentionField;
  itemIndex?: number;
  itemKey?: string;
  label: string;
}

export type ActivityAction =
  | "request_created"
  | "request_updated"
  | "request_status_changed"
  | "request_deleted"
  | "message_sent"
  | "spreadsheet_uploaded"
  | "spreadsheet_exported"
  | "request_viewed"
  | "page_opened"
  | "profile_updated"
  | "signed_in"
  | "signed_out";

export interface ActivityLog {
  id: string;
  actorUid: string;
  actorEmail: string;
  action: ActivityAction;
  requestId?: string;
  details: string;
  createdAt: number;
}

export interface UserProfile {
  displayName: string;
  organization: string;
  phone: string;
  updatedAt?: number;
}

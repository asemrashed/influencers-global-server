import { z } from 'zod';
import { paginationQuerySchema, pageOf } from './common.js';

// ───────────── Contacts ─────────────

export const contactSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string().email(),
  phone: z.string().nullable(),
  organization: z.string().nullable(),
  roleOrTitle: z.string().nullable(),
  notes: z.string().nullable(),
  tags: z.array(z.string()),
  assignedUserId: z.string().nullable(),
  createdById: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ContactDto = z.infer<typeof contactSchema>;

export const createContactSchema = z.object({
  name: z.string().min(1).max(100),
  email: z.string().email().max(100),
  phone: z.string().max(30).nullable().optional(),
  organization: z.string().max(100).nullable().optional(),
  roleOrTitle: z.string().max(100).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  tags: z.array(z.string().max(50)).max(10).default([]),
  assignedUserId: z.string().nullable().optional(),
});
export type CreateContactDto = z.infer<typeof createContactSchema>;

export const updateContactSchema = createContactSchema.partial();
export type UpdateContactDto = z.infer<typeof updateContactSchema>;

export const contactListQuerySchema = paginationQuerySchema.extend({
  search: z.string().optional(),
  tag: z.string().optional(),
  organization: z.string().optional(),
});
export type ContactListQuery = z.infer<typeof contactListQuerySchema>;

export const contactPageSchema = pageOf(contactSchema, 'ContactPage');

// ───────────── Inbox (Threads & Messages) ─────────────

export const threadTypeSchema = z.enum(['PUBLIC_INQUIRY', 'COLLABORATION', 'SUPPORT', 'DIRECT']);
export type ThreadType = z.infer<typeof threadTypeSchema>;

export const threadStatusSchema = z.enum(['OPEN', 'WAITING', 'CLOSED', 'ARCHIVED']);
export type ThreadStatus = z.infer<typeof threadStatusSchema>;

export const inboxMessageSchema = z.object({
  id: z.string(),
  threadId: z.string(),
  senderId: z.string().nullable(),
  senderName: z.string(),
  senderEmail: z.string(),
  isFromStaff: z.boolean(),
  body: z.string(),
  attachmentIds: z.array(z.string()),
  createdAt: z.string(),
});
export type InboxMessageDto = z.infer<typeof inboxMessageSchema>;

export const inboxThreadSchema = z.object({
  id: z.string(),
  type: threadTypeSchema,
  status: threadStatusSchema,
  subject: z.string(),
  snippet: z.string().nullable(),
  senderName: z.string(),
  senderEmail: z.string(),
  brandName: z.string().nullable(),
  unreadCount: z.number().int(),
  assignedUserId: z.string().nullable(),
  metadata: z.record(z.string(), z.unknown()).nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type InboxThreadDto = z.infer<typeof inboxThreadSchema>;

export const inboxThreadDetailSchema = inboxThreadSchema.extend({
  messages: z.array(inboxMessageSchema),
});
export type InboxThreadDetailDto = z.infer<typeof inboxThreadDetailSchema>;

export const inboxThreadListQuerySchema = paginationQuerySchema.extend({
  status: threadStatusSchema.optional(),
  type: threadTypeSchema.optional(),
  assignedUserId: z.string().optional(),
  search: z.string().optional(),
});
export type InboxThreadListQuery = z.infer<typeof inboxThreadListQuerySchema>;

export const inboxThreadPageSchema = pageOf(inboxThreadSchema, 'InboxThreadPage');

export const sendInboxReplySchema = z.object({
  body: z.string().min(1).max(10000),
  attachmentIds: z.array(z.string()).default([]),
});
export type SendInboxReplyDto = z.infer<typeof sendInboxReplySchema>;

export const updateThreadSchema = z.object({
  status: threadStatusSchema.optional(),
  assignedUserId: z.string().nullable().optional(),
});
export type UpdateThreadDto = z.infer<typeof updateThreadSchema>;

// Public Collaboration / Booking Submission Schema (with bot-trap honeypot)
export const publicInquirySubmissionSchema = z.object({
  name: z.string().min(1).max(100),
  email: z.string().email().max(100),
  brandName: z.string().max(100).optional(),
  subject: z.string().min(3).max(200),
  message: z.string().min(10).max(5000),
  budgetRange: z.string().max(50).optional(),
  timeline: z.string().max(100).optional(),
  // Honeypot field for spam prevention: must be empty
  website_hp: z.string().max(0, { message: 'Spam detected' }).optional(),
});
export type PublicInquirySubmission = z.infer<typeof publicInquirySubmissionSchema>;

// ───────────── Notifications ─────────────

export const notificationSchema = z.object({
  id: z.string(),
  userId: z.string(),
  title: z.string(),
  body: z.string(),
  link: z.string().nullable(),
  readAt: z.string().nullable(),
  metadata: z.record(z.string(), z.unknown()).nullable(),
  createdAt: z.string(),
});
export type NotificationDto = z.infer<typeof notificationSchema>;

export const notificationPageSchema = pageOf(notificationSchema, 'NotificationPage');

export const unreadCountSchema = z.object({
  unreadCount: z.number().int().nonnegative(),
});
export type UnreadCountDto = z.infer<typeof unreadCountSchema>;

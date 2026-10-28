import { z } from 'zod';
import { paginationQuerySchema, pageOf } from './common.js';

export const ticketCategorySchema = z.enum(['ACCOUNT', 'EVENT', 'PAYMENT', 'CAMPAIGN', 'TECHNICAL']);
export type TicketCategory = z.infer<typeof ticketCategorySchema>;

export const ticketPrioritySchema = z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']);
export type TicketPriority = z.infer<typeof ticketPrioritySchema>;

export const ticketStatusSchema = z.enum(['OPEN', 'IN_PROGRESS', 'WAITING_CUSTOMER', 'RESOLVED', 'CLOSED']);
export type TicketStatus = z.infer<typeof ticketStatusSchema>;

export const supportTicketReplySchema = z.object({
  id: z.string(),
  ticketId: z.string(),
  authorId: z.string().nullable(),
  authorName: z.string(),
  authorEmail: z.string(),
  isStaff: z.boolean(),
  message: z.string(),
  attachmentIds: z.array(z.string()),
  createdAt: z.string(),
});
export type SupportTicketReplyDto = z.infer<typeof supportTicketReplySchema>;

export const supportTicketSchema = z.object({
  id: z.string(),
  ticketNumber: z.number().int(),
  subject: z.string(),
  category: ticketCategorySchema,
  priority: ticketPrioritySchema,
  status: ticketStatusSchema,
  requesterEmail: z.string(),
  requesterName: z.string(),
  requesterId: z.string().nullable(),
  assignedUserId: z.string().nullable(),
  replyCount: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type SupportTicketDto = z.infer<typeof supportTicketSchema>;

export const supportTicketDetailSchema = supportTicketSchema.extend({
  replies: z.array(supportTicketReplySchema),
});
export type SupportTicketDetailDto = z.infer<typeof supportTicketDetailSchema>;

export const createSupportTicketSchema = z.object({
  subject: z.string().min(3).max(200),
  category: ticketCategorySchema.default('TECHNICAL'),
  priority: ticketPrioritySchema.default('MEDIUM'),
  message: z.string().min(10).max(5000),
  requesterName: z.string().min(1).max(100).optional(),
  requesterEmail: z.string().email().max(100).optional(),
});
export type CreateSupportTicketDto = z.infer<typeof createSupportTicketSchema>;

export const updateSupportTicketSchema = z.object({
  status: ticketStatusSchema.optional(),
  priority: ticketPrioritySchema.optional(),
  category: ticketCategorySchema.optional(),
  assignedUserId: z.string().nullable().optional(),
});
export type UpdateSupportTicketDto = z.infer<typeof updateSupportTicketSchema>;

export const addTicketReplySchema = z.object({
  message: z.string().min(1).max(5000),
  attachmentIds: z.array(z.string()).default([]),
});
export type AddTicketReplyDto = z.infer<typeof addTicketReplySchema>;

export const supportTicketListQuerySchema = paginationQuerySchema.extend({
  status: ticketStatusSchema.optional(),
  category: ticketCategorySchema.optional(),
  priority: ticketPrioritySchema.optional(),
  assignedUserId: z.string().optional(),
  search: z.string().optional(),
});
export type SupportTicketListQuery = z.infer<typeof supportTicketListQuerySchema>;

export const supportTicketPageSchema = pageOf(supportTicketSchema, 'SupportTicketPage');

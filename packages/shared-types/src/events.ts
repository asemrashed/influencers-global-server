import { z } from 'zod';
import { paginationQuerySchema, pageOf } from './common.js';

// ───────────── Events ─────────────

export const eventStatusSchema = z.enum(['DRAFT', 'PUBLISHED', 'CANCELLED', 'COMPLETED']);
export type EventStatus = z.infer<typeof eventStatusSchema>;

export const rsvpStatusSchema = z.enum(['INVITED', 'ACCEPTED', 'DECLINED', 'WAITLISTED']);
export type RsvpStatus = z.infer<typeof rsvpStatusSchema>;

export const eventSchema = z.object({
  id: z.string(),
  slug: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  venue: z.string(),
  locationUrl: z.string().nullable(),
  startDate: z.string(),
  endDate: z.string(),
  dressCode: z.string().nullable(),
  capacity: z.number().int(),
  currentAttendees: z.number().int(),
  allowPlusOnes: z.boolean(),
  isPublic: z.boolean(),
  status: eventStatusSchema,
  coverFileId: z.string().nullable(),
  assignedUserId: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type EventDto = z.infer<typeof eventSchema>;

export const createEventSchema = z.object({
  slug: z.string().min(2).max(100).regex(/^[a-z0-9-]+$/),
  title: z.string().min(3).max(200),
  description: z.string().max(10000).nullable().optional(),
  venue: z.string().min(2).max(200),
  locationUrl: z.string().url().max(500).nullable().optional(),
  startDate: z.string().datetime(),
  endDate: z.string().datetime(),
  dressCode: z.string().max(100).nullable().optional(),
  capacity: z.number().int().min(1),
  allowPlusOnes: z.boolean().default(false),
  isPublic: z.boolean().default(false),
  status: eventStatusSchema.default('DRAFT'),
  coverFileId: z.string().nullable().optional(),
  assignedUserId: z.string().nullable().optional(),
});
export type CreateEventDto = z.infer<typeof createEventSchema>;

export const updateEventSchema = createEventSchema.partial();
export type UpdateEventDto = z.infer<typeof updateEventSchema>;

export const eventListQuerySchema = paginationQuerySchema.extend({
  status: eventStatusSchema.optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  search: z.string().optional(),
});
export type EventListQuery = z.infer<typeof eventListQuerySchema>;

export const eventPageSchema = pageOf(eventSchema, 'EventPage');

// ───────────── RSVPs & Digital Passes ─────────────

export const eventRsvpSchema = z.object({
  id: z.string(),
  eventId: z.string(),
  guestName: z.string(),
  guestEmail: z.string(),
  guestCompany: z.string().nullable(),
  status: rsvpStatusSchema,
  plusOneCount: z.number().int(),
  plusOneNames: z.array(z.string()),
  ticketCode: z.string(),
  checkedInAt: z.string().nullable(),
  checkedInBy: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type EventRsvpDto = z.infer<typeof eventRsvpSchema>;

export const createRsvpSchema = z.object({
  guestName: z.string().min(1).max(100),
  guestEmail: z.string().email().max(100),
  guestCompany: z.string().max(100).nullable().optional(),
  status: rsvpStatusSchema.default('ACCEPTED'),
  plusOneCount: z.number().int().min(0).max(5).default(0),
  plusOneNames: z.array(z.string().max(100)).default([]),
});
export type CreateRsvpDto = z.infer<typeof createRsvpSchema>;

export const updateRsvpStatusSchema = z.object({
  status: rsvpStatusSchema,
});
export type UpdateRsvpStatusDto = z.infer<typeof updateRsvpStatusSchema>;

export const rsvpListQuerySchema = paginationQuerySchema.extend({
  status: rsvpStatusSchema.optional(),
  search: z.string().optional(),
});
export type RsvpListQuery = z.infer<typeof rsvpListQuerySchema>;

export const rsvpPageSchema = pageOf(eventRsvpSchema, 'EventRsvpPage');

export const checkInTicketSchema = z.object({
  ticketCode: z.string().min(5).max(100),
});
export type CheckInTicketDto = z.infer<typeof checkInTicketSchema>;

export const checkInResultSchema = z.object({
  success: z.boolean(),
  alreadyCheckedIn: z.boolean(),
  rsvp: eventRsvpSchema,
});
export type CheckInResultDto = z.infer<typeof checkInResultSchema>;

// ───────────── PR Packages ─────────────

export const prPackageStatusSchema = z.enum(['PREPARING', 'SHIPPED', 'IN_TRANSIT', 'DELIVERED', 'CONFIRMED', 'CANCELLED']);
export type PrPackageStatus = z.infer<typeof prPackageStatusSchema>;

export const prPackageItemSchema = z.object({
  name: z.string().min(1).max(150),
  quantity: z.number().int().min(1).default(1),
  sku: z.string().max(50).optional(),
});
export type PrPackageItem = z.infer<typeof prPackageItemSchema>;

export const prPackageSchema = z.object({
  id: z.string(),
  title: z.string(),
  recipientName: z.string(),
  recipientEmail: z.string().nullable(),
  shippingAddress: z.string(),
  trackingNumber: z.string().nullable(),
  carrier: z.string().nullable(),
  status: prPackageStatusSchema,
  shippedAt: z.string().nullable(),
  deliveredAt: z.string().nullable(),
  receivedConfirmedAt: z.string().nullable(),
  items: z.array(prPackageItemSchema),
  notes: z.string().nullable(),
  assignedUserId: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type PrPackageDto = z.infer<typeof prPackageSchema>;

export const createPrPackageSchema = z.object({
  title: z.string().min(2).max(150),
  recipientName: z.string().min(1).max(100),
  recipientEmail: z.string().email().max(100).nullable().optional(),
  shippingAddress: z.string().min(5).max(500),
  trackingNumber: z.string().max(100).nullable().optional(),
  carrier: z.string().max(50).nullable().optional(),
  status: prPackageStatusSchema.default('PREPARING'),
  items: z.array(prPackageItemSchema).default([]),
  notes: z.string().max(2000).nullable().optional(),
  assignedUserId: z.string().nullable().optional(),
});
export type CreatePrPackageDto = z.infer<typeof createPrPackageSchema>;

export const updatePrPackageSchema = createPrPackageSchema.partial();
export type UpdatePrPackageDto = z.infer<typeof updatePrPackageSchema>;

export const prPackageListQuerySchema = paginationQuerySchema.extend({
  status: prPackageStatusSchema.optional(),
  carrier: z.string().optional(),
  search: z.string().optional(),
});
export type PrPackageListQuery = z.infer<typeof prPackageListQuerySchema>;

export const prPackagePageSchema = pageOf(prPackageSchema, 'PrPackagePage');

// ───────────── PR Invitations ─────────────

export const prInvitationStatusSchema = z.enum(['SENT', 'ACCEPTED', 'DECLINED', 'CANCELLED']);
export type PrInvitationStatus = z.infer<typeof prInvitationStatusSchema>;

export const prInvitationSchema = z.object({
  id: z.string(),
  brandOrEvent: z.string(),
  contactName: z.string(),
  contactEmail: z.string(),
  details: z.string().nullable(),
  date: z.string().nullable(),
  status: prInvitationStatusSchema,
  responseNotes: z.string().nullable(),
  assignedUserId: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type PrInvitationDto = z.infer<typeof prInvitationSchema>;

export const createPrInvitationSchema = z.object({
  brandOrEvent: z.string().min(2).max(150),
  contactName: z.string().min(1).max(100),
  contactEmail: z.string().email().max(100),
  details: z.string().max(3000).nullable().optional(),
  date: z.string().datetime().nullable().optional(),
  status: prInvitationStatusSchema.default('SENT'),
  responseNotes: z.string().max(1000).nullable().optional(),
  assignedUserId: z.string().nullable().optional(),
});
export type CreatePrInvitationDto = z.infer<typeof createPrInvitationSchema>;

export const updatePrInvitationSchema = createPrInvitationSchema.partial();
export type UpdatePrInvitationDto = z.infer<typeof updatePrInvitationSchema>;

export const prInvitationListQuerySchema = paginationQuerySchema.extend({
  status: prInvitationStatusSchema.optional(),
  search: z.string().optional(),
});
export type PrInvitationListQuery = z.infer<typeof prInvitationListQuerySchema>;

export const prInvitationPageSchema = pageOf(prInvitationSchema, 'PrInvitationPage');


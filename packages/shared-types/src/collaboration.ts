import { z } from 'zod';
import { paginationQuerySchema, pageOf } from './common.js';

// ───────────── Proposals ─────────────

export const proposalStatusSchema = z.enum(['DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'ACCEPTED', 'DECLINED', 'EXPIRED']);
export type ProposalStatus = z.infer<typeof proposalStatusSchema>;

export const proposalDeliverableSchema = z.object({
  title: z.string().min(1).max(100),
  platform: z.string().max(50).optional(),
  quantity: z.number().int().min(1).default(1),
  details: z.string().max(1000).optional(),
});
export type ProposalDeliverable = z.infer<typeof proposalDeliverableSchema>;

export const proposalSchema = z.object({
  id: z.string(),
  title: z.string(),
  brandName: z.string(),
  contactEmail: z.string().email(),
  objectives: z.string().nullable(),
  deliverables: z.array(proposalDeliverableSchema),
  compensationCents: z.number().int().nonnegative(),
  currency: z.string(),
  terms: z.string().nullable(),
  status: proposalStatusSchema,
  statusHistory: z.array(z.record(z.string(), z.unknown())),
  createdById: z.string().nullable(),
  assignedUserId: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ProposalDto = z.infer<typeof proposalSchema>;

export const createProposalSchema = z.object({
  title: z.string().min(3).max(200),
  brandName: z.string().min(1).max(100),
  contactEmail: z.string().email().max(100),
  objectives: z.string().max(3000).nullable().optional(),
  deliverables: z.array(proposalDeliverableSchema).default([]),
  compensationCents: z.number().int().nonnegative(),
  currency: z.string().min(3).max(3).default('USD'),
  terms: z.string().max(5000).nullable().optional(),
  assignedUserId: z.string().nullable().optional(),
});
export type CreateProposalDto = z.infer<typeof createProposalSchema>;

export const updateProposalSchema = createProposalSchema.partial();
export type UpdateProposalDto = z.infer<typeof updateProposalSchema>;

export const respondProposalSchema = z.object({
  status: z.enum(['ACCEPTED', 'DECLINED']),
  reason: z.string().max(1000).optional(),
});
export type RespondProposalDto = z.infer<typeof respondProposalSchema>;

export const proposalListQuerySchema = paginationQuerySchema.extend({
  status: proposalStatusSchema.optional(),
  brandName: z.string().optional(),
  search: z.string().optional(),
});
export type ProposalListQuery = z.infer<typeof proposalListQuerySchema>;

export const proposalPageSchema = pageOf(proposalSchema, 'ProposalPage');

// ───────────── Campaigns ─────────────

export const campaignStatusSchema = z.enum(['PLANNING', 'ACTIVE', 'IN_REVIEW', 'COMPLETED', 'CANCELLED']);
export type CampaignStatus = z.infer<typeof campaignStatusSchema>;

export const campaignTaskStatusSchema = z.enum(['TODO', 'IN_PROGRESS', 'DONE']);
export type CampaignTaskStatus = z.infer<typeof campaignTaskStatusSchema>;

export const campaignTaskSchema = z.object({
  id: z.string(),
  campaignId: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  dueDate: z.string().nullable(),
  status: campaignTaskStatusSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type CampaignTaskDto = z.infer<typeof campaignTaskSchema>;

export const deliverableStatusSchema = z.enum(['PENDING', 'SUBMITTED', 'REVISION_REQUESTED', 'APPROVED', 'REJECTED']);
export type DeliverableStatus = z.infer<typeof deliverableStatusSchema>;

export const deliverableSchema = z.object({
  id: z.string(),
  campaignId: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  platform: z.string().nullable(),
  assetFileIds: z.array(z.string()),
  externalUrl: z.string().nullable(),
  status: deliverableStatusSchema,
  feedback: z.string().nullable(),
  dueDate: z.string().nullable(),
  submittedAt: z.string().nullable(),
  approvedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type DeliverableDto = z.infer<typeof deliverableSchema>;

export const agreementStatusSchema = z.enum(['DRAFT', 'PENDING_SIGNATURE', 'SIGNED', 'EXPIRED']);
export type AgreementStatus = z.infer<typeof agreementStatusSchema>;

export const agreementSchema = z.object({
  id: z.string(),
  campaignId: z.string(),
  title: z.string(),
  content: z.string(),
  status: agreementStatusSchema,
  signatureData: z.string().nullable(),
  signedAt: z.string().nullable(),
  signerName: z.string().nullable(),
  signerEmail: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type AgreementDto = z.infer<typeof agreementSchema>;

export const campaignSchema = z.object({
  id: z.string(),
  proposalId: z.string().nullable(),
  name: z.string(),
  brandName: z.string(),
  status: campaignStatusSchema,
  startDate: z.string().nullable(),
  endDate: z.string().nullable(),
  budgetCents: z.number().int().nonnegative(),
  currency: z.string(),
  briefContent: z.string().nullable(),
  assignedUserId: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type CampaignDto = z.infer<typeof campaignSchema>;

export const campaignDetailSchema = campaignSchema.extend({
  tasks: z.array(campaignTaskSchema),
  deliverables: z.array(deliverableSchema),
  agreements: z.array(agreementSchema),
});
export type CampaignDetailDto = z.infer<typeof campaignDetailSchema>;

export const createCampaignSchema = z.object({
  name: z.string().min(2).max(150),
  brandName: z.string().min(1).max(100),
  proposalId: z.string().nullable().optional(),
  status: campaignStatusSchema.default('PLANNING'),
  startDate: z.string().datetime().nullable().optional(),
  endDate: z.string().datetime().nullable().optional(),
  budgetCents: z.number().int().nonnegative().default(0),
  currency: z.string().min(3).max(3).default('USD'),
  briefContent: z.string().max(20000).nullable().optional(),
  assignedUserId: z.string().nullable().optional(),
});
export type CreateCampaignDto = z.infer<typeof createCampaignSchema>;

export const updateCampaignSchema = createCampaignSchema.partial();
export type UpdateCampaignDto = z.infer<typeof updateCampaignSchema>;

export const createDeliverableSchema = z.object({
  title: z.string().min(2).max(150),
  description: z.string().max(2000).nullable().optional(),
  platform: z.string().max(50).nullable().optional(),
  assetFileIds: z.array(z.string()).default([]),
  externalUrl: z.string().url().max(500).nullable().optional(),
  dueDate: z.string().datetime().nullable().optional(),
});
export type CreateDeliverableDto = z.infer<typeof createDeliverableSchema>;

export const submitDeliverableSchema = z.object({
  assetFileIds: z.array(z.string()).default([]),
  externalUrl: z.string().url().max(500).nullable().optional(),
});
export type SubmitDeliverableDto = z.infer<typeof submitDeliverableSchema>;

export const reviewDeliverableSchema = z.object({
  status: z.enum(['APPROVED', 'REVISION_REQUESTED', 'REJECTED']),
  feedback: z.string().max(2000).optional(),
});
export type ReviewDeliverableDto = z.infer<typeof reviewDeliverableSchema>;

export const campaignListQuerySchema = paginationQuerySchema.extend({
  status: campaignStatusSchema.optional(),
  brandName: z.string().optional(),
  search: z.string().optional(),
});
export type CampaignListQuery = z.infer<typeof campaignListQuerySchema>;

export const campaignPageSchema = pageOf(campaignSchema, 'CampaignPage');

// ───────────── Meetings & Availability ─────────────

export const meetingStatusSchema = z.enum(['SCHEDULED', 'CONFIRMED', 'RESCHEDULED', 'COMPLETED', 'CANCELLED']);
export type MeetingStatus = z.infer<typeof meetingStatusSchema>;

export const meetingSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  guestName: z.string(),
  guestEmail: z.string().email(),
  startTime: z.string(),
  endTime: z.string(),
  meetingUrl: z.string().nullable(),
  status: meetingStatusSchema,
  assignedUserId: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type MeetingDto = z.infer<typeof meetingSchema>;

export const scheduleMeetingSchema = z.object({
  title: z.string().min(3).max(150),
  description: z.string().max(1000).nullable().optional(),
  guestName: z.string().min(1).max(100),
  guestEmail: z.string().email().max(100),
  startTime: z.string().datetime(),
  endTime: z.string().datetime(),
  meetingUrl: z.string().url().max(500).nullable().optional(),
  assignedUserId: z.string().nullable().optional(),
});
export type ScheduleMeetingDto = z.infer<typeof scheduleMeetingSchema>;

export const rescheduleMeetingSchema = z.object({
  startTime: z.string().datetime(),
  endTime: z.string().datetime(),
});
export type RescheduleMeetingDto = z.infer<typeof rescheduleMeetingSchema>;

export const meetingListQuerySchema = paginationQuerySchema.extend({
  status: meetingStatusSchema.optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  assignedUserId: z.string().optional(),
});
export type MeetingListQuery = z.infer<typeof meetingListQuerySchema>;

export const meetingPageSchema = pageOf(meetingSchema, 'MeetingPage');

export const availabilitySlotSchema = z.object({
  id: z.string(),
  dayOfWeek: z.number().int().min(0).max(6),
  startTime: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/),
  endTime: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/),
  isActive: z.boolean(),
});
export type AvailabilitySlotDto = z.infer<typeof availabilitySlotSchema>;

export const setAvailabilitySlotsSchema = z.object({
  slots: z.array(
    z.object({
      dayOfWeek: z.number().int().min(0).max(6),
      startTime: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/),
      endTime: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/),
      isActive: z.boolean().default(true),
    }),
  ),
});
export type SetAvailabilitySlotsDto = z.infer<typeof setAvailabilitySlotsSchema>;


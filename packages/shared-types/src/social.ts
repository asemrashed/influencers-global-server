import { z } from 'zod';
import { paginationQuerySchema, pageOf } from './common.js';

// ───────────── Social Accounts & Metrics ─────────────

export const socialPlatformSchema = z.enum([
  'INSTAGRAM',
  'FACEBOOK',
  'TIKTOK',
  'YOUTUBE',
  'LINKEDIN',
  'TELEGRAM',
  'TWITTER_X',
]);
export type SocialPlatform = z.infer<typeof socialPlatformSchema>;

export const connectionStatusSchema = z.enum(['CONNECTED', 'EXPIRED', 'DISCONNECTED', 'ERROR']);
export type ConnectionStatus = z.infer<typeof connectionStatusSchema>;

export const metricSourceSchema = z.enum(['SYNCED', 'MANUAL']);
export type MetricSource = z.infer<typeof metricSourceSchema>;

export const socialAccountSchema = z.object({
  id: z.string(),
  platform: socialPlatformSchema,
  accountHandle: z.string(),
  displayName: z.string().nullable(),
  scopes: z.array(z.string()),
  status: connectionStatusSchema,
  followerCount: z.number().int(),
  isStale: z.boolean(),
  lastSyncedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type SocialAccountDto = z.infer<typeof socialAccountSchema>;

export const connectSocialAccountSchema = z.object({
  platform: socialPlatformSchema,
  accountHandle: z.string().min(1).max(100),
  displayName: z.string().max(100).optional(),
  token: z.string().min(5), // Will be encrypted at rest with APP_ENCRYPTION_KEY
  scopes: z.array(z.string()).default([]),
  initialFollowerCount: z.number().int().nonnegative().default(0),
});
export type ConnectSocialAccountDto = z.infer<typeof connectSocialAccountSchema>;

export const manualFollowerEntrySchema = z.object({
  followerCount: z.number().int().nonnegative(),
});
export type ManualFollowerEntryDto = z.infer<typeof manualFollowerEntrySchema>;

export const followerSnapshotSchema = z.object({
  id: z.string(),
  accountId: z.string(),
  date: z.string(),
  followerCount: z.number().int(),
  source: metricSourceSchema,
  createdAt: z.string(),
});
export type FollowerSnapshotDto = z.infer<typeof followerSnapshotSchema>;

export const growthSeriesSchema = z.object({
  platform: socialPlatformSchema,
  accountHandle: z.string(),
  currentFollowers: z.number().int(),
  isStale: z.boolean(),
  snapshots: z.array(
    z.object({
      date: z.string(),
      followerCount: z.number().int(),
      source: metricSourceSchema,
    }),
  ),
});
export type GrowthSeriesDto = z.infer<typeof growthSeriesSchema>;

// ───────────── Content Drafts & Publishing ─────────────

export const contentStatusSchema = z.enum(['IDEA', 'DRAFT', 'SCHEDULED', 'PUBLISHED', 'FAILED']);
export type ContentStatus = z.infer<typeof contentStatusSchema>;

export const contentDraftSchema = z.object({
  id: z.string(),
  title: z.string(),
  caption: z.string().nullable(),
  hashtags: z.array(z.string()),
  platforms: z.array(socialPlatformSchema),
  mediaFileIds: z.array(z.string()),
  scheduledFor: z.string().nullable(),
  publishedAt: z.string().nullable(),
  status: contentStatusSchema,
  publishError: z.string().nullable(),
  createdById: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ContentDraftDto = z.infer<typeof contentDraftSchema>;

export const createContentDraftSchema = z.object({
  title: z.string().min(2).max(200),
  caption: z.string().max(5000).nullable().optional(),
  hashtags: z.array(z.string().max(50)).default([]),
  platforms: z.array(socialPlatformSchema).min(1),
  mediaFileIds: z.array(z.string()).default([]),
  scheduledFor: z.string().datetime().nullable().optional(),
  status: contentStatusSchema.default('DRAFT'),
});
export type CreateContentDraftDto = z.infer<typeof createContentDraftSchema>;

export const updateContentDraftSchema = createContentDraftSchema.partial();
export type UpdateContentDraftDto = z.infer<typeof updateContentDraftSchema>;

export const contentDraftListQuerySchema = paginationQuerySchema.extend({
  status: contentStatusSchema.optional(),
  platform: socialPlatformSchema.optional(),
  search: z.string().optional(),
});
export type ContentDraftListQuery = z.infer<typeof contentDraftListQuerySchema>;

export const contentDraftPageSchema = pageOf(contentDraftSchema, 'ContentDraftPage');

export const publishDraftResultSchema = z.object({
  success: z.boolean(),
  resultsPerPlatform: z.record(
    z.string(),
    z.object({
      success: z.boolean(),
      error: z.string().optional(),
      postId: z.string().optional(),
    }),
  ),
});
export type PublishDraftResultDto = z.infer<typeof publishDraftResultSchema>;

// ───────────── Dashboard Summary ─────────────

export const dashboardSummarySchema = z.object({
  pendingProposalsCount: z.number().int(),
  upcomingMeetingsCount: z.number().int(),
  eventRemindersCount: z.number().int(),
  unreadMessagesCount: z.number().int(),
  overdueDeliverablesCount: z.number().int(),
  totalFollowers: z.number().int(),
  activeCampaignsCount: z.number().int(),
  connectedAccountsCount: z.number().int(),
  staleAccountsCount: z.number().int(),
});
export type DashboardSummaryDto = z.infer<typeof dashboardSummarySchema>;


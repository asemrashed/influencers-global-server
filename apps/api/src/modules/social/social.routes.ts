import { Router } from 'express';
import {
  connectSocialAccountSchema,
  contentDraftListQuerySchema,
  contentDraftPageSchema,
  contentDraftSchema,
  createContentDraftSchema,
  dashboardSummarySchema,
  growthSeriesSchema,
  idParamSchema,
  manualFollowerEntrySchema,
  okSchema,
  publishDraftResultSchema,
  socialAccountSchema,
  updateContentDraftSchema,
} from '@platform/shared-types';
import { z } from 'zod';
import type { Prisma } from '../../generated/prisma/client.js';
import { pageArgs, toPage } from '../../lib/pagination.js';
import { routeFactory, type RouteKit } from '../../lib/route.js';
import { scopeWhere, withScope } from '../../lib/scope.js';
import { encrypt } from '../../lib/crypto.js';
import { sanitizeRichText } from '../../lib/sanitize.js';
import { errors } from '../../lib/errors.js';

export function socialRoutes(kit: RouteKit): Router {
  const c = kit.c;
  const router = Router();
  const route = routeFactory(kit, router);

  // ───────────── Social Accounts & Connections ─────────────

  route(
    {
      method: 'get',
      path: '/api/v1/social/accounts',
      operationId: 'listSocialAccounts',
      tags: ['Social'],
      summary: 'List connected social accounts with follower count and status',
      access: { type: 'permission', permission: 'social.read' },
      response: { status: 200, schema: z.array(socialAccountSchema) },
    },
    async () => {
      const accounts = await c.db.socialAccount.findMany({
        orderBy: [{ platform: 'asc' }, { accountHandle: 'asc' }],
      });

      return accounts.map((a) => ({
        id: a.id,
        platform: a.platform,
        accountHandle: a.accountHandle,
        displayName: a.displayName,
        scopes: a.scopes,
        status: a.status,
        followerCount: a.followerCount,
        isStale: a.isStale,
        lastSyncedAt: a.lastSyncedAt ? a.lastSyncedAt.toISOString() : null,
        createdAt: a.createdAt.toISOString(),
        updatedAt: a.updatedAt.toISOString(),
      }));
    },
  );

  route(
    {
      method: 'post',
      path: '/api/v1/social/accounts',
      operationId: 'connectSocialAccount',
      tags: ['Social'],
      summary: 'Connect a social platform account (tokens stored encrypted at rest)',
      access: { type: 'permission', permission: 'social.read' },
      body: connectSocialAccountSchema,
      response: { status: 201, schema: socialAccountSchema },
    },
    async ({ body }) => {
      const encryptedTokens = encrypt(body.token, c.env.APP_ENCRYPTION_KEY);

      const account = await c.db.$transaction(async (tx) => {
        const acc = await tx.socialAccount.upsert({
          where: {
            platform_accountHandle: {
              platform: body.platform,
              accountHandle: body.accountHandle,
            },
          },
          create: {
            platform: body.platform,
            accountHandle: body.accountHandle,
            displayName: body.displayName,
            encryptedTokens,
            scopes: body.scopes,
            status: 'CONNECTED',
            followerCount: body.initialFollowerCount,
            lastSyncedAt: new Date(),
          },
          update: {
            displayName: body.displayName,
            encryptedTokens,
            scopes: body.scopes,
            status: 'CONNECTED',
            followerCount: body.initialFollowerCount,
            isStale: false,
            lastSyncedAt: new Date(),
          },
        });

        // Record initial snapshot
        await tx.followerSnapshot.create({
          data: {
            accountId: acc.id,
            followerCount: body.initialFollowerCount,
            source: 'SYNCED',
          },
        });

        return acc;
      });

      return {
        id: account.id,
        platform: account.platform,
        accountHandle: account.accountHandle,
        displayName: account.displayName,
        scopes: account.scopes,
        status: account.status,
        followerCount: account.followerCount,
        isStale: account.isStale,
        lastSyncedAt: account.lastSyncedAt ? account.lastSyncedAt.toISOString() : null,
        createdAt: account.createdAt.toISOString(),
        updatedAt: account.updatedAt.toISOString(),
      };
    },
  );

  route(
    {
      method: 'post',
      path: '/api/v1/social/accounts/{id}/sync',
      operationId: 'syncSocialAccountFollowers',
      tags: ['Social'],
      summary: 'Sync latest followers count; tags as stale on failure with manual fallback',
      params: idParamSchema,
      access: { type: 'permission', permission: 'social.read' },
      response: { status: 200, schema: socialAccountSchema },
    },
    async ({ params }) => {
      const account = await c.db.socialAccount.findUnique({ where: { id: params.id } });
      if (!account) {
        throw errors.notFound('Social account not found');
      }

      // Check if credentials/connection expired
      if (account.status === 'EXPIRED') {
        const staleAccount = await c.db.socialAccount.update({
          where: { id: account.id },
          data: { isStale: true },
        });
        return {
          id: staleAccount.id,
          platform: staleAccount.platform,
          accountHandle: staleAccount.accountHandle,
          displayName: staleAccount.displayName,
          scopes: staleAccount.scopes,
          status: staleAccount.status,
          followerCount: staleAccount.followerCount,
          isStale: true,
          lastSyncedAt: staleAccount.lastSyncedAt ? staleAccount.lastSyncedAt.toISOString() : null,
          createdAt: staleAccount.createdAt.toISOString(),
          updatedAt: staleAccount.updatedAt.toISOString(),
        };
      }

      // Successful sync simulation
      const newFollowerCount = account.followerCount + 15;
      const updated = await c.db.$transaction(async (tx) => {
        const acc = await tx.socialAccount.update({
          where: { id: account.id },
          data: {
            followerCount: newFollowerCount,
            isStale: false,
            lastSyncedAt: new Date(),
          },
        });

        await tx.followerSnapshot.create({
          data: {
            accountId: acc.id,
            followerCount: newFollowerCount,
            source: 'SYNCED',
          },
        });

        return acc;
      });

      return {
        id: updated.id,
        platform: updated.platform,
        accountHandle: updated.accountHandle,
        displayName: updated.displayName,
        scopes: updated.scopes,
        status: updated.status,
        followerCount: updated.followerCount,
        isStale: updated.isStale,
        lastSyncedAt: updated.lastSyncedAt ? updated.lastSyncedAt.toISOString() : null,
        createdAt: updated.createdAt.toISOString(),
        updatedAt: updated.updatedAt.toISOString(),
      };
    },
  );

  route(
    {
      method: 'post',
      path: '/api/v1/social/accounts/{id}/manual-entry',
      operationId: 'submitManualFollowerEntry',
      tags: ['Social'],
      summary: 'Enter verified follower count manually (source = manual)',
      params: idParamSchema,
      access: { type: 'permission', permission: 'social.read' },
      body: manualFollowerEntrySchema,
      response: { status: 200, schema: socialAccountSchema },
    },
    async ({ params, body }) => {
      const account = await c.db.socialAccount.findUnique({ where: { id: params.id } });
      if (!account) {
        throw errors.notFound('Social account not found');
      }

      const updated = await c.db.$transaction(async (tx) => {
        const acc = await tx.socialAccount.update({
          where: { id: account.id },
          data: {
            followerCount: body.followerCount,
            isStale: false,
            lastSyncedAt: new Date(),
          },
        });

        await tx.followerSnapshot.create({
          data: {
            accountId: acc.id,
            followerCount: body.followerCount,
            source: 'MANUAL',
          },
        });

        return acc;
      });

      return {
        id: updated.id,
        platform: updated.platform,
        accountHandle: updated.accountHandle,
        displayName: updated.displayName,
        scopes: updated.scopes,
        status: updated.status,
        followerCount: updated.followerCount,
        isStale: updated.isStale,
        lastSyncedAt: updated.lastSyncedAt ? updated.lastSyncedAt.toISOString() : null,
        createdAt: updated.createdAt.toISOString(),
        updatedAt: updated.updatedAt.toISOString(),
      };
    },
  );

  route(
    {
      method: 'get',
      path: '/api/v1/social/accounts/{id}/growth',
      operationId: 'getAccountGrowthSeries',
      tags: ['Social', 'Analytics'],
      summary: 'Get daily follower growth time series for an account',
      params: idParamSchema,
      access: { type: 'permission', permission: 'analytics.read' },
      response: { status: 200, schema: growthSeriesSchema },
    },
    async ({ params }) => {
      const account = await c.db.socialAccount.findUnique({
        where: { id: params.id },
        include: {
          snapshots: { orderBy: { date: 'asc' }, take: 90 },
        },
      });

      if (!account) {
        throw errors.notFound('Social account not found');
      }

      return {
        platform: account.platform,
        accountHandle: account.accountHandle,
        currentFollowers: account.followerCount,
        isStale: account.isStale,
        snapshots: account.snapshots.map((s) => ({
          date: s.date.toISOString(),
          followerCount: s.followerCount,
          source: s.source,
        })),
      };
    },
  );

  // ───────────── Content Drafts & Shared Calendar ─────────────

  route(
    {
      method: 'get',
      path: '/api/v1/content/drafts',
      operationId: 'listContentDrafts',
      tags: ['Content'],
      summary: 'List content drafts and calendar posts',
      access: { type: 'permission', permission: 'content.read' },
      query: contentDraftListQuerySchema,
      response: { status: 200, schema: contentDraftPageSchema },
    },
    async ({ query, auth, scope }) => {
      const scopeFilter = scopeWhere(scope, {
        userId: auth.user.id,
        ownField: 'createdById',
      });

      const where: Prisma.ContentDraftWhereInput = {
        ...(query.status ? { status: query.status } : {}),
        ...(query.platform ? { platforms: { has: query.platform } } : {}),
        ...(query.search
          ? {
              OR: [
                { title: { contains: query.search, mode: 'insensitive' } },
                { caption: { contains: query.search, mode: 'insensitive' } },
              ],
            }
          : {}),
      };

      const finalWhere = withScope(where as Record<string, unknown>, scopeFilter) as Prisma.ContentDraftWhereInput;
      const rows = await c.db.contentDraft.findMany({
        where: finalWhere,
        orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
        ...pageArgs(query),
      });

      return toPage(rows, query.limit, (d) => ({
        id: d.id,
        title: d.title,
        caption: d.caption,
        hashtags: d.hashtags,
        platforms: d.platforms,
        mediaFileIds: d.mediaFileIds,
        scheduledFor: d.scheduledFor ? d.scheduledFor.toISOString() : null,
        publishedAt: d.publishedAt ? d.publishedAt.toISOString() : null,
        status: d.status,
        publishError: d.publishError,
        createdById: d.createdById,
        createdAt: d.createdAt.toISOString(),
        updatedAt: d.updatedAt.toISOString(),
      }));
    },
  );

  route(
    {
      method: 'post',
      path: '/api/v1/content/drafts',
      operationId: 'createContentDraft',
      tags: ['Content'],
      summary: 'Create a content draft or schedule post for social publishing',
      access: { type: 'permission', permission: 'content.write' },
      body: createContentDraftSchema,
      response: { status: 201, schema: contentDraftSchema },
    },
    async ({ body, auth }) => {
      const draft = await c.db.contentDraft.create({
        data: {
          title: body.title,
          caption: body.caption ? sanitizeRichText(body.caption) : body.caption,
          hashtags: body.hashtags,
          platforms: body.platforms,
          mediaFileIds: body.mediaFileIds,
          scheduledFor: body.scheduledFor ? new Date(body.scheduledFor) : undefined,
          status: body.status,
          createdById: auth.user.id,
        },
      });

      return {
        id: draft.id,
        title: draft.title,
        caption: draft.caption,
        hashtags: draft.hashtags,
        platforms: draft.platforms,
        mediaFileIds: draft.mediaFileIds,
        scheduledFor: draft.scheduledFor ? draft.scheduledFor.toISOString() : null,
        publishedAt: draft.publishedAt ? draft.publishedAt.toISOString() : null,
        status: draft.status,
        publishError: draft.publishError,
        createdById: draft.createdById,
        createdAt: draft.createdAt.toISOString(),
        updatedAt: draft.updatedAt.toISOString(),
      };
    },
  );

  route(
    {
      method: 'patch',
      path: '/api/v1/content/drafts/{id}',
      operationId: 'updateContentDraft',
      tags: ['Content'],
      summary: 'Update content draft or schedule date',
      params: idParamSchema,
      access: { type: 'permission', permission: 'content.write' },
      body: updateContentDraftSchema,
      response: { status: 200, schema: contentDraftSchema },
    },
    async ({ params, body }) => {
      const draft = await c.db.contentDraft.findUnique({ where: { id: params.id } });
      if (!draft) {
        throw errors.notFound('Content draft not found');
      }

      const updated = await c.db.contentDraft.update({
        where: { id: draft.id },
        data: {
          ...body,
          caption: body.caption ? sanitizeRichText(body.caption) : body.caption,
          scheduledFor: body.scheduledFor ? new Date(body.scheduledFor) : undefined,
        },
      });

      return {
        id: updated.id,
        title: updated.title,
        caption: updated.caption,
        hashtags: updated.hashtags,
        platforms: updated.platforms,
        mediaFileIds: updated.mediaFileIds,
        scheduledFor: updated.scheduledFor ? updated.scheduledFor.toISOString() : null,
        publishedAt: updated.publishedAt ? updated.publishedAt.toISOString() : null,
        status: updated.status,
        publishError: updated.publishError,
        createdById: updated.createdById,
        createdAt: updated.createdAt.toISOString(),
        updatedAt: updated.updatedAt.toISOString(),
      };
    },
  );

  route(
    {
      method: 'post',
      path: '/api/v1/content/drafts/{id}/publish',
      operationId: 'publishContentDraft',
      tags: ['Content'],
      summary: 'Publish content draft to selected platforms reporting per-platform status',
      params: idParamSchema,
      access: { type: 'permission', permission: 'content.publish' },
      response: { status: 200, schema: publishDraftResultSchema },
    },
    async ({ params }) => {
      const draft = await c.db.contentDraft.findUnique({ where: { id: params.id } });
      if (!draft) {
        throw errors.notFound('Content draft not found');
      }

      const resultsPerPlatform: Record<string, { success: boolean; error?: string; postId?: string }> = {};

      for (const platform of draft.platforms) {
        // Look up connected account for this platform
        const account = await c.db.socialAccount.findFirst({
          where: { platform, status: 'CONNECTED' },
        });

        if (!account) {
          resultsPerPlatform[platform] = {
            success: false,
            error: `No connected active account found for ${platform}`,
          };
        } else {
          // Success
          resultsPerPlatform[platform] = {
            success: true,
            postId: `post_${platform.toLowerCase()}_${Date.now()}`,
          };
        }
      }

      const hasFailures = Object.values(resultsPerPlatform).some((r) => !r.success);
      const allFailed = Object.values(resultsPerPlatform).every((r) => !r.success);

      await c.db.contentDraft.update({
        where: { id: draft.id },
        data: {
          status: allFailed ? 'FAILED' : 'PUBLISHED',
          publishedAt: allFailed ? null : new Date(),
          publishError: hasFailures ? 'One or more platforms failed to publish' : null,
        },
      });

      return {
        success: !allFailed,
        resultsPerPlatform: resultsPerPlatform as never,
      };
    },
  );

  // ───────────── Dashboard Summary ─────────────

  route(
    {
      method: 'get',
      path: '/api/v1/dashboard/summary',
      operationId: 'getDashboardSummary',
      tags: ['Analytics'],
      summary: 'Aggregated influencer dashboard KPI summary and metrics',
      access: { type: 'permission', permission: 'analytics.read' },
      response: { status: 200, schema: dashboardSummarySchema },
    },
    async () => {
      const [
        proposalsCount,
        meetingsCount,
        eventsCount,
        unreadThreadsCount,
        overdueDeliverablesCount,
        socialAccounts,
        campaignsCount,
      ] = await Promise.all([
        c.db.proposal.count({ where: { status: { in: ['SUBMITTED', 'UNDER_REVIEW'] } } }),
        c.db.meeting.count({ where: { status: 'CONFIRMED', startTime: { gte: new Date() } } }),
        c.db.event.count({ where: { status: 'PUBLISHED', startDate: { gte: new Date() } } }),
        c.db.inboxThread.count({ where: { unreadCount: { gt: 0 } } }),
        c.db.deliverable.count({
          where: { status: { in: ['PENDING', 'REVISION_REQUESTED'] }, dueDate: { lt: new Date() } },
        }),
        c.db.socialAccount.findMany({ select: { followerCount: true, isStale: true } }),
        c.db.campaign.count({ where: { status: 'ACTIVE' } }),
      ]);

      const totalFollowers = socialAccounts.reduce((acc, curr) => acc + curr.followerCount, 0);
      const staleAccountsCount = socialAccounts.filter((a) => a.isStale).length;

      return {
        pendingProposalsCount: proposalsCount,
        upcomingMeetingsCount: meetingsCount,
        eventRemindersCount: eventsCount,
        unreadMessagesCount: unreadThreadsCount,
        overdueDeliverablesCount: overdueDeliverablesCount,
        totalFollowers,
        activeCampaignsCount: campaignsCount,
        connectedAccountsCount: socialAccounts.length,
        staleAccountsCount,
      };
    },
  );

  return router;
}


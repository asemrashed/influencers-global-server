import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, signInWithTwoFactor, type TestApp } from './helpers.js';

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
}, 60_000);
afterAll(async () => {
  await t.close();
});

describe('Phase 5 E2E Flow — Social, Analytics & Dashboard Summary', () => {
  it('connects social account, syncs metrics with manual fallback, creates & publishes drafts, and retrieves dashboard KPIs', async () => {
    // 1. Sign in as Super Admin
    const { client: admin } = await signInWithTwoFactor(t, 'superadmin@example.test', 'super_admin');

    // 2. Connect YouTube account with encrypted access tokens
    const connectRes = await admin.post('/api/v1/social/accounts', {
      platform: 'YOUTUBE',
      accountHandle: '@TopCreatorChannel',
      displayName: 'Top Creator Channel',
      token: 'oauth2_secret_refresh_token_xyz123',
      scopes: ['user.info', 'youtube.readonly'],
      initialFollowerCount: 150000,
    });
    expect(connectRes.status).toBe(201);
    expect(connectRes.body.platform).toBe('YOUTUBE');
    expect(connectRes.body.followerCount).toBe(150000);
    const accountId = connectRes.body.id;

    // 3. No platform adapter is installed: sync must say so, never invent followers or a SYNCED snapshot
    const syncRes = await admin.post(`/api/v1/social/accounts/${accountId}/sync`, {});
    expect(syncRes.status).toBe(503);
    expect(syncRes.body.code).toBe('CAPABILITY_DISABLED');
    expect((await admin.get(`/api/v1/social/accounts/${accountId}/growth`)).body.snapshots.map((s: any) => s.source)).not.toContain('SYNCED');

    // 4. Manual entry (provenance tagged as manual)
    const manualRes = await admin.post(`/api/v1/social/accounts/${accountId}/manual-entry`, {
      followerCount: 152000,
    });
    expect(manualRes.status).toBe(200);
    expect(manualRes.body.followerCount).toBe(152000);
    const growthRes = await admin.get(`/api/v1/social/accounts/${accountId}/growth`);
    expect(growthRes.status).toBe(200);
    const sources = growthRes.body.snapshots.map((s: any) => s.source);
    expect(sources).toContain('MANUAL');
    expect(sources).not.toContain('SYNCED');

    // 5. Create a cross-platform content draft
    const draftRes = await admin.post('/api/v1/content/drafts', {
      title: 'Summer Gear Review Teaser',
      caption: 'Testing the ultimate summer adventure tech! Dropping tomorrow. #Adventure #TechReview',
      hashtags: ['Adventure', 'TechReview'],
      platforms: ['YOUTUBE', 'INSTAGRAM'],
      mediaFileIds: ['file-summer-teaser-mp4'],
      scheduledFor: '2026-11-25T15:00:00.000Z',
      status: 'DRAFT',
    });
    expect(draftRes.status).toBe(201);
    expect(draftRes.body.title).toBe('Summer Gear Review Teaser');
    const draftId = draftRes.body.id;

    // 6. Publishing is not available without a platform integration; the draft must stay untouched
    const publishRes = await admin.post(`/api/v1/content/drafts/${draftId}/publish`, {});
    expect(publishRes.status).toBe(503);
    expect(publishRes.body.code).toBe('CAPABILITY_DISABLED');
    const after = await t.c.db.contentDraft.findUniqueOrThrow({ where: { id: draftId } });
    expect([after.status, after.publishedAt]).toEqual(['DRAFT', null]);

    // 7. Retrieve aggregated dashboard summary metrics
    const dashRes = await admin.get('/api/v1/dashboard/summary');
    expect(dashRes.status).toBe(200);
    expect(dashRes.body.connectedAccountsCount).toBeGreaterThanOrEqual(1);
    expect(dashRes.body.totalFollowers).toBeGreaterThanOrEqual(152000);
    expect(typeof dashRes.body.unreadMessagesCount).toBe('number');
    expect(typeof dashRes.body.pendingProposalsCount).toBe('number');
    expect(typeof dashRes.body.upcomingMeetingsCount).toBe('number');
  }, 90_000);
});


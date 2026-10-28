import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, createTestApp, createUser, signInWithTwoFactor, type TestApp } from './helpers.js';

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
}, 30_000);
afterAll(async () => {
  await t.close();
});

describe('Phase 2 E2E Flow — Profile, Inquiries, Inbox & Support', () => {
  it('runs end-to-end flow through the API', async () => {
    // 1. Super Admin signs in (with 2FA) and updates profile, bio, niche, rate card
    const { client: admin } = await signInWithTwoFactor(t, 'superadmin@example.test', 'super_admin');

    const updateProfileRes = await admin.patch('/api/v1/profile', {
      displayName: 'Top Influencer',
      bio: '<b>Award-winning creator</b> focused on tech & lifestyle.',
      tagline: 'Creating the future of media',
      primaryNiche: 'Tech',
      secondaryNiches: ['Lifestyle', 'Gaming'],
      isPublic: true,
      allowInquiries: true,
      allowBookings: true,
      socialLinks: [{ platform: 'youtube', url: 'https://youtube.com/@example', handle: '@example', followerCount: 500000 }],
    });
    expect(updateProfileRes.status).toBe(200);
    expect(updateProfileRes.body.displayName).toBe('Top Influencer');
    expect(updateProfileRes.body.primaryNiche).toBe('Tech');

    // 2. Unauthenticated brand views public profile
    const unauth = new Client(t.app);
    const pubProfileRes = await unauth.get('/api/v1/public/profile');
    expect(pubProfileRes.status).toBe(200);
    expect(pubProfileRes.body.displayName).toBe('Top Influencer');
    expect(pubProfileRes.body.allowInquiries).toBe(true);

    // 3. Super Admin creates a portfolio album and item
    const albumRes = await admin.post('/api/v1/portfolio/albums', {
      slug: 'brand-campaigns-2026',
      title: 'Brand Campaigns 2026',
      description: 'Select brand sponsorships and creative shoots',
      isPublic: true,
      orderIndex: 1,
    });
    expect(albumRes.status).toBe(201);
    expect(albumRes.body.slug).toBe('brand-campaigns-2026');

    const itemRes = await admin.post(`/api/v1/portfolio/albums/${albumRes.body.id}/items`, {
      title: 'Global Tech Launch',
      description: 'Lead video showcase for new flagship phone',
      clientName: 'TechCorp',
      tags: ['Video', 'Campaign'],
    });
    expect(itemRes.status).toBe(201);
    expect(itemRes.body.title).toBe('Global Tech Launch');

    // 4. Public reads portfolio album and its items
    const pubAlbumRes = await unauth.get('/api/v1/public/portfolio/albums/brand-campaigns-2026');
    expect(pubAlbumRes.status).toBe(200);
    expect(pubAlbumRes.body.title).toBe('Brand Campaigns 2026');
    expect(pubAlbumRes.body.items.length).toBe(1);
    expect(pubAlbumRes.body.items[0].clientName).toBe('TechCorp');

    // 5. Brand submits a public collaboration inquiry
    const inquiryRes = await unauth.post('/api/v1/public/inquiries', {
      name: 'Alice Brand Manager',
      email: 'alice@brand.test',
      brandName: 'Acme Corp',
      subject: 'Q4 Sponsored Video Campaign',
      message: 'We would love to sponsor your next tech review episode with a dedicated segment.',
      budgetRange: '$10k - $20k',
      timeline: 'November 2026',
    });
    expect(inquiryRes.status).toBe(201);
    expect(inquiryRes.body.ok).toBe(true);

    // 6. Admin checks inbox threads and sees the brand inquiry
    const inboxListRes = await admin.get('/api/v1/inbox/threads');
    expect(inboxListRes.status).toBe(200);
    expect(inboxListRes.body.items.length).toBeGreaterThanOrEqual(1);
    const targetThread = inboxListRes.body.items.find((item: any) => item.senderEmail === 'alice@brand.test');
    expect(targetThread).toBeDefined();
    expect(targetThread.brandName).toBe('Acme Corp');

    // 7. Admin replies to the thread
    const replyRes = await admin.post(`/api/v1/inbox/threads/${targetThread.id}/messages`, {
      body: 'Hi Alice, thanks for reaching out! We are interested. Let us discuss deliverables.',
    });
    expect(replyRes.status).toBe(201);
    expect(replyRes.body.isFromStaff).toBe(true);

    // Verify thread status was updated to WAITING
    const threadDetail = await admin.get(`/api/v1/inbox/threads/${targetThread.id}`);
    expect(threadDetail.status).toBe(200);
    expect(threadDetail.body.status).toBe('WAITING');
    expect(threadDetail.body.messages.length).toBe(2);

    // 8. Create user with Manager role and test Support Ticket scoping
    const managerUser = await createUser(t.c, { email: 'manager@example.test', roleKey: 'manager' });
    const manager = new Client(t.app);
    await manager.login('manager@example.test');

    // Manager creates a support ticket
    const ticketRes = await manager.post('/api/v1/support/tickets', {
      subject: 'Issue with campaign asset upload',
      category: 'CAMPAIGN',
      priority: 'HIGH',
      message: 'The asset upload link is expiring before the file finishes uploading.',
    });
    expect(ticketRes.status).toBe(201);
    expect(ticketRes.body.subject).toBe('Issue with campaign asset upload');
    expect(ticketRes.body.requesterId).toBe(managerUser.id);

    // Manager sees only own tickets (matrix scope: own)
    const managerTickets = await manager.get('/api/v1/support/tickets');
    expect(managerTickets.status).toBe(200);
    expect(managerTickets.body.items.length).toBe(1);
    expect(managerTickets.body.items[0].id).toBe(ticketRes.body.id);

    // Admin replies to the support ticket
    const ticketReplyRes = await admin.post(`/api/v1/support/tickets/${ticketRes.body.id}/replies`, {
      message: 'We have increased the timeout limit on the upload presigner. Please retry now.',
    });
    expect(ticketReplyRes.status).toBe(201);
    expect(ticketReplyRes.body.isStaff).toBe(true);

    // Check ticket updated status
    const ticketDetailRes = await manager.get(`/api/v1/support/tickets/${ticketRes.body.id}`);
    expect(ticketDetailRes.status).toBe(200);
    expect(ticketDetailRes.body.status).toBe('WAITING_CUSTOMER');
    expect(ticketDetailRes.body.replies.length).toBe(2);
  }, 90_000);
});

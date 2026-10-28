import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, createTestApp, createUser, signInWithTwoFactor, type TestApp } from './helpers.js';

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
}, 60_000);
afterAll(async () => {
  await t.close();
});

describe('Phase 3 E2E Flow — Proposals, Campaigns, Deliverables & Meetings', () => {
  it('converts proposal to campaign, submits & approves deliverable, and detects meeting conflicts', async () => {
    // 1. Sign in as Super Admin
    const { client: admin } = await signInWithTwoFactor(t, 'superadmin@example.test', 'super_admin');

    // 2. Create proposal for a brand
    const propRes = await admin.post('/api/v1/proposals', {
      title: 'Summer Beverage Campaign 2026',
      brandName: 'HydroGlow Drinks',
      contactEmail: 'partnerships@hydroglow.test',
      objectives: 'Drive awareness for zero-sugar electrolyte beverage.',
      deliverables: [
        { title: 'YouTube Dedicated Review', platform: 'YouTube', quantity: 1, details: 'Full 8-minute review' },
        { title: 'Instagram Reel', platform: 'Instagram', quantity: 2, details: 'Unboxing and workout feature' },
      ],
      compensationCents: 500000, // $5,000.00
      currency: 'USD',
      terms: 'Payment 50% upfront, 50% upon delivery approval.',
    });
    expect(propRes.status).toBe(201);
    expect(propRes.body.status).toBe('DRAFT');
    expect(propRes.body.deliverables).toHaveLength(2);
    const proposalId = propRes.body.id;

    // 3. Accept proposal (converts into campaign workspace with deliverables)
    const acceptRes = await admin.post(`/api/v1/proposals/${proposalId}/respond`, {
      status: 'ACCEPTED',
      reason: 'Terms negotiated and approved by both parties',
    });
    expect(acceptRes.status).toBe(200);
    expect(acceptRes.body.status).toBe('ACCEPTED');

    // 4. Find the generated campaign workspace
    const campListRes = await admin.get('/api/v1/campaigns');
    expect(campListRes.status).toBe(200);
    const campaign = campListRes.body.items.find((c: any) => c.proposalId === proposalId);
    expect(campaign).toBeDefined();
    expect(campaign.name).toBe('Summer Beverage Campaign 2026');
    expect(campaign.budgetCents).toBe(500000);

    // Verify campaign details include the 2 generated deliverables
    const campDetailRes = await admin.get(`/api/v1/campaigns/${campaign.id}`);
    expect(campDetailRes.status).toBe(200);
    expect(campDetailRes.body.deliverables).toHaveLength(2);
    const deliv = campDetailRes.body.deliverables[0];

    // 5. Manager signs in, submits assets for the deliverable
    await createUser(t.c, { email: 'manager@example.test', roleKey: 'manager' });
    const manager = new Client(t.app);
    await manager.login('manager@example.test');

    const submitRes = await manager.post(`/api/v1/deliverables/${deliv.id}/submit`, {
      externalUrl: 'https://youtube.com/watch?v=unlisted-preview-123',
      assetFileIds: ['file-draft-review-mp4'],
    });
    expect(submitRes.status).toBe(200);
    expect(submitRes.body.status).toBe('SUBMITTED');

    // 6. Admin reviews and approves the deliverable
    const reviewRes = await admin.post(`/api/v1/deliverables/${deliv.id}/review`, {
      status: 'APPROVED',
      feedback: 'Excellent integration of the flavor profiles. Approved for publish!',
    });
    expect(reviewRes.status).toBe(200);
    expect(reviewRes.body.status).toBe('APPROVED');
    expect(reviewRes.body.feedback).toContain('Approved for publish');

    // 7. Configure availability slots
    const setSlotsRes = await admin.put('/api/v1/meetings/slots', {
      slots: [
        { dayOfWeek: 2, startTime: '10:00', endTime: '18:00', isActive: true },
        { dayOfWeek: 4, startTime: '10:00', endTime: '18:00', isActive: true },
      ],
    });
    expect(setSlotsRes.status).toBe(200);
    expect(setSlotsRes.body).toHaveLength(2);

    // 8. Public guest books a meeting slot
    const guest = new Client(t.app);
    const startTime = '2026-11-10T14:00:00.000Z';
    const endTime = '2026-11-10T15:00:00.000Z';

    const bookRes = await guest.post('/api/v1/public/meetings/book', {
      title: 'HydroGlow Campaign Kickoff',
      guestName: 'Sarah Marketing Lead',
      guestEmail: 'sarah@hydroglow.test',
      startTime,
      endTime,
      meetingUrl: 'https://meet.google.com/abc-defg-hij',
    });
    expect(bookRes.status).toBe(201);
    expect(bookRes.body.status).toBe('SCHEDULED');

    // 9. Booking conflict detection: another booking overlapping the same slot is rejected
    const conflictRes = await guest.post('/api/v1/public/meetings/book', {
      title: 'Conflicting Booking Attempt',
      guestName: 'Bob Competitor',
      guestEmail: 'bob@other.test',
      startTime: '2026-11-10T14:30:00.000Z', // overlaps 14:00 - 15:00
      endTime: '2026-11-10T15:30:00.000Z',
    });
    expect(conflictRes.status).toBe(409);
    expect(conflictRes.body.code).toBe('CONFLICT');

    // 10. Admin confirms the kickoff meeting
    const confirmRes = await admin.post(`/api/v1/meetings/${bookRes.body.id}/confirm`, {});
    expect(confirmRes.status).toBe(200);
    expect(confirmRes.body.status).toBe('CONFIRMED');
  }, 90_000);
});


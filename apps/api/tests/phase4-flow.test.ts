import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, createTestApp, createUser, signInWithTwoFactor, type TestApp } from './helpers.js';

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
}, 60_000);
afterAll(async () => {
  await t.close();
});

describe('Phase 4 E2E Flow — PR, Events, RSVPs & Digital Passes', () => {
  it('creates an event, enforces capacity on RSVPs, checks in guest with replay protection, and manages PR packages', async () => {
    // 1. Sign in as Super Admin
    const { client: admin } = await signInWithTwoFactor(t, 'superadmin@example.test', 'super_admin');

    // 2. Create an event with capacity limit of 2 attendees
    const eventRes = await admin.post('/api/v1/events', {
      slug: 'exclusive-product-launch-2026',
      title: 'Exclusive Product Launch 2026',
      description: 'Private VIP showcase for brand partners and press.',
      venue: 'Metropolitan Sky Lounge, Level 42',
      locationUrl: 'https://maps.example.com/skylounge',
      startDate: '2026-11-20T18:00:00.000Z',
      endDate: '2026-11-20T22:00:00.000Z',
      dressCode: 'Black Tie',
      capacity: 2, // strict limit for capacity check
      allowPlusOnes: true,
      isPublic: true,
      status: 'PUBLISHED',
    });
    expect(eventRes.status).toBe(201);
    expect(eventRes.body.slug).toBe('exclusive-product-launch-2026');
    expect(eventRes.body.capacity).toBe(2);

    // 3. Guest 1 RSVPs with +1 (takes 2 spots, reaching full capacity)
    const guest1 = new Client(t.app);
    const rsvp1Res = await guest1.post('/api/v1/public/events/exclusive-product-launch-2026/rsvp', {
      guestName: 'Jessica Editor',
      guestEmail: 'jessica@fashionmag.test',
      guestCompany: 'Fashion Magazine',
      status: 'ACCEPTED',
      plusOneCount: 1,
      plusOneNames: ['Mark Photographer'],
    });
    expect(rsvp1Res.status).toBe(201);
    expect(rsvp1Res.body.ticketCode).toMatch(/^TKT-/);
    const ticketCode1 = rsvp1Res.body.ticketCode;

    // 4. Guest 2 attempts RSVP (capacity is full, must be rejected with 409 CONFLICT)
    const guest2 = new Client(t.app);
    const rsvp2Res = await guest2.post('/api/v1/public/events/exclusive-product-launch-2026/rsvp', {
      guestName: 'David Blogger',
      guestEmail: 'david@techblog.test',
      status: 'ACCEPTED',
      plusOneCount: 0,
    });
    expect(rsvp2Res.status).toBe(409);
    expect(rsvp2Res.body.code).toBe('CONFLICT');

    // 5. Check-in scanner: Admin scans Guest 1's ticket QR code
    const scan1 = await admin.post('/api/v1/events/checkin', {
      ticketCode: ticketCode1,
    });
    expect(scan1.status).toBe(200);
    expect(scan1.body.success).toBe(true);
    expect(scan1.body.alreadyCheckedIn).toBe(false);
    expect(scan1.body.rsvp.checkedInAt).not.toBeNull();

    // 6. Replay scan protection: re-scanning ticket must NOT double-count
    const scanReplay = await admin.post('/api/v1/events/checkin', {
      ticketCode: ticketCode1,
    });
    expect(scanReplay.status).toBe(200);
    expect(scanReplay.body.success).toBe(true);
    expect(scanReplay.body.alreadyCheckedIn).toBe(true);

    // 7. PR Package management: Create and ship a PR gift package
    const pkgRes = await admin.post('/api/v1/pr/packages', {
      title: 'Holiday VIP Gift Hamper',
      recipientName: 'Jessica Editor',
      recipientEmail: 'jessica@fashionmag.test',
      shippingAddress: '100 Media Blvd, Suite 500, New York, NY',
      trackingNumber: 'TRK-9876543210',
      carrier: 'DHL Express',
      status: 'SHIPPED',
      items: [
        { name: 'Branded Silk Robe', quantity: 1, sku: 'ROBE-BLK' },
        { name: 'Signature Fragrance 100ml', quantity: 1, sku: 'FRAG-100' },
      ],
      notes: 'Deliver before Friday gala.',
    });
    expect(pkgRes.status).toBe(201);
    expect(pkgRes.body.status).toBe('SHIPPED');
    expect(pkgRes.body.shippedAt).not.toBeNull();
    const pkgId = pkgRes.body.id;

    // 8. Update PR package to confirmed receipt
    const updatePkgRes = await admin.patch(`/api/v1/pr/packages/${pkgId}`, {
      status: 'CONFIRMED',
    });
    expect(updatePkgRes.status).toBe(200);
    expect(updatePkgRes.body.status).toBe('CONFIRMED');
    expect(updatePkgRes.body.receivedConfirmedAt).not.toBeNull();
  }, 90_000);
});


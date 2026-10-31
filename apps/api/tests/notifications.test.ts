import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, createTestApp, signInWithTwoFactor, type TestApp } from './helpers.js';

let t: TestApp;
let adminClient: Client;
let sentEmails: Array<{ to: string; subject: string; text: string }> = [];

beforeAll(async () => {
  sentEmails = [];
  t = await createTestApp(
    {
      EMAIL_PROVIDER: 'console',
      EMAIL_FROM: 'noreply@example.test',
      JOBS_ENABLED: 'false', // sync delivery to capture provider sends cleanly
    },
    {
      providers: {
        email: {
          name: 'mock',
          async send(message) {
            sentEmails.push(message);
          },
        },
      },
    },
  );
  adminClient = (await signInWithTwoFactor(t, 'admin_notif@example.test', 'super_admin')).client;
}, 60_000);

afterAll(async () => {
  if (t) await t.close();
});

describe('Email Notifications', () => {
  it('sends an email to the Super Admin when a new inquiry is submitted', async () => {
    sentEmails = [];
    const guest = new Client(t.app);
    const res = await guest.post('/api/v1/public/inquiries', {
      name: 'John Prospect',
      email: 'john@brand.test',
      subject: 'Brand Collaboration Inquiry',
      message: 'We would love to sponsor your upcoming video series.',
    });
    expect(res.status).toBe(201);

    // Verify email was sent to super admin
    const email = sentEmails.find((m) => m.subject.includes('Brand Collaboration Inquiry'));
    expect(email).toBeDefined();
    expect(email?.to).toBe('admin_notif@example.test');
    expect(email?.text).toContain('John Prospect');
    expect(email?.text).toContain('sponsor your upcoming video series');
  });

  it('sends an email to the Super Admin when a meeting is booked', async () => {
    sentEmails = [];
    const guest = new Client(t.app);
    const startTime = new Date(Date.now() + 86400 * 1000 * 10).toISOString();
    const endTime = new Date(Date.now() + 86400 * 1000 * 10 + 3600 * 1000).toISOString();

    const res = await guest.post('/api/v1/public/meetings/book', {
      title: 'Strategy Consultation',
      description: 'Discussing Q1 campaigns',
      guestName: 'Jane Partner',
      guestEmail: 'jane@agency.test',
      startTime,
      endTime,
    });
    expect(res.status).toBe(201);

    const email = sentEmails.find((m) => m.subject.includes('Strategy Consultation'));
    expect(email).toBeDefined();
    expect(email?.to).toBe('admin_notif@example.test');
    expect(email?.text).toContain('Jane Partner');
    expect(email?.text).toContain('jane@agency.test');
  });

  it('sends an email to ticket requester when staff posts a reply to a support ticket', async () => {
    sentEmails = [];
    // 1. Create a support ticket as adminClient
    const createRes = await adminClient.post('/api/v1/support/tickets', {
      subject: 'Issue with invoicing',
      category: 'PAYMENT',
      priority: 'HIGH',
      message: 'Need help resolving an invoice error.',
      requesterEmail: 'client_requester@example.test',
      requesterName: 'Client Requester',
    });
    expect(createRes.status).toBe(201);
    const ticketId = createRes.body.id;

    // 2. Post a reply
    const replyRes = await adminClient.post(`/api/v1/support/tickets/${ticketId}/replies`, {
      message: 'We have updated your invoice status. Please check again.',
      attachmentIds: [],
    });
    expect(replyRes.status).toBe(201);

    const email = sentEmails.find((m) => m.to === 'client_requester@example.test');
    expect(email).toBeDefined();
    expect(email?.subject).toContain('Issue with invoicing');
    expect(email?.text).toContain('We have updated your invoice status');
  });

  it('sends an RSVP confirmation email when a guest submits an RSVP', async () => {
    sentEmails = [];
    // 1. Create an event as adminClient
    const eventRes = await adminClient.post('/api/v1/events', {
      title: 'Creator Gala 2026',
      slug: `gala-${Date.now()}`,
      description: 'Annual creator meetup',
      venue: 'Metropolitan Hall',
      startDate: new Date(Date.now() + 86400 * 1000 * 20).toISOString(),
      endDate: new Date(Date.now() + 86400 * 1000 * 20 + 7200 * 1000).toISOString(),
      capacity: 100,
      isPublic: true,
      status: 'PUBLISHED',
    });
    expect(eventRes.status).toBe(201);
    const slug = eventRes.body.slug;

    // 2. Guest submits RSVP
    const guest = new Client(t.app);
    const rsvpRes = await guest.post(`/api/v1/public/events/${slug}/rsvp`, {
      guestName: 'Alex Creator',
      guestEmail: 'alex@creator.test',
      status: 'ACCEPTED',
      plusOneCount: 0,
      plusOneNames: [],
    });
    expect(rsvpRes.status).toBe(201);

    const email = sentEmails.find((m) => m.to === 'alex@creator.test');
    expect(email).toBeDefined();
    expect(email?.subject).toContain('Creator Gala 2026');
    expect(email?.text).toContain('Alex Creator');
    expect(email?.text).toContain(rsvpRes.body.ticketCode);
  });
});

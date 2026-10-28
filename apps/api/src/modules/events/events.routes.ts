import { Router } from 'express';
import { randomBytes } from 'node:crypto';
import {
  checkInResultSchema,
  checkInTicketSchema,
  createEventSchema,
  createPrInvitationSchema,
  createPrPackageSchema,
  createRsvpSchema,
  eventListQuerySchema,
  eventPageSchema,
  eventRsvpSchema,
  eventSchema,
  idParamSchema,
  okSchema,
  prInvitationListQuerySchema,
  prInvitationPageSchema,
  prInvitationSchema,
  prPackageListQuerySchema,
  prPackagePageSchema,
  prPackageSchema,
  rsvpListQuerySchema,
  rsvpPageSchema,
  updateEventSchema,
  updatePrInvitationSchema,
  updatePrPackageSchema,
  updateRsvpStatusSchema,
} from '@platform/shared-types';
import { z } from 'zod';
import type { Prisma } from '../../generated/prisma/client.js';
import { pageArgs, toPage } from '../../lib/pagination.js';
import { routeFactory, type RouteKit } from '../../lib/route.js';
import { scopeWhere, withScope } from '../../lib/scope.js';
import { sanitizeRichText } from '../../lib/sanitize.js';
import { errors } from '../../lib/errors.js';

export function eventsRoutes(kit: RouteKit): Router {
  const c = kit.c;
  const router = Router();
  const route = routeFactory(kit, router);

  // Helper for generating high-entropy QR ticket codes
  const generateTicketCode = () => `TKT-${randomBytes(8).toString('hex').toUpperCase()}`;

  // ───────────── Public Event Detail & RSVP ─────────────

  route(
    {
      method: 'get',
      path: '/api/v1/public/events/{slug}',
      operationId: 'getPublicEventBySlug',
      tags: ['Public', 'Events'],
      summary: 'Get public event details and RSVP capability',
      params: z.object({ slug: z.string().min(1) }),
      access: { type: 'public', reason: 'Allows public guests and invitees to view event details' },
      response: { status: 200, schema: eventSchema },
    },
    async ({ params }) => {
      const event = await c.db.event.findUnique({ where: { slug: params.slug } });
      if (!event || (!event.isPublic && event.status !== 'PUBLISHED')) {
        throw errors.notFound('Event not found');
      }

      return {
        id: event.id,
        slug: event.slug,
        title: event.title,
        description: event.description,
        venue: event.venue,
        locationUrl: event.locationUrl,
        startDate: event.startDate.toISOString(),
        endDate: event.endDate.toISOString(),
        dressCode: event.dressCode,
        capacity: event.capacity,
        currentAttendees: event.currentAttendees,
        allowPlusOnes: event.allowPlusOnes,
        isPublic: event.isPublic,
        status: event.status,
        coverFileId: event.coverFileId,
        assignedUserId: event.assignedUserId,
        createdAt: event.createdAt.toISOString(),
        updatedAt: event.updatedAt.toISOString(),
      };
    },
  );

  route(
    {
      method: 'post',
      path: '/api/v1/public/events/{slug}/rsvp',
      operationId: 'submitPublicEventRsvp',
      tags: ['Public', 'Events'],
      summary: 'Submit RSVP for an event with capacity enforcement and digital pass issuance',
      params: z.object({ slug: z.string().min(1) }),
      access: { type: 'public', reason: 'Public attendee RSVP submission' },
      csrf: false,
      body: createRsvpSchema,
      response: { status: 201, schema: eventRsvpSchema },
    },
    async ({ params, body }) => {
      const event = await c.db.event.findUnique({ where: { slug: params.slug } });
      if (!event || event.status !== 'PUBLISHED') {
        throw errors.notFound('Event not available for RSVP');
      }

      const totalRequesting = 1 + (body.plusOneCount ?? 0);

      // Check capacity
      if (body.status === 'ACCEPTED' && event.currentAttendees + totalRequesting > event.capacity) {
        throw errors.conflict('Event has reached full capacity');
      }

      const existingRsvp = await c.db.eventRsvp.findUnique({
        where: { eventId_guestEmail: { eventId: event.id, guestEmail: body.guestEmail.toLowerCase() } },
      });
      if (existingRsvp) {
        throw errors.conflict('An RSVP with this email already exists for this event');
      }

      const ticketCode = generateTicketCode();

      const rsvp = await c.db.$transaction(async (tx) => {
        const created = await tx.eventRsvp.create({
          data: {
            eventId: event.id,
            guestName: body.guestName,
            guestEmail: body.guestEmail.toLowerCase(),
            guestCompany: body.guestCompany,
            status: body.status,
            plusOneCount: body.plusOneCount,
            plusOneNames: body.plusOneNames,
            ticketCode,
          },
        });

        if (body.status === 'ACCEPTED') {
          await tx.event.update({
            where: { id: event.id },
            data: { currentAttendees: { increment: totalRequesting } },
          });
        }

        return created;
      });

      return {
        id: rsvp.id,
        eventId: rsvp.eventId,
        guestName: rsvp.guestName,
        guestEmail: rsvp.guestEmail,
        guestCompany: rsvp.guestCompany,
        status: rsvp.status,
        plusOneCount: rsvp.plusOneCount,
        plusOneNames: rsvp.plusOneNames,
        ticketCode: rsvp.ticketCode,
        checkedInAt: rsvp.checkedInAt ? rsvp.checkedInAt.toISOString() : null,
        checkedInBy: rsvp.checkedInBy,
        createdAt: rsvp.createdAt.toISOString(),
        updatedAt: rsvp.updatedAt.toISOString(),
      };
    },
  );

  // ───────────── Events Management ─────────────

  route(
    {
      method: 'get',
      path: '/api/v1/events',
      operationId: 'listEvents',
      tags: ['Events'],
      summary: 'List events with filters',
      access: { type: 'permission', permission: 'events.read' },
      query: eventListQuerySchema,
      response: { status: 200, schema: eventPageSchema },
    },
    async ({ query, auth, scope }) => {
      const scopeFilter = scopeWhere(scope, {
        userId: auth.user.id,
        ownField: 'assignedUserId',
        assigned: (userId) => ({ assignedUserId: userId }),
      });

      const finalWhere = withScope({}, scopeFilter) as Prisma.EventWhereInput;
      const rows = await c.db.event.findMany({
        where: finalWhere,
        orderBy: [{ startDate: 'asc' }, { id: 'asc' }],
        ...pageArgs(query),
      });

      return toPage(rows, query.limit, (e) => ({
        id: e.id,
        slug: e.slug,
        title: e.title,
        description: e.description,
        venue: e.venue,
        locationUrl: e.locationUrl,
        startDate: e.startDate.toISOString(),
        endDate: e.endDate.toISOString(),
        dressCode: e.dressCode,
        capacity: e.capacity,
        currentAttendees: e.currentAttendees,
        allowPlusOnes: e.allowPlusOnes,
        isPublic: e.isPublic,
        status: e.status,
        coverFileId: e.coverFileId,
        assignedUserId: e.assignedUserId,
        createdAt: e.createdAt.toISOString(),
        updatedAt: e.updatedAt.toISOString(),
      }));
    },
  );

  route(
    {
      method: 'post',
      path: '/api/v1/events',
      operationId: 'createEvent',
      tags: ['Events'],
      summary: 'Create a new event',
      access: { type: 'permission', permission: 'events.write' },
      body: createEventSchema,
      response: { status: 201, schema: eventSchema },
    },
    async ({ body, auth }) => {
      const exists = await c.db.event.findUnique({ where: { slug: body.slug } });
      if (exists) {
        throw errors.conflict('An event with this slug already exists');
      }

      const event = await c.db.event.create({
        data: {
          slug: body.slug,
          title: body.title,
          description: body.description ? sanitizeRichText(body.description) : body.description,
          venue: body.venue,
          locationUrl: body.locationUrl,
          startDate: new Date(body.startDate),
          endDate: new Date(body.endDate),
          dressCode: body.dressCode,
          capacity: body.capacity,
          allowPlusOnes: body.allowPlusOnes,
          isPublic: body.isPublic,
          status: body.status,
          coverFileId: body.coverFileId,
          assignedUserId: body.assignedUserId ?? auth.user.id,
        },
      });

      return {
        id: event.id,
        slug: event.slug,
        title: event.title,
        description: event.description,
        venue: event.venue,
        locationUrl: event.locationUrl,
        startDate: event.startDate.toISOString(),
        endDate: event.endDate.toISOString(),
        dressCode: event.dressCode,
        capacity: event.capacity,
        currentAttendees: event.currentAttendees,
        allowPlusOnes: event.allowPlusOnes,
        isPublic: event.isPublic,
        status: event.status,
        coverFileId: event.coverFileId,
        assignedUserId: event.assignedUserId,
        createdAt: event.createdAt.toISOString(),
        updatedAt: event.updatedAt.toISOString(),
      };
    },
  );

  // ───────────── Event Check-in & RSVPs ─────────────

  route(
    {
      method: 'get',
      path: '/api/v1/events/{id}/rsvps',
      operationId: 'listEventRsvps',
      tags: ['Events'],
      summary: 'List attendees and RSVPs for an event',
      params: idParamSchema,
      access: { type: 'permission', permission: 'events.read' },
      query: rsvpListQuerySchema,
      response: { status: 200, schema: rsvpPageSchema },
    },
    async ({ params, query }) => {
      const rows = await c.db.eventRsvp.findMany({
        where: { eventId: params.id },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        ...pageArgs(query),
      });

      return toPage(rows, query.limit, (r) => ({
        id: r.id,
        eventId: r.eventId,
        guestName: r.guestName,
        guestEmail: r.guestEmail,
        guestCompany: r.guestCompany,
        status: r.status,
        plusOneCount: r.plusOneCount,
        plusOneNames: r.plusOneNames,
        ticketCode: r.ticketCode,
        checkedInAt: r.checkedInAt ? r.checkedInAt.toISOString() : null,
        checkedInBy: r.checkedInBy,
        createdAt: r.createdAt.toISOString(),
        updatedAt: r.updatedAt.toISOString(),
      }));
    },
  );

  route(
    {
      method: 'post',
      path: '/api/v1/events/checkin',
      operationId: 'checkInAttendeeByTicket',
      tags: ['Events'],
      summary: 'Scan digital pass / ticket code with replay protection',
      description: 'Scans QR code ticket. Replayed scans do not double count.',
      access: { type: 'permission', permission: 'events.checkin' },
      body: checkInTicketSchema,
      response: { status: 200, schema: checkInResultSchema },
    },
    async ({ body, auth }) => {
      const rsvp = await c.db.eventRsvp.findUnique({
        where: { ticketCode: body.ticketCode },
      });

      if (!rsvp) {
        throw errors.notFound('Invalid ticket code');
      }

      if (rsvp.checkedInAt) {
        // Replayed scan: do not double-count, report already checked in
        return {
          success: true,
          alreadyCheckedIn: true,
          rsvp: {
            id: rsvp.id,
            eventId: rsvp.eventId,
            guestName: rsvp.guestName,
            guestEmail: rsvp.guestEmail,
            guestCompany: rsvp.guestCompany,
            status: rsvp.status,
            plusOneCount: rsvp.plusOneCount,
            plusOneNames: rsvp.plusOneNames,
            ticketCode: rsvp.ticketCode,
            checkedInAt: rsvp.checkedInAt.toISOString(),
            checkedInBy: rsvp.checkedInBy,
            createdAt: rsvp.createdAt.toISOString(),
            updatedAt: rsvp.updatedAt.toISOString(),
          },
        };
      }

      const updated = await c.db.eventRsvp.update({
        where: { id: rsvp.id },
        data: {
          checkedInAt: new Date(),
          checkedInBy: auth.user.name,
        },
      });

      return {
        success: true,
        alreadyCheckedIn: false,
        rsvp: {
          id: updated.id,
          eventId: updated.eventId,
          guestName: updated.guestName,
          guestEmail: updated.guestEmail,
          guestCompany: updated.guestCompany,
          status: updated.status,
          plusOneCount: updated.plusOneCount,
          plusOneNames: updated.plusOneNames,
          ticketCode: updated.ticketCode,
          checkedInAt: updated.checkedInAt ? updated.checkedInAt.toISOString() : null,
          checkedInBy: updated.checkedInBy,
          createdAt: updated.createdAt.toISOString(),
          updatedAt: updated.updatedAt.toISOString(),
        },
      };
    },
  );

  // ───────────── PR Packages ─────────────

  route(
    {
      method: 'get',
      path: '/api/v1/pr/packages',
      operationId: 'listPrPackages',
      tags: ['PR'],
      summary: 'List PR packages with shipping tracking',
      access: { type: 'permission', permission: 'pr.read' },
      query: prPackageListQuerySchema,
      response: { status: 200, schema: prPackagePageSchema },
    },
    async ({ query, auth, scope }) => {
      const scopeFilter = scopeWhere(scope, {
        userId: auth.user.id,
        ownField: 'assignedUserId',
        assigned: (userId) => ({ assignedUserId: userId }),
      });

      const finalWhere = withScope({}, scopeFilter) as Prisma.PrPackageWhereInput;
      const rows = await c.db.prPackage.findMany({
        where: finalWhere,
        orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
        ...pageArgs(query),
      });

      return toPage(rows, query.limit, (p) => ({
        id: p.id,
        title: p.title,
        recipientName: p.recipientName,
        recipientEmail: p.recipientEmail,
        shippingAddress: p.shippingAddress,
        trackingNumber: p.trackingNumber,
        carrier: p.carrier,
        status: p.status,
        shippedAt: p.shippedAt ? p.shippedAt.toISOString() : null,
        deliveredAt: p.deliveredAt ? p.deliveredAt.toISOString() : null,
        receivedConfirmedAt: p.receivedConfirmedAt ? p.receivedConfirmedAt.toISOString() : null,
        items: (p.items as never) ?? [],
        notes: p.notes,
        assignedUserId: p.assignedUserId,
        createdAt: p.createdAt.toISOString(),
        updatedAt: p.updatedAt.toISOString(),
      }));
    },
  );

  route(
    {
      method: 'post',
      path: '/api/v1/pr/packages',
      operationId: 'createPrPackage',
      tags: ['PR'],
      summary: 'Create a new PR package shipment',
      access: { type: 'permission', permission: 'pr.write' },
      body: createPrPackageSchema,
      response: { status: 201, schema: prPackageSchema },
    },
    async ({ body, auth }) => {
      const pkg = await c.db.prPackage.create({
        data: {
          title: body.title,
          recipientName: body.recipientName,
          recipientEmail: body.recipientEmail?.toLowerCase(),
          shippingAddress: body.shippingAddress,
          trackingNumber: body.trackingNumber,
          carrier: body.carrier,
          status: body.status,
          shippedAt: body.status === 'SHIPPED' ? new Date() : undefined,
          items: body.items as never,
          notes: body.notes ? sanitizeRichText(body.notes) : body.notes,
          assignedUserId: body.assignedUserId ?? auth.user.id,
        },
      });

      return {
        id: pkg.id,
        title: pkg.title,
        recipientName: pkg.recipientName,
        recipientEmail: pkg.recipientEmail,
        shippingAddress: pkg.shippingAddress,
        trackingNumber: pkg.trackingNumber,
        carrier: pkg.carrier,
        status: pkg.status,
        shippedAt: pkg.shippedAt ? pkg.shippedAt.toISOString() : null,
        deliveredAt: pkg.deliveredAt ? pkg.deliveredAt.toISOString() : null,
        receivedConfirmedAt: pkg.receivedConfirmedAt ? pkg.receivedConfirmedAt.toISOString() : null,
        items: (pkg.items as never) ?? [],
        notes: pkg.notes,
        assignedUserId: pkg.assignedUserId,
        createdAt: pkg.createdAt.toISOString(),
        updatedAt: pkg.updatedAt.toISOString(),
      };
    },
  );

  route(
    {
      method: 'patch',
      path: '/api/v1/pr/packages/{id}',
      operationId: 'updatePrPackage',
      tags: ['PR'],
      summary: 'Update PR package status, shipping tracking and delivery confirmation',
      params: idParamSchema,
      access: { type: 'permission', permission: 'pr.write' },
      body: updatePrPackageSchema,
      response: { status: 200, schema: prPackageSchema },
    },
    async ({ params, body }) => {
      const pkg = await c.db.prPackage.findUnique({ where: { id: params.id } });
      if (!pkg) {
        throw errors.notFound('PR package not found');
      }

      const updated = await c.db.prPackage.update({
        where: { id: pkg.id },
        data: {
          ...body,
          items: body.items ? (body.items as never) : undefined,
          notes: body.notes ? sanitizeRichText(body.notes) : body.notes,
          shippedAt: body.status === 'SHIPPED' && !pkg.shippedAt ? new Date() : undefined,
          deliveredAt: body.status === 'DELIVERED' && !pkg.deliveredAt ? new Date() : undefined,
          receivedConfirmedAt: body.status === 'CONFIRMED' && !pkg.receivedConfirmedAt ? new Date() : undefined,
        },
      });

      return {
        id: updated.id,
        title: updated.title,
        recipientName: updated.recipientName,
        recipientEmail: updated.recipientEmail,
        shippingAddress: updated.shippingAddress,
        trackingNumber: updated.trackingNumber,
        carrier: updated.carrier,
        status: updated.status,
        shippedAt: updated.shippedAt ? updated.shippedAt.toISOString() : null,
        deliveredAt: updated.deliveredAt ? updated.deliveredAt.toISOString() : null,
        receivedConfirmedAt: updated.receivedConfirmedAt ? updated.receivedConfirmedAt.toISOString() : null,
        items: (updated.items as never) ?? [],
        notes: updated.notes,
        assignedUserId: updated.assignedUserId,
        createdAt: updated.createdAt.toISOString(),
        updatedAt: updated.updatedAt.toISOString(),
      };
    },
  );

  // ───────────── PR Invitations ─────────────

  route(
    {
      method: 'get',
      path: '/api/v1/pr/invitations',
      operationId: 'listPrInvitations',
      tags: ['PR'],
      summary: 'List incoming and outgoing PR invitations',
      access: { type: 'permission', permission: 'pr.read' },
      query: prInvitationListQuerySchema,
      response: { status: 200, schema: prInvitationPageSchema },
    },
    async ({ query, auth, scope }) => {
      const scopeFilter = scopeWhere(scope, {
        userId: auth.user.id,
        ownField: 'assignedUserId',
        assigned: (userId) => ({ assignedUserId: userId }),
      });

      const finalWhere = withScope({}, scopeFilter) as Prisma.PrInvitationWhereInput;
      const rows = await c.db.prInvitation.findMany({
        where: finalWhere,
        orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
        ...pageArgs(query),
      });

      return toPage(rows, query.limit, (inv) => ({
        id: inv.id,
        brandOrEvent: inv.brandOrEvent,
        contactName: inv.contactName,
        contactEmail: inv.contactEmail,
        details: inv.details,
        date: inv.date ? inv.date.toISOString() : null,
        status: inv.status,
        responseNotes: inv.responseNotes,
        assignedUserId: inv.assignedUserId,
        createdAt: inv.createdAt.toISOString(),
        updatedAt: inv.updatedAt.toISOString(),
      }));
    },
  );

  route(
    {
      method: 'post',
      path: '/api/v1/pr/invitations',
      operationId: 'createPrInvitation',
      tags: ['PR'],
      summary: 'Log a new PR event invitation',
      access: { type: 'permission', permission: 'pr.write' },
      body: createPrInvitationSchema,
      response: { status: 201, schema: prInvitationSchema },
    },
    async ({ body, auth }) => {
      const inv = await c.db.prInvitation.create({
        data: {
          brandOrEvent: body.brandOrEvent,
          contactName: body.contactName,
          contactEmail: body.contactEmail.toLowerCase(),
          details: body.details ? sanitizeRichText(body.details) : body.details,
          date: body.date ? new Date(body.date) : undefined,
          status: body.status,
          responseNotes: body.responseNotes,
          assignedUserId: body.assignedUserId ?? auth.user.id,
        },
      });

      return {
        id: inv.id,
        brandOrEvent: inv.brandOrEvent,
        contactName: inv.contactName,
        contactEmail: inv.contactEmail,
        details: inv.details,
        date: inv.date ? inv.date.toISOString() : null,
        status: inv.status,
        responseNotes: inv.responseNotes,
        assignedUserId: inv.assignedUserId,
        createdAt: inv.createdAt.toISOString(),
        updatedAt: inv.updatedAt.toISOString(),
      };
    },
  );

  return router;
}

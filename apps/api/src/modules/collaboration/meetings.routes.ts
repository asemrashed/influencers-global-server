import { Router } from 'express';
import {
  availabilitySlotSchema,
  idParamSchema,
  meetingListQuerySchema,
  meetingPageSchema,
  meetingSchema,
  okSchema,
  rescheduleMeetingSchema,
  scheduleMeetingSchema,
  setAvailabilitySlotsSchema,
} from '@platform/shared-types';
import { z } from 'zod';
import type { Prisma } from '../../generated/prisma/client.js';
import { pageArgs, toPage } from '../../lib/pagination.js';
import { routeFactory, type RouteKit } from '../../lib/route.js';
import { scopeWhere, withScope } from '../../lib/scope.js';
import { errors } from '../../lib/errors.js';

export function meetingsRoutes(kit: RouteKit): Router {
  const c = kit.c;
  const router = Router();
  const route = routeFactory(kit, router);

  // Helper for detecting booking conflicts
  const hasConflict = async (start: Date, end: Date, excludeId?: string): Promise<boolean> => {
    const overlapping = await c.db.meeting.findFirst({
      where: {
        id: excludeId ? { not: excludeId } : undefined,
        status: { in: ['SCHEDULED', 'CONFIRMED'] },
        AND: [{ startTime: { lt: end } }, { endTime: { gt: start } }],
      },
    });
    return overlapping !== null;
  };

  // ───────────── Public Meeting Availability & Booking ─────────────

  route(
    {
      method: 'get',
      path: '/api/v1/public/meetings/slots',
      operationId: 'getPublicAvailabilitySlots',
      tags: ['Public', 'Meetings'],
      summary: 'Get active meeting availability time slots',
      access: { type: 'public', reason: 'Allows public guests and brands to view booking schedule' },
      response: { status: 200, schema: z.array(availabilitySlotSchema) },
    },
    async () => {
      const slots = await c.db.availabilitySlot.findMany({
        where: { isActive: true },
        orderBy: [{ dayOfWeek: 'asc' }, { startTime: 'asc' }],
      });
      return slots.map((s) => ({
        id: s.id,
        dayOfWeek: s.dayOfWeek,
        startTime: s.startTime,
        endTime: s.endTime,
        isActive: s.isActive,
      }));
    },
  );

  route(
    {
      method: 'post',
      path: '/api/v1/public/meetings/book',
      operationId: 'bookPublicMeeting',
      tags: ['Public', 'Meetings'],
      summary: 'Book a meeting slot with automated conflict detection',
      access: { type: 'public', reason: 'Public booking submission' },
      csrf: false,
      body: scheduleMeetingSchema,
      response: { status: 201, schema: meetingSchema },
    },
    async ({ body }) => {
      const start = new Date(body.startTime);
      const end = new Date(body.endTime);

      if (start >= end) {
        throw errors.validation([{ path: 'endTime', message: 'endTime must be after startTime' }]);
      }

      // Conflict check
      const conflict = await hasConflict(start, end);
      if (conflict) {
        throw errors.conflict('This time slot is already booked or conflicts with another meeting');
      }

      const meeting = await c.db.meeting.create({
        data: {
          title: body.title,
          description: body.description,
          guestName: body.guestName,
          guestEmail: body.guestEmail.toLowerCase(),
          startTime: start,
          endTime: end,
          meetingUrl: body.meetingUrl,
          status: 'SCHEDULED',
          assignedUserId: body.assignedUserId,
        },
      });

      return {
        id: meeting.id,
        title: meeting.title,
        description: meeting.description,
        guestName: meeting.guestName,
        guestEmail: meeting.guestEmail,
        startTime: meeting.startTime.toISOString(),
        endTime: meeting.endTime.toISOString(),
        meetingUrl: meeting.meetingUrl,
        status: meeting.status,
        assignedUserId: meeting.assignedUserId,
        createdAt: meeting.createdAt.toISOString(),
        updatedAt: meeting.updatedAt.toISOString(),
      };
    },
  );

  // ───────────── Authenticated Meetings Management ─────────────

  route(
    {
      method: 'get',
      path: '/api/v1/meetings',
      operationId: 'listMeetings',
      tags: ['Meetings'],
      summary: 'List meetings with status and date filters',
      access: { type: 'permission', permission: 'meetings.read' },
      query: meetingListQuerySchema,
      response: { status: 200, schema: meetingPageSchema },
    },
    async ({ query, auth, scope }) => {
      const scopeFilter = scopeWhere(scope, {
        userId: auth.user.id,
        ownField: 'assignedUserId',
        assigned: (userId) => ({ assignedUserId: userId }),
      });

      const where: Prisma.MeetingWhereInput = {
        ...(query.status ? { status: query.status } : {}),
        ...(query.assignedUserId ? { assignedUserId: query.assignedUserId } : {}),
        ...(query.from || query.to
          ? {
              startTime: {
                ...(query.from ? { gte: new Date(query.from) } : {}),
                ...(query.to ? { lte: new Date(query.to) } : {}),
              },
            }
          : {}),
      };

      const finalWhere = withScope(where as Record<string, unknown>, scopeFilter) as Prisma.MeetingWhereInput;
      const rows = await c.db.meeting.findMany({
        where: finalWhere,
        orderBy: [{ startTime: 'asc' }, { id: 'asc' }],
        ...pageArgs(query),
      });

      return toPage(rows, query.limit, (m) => ({
        id: m.id,
        title: m.title,
        description: m.description,
        guestName: m.guestName,
        guestEmail: m.guestEmail,
        startTime: m.startTime.toISOString(),
        endTime: m.endTime.toISOString(),
        meetingUrl: m.meetingUrl,
        status: m.status,
        assignedUserId: m.assignedUserId,
        createdAt: m.createdAt.toISOString(),
        updatedAt: m.updatedAt.toISOString(),
      }));
    },
  );

  route(
    {
      method: 'post',
      path: '/api/v1/meetings/{id}/confirm',
      operationId: 'confirmMeeting',
      tags: ['Meetings'],
      summary: 'Confirm a meeting',
      params: idParamSchema,
      access: { type: 'permission', permission: 'meetings.confirm' },
      response: { status: 200, schema: meetingSchema },
    },
    async ({ params }) => {
      const meeting = await c.db.meeting.findUnique({ where: { id: params.id } });
      if (!meeting) {
        throw errors.notFound('Meeting not found');
      }

      const updated = await c.db.meeting.update({
        where: { id: meeting.id },
        data: { status: 'CONFIRMED' },
      });

      return {
        id: updated.id,
        title: updated.title,
        description: updated.description,
        guestName: updated.guestName,
        guestEmail: updated.guestEmail,
        startTime: updated.startTime.toISOString(),
        endTime: updated.endTime.toISOString(),
        meetingUrl: updated.meetingUrl,
        status: updated.status,
        assignedUserId: updated.assignedUserId,
        createdAt: updated.createdAt.toISOString(),
        updatedAt: updated.updatedAt.toISOString(),
      };
    },
  );

  route(
    {
      method: 'post',
      path: '/api/v1/meetings/{id}/reschedule',
      operationId: 'rescheduleMeeting',
      tags: ['Meetings'],
      summary: 'Reschedule an existing meeting',
      params: idParamSchema,
      access: { type: 'permission', permission: 'meetings.write' },
      body: rescheduleMeetingSchema,
      response: { status: 200, schema: meetingSchema },
    },
    async ({ params, body }) => {
      const meeting = await c.db.meeting.findUnique({ where: { id: params.id } });
      if (!meeting) {
        throw errors.notFound('Meeting not found');
      }

      const start = new Date(body.startTime);
      const end = new Date(body.endTime);

      if (start >= end) {
        throw errors.validation([{ path: 'endTime', message: 'endTime must be after startTime' }]);
      }

      const conflict = await hasConflict(start, end, meeting.id);
      if (conflict) {
        throw errors.conflict('The new time slot conflicts with an existing confirmed meeting');
      }

      const updated = await c.db.meeting.update({
        where: { id: meeting.id },
        data: {
          startTime: start,
          endTime: end,
          status: 'RESCHEDULED',
        },
      });

      return {
        id: updated.id,
        title: updated.title,
        description: updated.description,
        guestName: updated.guestName,
        guestEmail: updated.guestEmail,
        startTime: updated.startTime.toISOString(),
        endTime: updated.endTime.toISOString(),
        meetingUrl: updated.meetingUrl,
        status: updated.status,
        assignedUserId: updated.assignedUserId,
        createdAt: updated.createdAt.toISOString(),
        updatedAt: updated.updatedAt.toISOString(),
      };
    },
  );

  route(
    {
      method: 'put',
      path: '/api/v1/meetings/slots',
      operationId: 'setAvailabilitySlots',
      tags: ['Meetings'],
      summary: 'Set available weekly booking slots',
      access: { type: 'permission', permission: 'meetings.write' },
      body: setAvailabilitySlotsSchema,
      response: { status: 200, schema: z.array(availabilitySlotSchema) },
    },
    async ({ body }) => {
      await c.db.$transaction(async (tx) => {
        await tx.availabilitySlot.deleteMany();
        for (const s of body.slots) {
          await tx.availabilitySlot.create({
            data: s,
          });
        }
      });

      const updatedSlots = await c.db.availabilitySlot.findMany({
        orderBy: [{ dayOfWeek: 'asc' }, { startTime: 'asc' }],
      });

      return updatedSlots.map((s) => ({
        id: s.id,
        dayOfWeek: s.dayOfWeek,
        startTime: s.startTime,
        endTime: s.endTime,
        isActive: s.isActive,
      }));
    },
  );

  return router;
}


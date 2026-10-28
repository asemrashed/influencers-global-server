import { Router } from 'express';
import {
  agreementSchema,
  campaignDetailSchema,
  campaignListQuerySchema,
  campaignPageSchema,
  campaignSchema,
  createCampaignSchema,
  createDeliverableSchema,
  createProposalSchema,
  deliverableSchema,
  idParamSchema,
  okSchema,
  proposalListQuerySchema,
  proposalPageSchema,
  proposalSchema,
  respondProposalSchema,
  reviewDeliverableSchema,
  submitDeliverableSchema,
  updateCampaignSchema,
  updateProposalSchema,
} from '@platform/shared-types';
import { z } from 'zod';
import type { Prisma } from '../../generated/prisma/client.js';
import { pageArgs, toPage } from '../../lib/pagination.js';
import { routeFactory, type RouteKit } from '../../lib/route.js';
import { scopeWhere, withScope } from '../../lib/scope.js';
import { sanitizeRichText } from '../../lib/sanitize.js';
import { errors } from '../../lib/errors.js';

export function collaborationRoutes(kit: RouteKit): Router {
  const c = kit.c;
  const router = Router();
  const route = routeFactory(kit, router);

  // ───────────── Proposals ─────────────

  route(
    {
      method: 'get',
      path: '/api/v1/proposals',
      operationId: 'listProposals',
      tags: ['Proposals'],
      summary: 'List collaboration proposals with negotiation status',
      access: { type: 'permission', permission: 'proposals.read' },
      query: proposalListQuerySchema,
      response: { status: 200, schema: proposalPageSchema },
    },
    async ({ query, auth, scope }) => {
      const scopeFilter = scopeWhere(scope, {
        userId: auth.user.id,
        ownField: 'createdById',
        assigned: (userId) => ({ assignedUserId: userId }),
      });

      const where: Prisma.ProposalWhereInput = {
        ...(query.status ? { status: query.status } : {}),
        ...(query.brandName ? { brandName: { contains: query.brandName, mode: 'insensitive' } } : {}),
        ...(query.search
          ? {
              OR: [
                { title: { contains: query.search, mode: 'insensitive' } },
                { brandName: { contains: query.search, mode: 'insensitive' } },
                { contactEmail: { contains: query.search, mode: 'insensitive' } },
              ],
            }
          : {}),
      };

      const finalWhere = withScope(where as Record<string, unknown>, scopeFilter) as Prisma.ProposalWhereInput;
      const rows = await c.db.proposal.findMany({
        where: finalWhere,
        orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
        ...pageArgs(query),
      });

      return toPage(rows, query.limit, (p) => ({
        id: p.id,
        title: p.title,
        brandName: p.brandName,
        contactEmail: p.contactEmail,
        objectives: p.objectives,
        deliverables: (p.deliverables as never) ?? [],
        compensationCents: p.compensationCents,
        currency: p.currency,
        terms: p.terms,
        status: p.status,
        statusHistory: (p.statusHistory as Record<string, unknown>[]) ?? [],
        createdById: p.createdById,
        assignedUserId: p.assignedUserId,
        createdAt: p.createdAt.toISOString(),
        updatedAt: p.updatedAt.toISOString(),
      }));
    },
  );

  route(
    {
      method: 'post',
      path: '/api/v1/proposals',
      operationId: 'createProposal',
      tags: ['Proposals'],
      summary: 'Create a new collaboration proposal',
      access: { type: 'permission', permission: 'proposals.write' },
      body: createProposalSchema,
      response: { status: 201, schema: proposalSchema },
    },
    async ({ body, auth }) => {
      const historyEntry = {
        from: null,
        to: 'DRAFT',
        timestamp: new Date().toISOString(),
        userId: auth.user.id,
      };

      const proposal = await c.db.proposal.create({
        data: {
          title: body.title,
          brandName: body.brandName,
          contactEmail: body.contactEmail.toLowerCase(),
          objectives: body.objectives ? sanitizeRichText(body.objectives) : body.objectives,
          deliverables: body.deliverables as never,
          compensationCents: body.compensationCents,
          currency: body.currency,
          terms: body.terms ? sanitizeRichText(body.terms) : body.terms,
          status: 'DRAFT',
          statusHistory: [historyEntry],
          createdById: auth.user.id,
          assignedUserId: body.assignedUserId,
        },
      });

      return {
        id: proposal.id,
        title: proposal.title,
        brandName: proposal.brandName,
        contactEmail: proposal.contactEmail,
        objectives: proposal.objectives,
        deliverables: (proposal.deliverables as never) ?? [],
        compensationCents: proposal.compensationCents,
        currency: proposal.currency,
        terms: proposal.terms,
        status: proposal.status,
        statusHistory: (proposal.statusHistory as Record<string, unknown>[]) ?? [],
        createdById: proposal.createdById,
        assignedUserId: proposal.assignedUserId,
        createdAt: proposal.createdAt.toISOString(),
        updatedAt: proposal.updatedAt.toISOString(),
      };
    },
  );

  route(
    {
      method: 'get',
      path: '/api/v1/proposals/{id}',
      operationId: 'getProposalById',
      tags: ['Proposals'],
      summary: 'Get proposal details and negotiation history',
      params: idParamSchema,
      access: { type: 'permission', permission: 'proposals.read' },
      response: { status: 200, schema: proposalSchema },
    },
    async ({ params, auth, scope }) => {
      const scopeFilter = scopeWhere(scope, {
        userId: auth.user.id,
        ownField: 'createdById',
        assigned: (userId) => ({ assignedUserId: userId }),
      });
      const finalWhere = withScope({ id: params.id }, scopeFilter) as Prisma.ProposalWhereInput;
      const proposal = await c.db.proposal.findFirst({ where: finalWhere });
      if (!proposal) {
        throw errors.notFound('Proposal not found');
      }

      return {
        id: proposal.id,
        title: proposal.title,
        brandName: proposal.brandName,
        contactEmail: proposal.contactEmail,
        objectives: proposal.objectives,
        deliverables: (proposal.deliverables as never) ?? [],
        compensationCents: proposal.compensationCents,
        currency: proposal.currency,
        terms: proposal.terms,
        status: proposal.status,
        statusHistory: (proposal.statusHistory as Record<string, unknown>[]) ?? [],
        createdById: proposal.createdById,
        assignedUserId: proposal.assignedUserId,
        createdAt: proposal.createdAt.toISOString(),
        updatedAt: proposal.updatedAt.toISOString(),
      };
    },
  );

  route(
    {
      method: 'post',
      path: '/api/v1/proposals/{id}/respond',
      operationId: 'respondToProposal',
      tags: ['Proposals'],
      summary: 'Accept or decline proposal (converts to campaign if accepted)',
      params: idParamSchema,
      access: { type: 'permission', permission: 'proposals.respond' },
      body: respondProposalSchema,
      response: { status: 200, schema: proposalSchema },
    },
    async ({ params, body, auth }) => {
      const proposal = await c.db.proposal.findUnique({ where: { id: params.id } });
      if (!proposal) {
        throw errors.notFound('Proposal not found');
      }

      const history = (proposal.statusHistory as Record<string, unknown>[]) ?? [];
      const newHistory = [
        ...history,
        {
          from: proposal.status,
          to: body.status,
          reason: body.reason,
          timestamp: new Date().toISOString(),
          userId: auth.user.id,
        },
      ];

      const updated = await c.db.$transaction(async (tx) => {
        const prop = await tx.proposal.update({
          where: { id: proposal.id },
          data: {
            status: body.status,
            statusHistory: newHistory as never,
          },
        });

        // If accepted, automatically instantiate the Campaign workspace
        if (body.status === 'ACCEPTED') {
          const existingCamp = await tx.campaign.findUnique({ where: { proposalId: prop.id } });
          if (!existingCamp) {
            const campaign = await tx.campaign.create({
              data: {
                proposalId: prop.id,
                name: prop.title,
                brandName: prop.brandName,
                status: 'PLANNING',
                budgetCents: prop.compensationCents,
                currency: prop.currency,
                assignedUserId: prop.assignedUserId,
              },
            });

            // Convert deliverables list into real Campaign Deliverables
            const delivs = (prop.deliverables as Array<{ title: string; platform?: string }>) ?? [];
            for (const d of delivs) {
              await tx.deliverable.create({
                data: {
                  campaignId: campaign.id,
                  title: d.title,
                  platform: d.platform,
                  status: 'PENDING',
                },
              });
            }
          }
        }

        return prop;
      });

      return {
        id: updated.id,
        title: updated.title,
        brandName: updated.brandName,
        contactEmail: updated.contactEmail,
        objectives: updated.objectives,
        deliverables: (updated.deliverables as never) ?? [],
        compensationCents: updated.compensationCents,
        currency: updated.currency,
        terms: updated.terms,
        status: updated.status,
        statusHistory: (updated.statusHistory as Record<string, unknown>[]) ?? [],
        createdById: updated.createdById,
        assignedUserId: updated.assignedUserId,
        createdAt: updated.createdAt.toISOString(),
        updatedAt: updated.updatedAt.toISOString(),
      };
    },
  );

  // ───────────── Campaigns & Workspaces ─────────────

  route(
    {
      method: 'get',
      path: '/api/v1/campaigns',
      operationId: 'listCampaigns',
      tags: ['Campaigns'],
      summary: 'List campaigns and workspaces',
      access: { type: 'permission', permission: 'campaigns.read' },
      query: campaignListQuerySchema,
      response: { status: 200, schema: campaignPageSchema },
    },
    async ({ query, auth, scope }) => {
      const scopeFilter = scopeWhere(scope, {
        userId: auth.user.id,
        ownField: 'assignedUserId',
        assigned: (userId) => ({ assignedUserId: userId }),
      });

      const where: Prisma.CampaignWhereInput = {
        ...(query.status ? { status: query.status } : {}),
        ...(query.brandName ? { brandName: { contains: query.brandName, mode: 'insensitive' } } : {}),
        ...(query.search
          ? {
              OR: [
                { name: { contains: query.search, mode: 'insensitive' } },
                { brandName: { contains: query.search, mode: 'insensitive' } },
              ],
            }
          : {}),
      };

      const finalWhere = withScope(where as Record<string, unknown>, scopeFilter) as Prisma.CampaignWhereInput;
      const rows = await c.db.campaign.findMany({
        where: finalWhere,
        orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
        ...pageArgs(query),
      });

      return toPage(rows, query.limit, (cRow) => ({
        id: cRow.id,
        proposalId: cRow.proposalId,
        name: cRow.name,
        brandName: cRow.brandName,
        status: cRow.status,
        startDate: cRow.startDate ? cRow.startDate.toISOString() : null,
        endDate: cRow.endDate ? cRow.endDate.toISOString() : null,
        budgetCents: cRow.budgetCents,
        currency: cRow.currency,
        briefContent: cRow.briefContent,
        assignedUserId: cRow.assignedUserId,
        createdAt: cRow.createdAt.toISOString(),
        updatedAt: cRow.updatedAt.toISOString(),
      }));
    },
  );

  route(
    {
      method: 'post',
      path: '/api/v1/campaigns',
      operationId: 'createCampaign',
      tags: ['Campaigns'],
      summary: 'Create a new campaign workspace',
      access: { type: 'permission', permission: 'campaigns.write' },
      body: createCampaignSchema,
      response: { status: 201, schema: campaignSchema },
    },
    async ({ body, auth }) => {
      const campaign = await c.db.campaign.create({
        data: {
          name: body.name,
          brandName: body.brandName,
          proposalId: body.proposalId,
          status: body.status,
          startDate: body.startDate ? new Date(body.startDate) : undefined,
          endDate: body.endDate ? new Date(body.endDate) : undefined,
          budgetCents: body.budgetCents,
          currency: body.currency,
          briefContent: body.briefContent ? sanitizeRichText(body.briefContent) : body.briefContent,
          assignedUserId: body.assignedUserId ?? auth.user.id,
        },
      });

      return {
        id: campaign.id,
        proposalId: campaign.proposalId,
        name: campaign.name,
        brandName: campaign.brandName,
        status: campaign.status,
        startDate: campaign.startDate ? campaign.startDate.toISOString() : null,
        endDate: campaign.endDate ? campaign.endDate.toISOString() : null,
        budgetCents: campaign.budgetCents,
        currency: campaign.currency,
        briefContent: campaign.briefContent,
        assignedUserId: campaign.assignedUserId,
        createdAt: campaign.createdAt.toISOString(),
        updatedAt: campaign.updatedAt.toISOString(),
      };
    },
  );

  route(
    {
      method: 'get',
      path: '/api/v1/campaigns/{id}',
      operationId: 'getCampaignById',
      tags: ['Campaigns'],
      summary: 'Get campaign workspace details with deliverables, tasks and agreements',
      params: idParamSchema,
      access: { type: 'permission', permission: 'campaigns.read' },
      response: { status: 200, schema: campaignDetailSchema },
    },
    async ({ params, auth, scope }) => {
      const scopeFilter = scopeWhere(scope, {
        userId: auth.user.id,
        ownField: 'assignedUserId',
        assigned: (userId) => ({ assignedUserId: userId }),
      });
      const finalWhere = withScope({ id: params.id }, scopeFilter) as Prisma.CampaignWhereInput;

      const campaign = await c.db.campaign.findFirst({
        where: finalWhere,
        include: {
          tasks: { orderBy: { createdAt: 'asc' } },
          deliverables: { orderBy: { createdAt: 'asc' } },
          agreements: { orderBy: { createdAt: 'asc' } },
        },
      });

      if (!campaign) {
        throw errors.notFound('Campaign not found');
      }

      return {
        id: campaign.id,
        proposalId: campaign.proposalId,
        name: campaign.name,
        brandName: campaign.brandName,
        status: campaign.status,
        startDate: campaign.startDate ? campaign.startDate.toISOString() : null,
        endDate: campaign.endDate ? campaign.endDate.toISOString() : null,
        budgetCents: campaign.budgetCents,
        currency: campaign.currency,
        briefContent: campaign.briefContent,
        assignedUserId: campaign.assignedUserId,
        createdAt: campaign.createdAt.toISOString(),
        updatedAt: campaign.updatedAt.toISOString(),
        tasks: campaign.tasks.map((t) => ({
          id: t.id,
          campaignId: t.campaignId,
          title: t.title,
          description: t.description,
          dueDate: t.dueDate ? t.dueDate.toISOString() : null,
          status: t.status,
          createdAt: t.createdAt.toISOString(),
          updatedAt: t.updatedAt.toISOString(),
        })),
        deliverables: campaign.deliverables.map((d) => ({
          id: d.id,
          campaignId: d.campaignId,
          title: d.title,
          description: d.description,
          platform: d.platform,
          assetFileIds: d.assetFileIds,
          externalUrl: d.externalUrl,
          status: d.status,
          feedback: d.feedback,
          dueDate: d.dueDate ? d.dueDate.toISOString() : null,
          submittedAt: d.submittedAt ? d.submittedAt.toISOString() : null,
          approvedAt: d.approvedAt ? d.approvedAt.toISOString() : null,
          createdAt: d.createdAt.toISOString(),
          updatedAt: d.updatedAt.toISOString(),
        })),
        agreements: campaign.agreements.map((a) => ({
          id: a.id,
          campaignId: a.campaignId,
          title: a.title,
          content: a.content,
          status: a.status,
          signatureData: a.signatureData,
          signedAt: a.signedAt ? a.signedAt.toISOString() : null,
          signerName: a.signerName,
          signerEmail: a.signerEmail,
          createdAt: a.createdAt.toISOString(),
          updatedAt: a.updatedAt.toISOString(),
        })),
      };
    },
  );

  // ───────────── Deliverables Lifecycle ─────────────

  route(
    {
      method: 'post',
      path: '/api/v1/campaigns/{id}/deliverables',
      operationId: 'createDeliverable',
      tags: ['Deliverables'],
      summary: 'Add a deliverable to a campaign',
      params: idParamSchema,
      access: { type: 'permission', permission: 'deliverables.submit' },
      body: createDeliverableSchema,
      response: { status: 201, schema: deliverableSchema },
    },
    async ({ params, body }) => {
      const campaign = await c.db.campaign.findUnique({ where: { id: params.id } });
      if (!campaign) {
        throw errors.notFound('Campaign not found');
      }

      const deliv = await c.db.deliverable.create({
        data: {
          campaignId: campaign.id,
          title: body.title,
          description: body.description,
          platform: body.platform,
          assetFileIds: body.assetFileIds,
          externalUrl: body.externalUrl,
          dueDate: body.dueDate ? new Date(body.dueDate) : undefined,
          status: 'PENDING',
        },
      });

      return {
        id: deliv.id,
        campaignId: deliv.campaignId,
        title: deliv.title,
        description: deliv.description,
        platform: deliv.platform,
        assetFileIds: deliv.assetFileIds,
        externalUrl: deliv.externalUrl,
        status: deliv.status,
        feedback: deliv.feedback,
        dueDate: deliv.dueDate ? deliv.dueDate.toISOString() : null,
        submittedAt: deliv.submittedAt ? deliv.submittedAt.toISOString() : null,
        approvedAt: deliv.approvedAt ? deliv.approvedAt.toISOString() : null,
        createdAt: deliv.createdAt.toISOString(),
        updatedAt: deliv.updatedAt.toISOString(),
      };
    },
  );

  route(
    {
      method: 'post',
      path: '/api/v1/deliverables/{id}/submit',
      operationId: 'submitDeliverable',
      tags: ['Deliverables'],
      summary: 'Submit assets or links for deliverable review',
      params: idParamSchema,
      access: { type: 'permission', permission: 'deliverables.submit' },
      body: submitDeliverableSchema,
      response: { status: 200, schema: deliverableSchema },
    },
    async ({ params, body }) => {
      const deliv = await c.db.deliverable.findUnique({ where: { id: params.id } });
      if (!deliv) {
        throw errors.notFound('Deliverable not found');
      }

      const updated = await c.db.deliverable.update({
        where: { id: deliv.id },
        data: {
          assetFileIds: body.assetFileIds,
          externalUrl: body.externalUrl,
          status: 'SUBMITTED',
          submittedAt: new Date(),
        },
      });

      return {
        id: updated.id,
        campaignId: updated.campaignId,
        title: updated.title,
        description: updated.description,
        platform: updated.platform,
        assetFileIds: updated.assetFileIds,
        externalUrl: updated.externalUrl,
        status: updated.status,
        feedback: updated.feedback,
        dueDate: updated.dueDate ? updated.dueDate.toISOString() : null,
        submittedAt: updated.submittedAt ? updated.submittedAt.toISOString() : null,
        approvedAt: updated.approvedAt ? updated.approvedAt.toISOString() : null,
        createdAt: updated.createdAt.toISOString(),
        updatedAt: updated.updatedAt.toISOString(),
      };
    },
  );

  route(
    {
      method: 'post',
      path: '/api/v1/deliverables/{id}/review',
      operationId: 'reviewDeliverable',
      tags: ['Deliverables'],
      summary: 'Review, approve, or request revisions on deliverable',
      params: idParamSchema,
      access: { type: 'permission', permission: 'deliverables.approve' },
      body: reviewDeliverableSchema,
      response: { status: 200, schema: deliverableSchema },
    },
    async ({ params, body }) => {
      const deliv = await c.db.deliverable.findUnique({ where: { id: params.id } });
      if (!deliv) {
        throw errors.notFound('Deliverable not found');
      }

      const updated = await c.db.deliverable.update({
        where: { id: deliv.id },
        data: {
          status: body.status,
          feedback: body.feedback,
          approvedAt: body.status === 'APPROVED' ? new Date() : null,
        },
      });

      return {
        id: updated.id,
        campaignId: updated.campaignId,
        title: updated.title,
        description: updated.description,
        platform: updated.platform,
        assetFileIds: updated.assetFileIds,
        externalUrl: updated.externalUrl,
        status: updated.status,
        feedback: updated.feedback,
        dueDate: updated.dueDate ? updated.dueDate.toISOString() : null,
        submittedAt: updated.submittedAt ? updated.submittedAt.toISOString() : null,
        approvedAt: updated.approvedAt ? updated.approvedAt.toISOString() : null,
        createdAt: updated.createdAt.toISOString(),
        updatedAt: updated.updatedAt.toISOString(),
      };
    },
  );

  return router;
}

import { Router } from 'express';
import {
  createPortfolioAlbumSchema,
  createPortfolioItemSchema,
  createRateCardItemSchema,
  idParamSchema,
  mediaKitSchema,
  pageOf,
  paginationQuerySchema,
  portfolioAlbumDetailSchema,
  portfolioAlbumPageSchema,
  portfolioAlbumSchema,
  portfolioItemSchema,
  profileSchema,
  publicProfileSchema,
  rateCardItemSchema,
  updateMediaKitSchema,
  updateProfileSchema,
} from '@platform/shared-types';
import { z } from 'zod';
import { pageArgs, toPage } from '../../lib/pagination.js';
import { routeFactory, type RouteKit } from '../../lib/route.js';
import { sanitizeRichText } from '../../lib/sanitize.js';
import { errors } from '../../lib/errors.js';

export function profileRoutes(kit: RouteKit): Router {
  const c = kit.c;
  const router = Router();
  const route = routeFactory(kit, router);

  // Helper to ensure a profile record exists
  const getOrCreateProfile = async () => {
    let p = await c.db.profile.findFirst();
    if (!p) {
      p = await c.db.profile.create({
        data: {
          fullName: 'Default Influencer',
          displayName: 'Influencer',
          bio: 'Welcome to my official profile.',
          tagline: 'Content Creator & Brand Ambassador',
          primaryNiche: 'Lifestyle',
          secondaryNiches: ['Fashion', 'Travel'],
          isPublic: true,
          languages: ['en'],
          socialLinks: [],
        },
      });
    }
    return p;
  };

  // ───────────── Public Endpoints ─────────────

  route(
    {
      method: 'get',
      path: '/api/v1/public/profile',
      operationId: 'getPublicProfile',
      tags: ['Public', 'Profile'],
      summary: 'Get public influencer profile',
      description: 'Returns the public information of the influencer (bio, niche, social links, booking allowance).',
      access: { type: 'public', reason: 'Public profile for visitors, fans and brands' },
      response: { status: 200, schema: publicProfileSchema },
    },
    async () => {
      const p = await getOrCreateProfile();
      if (!p.isPublic) {
        throw errors.notFound('Profile is private');
      }
      return {
        displayName: p.displayName,
        bio: p.bio,
        tagline: p.tagline,
        primaryNiche: p.primaryNiche,
        secondaryNiches: p.secondaryNiches,
        avatarFileId: p.avatarFileId,
        coverFileId: p.coverFileId,
        location: p.location,
        languages: p.languages,
        allowInquiries: p.allowInquiries,
        allowBookings: p.allowBookings,
        socialLinks: (p.socialLinks as never) ?? [],
      };
    },
  );

  route(
    {
      method: 'get',
      path: '/api/v1/public/portfolio/albums',
      operationId: 'listPublicPortfolioAlbums',
      tags: ['Public', 'Portfolio'],
      summary: 'List public portfolio albums',
      access: { type: 'public', reason: 'Public portfolio showcase' },
      query: paginationQuerySchema,
      response: { status: 200, schema: pageOf(portfolioAlbumSchema, 'PortfolioAlbumPage') },
    },
    async ({ query }) => {
      const albums = await c.db.portfolioAlbum.findMany({
        where: { isPublic: true },
        include: { _count: { select: { items: true } } },
        ...pageArgs(query),
        orderBy: [{ orderIndex: 'asc' }, { createdAt: 'desc' }, { id: 'desc' }],
      });
      return toPage(albums, query.limit, (a) => ({
        id: a.id,
        slug: a.slug,
        title: a.title,
        description: a.description,
        coverFileId: a.coverFileId,
        isPublic: a.isPublic,
        orderIndex: a.orderIndex,
        itemCount: a._count.items,
        createdAt: a.createdAt.toISOString(),
        updatedAt: a.updatedAt.toISOString(),
      }));
    },
  );

  route(
    {
      method: 'get',
      path: '/api/v1/public/portfolio/albums/{slug}',
      operationId: 'getPublicPortfolioAlbumBySlug',
      tags: ['Public', 'Portfolio'],
      summary: 'Get public portfolio album details and items',
      params: z.object({ slug: z.string().min(1) }),
      access: { type: 'public', reason: 'Public showcase album view' },
      response: { status: 200, schema: portfolioAlbumDetailSchema },
    },
    async ({ params }) => {
      const album = await c.db.portfolioAlbum.findUnique({
        where: { slug: params.slug },
        include: {
          items: { orderBy: [{ orderIndex: 'asc' }, { createdAt: 'desc' }] },
        },
      });
      if (!album || !album.isPublic) {
        throw errors.notFound('Album not found');
      }
      return {
        id: album.id,
        slug: album.slug,
        title: album.title,
        description: album.description,
        coverFileId: album.coverFileId,
        isPublic: album.isPublic,
        orderIndex: album.orderIndex,
        itemCount: album.items.length,
        createdAt: album.createdAt.toISOString(),
        updatedAt: album.updatedAt.toISOString(),
        items: album.items.map((i) => ({
          id: i.id,
          albumId: i.albumId,
          title: i.title,
          description: i.description,
          fileId: i.fileId,
          externalUrl: i.externalUrl,
          clientName: i.clientName,
          metrics: (i.metrics as Record<string, unknown> | null) ?? null,
          tags: i.tags,
          orderIndex: i.orderIndex,
          createdAt: i.createdAt.toISOString(),
          updatedAt: i.updatedAt.toISOString(),
        })),
      };
    },
  );

  // ───────────── Admin/Manager Authenticated Endpoints ─────────────

  route(
    {
      method: 'get',
      path: '/api/v1/profile',
      operationId: 'getProfile',
      tags: ['Profile'],
      summary: 'Get full influencer profile',
      access: { type: 'permission', permission: 'profile.read' },
      response: { status: 200, schema: profileSchema },
    },
    async () => {
      const p = await getOrCreateProfile();
      return {
        id: p.id,
        fullName: p.fullName,
        displayName: p.displayName,
        bio: p.bio,
        tagline: p.tagline,
        primaryNiche: p.primaryNiche,
        secondaryNiches: p.secondaryNiches,
        avatarFileId: p.avatarFileId,
        coverFileId: p.coverFileId,
        location: p.location,
        languages: p.languages,
        isPublic: p.isPublic,
        allowInquiries: p.allowInquiries,
        allowBookings: p.allowBookings,
        socialLinks: (p.socialLinks as never) ?? [],
        createdAt: p.createdAt.toISOString(),
        updatedAt: p.updatedAt.toISOString(),
      };
    },
  );

  route(
    {
      method: 'patch',
      path: '/api/v1/profile',
      operationId: 'updateProfile',
      tags: ['Profile'],
      summary: 'Update influencer profile',
      access: { type: 'permission', permission: 'profile.write' },
      body: updateProfileSchema,
      response: { status: 200, schema: profileSchema },
    },
    async ({ body }) => {
      const p = await getOrCreateProfile();
      const updated = await c.db.profile.update({
        where: { id: p.id },
        data: {
          ...body,
          bio: body.bio ? sanitizeRichText(body.bio) : body.bio,
          socialLinks: body.socialLinks ? (body.socialLinks as never) : undefined,
        },
      });
      return {
        id: updated.id,
        fullName: updated.fullName,
        displayName: updated.displayName,
        bio: updated.bio,
        tagline: updated.tagline,
        primaryNiche: updated.primaryNiche,
        secondaryNiches: updated.secondaryNiches,
        avatarFileId: updated.avatarFileId,
        coverFileId: updated.coverFileId,
        location: updated.location,
        languages: updated.languages,
        isPublic: updated.isPublic,
        allowInquiries: updated.allowInquiries,
        allowBookings: updated.allowBookings,
        socialLinks: (updated.socialLinks as never) ?? [],
        createdAt: updated.createdAt.toISOString(),
        updatedAt: updated.updatedAt.toISOString(),
      };
    },
  );

  // ───────────── Portfolio Management ─────────────

  route(
    {
      method: 'get',
      path: '/api/v1/portfolio/albums',
      operationId: 'listPortfolioAlbums',
      tags: ['Portfolio'],
      summary: 'List all portfolio albums (including private)',
      access: { type: 'permission', permission: 'profile.read' },
      query: paginationQuerySchema,
      response: { status: 200, schema: portfolioAlbumPageSchema },
    },
    async ({ query }) => {
      const rows = await c.db.portfolioAlbum.findMany({
        include: { _count: { select: { items: true } } },
        orderBy: [{ orderIndex: 'asc' }, { id: 'desc' }],
        ...pageArgs(query),
      });
      return toPage(rows, query.limit, (a) => ({
        id: a.id,
        slug: a.slug,
        title: a.title,
        description: a.description,
        coverFileId: a.coverFileId,
        isPublic: a.isPublic,
        orderIndex: a.orderIndex,
        itemCount: a._count.items,
        createdAt: a.createdAt.toISOString(),
        updatedAt: a.updatedAt.toISOString(),
      }));
    },
  );

  route(
    {
      method: 'post',
      path: '/api/v1/portfolio/albums',
      operationId: 'createPortfolioAlbum',
      tags: ['Portfolio'],
      summary: 'Create a new portfolio album',
      access: { type: 'permission', permission: 'portfolio.write' },
      body: createPortfolioAlbumSchema,
      response: { status: 201, schema: portfolioAlbumSchema },
    },
    async ({ body }) => {
      const exists = await c.db.portfolioAlbum.findUnique({ where: { slug: body.slug } });
      if (exists) {
        throw errors.conflict('An album with this slug already exists');
      }
      const album = await c.db.portfolioAlbum.create({
        data: body,
      });
      return {
        id: album.id,
        slug: album.slug,
        title: album.title,
        description: album.description,
        coverFileId: album.coverFileId,
        isPublic: album.isPublic,
        orderIndex: album.orderIndex,
        itemCount: 0,
        createdAt: album.createdAt.toISOString(),
        updatedAt: album.updatedAt.toISOString(),
      };
    },
  );

  route(
    {
      method: 'post',
      path: '/api/v1/portfolio/albums/{id}/items',
      operationId: 'createPortfolioItem',
      tags: ['Portfolio'],
      summary: 'Add an item to a portfolio album',
      params: idParamSchema,
      access: { type: 'permission', permission: 'portfolio.write' },
      body: createPortfolioItemSchema,
      response: { status: 201, schema: portfolioItemSchema },
    },
    async ({ params, body }) => {
      const album = await c.db.portfolioAlbum.findUnique({ where: { id: params.id } });
      if (!album) {
        throw errors.notFound('Album not found');
      }
      const item = await c.db.portfolioItem.create({
        data: {
          albumId: album.id,
          title: body.title,
          description: body.description ? sanitizeRichText(body.description) : body.description,
          fileId: body.fileId,
          externalUrl: body.externalUrl,
          clientName: body.clientName,
          metrics: body.metrics ? (body.metrics as never) : undefined,
          tags: body.tags,
          orderIndex: body.orderIndex,
        },
      });
      return {
        id: item.id,
        albumId: item.albumId,
        title: item.title,
        description: item.description,
        fileId: item.fileId,
        externalUrl: item.externalUrl,
        clientName: item.clientName,
        metrics: (item.metrics as Record<string, unknown> | null) ?? null,
        tags: item.tags,
        orderIndex: item.orderIndex,
        createdAt: item.createdAt.toISOString(),
        updatedAt: item.updatedAt.toISOString(),
      };
    },
  );

  // ───────────── Media Kit & Rate Card ─────────────

  route(
    {
      method: 'get',
      path: '/api/v1/media-kit',
      operationId: 'getMediaKit',
      tags: ['MediaKit'],
      summary: 'Get media kit details',
      access: { type: 'permission', permission: 'profile.read' },
      response: { status: 200, schema: mediaKitSchema },
    },
    async () => {
      let mk = await c.db.mediaKit.findFirst();
      if (!mk) {
        mk = await c.db.mediaKit.create({
          data: {
            title: 'Official Media Kit',
            summary: 'Audience statistics and service offerings.',
            statsSnapshot: {},
            services: [],
            isPublic: true,
          },
        });
      }
      return {
        id: mk.id,
        title: mk.title,
        summary: mk.summary,
        statsSnapshot: (mk.statsSnapshot as Record<string, unknown>) ?? {},
        services: (mk.services as unknown[]) ?? [],
        isPublic: mk.isPublic,
        pdfFileId: mk.pdfFileId,
        createdAt: mk.createdAt.toISOString(),
        updatedAt: mk.updatedAt.toISOString(),
      };
    },
  );

  route(
    {
      method: 'patch',
      path: '/api/v1/media-kit',
      operationId: 'updateMediaKit',
      tags: ['MediaKit'],
      summary: 'Update media kit details',
      access: { type: 'permission', permission: 'profile.write' },
      body: updateMediaKitSchema,
      response: { status: 200, schema: mediaKitSchema },
    },
    async ({ body }) => {
      let mk = await c.db.mediaKit.findFirst();
      if (!mk) {
        mk = await c.db.mediaKit.create({
          data: {
            title: body.title ?? 'Official Media Kit',
            summary: body.summary,
            statsSnapshot: (body.statsSnapshot as never) ?? {},
            services: (body.services as never) ?? [],
            isPublic: body.isPublic ?? true,
            pdfFileId: body.pdfFileId,
          },
        });
      } else {
        mk = await c.db.mediaKit.update({
          where: { id: mk.id },
          data: {
            ...body,
            summary: body.summary ? sanitizeRichText(body.summary) : body.summary,
            statsSnapshot: body.statsSnapshot ? (body.statsSnapshot as never) : undefined,
            services: body.services ? (body.services as never) : undefined,
          },
        });
      }
      return {
        id: mk.id,
        title: mk.title,
        summary: mk.summary,
        statsSnapshot: (mk.statsSnapshot as Record<string, unknown>) ?? {},
        services: (mk.services as unknown[]) ?? [],
        isPublic: mk.isPublic,
        pdfFileId: mk.pdfFileId,
        createdAt: mk.createdAt.toISOString(),
        updatedAt: mk.updatedAt.toISOString(),
      };
    },
  );

  route(
    {
      method: 'get',
      path: '/api/v1/rate-card',
      operationId: 'listRateCardItems',
      tags: ['RateCard'],
      summary: 'List rate card pricing items',
      access: { type: 'permission', permission: 'profile.read' },
      response: { status: 200, schema: z.array(rateCardItemSchema) },
    },
    async () => {
      const items = await c.db.rateCardItem.findMany({
        orderBy: [{ orderIndex: 'asc' }, { id: 'asc' }],
      });
      return items.map((i) => ({
        id: i.id,
        serviceName: i.serviceName,
        description: i.description,
        deliverables: i.deliverables,
        priceCents: i.priceCents,
        currency: i.currency,
        isPublic: i.isPublic,
        orderIndex: i.orderIndex,
        createdAt: i.createdAt.toISOString(),
        updatedAt: i.updatedAt.toISOString(),
      }));
    },
  );

  route(
    {
      method: 'post',
      path: '/api/v1/rate-card',
      operationId: 'createRateCardItem',
      tags: ['RateCard'],
      summary: 'Add a new rate card item',
      access: { type: 'permission', permission: 'profile.write' },
      body: createRateCardItemSchema,
      response: { status: 201, schema: rateCardItemSchema },
    },
    async ({ body }) => {
      const item = await c.db.rateCardItem.create({
        data: {
          ...body,
          description: body.description ? sanitizeRichText(body.description) : body.description,
        },
      });
      return {
        id: item.id,
        serviceName: item.serviceName,
        description: item.description,
        deliverables: item.deliverables,
        priceCents: item.priceCents,
        currency: item.currency,
        isPublic: item.isPublic,
        orderIndex: item.orderIndex,
        createdAt: item.createdAt.toISOString(),
        updatedAt: item.updatedAt.toISOString(),
      };
    },
  );

  return router;
}

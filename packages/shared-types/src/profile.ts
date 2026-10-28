import { z } from 'zod';
import { pageOf } from './common.js';

// ───────────── Profile ─────────────

export const socialLinkSchema = z.object({
  platform: z.string().min(1).max(50),
  url: z.string().url().max(500),
  handle: z.string().min(1).max(100),
  followerCount: z.number().int().nonnegative().optional(),
});
export type SocialLink = z.infer<typeof socialLinkSchema>;

export const profileSchema = z.object({
  id: z.string(),
  fullName: z.string(),
  displayName: z.string(),
  bio: z.string().nullable(),
  tagline: z.string().nullable(),
  primaryNiche: z.string(),
  secondaryNiches: z.array(z.string()),
  avatarFileId: z.string().nullable(),
  coverFileId: z.string().nullable(),
  location: z.string().nullable(),
  languages: z.array(z.string()),
  isPublic: z.boolean(),
  allowInquiries: z.boolean(),
  allowBookings: z.boolean(),
  socialLinks: z.array(socialLinkSchema),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ProfileDto = z.infer<typeof profileSchema>;

export const updateProfileSchema = z.object({
  fullName: z.string().min(1).max(100).optional(),
  displayName: z.string().min(1).max(100).optional(),
  bio: z.string().max(5000).nullable().optional(),
  tagline: z.string().max(200).nullable().optional(),
  primaryNiche: z.string().min(1).max(100).optional(),
  secondaryNiches: z.array(z.string().max(50)).max(10).optional(),
  avatarFileId: z.string().nullable().optional(),
  coverFileId: z.string().nullable().optional(),
  location: z.string().max(100).nullable().optional(),
  languages: z.array(z.string().max(50)).max(10).optional(),
  isPublic: z.boolean().optional(),
  allowInquiries: z.boolean().optional(),
  allowBookings: z.boolean().optional(),
  socialLinks: z.array(socialLinkSchema).max(20).optional(),
});
export type UpdateProfileDto = z.infer<typeof updateProfileSchema>;

// Public profile representation (omitting internal or private settings if isPublic=false)
export const publicProfileSchema = z.object({
  displayName: z.string(),
  bio: z.string().nullable(),
  tagline: z.string().nullable(),
  primaryNiche: z.string(),
  secondaryNiches: z.array(z.string()),
  avatarFileId: z.string().nullable(),
  coverFileId: z.string().nullable(),
  location: z.string().nullable(),
  languages: z.array(z.string()),
  allowInquiries: z.boolean(),
  allowBookings: z.boolean(),
  socialLinks: z.array(socialLinkSchema),
});
export type PublicProfileDto = z.infer<typeof publicProfileSchema>;

// ───────────── Portfolio ─────────────

export const portfolioItemSchema = z.object({
  id: z.string(),
  albumId: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  fileId: z.string().nullable(),
  externalUrl: z.string().nullable(),
  clientName: z.string().nullable(),
  metrics: z.record(z.string(), z.unknown()).nullable(),
  tags: z.array(z.string()),
  orderIndex: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type PortfolioItemDto = z.infer<typeof portfolioItemSchema>;

export const createPortfolioItemSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(3000).nullable().optional(),
  fileId: z.string().nullable().optional(),
  externalUrl: z.string().url().max(500).nullable().optional(),
  clientName: z.string().max(100).nullable().optional(),
  metrics: z.record(z.string(), z.unknown()).nullable().optional(),
  tags: z.array(z.string().max(50)).max(10).default([]),
  orderIndex: z.number().int().default(0),
});
export type CreatePortfolioItemDto = z.infer<typeof createPortfolioItemSchema>;

export const portfolioAlbumSchema = z.object({
  id: z.string(),
  slug: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  coverFileId: z.string().nullable(),
  isPublic: z.boolean(),
  orderIndex: z.number().int(),
  itemCount: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type PortfolioAlbumDto = z.infer<typeof portfolioAlbumSchema>;

export const createPortfolioAlbumSchema = z.object({
  slug: z.string().min(2).max(100).regex(/^[a-z0-9-]+$/),
  title: z.string().min(1).max(150),
  description: z.string().max(2000).nullable().optional(),
  coverFileId: z.string().nullable().optional(),
  isPublic: z.boolean().default(true),
  orderIndex: z.number().int().default(0),
});
export type CreatePortfolioAlbumDto = z.infer<typeof createPortfolioAlbumSchema>;

export const portfolioAlbumDetailSchema = portfolioAlbumSchema.extend({
  items: z.array(portfolioItemSchema),
});
export type PortfolioAlbumDetailDto = z.infer<typeof portfolioAlbumDetailSchema>;

export const portfolioAlbumPageSchema = pageOf(portfolioAlbumSchema, 'PortfolioAlbumPage');

// ───────────── Media Kit & Rate Card ─────────────

export const mediaKitSchema = z.object({
  id: z.string(),
  title: z.string(),
  summary: z.string().nullable(),
  statsSnapshot: z.record(z.string(), z.unknown()),
  services: z.array(z.unknown()),
  isPublic: z.boolean(),
  pdfFileId: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type MediaKitDto = z.infer<typeof mediaKitSchema>;

export const updateMediaKitSchema = z.object({
  title: z.string().min(1).max(150).optional(),
  summary: z.string().max(3000).nullable().optional(),
  statsSnapshot: z.record(z.string(), z.unknown()).optional(),
  services: z.array(z.unknown()).optional(),
  isPublic: z.boolean().optional(),
  pdfFileId: z.string().nullable().optional(),
});
export type UpdateMediaKitDto = z.infer<typeof updateMediaKitSchema>;

export const rateCardItemSchema = z.object({
  id: z.string(),
  serviceName: z.string(),
  description: z.string().nullable(),
  deliverables: z.array(z.string()),
  priceCents: z.number().int().nonnegative(),
  currency: z.string(),
  isPublic: z.boolean(),
  orderIndex: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type RateCardItemDto = z.infer<typeof rateCardItemSchema>;

export const createRateCardItemSchema = z.object({
  serviceName: z.string().min(1).max(100),
  description: z.string().max(1000).nullable().optional(),
  deliverables: z.array(z.string().max(100)).max(20).default([]),
  priceCents: z.number().int().nonnegative(),
  currency: z.string().min(3).max(3).default('USD'),
  isPublic: z.boolean().default(true),
  orderIndex: z.number().int().default(0),
});
export type CreateRateCardItemDto = z.infer<typeof createRateCardItemSchema>;

-- Migration for Phase 5: Social Accounts, Follower Snapshots, Content Drafts & Publishing

CREATE TYPE "SocialPlatform" AS ENUM ('INSTAGRAM', 'FACEBOOK', 'TIKTOK', 'YOUTUBE', 'LINKEDIN', 'TELEGRAM', 'TWITTER_X');
CREATE TYPE "ConnectionStatus" AS ENUM ('CONNECTED', 'EXPIRED', 'DISCONNECTED', 'ERROR');
CREATE TYPE "MetricSource" AS ENUM ('SYNCED', 'MANUAL');
CREATE TYPE "ContentStatus" AS ENUM ('IDEA', 'DRAFT', 'SCHEDULED', 'PUBLISHED', 'FAILED');

-- SocialAccount
CREATE TABLE "SocialAccount" (
    "id" TEXT NOT NULL,
    "platform" "SocialPlatform" NOT NULL,
    "accountHandle" TEXT NOT NULL,
    "displayName" TEXT,
    "encryptedTokens" TEXT NOT NULL,
    "scopes" TEXT[],
    "status" "ConnectionStatus" NOT NULL DEFAULT 'CONNECTED',
    "followerCount" INTEGER NOT NULL DEFAULT 0,
    "isStale" BOOLEAN NOT NULL DEFAULT false,
    "lastSyncedAt" TIMESTAMP(3),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SocialAccount_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SocialAccount_platform_accountHandle_key" ON "SocialAccount"("platform", "accountHandle");
CREATE INDEX "SocialAccount_status_idx" ON "SocialAccount"("status");

-- FollowerSnapshot
CREATE TABLE "FollowerSnapshot" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "followerCount" INTEGER NOT NULL,
    "source" "MetricSource" NOT NULL DEFAULT 'SYNCED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FollowerSnapshot_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "FollowerSnapshot_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "SocialAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "FollowerSnapshot_accountId_date_idx" ON "FollowerSnapshot"("accountId", "date");

-- ContentDraft
CREATE TABLE "ContentDraft" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "caption" TEXT,
    "hashtags" TEXT[],
    "platforms" "SocialPlatform"[],
    "mediaFileIds" TEXT[],
    "scheduledFor" TIMESTAMP(3),
    "publishedAt" TIMESTAMP(3),
    "status" "ContentStatus" NOT NULL DEFAULT 'DRAFT',
    "publishError" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ContentDraft_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ContentDraft_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "ContentDraft_status_idx" ON "ContentDraft"("status");
CREATE INDEX "ContentDraft_scheduledFor_idx" ON "ContentDraft"("scheduledFor");
CREATE INDEX "ContentDraft_createdById_idx" ON "ContentDraft"("createdById");


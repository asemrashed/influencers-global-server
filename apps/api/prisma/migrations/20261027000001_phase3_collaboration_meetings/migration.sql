-- Migration for Phase 3: Collaboration, Proposals, Campaigns, Deliverables, Agreements, Meetings & Scheduling

CREATE TYPE "ProposalStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'ACCEPTED', 'DECLINED', 'EXPIRED');
CREATE TYPE "CampaignStatus" AS ENUM ('PLANNING', 'ACTIVE', 'IN_REVIEW', 'COMPLETED', 'CANCELLED');
CREATE TYPE "TaskStatus" AS ENUM ('TODO', 'IN_PROGRESS', 'DONE');
CREATE TYPE "DeliverableStatus" AS ENUM ('PENDING', 'SUBMITTED', 'REVISION_REQUESTED', 'APPROVED', 'REJECTED');
CREATE TYPE "AgreementStatus" AS ENUM ('DRAFT', 'PENDING_SIGNATURE', 'SIGNED', 'EXPIRED');
CREATE TYPE "MeetingStatus" AS ENUM ('SCHEDULED', 'CONFIRMED', 'RESCHEDULED', 'COMPLETED', 'CANCELLED');

-- Proposal
CREATE TABLE "Proposal" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "brandName" TEXT NOT NULL,
    "contactEmail" TEXT NOT NULL,
    "objectives" TEXT,
    "deliverables" JSONB NOT NULL DEFAULT '[]',
    "compensationCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "terms" TEXT,
    "status" "ProposalStatus" NOT NULL DEFAULT 'DRAFT',
    "statusHistory" JSONB NOT NULL DEFAULT '[]',
    "createdById" TEXT,
    "assignedUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Proposal_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Proposal_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "Proposal_status_idx" ON "Proposal"("status");
CREATE INDEX "Proposal_brandName_idx" ON "Proposal"("brandName");
CREATE INDEX "Proposal_createdById_idx" ON "Proposal"("createdById");

-- Campaign
CREATE TABLE "Campaign" (
    "id" TEXT NOT NULL,
    "proposalId" TEXT,
    "name" TEXT NOT NULL,
    "brandName" TEXT NOT NULL,
    "status" "CampaignStatus" NOT NULL DEFAULT 'PLANNING',
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "budgetCents" INTEGER NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "briefContent" TEXT,
    "assignedUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Campaign_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Campaign_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "Proposal"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Campaign_assignedUserId_fkey" FOREIGN KEY ("assignedUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "Campaign_proposalId_key" ON "Campaign"("proposalId");
CREATE INDEX "Campaign_status_idx" ON "Campaign"("status");
CREATE INDEX "Campaign_brandName_idx" ON "Campaign"("brandName");
CREATE INDEX "Campaign_assignedUserId_idx" ON "Campaign"("assignedUserId");

-- CampaignTask
CREATE TABLE "CampaignTask" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "dueDate" TIMESTAMP(3),
    "status" "TaskStatus" NOT NULL DEFAULT 'TODO',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CampaignTask_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "CampaignTask_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "CampaignTask_campaignId_idx" ON "CampaignTask"("campaignId");

-- Deliverable
CREATE TABLE "Deliverable" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "platform" TEXT,
    "assetFileIds" TEXT[],
    "externalUrl" TEXT,
    "status" "DeliverableStatus" NOT NULL DEFAULT 'PENDING',
    "feedback" TEXT,
    "dueDate" TIMESTAMP(3),
    "submittedAt" TIMESTAMP(3),
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Deliverable_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Deliverable_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "Deliverable_campaignId_idx" ON "Deliverable"("campaignId");
CREATE INDEX "Deliverable_status_idx" ON "Deliverable"("status");

-- Agreement
CREATE TABLE "Agreement" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "status" "AgreementStatus" NOT NULL DEFAULT 'DRAFT',
    "signatureData" TEXT,
    "signedAt" TIMESTAMP(3),
    "signerName" TEXT,
    "signerEmail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Agreement_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Agreement_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "Agreement_campaignId_idx" ON "Agreement"("campaignId");
CREATE INDEX "Agreement_status_idx" ON "Agreement"("status");

-- Meeting
CREATE TABLE "Meeting" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "guestName" TEXT NOT NULL,
    "guestEmail" TEXT NOT NULL,
    "startTime" TIMESTAMP(3) NOT NULL,
    "endTime" TIMESTAMP(3) NOT NULL,
    "meetingUrl" TEXT,
    "status" "MeetingStatus" NOT NULL DEFAULT 'SCHEDULED',
    "assignedUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Meeting_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Meeting_assignedUserId_fkey" FOREIGN KEY ("assignedUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "Meeting_startTime_endTime_idx" ON "Meeting"("startTime", "endTime");
CREATE INDEX "Meeting_status_idx" ON "Meeting"("status");
CREATE INDEX "Meeting_assignedUserId_idx" ON "Meeting"("assignedUserId");

-- AvailabilitySlot
CREATE TABLE "AvailabilitySlot" (
    "id" TEXT NOT NULL,
    "dayOfWeek" INTEGER NOT NULL,
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AvailabilitySlot_pkey" PRIMARY KEY ("id")
);


-- Migration for Phase 4: Events, RSVPs, Digital Passes, PR Packages & PR Invitations

CREATE TYPE "EventStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'CANCELLED', 'COMPLETED');
CREATE TYPE "RsvpStatus" AS ENUM ('INVITED', 'ACCEPTED', 'DECLINED', 'WAITLISTED');
CREATE TYPE "PrPackageStatus" AS ENUM ('PREPARING', 'SHIPPED', 'IN_TRANSIT', 'DELIVERED', 'CONFIRMED', 'CANCELLED');
CREATE TYPE "PrInvitationStatus" AS ENUM ('SENT', 'ACCEPTED', 'DECLINED', 'CANCELLED');

-- Event
CREATE TABLE "Event" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "venue" TEXT NOT NULL,
    "locationUrl" TEXT,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "dressCode" TEXT,
    "capacity" INTEGER NOT NULL,
    "currentAttendees" INTEGER NOT NULL DEFAULT 0,
    "allowPlusOnes" BOOLEAN NOT NULL DEFAULT false,
    "isPublic" BOOLEAN NOT NULL DEFAULT false,
    "status" "EventStatus" NOT NULL DEFAULT 'DRAFT',
    "coverFileId" TEXT,
    "assignedUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Event_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Event_assignedUserId_fkey" FOREIGN KEY ("assignedUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "Event_slug_key" ON "Event"("slug");
CREATE INDEX "Event_status_idx" ON "Event"("status");
CREATE INDEX "Event_startDate_idx" ON "Event"("startDate");
CREATE INDEX "Event_assignedUserId_idx" ON "Event"("assignedUserId");

-- EventRsvp
CREATE TABLE "EventRsvp" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "guestName" TEXT NOT NULL,
    "guestEmail" TEXT NOT NULL,
    "guestCompany" TEXT,
    "status" "RsvpStatus" NOT NULL DEFAULT 'INVITED',
    "plusOneCount" INTEGER NOT NULL DEFAULT 0,
    "plusOneNames" TEXT[],
    "ticketCode" TEXT NOT NULL,
    "checkedInAt" TIMESTAMP(3),
    "checkedInBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "EventRsvp_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "EventRsvp_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "EventRsvp_ticketCode_key" ON "EventRsvp"("ticketCode");
CREATE UNIQUE INDEX "EventRsvp_eventId_guestEmail_key" ON "EventRsvp"("eventId", "guestEmail");
CREATE INDEX "EventRsvp_eventId_idx" ON "EventRsvp"("eventId");
CREATE INDEX "EventRsvp_guestEmail_idx" ON "EventRsvp"("guestEmail");
CREATE INDEX "EventRsvp_ticketCode_idx" ON "EventRsvp"("ticketCode");

-- PrPackage
CREATE TABLE "PrPackage" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "recipientName" TEXT NOT NULL,
    "recipientEmail" TEXT,
    "shippingAddress" TEXT NOT NULL,
    "trackingNumber" TEXT,
    "carrier" TEXT,
    "status" "PrPackageStatus" NOT NULL DEFAULT 'PREPARING',
    "shippedAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "receivedConfirmedAt" TIMESTAMP(3),
    "items" JSONB NOT NULL DEFAULT '[]',
    "notes" TEXT,
    "assignedUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PrPackage_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "PrPackage_assignedUserId_fkey" FOREIGN KEY ("assignedUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "PrPackage_status_idx" ON "PrPackage"("status");
CREATE INDEX "PrPackage_trackingNumber_idx" ON "PrPackage"("trackingNumber");
CREATE INDEX "PrPackage_assignedUserId_idx" ON "PrPackage"("assignedUserId");

-- PrInvitation
CREATE TABLE "PrInvitation" (
    "id" TEXT NOT NULL,
    "brandOrEvent" TEXT NOT NULL,
    "contactName" TEXT NOT NULL,
    "contactEmail" TEXT NOT NULL,
    "details" TEXT,
    "date" TIMESTAMP(3),
    "status" "PrInvitationStatus" NOT NULL DEFAULT 'SENT',
    "responseNotes" TEXT,
    "assignedUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PrInvitation_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "PrInvitation_assignedUserId_fkey" FOREIGN KEY ("assignedUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "PrInvitation_status_idx" ON "PrInvitation"("status");
CREATE INDEX "PrInvitation_assignedUserId_idx" ON "PrInvitation"("assignedUserId");


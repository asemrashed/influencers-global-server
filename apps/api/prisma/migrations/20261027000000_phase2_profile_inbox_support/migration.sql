-- Migration for Phase 2: Profile, Portfolio, MediaKit, RateCard, Contacts, ManagerAssignment, Inbox, Notifications, SupportTickets

-- Enums
CREATE TYPE "AssignmentType" AS ENUM ('BRAND', 'CAMPAIGN', 'PR');
CREATE TYPE "ThreadType" AS ENUM ('PUBLIC_INQUIRY', 'COLLABORATION', 'SUPPORT', 'DIRECT');
CREATE TYPE "ThreadStatus" AS ENUM ('OPEN', 'WAITING', 'CLOSED', 'ARCHIVED');
CREATE TYPE "TicketCategory" AS ENUM ('ACCOUNT', 'EVENT', 'PAYMENT', 'CAMPAIGN', 'TECHNICAL');
CREATE TYPE "TicketPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'URGENT');
CREATE TYPE "TicketStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'WAITING_CUSTOMER', 'RESOLVED', 'CLOSED');

-- ManagerAssignment
CREATE TABLE "ManagerAssignment" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "targetType" "AssignmentType" NOT NULL,
    "targetId" TEXT NOT NULL,
    "assignedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ManagerAssignment_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ManagerAssignment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ManagerAssignment_assignedById_fkey" FOREIGN KEY ("assignedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ManagerAssignment_userId_targetType_targetId_key" ON "ManagerAssignment"("userId", "targetType", "targetId");
CREATE INDEX "ManagerAssignment_userId_idx" ON "ManagerAssignment"("userId");
CREATE INDEX "ManagerAssignment_targetType_targetId_idx" ON "ManagerAssignment"("targetType", "targetId");

-- Profile
CREATE TABLE "Profile" (
    "id" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "bio" TEXT,
    "tagline" TEXT,
    "primaryNiche" TEXT NOT NULL,
    "secondaryNiches" TEXT[],
    "avatarFileId" TEXT,
    "coverFileId" TEXT,
    "location" TEXT,
    "languages" TEXT[],
    "isPublic" BOOLEAN NOT NULL DEFAULT true,
    "allowInquiries" BOOLEAN NOT NULL DEFAULT true,
    "allowBookings" BOOLEAN NOT NULL DEFAULT true,
    "socialLinks" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Profile_pkey" PRIMARY KEY ("id")
);

-- PortfolioAlbum
CREATE TABLE "PortfolioAlbum" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "coverFileId" TEXT,
    "isPublic" BOOLEAN NOT NULL DEFAULT true,
    "orderIndex" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PortfolioAlbum_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PortfolioAlbum_slug_key" ON "PortfolioAlbum"("slug");

-- PortfolioItem
CREATE TABLE "PortfolioItem" (
    "id" TEXT NOT NULL,
    "albumId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "fileId" TEXT,
    "externalUrl" TEXT,
    "clientName" TEXT,
    "metrics" JSONB,
    "tags" TEXT[],
    "orderIndex" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PortfolioItem_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "PortfolioItem_albumId_fkey" FOREIGN KEY ("albumId") REFERENCES "PortfolioAlbum"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "PortfolioItem_albumId_idx" ON "PortfolioItem"("albumId");

-- MediaKit
CREATE TABLE "MediaKit" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT,
    "statsSnapshot" JSONB NOT NULL DEFAULT '{}',
    "services" JSONB NOT NULL DEFAULT '[]',
    "isPublic" BOOLEAN NOT NULL DEFAULT true,
    "pdfFileId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "MediaKit_pkey" PRIMARY KEY ("id")
);

-- RateCardItem
CREATE TABLE "RateCardItem" (
    "id" TEXT NOT NULL,
    "serviceName" TEXT NOT NULL,
    "description" TEXT,
    "deliverables" TEXT[],
    "priceCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "isPublic" BOOLEAN NOT NULL DEFAULT true,
    "orderIndex" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "RateCardItem_pkey" PRIMARY KEY ("id")
);

-- Contact
CREATE TABLE "Contact" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "organization" TEXT,
    "roleOrTitle" TEXT,
    "notes" TEXT,
    "tags" TEXT[],
    "assignedUserId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Contact_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Contact_assignedUserId_fkey" FOREIGN KEY ("assignedUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Contact_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "Contact_email_idx" ON "Contact"("email");
CREATE INDEX "Contact_assignedUserId_idx" ON "Contact"("assignedUserId");

-- InboxThread
CREATE TABLE "InboxThread" (
    "id" TEXT NOT NULL,
    "type" "ThreadType" NOT NULL DEFAULT 'PUBLIC_INQUIRY',
    "status" "ThreadStatus" NOT NULL DEFAULT 'OPEN',
    "subject" TEXT NOT NULL,
    "snippet" TEXT,
    "senderName" TEXT NOT NULL,
    "senderEmail" TEXT NOT NULL,
    "brandName" TEXT,
    "unreadCount" INTEGER NOT NULL DEFAULT 0,
    "assignedUserId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "InboxThread_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "InboxThread_assignedUserId_fkey" FOREIGN KEY ("assignedUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "InboxThread_status_idx" ON "InboxThread"("status");
CREATE INDEX "InboxThread_type_idx" ON "InboxThread"("type");
CREATE INDEX "InboxThread_assignedUserId_idx" ON "InboxThread"("assignedUserId");
CREATE INDEX "InboxThread_senderEmail_idx" ON "InboxThread"("senderEmail");

-- InboxMessage
CREATE TABLE "InboxMessage" (
    "id" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "senderId" TEXT,
    "senderName" TEXT NOT NULL,
    "senderEmail" TEXT NOT NULL,
    "isFromStaff" BOOLEAN NOT NULL DEFAULT false,
    "body" TEXT NOT NULL,
    "attachmentIds" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "InboxMessage_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "InboxMessage_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "InboxThread"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "InboxMessage_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "InboxMessage_threadId_idx" ON "InboxMessage"("threadId");
CREATE INDEX "InboxMessage_senderId_idx" ON "InboxMessage"("senderId");

-- Notification
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "link" TEXT,
    "readAt" TIMESTAMP(3),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "Notification_userId_readAt_idx" ON "Notification"("userId", "readAt");

-- SupportTicket
CREATE TABLE "SupportTicket" (
    "id" TEXT NOT NULL,
    "ticketNumber" SERIAL NOT NULL,
    "subject" TEXT NOT NULL,
    "category" "TicketCategory" NOT NULL DEFAULT 'TECHNICAL',
    "priority" "TicketPriority" NOT NULL DEFAULT 'MEDIUM',
    "status" "TicketStatus" NOT NULL DEFAULT 'OPEN',
    "requesterEmail" TEXT NOT NULL,
    "requesterName" TEXT NOT NULL,
    "requesterId" TEXT,
    "assignedUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SupportTicket_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "SupportTicket_requesterId_fkey" FOREIGN KEY ("requesterId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "SupportTicket_assignedUserId_fkey" FOREIGN KEY ("assignedUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "SupportTicket_status_idx" ON "SupportTicket"("status");
CREATE INDEX "SupportTicket_category_idx" ON "SupportTicket"("category");
CREATE INDEX "SupportTicket_requesterId_idx" ON "SupportTicket"("requesterId");
CREATE INDEX "SupportTicket_assignedUserId_idx" ON "SupportTicket"("assignedUserId");

-- SupportTicketReply
CREATE TABLE "SupportTicketReply" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "authorId" TEXT,
    "authorName" TEXT NOT NULL,
    "authorEmail" TEXT NOT NULL,
    "isStaff" BOOLEAN NOT NULL DEFAULT false,
    "message" TEXT NOT NULL,
    "attachmentIds" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SupportTicketReply_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "SupportTicketReply_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "SupportTicket"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SupportTicketReply_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "SupportTicketReply_ticketId_idx" ON "SupportTicketReply"("ticketId");
CREATE INDEX "SupportTicketReply_authorId_idx" ON "SupportTicketReply"("authorId");


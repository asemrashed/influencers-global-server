-- CreateEnum
CREATE TYPE "ApprovalLevel" AS ENUM ('ALWAYS_HUMAN', 'DEFAULT_HUMAN', 'AUTOMATIC');

-- CreateEnum
CREATE TYPE "WorkflowTrigger" AS ENUM ('INBOX_MESSAGE_RECEIVED', 'ORDER_CREATED', 'MEETING_REQUESTED', 'PROPOSAL_RECEIVED', 'LEAD_CREATED');

-- CreateEnum
CREATE TYPE "WorkflowRunStatus" AS ENUM ('SUCCESS', 'FAILED', 'PENDING_APPROVAL', 'REJECTED');

-- CreateEnum
CREATE TYPE "AiTaskType" AS ENUM ('INBOX_CLASSIFY', 'INBOX_SUMMARIZE', 'REPLY_DRAFT', 'MEETING_SCORE', 'LEAD_DETECT', 'GROWTH_INSIGHT');

-- CreateTable
CREATE TABLE "AiUsage" (
    "id" TEXT NOT NULL,
    "taskType" "AiTaskType" NOT NULL,
    "promptTokens" INTEGER NOT NULL DEFAULT 0,
    "completionTokens" INTEGER NOT NULL DEFAULT 0,
    "totalTokens" INTEGER NOT NULL DEFAULT 0,
    "estimatedCostUsd" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "actorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiUsage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiAction" (
    "id" TEXT NOT NULL,
    "taskType" "AiTaskType" NOT NULL,
    "inputData" JSONB NOT NULL,
    "outputData" JSONB NOT NULL,
    "approvalLevel" "ApprovalLevel" NOT NULL,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "executedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiAction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkflowRule" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "trigger" "WorkflowTrigger" NOT NULL,
    "conditions" JSONB NOT NULL,
    "actions" JSONB NOT NULL,
    "delaySeconds" INTEGER NOT NULL DEFAULT 0,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "approvalLevel" "ApprovalLevel" NOT NULL DEFAULT 'ALWAYS_HUMAN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkflowRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkflowRun" (
    "id" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "trigger" "WorkflowTrigger" NOT NULL,
    "status" "WorkflowRunStatus" NOT NULL DEFAULT 'SUCCESS',
    "payload" JSONB NOT NULL,
    "executionResult" JSONB,
    "errorMessage" TEXT,
    "retriesCount" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "WorkflowRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AiUsage_taskType_idx" ON "AiUsage"("taskType");

-- CreateIndex
CREATE INDEX "AiUsage_createdAt_idx" ON "AiUsage"("createdAt");

-- CreateIndex
CREATE INDEX "AiUsage_actorId_idx" ON "AiUsage"("actorId");

-- CreateIndex
CREATE INDEX "AiAction_taskType_idx" ON "AiAction"("taskType");

-- CreateIndex
CREATE INDEX "AiAction_approvalLevel_idx" ON "AiAction"("approvalLevel");

-- CreateIndex
CREATE INDEX "AiAction_approvedById_idx" ON "AiAction"("approvedById");

-- CreateIndex
CREATE INDEX "AiAction_createdAt_idx" ON "AiAction"("createdAt");

-- CreateIndex
CREATE INDEX "WorkflowRule_trigger_idx" ON "WorkflowRule"("trigger");

-- CreateIndex
CREATE INDEX "WorkflowRule_isEnabled_idx" ON "WorkflowRule"("isEnabled");

-- CreateIndex
CREATE INDEX "WorkflowRun_ruleId_idx" ON "WorkflowRun"("ruleId");

-- CreateIndex
CREATE INDEX "WorkflowRun_trigger_idx" ON "WorkflowRun"("trigger");

-- CreateIndex
CREATE INDEX "WorkflowRun_status_idx" ON "WorkflowRun"("status");

-- CreateIndex
CREATE INDEX "WorkflowRun_startedAt_idx" ON "WorkflowRun"("startedAt");

-- AddForeignKey
ALTER TABLE "AiAction" ADD CONSTRAINT "AiAction_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowRun" ADD CONSTRAINT "WorkflowRun_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "WorkflowRule"("id") ON DELETE CASCADE ON UPDATE CASCADE;


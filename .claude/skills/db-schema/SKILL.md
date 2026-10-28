---
name: db-schema
description: Use when touching the database schema, Prisma models or relations. Domain index for the Influencer Management Platform.
---

# DB Schema — Influencer Management Platform

One PostgreSQL database per client, one Prisma schema. There is NO tenant column anywhere: a database never holds more than one client. The full schema lives in `apps/api/prisma/schema.prisma`; this file is the index.

## Domains
- Identity and access: User, Session, Role, Permission, RolePermission, UserRole, Invitation, PasswordResetToken
- Profile and site: Profile, MediaKit, GalleryItem, PublicPage, RateCard, PrivacyRule
- Contacts and brands: Contact, Organization, ManagerAssignment
- Collaboration: Proposal, Campaign, Deliverable, Agreement, Signature, Brief
- Meetings and events: MeetingRequest, Meeting, Availability, Event, Rsvp, CheckIn, PrPackage
- Content and social: ContentItem, Draft, Approval, SocialAccount, PublishJob, FollowerSnapshot, AnalyticsSnapshot
- Messaging and support: Thread, Message, Notification, EmailLog, Template, SupportTicket
- Commerce and customers: Customer, Lead, Product, Category, Variant, InventoryMovement, Cart, Order, OrderItem, Shipment, ReturnRequest, Discount, Payment
- Earnings: EarningEntry, Invoice, Milestone, Expense, PromoCode, AffiliateLink, ClickEvent
- AI and automation: AiUsage, AiAction, WorkflowRule, WorkflowRun, ApprovalRequest
- Platform: Setting, ModuleToggle, AuditLog, StoredFile

## Conventions (every table)
- All foreign keys indexed. Every table has `createdAt`, `updatedAt`. Soft delete via `deletedAt` where records must be kept.
- Money: integer minor units (or `Decimal`), never `float`; store the currency code with the amount.
- One-time codes and reset tokens: hash + `expiresAt`, never raw.
- Social and email tokens: encrypted at rest (key from env), never returned by any DTO.
- Files: store a provider-neutral key plus size, content type and owner in `StoredFile`, never a vendor URL (see `storage`).
- Data provenance: earnings and analytics rows carry `source` = `manual` or `synced`, so the UI can always tell entered figures from verified ones.
- Snapshots (`FollowerSnapshot`, `AnalyticsSnapshot`) are append-only, one row per account per day.
- Order and payment states are explicit enums; illegal transitions are rejected in the service and guarded by CHECK or unique constraints where possible.
- Stock changes only through `InventoryMovement` rows inside a transaction; stock never goes negative.

## Keep this file short
The `db-migration` agent updates the Domains list in the same PR that adds or removes an entity.

import { z } from 'zod';
import { pageOf, paginationQuerySchema } from './common.js';

export const customerStatusSchema = z.enum(['LEAD', 'ACTIVE', 'INACTIVE', 'BLOCKED']);
export type CustomerStatus = z.infer<typeof customerStatusSchema>;

export const orderStatusSchema = z.enum([
  'PENDING',
  'PAID',
  'FULFILLED',
  'DELIVERED',
  'CANCELLED',
  'REFUNDED',
]);
export type OrderStatus = z.infer<typeof orderStatusSchema>;

export const paymentStatusSchema = z.enum([
  'UNPAID',
  'PAID',
  'PARTIALLY_REFUNDED',
  'REFUNDED',
  'FAILED',
]);
export type PaymentStatus = z.infer<typeof paymentStatusSchema>;

export const paymentMethodSchema = z.enum([
  'CASH_ON_DELIVERY',
  'MANUAL_BANK_TRANSFER',
  'OTHER_OFFLINE',
]);
export type PaymentMethod = z.infer<typeof paymentMethodSchema>;

export const inventoryActionSchema = z.enum([
  'STOCK_IN',
  'STOCK_OUT',
  'RESERVE',
  'RELEASE',
  'RETURN_RESTOCK',
  'ADJUSTMENT',
]);
export type InventoryAction = z.infer<typeof inventoryActionSchema>;

export const returnStatusSchema = z.enum([
  'REQUESTED',
  'APPROVED',
  'REJECTED',
  'RECEIVED',
  'RESTOCKED',
]);
export type ReturnStatus = z.infer<typeof returnStatusSchema>;

export const invoiceStatusSchema = z.enum([
  'DRAFT',
  'ISSUED',
  'PARTIALLY_PAID',
  'PAID',
  'CANCELLED',
]);
export type InvoiceStatus = z.infer<typeof invoiceStatusSchema>;

export const milestoneStatusSchema = z.enum([
  'PENDING',
  'IN_PROGRESS',
  'COMPLETED',
  'PAID',
]);
export type MilestoneStatus = z.infer<typeof milestoneStatusSchema>;

// Customers & Leads
export const customerSchema = z.object({
  id: z.string(),
  email: z.string().email(),
  name: z.string(),
  phone: z.string().nullable(),
  company: z.string().nullable(),
  notes: z.string().nullable(),
  status: customerStatusSchema,
  totalSpentCents: z.number().int(),
  ordersCount: z.number().int(),
  assignedUserId: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Customer = z.infer<typeof customerSchema>;

export const createCustomerBodySchema = z.object({
  email: z.string().email(),
  name: z.string().min(1),
  phone: z.string().optional(),
  company: z.string().optional(),
  notes: z.string().optional(),
  status: customerStatusSchema.default('LEAD'),
  assignedUserId: z.string().optional(),
});
export type CreateCustomerBody = z.infer<typeof createCustomerBodySchema>;

export const updateCustomerBodySchema = createCustomerBodySchema.partial();
export type UpdateCustomerBody = z.infer<typeof updateCustomerBodySchema>;

// Products & Categories
export const productCategorySchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  sortOrder: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ProductCategory = z.infer<typeof productCategorySchema>;

export const createProductCategoryBodySchema = z.object({
  slug: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  sortOrder: z.number().int().default(0),
});
export type CreateProductCategoryBody = z.infer<typeof createProductCategoryBodySchema>;

export const productVariantSchema = z.object({
  id: z.string(),
  productId: z.string(),
  sku: z.string(),
  title: z.string(),
  priceCents: z.number().int().nonnegative(),
  stock: z.number().int().nonnegative(),
  isActive: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ProductVariant = z.infer<typeof productVariantSchema>;

export const productSchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  categoryId: z.string().nullable(),
  isActive: z.boolean(),
  imageIds: z.array(z.string()),
  variants: z.array(productVariantSchema).optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Product = z.infer<typeof productSchema>;

export const createProductVariantInputSchema = z.object({
  sku: z.string().min(1),
  title: z.string().min(1),
  priceCents: z.number().int().nonnegative(),
  stock: z.number().int().nonnegative().default(0),
  isActive: z.boolean().default(true),
});
export type CreateProductVariantInput = z.infer<typeof createProductVariantInputSchema>;

export const createProductBodySchema = z.object({
  slug: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  categoryId: z.string().optional(),
  isActive: z.boolean().default(true),
  imageIds: z.array(z.string()).default([]),
  variants: z.array(createProductVariantInputSchema).optional(),
});
export type CreateProductBody = z.infer<typeof createProductBodySchema>;

export const updateProductBodySchema = createProductBodySchema.partial();
export type UpdateProductBody = z.infer<typeof updateProductBodySchema>;

export const stockAdjustmentBodySchema = z.object({
  quantity: z.number().int(), // positive or negative
  reason: z.string().optional(),
});
export type StockAdjustmentBody = z.infer<typeof stockAdjustmentBodySchema>;

// Promo Codes
export const promoCodeSchema = z.object({
  id: z.string(),
  code: z.string(),
  discountBps: z.number().int().nullable(),
  discountCents: z.number().int().nullable(),
  campaignId: z.string().nullable(),
  affiliateName: z.string().nullable(),
  startsAt: z.string().nullable(),
  expiresAt: z.string().nullable(),
  maxUses: z.number().int().nullable(),
  usedCount: z.number().int(),
  isActive: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type PromoCode = z.infer<typeof promoCodeSchema>;

export const createPromoCodeBodySchema = z.object({
  code: z.string().min(2),
  discountBps: z.number().int().positive().max(10000).optional(),
  discountCents: z.number().int().positive().optional(),
  campaignId: z.string().optional(),
  affiliateName: z.string().optional(),
  startsAt: z.string().datetime().optional(),
  expiresAt: z.string().datetime().optional(),
  maxUses: z.number().int().positive().optional(),
  isActive: z.boolean().default(true),
});
export type CreatePromoCodeBody = z.infer<typeof createPromoCodeBodySchema>;

// Orders & Checkout
export const orderItemSchema = z.object({
  id: z.string(),
  orderId: z.string(),
  variantId: z.string(),
  title: z.string(),
  sku: z.string(),
  quantity: z.number().int().positive(),
  unitPriceCents: z.number().int().nonnegative(),
  totalPriceCents: z.number().int().nonnegative(),
  createdAt: z.string(),
});
export type OrderItem = z.infer<typeof orderItemSchema>;

export const shipmentSchema = z.object({
  id: z.string(),
  orderId: z.string(),
  carrier: z.string(),
  trackingNumber: z.string().nullable(),
  status: z.string(),
  shippedAt: z.string().nullable(),
  deliveredAt: z.string().nullable(),
  notes: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Shipment = z.infer<typeof shipmentSchema>;

export const returnRequestSchema = z.object({
  id: z.string(),
  orderId: z.string(),
  status: returnStatusSchema,
  reason: z.string(),
  restockResellable: z.boolean(),
  decisionNotes: z.string().nullable(),
  decidedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ReturnRequest = z.infer<typeof returnRequestSchema>;

export const orderSchema = z.object({
  id: z.string(),
  orderNumber: z.string(),
  customerId: z.string().nullable(),
  customerEmail: z.string().email(),
  customerName: z.string(),
  customerPhone: z.string().nullable(),
  shippingAddress: z.record(z.string(), z.unknown()),
  status: orderStatusSchema,
  paymentStatus: paymentStatusSchema,
  paymentMethod: paymentMethodSchema,
  paymentDetails: z.record(z.string(), z.unknown()).nullable(),
  promoCodeId: z.string().nullable(),
  subtotalCents: z.number().int(),
  discountCents: z.number().int(),
  shippingCents: z.number().int(),
  totalCents: z.number().int(),
  paidCents: z.number().int(),
  refundedCents: z.number().int(),
  assignedUserId: z.string().nullable(),
  items: z.array(orderItemSchema).optional(),
  shipments: z.array(shipmentSchema).optional(),
  returns: z.array(returnRequestSchema).optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Order = z.infer<typeof orderSchema>;

export const checkoutItemInputSchema = z.object({
  variantId: z.string().min(1).max(100),
  quantity: z.number().int().positive().max(1000),
});

export const shippingAddressSchema = z.object({
  street: z.string().min(1).max(200),
  city: z.string().min(1).max(100),
  state: z.string().max(100).optional(),
  postalCode: z.string().max(30).optional(),
  country: z.string().min(2).max(100),
}).passthrough();

export const checkoutBodySchema = z.object({
  customerEmail: z.string().email().max(254),
  customerName: z.string().min(1).max(100),
  customerPhone: z.string().max(50).optional(),
  shippingAddress: shippingAddressSchema,
  items: z.array(checkoutItemInputSchema).min(1).max(100),
  promoCode: z.string().max(50).optional(),
  paymentMethod: paymentMethodSchema.default('CASH_ON_DELIVERY'),
  idempotencyKey: z.string().max(100).optional(),
});
export type CheckoutBody = z.infer<typeof checkoutBodySchema>;

export const updateOrderStatusBodySchema = z.object({
  status: orderStatusSchema,
  notes: z.string().optional(),
});
export type UpdateOrderStatusBody = z.infer<typeof updateOrderStatusBodySchema>;

export const recordOrderPaymentBodySchema = z.object({
  amountCents: z.number().int().positive(),
  paymentMethod: paymentMethodSchema,
  reference: z.string().optional(),
  notes: z.string().optional(),
});
export type RecordOrderPaymentBody = z.infer<typeof recordOrderPaymentBodySchema>;

export const refundOrderBodySchema = z.object({
  amountCents: z.number().int().positive(),
  reason: z.string().min(1),
});
export type RefundOrderBody = z.infer<typeof refundOrderBodySchema>;

export const createShipmentBodySchema = z.object({
  carrier: z.string().min(1),
  trackingNumber: z.string().optional(),
  notes: z.string().optional(),
  shippedAt: z.string().datetime().optional(),
});
export type CreateShipmentBody = z.infer<typeof createShipmentBodySchema>;

export const createReturnRequestBodySchema = z.object({
  reason: z.string().min(1),
  restockResellable: z.boolean().default(true),
});
export type CreateReturnRequestBody = z.infer<typeof createReturnRequestBodySchema>;

export const decideReturnRequestBodySchema = z.object({
  status: z.enum(['APPROVED', 'REJECTED', 'RECEIVED', 'RESTOCKED']),
  decisionNotes: z.string().optional(),
});
export type DecideReturnRequestBody = z.infer<typeof decideReturnRequestBodySchema>;

// Invoices, Milestones & Earnings
export const paymentMilestoneSchema = z.object({
  id: z.string(),
  invoiceId: z.string(),
  title: z.string(),
  amountCents: z.number().int(),
  dueDate: z.string(),
  status: milestoneStatusSchema,
  completedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type PaymentMilestone = z.infer<typeof paymentMilestoneSchema>;

export const earningPaymentSchema = z.object({
  id: z.string(),
  invoiceId: z.string(),
  amountCents: z.number().int(),
  paidAt: z.string(),
  paymentMethod: paymentMethodSchema,
  reference: z.string().nullable(),
  source: z.enum(['SYNCED', 'MANUAL']),
  notes: z.string().nullable(),
  createdAt: z.string(),
});
export type EarningPayment = z.infer<typeof earningPaymentSchema>;

export const invoiceSchema = z.object({
  id: z.string(),
  invoiceNumber: z.string(),
  campaignId: z.string().nullable(),
  clientName: z.string(),
  clientEmail: z.string().email(),
  status: invoiceStatusSchema,
  issueDate: z.string(),
  dueDate: z.string(),
  subtotalCents: z.number().int(),
  taxCents: z.number().int(),
  totalCents: z.number().int(),
  paidCents: z.number().int(),
  notes: z.string().nullable(),
  createdById: z.string().nullable(),
  milestones: z.array(paymentMilestoneSchema).optional(),
  payments: z.array(earningPaymentSchema).optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Invoice = z.infer<typeof invoiceSchema>;

export const createMilestoneInputSchema = z.object({
  title: z.string().min(1),
  amountCents: z.number().int().positive(),
  dueDate: z.string().datetime(),
});

export const createInvoiceBodySchema = z.object({
  invoiceNumber: z.string().min(1),
  campaignId: z.string().optional(),
  clientName: z.string().min(1),
  clientEmail: z.string().email(),
  issueDate: z.string().datetime().optional(),
  dueDate: z.string().datetime(),
  subtotalCents: z.number().int().positive(),
  taxCents: z.number().int().default(0),
  notes: z.string().optional(),
  milestones: z.array(createMilestoneInputSchema).optional(),
});
export type CreateInvoiceBody = z.infer<typeof createInvoiceBodySchema>;

export const recordInvoicePaymentBodySchema = z.object({
  amountCents: z.number().int().positive(),
  paymentMethod: paymentMethodSchema.default('MANUAL_BANK_TRANSFER'),
  reference: z.string().optional(),
  source: z.enum(['SYNCED', 'MANUAL']).default('MANUAL'),
  notes: z.string().optional(),
});
export type RecordInvoicePaymentBody = z.infer<typeof recordInvoicePaymentBodySchema>;

export const earningEntrySchema = z.object({
  id: z.string(),
  campaignId: z.string().nullable(),
  title: z.string(),
  category: z.string(),
  amountCents: z.number().int(),
  expectedAt: z.string().nullable(),
  receivedAt: z.string().nullable(),
  source: z.enum(['SYNCED', 'MANUAL']),
  reference: z.string().nullable(),
  notes: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type EarningEntry = z.infer<typeof earningEntrySchema>;

export const createEarningEntryBodySchema = z.object({
  campaignId: z.string().optional(),
  title: z.string().min(1),
  category: z.string().min(1),
  amountCents: z.number().int().positive(),
  expectedAt: z.string().datetime().optional(),
  receivedAt: z.string().datetime().optional(),
  source: z.enum(['SYNCED', 'MANUAL']).default('MANUAL'),
  reference: z.string().optional(),
  notes: z.string().optional(),
});
export type CreateEarningEntryBody = z.infer<typeof createEarningEntryBodySchema>;

export const earningsSummarySchema = z.object({
  totalEarnedCents: z.number().int(),
  pendingInvoicedCents: z.number().int(),
  totalOrdersRevenueCents: z.number().int(),
  categories: z.record(z.string(), z.number().int()),
});
export type EarningsSummary = z.infer<typeof earningsSummarySchema>;

// ─────────────────────────────────────────────────────────────
// PAGINATED SCHEMAS & LIST QUERIES
// ─────────────────────────────────────────────────────────────

export const productListQuerySchema = paginationQuerySchema.extend({
  categoryId: z.string().optional(),
  search: z.string().optional(),
});
export type ProductListQuery = z.infer<typeof productListQuerySchema>;
export const productPageSchema = pageOf(productSchema, 'ProductPage');
export type ProductPage = z.infer<typeof productPageSchema>;

export const customerListQuerySchema = paginationQuerySchema.extend({
  status: customerStatusSchema.optional(),
  search: z.string().optional(),
});
export type CustomerListQuery = z.infer<typeof customerListQuerySchema>;
export const customerPageSchema = pageOf(customerSchema, 'CustomerPage');
export type CustomerPage = z.infer<typeof customerPageSchema>;

export const orderListQuerySchema = paginationQuerySchema.extend({
  status: orderStatusSchema.optional(),
  customerId: z.string().optional(),
});
export type OrderListQuery = z.infer<typeof orderListQuerySchema>;
export const orderPageSchema = pageOf(orderSchema, 'OrderPage');
export type OrderPage = z.infer<typeof orderPageSchema>;

export const invoiceListQuerySchema = paginationQuerySchema.extend({
  status: z.enum(['DRAFT', 'ISSUED', 'PARTIALLY_PAID', 'PAID', 'CANCELLED']).optional(),
  campaignId: z.string().optional(),
});
export type InvoiceListQuery = z.infer<typeof invoiceListQuerySchema>;
export const invoicePageSchema = pageOf(invoiceSchema, 'InvoicePage');
export type InvoicePage = z.infer<typeof invoicePageSchema>;

export const earningEntryListQuerySchema = paginationQuerySchema.extend({
  category: z.string().optional(),
  campaignId: z.string().optional(),
});
export type EarningEntryListQuery = z.infer<typeof earningEntryListQuerySchema>;
export const earningEntryPageSchema = pageOf(earningEntrySchema, 'EarningEntryPage');
export type EarningEntryPage = z.infer<typeof earningEntryPageSchema>;


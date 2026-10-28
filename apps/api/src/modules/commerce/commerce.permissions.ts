import type { PermissionDef } from '../../permissions/types.js';

export const commercePermissions: readonly PermissionDef[] = [
  {
    key: 'customers.read',
    description: 'View customers and leads',
    defaults: { admin: 'all', manager: 'assigned' },
  },
  {
    key: 'customers.write',
    description: 'Create and update customers and leads',
    defaults: { admin: 'all', manager: 'assigned' },
  },
  {
    key: 'products.read',
    description: 'View products, variants, and stock levels',
    defaults: { admin: 'all', manager: 'all' },
  },
  {
    key: 'products.write',
    description: 'Manage products, categories, variants, and stock adjustments',
    defaults: { admin: 'all' },
  },
  {
    key: 'orders.read',
    description: 'View customer orders and fulfillment details',
    defaults: { admin: 'all', manager: 'assigned' },
  },
  {
    key: 'orders.write',
    description: 'Manage order status, shipments, and returns',
    defaults: { admin: 'all', manager: 'assigned' },
  },
  {
    key: 'orders.refund',
    description: 'Issue refunds on customer orders',
    defaults: { admin: 'all' },
  },
  {
    key: 'earnings.read',
    description: 'View invoices, payment milestones, earnings entries, and reports',
    defaults: { admin: 'all', manager: 'all' },
  },
  {
    key: 'earnings.write',
    description: 'Create invoices, record payments, and manage earning entries',
    defaults: { admin: 'all' },
  },
] as const;

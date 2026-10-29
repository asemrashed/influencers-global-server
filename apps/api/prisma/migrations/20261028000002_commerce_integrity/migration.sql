-- Defense in depth for the commerce invariants. The application already guards these with conditional
-- updates; the database now refuses a violation even if a future code path forgets to.
ALTER TABLE "ProductVariant" ADD CONSTRAINT "ProductVariant_stock_nonneg" CHECK ("stock" >= 0);
ALTER TABLE "PromoCode" ADD CONSTRAINT "PromoCode_usage_cap" CHECK ("maxUses" IS NULL OR "usedCount" <= "maxUses");
ALTER TABLE "Order" ADD CONSTRAINT "Order_money_bounds" CHECK ("paidCents" >= 0 AND "refundedCents" >= 0 AND "refundedCents" <= "paidCents" AND "paidCents" <= "totalCents");

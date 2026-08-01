/**
 * Active brand for this deployment (ADR 0010).
 *
 * Works in every context — server components, client components, route
 * handlers, metadata factories. Client bundles only receive env vars that
 * are referenced literally as `process.env.NEXT_PUBLIC_*` (Next.js inlines
 * them at build time), so this module reads the NEXT_PUBLIC mirror of
 * `BRAND`; the env schema refuses any deployment where the two disagree,
 * and `resolveBrandId` is the schema-backed guard for the raw value.
 * Absent (local dev, default deploys) resolves to the default brand.
 */
import { type BrandConfig, getBrand, resolveBrandId } from '@forma360/shared/brand';

export const activeBrand: BrandConfig = getBrand(resolveBrandId(process.env.NEXT_PUBLIC_BRAND));

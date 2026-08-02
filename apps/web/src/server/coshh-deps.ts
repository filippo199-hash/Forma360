/**
 * Real wiring for the coshh router (FreeHS module B2). Brand-gates the
 * module per ADR 0010 — the API surface matches the navigation.
 */
import type { CoshhRouterDeps } from '@forma360/api';
import { brandHasModule } from '@forma360/shared/brand';
import { activeBrand } from '../lib/brand';

export const coshhDeps: CoshhRouterDeps = {
  enabled: brandHasModule(activeBrand.id, 'coshh'),
};

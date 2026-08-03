/**
 * Real wiring for the fireSafety router (FreeHS module B3). Brand-gates
 * the module per ADR 0010 — the API surface matches the navigation.
 */
import type { FireSafetyRouterDeps } from '@forma360/api';
import { brandHasModule } from '@forma360/shared/brand';
import { activeBrand } from '../lib/brand';

export const fireSafetyDeps: FireSafetyRouterDeps = {
  enabled: brandHasModule(activeBrand.id, 'fireSafety'),
};

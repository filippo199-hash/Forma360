/**
 * Real wiring for the permits router (FreeHS module B3). Brand-gates the
 * module per ADR 0010 — the API surface matches the navigation.
 */
import type { PermitsRouterDeps } from '@forma360/api';
import { brandHasModule } from '@forma360/shared/brand';
import { activeBrand } from '../lib/brand';

export const permitsDeps: PermitsRouterDeps = {
  enabled: brandHasModule(activeBrand.id, 'permits'),
};

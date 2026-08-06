/**
 * Real wiring for the training router (FreeHS module B7). Brand-gates the
 * module per ADR 0010 — the API surface matches the navigation.
 */
import type { TrainingRouterDeps } from '@forma360/api';
import { brandHasModule } from '@forma360/shared/brand';
import { activeBrand } from '../lib/brand';

export const trainingDeps: TrainingRouterDeps = {
  enabled: brandHasModule(activeBrand.id, 'training'),
};

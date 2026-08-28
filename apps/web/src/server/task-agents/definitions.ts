/**
 * The runner-backed agent definitions, one file per agent, assembled
 * here. The three legacy agents (template-drafter, dashboard-builder,
 * sds-importer) run on their own endpoints and are deliberately absent.
 */
import type { TaskAgentServerDef } from './index';
import { raDrafter } from './ra-drafter';
import { coshhDrafter } from './coshh-drafter';
import { ramsDrafter } from './rams-drafter';
import { fraAssistant } from './fra-assistant';
import { investigationAssistant } from './investigation-assistant';
import { briefingWriter } from './briefing-writer';
import { permitPreparer } from './permit-preparer';

export const DEFINITIONS: readonly TaskAgentServerDef[] = [
  raDrafter,
  coshhDrafter,
  ramsDrafter,
  fraAssistant,
  investigationAssistant,
  briefingWriter,
  permitPreparer,
];

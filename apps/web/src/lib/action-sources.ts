/**
 * The action-source vocabulary, shared by every actions-hub surface.
 *
 * RS-A8: the list page, the board and the detail card each carried their own
 * copy of this mapping, so a module could ship a server-side `sourceType`
 * (RAMS did) and still be labelled as something else entirely — the detail
 * card's ternary fell through to "Raised by a failed fire-door inspection".
 * One table, imported by all three, means adding a source type to the server
 * enum without labelling it here is a type error rather than a wrong label.
 */

/**
 * Every value `actions.list` / `actions.get` can return in `source.type`.
 * Keep in step with the `sourceType` enum in `packages/api/src/routers/actions.ts`.
 */
export const ACTION_SOURCE_TYPES = [
  'standalone',
  'inspection',
  'issue',
  'risk_assessment',
  'coshh_assessment',
  'fire_risk_assessment',
  'fire_logbook_entry',
  'fire_door_inspection',
  'incident',
  'rams',
] as const;

export type ActionSourceType = (typeof ACTION_SOURCE_TYPES)[number];

/**
 * Short chip label used in the list, the board card and the source filter —
 * resolved inside the `actions` namespace.
 */
const SOURCE_LABEL_KEYS: Record<ActionSourceType, string> = {
  standalone: 'sourceStandalone',
  inspection: 'sourceInspection',
  issue: 'sourceIssue',
  risk_assessment: 'sourceRiskAssessment',
  coshh_assessment: 'sourceCoshhAssessment',
  fire_risk_assessment: 'sourceFireRiskAssessment',
  fire_logbook_entry: 'sourceFireLogbookEntry',
  fire_door_inspection: 'sourceFireDoorInspection',
  incident: 'sourceIncident',
  rams: 'sourceRams',
};

/**
 * Sentence used on the detail card's source row — resolved inside the
 * `actions.detail` namespace.
 */
const SOURCE_LINK_KEYS: Record<ActionSourceType, string> = {
  standalone: 'sourceLinkStandalone',
  inspection: 'sourceLinkInspection',
  issue: 'sourceLinkIssue',
  risk_assessment: 'sourceLinkRiskAssessment',
  coshh_assessment: 'sourceLinkCoshhAssessment',
  fire_risk_assessment: 'sourceLinkFireRiskAssessment',
  fire_logbook_entry: 'sourceLinkFireLogbookEntry',
  fire_door_inspection: 'sourceLinkFireDoorInspection',
  incident: 'sourceLinkIncident',
  rams: 'sourceLinkRams',
};

/** Source-link sentences that interpolate `{referenceNumber}`. */
const SOURCE_LINKS_WITH_REFERENCE: ReadonlySet<ActionSourceType> = new Set([
  'inspection',
  'issue',
  'risk_assessment',
  'coshh_assessment',
  'fire_risk_assessment',
  'incident',
  'rams',
]);

export function isActionSourceType(value: string): value is ActionSourceType {
  return (ACTION_SOURCE_TYPES as ReadonlyArray<string>).includes(value);
}

/** Chip label key for a source type; unknown types read as standalone. */
export function actionSourceLabelKey(sourceType: string): string {
  return isActionSourceType(sourceType)
    ? SOURCE_LABEL_KEYS[sourceType]
    : SOURCE_LABEL_KEYS.standalone;
}

/** Detail-card sentence key for a source type. */
export function actionSourceLinkKey(sourceType: string): string {
  return isActionSourceType(sourceType)
    ? SOURCE_LINK_KEYS[sourceType]
    : SOURCE_LINK_KEYS.standalone;
}

/** Whether that sentence needs a `{referenceNumber}` value passed to it. */
export function actionSourceLinkTakesReference(sourceType: string): boolean {
  return isActionSourceType(sourceType) && SOURCE_LINKS_WITH_REFERENCE.has(sourceType);
}

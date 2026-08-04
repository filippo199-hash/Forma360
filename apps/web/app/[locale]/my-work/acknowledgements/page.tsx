'use client';

/**
 * "My acknowledgements" — briefings and risk-assessment sign-offs the
 * viewer still owes (navigation review, FOR ME block).
 */
import { MyWorkQueue } from '../../../../src/components/my-work/my-work-queue';

export default function MyAcknowledgementsPage() {
  return (
    <MyWorkQueue
      initialFilter="acknowledgement"
      titleKey="myAcknowledgementsTitle"
      subtitleKey="myAcknowledgementsSubtitle"
    />
  );
}

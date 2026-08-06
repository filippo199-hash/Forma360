'use client';

/**
 * "My actions" — the personal door onto the Actions module (navigation
 * review, FOR ME block). A real route rather than a query string so it
 * lights up on its own in the menu and can be linked to directly.
 */
import { MyWorkQueue } from '../../../../src/components/my-work/my-work-queue';

export default function MyActionsPage() {
  return (
    <MyWorkQueue initialFilter="action" titleKey="myActionsTitle" subtitleKey="myActionsSubtitle" />
  );
}

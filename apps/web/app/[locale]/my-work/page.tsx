'use client';

/** The combined personal queue. See {@link MyWorkQueue}. */
import { GettingStartedCard } from '../../../src/components/my-work/getting-started-card';
import { MyWorkQueue } from '../../../src/components/my-work/my-work-queue';

export default function MyWorkPage() {
  return (
    <div className="space-y-4">
      <GettingStartedCard />
      <MyWorkQueue />
    </div>
  );
}

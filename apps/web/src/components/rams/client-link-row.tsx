'use client';

/**
 * One client share link on the pack page (NR3-07).
 *
 * Links are version-pinned and deliberately survive a re-issue (only
 * withdraw/cancel revoke them — ADR 0015: readable-but-superseded is
 * what answers "what was in force on the day"). The /s print header
 * already tells the CLIENT their copy is superseded; this row is where
 * the ISSUER learns the same thing, so they mint a fresh link for the
 * current version instead of assuming the client sees v(n+1).
 */
import { useTranslations } from 'next-intl';
import { Button } from '../ui/button';
import { formatDateTime } from '../../lib/format-date';
import { ClientDecisionChip } from './chips';

export interface ClientLinkRowLink {
  id: string;
  versionNumber: number;
  issuedToName: string;
  decision: string;
  decidedAt: Date | null;
  revokedAt: Date | null;
  decisionComment: string;
  /** Who actually signed the decision on the public page (UXW3-02). */
  acceptedByName: string;
  acceptedByOrganisation: string;
}

/** Live link pointing at a version the pack has since moved past. */
export function isStaleClientLink(
  link: Pick<ClientLinkRowLink, 'revokedAt' | 'versionNumber'>,
  currentVersion: number,
): boolean {
  return link.revokedAt === null && link.versionNumber !== currentVersion;
}

export function ClientLinkRow({
  link,
  currentVersion,
  revokePending,
  onShowLink,
  onRevoke,
}: {
  link: ClientLinkRowLink;
  currentVersion: number;
  revokePending: boolean;
  onShowLink: (linkId: string) => void;
  onRevoke: (linkId: string) => void;
}) {
  const t = useTranslations('rams');
  const stale = isStaleClientLink(link, currentVersion);
  return (
    <li className="flex flex-wrap items-center gap-2">
      <ClientDecisionChip decision={link.decision} />
      <span>{link.issuedToName.length > 0 ? link.issuedToName : t('client.unnamed')}</span>
      <span className="text-muted-foreground">
        {t('versionLabel', { version: link.versionNumber })}
        {link.decidedAt !== null ? ` · ${formatDateTime(link.decidedAt)}` : ''}
        {link.revokedAt !== null ? ` · ${t('client.revoked')}` : ''}
      </span>
      {/* UXW3-02: the row used to carry only the link's CONTACT name, so a
          manager read "Accepted <contact>" when someone else entirely had
          signed. The signatory is the evidence — show it. */}
      {link.decision !== 'pending' && link.acceptedByName.length > 0 ? (
        <span className="font-medium">
          {t('client.signedBy', { name: link.acceptedByName })}
          {link.acceptedByOrganisation.length > 0 ? ` — ${link.acceptedByOrganisation}` : ''}
        </span>
      ) : null}
      {stale ? (
        <span className="text-amber-700 dark:text-amber-300">
          {t('client.staleLink', { version: link.versionNumber, current: currentVersion })}
        </span>
      ) : null}
      {link.decisionComment.length > 0 ? (
        <span className="text-muted-foreground italic">“{link.decisionComment}”</span>
      ) : null}
      {/* RS-A14: a live link was unrecoverable once you navigated away,
          and there was no way to pull one back. Both are here now. */}
      {link.revokedAt === null ? (
        <>
          <Button type="button" size="sm" variant="ghost" onClick={() => onShowLink(link.id)}>
            {t('client.showLink')}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={revokePending}
            onClick={() => onRevoke(link.id)}
          >
            {t('client.revokeLink')}
          </Button>
        </>
      ) : null}
    </li>
  );
}

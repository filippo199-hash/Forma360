'use client';

import type {
  CustomResponseSet,
  Item,
  Page,
  Section,
  TemplateContent,
} from '@forma360/shared/template-schema';
import { useTranslations } from 'next-intl';
import type { Responses } from './conduct-state';
import { isItemVisible } from './conduct-state';
import { Card } from '../ui/card';

/**
 * Read-only renderer for a submitted inspection. Walks pages → sections →
 * items and shows each response as plain text/media rather than an input.
 *
 * Intentionally minimal: approvals UI needs "see what was entered" not
 * "relive the conduct UI". Rich inputs (annotation / tables / location)
 * show a stub note, same as the conduct UI.
 */
export type ReviewSignature = {
  id?: string;
  slotId: string;
  slotIndex: number;
  signerName: string;
  signerRole: string | null;
  signatureData: string;
  signedAt: Date;
};

export function InspectionReview({
  content,
  responses,
  signatures,
}: {
  content: TemplateContent;
  responses: Responses;
  signatures: readonly ReviewSignature[];
}) {
  return (
    <div className="space-y-6">
      {content.pages.map((page) => (
        <ReviewPage
          key={page.id}
          page={page}
          responses={responses}
          responseSets={content.customResponseSets}
          signatures={signatures}
        />
      ))}
    </div>
  );
}

function ReviewPage({
  page,
  responses,
  responseSets,
  signatures,
}: {
  page: Page;
  responses: Responses;
  responseSets: CustomResponseSet[];
  signatures: readonly ReviewSignature[];
}) {
  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold tracking-tight">{page.title}</h2>
      {page.description !== undefined ? (
        <p className="text-sm text-muted-foreground">{page.description}</p>
      ) : null}
      {page.sections.map((section) => (
        <ReviewSection
          key={section.id}
          section={section}
          responses={responses}
          responseSets={responseSets}
          signatures={signatures}
        />
      ))}
    </section>
  );
}

function ReviewSection({
  section,
  responses,
  responseSets,
  signatures,
}: {
  section: Section;
  responses: Responses;
  responseSets: CustomResponseSet[];
  signatures: readonly ReviewSignature[];
}) {
  return (
    <Card className="space-y-3 p-4">
      <div className="space-y-1">
        <h3 className="text-base font-semibold">{section.title}</h3>
        {section.description !== undefined ? (
          <p className="text-sm text-muted-foreground">{section.description}</p>
        ) : null}
      </div>
      <ul className="space-y-4">
        {section.items.map((item) => (
          <ReviewItem
            key={item.id}
            item={item}
            responses={responses}
            responseSets={responseSets}
            signatures={signatures}
          />
        ))}
      </ul>
    </Card>
  );
}

function ReviewItem({
  item,
  responses,
  responseSets,
  signatures,
}: {
  item: Item;
  responses: Responses;
  responseSets: CustomResponseSet[];
  signatures: readonly ReviewSignature[];
}) {
  const t = useTranslations('approvals.review');
  if (!isItemVisible(item, responses)) return null;
  const prompt = 'prompt' in item ? item.prompt : null;
  const value = responses[item.id];

  return (
    <li className="space-y-2">
      {prompt !== null ? <p className="text-sm font-medium">{prompt}</p> : null}
      <div className="text-sm text-muted-foreground">
        <ReviewValue
          item={item}
          value={value}
          responseSets={responseSets}
          signatures={signatures}
          emptyLabel={t('empty')}
        />
      </div>
      {'note' in item && item.note !== undefined ? (
        <p className="text-xs text-muted-foreground">{item.note}</p>
      ) : null}
    </li>
  );
}

function ReviewValue({
  item,
  value,
  responseSets,
  signatures,
  emptyLabel,
}: {
  item: Item;
  value: unknown;
  responseSets: CustomResponseSet[];
  signatures: readonly ReviewSignature[];
  emptyLabel: string;
}) {
  const tStub = useTranslations('inspections.conduct');
  switch (item.type) {
    case 'text':
    case 'date':
    case 'time':
    case 'datetime':
    case 'documentNumber':
    case 'inspectionDate':
    case 'conductedBy': {
      const s = typeof value === 'string' ? value : '';
      return s.length === 0 ? <span className="italic">{emptyLabel}</span> : <span>{s}</span>;
    }
    case 'number': {
      const n = typeof value === 'number' ? value : typeof value === 'string' ? value : '';
      const hasValue = n !== '';
      return hasValue ? (
        <span>
          {n}
          {item.unit !== undefined ? <span className="ml-1 text-xs">{item.unit}</span> : null}
        </span>
      ) : (
        <span className="italic">{emptyLabel}</span>
      );
    }
    case 'checkbox': {
      const b = typeof value === 'boolean' ? value : false;
      return <span>{b ? '✓' : '✗'}</span>;
    }
    case 'slider': {
      const n = typeof value === 'number' ? value : null;
      return n === null ? <span className="italic">{emptyLabel}</span> : <span>{n}</span>;
    }
    case 'multipleChoice': {
      const set = responseSets.find((s) => s.id === item.responseSetId);
      if (set === undefined) return <span className="italic">{emptyLabel}</span>;
      const selectedIds = Array.isArray(value)
        ? (value as string[])
        : typeof value === 'string' && value.length > 0
          ? [value]
          : [];
      if (selectedIds.length === 0) return <span className="italic">{emptyLabel}</span>;
      const labels = selectedIds
        .map((id) => set.options.find((o) => o.id === id)?.label)
        .filter((l): l is string => l !== undefined);
      return <span>{labels.join(', ')}</span>;
    }
    case 'media': {
      const keys: string[] = Array.isArray(value) ? (value as string[]) : [];
      if (keys.length === 0) return <span className="italic">{emptyLabel}</span>;
      return (
        <ul className="space-y-1">
          {keys.map((k) => (
            <li key={k} className="truncate font-mono text-xs">
              {k}
            </li>
          ))}
        </ul>
      );
    }
    case 'signature': {
      const slotSigs = signatures.filter((s) => s.slotId === item.id);
      if (slotSigs.length === 0) return <span className="italic">{emptyLabel}</span>;
      return (
        <ul className="space-y-2">
          {slotSigs
            .slice()
            .sort((a, b) => a.slotIndex - b.slotIndex)
            .map((sig) => (
              <li key={sig.id ?? `${sig.slotId}-${sig.slotIndex}`} className="space-y-1">
                <img
                  src={sig.signatureData}
                  alt={sig.signerName}
                  className="max-h-32 rounded border bg-white"
                />
                <p className="text-xs">
                  {sig.signerName}
                  {sig.signerRole !== null ? ` — ${sig.signerRole}` : ''}
                </p>
              </li>
            ))}
        </ul>
      );
    }
    case 'instruction':
      return null;
    case 'site':
    case 'asset':
    case 'company':
    case 'location':
    case 'annotation':
    case 'table':
      return <span className="italic">{tStub('stubNotice')}</span>;
  }
}

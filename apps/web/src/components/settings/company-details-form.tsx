'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { companyAddressFromNominatim, type NominatimAddressHit } from '../../lib/nominatim-address';
import { useHasPermission } from '../../lib/permissions-context';
import { trpc } from '../../lib/trpc/client';
import { useServerErrorToast } from '../../lib/use-server-error';
import { Button } from '../ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Input } from '../ui/input';
import { Label } from '../ui/label';

/**
 * Every field the letterhead can print, in form order. The list drives
 * the state record AND the mutation payload, so a field added here is a
 * type error until the router input knows it too.
 */
const FIELD_KEYS = [
  'legalName',
  'addressLine1',
  'addressLine2',
  'city',
  'postcode',
  'country',
  'phone',
  'email',
  'website',
  'companyNumber',
  'vatNumber',
] as const;
type FieldKey = (typeof FIELD_KEYS)[number];

export type CompanyDetailsValue = Partial<Record<FieldKey, string>>;

function seed(details: CompanyDetailsValue | null): Record<FieldKey, string> {
  const out = {} as Record<FieldKey, string>;
  for (const key of FIELD_KEYS) out[key] = details?.[key] ?? '';
  return out;
}

/**
 * Company-details editor on the Company settings page. The values feed
 * the letterhead printed on every generated document — permits, risk
 * assessments, FRAs, RAMS packs, incident reports — via
 * `tenants.updateCompanyDetails`. Empty fields simply don't print, so
 * everything here is optional. Edit controls are gated on
 * `org.settings`; the server re-checks.
 */
export function CompanyDetailsCard({ details }: { details: CompanyDetailsValue | null }) {
  const t = useTranslations('settings.company.details');
  const tCompany = useTranslations('settings.company');
  const canManage = useHasPermission('org.settings');
  const utils = trpc.useUtils();
  const onServerError = useServerErrorToast(tCompany('saveError'));

  const [values, setValues] = useState<Record<FieldKey, string>>(() => seed(details));
  useEffect(() => {
    setValues(seed(details));
  }, [details]);

  // Address type-ahead (Nominatim — the same free service and CSP allowance
  // the site location card uses). Typing in "Address line 1" offers full
  // addresses; a pick fills city / postcode / country in one go.
  const [suggestions, setSuggestions] = useState<NominatimAddressHit[]>([]);
  const [showSuggest, setShowSuggest] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);
  const justSelected = useRef(false);

  useEffect(() => {
    const q = values.addressLine1.trim();
    // Skip the refetch right after a pick (we set the field ourselves).
    if (justSelected.current) {
      justSelected.current = false;
      return;
    }
    if (q.length < 3) {
      setSuggestions([]);
      setShowSuggest(false);
      return;
    }
    const ctrl = new AbortController();
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const res = await fetch(
            `https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&limit=5&q=${encodeURIComponent(q)}`,
            { headers: { Accept: 'application/json' }, signal: ctrl.signal },
          );
          if (!res.ok) return;
          const hits = (await res.json()) as NominatimAddressHit[];
          setSuggestions(hits);
          setShowSuggest(hits.length > 0);
          setActiveIdx(-1);
        } catch {
          // aborted or network hiccup — leave the previous suggestions be
        }
      })();
    }, 350);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [values.addressLine1]);

  function selectHit(hit: NominatimAddressHit): void {
    justSelected.current = true;
    const fill = companyAddressFromNominatim(hit);
    // Functional updater (BUG-12): merge over whatever is CURRENTLY typed,
    // and only the fields the hit actually carries — a pick with no
    // postcode must not blank a postcode the admin already entered.
    setValues((prev) => ({ ...prev, ...fill }));
    setSuggestions([]);
    setShowSuggest(false);
    setActiveIdx(-1);
  }

  const update = trpc.tenants.updateCompanyDetails.useMutation({
    onSuccess: () => {
      void utils.tenants.get.invalidate();
      toast.success(t('saved'));
    },
    onError: onServerError,
  });

  // BUG-12: functional updater — a click landing between a keystroke and
  // its re-render must never overwrite what the user is typing.
  const set = (key: FieldKey, value: string): void => {
    setValues((prev) => ({ ...prev, [key]: value }));
  };

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const payload = {} as Record<FieldKey, string>;
    for (const key of FIELD_KEYS) payload[key] = values[key].trim();
    update.mutate(payload);
  }

  const field = (
    key: FieldKey,
    opts: { type?: 'email' | 'tel' | 'url'; hint?: string } = {},
  ): React.JSX.Element => (
    <div className="space-y-1.5">
      <Label htmlFor={`company-${key}`}>{t(key)}</Label>
      <Input
        id={`company-${key}`}
        value={values[key]}
        onChange={(event) => set(key, event.target.value)}
        maxLength={key === 'email' ? 254 : 200}
        disabled={!canManage}
        {...(opts.type !== undefined ? { type: opts.type } : {})}
      />
      {opts.hint !== undefined ? (
        <p className="text-xs text-muted-foreground">{opts.hint}</p>
      ) : null}
    </div>
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('title')}</CardTitle>
        <p className="text-sm text-muted-foreground">{t('subtitle')}</p>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-4">
          {field('legalName', { hint: t('legalNameHint') })}
          <div className="relative space-y-1.5">
            <Label htmlFor="company-addressLine1">{t('addressLine1')}</Label>
            <Input
              id="company-addressLine1"
              value={values.addressLine1}
              onChange={(event) => set('addressLine1', event.target.value)}
              onKeyDown={(event) => {
                if (!showSuggest || suggestions.length === 0) return;
                if (event.key === 'ArrowDown') {
                  event.preventDefault();
                  setActiveIdx((i) => (i + 1) % suggestions.length);
                } else if (event.key === 'ArrowUp') {
                  event.preventDefault();
                  setActiveIdx((i) => (i <= 0 ? suggestions.length - 1 : i - 1));
                } else if (event.key === 'Enter' && activeIdx >= 0) {
                  event.preventDefault();
                  const hit = suggestions[activeIdx];
                  if (hit !== undefined) selectHit(hit);
                } else if (event.key === 'Escape') {
                  setShowSuggest(false);
                }
              }}
              onBlur={() => {
                // Delay so a click on a suggestion (mousedown) lands first.
                setTimeout(() => setShowSuggest(false), 150);
              }}
              onFocus={() => {
                if (suggestions.length > 0) setShowSuggest(true);
              }}
              maxLength={200}
              disabled={!canManage}
              autoComplete="off"
              role="combobox"
              aria-expanded={showSuggest}
              aria-controls="company-address-suggestions"
            />
            <p className="text-xs text-muted-foreground">{t('addressAutofillHint')}</p>
            {showSuggest && suggestions.length > 0 ? (
              <ul
                id="company-address-suggestions"
                role="listbox"
                className="absolute left-0 right-0 top-full z-20 mt-1 max-h-56 overflow-auto rounded-md border bg-popover py-1 shadow-md"
              >
                {suggestions.map((hit, i) => (
                  <li
                    key={`${hit.display_name}-${i}`}
                    role="option"
                    aria-selected={i === activeIdx}
                  >
                    <button
                      type="button"
                      // mousedown, not click: it must beat the input's blur.
                      onMouseDown={(event) => {
                        event.preventDefault();
                        selectHit(hit);
                      }}
                      onMouseEnter={() => setActiveIdx(i)}
                      className={`block w-full px-3 py-1.5 text-left text-sm leading-snug ${
                        i === activeIdx ? 'bg-accent text-accent-foreground' : ''
                      }`}
                    >
                      {hit.display_name}
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
          {field('addressLine2')}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {field('city')}
            {field('postcode')}
          </div>
          {field('country')}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {field('phone', { type: 'tel' })}
            {field('email', { type: 'email' })}
          </div>
          {field('website')}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {field('companyNumber')}
            {field('vatNumber')}
          </div>
          {canManage ? (
            <Button type="submit" disabled={update.isPending}>
              {update.isPending ? t('saving') : t('save')}
            </Button>
          ) : null}
        </form>
      </CardContent>
    </Card>
  );
}

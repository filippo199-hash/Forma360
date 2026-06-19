'use client';

import { Check } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { cn } from '../../lib/cn';
import {
  RESPONSE_COLOR_KEYS,
  type ResponseColorKey,
  responseColorKey,
  responseDotClass,
} from '../../lib/response-colors';

interface ColorSwatchPickerProps {
  /** Current stored colour value (any string; normalised to a palette key). */
  value: string | undefined;
  onChange: (key: ResponseColorKey) => void;
}

/**
 * A compact row of preset colour swatches for a response-set option. Colour
 * is the set's styling (shared across questions); flagging is set per question.
 */
export function ColorSwatchPicker({ value, onChange }: ColorSwatchPickerProps) {
  const t = useTranslations('templates.editor.responseSetsTab');
  const active = responseColorKey(value);

  return (
    <div className="flex items-center gap-1" role="group" aria-label={t('colorLabel')}>
      {RESPONSE_COLOR_KEYS.map((key) => {
        const isActive = key === active;
        return (
          <button
            key={key}
            type="button"
            onClick={() => onChange(key)}
            aria-label={`${t('colorLabel')}: ${key}`}
            aria-pressed={isActive}
            title={key}
            className={cn(
              'flex h-5 w-5 items-center justify-center rounded-full ring-offset-1 transition-transform hover:scale-110',
              responseDotClass(key as ResponseColorKey),
              isActive ? 'ring-2 ring-foreground' : 'ring-0',
            )}
          >
            {isActive ? <Check className="h-3 w-3 text-white" aria-hidden /> : null}
          </button>
        );
      })}
    </div>
  );
}

'use client';

import { Eye, EyeOff } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Input } from '../ui/input';

/**
 * Password field with a show/hide toggle — the one password control every
 * auth surface uses (sign-in, sign-up, invite accept, reset, settings).
 *
 * A visibility toggle instead of a confirm-password field: typos are
 * caught by looking, not by typing the same typo twice, and one field
 * keeps the sign-up funnel short.
 */
export function PasswordInput({
  id,
  value,
  onChange,
  autoComplete,
  required = false,
  autoFocus = false,
  minLength,
  maxLength,
  disabled = false,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  /** "current-password" on sign-in surfaces, "new-password" everywhere else. */
  autoComplete: 'current-password' | 'new-password';
  required?: boolean;
  autoFocus?: boolean;
  minLength?: number;
  maxLength?: number;
  disabled?: boolean;
}) {
  const t = useTranslations('auth.password');
  const [visible, setVisible] = useState(false);

  return (
    <div className="relative">
      <Input
        id={id}
        name={id}
        type={visible ? 'text' : 'password'}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        autoComplete={autoComplete}
        required={required}
        autoFocus={autoFocus}
        {...(minLength !== undefined ? { minLength } : {})}
        {...(maxLength !== undefined ? { maxLength } : {})}
        disabled={disabled}
        className="pr-10"
      />
      <button
        type="button"
        tabIndex={-1}
        aria-label={visible ? t('hide') : t('show')}
        onClick={() => setVisible((v) => !v)}
        className="absolute inset-y-0 right-0 flex items-center px-3 text-muted-foreground hover:text-foreground"
      >
        {visible ? (
          <EyeOff className="h-4 w-4" aria-hidden />
        ) : (
          <Eye className="h-4 w-4" aria-hidden />
        )}
      </button>
    </div>
  );
}

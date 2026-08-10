import { describe, expect, it } from 'vitest';
import {
  buildWhatsAppLinkUrl,
  parseWhatsAppLinkCode,
  whatsAppLinkMessage,
  WHATSAPP_LINK_CODE_LENGTH,
} from './whatsapp-link';

describe('parseWhatsAppLinkCode', () => {
  it('finds the code in the message we pre-type', () => {
    expect(parseWhatsAppLinkCode(whatsAppLinkMessage('LK7F3K9QW2XA'))).toBe('LK7F3K9QW2XA');
  });

  it('still finds it when the sender types around it', () => {
    // People add a greeting or their name before hitting send.
    expect(parseWhatsAppLinkCode('hi! Link my account: LK7F3K9QW2XA thanks — Filippo')).toBe(
      'LK7F3K9QW2XA',
    );
  });

  it('accepts lower case and returns the canonical upper case', () => {
    expect(parseWhatsAppLinkCode('link my account: lk7f3k9qw2xa')).toBe('LK7F3K9QW2XA');
  });

  it('returns null for ordinary conversation', () => {
    expect(parseWhatsAppLinkCode('how many open actions do I have?')).toBeNull();
    expect(parseWhatsAppLinkCode('LK')).toBeNull();
    // Too short to be a code, so not a code.
    expect(parseWhatsAppLinkCode('LK7F3K9QW2')).toBeNull();
  });

  it('does not match a word that merely starts with the prefix', () => {
    // Guards the regex against eating real words — the \b and the fixed
    // length are what keep "LKsomethingelse" from parsing as a code.
    expect(parseWhatsAppLinkCode('LKJHGFDSAQWERTY is not a code')).toBeNull();
  });
});

describe('buildWhatsAppLinkUrl', () => {
  it('strips formatting from the business number and encodes the message', () => {
    const url = buildWhatsAppLinkUrl('+44 7405 582158', 'LK7F3K9QW2XA');
    expect(url).toBe('https://wa.me/447405582158?text=Link%20my%20account%3A%20LK7F3K9QW2XA');
  });

  it('round-trips: the link a user opens carries a code we can parse back', () => {
    const code = 'LK7F3K9QW2XA';
    const url = buildWhatsAppLinkUrl('447405582158', code);
    const sentText = decodeURIComponent(url.split('?text=')[1] ?? '');
    expect(parseWhatsAppLinkCode(sentText)).toBe(code);
    expect(code).toHaveLength(WHATSAPP_LINK_CODE_LENGTH);
  });
});

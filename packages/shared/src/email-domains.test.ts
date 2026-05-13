import { describe, expect, it } from 'vitest';
import { FREE_EMAIL_DOMAINS, getEmailDomain, isFreeEmailDomain } from './email-domains';

describe('getEmailDomain', () => {
  it('returns the lowercase domain for a well-formed address', () => {
    expect(getEmailDomain('alice@Example.COM')).toBe('example.com');
  });

  it('trims surrounding whitespace', () => {
    expect(getEmailDomain('  alice@example.com  ')).toBe('example.com');
  });

  it('returns null for an address with no @', () => {
    expect(getEmailDomain('alice')).toBe(null);
  });

  it('returns null for an empty local part', () => {
    expect(getEmailDomain('@example.com')).toBe(null);
  });

  it('returns null for an empty domain', () => {
    expect(getEmailDomain('alice@')).toBe(null);
  });

  it('returns null when the domain has no dot', () => {
    expect(getEmailDomain('alice@localhost')).toBe(null);
  });

  it('returns null when the domain has whitespace', () => {
    expect(getEmailDomain('alice@ex ample.com')).toBe(null);
  });

  it('uses the last @ as the separator', () => {
    expect(getEmailDomain('weird@local@example.com')).toBe('example.com');
  });
});

describe('isFreeEmailDomain', () => {
  it('returns true for gmail.com', () => {
    expect(isFreeEmailDomain('alice@gmail.com')).toBe(true);
  });

  it('returns true regardless of case', () => {
    expect(isFreeEmailDomain('Alice@GMAIL.com')).toBe(true);
  });

  it('returns true for several common free providers', () => {
    expect(isFreeEmailDomain('user@yahoo.com')).toBe(true);
    expect(isFreeEmailDomain('user@outlook.com')).toBe(true);
    expect(isFreeEmailDomain('user@icloud.com')).toBe(true);
    expect(isFreeEmailDomain('user@proton.me')).toBe(true);
  });

  it('returns false for a business domain', () => {
    expect(isFreeEmailDomain('alice@company.com')).toBe(false);
  });

  it('returns false for malformed input', () => {
    expect(isFreeEmailDomain('not-an-email')).toBe(false);
    expect(isFreeEmailDomain('')).toBe(false);
    expect(isFreeEmailDomain('@example.com')).toBe(false);
  });

  it('does not treat a subdomain of a free provider as free', () => {
    // mail.gmail.com is not literally gmail.com — by design.
    expect(isFreeEmailDomain('user@mail.gmail.com')).toBe(false);
  });
});

describe('FREE_EMAIL_DOMAINS', () => {
  it('contains the expected core providers', () => {
    expect(FREE_EMAIL_DOMAINS.has('gmail.com')).toBe(true);
    expect(FREE_EMAIL_DOMAINS.has('outlook.com')).toBe(true);
    expect(FREE_EMAIL_DOMAINS.has('yahoo.com')).toBe(true);
    expect(FREE_EMAIL_DOMAINS.has('icloud.com')).toBe(true);
  });

  it('does not contain a business example', () => {
    expect(FREE_EMAIL_DOMAINS.has('company.com')).toBe(false);
  });
});

import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Button } from './button';

describe('Button', () => {
  it('renders its children inside a native button by default', () => {
    render(<Button>Click me</Button>);
    const btn = screen.getByRole('button', { name: /click me/i });
    expect(btn.tagName).toBe('BUTTON');
  });

  it('applies the default variant classes', () => {
    render(<Button>Primary</Button>);
    const btn = screen.getByRole('button', { name: /primary/i });
    expect(btn.className).toMatch(/bg-primary/);
    expect(btn.className).toMatch(/text-primary-foreground/);
  });

  it('honours the variant prop', () => {
    render(<Button variant="destructive">Delete</Button>);
    expect(screen.getByRole('button', { name: /delete/i }).className).toMatch(/bg-destructive/);
  });

  it('honours the size prop', () => {
    render(<Button size="sm">Small</Button>);
    const btn = screen.getByRole('button', { name: /small/i });
    expect(btn.className).toMatch(/h-9/);
  });

  it('asChild renders as a slot without nesting a button', () => {
    render(
      <Button asChild>
        <a href="/somewhere">Link</a>
      </Button>,
    );
    const link = screen.getByRole('link', { name: /link/i });
    expect(link.tagName).toBe('A');
    expect(link.getAttribute('href')).toBe('/somewhere');
  });

  it('fires onClick', () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Go</Button>);
    screen.getByRole('button', { name: /go/i }).click();
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});

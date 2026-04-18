/**
 * Minimal root layout for the internal print routes. These routes do
 * not render the main navigation — they produce a bare HTML document
 * Puppeteer rasterises into a PDF.
 */
import type { ReactNode } from 'react';

export default function RenderLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

import { describe, expect, it } from 'vitest';
import { isEmbeddableVideoUrl, parseVideoEmbed } from './video-embed';

describe('parseVideoEmbed — YouTube', () => {
  it('parses watch URLs', () => {
    expect(parseVideoEmbed('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toEqual({
      provider: 'youtube',
      embedUrl: 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ',
    });
  });
  it('parses youtu.be short links', () => {
    expect(parseVideoEmbed('https://youtu.be/dQw4w9WgXcQ?t=10')?.embedUrl).toBe(
      'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ',
    );
  });
  it('parses /shorts/ and /embed/ paths', () => {
    expect(parseVideoEmbed('https://youtube.com/shorts/abc123XYZ_-')?.provider).toBe('youtube');
    expect(parseVideoEmbed('https://www.youtube.com/embed/abc123XYZ_-')?.embedUrl).toContain(
      'youtube-nocookie.com/embed/abc123XYZ_-',
    );
  });
  it('always rewrites to the privacy-preserving nocookie host', () => {
    expect(parseVideoEmbed('http://m.youtube.com/watch?v=dQw4w9WgXcQ')?.embedUrl).toMatch(
      /^https:\/\/www\.youtube-nocookie\.com\/embed\//,
    );
  });
});

describe('parseVideoEmbed — Vimeo', () => {
  it('parses vimeo.com/<id> with do-not-track', () => {
    expect(parseVideoEmbed('https://vimeo.com/123456789')).toEqual({
      provider: 'vimeo',
      embedUrl: 'https://player.vimeo.com/video/123456789?dnt=1',
    });
  });
  it('parses player.vimeo.com/video/<id>', () => {
    expect(parseVideoEmbed('https://player.vimeo.com/video/123456789')?.provider).toBe('vimeo');
  });
});

describe('parseVideoEmbed — rejects anything not whitelisted', () => {
  it.each([
    'https://evil.com/watch?v=dQw4w9WgXcQ',
    'https://notyoutube.com/embed/abc123',
    'javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'https://youtube.com.evil.com/watch?v=abc123',
    'https://www.youtube.com/watch?v=',
    'https://vimeo.com/notanumber',
    'not a url at all',
    '',
  ])('rejects %s', (bad) => {
    expect(parseVideoEmbed(bad)).toBeNull();
    expect(isEmbeddableVideoUrl(bad)).toBe(false);
  });
});

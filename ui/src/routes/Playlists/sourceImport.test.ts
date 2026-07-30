import { describe, expect, it } from 'vitest';
import { extractDroppedSourceInput, extractYouTubeVideoId } from './sourceImport';

describe('YouTube source import parsing', () => {
  it.each([
    ['dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=1', 'dQw4w9WgXcQ'],
    ['https://youtu.be/dQw4w9WgXcQ?si=test', 'dQw4w9WgXcQ'],
    ['https://youtube.com/embed/dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['https://m.youtube.com/shorts/dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
  ])('extracts %s', (input, expected) => {
    expect(extractYouTubeVideoId(input)).toBe(expected);
  });

  it.each([
    '',
    'https://example.com/watch?v=dQw4w9WgXcQ',
    'ftp://youtube.com/watch?v=dQw4w9WgXcQ',
    'https://youtube.com/watch?v=too-short',
  ])('rejects unsupported input %s', (input) => {
    expect(extractYouTubeVideoId(input)).toBeNull();
  });

  it('prefers the first non-comment URI from the standard URI list payload', () => {
    const data = {
      getData: (format: string) =>
        format === 'text/uri-list'
          ? '# browser source\r\nhttps://youtu.be/dQw4w9WgXcQ\r\nhttps://example.com'
          : 'https://youtube.com/watch?v=other-value',
    };

    expect(extractDroppedSourceInput(data)).toBe('https://youtu.be/dQw4w9WgXcQ');
  });

  it('falls back to the standard plain-text payload', () => {
    const data = {
      getData: (format: string) =>
        format === 'text/plain' ? ' dQw4w9WgXcQ ' : '',
    };

    expect(extractDroppedSourceInput(data)).toBe('dQw4w9WgXcQ');
  });
});

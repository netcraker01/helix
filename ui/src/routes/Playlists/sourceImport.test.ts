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

  it('prefers the first non-comment URI from the standard URI list payload', async () => {
    const data = {
      getData: (format: string) =>
        format === 'text/uri-list'
          ? '# browser source\r\nhttps://youtu.be/dQw4w9WgXcQ\r\nhttps://example.com'
          : 'https://youtube.com/watch?v=other-value',
    };

    await expect(extractDroppedSourceInput(data)).resolves.toBe('https://youtu.be/dQw4w9WgXcQ');
  });

  it('falls back to the standard plain-text payload', async () => {
    const data = {
      getData: (format: string) =>
        format === 'text/plain' ? ' dQw4w9WgXcQ ' : '',
    };

    await expect(extractDroppedSourceInput(data)).resolves.toBe('dQw4w9WgXcQ');
  });

  it.each([
    ['URL', 'https://youtu.be/dQw4w9WgXcQ'],
    ['text/x-moz-url', 'https://youtu.be/dQw4w9WgXcQ\nVideo title'],
    ['text', 'Watch https://youtu.be/dQw4w9WgXcQ now'],
    ['text/html', '<a href="https://youtu.be/dQw4w9WgXcQ">Video</a>'],
    ['DownloadURL', 'text/html:Video:https://youtu.be/dQw4w9WgXcQ'],
  ])('extracts a Windows/browser URL from %s', async (mime, payload) => {
    const data = {
      getData: (format: string) => format === mime ? payload : '',
    };

    await expect(extractDroppedSourceInput(data)).resolves.toBe('https://youtu.be/dQw4w9WgXcQ');
  });

  it('does not let a plain-text title hide the HTML link payload', async () => {
    const data = {
      getData: (format: string) => {
        if (format === 'text/plain') return 'Video title';
        if (format === 'text/html') return '<a href="https://youtu.be/dQw4w9WgXcQ">Video title</a>';
        return '';
      },
    };

    await expect(extractDroppedSourceInput(data)).resolves.toBe('https://youtu.be/dQw4w9WgXcQ');
  });

  it('reads string DataTransfer items through getAsString', async () => {
    const data = {
      getData: () => '',
      items: [{
        kind: 'string',
        getAsString: (callback: (value: string) => void) => callback('<a href="https://youtu.be/dQw4w9WgXcQ">Video</a>'),
      }],
    };

    await expect(extractDroppedSourceInput(data)).resolves.toBe('https://youtu.be/dQw4w9WgXcQ');
  });

  it('reads Windows Internet Shortcut files', async () => {
    const data = {
      getData: () => '',
      files: [{
        name: 'Video.url',
        text: async () => '[InternetShortcut]\r\nURL=https://youtu.be/dQw4w9WgXcQ\r\n',
      }],
    };

    await expect(extractDroppedSourceInput(data)).resolves.toBe('https://youtu.be/dQw4w9WgXcQ');
  });

  it('ignores non-shortcut and unreadable files', async () => {
    const data = {
      getData: () => '',
      files: [
        { name: 'track.mp3', text: async () => 'https://youtu.be/dQw4w9WgXcQ' },
        { name: 'broken.url', text: async () => { throw new Error('unreadable'); } },
      ],
    };

    await expect(extractDroppedSourceInput(data)).resolves.toBeNull();
  });
});

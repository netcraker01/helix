const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;

function validVideoId(value: string | null | undefined): string | null {
  const id = value?.trim();
  return id && YOUTUBE_ID.test(id) ? id : null;
}

export function extractYouTubeVideoId(input: string): string | null {
  const value = input.trim();
  const bareId = validVideoId(value);
  if (bareId) return bareId;

  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;

    const host = url.hostname.toLowerCase().replace(/^www\./, '');
    if (host === 'youtu.be') return validVideoId(url.pathname.split('/')[1]);
    if (host !== 'youtube.com' && host !== 'm.youtube.com') return null;

    const queryId = validVideoId(url.searchParams.get('v'));
    if (queryId) return queryId;

    const [kind, id] = url.pathname.split('/').filter(Boolean);
    return kind === 'embed' || kind === 'shorts' ? validVideoId(id) : null;
  } catch {
    return null;
  }
}

export interface TextDropData {
  getData(format: string): string;
  items?: ArrayLike<{
    kind: string;
    getAsString(callback: (value: string) => void): void;
  }>;
  files?: ArrayLike<{
    name: string;
    text(): Promise<string>;
  }>;
}

function firstUri(value: string): string | null {
  const uri = value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line && !line.startsWith('#'));
  return uri || null;
}

function firstUrlLike(value: string): string | null {
  const htmlHref = value.match(/href=["']([^"']+)["']/i)?.[1];
  if (htmlHref) return htmlHref;

  return value.match(/https?:\/\/[^\s"'<>]+/i)?.[0] ?? null;
}

function droppedString(value: string, format?: string): string | null {
  const text = value.trim();
  if (!text) return null;
  if (format === 'text/uri-list') return firstUri(text);
  if (format === 'text/html' || format === 'DownloadURL') {
    return firstUrlLike(text);
  }

  return firstUrlLike(text) ?? validVideoId(text);
}

export async function extractDroppedSourceInput(data: TextDropData): Promise<string | null> {
  for (const format of [
    'text/uri-list',
    'URL',
    'text/x-moz-url',
    'text',
    'text/plain',
    'text/html',
    'DownloadURL',
  ]) {
    const input = droppedString(data.getData(format), format);
    if (input) return input;
  }

  for (const item of Array.from(data.items ?? [])) {
    if (item.kind !== 'string') continue;
    const value = await new Promise<string>((resolve) => item.getAsString(resolve));
    const input = droppedString(value);
    if (input) return input;
  }

  for (const file of Array.from(data.files ?? [])) {
    if (!file.name.toLowerCase().endsWith('.url')) continue;
    try {
      const shortcut = await file.text();
      const input = shortcut.match(/^URL=(.+)$/im)?.[1]?.trim();
      if (input) return firstUrlLike(input) ?? input;
    } catch {
      // Ignore unreadable shortcuts and continue checking the drop payload.
    }
  }

  return null;
}

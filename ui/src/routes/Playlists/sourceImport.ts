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
}

export function extractDroppedSourceInput(data: TextDropData): string | null {
  const uri = data
    .getData('text/uri-list')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line && !line.startsWith('#'));
  if (uri) return uri;

  return data.getData('text/plain').trim() || null;
}

export type SupportedVideoPlatform =
  | 'instagram_reel'
  | 'tiktok_video'
  | 'youtube_short';

const INSTAGRAM_HOSTS = new Set([
  'instagram.com',
  'www.instagram.com',
  'm.instagram.com',
]);

const TIKTOK_HOSTS = new Set([
  'tiktok.com',
  'www.tiktok.com',
  'm.tiktok.com',
  'vm.tiktok.com',
  'vt.tiktok.com',
]);

const YOUTUBE_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
]);

function hasSegment(pathname: string, first: string): boolean {
  const segments = pathname.split('/').filter(Boolean);
  return segments[0] === first && segments.length >= 2;
}

export function detectSupportedVideoPlatform(
  rawUrl: string,
): SupportedVideoPlatform | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }

  if (url.protocol !== 'https:') {
    return null;
  }

  const hostname = url.hostname.toLowerCase();
  const pathname = url.pathname;

  if (INSTAGRAM_HOSTS.has(hostname) && hasSegment(pathname, 'reel')) {
    return 'instagram_reel';
  }

  if (TIKTOK_HOSTS.has(hostname)) {
    if (hostname === 'vm.tiktok.com' || hostname === 'vt.tiktok.com') {
      return pathname !== '/' ? 'tiktok_video' : null;
    }

    if (
      /^\/@[^/]+\/video\/[^/]+\/?$/.test(pathname) ||
      /^\/(?:t|v)\/[^/]+\/?$/.test(pathname)
    ) {
      return 'tiktok_video';
    }
  }

  if (YOUTUBE_HOSTS.has(hostname) && hasSegment(pathname, 'shorts')) {
    return 'youtube_short';
  }

  return null;
}

export function platformLabel(platform: SupportedVideoPlatform): string {
  switch (platform) {
    case 'instagram_reel':
      return 'Instagram Reel';
    case 'tiktok_video':
      return 'TikTok video';
    case 'youtube_short':
      return 'YouTube Short';
  }
}

/** Module-level registry so components can resolve plugin asset URLs without prop-drilling. */

const _urls: Record<string, string> = {};

export function setAssetUrl(name: string, url: string): void {
  _urls[name] = url;
}

export function assetUrl(name: string): string {
  return _urls[name] ?? '';
}

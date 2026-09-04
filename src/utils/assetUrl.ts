// Replaced by the static build; the Bun development server serves from /.
declare const __BASE_PATH__: string;

export function assetUrl(path: string): string {
  const basePath = typeof __BASE_PATH__ === 'undefined' ? '/' : __BASE_PATH__;
  return `${basePath}${path.replace(/^\/+/, '')}`;
}

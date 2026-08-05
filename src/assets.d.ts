/**
 * PNG imports resolve to a data-URI string.
 *
 * esbuild is configured with `loader: { ".png": "dataurl" }` (see
 * esbuild.config.mjs), so `import mark from './x.png'` yields the image inlined
 * as a `data:image/png;base64,...` string. TypeScript has no idea a bundler is
 * involved, so it needs telling — without this the import is a TS2307.
 */
declare module '*.png' {
  const dataUrl: string;
  export default dataUrl;
}

declare module '*.css';
declare module '@fontsource/*' {}
declare module '@fontsource-variable/*' {}

declare module '@vscode/vscode-languagedetection/dist/lib/979.js' {
  type WebpackChunk = {
    id: number;
    ids: number[];
    modules: Record<number, unknown>;
    runtime?: unknown;
  };

  const chunk: WebpackChunk;
  export default chunk;
  export const id: number;
  export const ids: number[];
  export const modules: Record<number, unknown>;
}

import { staticFile } from 'remotion';
// remote URLs pass through; bare paths are files bundled in video/public
export const asset = (s?: string) => (!s ? undefined : /^(https?:|data:|blob:)/.test(s) ? s : staticFile(s.replace(/^\//, '')));

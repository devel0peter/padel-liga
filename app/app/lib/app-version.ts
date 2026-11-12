// The app version stored with feedback (spec 19): the short commit hash of
// the build, set by vite.config.ts at build time. "dev" where the build had
// none (unit tests, a checkout without git).
declare const __APP_VERSION__: string | undefined;

export const APP_VERSION: string = typeof __APP_VERSION__ === "string" && __APP_VERSION__ ? __APP_VERSION__ : "dev";

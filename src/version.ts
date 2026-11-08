/** App version from package.json, injected by Vite at build time ('dev' in unit tests). */
export const APP_VERSION: string = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev';

export {};

declare global {
  interface Window {
    motioncraft?: {
      getAppVersion: () => Promise<string>;
    };
  }
}
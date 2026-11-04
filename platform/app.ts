export interface DesktopBridge {
  getAppVersion: () => Promise<string>;
}

// A missing bridge is expected during browser development and server rendering.
export async function getAppVersion(): Promise<string | null> {
  if (typeof window === "undefined" || !window.motioncraft) return null;

  const version = await window.motioncraft.getAppVersion();
  if (typeof version !== "string" || !version.trim()) {
    throw new Error("The main process returned an invalid app version.");
  }
  return version;
}

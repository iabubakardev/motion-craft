import type { DesktopBridge } from "@/platform/app";

declare global {
  interface Window {
    motioncraft?: DesktopBridge;
  }
}

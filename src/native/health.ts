import { invoke } from "@tauri-apps/api/core";
import type { RuntimeHealth } from "../types/runtime";

export function getRuntimeHealth(): Promise<RuntimeHealth> {
  return invoke<RuntimeHealth>("health_check");
}

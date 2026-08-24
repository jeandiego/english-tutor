export type RuntimeHealth = {
  appStatus: "ready";
  operatingSystem: string;
  architecture: string;
};

export type HealthState =
  | { status: "checking" }
  | { status: "ready"; health: RuntimeHealth }
  | { status: "error"; message: string };

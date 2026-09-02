export type JourneyCheckpointKind =
  | "conversation"
  | "writing"
  | "reading"
  | "assessment"
  | "chunk_attempt";

export type JourneyCheckpoint = {
  id: string;
  kind: JourneyCheckpointKind;
  refId: number;
  createdAt: number;
  headline: string;
  detail?: string;
  needsReview: boolean;
};

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { listActiveLexicalChunks } from "../native/chunk";
import { listJourneyCheckpoints } from "../native/journey";
import { chunkKeys } from "../queryKeys/chunk";
import { journeyKeys } from "../queryKeys/journey";
import { computeJourneyProgression } from "../journey/progression";
import { JourneyScene } from "../journey/JourneyScene";
import type { CefrLevel } from "../types/assessment";
import type { JourneyCheckpoint } from "../types/journey";
import { JourneyCheckpointSheet } from "./JourneyCheckpointSheet";

const MASTERED_CHUNKS_LIMIT = 500;

type JourneyPageProps = {
  estimatedLevel?: CefrLevel;
  onOpenConversation: (sessionId: number) => void;
};

export function JourneyPage({ estimatedLevel, onOpenConversation }: JourneyPageProps) {
  const [selectedCheckpoint, setSelectedCheckpoint] = useState<JourneyCheckpoint | undefined>();

  const checkpointsQuery = useQuery({
    queryKey: journeyKeys.checkpoints(),
    queryFn: () => listJourneyCheckpoints(),
  });
  const chunksQuery = useQuery({
    queryKey: chunkKeys.active(MASTERED_CHUNKS_LIMIT),
    queryFn: () => listActiveLexicalChunks(MASTERED_CHUNKS_LIMIT),
  });

  const masteredChunkCount = useMemo(
    () =>
      (chunksQuery.data ?? []).filter(
        (chunk) => chunk.productiveStatus === "used_independently" || chunk.productiveStatus === "automatic",
      ).length,
    [chunksQuery.data],
  );

  const progression = computeJourneyProgression({
    checkpointCount: checkpointsQuery.data?.length ?? 0,
    estimatedLevel,
    masteredChunkCount,
  });

  if (checkpointsQuery.isPending) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center">
        <p className="text-caption text-muted-foreground">Loading your journey…</p>
      </div>
    );
  }

  if (checkpointsQuery.isError) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center">
        <p className="text-caption text-destructive">Your journey could not be loaded.</p>
      </div>
    );
  }

  if (checkpointsQuery.data.length === 0) {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
        <p className="text-body text-foreground">Your journey starts here</p>
        <p className="max-w-sm text-caption text-muted-foreground">
          Complete a conversation, writing task, reading session, or level check and your first
          checkpoint will appear on the path.
        </p>
      </div>
    );
  }

  return (
    <div className="relative min-h-0 flex-1">
      <JourneyScene
        checkpoints={checkpointsQuery.data}
        onSelectCheckpoint={setSelectedCheckpoint}
        unlockedAccessories={progression.unlockedAccessories}
      />
      <JourneyCheckpointSheet
        checkpoint={selectedCheckpoint}
        onOpenChange={(open) => {
          if (!open) setSelectedCheckpoint(undefined);
        }}
        onOpenConversation={onOpenConversation}
      />
    </div>
  );
}

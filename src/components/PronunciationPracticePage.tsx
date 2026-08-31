import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { usePronunciationPractice } from "../hooks/usePronunciationPractice";
import { listPronunciationTargets } from "../native/pronunciation";
import { pronunciationKeys } from "../queryKeys/pronunciation";
import type { PronunciationProblemCategory, WordDiffOp } from "../types/pronunciation";
import { Badge } from "./ui/badge";
import { Card, CardContent, CardHeader } from "./ui/card";
import { TalkControl } from "./TalkControl";

const TARGETS_LIMIT = 20;

const CATEGORY_LABELS: Record<PronunciationProblemCategory, string> = {
  word_stress: "Word stress",
  final_consonants: "Final consonants",
  vowel_contrast: "Vowel sound",
  connected_speech: "Connected speech",
  rhythm: "Rhythm",
  specific_word: "Specific word",
};

function DiffPreview({ diff }: { diff: WordDiffOp[] }) {
  return (
    <p className="text-body leading-relaxed">
      {diff.map((op, index) => {
        if (op.op === "inserted") {
          return null;
        }
        if (op.op === "omitted") {
          return (
            <span className="text-destructive line-through decoration-2" key={index}>
              {op.expected}{" "}
            </span>
          );
        }
        if (op.op === "substituted") {
          return (
            <span className="font-medium text-warning" key={index}>
              {op.expected}{" "}
            </span>
          );
        }
        return <span key={index}>{op.expected} </span>;
      })}
    </p>
  );
}

function TargetPicker({
  disabled,
  onSelect,
  selectedId,
}: {
  disabled: boolean;
  onSelect: (id: number) => void;
  selectedId: number | null;
}) {
  const targetsQuery = useQuery({
    queryKey: pronunciationKeys.targets(TARGETS_LIMIT),
    queryFn: () => listPronunciationTargets(TARGETS_LIMIT),
  });

  if (targetsQuery.isPending) {
    return <p className="text-body text-muted-foreground">Loading…</p>;
  }

  if (targetsQuery.isError) {
    return (
      <p className="text-body text-destructive" role="alert">
        Pronunciation targets could not be loaded.
      </p>
    );
  }

  if (targetsQuery.data.length === 0) {
    return (
      <p className="text-body text-muted-foreground">
        No pronunciation targets yet — finish a conversation and the tutor will flag phrases worth
        practicing here.
      </p>
    );
  }

  return (
    <ul className="flex flex-col divide-y divide-border">
      {targetsQuery.data.map((target) => (
        <li key={target.id}>
          <button
            aria-pressed={selectedId === target.id}
            className="flex w-full flex-col gap-1 py-3 text-left first:pt-0 last:pb-0 disabled:pointer-events-none disabled:opacity-50"
            disabled={disabled}
            onClick={() => onSelect(target.id)}
            type="button"
          >
            <span className="text-body font-medium text-foreground">“{target.phrase}”</span>
            <span className="flex items-center gap-2 text-caption text-muted-foreground">
              {target.attemptCount === 0
                ? "Not practiced yet"
                : `${target.attemptCount} attempt${target.attemptCount === 1 ? "" : "s"}`}
              {target.isPromoted && <Badge variant="secondary">In spaced review</Badge>}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function PracticePanel({
  disabled,
  disabledHint,
  phrase,
  targetId,
}: {
  disabled: boolean;
  disabledHint?: string;
  phrase: string;
  targetId: number;
}) {
  const { attemptHistory, practiceState, pushToTalk, selectTarget } = usePronunciationPractice({
    enabled: !disabled,
  });

  useEffect(() => {
    selectTarget(targetId);
  }, [targetId, selectTarget]);

  const previousAttempt = attemptHistory[attemptHistory.length - 2];
  const latestAttempt = attemptHistory[attemptHistory.length - 1];
  const improved = Boolean(previousAttempt && !previousAttempt.isMatch && latestAttempt?.isMatch);

  return (
    <Card>
      <CardHeader>
        <h3 className="text-body-lg font-medium text-foreground">“{phrase}”</h3>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <TalkControl
          disabled={disabled || pushToTalk.state.status === "transcribing"}
          disabledHint={disabledHint}
          onEnd={(owner) => void pushToTalk.end(owner)}
          onStart={(owner) => void pushToTalk.begin(owner)}
          state={pushToTalk.state}
        />

        {practiceState.status === "submitting" && (
          <p className="text-body text-muted-foreground">Checking your attempt…</p>
        )}

        {practiceState.status === "error" && (
          <p className="text-body text-destructive" role="alert">
            {practiceState.error.message}
          </p>
        )}

        {practiceState.status === "result" && (
          <div className="flex flex-col gap-2 rounded-[var(--radius-cards)] bg-card p-3 shadow-[0_1px_2px_rgba(0,0,0,0.08)]">
            <div className="flex items-center gap-2">
              <Badge variant={practiceState.result.isMatch ? "success" : "warning"}>
                {practiceState.result.isMatch
                  ? "Clear"
                  : practiceState.result.category
                    ? CATEGORY_LABELS[practiceState.result.category]
                    : "Needs practice"}
              </Badge>
              {practiceState.result.promoted && (
                <Badge variant="secondary">Added to spaced review</Badge>
              )}
            </div>
            <DiffPreview diff={practiceState.result.diff} />
            <p className="text-caption text-muted-foreground">{practiceState.result.hint}</p>
            {attemptHistory.length > 1 && (
              <p className="text-caption text-muted-foreground">
                Attempt {attemptHistory.length}
                {improved ? " — better!" : ""}
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function PronunciationPracticePage({
  disabled,
  disabledHint,
}: {
  disabled: boolean;
  disabledHint?: string;
}) {
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const targetsQuery = useQuery({
    queryKey: pronunciationKeys.targets(TARGETS_LIMIT),
    queryFn: () => listPronunciationTargets(TARGETS_LIMIT),
  });
  const selectedTarget = targetsQuery.data?.find((target) => target.id === selectedId) ?? null;

  return (
    <section aria-labelledby="pronunciation-title" className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-8 p-6">
        <h2 className="text-subheading font-semibold text-foreground" id="pronunciation-title">
          Pronunciation practice
        </h2>

        <Card>
          <CardHeader>
            <h3 className="text-body-lg font-medium text-foreground">Phrases to practice</h3>
          </CardHeader>
          <CardContent>
            <TargetPicker disabled={disabled} onSelect={setSelectedId} selectedId={selectedId} />
          </CardContent>
        </Card>

        {selectedTarget && (
          <PracticePanel
            disabled={disabled}
            disabledHint={disabledHint}
            key={selectedTarget.id}
            phrase={selectedTarget.phrase}
            targetId={selectedTarget.id}
          />
        )}
      </div>
    </section>
  );
}

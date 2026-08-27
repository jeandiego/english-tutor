import { IconX } from "@tabler/icons-react";
import { useState } from "react";
import { COMPETENCY_LABELS, levelLabel } from "../assessment/labels";
import { useLearnerProfile } from "../hooks/useLearnerProfile";
import type { AssessmentCompetency } from "../types/assessment";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card, CardContent, CardHeader } from "./ui/card";
import { Input } from "./ui/input";

function LevelChip({ level }: { level: string }) {
  return <Badge variant="secondary">{level}</Badge>;
}

function EditableTagList({
  label,
  placeholder,
  values,
  onChange,
  disabled,
}: {
  label: string;
  placeholder: string;
  values: string[];
  onChange: (values: string[]) => void;
  disabled: boolean;
}) {
  const [draftValue, setDraftValue] = useState("");

  function addValue() {
    const trimmed = draftValue.trim();
    if (trimmed.length === 0) {
      return;
    }
    onChange([...values, trimmed]);
    setDraftValue("");
  }

  return (
    <div className="flex flex-col gap-3">
      {values.length === 0 ? (
        <p className="text-body text-muted-foreground">No {label.toLowerCase()} yet.</p>
      ) : (
        <ul className="flex flex-wrap gap-2">
          {values.map((value, index) => (
            <li key={`${value}-${index}`}>
              <Badge className="gap-1 pr-1" variant="outline">
                {value}
                <button
                  aria-label={`Remove ${value}`}
                  className="rounded-[2px] p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
                  disabled={disabled}
                  onClick={() => onChange(values.filter((_, i) => i !== index))}
                  type="button"
                >
                  <IconX className="size-3" />
                </button>
              </Badge>
            </li>
          ))}
        </ul>
      )}
      <div className="flex gap-2">
        <Input
          aria-label={`Add ${label.toLowerCase()}`}
          className="flex-1"
          disabled={disabled}
          onChange={(event) => setDraftValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              addValue();
            }
          }}
          placeholder={placeholder}
          type="text"
          value={draftValue}
        />
        <Button
          aria-label={`Add ${label.toLowerCase()}`}
          disabled={disabled || draftValue.trim().length === 0}
          onClick={addValue}
          type="button"
          variant="outline"
        >
          Add
        </Button>
      </div>
    </div>
  );
}

function ProgressSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <h3 className="text-body-lg font-medium text-foreground">{title}</h3>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">{children}</CardContent>
    </Card>
  );
}

export function ProgressPage() {
  const { state, draft, setDraft, dirty, save, reset } = useLearnerProfile();

  if (state.status === "checking") {
    return (
      <section
        aria-labelledby="progress-title"
        className="mx-auto flex w-full max-w-2xl flex-col gap-6 overflow-y-auto p-6"
      >
        <h2 className="text-subheading font-semibold text-foreground" id="progress-title">
          My Progress
        </h2>
        <p className="text-body text-muted-foreground">Loading…</p>
      </section>
    );
  }

  if (state.status === "error") {
    return (
      <section
        aria-labelledby="progress-title"
        className="mx-auto flex w-full max-w-2xl flex-col gap-6 overflow-y-auto p-6"
      >
        <h2 className="text-subheading font-semibold text-foreground" id="progress-title">
          My Progress
        </h2>
        <p className="text-body text-destructive" role="alert">
          {state.message}
        </p>
      </section>
    );
  }

  const { profile, saving, saveError } = state;
  const dimensionEntries = Object.entries(profile.dimensionLevels) as Array<
    [AssessmentCompetency, string]
  >;

  return (
    <section
      aria-labelledby="progress-title"
      className="mx-auto flex w-full max-w-2xl flex-col gap-8 overflow-y-auto p-6"
    >
      <h2 className="text-subheading font-semibold text-foreground" id="progress-title">
        My Progress
      </h2>

      <div className="flex flex-col gap-6">
        <ProgressSection title="Current level">
          <LevelChip level={levelLabel(profile.currentLevel)} />
          {dimensionEntries.length > 0 && (
            <ul className="flex flex-col divide-y divide-border">
              {dimensionEntries.map(([competency, level]) => (
                <li
                  className="flex items-center justify-between py-2 first:pt-0 last:pb-0"
                  key={competency}
                >
                  <span className="text-body text-foreground">
                    {COMPETENCY_LABELS[competency]}
                  </span>
                  <LevelChip level={level} />
                </li>
              ))}
            </ul>
          )}
        </ProgressSection>

        <ProgressSection title="Recurring focus areas">
          {profile.recurringIssues.length === 0 ? (
            <p className="text-body text-muted-foreground">
              No repeated mistakes yet — keep practicing to build this up.
            </p>
          ) : (
            <ul className="flex flex-col divide-y divide-border">
              {profile.recurringIssues.map((issue) => (
                <li
                  className="flex items-center justify-between py-2 first:pt-0 last:pb-0"
                  key={issue.category}
                >
                  <span className="text-body text-foreground">{issue.label}</span>
                  <span className="text-caption text-muted-foreground">{issue.count}</span>
                </li>
              ))}
            </ul>
          )}
        </ProgressSection>

        <ProgressSection title="Vocabulary in practice">
          {profile.activeVocabulary.length === 0 ? (
            <p className="text-body text-muted-foreground">No recent suggestions yet.</p>
          ) : (
            <ul className="flex flex-col divide-y divide-border">
              {profile.activeVocabulary.map((item, index) => (
                <li className="py-2 text-body text-foreground first:pt-0 last:pb-0" key={index}>
                  {item.suggestion}
                </li>
              ))}
            </ul>
          )}
        </ProgressSection>

        <ProgressSection title="Goals">
          <EditableTagList
            disabled={saving}
            label="Goals"
            onChange={(goals) => setDraft({ ...draft, goals })}
            placeholder="e.g. prepare for software engineering interviews"
            values={draft.goals}
          />
        </ProgressSection>

        <ProgressSection title="Preferred scenarios">
          <EditableTagList
            disabled={saving}
            label="Preferred scenarios"
            onChange={(preferredScenarios) => setDraft({ ...draft, preferredScenarios })}
            placeholder="e.g. job interviews"
            values={draft.preferredScenarios}
          />
        </ProgressSection>

        <ProgressSection title="Target accents">
          <EditableTagList
            disabled={saving}
            label="Target accents"
            onChange={(targetAccents) => setDraft({ ...draft, targetAccents })}
            placeholder="e.g. American English"
            values={draft.targetAccents}
          />
        </ProgressSection>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
          {saveError && (
            <p className="text-caption text-destructive" role="alert">
              {saveError}
            </p>
          )}
          <div className="ml-auto flex gap-2">
            <Button disabled={!dirty || saving} onClick={reset} type="button" variant="outline">
              Reset
            </Button>
            <Button disabled={!dirty || saving} onClick={() => void save()} type="button">
              Save
            </Button>
          </div>
        </div>

        <ProgressSection title="Progress notes">
          {profile.progressNotes.length === 0 ? (
            <p className="text-body text-muted-foreground">No notes yet.</p>
          ) : (
            <ul className="flex flex-col divide-y divide-border">
              {[...profile.progressNotes].reverse().map((note, index) => (
                <li
                  className="flex flex-col gap-0.5 py-2 first:pt-0 last:pb-0"
                  key={index}
                >
                  <span className="text-caption text-muted-foreground">
                    {new Date(note.createdAt).toLocaleDateString(undefined, {
                      dateStyle: "medium",
                    })}
                  </span>
                  <span className="text-body text-foreground">{note.text}</span>
                </li>
              ))}
            </ul>
          )}
        </ProgressSection>
      </div>
    </section>
  );
}

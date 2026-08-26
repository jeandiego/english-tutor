import { useEffect, useState } from "react";
import type { CefrLevel } from "../types/assessment";
import { useSessionRun } from "../hooks/useSessionRun";
import { getLearnerProfile } from "../native/learnerProfile";
import {
  DURATION_PRESETS,
  SESSION_TEMPLATES,
  type DurationPresetId,
  type SessionTemplate,
} from "../sessions/catalog";
import { ConversationStage } from "./ConversationStage";
import { TalkControl } from "./TalkControl";

type SessionsPageProps = {
  disabled: boolean;
  disabledHint?: string;
};

const CEFR_LEVELS: CefrLevel[] = ["A1", "A2", "B1", "B2", "C1", "C2"];

function SessionCatalog({
  defaultDifficulty,
  disabled,
  disabledHint,
  onStart,
}: {
  defaultDifficulty?: CefrLevel;
  disabled: boolean;
  disabledHint?: string;
  onStart: (
    template: SessionTemplate,
    options: { difficulty: CefrLevel; focus?: string; durationPresetId: DurationPresetId },
  ) => void;
}) {
  const [selectedId, setSelectedId] = useState<string | undefined>();
  const [difficulty, setDifficulty] = useState<CefrLevel>(defaultDifficulty ?? "B1");
  const [focus, setFocus] = useState("");
  const [durationPresetId, setDurationPresetId] = useState<DurationPresetId>("standard");

  useEffect(() => {
    if (defaultDifficulty) {
      setDifficulty(defaultDifficulty);
    }
  }, [defaultDifficulty]);

  const selectedTemplate = SESSION_TEMPLATES.find((template) => template.id === selectedId);

  return (
    <div className="sessions-catalog">
      <p className="sessions-catalog__intro">
        Pick a scenario for a short guided conversation with a clear objective and a
        closing summary.
      </p>

      <ul className="sessions-catalog__grid">
        {SESSION_TEMPLATES.map((template) => (
          <li key={template.id}>
            <button
              aria-pressed={selectedId === template.id}
              className={
                selectedId === template.id
                  ? "sessions-catalog__card sessions-catalog__card--selected"
                  : "sessions-catalog__card"
              }
              onClick={() => setSelectedId(template.id)}
              type="button"
            >
              <span className="sessions-catalog__card-label">{template.label}</span>
              <span className="sessions-catalog__card-description">
                {template.description}
              </span>
            </button>
          </li>
        ))}
      </ul>

      {selectedTemplate && (
        <div className="sessions-catalog__options">
          <label className="sessions-catalog__field">
            <span>Difficulty</span>
            <select
              onChange={(event) => setDifficulty(event.target.value as CefrLevel)}
              value={difficulty}
            >
              {CEFR_LEVELS.map((level) => (
                <option key={level} value={level}>
                  {level}
                </option>
              ))}
            </select>
          </label>

          <label className="sessions-catalog__field">
            <span>Duration</span>
            <select
              onChange={(event) =>
                setDurationPresetId(event.target.value as DurationPresetId)
              }
              value={durationPresetId}
            >
              {DURATION_PRESETS.map((preset) => (
                <option key={preset.id} value={preset.id}>
                  {preset.label} ({preset.approxMinutes})
                </option>
              ))}
            </select>
          </label>

          <label className="sessions-catalog__field sessions-catalog__field--wide">
            <span>Focus (optional)</span>
            <input
              onChange={(event) => setFocus(event.target.value)}
              placeholder={selectedTemplate.focusPlaceholder}
              type="text"
              value={focus}
            />
          </label>

          <button
            className="assessment-start-button"
            disabled={disabled}
            onClick={() =>
              onStart(selectedTemplate, {
                difficulty,
                focus: focus.trim() || undefined,
                durationPresetId,
              })
            }
            type="button"
          >
            Start session
          </button>
          {disabled && disabledHint && (
            <p className="assessment-disabled-hint">{disabledHint}</p>
          )}
        </div>
      )}
    </div>
  );
}

function SessionSummaryView({
  run,
  onBackToCatalog,
}: {
  run: ReturnType<typeof useSessionRun>;
  onBackToCatalog: () => void;
}) {
  const summary = run.summary;

  return (
    <div className="sessions-complete">
      <h3>{run.template?.label} — session summary</h3>
      {summary ? (
        <div className="assessment-result__summary">
          {summary.whatWentWell.length > 0 && (
            <div className="assessment-result__summary-section">
              <h4>What went well</h4>
              <ul>
                {summary.whatWentWell.map((item, index) => (
                  <li key={index}>{item}</li>
                ))}
              </ul>
            </div>
          )}
          <div className="assessment-result__summary-section">
            <h4>Priorities to work on</h4>
            <ul>
              {summary.priorityIssues.map((item, index) => (
                <li key={index}>{item}</li>
              ))}
            </ul>
          </div>
          {summary.alternativePhrases.length > 0 && (
            <div className="assessment-result__summary-section">
              <h4>Better ways to say it</h4>
              <ul>
                {summary.alternativePhrases.map((phrase, index) => (
                  <li key={index}>
                    {phrase.original && <>“{phrase.original}” → </>}“{phrase.suggestion}”
                  </li>
                ))}
              </ul>
            </div>
          )}
          {summary.reviewItems.length > 0 && (
            <div className="assessment-result__summary-section">
              <h4>Review later</h4>
              <ul>
                {summary.reviewItems.map((item, index) => (
                  <li key={index}>{item}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      ) : (
        <p className="history-empty">
          The session was saved, but a written summary isn't available this time.
        </p>
      )}
      <button className="assessment-start-button" onClick={onBackToCatalog} type="button">
        Back to catalog
      </button>
    </div>
  );
}

export function SessionsPage({ disabled, disabledHint }: SessionsPageProps) {
  const [defaultDifficulty, setDefaultDifficulty] = useState<CefrLevel | undefined>();
  const run = useSessionRun({ enabled: !disabled });

  useEffect(() => {
    void getLearnerProfile()
      .then((profile) => setDefaultDifficulty(profile.currentLevel))
      .catch(() => setDefaultDifficulty(undefined));
  }, []);

  const talkControlDisabled = disabled || run.status !== "active";

  return (
    <section className="sessions-page" aria-labelledby="sessions-title">
      <h2 id="sessions-title">Sessions</h2>

      {run.status === "catalog" && (
        <SessionCatalog
          defaultDifficulty={defaultDifficulty}
          disabled={disabled}
          disabledHint={disabledHint}
          onStart={(template, options) => void run.start(template, options)}
        />
      )}

      {run.status === "starting" && (
        <div className="recording-status recording-status--processing" role="status">
          <span className="recording-status__mark" aria-hidden="true" />
          <p>Setting the scene</p>
          <span className="recording-status__time">Preparing {run.template?.label}</span>
        </div>
      )}

      {(run.status === "active" || run.status === "finishing") && (
        <div className="sessions-active">
          <div className="sessions-active__header">
            <span className="local-status">{run.template?.label}</span>
            {run.targetTurns !== undefined && (
              <span className="sessions-active__progress">
                Turn {run.turnCount} of ~{run.targetTurns}
              </span>
            )}
            <div className="sessions-active__actions">
              <button
                className="assessment-start-button"
                disabled={run.status !== "active" || run.turnCount === 0}
                onClick={() => void run.finish()}
                type="button"
              >
                Finish session
              </button>
              <button
                className="sessions-active__abandon"
                disabled={run.status !== "active"}
                onClick={() => void run.abandon()}
                type="button"
              >
                Abandon
              </button>
            </div>
          </div>

          <ConversationStage
            exchanges={run.conversation.exchanges}
            loopState={run.conversation.loopState}
            showCoaching={false}
            speaking={run.conversation.speaking}
            state={run.conversation.state}
            thinking={run.conversation.thinking}
          />

          {run.status === "finishing" ? (
            <div className="recording-status recording-status--processing" role="status">
              <span className="recording-status__mark" aria-hidden="true" />
              <p>Writing your session summary…</p>
            </div>
          ) : (
            <TalkControl
              disabled={talkControlDisabled}
              disabledHint={disabledHint}
              onEnd={(owner) => void run.conversation.end(owner)}
              onStart={(owner) => void run.conversation.begin(owner)}
              speaking={run.conversation.speaking}
              state={run.conversation.state}
              thinking={run.conversation.thinking}
            />
          )}
        </div>
      )}

      {run.status === "error" && run.error && (
        <div className="recording-error" role="alert">
          <p className="recording-error__title">Session unavailable</p>
          <p>{run.error.message}</p>
          {run.error.technicalMessage !== run.error.message && (
            <details>
              <summary>Technical details</summary>
              <code>{run.error.technicalMessage}</code>
            </details>
          )}
          <button className="assessment-start-button" onClick={() => run.reset()} type="button">
            Back to catalog
          </button>
        </div>
      )}

      {run.status === "complete" && (
        <SessionSummaryView run={run} onBackToCatalog={() => run.reset()} />
      )}
    </section>
  );
}

import { useState } from "react";
import { COMPETENCY_LABELS, levelLabel } from "../assessment/labels";
import { useLearnerProfile } from "../hooks/useLearnerProfile";
import type { AssessmentCompetency } from "../types/assessment";

function LevelChip({ level }: { level: string }) {
  return <span className="local-status assessment-level-chip">{level}</span>;
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
    <div className="progress-tag-editor">
      {values.length === 0 ? (
        <p className="progress-empty">No {label.toLowerCase()} yet.</p>
      ) : (
        <ul className="progress-tag-list">
          {values.map((value, index) => (
            <li className="progress-tag" key={`${value}-${index}`}>
              <span>{value}</span>
              <button
                aria-label={`Remove ${value}`}
                className="progress-tag__remove"
                disabled={disabled}
                onClick={() => onChange(values.filter((_, i) => i !== index))}
                type="button"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="progress-add-row">
        <input
          aria-label={`Add ${label.toLowerCase()}`}
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
        <button
          aria-label={`Add ${label.toLowerCase()}`}
          className="settings-button"
          disabled={disabled || draftValue.trim().length === 0}
          onClick={addValue}
          type="button"
        >
          Add
        </button>
      </div>
    </div>
  );
}

export function ProgressPage() {
  const { state, draft, setDraft, dirty, save, reset } = useLearnerProfile();

  if (state.status === "checking") {
    return (
      <section className="progress-page" aria-labelledby="progress-title">
        <h2 id="progress-title">My Progress</h2>
        <p className="progress-empty">Loading…</p>
      </section>
    );
  }

  if (state.status === "error") {
    return (
      <section className="progress-page" aria-labelledby="progress-title">
        <h2 id="progress-title">My Progress</h2>
        <p className="progress-empty" role="alert">
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
    <section className="progress-page" aria-labelledby="progress-title">
      <h2 id="progress-title">My Progress</h2>

      <div className="progress-sections">
        <section className="progress-section">
          <h3>Current level</h3>
          <LevelChip level={levelLabel(profile.currentLevel)} />
          {dimensionEntries.length > 0 && (
            <ul className="progress-list">
              {dimensionEntries.map(([competency, level]) => (
                <li className="progress-list-item" key={competency}>
                  <span>{COMPETENCY_LABELS[competency]}</span>
                  <LevelChip level={level} />
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="progress-section">
          <h3>Recurring focus areas</h3>
          {profile.recurringIssues.length === 0 ? (
            <p className="progress-empty">
              No repeated mistakes yet — keep practicing to build this up.
            </p>
          ) : (
            <ul className="progress-list">
              {profile.recurringIssues.map((issue) => (
                <li className="progress-list-item" key={issue.category}>
                  <span>{issue.label}</span>
                  <span className="progress-list-item__count">{issue.count}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="progress-section">
          <h3>Vocabulary in practice</h3>
          {profile.activeVocabulary.length === 0 ? (
            <p className="progress-empty">No recent suggestions yet.</p>
          ) : (
            <ul className="progress-list">
              {profile.activeVocabulary.map((item, index) => (
                <li className="progress-list-item" key={index}>
                  <span>{item.suggestion}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="progress-section">
          <h3>Goals</h3>
          <EditableTagList
            disabled={saving}
            label="Goals"
            onChange={(goals) => setDraft({ ...draft, goals })}
            placeholder="e.g. prepare for software engineering interviews"
            values={draft.goals}
          />
        </section>

        <section className="progress-section">
          <h3>Preferred scenarios</h3>
          <EditableTagList
            disabled={saving}
            label="Preferred scenarios"
            onChange={(preferredScenarios) =>
              setDraft({ ...draft, preferredScenarios })
            }
            placeholder="e.g. job interviews"
            values={draft.preferredScenarios}
          />
        </section>

        <section className="progress-section">
          <h3>Target accents</h3>
          <EditableTagList
            disabled={saving}
            label="Target accents"
            onChange={(targetAccents) => setDraft({ ...draft, targetAccents })}
            placeholder="e.g. American English"
            values={draft.targetAccents}
          />
        </section>

        <div className="settings-form__footer">
          <p role={saveError ? "alert" : undefined}>{saveError ?? ""}</p>
          <div className="settings-form__actions">
            <button
              className="settings-button"
              disabled={!dirty || saving}
              onClick={reset}
              type="button"
            >
              Reset
            </button>
            <button
              className="settings-button settings-button--primary"
              disabled={!dirty || saving}
              onClick={() => void save()}
              type="button"
            >
              Save
            </button>
          </div>
        </div>

        <section className="progress-section">
          <h3>Progress notes</h3>
          {profile.progressNotes.length === 0 ? (
            <p className="progress-empty">No notes yet.</p>
          ) : (
            <ul className="progress-notes">
              {[...profile.progressNotes]
                .reverse()
                .map((note, index) => (
                  <li className="progress-note" key={index}>
                    <span className="progress-note__date">
                      {new Date(note.createdAt).toLocaleDateString(undefined, {
                        dateStyle: "medium",
                      })}
                    </span>
                    <span>{note.text}</span>
                  </li>
                ))}
            </ul>
          )}
        </section>
      </div>
    </section>
  );
}

# Slice 07 — Local Session History and Learner Signals

## Objective

Persist useful learning data locally so future sessions can adapt to recurring weaknesses.

This slice must remain local-only.

## Storage

Use SQLite.

Persist only information useful for the learning experience.

Suggested entities:

### Session

- id
- startedAt
- endedAt
- optional mode/topic

### Turn

- id
- sessionId
- role
- text
- timestamp

### Correction

- id
- turnId
- original
- correction
- explanation
- category
- severity

Do not persist raw microphone audio by default.

## Learner signals

Create a simple derived summary of recurring correction categories.

Do not build a complicated ML recommendation engine.

An initial summary may track counts such as:

```text
grammar/present-perfect
grammar/articles
grammar/prepositions
vocabulary/collocation
naturalness
clarity
```

Only add finer-grained labels when they can be generated consistently.

## Tutor adaptation

At the beginning of a session, provide the tutor a short local learner context based on recent recurring issues.

Example concept:

```text
The learner has recently repeated mistakes involving
for/since and articles.

Do not drill these explicitly.
When natural, create conversation opportunities where
these structures may appear.
```

Do not expose this internal instruction as part of the spoken conversation.

## Privacy

Everything stays on device.

No telemetry.

No account.

No cloud sync.

No persisted audio.

## UI

Add a minimal session history or "recent learning" view showing useful information such as:

- recent sessions
- recurring correction categories
- recent useful expressions

Keep it secondary to the conversation screen.

## Non-goals

Do not implement:

- dashboards with elaborate scoring
- streak mechanics
- remote synchronization
- user accounts
- embeddings
- vector databases
- RAG

## Acceptance criteria

1. Closing and reopening the app preserves prior text sessions.
2. Corrections remain linked to their original turns.
3. Raw audio is not persisted.
4. A new conversation can receive a short summary of recurring learning needs.
5. Existing voice flow remains usable even if persistence fails; show the storage error clearly.
6. The schema is simple and migration-friendly.

## Manual test

1. Complete a session containing a deliberate repeated error.
2. Quit the app.
3. Relaunch.
4. Confirm the prior session exists.
5. Start a new conversation.
6. Confirm the tutor receives a concise local learner-context summary without explicitly lecturing about it.

## Stop condition

Once cross-session local learning context works, stop. Pronunciation and VAD belong to later work.

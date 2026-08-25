# Slice 04 — Local Ollama Tutor

## Objective

Send each completed transcription to a locally running Ollama model and display a natural English tutor response.

At the end of this slice:

```text
speech -> transcription -> local LLM -> text reply
```

Do not speak the reply yet.

## Ollama integration

Integrate through the local Ollama HTTP API from the native/service layer.

Default base URL:

```text
http://127.0.0.1:11434
```

but make it configurable.

Do not assume a specific model tag.

Provide configuration for the model name and implement a preflight/status check that can clearly distinguish:

- Ollama unavailable
- no model configured
- configured model unavailable
- ready

Never automatically pull a large model without explicit user action.

## Model selection

For this machine, prefer an efficient conversational model in roughly the 8B-10B class if one is already available.

Do not bake this preference into domain code. The configured model remains replaceable.

## Tutor behavior

Create a dedicated system instruction for the tutor.

The tutor:

- speaks only English during normal conversation;
- assumes the learner is approximately B2;
- aims toward C1 conversational ability;
- behaves like an engaged conversation partner, not a textbook;
- asks useful follow-up questions;
- does not praise every answer;
- does not explain every small error;
- keeps responses concise enough for spoken conversation;
- can discuss professional/software topics naturally;
- must never pretend that it heard pronunciation details that are unavailable from the transcript.

## Structured response contract

Do not request an unstructured blob.

Define and validate a typed response similar to:

```ts
type TutorTurn = {
  reply: string;
  corrections: Array<{
    original: string;
    correction: string;
    explanation: string;
    category: "grammar" | "vocabulary" | "naturalness" | "clarity";
    severity: "minor" | "important";
  }>;
  betterExpressions: Array<{
    original?: string;
    suggestion: string;
    explanation?: string;
  }>;
  performance?: {
    outputTokens: number;
    tokensPerSecond: number;
  };
};
```

Adapt naming to project conventions.

Use Ollama structured output / JSON schema support if available in the installed runtime.

Validate the returned payload before using it.

If structured parsing fails, surface an error during V0 rather than silently inventing fields.

## Conversation context

Maintain an in-memory list of turns for the current app session.

Send enough context to preserve a coherent conversation.

Do not add persistent storage yet.

Avoid letting the context grow without limit. A simple recent-turn cap is sufficient for V0.

## UI

Render:

- user transcript
- tutor textual reply
- end-to-end response time and Ollama output throughput (`tok/s`) for each
  completed exchange when the local runtime reports generation metrics

Store corrections in state, but do not build the corrections panel yet. They may be visible only in developer diagnostics for this slice.

## Non-goals

Do not implement:

- TTS
- persistence
- pronunciation scoring
- automatic lesson generation
- analytics
- embeddings/RAG

## Acceptance criteria

1. Ollama availability is visible in diagnostics.
2. A transcribed user turn is sent to the configured local model.
3. The returned response satisfies the typed contract.
4. `reply` appears as the assistant turn.
5. A second spoken turn continues the previous conversation coherently.
6. The flow works without internet access after required local models are present.
7. Ollama errors are visible and actionable.

## Manual test

User:

`I've been working with React since many years, but lately I am studying more backend.`

A good result should:

- continue the conversation naturally;
- likely identify `since many years` as something worth correcting;
- not turn the entire reply into a grammar lecture.

## Stop condition

Once speech -> transcript -> coherent local tutor text works, stop. Do not add voice output.

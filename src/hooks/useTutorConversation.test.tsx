import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AudioRecorder, RecordedAudio } from "../audio/recorder";
import { ConversationControls } from "../components/ConversationControls";
import { ConversationStage } from "../components/ConversationStage";
import { historyKeys } from "../queryKeys/history";
import { renderWithQueryClient } from "../test/queryTestUtils";
import type {
  EvaluateRepairRequest,
  RecordRepairEventRequest,
  RepairEvaluation,
  RepairIntensity,
  UpdateRepairEventOutcomeRequest,
} from "../types/repair";
import type { TutorMessage, TutorTurn, TutorTurnRequest } from "../types/tutor";
import { useTutorConversation } from "./useTutorConversation";

function createRecording(index: number): RecordedAudio {
  const blob = new Blob([`audio-${index}`], { type: "audio/webm" });
  return {
    blob,
    playbackUrl: `blob:recording-${index}`,
    durationMs: 1200,
    mimeType: "audio/webm",
    sizeBytes: blob.size,
  };
}

function createRecorder(): AudioRecorder {
  let recordingIndex = 0;
  return {
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockImplementation(async () => createRecording(++recordingIndex)),
    cancel: vi.fn(),
    dispose: vi.fn(),
  };
}

function turn(reply: string): TutorTurn {
  return {
    reply,
    corrections: [
      {
        original: "since many years",
        correction: "for many years",
        explanation: "Use for with a duration.",
        category: "grammar",
        severity: "important",
      },
    ],
    betterExpressions: [],
  };
}

function ConversationHarness({
  evaluateRepair = vi.fn().mockResolvedValue({ shouldIntervene: false }),
  now,
  recordRepairEvent = vi.fn().mockResolvedValue(1),
  recorder,
  repairIntensity,
  respond,
  seedMessages,
  sessionId,
  speak = async () => undefined,
  transcribe,
  updateRepairEventOutcome = vi.fn().mockResolvedValue(undefined),
}: {
  evaluateRepair?: (request: EvaluateRepairRequest) => Promise<RepairEvaluation>;
  now?: () => number;
  recordRepairEvent?: (request: RecordRepairEventRequest) => Promise<number>;
  recorder: AudioRecorder;
  repairIntensity?: RepairIntensity;
  respond: (request: TutorTurnRequest) => Promise<TutorTurn>;
  seedMessages?: TutorMessage[];
  sessionId?: number;
  speak?: (reply: string) => Promise<void>;
  transcribe: () => Promise<{ text: string }>;
  updateRepairEventOutcome?: (request: UpdateRepairEventOutcomeRequest) => Promise<void>;
}) {
  const conversation = useTutorConversation({
    enabled: true,
    evaluateRepair,
    now,
    recordRepairEvent,
    recorder,
    repairIntensity,
    respond,
    seedMessages,
    sessionId,
    speak,
    transcribe,
    updateRepairEventOutcome,
  });

  return (
    <>
      <span data-testid="live-turn-count">{conversation.liveTurnCount}</span>
      <span data-testid="pending-repair">{conversation.pendingRepair ? "yes" : "no"}</span>
      <span data-testid="pending-review">{conversation.pendingReview ? "yes" : "no"}</span>
      <ConversationStage
        exchanges={conversation.exchanges}
        loopState={conversation.loopState}
        onSkipRepair={conversation.skipRepair}
        speaking={conversation.speaking}
        state={conversation.state}
        thinking={conversation.thinking}
      />
      <ConversationControls
        disabled={conversation.thinking || conversation.speaking}
        models={[]}
        onRecordEnd={(owner) => void conversation.end(owner)}
        onRecordStart={(owner) => void conversation.begin(owner)}
        onSelectModel={() => {}}
        onSend={(text) => conversation.sendTypedMessage(text)}
        recordingState={conversation.state}
        speaking={conversation.speaking}
        thinking={conversation.thinking}
      />
    </>
  );
}

async function recordOneTurn() {
  fireEvent.keyDown(window, { code: "Space" });
  await screen.findByText("Listening");
  fireEvent.keyUp(window, { code: "Space" });
}

function sendTypedTurn(text: string) {
  if (!screen.queryByLabelText("Type a message")) {
    fireEvent.click(screen.getByRole("switch", { name: "Switch to typed replies" }));
  }
  const input = screen.getByLabelText("Type a message");
  fireEvent.change(input, { target: { value: text } });
  fireEvent.keyDown(input, { key: "Enter" });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });

  return { promise, reject, resolve };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("useTutorConversation", () => {
  it("shows measured response time and Ollama output throughput", async () => {
    const recorder = createRecorder();
    let clock = 1_000;
    const respond = vi.fn().mockImplementation(async () => {
      clock = 13_540;
      return {
        ...turn("I'm doing well. How about you?"),
        performance: {
          outputTokens: 104,
          tokensPerSecond: 27.506,
        },
      };
    });

    renderWithQueryClient(
      <ConversationHarness
        now={() => clock}
        recorder={recorder}
        respond={respond}
        transcribe={async () => ({ text: "How are you today?" })}
      />,
    );

    await recordOneTurn();

    expect(await screen.findByText("I'm doing well. How about you?")).toBeInTheDocument();
    expect(screen.getByText("Responded in")).toHaveTextContent(
      "Responded in 12.5 s · 27.5 tok/s",
    );
    expect(screen.getByLabelText("27.5 output tokens per second")).toHaveAttribute(
      "title",
      "104 output tokens generated by Ollama",
    );
  });

  it("shows thinking, displays corrections separately, and sends prior context on turn two", async () => {
    const recorder = createRecorder();
    const transcribe = vi
      .fn()
      .mockResolvedValueOnce({ text: "I have used React since many years." })
      .mockResolvedValueOnce({ text: "Now I am learning Rust." });
    let resolveFirst: ((value: TutorTurn) => void) | undefined;
    const respond = vi
      .fn<(request: TutorTurnRequest) => Promise<TutorTurn>>()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFirst = resolve;
          }),
      )
      .mockResolvedValueOnce(turn("Rust is a useful complement. What are you building?"));

    renderWithQueryClient(
      <ConversationHarness
        recorder={recorder}
        respond={respond}
        transcribe={transcribe}
      />,
    );

    await recordOneTurn();

    expect(await screen.findByText("Thinking")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Thinking…" })).toBeDisabled();
    expect(respond).toHaveBeenCalledWith({
      transcript: "I have used React since many years.",
      history: [],
      origin: "spoken",
    });

    await act(async () => {
      resolveFirst?.(turn("That is substantial React experience. What backend area interests you?"));
    });

    expect(
      await screen.findByText(
        "That is substantial React experience. What backend area interests you?",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText("for many years", { exact: false }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Hold to talk" })).toBeEnabled();

    await recordOneTurn();
    await waitFor(() => expect(respond).toHaveBeenCalledTimes(2));
    expect(respond).toHaveBeenLastCalledWith({
      transcript: "Now I am learning Rust.",
      history: [
        { role: "user", content: "I have used React since many years." },
        {
          role: "assistant",
          content:
            "That is substantial React experience. What backend area interests you?",
        },
      ],
      origin: "spoken",
    });
    expect(
      await screen.findByText("Rust is a useful complement. What are you building?"),
    ).toBeInTheDocument();
  });

  it("keeps the transcript, exposes tutor errors, and becomes recoverable", async () => {
    const recorder = createRecorder();
    const respond = vi.fn().mockRejectedValue({
      code: "ollama-unavailable",
      message: "Ollama stopped before the tutor could respond.",
      technicalMessage: "connection refused",
    });

    renderWithQueryClient(
      <ConversationHarness
        recorder={recorder}
        respond={respond}
        transcribe={async () => ({ text: "Can we discuss APIs?" })}
      />,
    );

    await recordOneTurn();

    expect(
      await screen.findByText("Ollama stopped before the tutor could respond."),
    ).toBeInTheDocument();
    expect(screen.getByText("Can we discuss APIs?")).toBeInTheDocument();
    expect(screen.getByText("connection refused")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Hold to talk" })).toBeEnabled();
  });

  it("speaks only the tutor reply, keeps corrections silent, and blocks recording until speech ends", async () => {
    const recorder = createRecorder();
    const speech = deferred<void>();
    const speak = vi.fn(() => speech.promise);
    const respond = vi.fn().mockResolvedValue(
      turn("That opening is clear. What kinds of international roles interest you?"),
    );

    renderWithQueryClient(
      <ConversationHarness
        recorder={recorder}
        respond={respond}
        speak={speak}
        transcribe={async () => ({
          text: "I am a software engineer from Brazil since many years.",
        })}
      />,
    );

    await recordOneTurn();

    expect(await screen.findByText("Speaking")).toBeInTheDocument();
    expect(speak).toHaveBeenCalledWith(
      "That opening is clear. What kinds of international roles interest you?",
    );
    expect(speak).not.toHaveBeenCalledWith(expect.stringContaining("for many years"));
    expect(
      screen.getByText("for many years", { exact: false }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Speaking…" })).toBeDisabled();

    fireEvent.keyDown(window, { code: "Space" });
    expect(recorder.start).toHaveBeenCalledOnce();

    await act(async () => {
      speech.resolve();
      await speech.promise;
    });

    expect(screen.getByRole("button", { name: "Hold to talk" })).toBeEnabled();
  });

  it("keeps the tutor reply visible, exposes speech errors, and becomes recoverable", async () => {
    const recorder = createRecorder();
    const speak = vi.fn().mockRejectedValue({
      code: "speech-failed",
      message: "macOS speech could not play the tutor reply.",
      technicalMessage: "exit status: 1",
    });

    renderWithQueryClient(
      <ConversationHarness
        recorder={recorder}
        respond={async () => turn("APIs are a strong topic for interviews.")}
        speak={speak}
        transcribe={async () => ({ text: "Can we discuss APIs?" })}
      />,
    );

    await recordOneTurn();

    expect(
      await screen.findByText("APIs are a strong topic for interviews."),
    ).toBeInTheDocument();
    expect(
      await screen.findByText("macOS speech could not play the tutor reply."),
    ).toBeInTheDocument();
    expect(screen.getByText("Speech unavailable")).toBeInTheDocument();
    expect(screen.getByText("exit status: 1")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Hold to talk" })).toBeEnabled();
  });

  describe("typed messages", () => {
    it("sends a typed message with origin typed and renders the tutor's reply", async () => {
      const recorder = createRecorder();
      const respond = vi.fn().mockResolvedValue(
        turn("Thanks for sharing that in writing."),
      );

      renderWithQueryClient(
        <ConversationHarness
          recorder={recorder}
          respond={respond}
          transcribe={async () => ({ text: "unused" })}
        />,
      );

      sendTypedTurn("I work as software engineer since five years.");

      expect(respond).toHaveBeenCalledWith({
        transcript: "I work as software engineer since five years.",
        history: [],
        origin: "typed",
      });
      expect(
        await screen.findByText("Thanks for sharing that in writing."),
      ).toBeInTheDocument();
    });

    it("does not send while the tutor is thinking or speaking", async () => {
      const recorder = createRecorder();
      const pending = deferred<TutorTurn>();
      const respond = vi.fn(() => pending.promise);

      renderWithQueryClient(
        <ConversationHarness
          recorder={recorder}
          respond={respond}
          transcribe={async () => ({ text: "unused" })}
        />,
      );

      sendTypedTurn("First message.");
      expect(respond).toHaveBeenCalledTimes(1);
      expect(await screen.findByLabelText("Type a message")).toBeDisabled();

      sendTypedTurn("Second message while thinking.");
      expect(respond).toHaveBeenCalledTimes(1);

      await act(async () => {
        pending.resolve(turn("Got the first one."));
        await pending.promise;
      });
    });

    it("lets a typed turn and a spoken turn coexist in history", async () => {
      const recorder = createRecorder();
      const respond = vi
        .fn<(request: TutorTurnRequest) => Promise<TutorTurn>>()
        .mockResolvedValueOnce(turn("Nice, tell me more."))
        .mockResolvedValueOnce(turn("Got it, spoken turn received."));

      renderWithQueryClient(
        <ConversationHarness
          recorder={recorder}
          respond={respond}
          transcribe={async () => ({ text: "I go to the office yesterday." })}
        />,
      );

      sendTypedTurn("I work as software engineer since five years.");
      await screen.findByText("Nice, tell me more.");

      await recordOneTurn();
      await screen.findByText("Got it, spoken turn received.");

      expect(respond).toHaveBeenLastCalledWith({
        transcript: "I go to the office yesterday.",
        history: [
          { role: "user", content: "I work as software engineer since five years." },
          { role: "assistant", content: "Nice, tell me more." },
        ],
        origin: "spoken",
      });
    });

    it("invalidates history queries after a typed turn persists with a turnId", async () => {
      const recorder = createRecorder();
      const respond = vi.fn().mockResolvedValue({
        reply: "Persisted.",
        corrections: [],
        betterExpressions: [],
        turnId: 42,
      });

      const { client } = renderWithQueryClient(
        <ConversationHarness
          recorder={recorder}
          respond={respond}
          sessionId={1}
          transcribe={async () => ({ text: "unused" })}
        />,
      );
      const invalidateSpy = vi.spyOn(client, "invalidateQueries");

      sendTypedTurn("I work as software engineer since five years.");
      expect(await screen.findByText("Persisted.")).toBeInTheDocument();
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: historyKeys.all });
    });
  });

  describe("session switching", () => {
    function plainTurn(reply: string, turnId?: number): TutorTurn {
      return { reply, corrections: [], betterExpressions: [], turnId };
    }

    it("resets exchanges, pending state, and liveTurnCount when sessionId switches to a different defined session", async () => {
      const recorder = createRecorder();
      const respond = vi.fn().mockResolvedValue(plainTurn("Reply for session one.", 1));

      const { rerender } = renderWithQueryClient(
        <ConversationHarness
          recorder={recorder}
          respond={respond}
          sessionId={1}
          transcribe={async () => ({ text: "Turn in session one." })}
        />,
      );

      await recordOneTurn();
      expect(await screen.findByText("Reply for session one.")).toBeInTheDocument();
      expect(screen.getByTestId("live-turn-count")).toHaveTextContent("1");

      rerender(
        <ConversationHarness
          recorder={recorder}
          respond={respond}
          sessionId={2}
          transcribe={async () => ({ text: "Turn in session two." })}
        />,
      );

      expect(screen.queryByText("Reply for session one.")).not.toBeInTheDocument();
      expect(screen.getByTestId("live-turn-count")).toHaveTextContent("0");
      expect(screen.getByTestId("pending-repair")).toHaveTextContent("no");
      expect(screen.getByTestId("pending-review")).toHaveTextContent("no");
    });

    it("seeds exchanges from seedMessages on a genuine session switch, pairing user/assistant messages", async () => {
      const recorder = createRecorder();
      const respond = vi.fn().mockResolvedValue(plainTurn("New reply.", 2));
      const transcribe = vi.fn().mockResolvedValue({ text: "New learner turn." });
      const seedMessages: TutorMessage[] = [
        { role: "user", content: "Earlier learner turn." },
        { role: "assistant", content: "Earlier tutor reply." },
      ];

      const { rerender } = renderWithQueryClient(
        <ConversationHarness
          recorder={recorder}
          respond={respond}
          sessionId={1}
          transcribe={transcribe}
        />,
      );

      rerender(
        <ConversationHarness
          recorder={recorder}
          respond={respond}
          seedMessages={seedMessages}
          sessionId={2}
          transcribe={transcribe}
        />,
      );

      expect(await screen.findByText("Earlier learner turn.")).toBeInTheDocument();
      expect(screen.getByText("Earlier tutor reply.")).toBeInTheDocument();

      await recordOneTurn();
      await waitFor(() => expect(respond).toHaveBeenLastCalledWith({
        transcript: "New learner turn.",
        history: [
          { role: "user", content: "Earlier learner turn." },
          { role: "assistant", content: "Earlier tutor reply." },
        ],
        sessionId: 2,
        learnerContext: undefined,
        origin: "spoken",
      }));
    });

    it("does not reset state when sessionId goes from undefined to its first value", async () => {
      const recorder = createRecorder();
      const respond = vi.fn().mockResolvedValue(plainTurn("First reply.", undefined));

      const { rerender } = renderWithQueryClient(
        <ConversationHarness
          recorder={recorder}
          respond={respond}
          transcribe={async () => ({ text: "First turn." })}
        />,
      );

      await recordOneTurn();
      expect(await screen.findByText("First reply.")).toBeInTheDocument();
      expect(screen.getByTestId("live-turn-count")).toHaveTextContent("1");

      rerender(
        <ConversationHarness
          recorder={recorder}
          respond={respond}
          seedMessages={[{ role: "user", content: "Should not appear." }, { role: "assistant", content: "Should not appear either." }]}
          sessionId={42}
          transcribe={async () => ({ text: "unused" })}
        />,
      );

      expect(screen.getByText("First reply.")).toBeInTheDocument();
      expect(screen.getByTestId("live-turn-count")).toHaveTextContent("1");
      expect(screen.queryByText("Should not appear.")).not.toBeInTheDocument();
    });

    it("invalidates history queries after a turn persists with a turnId, and does not when persistence fails", async () => {
      const recorder = createRecorder();
      const respond = vi
        .fn<(request: TutorTurnRequest) => Promise<TutorTurn>>()
        .mockResolvedValueOnce(plainTurn("Not persisted.", undefined))
        .mockResolvedValueOnce(plainTurn("Persisted.", 99));

      const { client } = renderWithQueryClient(
        <ConversationHarness
          recorder={recorder}
          respond={respond}
          sessionId={1}
          transcribe={async () => ({ text: "turn" })}
        />,
      );
      const invalidateSpy = vi.spyOn(client, "invalidateQueries");

      await recordOneTurn();
      expect(await screen.findByText("Not persisted.")).toBeInTheDocument();
      expect(invalidateSpy).not.toHaveBeenCalledWith({ queryKey: historyKeys.all });

      await recordOneTurn();
      expect(await screen.findByText("Persisted.")).toBeInTheDocument();
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: historyKeys.all });
    });

    it("increments liveTurnCount only for genuinely new recorded turns, not seeded ones", async () => {
      const recorder = createRecorder();
      const respond = vi.fn().mockResolvedValue(plainTurn("New reply.", 5));
      const transcribe = vi.fn().mockResolvedValue({ text: "New learner turn." });
      const seedMessages: TutorMessage[] = [
        { role: "user", content: "Seed learner turn." },
        { role: "assistant", content: "Seed tutor reply." },
      ];

      const { rerender } = renderWithQueryClient(
        <ConversationHarness
          recorder={recorder}
          respond={respond}
          sessionId={1}
          transcribe={transcribe}
        />,
      );

      rerender(
        <ConversationHarness
          recorder={recorder}
          respond={respond}
          seedMessages={seedMessages}
          sessionId={2}
          transcribe={transcribe}
        />,
      );

      expect(await screen.findByText("Seed learner turn.")).toBeInTheDocument();
      expect(screen.getByTestId("live-turn-count")).toHaveTextContent("0");

      await recordOneTurn();
      expect(await screen.findByText("New reply.")).toBeInTheDocument();
      expect(screen.getByTestId("live-turn-count")).toHaveTextContent("1");
    });
  });

  describe("repair loop", () => {
    function noRepair(): TutorTurn {
      return { reply: "Sounds good, tell me more.", corrections: [], betterExpressions: [] };
    }

    it("quick mode shows an inline correction chip without gating the microphone", async () => {
      const recorder = createRecorder();
      const respond = vi
        .fn<(request: TutorTurnRequest) => Promise<TutorTurn>>()
        .mockResolvedValue({ ...noRepair(), turnId: 1 });
      const evaluateRepair = vi.fn<(request: EvaluateRepairRequest) => Promise<RepairEvaluation>>()
        .mockResolvedValue({
          shouldIntervene: true,
          priority: "vocabulary",
          issue: "word choice",
          original: "I am agree",
          suggested: "I agree",
          microExplanation: "Drop 'am' before 'agree'.",
          repairPrompt: "Try saying it without 'am'.",
        });
      const recordRepairEvent = vi.fn().mockResolvedValue(5);

      renderWithQueryClient(
        <ConversationHarness
          evaluateRepair={evaluateRepair}
          recordRepairEvent={recordRepairEvent}
          recorder={recorder}
          respond={respond}
          transcribe={async () => ({ text: "I am agree with that." })}
        />,
      );

      await recordOneTurn();

      // The normal contentful reply still plays — quick mode never gates.
      expect(await screen.findByText("Sounds good, tell me more.")).toBeInTheDocument();
      expect(screen.getByText("Vocabulary · Quick fix")).toBeInTheDocument();
      expect(screen.getByText("“I am agree”")).toBeInTheDocument();
      expect(screen.getByText("“I agree”")).toBeInTheDocument();
      expect(recordRepairEvent).toHaveBeenCalledWith(
        expect.objectContaining({ turnId: 1, mode: "quick", priority: "vocabulary" }),
      );
      expect(screen.getByRole("button", { name: "Hold to talk" })).toBeEnabled();
    });

    it("repair mode replaces the spoken reply with the repair prompt and records an improved outcome once the retry lands", async () => {
      const recorder = createRecorder();
      const transcribe = vi
        .fn()
        .mockResolvedValueOnce({ text: "Yesterday I go to the office." })
        .mockResolvedValueOnce({ text: "Yesterday I went to the office." });
      const respond = vi
        .fn<(request: TutorTurnRequest) => Promise<TutorTurn>>()
        .mockResolvedValueOnce({ ...noRepair(), turnId: 7 })
        .mockResolvedValueOnce({
          reply: "Great, that's correct — what happened next?",
          corrections: [],
          betterExpressions: [],
          turnId: 8,
        });
      const evaluateRepair = vi
        .fn<(request: EvaluateRepairRequest) => Promise<RepairEvaluation>>()
        .mockImplementation((request) =>
          Promise.resolve(
            request.pendingRepair
              ? { shouldIntervene: false, repairOutcome: "improved" }
              : {
                  shouldIntervene: true,
                  priority: "coherence",
                  issue: "past tense form",
                  original: "Yesterday I go to the office",
                  suggested: "Yesterday I went to the office",
                  microExplanation: "Use past tense for a finished action.",
                  repairPrompt: "Try that sentence again using 'went'.",
                },
          ),
        );
      const recordRepairEvent = vi.fn().mockResolvedValue(9);
      const updateRepairEventOutcome = vi.fn().mockResolvedValue(undefined);

      renderWithQueryClient(
        <ConversationHarness
          evaluateRepair={evaluateRepair}
          recordRepairEvent={recordRepairEvent}
          recorder={recorder}
          respond={respond}
          transcribe={transcribe}
          updateRepairEventOutcome={updateRepairEventOutcome}
        />,
      );

      await recordOneTurn();

      // The repair prompt stands in for the normal reply — the full
      // contentful reply must never have been spoken or shown.
      expect(await screen.findByText("Coherence · Your turn to try again")).toBeInTheDocument();
      expect(screen.queryByText("Sounds good, tell me more.")).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Skip" })).toBeInTheDocument();

      await recordOneTurn();

      expect(
        await screen.findByText("Great, that's correct — what happened next?"),
      ).toBeInTheDocument();
      expect(updateRepairEventOutcome).toHaveBeenCalledWith({ eventId: 9, outcome: "improved" });
      expect(screen.getByText("Fixed")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Skip" })).not.toBeInTheDocument();
    });

    it("skipRepair records a skipped outcome without requiring a retry turn", async () => {
      const recorder = createRecorder();
      const respond = vi
        .fn<(request: TutorTurnRequest) => Promise<TutorTurn>>()
        .mockResolvedValue({ ...noRepair(), turnId: 3 });
      const evaluateRepair = vi.fn<(request: EvaluateRepairRequest) => Promise<RepairEvaluation>>()
        .mockResolvedValue({
          shouldIntervene: true,
          priority: "pragmatics",
          issue: "tone",
          original: "Give me the report now",
          suggested: "Could you send me the report when you get a chance?",
          microExplanation: "Soften direct requests with colleagues.",
          repairPrompt: "Try asking that more politely.",
        });
      const recordRepairEvent = vi.fn().mockResolvedValue(11);
      const updateRepairEventOutcome = vi.fn().mockResolvedValue(undefined);

      renderWithQueryClient(
        <ConversationHarness
          evaluateRepair={evaluateRepair}
          recordRepairEvent={recordRepairEvent}
          recorder={recorder}
          respond={respond}
          transcribe={async () => ({ text: "Give me the report now." })}
          updateRepairEventOutcome={updateRepairEventOutcome}
        />,
      );

      await recordOneTurn();
      const skipButton = await screen.findByRole("button", { name: "Skip" });
      fireEvent.click(skipButton);

      await waitFor(() =>
        expect(updateRepairEventOutcome).toHaveBeenCalledWith({ eventId: 11, outcome: "skipped" }),
      );
      expect(await screen.findByText("Skipped")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Skip" })).not.toBeInTheDocument();
    });

    it("implicit mode records the event without changing the reply or showing any repair UI", async () => {
      const recorder = createRecorder();
      const respond = vi
        .fn<(request: TutorTurnRequest) => Promise<TutorTurn>>()
        .mockResolvedValue({ ...noRepair(), turnId: 2 });
      const evaluateRepair = vi.fn<(request: EvaluateRepairRequest) => Promise<RepairEvaluation>>()
        .mockResolvedValue({
          shouldIntervene: true,
          priority: "vocabulary",
          issue: "word choice",
          original: "I am agree",
          suggested: "I agree",
          microExplanation: "Drop 'am' before 'agree'.",
          repairPrompt: "Try saying it without 'am'.",
        });
      const recordRepairEvent = vi.fn().mockResolvedValue(13);

      renderWithQueryClient(
        <ConversationHarness
          evaluateRepair={evaluateRepair}
          recordRepairEvent={recordRepairEvent}
          recorder={recorder}
          repairIntensity="light"
          respond={respond}
          transcribe={async () => ({ text: "I am agree with that." })}
        />,
      );

      await recordOneTurn();

      expect(await screen.findByText("Sounds good, tell me more.")).toBeInTheDocument();
      expect(screen.queryByText("Vocabulary · Quick fix")).not.toBeInTheDocument();
      expect(screen.queryByText(/Your turn to try again/)).not.toBeInTheDocument();
      expect(recordRepairEvent).toHaveBeenCalledWith(
        expect.objectContaining({ turnId: 2, mode: "implicit" }),
      );
    });
  });
});

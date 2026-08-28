import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AudioRecorder, RecordedAudio } from "../audio/recorder";
import { TalkControl } from "../components/TalkControl";
import { learnerProfileKeys } from "../queryKeys/learnerProfile";
import { renderWithQueryClient as render } from "../test/queryTestUtils";
import type { CefrLevel } from "../types/assessment";
import type { SessionStart } from "../types/history";
import type { SessionSource } from "../types/scenarioPack";
import type {
  OpenSessionRequest,
  OpeningTurn,
  SessionSummaryPayload,
  SynthesizeSessionSummaryRequest,
} from "../types/session";
import type {
  EvaluateRepairRequest,
  RecordRepairEventRequest,
  RepairEvaluation,
  UpdateRepairEventOutcomeRequest,
} from "../types/repair";
import type { TutorTurn, TutorTurnRequest } from "../types/tutor";
import { useSessionRun } from "./useSessionRun";

type StartSessionFn = (request: {
  scenarioId: string;
  difficulty?: CefrLevel;
  focus?: string;
  targetTurns: number;
}) => Promise<SessionStart>;

type CompleteSessionFn = (request: {
  sessionId: number;
  status: "completed" | "abandoned";
  summary?: SessionSummaryPayload;
}) => Promise<void>;

type OpenGuidedSessionFn = (request: OpenSessionRequest) => Promise<OpeningTurn>;

type SynthesizeSessionSummaryFn = (
  request: SynthesizeSessionSummaryRequest,
) => Promise<SessionSummaryPayload>;

type ApplySessionToLearnerProfileFn = (request: {
  scenarioLabel: string;
  priorities: string[];
}) => Promise<unknown>;

type EvaluateRepairFn = (request: EvaluateRepairRequest) => Promise<RepairEvaluation>;
type RecordRepairEventFn = (request: RecordRepairEventRequest) => Promise<number>;
type UpdateRepairEventOutcomeFn = (request: UpdateRepairEventOutcomeRequest) => Promise<void>;

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

function tutorTurn(reply: string): TutorTurn {
  return { reply, corrections: [], betterExpressions: [] };
}

const TEMPLATE: SessionSource = {
  id: "daily-standup",
  label: "Daily standup",
  systemPrompt: "You are the learner's teammate running a daily standup meeting.",
  focusPlaceholder: "e.g. talking about a specific project or blocker",
};

function SessionRunHarness({
  recorder,
  transcribe,
  respond = async () => tutorTurn("Sounds good, tell me more."),
  startSession = vi.fn<StartSessionFn>().mockResolvedValue({
    sessionId: 42,
    learnerContext: "B1 learner.",
  }),
  completeSession = vi.fn<CompleteSessionFn>().mockResolvedValue(undefined),
  openGuidedSession = vi
    .fn<OpenGuidedSessionFn>()
    .mockResolvedValue({ opening: "Let's start the standup." }),
  synthesizeSessionSummary = vi.fn<SynthesizeSessionSummaryFn>().mockResolvedValue({
    whatWentWell: ["Gave a clear update."],
    priorityIssues: ["past tense accuracy"],
    alternativePhrases: [],
    reviewItems: [{ content: "past tense forms", type: "grammar_pattern" }],
    repairEvents: [],
  }),
  applySessionToLearnerProfile = vi
    .fn<ApplySessionToLearnerProfileFn>()
    .mockResolvedValue(undefined),
  evaluateRepair = vi
    .fn<EvaluateRepairFn>()
    .mockResolvedValue({ shouldIntervene: false }),
  recordRepairEvent = vi.fn<RecordRepairEventFn>().mockResolvedValue(1),
  updateRepairEventOutcome = vi
    .fn<UpdateRepairEventOutcomeFn>()
    .mockResolvedValue(undefined),
}: {
  recorder: AudioRecorder;
  transcribe: () => Promise<{ text: string }>;
  respond?: (request: TutorTurnRequest) => Promise<TutorTurn>;
  startSession?: StartSessionFn;
  completeSession?: CompleteSessionFn;
  openGuidedSession?: OpenGuidedSessionFn;
  synthesizeSessionSummary?: SynthesizeSessionSummaryFn;
  applySessionToLearnerProfile?: ApplySessionToLearnerProfileFn;
  evaluateRepair?: EvaluateRepairFn;
  recordRepairEvent?: RecordRepairEventFn;
  updateRepairEventOutcome?: UpdateRepairEventOutcomeFn;
}) {
  const run = useSessionRun({
    enabled: true,
    recorder,
    transcribe,
    respond,
    speak: async () => undefined,
    startSession,
    completeSession,
    openGuidedSession,
    synthesizeSessionSummary,
    applySessionToLearnerProfile,
    evaluateRepair,
    recordRepairEvent,
    updateRepairEventOutcome,
  });

  return (
    <>
      <p data-testid="status">{run.status}</p>
      <p data-testid="turnCount">{run.turnCount}</p>
      {run.error && <p data-testid="error">{run.error.message}</p>}
      {run.summary && <p data-testid="priority">{run.summary.priorityIssues.join(", ")}</p>}
      <button
        onClick={() => void run.start(TEMPLATE, { difficulty: "B1", durationPresetId: "quick" })}
        type="button"
      >
        Start
      </button>
      <button onClick={() => void run.finish()} type="button">
        Finish
      </button>
      <button onClick={() => void run.abandon()} type="button">
        Abandon
      </button>
      <TalkControl
        disabled={run.status !== "active"}
        onEnd={(owner) => void run.conversation.end(owner)}
        onStart={(owner) => void run.conversation.begin(owner)}
        state={run.conversation.state}
      />
    </>
  );
}

async function recordOneTurn() {
  fireEvent.keyDown(window, { code: "Space" });
  await waitFor(() =>
    expect(screen.getByRole("button", { name: /release to finish/i })).toBeInTheDocument(),
  );
  fireEvent.keyUp(window, { code: "Space" });
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("useSessionRun", () => {
  it("starts a session, fetches an opener, and reaches the active status", async () => {
    const startSession = vi
      .fn<StartSessionFn>()
      .mockResolvedValue({ sessionId: 42, learnerContext: "B1 learner." });
    const openGuidedSession = vi
      .fn<OpenGuidedSessionFn>()
      .mockResolvedValue({ opening: "Let's start the standup." });
    const recorder = createRecorder();

    render(
      <SessionRunHarness
        recorder={recorder}
        transcribe={async () => ({ text: "I finished the login page." })}
        startSession={startSession}
        openGuidedSession={openGuidedSession}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Start" }));

    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("active"));
    expect(startSession).toHaveBeenCalledWith(
      expect.objectContaining({ scenarioId: TEMPLATE.id, difficulty: "B1", targetTurns: 4 }),
    );
    expect(openGuidedSession).toHaveBeenCalledWith(
      expect.objectContaining({
        scenarioSystemPrompt: TEMPLATE.systemPrompt,
        learnerContext: "B1 learner.",
      }),
    );
  });

  it("counts only real learner turns, not the seeded opener", async () => {
    const recorder = createRecorder();
    render(
      <SessionRunHarness
        recorder={recorder}
        transcribe={async () => ({ text: "I finished the login page." })}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("active"));
    expect(screen.getByTestId("turnCount")).toHaveTextContent("0");

    await recordOneTurn();

    await waitFor(() => expect(screen.getByTestId("turnCount")).toHaveTextContent("1"));
  });

  it("finishes a session: synthesizes a summary, persists completion, and updates the learner profile", async () => {
    const completeSession = vi.fn<CompleteSessionFn>().mockResolvedValue(undefined);
    const synthesizeSessionSummary = vi.fn<SynthesizeSessionSummaryFn>().mockResolvedValue({
      whatWentWell: ["Gave a clear update."],
      priorityIssues: ["past tense accuracy"],
      alternativePhrases: [],
      reviewItems: [{ content: "past tense forms", type: "grammar_pattern" }],
      repairEvents: [],
    });
    const applySessionToLearnerProfile = vi
      .fn<ApplySessionToLearnerProfileFn>()
      .mockResolvedValue(undefined);
    const recorder = createRecorder();

    const { client } = render(
      <SessionRunHarness
        recorder={recorder}
        transcribe={async () => ({ text: "I finished the login page." })}
        completeSession={completeSession}
        synthesizeSessionSummary={synthesizeSessionSummary}
        applySessionToLearnerProfile={applySessionToLearnerProfile}
      />,
    );
    const invalidateQueriesSpy = vi.spyOn(client, "invalidateQueries");

    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("active"));
    await recordOneTurn();
    await waitFor(() => expect(screen.getByTestId("turnCount")).toHaveTextContent("1"));

    fireEvent.click(screen.getByRole("button", { name: "Finish" }));

    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("complete"));
    expect(screen.getByTestId("priority")).toHaveTextContent("past tense accuracy");
    expect(completeSession).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: 42, status: "completed" }),
    );
    expect(applySessionToLearnerProfile).toHaveBeenCalledWith({
      scenarioLabel: TEMPLATE.label,
      priorities: ["past tense accuracy"],
    });
    expect(synthesizeSessionSummary).toHaveBeenCalledWith(
      expect.objectContaining({ repairEvents: [] }),
    );
    await waitFor(() =>
      expect(invalidateQueriesSpy).toHaveBeenCalledWith({
        queryKey: learnerProfileKeys.all,
      }),
    );
  });

  it("still completes when summary synthesis fails", async () => {
    const completeSession = vi.fn<CompleteSessionFn>().mockResolvedValue(undefined);
    const synthesizeSessionSummary = vi.fn<SynthesizeSessionSummaryFn>().mockRejectedValue({
      code: "invalid-response",
      message: "The local tutor returned invalid structured output.",
    });
    const recorder = createRecorder();

    render(
      <SessionRunHarness
        recorder={recorder}
        transcribe={async () => ({ text: "I finished the login page." })}
        completeSession={completeSession}
        synthesizeSessionSummary={synthesizeSessionSummary}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("active"));
    await recordOneTurn();
    await waitFor(() => expect(screen.getByTestId("turnCount")).toHaveTextContent("1"));

    fireEvent.click(screen.getByRole("button", { name: "Finish" }));

    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("complete"));
    expect(completeSession).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: 42, status: "completed", summary: undefined }),
    );
  });

  it("abandons an active session and returns to the catalog", async () => {
    const completeSession = vi.fn<CompleteSessionFn>().mockResolvedValue(undefined);
    const recorder = createRecorder();

    render(
      <SessionRunHarness
        recorder={recorder}
        transcribe={async () => ({ text: "I finished the login page." })}
        completeSession={completeSession}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("active"));

    fireEvent.click(screen.getByRole("button", { name: "Abandon" }));

    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("catalog"));
    expect(completeSession).toHaveBeenCalledWith({ sessionId: 42, status: "abandoned" });
  });

  it("surfaces a recoverable error when starting fails", async () => {
    const startSession = vi.fn<StartSessionFn>().mockRejectedValue({
      code: "history-storage-failed",
      message: "The learning history could not be saved.",
    });
    const recorder = createRecorder();

    render(
      <SessionRunHarness
        recorder={recorder}
        transcribe={async () => ({ text: "I finished the login page." })}
        startSession={startSession}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Start" }));

    await waitFor(() =>
      expect(screen.getByTestId("error")).toHaveTextContent(
        "The learning history could not be saved.",
      ),
    );
    expect(screen.getByTestId("status")).toHaveTextContent("error");
  });
});

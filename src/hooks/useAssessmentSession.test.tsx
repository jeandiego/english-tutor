import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AssessmentTask } from "../assessment/types";
import type { AudioRecorder, RecordedAudio } from "../audio/recorder";
import { TalkControl } from "../components/TalkControl";
import * as assessmentNative from "../native/assessment";
import * as learnerProfileNative from "../native/learnerProfile";
import * as speechNative from "../native/speech";
import { learnerProfileKeys } from "../queryKeys/learnerProfile";
import { renderWithQueryClient as render } from "../test/queryTestUtils";
import { useAssessmentSession } from "./useAssessmentSession";

vi.mock("../native/assessment", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../native/assessment")>();
  return {
    ...actual,
    startAssessment: vi.fn(),
    startAssessmentTaskRun: vi.fn(),
    recordAssessmentTurnCycle: vi.fn(),
    completeAssessmentTaskRun: vi.fn(),
    completeAssessment: vi.fn(),
    generateFollowUp: vi.fn(),
    evaluateResponse: vi.fn(),
    synthesizeAssessmentSummary: vi.fn(),
  };
});

vi.mock("../native/learnerProfile", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../native/learnerProfile")>();
  return {
    ...actual,
    applyAssessmentToLearnerProfile: vi.fn(),
  };
});

vi.mock("../native/speech", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../native/speech")>();
  return { ...actual, speakTutorReply: vi.fn() };
});

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

const SINGLE_TASK: AssessmentTask[] = [
  {
    id: "task-a",
    category: "personal_narrative",
    cefrRange: { min: "B1", max: "B2" },
    competencies: ["fluency"],
    requiredFunctions: ["narrate"],
    anchorPrompt: "Tell me about your day.",
    followUpPolicy: { min: 0, max: 0, allowedIntents: [] },
  },
];

function AssessmentHarness({
  recorder,
  transcribe,
  tasks = SINGLE_TASK,
}: {
  recorder: AudioRecorder;
  transcribe: () => Promise<{ text: string }>;
  tasks?: AssessmentTask[];
}) {
  const session = useAssessmentSession({ enabled: true, tasks, recorder, transcribe });

  return (
    <>
      <p data-testid="status">{session.status}</p>
      <p data-testid="question">{session.currentQuestion}</p>
      {session.result && <p data-testid="result">{session.result.overallLevel}</p>}
      {session.error && <p data-testid="error">{session.error.message}</p>}
      <button onClick={() => session.start()} type="button">
        Start
      </button>
      <TalkControl
        disabled={session.status !== "awaitingAnswer"}
        onEnd={(owner) => void session.end(owner)}
        onStart={(owner) => void session.begin(owner)}
        state={session.state}
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

beforeEach(() => {
  vi.mocked(assessmentNative.startAssessment).mockResolvedValue({ assessmentId: 1 });
  vi.mocked(assessmentNative.startAssessmentTaskRun).mockResolvedValue({ taskRunId: 10 });
  vi.mocked(assessmentNative.recordAssessmentTurnCycle).mockResolvedValue({
    answerTurnId: 100,
  });
  vi.mocked(assessmentNative.completeAssessmentTaskRun).mockResolvedValue(undefined);
  vi.mocked(assessmentNative.completeAssessment).mockResolvedValue(undefined);
  vi.mocked(assessmentNative.synthesizeAssessmentSummary).mockResolvedValue({
    priorities: [{ content: "Practice linking ideas.", type: "conversation_strategy" }],
    recommendedSessions: ["storytelling"],
    notesForTutor: "Coverage was thin.",
  });
  vi.mocked(learnerProfileNative.applyAssessmentToLearnerProfile).mockResolvedValue({
    dimensionLevels: {},
    goals: [],
    preferredScenarios: [],
    targetAccents: [],
    recurringIssues: [],
    activeVocabulary: [],
    activeGrammarTargets: [],
    activePronunciationTargets: [],
    progressNotes: [],
  });
  vi.mocked(speechNative.speakTutorReply).mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe("useAssessmentSession", () => {
  it("starts with the task's anchor prompt, not a generated follow-up", async () => {
    const recorder = createRecorder();
    render(
      <AssessmentHarness
        recorder={recorder}
        transcribe={async () => ({ text: "It was a normal day." })}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Start" }));

    await waitFor(() =>
      expect(screen.getByTestId("question")).toHaveTextContent("Tell me about your day."),
    );
    expect(assessmentNative.startAssessment).toHaveBeenCalledWith({
      blueprintVersion: expect.any(String),
      rubricVersion: expect.any(String),
    });
    expect(assessmentNative.startAssessmentTaskRun).toHaveBeenCalledWith(
      expect.objectContaining({ assessmentId: 1, taskId: "task-a", anchorUsed: true }),
    );
    expect(assessmentNative.generateFollowUp).not.toHaveBeenCalled();
    expect(speechNative.speakTutorReply).toHaveBeenCalledWith("Tell me about your day.");
  });

  it("evaluates the answer, persists the turn cycle, and completes with an aggregated result", async () => {
    vi.mocked(assessmentNative.evaluateResponse).mockResolvedValue({
      competencyEvidence: [
        {
          competency: "fluency",
          levelEvidence: "B2",
          confidence: 0.9,
          evidence: ["Maintained an extended response."],
          insufficientEvidence: false,
        },
      ],
    });

    const recorder = createRecorder();
    const { client } = render(
      <AssessmentHarness
        recorder={recorder}
        transcribe={async () => ({ text: "It was a normal day." })}
      />,
    );
    const invalidateQueriesSpy = vi.spyOn(client, "invalidateQueries");

    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    await waitFor(() =>
      expect(screen.getByTestId("question")).toHaveTextContent("Tell me about your day."),
    );

    await recordOneTurn();

    await waitFor(() =>
      expect(assessmentNative.evaluateResponse).toHaveBeenCalledWith(
        expect.objectContaining({
          taskId: "task-a",
          competencies: ["fluency"],
          question: "Tell me about your day.",
          learnerAnswer: "It was a normal day.",
        }),
      ),
    );
    expect(assessmentNative.recordAssessmentTurnCycle).toHaveBeenCalledWith(
      expect.objectContaining({
        taskRunId: 10,
        promptText: "Tell me about your day.",
        answerText: "It was a normal day.",
      }),
    );

    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("complete"));
    expect(screen.getByTestId("result")).toHaveTextContent("B2");
    expect(assessmentNative.completeAssessmentTaskRun).toHaveBeenCalledWith({
      taskRunId: 10,
      followUpsUsed: 0,
    });
    expect(assessmentNative.completeAssessment).toHaveBeenCalledWith(
      expect.objectContaining({ assessmentId: 1, estimatedLevel: "B2" }),
    );
    expect(learnerProfileNative.applyAssessmentToLearnerProfile).toHaveBeenCalledWith({
      overallLevel: "B2",
      dimensionLevels: { fluency: "B2" },
      priorities: [{ content: "Practice linking ideas.", type: "conversation_strategy" }],
      assessmentId: 1,
    });
    await waitFor(() =>
      expect(invalidateQueriesSpy).toHaveBeenCalledWith({
        queryKey: learnerProfileKeys.all,
      }),
    );
  });

  it("still completes the assessment when the learner profile update fails", async () => {
    vi.mocked(assessmentNative.evaluateResponse).mockResolvedValue({
      competencyEvidence: [
        {
          competency: "fluency",
          levelEvidence: "B2",
          confidence: 0.9,
          evidence: ["Maintained an extended response."],
          insufficientEvidence: false,
        },
      ],
    });
    vi.mocked(learnerProfileNative.applyAssessmentToLearnerProfile).mockRejectedValue({
      code: "learner-profile-storage-failed",
      message: "The learner profile could not be updated.",
      technicalMessage: "disk full",
    });

    const recorder = createRecorder();
    render(
      <AssessmentHarness
        recorder={recorder}
        transcribe={async () => ({ text: "It was a normal day." })}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    await waitFor(() =>
      expect(screen.getByTestId("question")).toHaveTextContent("Tell me about your day."),
    );

    await recordOneTurn();

    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("complete"));
    expect(screen.getByTestId("result")).toHaveTextContent("B2");
  });

  it("surfaces a recoverable error when evaluation fails, without crashing the loop", async () => {
    vi.mocked(assessmentNative.evaluateResponse).mockRejectedValue({
      code: "invalid-response",
      message: "The assessment model returned invalid structured output.",
      technicalMessage: "missing field competencyEvidence",
    });

    const recorder = createRecorder();
    render(
      <AssessmentHarness
        recorder={recorder}
        transcribe={async () => ({ text: "It was a normal day." })}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    await waitFor(() =>
      expect(screen.getByTestId("question")).toHaveTextContent("Tell me about your day."),
    );

    await recordOneTurn();

    await waitFor(() =>
      expect(screen.getByTestId("error")).toHaveTextContent(
        "The assessment model returned invalid structured output.",
      ),
    );
    expect(screen.getByTestId("status")).toHaveTextContent("error");
    expect(assessmentNative.recordAssessmentTurnCycle).not.toHaveBeenCalled();
    expect(assessmentNative.completeAssessment).not.toHaveBeenCalled();
  });
});

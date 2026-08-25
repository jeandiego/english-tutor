import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { ConversationExchange } from "../hooks/useTutorConversation";
import type { RecordingState } from "../hooks/usePushToTalk";
import type { TutorTurn } from "../types/tutor";
import { ConversationStage } from "./ConversationStage";

afterEach(() => {
  cleanup();
});

const idleState: RecordingState = { status: "idle", recording: null };

function exchange(
  id: number,
  transcript: string,
  tutorTurn?: TutorTurn,
): ConversationExchange {
  return { id, transcript, tutorTurn };
}

function naturalTurn(): TutorTurn {
  return {
    reply: "That sounds like solid experience. What stack do you use most?",
    corrections: [],
    betterExpressions: [],
  };
}

function turnWithCoaching(): TutorTurn {
  return {
    reply: "Got it, tell me more about that project.",
    corrections: [
      {
        original: "since five years",
        correction: "for five years",
        explanation: "Use “for” with a duration.",
        category: "grammar",
        severity: "important",
      },
    ],
    betterExpressions: [
      {
        original: "very difficult decision",
        suggestion: "a tough call",
        explanation: "More natural in spoken English.",
      },
    ],
  };
}

describe("ConversationStage corrections", () => {
  it("renders a correction card with what was said, the better version, reason, category, and importance", () => {
    render(
      <ConversationStage
        exchanges={[
          exchange(1, "I work as a software engineer.", turnWithCoaching()),
        ]}
        state={idleState}
      />,
    );

    expect(
      screen.getByText("since five years", { exact: false }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("for five years", { exact: false }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Use “for” with a duration."),
    ).toBeInTheDocument();
    expect(screen.getByText("Grammar · Important")).toBeInTheDocument();
  });

  it("renders a better-expression card with the original and the natural alternative", () => {
    render(
      <ConversationStage
        exchanges={[
          exchange(1, "I work as a software engineer.", turnWithCoaching()),
        ]}
        state={idleState}
      />,
    );

    expect(
      screen.getByText("very difficult decision", { exact: false }),
    ).toBeInTheDocument();
    expect(screen.getByText("a tough call", { exact: false })).toBeInTheDocument();
    expect(
      screen.getByText("More natural in spoken English."),
    ).toBeInTheDocument();
  });

  it("renders nothing extra when the tutor returns zero corrections and zero better expressions", () => {
    render(
      <ConversationStage
        exchanges={[
          exchange(1, "I've been working as a software engineer for several years.", naturalTurn()),
        ]}
        state={idleState}
      />,
    );

    expect(document.querySelector(".tutor-coaching")).not.toBeInTheDocument();
  });

  it("keeps a correction attached to its own turn after a later turn starts", () => {
    render(
      <ConversationStage
        exchanges={[
          exchange(
            1,
            "I work as software engineer since five years.",
            turnWithCoaching(),
          ),
          exchange(
            2,
            "I've been working as a software engineer for several years.",
            naturalTurn(),
          ),
        ]}
        state={idleState}
      />,
    );

    const coachingBlocks = document.querySelectorAll(".tutor-coaching");
    expect(coachingBlocks).toHaveLength(1);

    const firstExchange = screen
      .getByText("Got it, tell me more about that project.")
      .closest("article");
    const secondExchange = screen
      .getByText("That sounds like solid experience. What stack do you use most?")
      .closest("article");

    expect(firstExchange?.querySelector(".tutor-coaching")).not.toBeNull();
    expect(secondExchange?.querySelector(".tutor-coaching")).toBeNull();
  });
});

import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppSidebar } from "./AppSidebar";
import { listRecentSessions } from "../../native/history";
import { renderWithQueryClient as render } from "../../test/queryTestUtils";
import { SidebarProvider } from "../ui/sidebar";

vi.mock("../../native/history", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../native/history")>();
  return {
    ...actual,
    listRecentSessions: vi.fn(),
  };
});

const listRecentSessionsMock = vi.mocked(listRecentSessions);

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function renderSidebar(onOpenSession = vi.fn()) {
  return render(
    <SidebarProvider>
      <AppSidebar
        activePage="conversation"
        estimatedLevel={undefined}
        healthState={{ status: "checking" }}
        navigationDisabled={false}
        onNavigate={vi.fn()}
        onOpenSession={onOpenSession}
        onOpenSettings={vi.fn()}
        onSelectVoice={vi.fn()}
        settingsNeedsAttention={false}
        transcription={{ status: "checking", message: "", canOpenSettings: false }}
        tutor={{ status: "checking", message: "", canOpenSettings: false }}
        ttsState={{ status: "checking" }}
      />
    </SidebarProvider>,
  );
}

describe("AppSidebar recent conversations", () => {
  it("shows the empty state when there are no recent conversations", async () => {
    listRecentSessionsMock.mockResolvedValue([]);

    renderSidebar();

    expect(await screen.findByText("No conversations yet")).toBeInTheDocument();
  });

  it("renders title, scenario, relative time, and turn count for a session", async () => {
    listRecentSessionsMock.mockResolvedValue([
      {
        id: 1,
        startedAt: Date.now() - 5 * 60_000,
        endedAt: Date.now(),
        turnCount: 3,
        status: "completed",
        topic: "practice ordering food",
      },
    ]);

    renderSidebar();

    expect(await screen.findByText("practice ordering food")).toBeInTheDocument();
    expect(screen.getByText(/Free conversation/)).toBeInTheDocument();
    expect(screen.getByText(/5m ago/)).toBeInTheDocument();
    expect(screen.getByText(/3 turns/)).toBeInTheDocument();
  });

  it("calls onOpenSession when a recent conversation row is clicked", async () => {
    const onOpenSession = vi.fn();
    listRecentSessionsMock.mockResolvedValue([
      {
        id: 42,
        startedAt: Date.now(),
        endedAt: Date.now(),
        turnCount: 1,
        status: "active",
        topic: "a topic",
      },
    ]);

    renderSidebar(onOpenSession);

    (await screen.findByText("a topic")).click();
    expect(onOpenSession).toHaveBeenCalledWith(42);
  });
});

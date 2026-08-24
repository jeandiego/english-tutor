import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { getRuntimeHealth } from "./native/health";

vi.mock("./native/health", () => ({
  getRuntimeHealth: vi.fn(),
}));

const getRuntimeHealthMock = vi.mocked(getRuntimeHealth);

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe("English Coach shell", () => {
  it("shows the checking state while the native command is pending", () => {
    getRuntimeHealthMock.mockReturnValue(new Promise(() => undefined));

    render(<App />);

    expect(screen.getByText("Checking desktop runtime")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /hold to talk/i })).toBeDisabled();
  });

  it("shows runtime details when the native command succeeds", async () => {
    getRuntimeHealthMock.mockResolvedValue({
      appStatus: "ready",
      operatingSystem: "macos",
      architecture: "aarch64",
    });

    render(<App />);

    expect(await screen.findByText("Desktop runtime ready")).toBeInTheDocument();
    expect(screen.getByText("macos")).toBeInTheDocument();
    expect(screen.getByText("aarch64")).toBeInTheDocument();
  });

  it("surfaces the native error when the command rejects", async () => {
    getRuntimeHealthMock.mockRejectedValue(new Error("command not found"));

    render(<App />);

    expect(
      await screen.findByText("Desktop runtime unavailable"),
    ).toBeInTheDocument();
    expect(screen.getByText("command not found")).toBeInTheDocument();
    expect(
      screen.getByText("Restart the desktop app and try again."),
    ).toBeInTheDocument();
    expect(screen.getByText("Error:", { exact: false })).toBeInTheDocument();
  });
});

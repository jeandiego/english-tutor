import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BrowserAudioRecorder,
  RecordingError,
  toRecordingError,
} from "./recorder";

class FakeMediaRecorder extends EventTarget {
  static instances: FakeMediaRecorder[] = [];

  readonly mimeType = "audio/webm;codecs=opus";
  state: RecordingState = "inactive";

  constructor(readonly stream: MediaStream) {
    super();
    FakeMediaRecorder.instances.push(this);
  }

  start() {
    this.state = "recording";
  }

  stop() {
    this.state = "inactive";
    const dataEvent = new Event("dataavailable") as BlobEvent;
    Object.defineProperty(dataEvent, "data", {
      value: new Blob(["local audio"], { type: this.mimeType }),
    });
    this.dispatchEvent(dataEvent);
    this.dispatchEvent(new Event("stop"));
  }
}

function createStream() {
  const stop = vi.fn();
  const stream = {
    getTracks: () => [{ stop }],
  } as unknown as MediaStream;

  return { stop, stream };
}

describe("BrowserAudioRecorder", () => {
  const createObjectURL = vi.fn(() => "blob:local-recording");
  const revokeObjectURL = vi.fn();

  beforeEach(() => {
    FakeMediaRecorder.instances = [];
    vi.stubGlobal("MediaRecorder", FakeMediaRecorder);
    vi.stubGlobal("URL", {
      createObjectURL,
      revokeObjectURL,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    createObjectURL.mockClear();
    revokeObjectURL.mockClear();
  });

  it("finalizes a local recording with metadata and stops its tracks", async () => {
    const { stop, stream } = createStream();
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: vi.fn().mockResolvedValue(stream) },
    });
    vi.spyOn(performance, "now")
      .mockReturnValueOnce(100)
      .mockReturnValueOnce(1350);
    const recorder = new BrowserAudioRecorder();

    await recorder.start();
    const recording = await recorder.stop();

    expect(recording).toMatchObject({
      playbackUrl: "blob:local-recording",
      durationMs: 1250,
      mimeType: "audio/webm;codecs=opus",
    });
    expect(recording.sizeBytes).toBeGreaterThan(0);
    expect(recording.blob).toBeInstanceOf(Blob);
    expect(stop).toHaveBeenCalledOnce();
    expect(createObjectURL).toHaveBeenCalledWith(recording.blob);
  });

  it("stops a stream that resolves after its start was cancelled", async () => {
    const { stop, stream } = createStream();
    let resolveStream: ((stream: MediaStream) => void) | undefined;
    const streamPromise = new Promise<MediaStream>((resolve) => {
      resolveStream = resolve;
    });
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: vi.fn(() => streamPromise) },
    });
    const recorder = new BrowserAudioRecorder();
    const controller = new AbortController();
    const startPromise = recorder.start(controller.signal);

    controller.abort();
    resolveStream?.(stream);

    await expect(startPromise).rejects.toMatchObject({ name: "AbortError" });
    expect(stop).toHaveBeenCalledOnce();
    expect(FakeMediaRecorder.instances).toHaveLength(0);
  });

  it.each([
    ["NotAllowedError", "permission-denied"],
    ["SecurityError", "permission-denied"],
    ["NotFoundError", "no-device"],
    ["NotReadableError", "device-busy"],
  ])("maps %s to %s", (name, code) => {
    const error = toRecordingError(new DOMException("system error", name));

    expect(error).toBeInstanceOf(RecordingError);
    expect(error.code).toBe(code);
    expect(error.message).not.toContain("system error");
    expect(error.technicalMessage).toContain("system error");
  });

  it("revokes the playback URL when a recording is disposed", () => {
    const recorder = new BrowserAudioRecorder();

    recorder.dispose({
      blob: new Blob(["audio"]),
      playbackUrl: "blob:old-recording",
      durationMs: 500,
      mimeType: "audio/webm",
      sizeBytes: 5,
    });

    expect(revokeObjectURL).toHaveBeenCalledWith("blob:old-recording");
  });
});

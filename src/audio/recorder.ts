export type RecordingErrorCode =
  | "permission-denied"
  | "no-device"
  | "device-busy"
  | "unsupported"
  | "capture-failed";

export class RecordingError extends Error {
  readonly code: RecordingErrorCode;
  readonly technicalMessage: string;

  constructor(
    code: RecordingErrorCode,
    message: string,
    technicalMessage = message,
  ) {
    super(message);
    this.name = "RecordingError";
    this.code = code;
    this.technicalMessage = technicalMessage;
  }
}

export type RecordedAudio = {
  blob: Blob;
  playbackUrl: string;
  durationMs: number;
  mimeType: string;
  sizeBytes: number;
};

export interface AudioRecorder {
  start(signal?: AbortSignal): Promise<void>;
  stop(): Promise<RecordedAudio>;
  cancel(): void;
  dispose(recording: RecordedAudio): void;
}

const ERROR_MESSAGES: Record<RecordingErrorCode, string> = {
  "permission-denied":
    "Microphone access is off. Allow Pako in System Settings > Privacy & Security > Microphone, then try again.",
  "no-device":
    "No microphone was found. Connect or enable a microphone, then try again.",
  "device-busy":
    "The microphone is busy or unavailable. Close other apps using it, then try again.",
  unsupported:
    "Microphone recording is not supported by this macOS webview. Update macOS and try again.",
  "capture-failed":
    "The recording could not be completed. Hold the control and try again.",
};

function describeError(error: unknown): string {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}`;
  }

  return String(error);
}

export function toRecordingError(error: unknown): RecordingError {
  if (error instanceof RecordingError) {
    return error;
  }

  const name = error instanceof DOMException ? error.name : "";
  let code: RecordingErrorCode = "capture-failed";

  if (name === "NotAllowedError" || name === "SecurityError") {
    code = "permission-denied";
  } else if (name === "NotFoundError") {
    code = "no-device";
  } else if (name === "NotReadableError" || name === "AbortError") {
    code = "device-busy";
  }

  return new RecordingError(code, ERROR_MESSAGES[code], describeError(error));
}

function createAbortError(): DOMException {
  return new DOMException("Recording start was cancelled.", "AbortError");
}

function stopTracks(stream: MediaStream | null): void {
  stream?.getTracks().forEach((track) => track.stop());
}

export class BrowserAudioRecorder implements AudioRecorder {
  private chunks: Blob[] = [];
  private failure: RecordingError | null = null;
  private mediaRecorder: MediaRecorder | null = null;
  private startedAt: number | null = null;
  private stream: MediaStream | null = null;

  async start(signal?: AbortSignal): Promise<void> {
    if (
      !navigator.mediaDevices?.getUserMedia ||
      typeof MediaRecorder === "undefined"
    ) {
      throw new RecordingError(
        "unsupported",
        ERROR_MESSAGES.unsupported,
        "MediaDevices.getUserMedia or MediaRecorder is unavailable.",
      );
    }

    if (this.mediaRecorder) {
      throw new RecordingError(
        "capture-failed",
        ERROR_MESSAGES["capture-failed"],
        "A recording is already active.",
      );
    }

    if (signal?.aborted) {
      throw createAbortError();
    }

    let stream: MediaStream;

    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (error) {
      if (signal?.aborted) {
        throw createAbortError();
      }

      throw toRecordingError(error);
    }

    if (signal?.aborted) {
      stopTracks(stream);
      throw createAbortError();
    }

    let mediaRecorder: MediaRecorder;

    try {
      mediaRecorder = new MediaRecorder(stream);
    } catch (error) {
      stopTracks(stream);
      throw toRecordingError(error);
    }

    this.chunks = [];
    this.failure = null;
    this.mediaRecorder = mediaRecorder;
    this.stream = stream;

    mediaRecorder.addEventListener("dataavailable", (event) => {
      if (event.data.size > 0) {
        this.chunks.push(event.data);
      }
    });

    mediaRecorder.addEventListener("error", (event) => {
      const recorderEvent = event as Event & { error?: DOMException };
      this.failure = toRecordingError(
        recorderEvent.error ?? new Error("MediaRecorder reported an error."),
      );
    });

    try {
      mediaRecorder.start();
      this.startedAt = performance.now();
    } catch (error) {
      this.resetActiveRecording();
      throw toRecordingError(error);
    }
  }

  stop(): Promise<RecordedAudio> {
    const mediaRecorder = this.mediaRecorder;
    const startedAt = this.startedAt;

    if (!mediaRecorder || startedAt === null) {
      return Promise.reject(
        new RecordingError(
          "capture-failed",
          ERROR_MESSAGES["capture-failed"],
          "No recording is active.",
        ),
      );
    }

    return new Promise((resolve, reject) => {
      const finalize = () => {
        const durationMs = Math.max(0, performance.now() - startedAt);
        const failure = this.failure;
        const chunks = this.chunks;
        const mimeType =
          mediaRecorder.mimeType ||
          chunks.find((chunk) => chunk.type)?.type ||
          "application/octet-stream";

        this.resetActiveRecording(false);

        if (failure) {
          reject(failure);
          return;
        }

        const blob = new Blob(chunks, {
          type: mimeType === "application/octet-stream" ? "" : mimeType,
        });

        if (blob.size === 0) {
          reject(
            new RecordingError(
              "capture-failed",
              "No audio was captured. Hold the control a little longer and try again.",
              "MediaRecorder finalized an empty Blob.",
            ),
          );
          return;
        }

        try {
          resolve({
            blob,
            playbackUrl: URL.createObjectURL(blob),
            durationMs,
            mimeType,
            sizeBytes: blob.size,
          });
        } catch (error) {
          reject(toRecordingError(error));
        }
      };

      mediaRecorder.addEventListener("stop", finalize, { once: true });

      try {
        if (mediaRecorder.state === "inactive") {
          queueMicrotask(finalize);
        } else {
          mediaRecorder.stop();
        }
      } catch (error) {
        this.resetActiveRecording();
        reject(toRecordingError(error));
      }
    });
  }

  cancel(): void {
    const mediaRecorder = this.mediaRecorder;

    if (mediaRecorder) {
      mediaRecorder.ondataavailable = null;
      mediaRecorder.onerror = null;

      if (mediaRecorder.state !== "inactive") {
        try {
          mediaRecorder.stop();
        } catch {
          // Track cleanup below is the important cancellation guarantee.
        }
      }
    }

    this.resetActiveRecording();
  }

  dispose(recording: RecordedAudio): void {
    URL.revokeObjectURL(recording.playbackUrl);
  }

  private resetActiveRecording(stopRecorder = true): void {
    const mediaRecorder = this.mediaRecorder;

    if (
      stopRecorder &&
      mediaRecorder &&
      mediaRecorder.state !== "inactive"
    ) {
      try {
        mediaRecorder.stop();
      } catch {
        // Stopping tracks is sufficient when the recorder already failed.
      }
    }

    stopTracks(this.stream);
    this.chunks = [];
    this.failure = null;
    this.mediaRecorder = null;
    this.startedAt = null;
    this.stream = null;
  }
}

export function createBrowserAudioRecorder(): AudioRecorder {
  return new BrowserAudioRecorder();
}

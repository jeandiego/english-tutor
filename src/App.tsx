import { useEffect, useState } from "react";
import { ConversationStage } from "./components/ConversationStage";
import { SystemDiagnostics } from "./components/SystemDiagnostics";
import { TalkControl } from "./components/TalkControl";
import { usePushToTalk } from "./hooks/usePushToTalk";
import { getRuntimeHealth } from "./native/health";
import type { HealthState } from "./types/runtime";
import "./App.css";

function App() {
  const [healthState, setHealthState] = useState<HealthState>({
    status: "checking",
  });
  const recording = usePushToTalk({
    enabled: healthState.status === "ready",
  });

  useEffect(() => {
    let ignore = false;

    async function checkDesktopRuntime() {
      try {
        const health = await getRuntimeHealth();

        if (!ignore) {
          setHealthState({ status: "ready", health });
        }
      } catch (error) {
        if (!ignore) {
          setHealthState({
            status: "error",
            message: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }

    void checkDesktopRuntime();

    return () => {
      ignore = true;
    };
  }, []);

  return (
    <main className="coach-shell">
      <header className="app-header">
        <h1>English Coach</h1>
        <div className="local-status" aria-label="Runs locally">
          <span className="local-status__dot" aria-hidden="true" />
          <span>Local</span>
        </div>
      </header>

      <ConversationStage state={recording.state} />
      <TalkControl
        disabled={healthState.status !== "ready"}
        onEnd={(owner) => void recording.end(owner)}
        onStart={(owner) => void recording.begin(owner)}
        state={recording.state}
      />
      <SystemDiagnostics state={healthState} />
    </main>
  );
}

export default App;

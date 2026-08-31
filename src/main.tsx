import { QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { queryClient } from "./queryClient";
import "./index.css";
import { ErrorBoundary, getErrorMessage } from "react-error-boundary";


ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <ErrorBoundary
        fallbackRender={({ error, resetErrorBoundary }) => (
          <div role="alert" className="flex items-center justify-center h-dvh w-full p-12">
            <p>Something went wrong:</p>
            <pre>{getErrorMessage(error)}</pre>
            <button onClick={resetErrorBoundary}>Try again</button>
          </div>
        )}
        onError={(error, info) => {
          console.error("Unhandled application error:", error, info.componentStack);
        }}
        onReset={() => {
          // Reset any state that may have caused the error
        }}
      >

        <App />
      </ErrorBoundary>
      {import.meta.env.DEV ? <ReactQueryDevtools /> : null}
    </QueryClientProvider>
  </React.StrictMode>,
);

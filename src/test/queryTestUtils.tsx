import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, type RenderOptions } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";

export function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false, gcTime: 0 },
    },
  });
}

export function QueryClientTestProvider({
  client = createTestQueryClient(),
  children,
}: {
  client?: QueryClient;
  children: ReactNode;
}) {
  return (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

export function renderWithQueryClient(
  ui: ReactElement,
  options?: { client?: QueryClient; renderOptions?: RenderOptions },
) {
  const client = options?.client ?? createTestQueryClient();
  return {
    client,
    ...render(ui, {
      wrapper: ({ children }) => (
        <QueryClientTestProvider client={client}>
          {children}
        </QueryClientTestProvider>
      ),
      ...options?.renderOptions,
    }),
  };
}

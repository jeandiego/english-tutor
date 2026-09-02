import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { explainSelection, setDictionaryEntryExcluded, toDictionaryError } from "../native/dictionary";
import type { DictionaryContextTag, DictionaryEntry } from "../types/dictionary";

type LookupStatus = "pending" | "resolved" | "error";

export type DictionarySidebarLookup = {
  key: string;
  status: LookupStatus;
  text: string;
  entry?: DictionaryEntry;
  errorMessage?: string;
};

type RequestExplanationInput = {
  text: string;
  surroundingContext: string;
  contextTag: DictionaryContextTag;
  sessionId?: number;
};

type DictionarySidebarContextValue = {
  lookups: DictionarySidebarLookup[];
  requestExplanation: (input: RequestExplanationInput) => void;
  dismissLookup: (key: string) => void;
};

// Falls back to an inert no-op outside a provider (e.g. a component test or
// story that renders `ConversationStage`/`ReadingToWritingPage` in
// isolation) rather than throwing — the dictionary feature just becomes
// unavailable there instead of forcing every such render call site to know
// about it.
const noopContextValue: DictionarySidebarContextValue = {
  lookups: [],
  requestExplanation: () => {},
  dismissLookup: () => {},
};

const DictionarySidebarContext = createContext<DictionarySidebarContextValue>(noopContextValue);

let lookupCounter = 0;

/**
 * Holds the current session's accumulated lookups (newest first) — a
 * working view, not the source of truth. Every lookup is auto-saved
 * server-side by `explain_selection` regardless of whether it stays in
 * this list; dismissing an entry here soft-excludes it from the
 * permanent dictionary too, since a dismiss means "I didn't want this."
 */
export function DictionarySidebarProvider({
  children,
  onLookupRequested,
}: {
  children: ReactNode;
  /** Called synchronously whenever a lookup is requested — lets the host
   * page auto-expand the (separately-controlled) right sidebar so the
   * result doesn't appear off-screen. */
  onLookupRequested?: () => void;
}) {
  const [lookups, setLookups] = useState<DictionarySidebarLookup[]>([]);

  const requestExplanation = useCallback((input: RequestExplanationInput) => {
    onLookupRequested?.();
    const key = `lookup-${(lookupCounter += 1)}`;
    setLookups((current) => [{ key, status: "pending", text: input.text }, ...current]);

    explainSelection(input)
      .then((entry) => {
        setLookups((current) =>
          current.map((lookup) => (lookup.key === key ? { ...lookup, status: "resolved", entry } : lookup)),
        );
      })
      .catch((error: unknown) => {
        const dictionaryError = toDictionaryError(error);
        setLookups((current) =>
          current.map((lookup) =>
            lookup.key === key ? { ...lookup, status: "error", errorMessage: dictionaryError.message } : lookup,
          ),
        );
      });
  }, [onLookupRequested]);

  const dismissLookup = useCallback((key: string) => {
    setLookups((current) => {
      const lookup = current.find((item) => item.key === key);
      if (lookup?.entry) {
        void setDictionaryEntryExcluded({ id: lookup.entry.id, excluded: true }).catch(() => {
          // Best-effort — the entry disappears from this session list either way.
        });
      }
      return current.filter((item) => item.key !== key);
    });
  }, []);

  return (
    <DictionarySidebarContext.Provider value={{ lookups, requestExplanation, dismissLookup }}>
      {children}
    </DictionarySidebarContext.Provider>
  );
}

export function useDictionarySidebar(): DictionarySidebarContextValue {
  return useContext(DictionarySidebarContext);
}

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { CHUNK_TYPE_LABELS } from "../chunk/labels";
import { chunkKeys } from "../queryKeys/chunk";
import { dictionaryKeys } from "../queryKeys/dictionary";
import {
  listDictionaryEntries,
  promoteDictionaryEntry,
  setDictionaryEntryExcluded,
  toDictionaryError,
} from "../native/dictionary";
import type { DictionaryContextTag, DictionaryEntry } from "../types/dictionary";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card, CardContent } from "./ui/card";

const ENTRIES_LIMIT = 200;
const CONTEXT_FILTERS: (DictionaryContextTag | "all")[] = ["all", "reading", "writing", "conversation"];
const CONTEXT_TAG_LABELS: Record<DictionaryContextTag, string> = {
  reading: "Reading",
  writing: "Writing",
  conversation: "Conversation",
};

function DictionaryEntryCard({
  entry,
  excluding,
  onPromote,
  onToggleExcluded,
  promoting,
}: {
  entry: DictionaryEntry;
  excluding: boolean;
  onPromote: () => void;
  onToggleExcluded: () => void;
  promoting: boolean;
}) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-2 pt-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-body-lg font-medium text-foreground">“{entry.text}”</span>
          <Badge variant="outline">{CHUNK_TYPE_LABELS[entry.chunkType]}</Badge>
          <Badge variant="secondary">{CONTEXT_TAG_LABELS[entry.contextTag]}</Badge>
          {entry.excluded && <Badge variant="secondary">Excluded</Badge>}
          {entry.promotedLexicalChunkId && <Badge variant="secondary">In chunk bank</Badge>}
        </div>
        <p className="text-body text-muted-foreground">{entry.meaning}</p>
        {entry.examples.length > 0 && (
          <ul className="flex flex-col gap-1 text-caption text-muted-foreground">
            {entry.examples.map((example, index) => (
              <li key={index}>“{example}”</li>
            ))}
          </ul>
        )}
        <div className="flex items-center gap-2 pt-1">
          {!entry.promotedLexicalChunkId && (
            <Button disabled={promoting} onClick={onPromote} size="sm" type="button">
              {promoting ? "Promoting…" : "Promote to practice"}
            </Button>
          )}
          <Button disabled={excluding} onClick={onToggleExcluded} size="sm" type="button" variant="outline">
            {excluding ? "Saving…" : entry.excluded ? "Un-exclude" : "Exclude"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export function DictionaryPage() {
  const queryClient = useQueryClient();
  const [contextFilter, setContextFilter] = useState<DictionaryContextTag | "all">("all");
  const [showExcluded, setShowExcluded] = useState(false);

  const contextTag = contextFilter === "all" ? undefined : contextFilter;
  const entriesQuery = useQuery({
    queryKey: dictionaryKeys.list(contextTag, showExcluded),
    queryFn: () => listDictionaryEntries(contextTag, showExcluded, ENTRIES_LIMIT),
  });

  const excludeMutation = useMutation({
    mutationFn: (request: { id: number; excluded: boolean }) => setDictionaryEntryExcluded(request),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: dictionaryKeys.all });
    },
  });

  const promoteMutation = useMutation({
    mutationFn: (id: number) => promoteDictionaryEntry({ id }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: dictionaryKeys.all });
      void queryClient.invalidateQueries({ queryKey: chunkKeys.all });
    },
  });

  const entries = entriesQuery.data ?? [];

  return (
    <section aria-labelledby="dictionary-title" className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 p-6">
        <h2 className="text-subheading font-semibold text-foreground" id="dictionary-title">
          Dictionary
        </h2>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap gap-2">
            {CONTEXT_FILTERS.map((filter) => (
              <Button
                key={filter}
                onClick={() => setContextFilter(filter)}
                size="sm"
                type="button"
                variant={contextFilter === filter ? "default" : "outline"}
              >
                {filter === "all" ? "All" : CONTEXT_TAG_LABELS[filter]}
              </Button>
            ))}
          </div>
          <Button
            onClick={() => setShowExcluded((current) => !current)}
            size="sm"
            type="button"
            variant={showExcluded ? "default" : "outline"}
          >
            {showExcluded ? "Hide excluded" : "Show excluded"}
          </Button>
        </div>

        {entriesQuery.isPending && <p className="text-body text-muted-foreground">Loading…</p>}
        {entriesQuery.isError && (
          <p className="text-body text-destructive" role="alert">
            {toDictionaryError(entriesQuery.error).message}
          </p>
        )}

        {entriesQuery.data && entries.length === 0 && (
          <p className="text-body text-muted-foreground">
            No words yet — right-click a word or phrase anywhere you're reading in the app and
            choose Explain to start building your dictionary.
          </p>
        )}

        <div className="flex flex-col gap-3">
          {entries.map((entry) => (
            <DictionaryEntryCard
              entry={entry}
              excluding={excludeMutation.isPending && excludeMutation.variables?.id === entry.id}
              key={entry.id}
              onPromote={() => promoteMutation.mutate(entry.id)}
              onToggleExcluded={() =>
                excludeMutation.mutate({ id: entry.id, excluded: !entry.excluded })
              }
              promoting={promoteMutation.isPending && promoteMutation.variables === entry.id}
            />
          ))}
        </div>
      </div>
    </section>
  );
}

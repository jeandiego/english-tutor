import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { CHUNK_TYPE_LABELS, PRODUCTIVE_STATUS_LABELS } from "../chunk/labels";
import { useChunkPractice } from "../hooks/useChunkPractice";
import { usePushToTalk } from "../hooks/usePushToTalk";
import { createManualLexicalChunk, listActiveLexicalChunks, promoteLexicalChunk, toChunkError } from "../native/chunk";
import { chunkKeys } from "../queryKeys/chunk";
import type { CefrLevel } from "../types/assessment";
import type { CreateManualLexicalChunkRequest, LexicalChunk, LexicalChunkType, ProductiveStatus } from "../types/chunk";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card, CardContent, CardHeader } from "./ui/card";
import { Field, FieldLabel } from "./ui/field";
import { InputGroup, InputGroupTextarea } from "./ui/input-group";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "./ui/sheet";
import { Textarea } from "./ui/textarea";
import { TalkControl } from "./TalkControl";

const CHUNKS_LIMIT = 100;
const CEFR_LEVELS: CefrLevel[] = ["A1", "A2", "B1", "B2", "C1", "C2"];
const CHUNK_TYPES = Object.keys(CHUNK_TYPE_LABELS) as LexicalChunkType[];
const STATUS_FILTERS: (ProductiveStatus | "all")[] = [
  "all",
  "not_tried",
  "recognized",
  "used_with_help",
  "used_independently",
  "automatic",
];

function ChunkCard({
  chunk,
  disabled,
  onPractice,
  onPromote,
  promoting,
}: {
  chunk: LexicalChunk;
  disabled: boolean;
  onPractice: () => void;
  onPromote: () => void;
  promoting: boolean;
}) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-2 pt-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-body-lg font-medium text-foreground">“{chunk.text}”</span>
          <Badge variant="outline">{CHUNK_TYPE_LABELS[chunk.chunkType]}</Badge>
          <Badge variant="secondary">{PRODUCTIVE_STATUS_LABELS[chunk.productiveStatus]}</Badge>
          {chunk.isPromoted && <Badge variant="secondary">In spaced review</Badge>}
        </div>
        <p className="text-body text-muted-foreground">{chunk.meaning}</p>
        <p className="text-caption text-muted-foreground">
          {chunk.register} · {chunk.targetLevel}
          {chunk.domain ? ` · ${chunk.domain}` : ""}
        </p>
        {chunk.commonError && (
          <p className="text-caption text-muted-foreground">Common error: “{chunk.commonError}”</p>
        )}
        <div className="flex items-center gap-2 pt-1">
          <Button disabled={disabled} onClick={onPractice} size="sm" type="button">
            Practice
          </Button>
          {!chunk.isPromoted && (
            <Button
              disabled={disabled || promoting}
              onClick={onPromote}
              size="sm"
              type="button"
              variant="outline"
            >
              {promoting ? "Promoting…" : "Promote to review"}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function PracticePanel({
  disabled,
  disabledHint,
  practice,
}: {
  disabled: boolean;
  disabledHint?: string;
  practice: ReturnType<typeof useChunkPractice>;
}) {
  const [answer, setAnswer] = useState("");
  const pushToTalk = usePushToTalk({ enabled: !disabled && practice.template?.modality === "spoken" });

  if (!practice.chunk || !practice.template) {
    return null;
  }

  const spoken = practice.template.modality === "spoken";
  const transcribedText = pushToTalk.state.status === "transcribed" ? pushToTalk.state.text : "";

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <h3 className="text-body-lg font-medium text-foreground">“{practice.chunk.text}”</h3>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p className="text-body text-foreground">{practice.template.instruction}</p>

          {practice.status === "answering" && spoken && (
            <div className="flex flex-col gap-2">
              <TalkControl
                disabled={disabled || pushToTalk.state.status === "transcribing"}
                disabledHint={disabledHint}
                onEnd={(owner) => void pushToTalk.end(owner)}
                onStart={(owner) => void pushToTalk.begin(owner)}
                state={pushToTalk.state}
              />
              {transcribedText && (
                <Button
                  onClick={() => void practice.submit(transcribedText)}
                  type="button"
                >
                  Submit “{transcribedText}”
                </Button>
              )}
            </div>
          )}

          {practice.status === "answering" && !spoken && (
            <div className="flex flex-col gap-2">
              <InputGroup className="h-auto">
                <InputGroupTextarea
                  disabled={disabled}
                  onChange={(event) => setAnswer(event.target.value)}
                  placeholder="Write your answer…"
                  rows={4}
                  value={answer}
                />
              </InputGroup>
              <Button
                className="w-fit"
                disabled={disabled || answer.trim().length === 0}
                onClick={() => void practice.submit(answer)}
                type="button"
              >
                Submit
              </Button>
            </div>
          )}

          {practice.status === "evaluating" && (
            <p className="text-body text-muted-foreground" role="status">
              Checking your attempt…
            </p>
          )}

          {practice.error && (
            <p className="text-body text-destructive" role="alert">
              {practice.error.message}
            </p>
          )}

          {practice.status === "result" && practice.evaluation && practice.updatedChunk && (
            <div className="flex flex-col gap-2 rounded-[var(--radius-cards)] bg-card p-3 shadow-[0_1px_2px_rgba(0,0,0,0.08)]">
              <div className="flex items-center gap-2">
                <Badge
                  variant={
                    practice.evaluation.outcome === "remembered"
                      ? "success"
                      : practice.evaluation.outcome === "partially_remembered"
                        ? "warning"
                        : "destructive"
                  }
                >
                  {practice.evaluation.outcome.replace(/_/g, " ")}
                </Badge>
                <Badge variant="secondary">
                  {PRODUCTIVE_STATUS_LABELS[practice.updatedChunk.productiveStatus]}
                </Badge>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="flex items-center gap-2">
        <Button onClick={practice.reset} type="button" variant="outline">
          Back to chunk bank
        </Button>
        {practice.status === "result" && (
          <Button onClick={() => practice.start(practice.updatedChunk ?? practice.chunk!)} type="button">
            Practice again
          </Button>
        )}
      </div>
    </div>
  );
}

function AddChunkSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const queryClient = useQueryClient();
  const [text, setText] = useState("");
  const [chunkType, setChunkType] = useState<LexicalChunkType>("phrase");
  const [meaning, setMeaning] = useState("");
  const [register, setRegister] = useState("neutral");
  const [targetLevel, setTargetLevel] = useState<CefrLevel>("C1");
  const [domain, setDomain] = useState("");
  const [commonError, setCommonError] = useState("");

  const mutation = useMutation({
    mutationFn: (request: CreateManualLexicalChunkRequest) => createManualLexicalChunk(request),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: chunkKeys.all });
      setText("");
      setMeaning("");
      setDomain("");
      setCommonError("");
      onOpenChange(false);
    },
  });

  function handleSubmit() {
    if (text.trim().length === 0 || meaning.trim().length === 0) {
      return;
    }
    mutation.mutate({
      text: text.trim(),
      chunkType,
      meaning: meaning.trim(),
      register: register.trim() || "neutral",
      targetLevel,
      domain: domain.trim() || undefined,
      commonError: commonError.trim() || undefined,
    });
  }

  return (
    <Sheet onOpenChange={onOpenChange} open={open}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Add a chunk</SheetTitle>
        </SheetHeader>
        <div className="flex flex-col gap-4 p-4 pt-0">
          <Field>
            <FieldLabel htmlFor="chunk-text">Text</FieldLabel>
            <Input
              id="chunk-text"
              onChange={(event) => setText(event.target.value)}
              placeholder="e.g. raise concerns about"
              value={text}
            />
          </Field>

          <Field>
            <FieldLabel htmlFor="chunk-meaning">Meaning</FieldLabel>
            <Textarea
              id="chunk-meaning"
              onChange={(event) => setMeaning(event.target.value)}
              placeholder="A short definition"
              rows={2}
              value={meaning}
            />
          </Field>

          <Field>
            <Label>Type</Label>
            <Select
              onValueChange={(value) => setChunkType(value as LexicalChunkType)}
              value={chunkType}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CHUNK_TYPES.map((type) => (
                  <SelectItem key={type} value={type}>
                    {CHUNK_TYPE_LABELS[type]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field>
            <Label>Target level</Label>
            <Select
              onValueChange={(value) => setTargetLevel(value as CefrLevel)}
              value={targetLevel}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CEFR_LEVELS.map((level) => (
                  <SelectItem key={level} value={level}>
                    {level}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field>
            <FieldLabel htmlFor="chunk-register">Register</FieldLabel>
            <Input
              id="chunk-register"
              onChange={(event) => setRegister(event.target.value)}
              placeholder="neutral, formal, informal…"
              value={register}
            />
          </Field>

          <Field>
            <FieldLabel htmlFor="chunk-domain">Domain (optional)</FieldLabel>
            <Input
              id="chunk-domain"
              onChange={(event) => setDomain(event.target.value)}
              placeholder="work, interviews, tech…"
              value={domain}
            />
          </Field>

          <Field>
            <FieldLabel htmlFor="chunk-common-error">Common error (optional)</FieldLabel>
            <Input
              id="chunk-common-error"
              onChange={(event) => setCommonError(event.target.value)}
              placeholder="What people say instead"
              value={commonError}
            />
          </Field>

          {mutation.isError && (
            <p className="text-body text-destructive" role="alert">
              {toChunkError(mutation.error).message}
            </p>
          )}

          <Button
            disabled={mutation.isPending || text.trim().length === 0 || meaning.trim().length === 0}
            onClick={handleSubmit}
            type="button"
          >
            {mutation.isPending ? "Adding…" : "Add chunk"}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

export function ChunkBankPage({
  disabled,
  disabledHint,
}: {
  disabled: boolean;
  disabledHint?: string;
}) {
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<ProductiveStatus | "all">("all");
  const [addChunkOpen, setAddChunkOpen] = useState(false);
  const practice = useChunkPractice();

  const chunksQuery = useQuery({
    queryKey: chunkKeys.active(CHUNKS_LIMIT),
    queryFn: () => listActiveLexicalChunks(CHUNKS_LIMIT),
  });

  const promoteMutation = useMutation({
    mutationFn: (chunkId: number) => promoteLexicalChunk({ chunkId }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: chunkKeys.all });
    },
  });

  const chunks = chunksQuery.data ?? [];
  const visibleChunks =
    statusFilter === "all" ? chunks : chunks.filter((chunk) => chunk.productiveStatus === statusFilter);

  if (practice.chunk) {
    return (
      <section aria-labelledby="chunk-bank-title" className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 p-6">
          <h2 className="text-subheading font-semibold text-foreground" id="chunk-bank-title">
            Chunk bank
          </h2>
          <PracticePanel disabled={disabled} disabledHint={disabledHint} practice={practice} />
        </div>
      </section>
    );
  }

  return (
    <section aria-labelledby="chunk-bank-title" className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 p-6">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-subheading font-semibold text-foreground" id="chunk-bank-title">
            Chunk bank
          </h2>
          <Button onClick={() => setAddChunkOpen(true)} size="sm" type="button" variant="outline">
            Add chunk
          </Button>
        </div>

        <div className="flex flex-wrap gap-2">
          {STATUS_FILTERS.map((status) => (
            <Button
              key={status}
              onClick={() => setStatusFilter(status)}
              size="sm"
              type="button"
              variant={statusFilter === status ? "default" : "outline"}
            >
              {status === "all" ? "All" : PRODUCTIVE_STATUS_LABELS[status]}
            </Button>
          ))}
        </div>

        {chunksQuery.isPending && <p className="text-body text-muted-foreground">Loading…</p>}
        {chunksQuery.isError && (
          <p className="text-body text-destructive" role="alert">
            {toChunkError(chunksQuery.error).message}
          </p>
        )}

        {chunksQuery.data && visibleChunks.length === 0 && (
          <p className="text-body text-muted-foreground">
            No chunks yet — useful expressions from corrections, better phrasings, and writing
            feedback will show up here automatically, or add one yourself.
          </p>
        )}

        <div className="flex flex-col gap-3">
          {visibleChunks.map((chunk) => (
            <ChunkCard
              chunk={chunk}
              disabled={disabled}
              key={chunk.id}
              onPractice={() => practice.start(chunk)}
              onPromote={() => promoteMutation.mutate(chunk.id)}
              promoting={promoteMutation.isPending && promoteMutation.variables === chunk.id}
            />
          ))}
        </div>

        {disabled && disabledHint && (
          <p className="text-caption text-muted-foreground">{disabledHint}</p>
        )}
      </div>

      <AddChunkSheet onOpenChange={setAddChunkOpen} open={addChunkOpen} />
    </section>
  );
}

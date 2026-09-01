import { useState } from "react";
import { useReadingToWritingSession } from "../hooks/useReadingToWritingSession";
import { READING_TEXT_CATALOG } from "../reading/loadReadingTexts";
import { readingTextTypeLabel } from "../types/reading";
import type {
  ReadingEvaluationResult,
  ReadingTargetChunk,
  ReadingText,
} from "../types/reading";
import { Alert, AlertDescription, AlertTitle } from "./ui/alert";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card, CardContent, CardHeader } from "./ui/card";
import { Checkbox } from "./ui/checkbox";
import { Field, FieldLabel, FieldLegend, FieldSet } from "./ui/field";
import { InputGroup, InputGroupTextarea } from "./ui/input-group";
import { RadioGroup, RadioGroupItem } from "./ui/radio-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

type ReadingToWritingPageProps = {
  disabled: boolean;
  disabledHint?: string;
};

const MIN_ACCEPTED_CHUNKS = 3;
const MAX_ACCEPTED_CHUNKS = 5;

function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed.length === 0 ? 0 : trimmed.split(/\s+/).length;
}

function ThinkingStatus({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 py-2" role="status">
      <span aria-hidden="true" className="size-2 animate-pulse rounded-full bg-muted-foreground" />
      <p className="text-caption text-muted-foreground">{label}</p>
    </div>
  );
}

function TextCatalog({
  texts,
  disabled,
  onSelect,
}: {
  texts: ReadingText[];
  disabled: boolean;
  onSelect: (text: ReadingText) => void;
}) {
  return (
    <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {texts.map((text) => (
        <li key={text.id}>
          <button
            className="flex w-full flex-col gap-2 rounded-xl bg-card p-4 text-left ring-1 ring-foreground/10 transition-colors hover:ring-foreground/20 disabled:pointer-events-none disabled:opacity-50"
            disabled={disabled}
            onClick={() => onSelect(text)}
            type="button"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-body font-medium text-foreground">{text.title}</span>
              <Badge variant="outline">{text.level}</Badge>
            </div>
            <p className="text-caption text-muted-foreground">{readingTextTypeLabel(text.textType)}</p>
            <p className="text-caption text-muted-foreground">{text.theme}</p>
          </button>
        </li>
      ))}
    </ul>
  );
}

function ReadingTextCard({ text }: { text: ReadingText }) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-body-lg font-medium text-foreground">{text.title}</h3>
          <Badge variant="outline">{text.level}</Badge>
        </div>
      </CardHeader>
      <CardContent>
        <p className="whitespace-pre-wrap text-body text-foreground">{text.body}</p>
      </CardContent>
    </Card>
  );
}

function ComprehensionCheck({
  disabled,
  text,
  onSubmit,
}: {
  disabled: boolean;
  text: ReadingText;
  onSubmit: (selectedOptionIndex: number) => void;
}) {
  const [selectedIndex, setSelectedIndex] = useState<string | undefined>();

  return (
    <Card>
      <CardHeader>
        <h3 className="text-body-lg font-medium text-foreground">Comprehension check</h3>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <FieldSet>
          <FieldLegend variant="label">{text.comprehensionCheck.question}</FieldLegend>
          <RadioGroup disabled={disabled} onValueChange={setSelectedIndex} value={selectedIndex}>
            {text.comprehensionCheck.options.map((option, index) => (
              <Field key={index} orientation="horizontal">
                <RadioGroupItem id={`comprehension-option-${index}`} value={String(index)} />
                <FieldLabel htmlFor={`comprehension-option-${index}`}>{option}</FieldLabel>
              </Field>
            ))}
          </RadioGroup>
        </FieldSet>
        <Button
          className="w-fit"
          disabled={disabled || selectedIndex === undefined}
          onClick={() => selectedIndex !== undefined && onSubmit(Number(selectedIndex))}
          type="button"
        >
          Submit answer
        </Button>
      </CardContent>
    </Card>
  );
}

function ComprehensionResultBanner({ isCorrect }: { isCorrect: boolean }) {
  return (
    <p className="text-body text-foreground">
      {isCorrect ? "Correct — nice reading." : "Not quite, but let's keep going."}
    </p>
  );
}

function ChunkSelection({
  disabled,
  text,
  onConfirm,
}: {
  disabled: boolean;
  text: ReadingText;
  onConfirm: (chunks: ReadingTargetChunk[]) => void;
}) {
  const [selectedIndices, setSelectedIndices] = useState<Set<number>>(new Set());

  function toggle(index: number, checked: boolean) {
    setSelectedIndices((current) => {
      const next = new Set(current);
      if (checked) {
        next.add(index);
      } else {
        next.delete(index);
      }
      return next;
    });
  }

  const count = selectedIndices.size;
  const canConfirm = count >= MIN_ACCEPTED_CHUNKS && count <= MAX_ACCEPTED_CHUNKS;

  return (
    <Card>
      <CardHeader>
        <h3 className="text-body-lg font-medium text-foreground">
          Pick {MIN_ACCEPTED_CHUNKS}–{MAX_ACCEPTED_CHUNKS} useful chunks from the text
        </h3>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <FieldSet>
          {text.targetChunks.map((chunk, index) => (
            <Field key={index} orientation="horizontal">
              <Checkbox
                checked={selectedIndices.has(index)}
                disabled={disabled}
                id={`chunk-${index}`}
                onCheckedChange={(checked) => toggle(index, checked === true)}
              />
              <FieldLabel className="flex-col items-start gap-0.5" htmlFor={`chunk-${index}`}>
                <span className="font-medium text-foreground">“{chunk.text}”</span>
                <span className="text-caption font-normal text-muted-foreground">{chunk.meaning}</span>
              </FieldLabel>
            </Field>
          ))}
        </FieldSet>
        <div className="flex items-center justify-between gap-2">
          <span className="text-caption text-muted-foreground">
            {count} selected · {MIN_ACCEPTED_CHUNKS}–{MAX_ACCEPTED_CHUNKS} required
          </span>
          <Button
            disabled={disabled || !canConfirm}
            onClick={() =>
              onConfirm(Array.from(selectedIndices).map((index) => text.targetChunks[index]))
            }
            type="button"
          >
            Confirm chunks
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function ProductionComposer({
  disabled,
  text,
  onSubmit,
}: {
  disabled: boolean;
  text: ReadingText;
  onSubmit: (summaryText: string, responseText: string) => void;
}) {
  const [summaryText, setSummaryText] = useState("");
  const [responseText, setResponseText] = useState("");
  const summaryWordCount = countWords(summaryText);
  const canSubmit = summaryText.trim().length > 0 && responseText.trim().length > 0;

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <h3 className="text-body-lg font-medium text-foreground">Summary</h3>
          <p className="text-caption text-muted-foreground">{text.summaryPrompt}</p>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          <InputGroup className="h-auto">
            <InputGroupTextarea
              disabled={disabled}
              onChange={(event) => setSummaryText(event.target.value)}
              placeholder="Write your summary here…"
              rows={5}
              value={summaryText}
            />
          </InputGroup>
          <span className="text-caption text-muted-foreground">
            {summaryWordCount} {summaryWordCount === 1 ? "word" : "words"} · suggested 80–120
          </span>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <h3 className="text-body-lg font-medium text-foreground">Response</h3>
          <p className="text-caption text-muted-foreground">{text.responsePrompt}</p>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          <InputGroup className="h-auto">
            <InputGroupTextarea
              disabled={disabled}
              onChange={(event) => setResponseText(event.target.value)}
              placeholder="Write your response here…"
              rows={5}
              value={responseText}
            />
          </InputGroup>
        </CardContent>
      </Card>

      <Button
        className="w-fit"
        disabled={disabled || !canSubmit}
        onClick={() => onSubmit(summaryText, responseText)}
        type="button"
      >
        Submit for feedback
      </Button>
    </div>
  );
}

const FIDELITY_LABELS: Record<ReadingEvaluationResult["summaryFidelity"], string> = {
  faithful: "Faithful",
  partially_faithful: "Partially faithful",
  unfaithful: "Unfaithful",
};

const RELEVANCE_LABELS: Record<ReadingEvaluationResult["responseRelevance"], string> = {
  relevant: "Relevant",
  partially_relevant: "Partially relevant",
  off_topic: "Off topic",
};

function FeedbackView({
  evaluation,
  onStartNewSession,
}: {
  evaluation: ReadingEvaluationResult;
  onStartNewSession: () => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardContent className="flex flex-wrap items-center gap-3 pt-4">
          <div className="flex items-center gap-2">
            <span className="text-caption text-muted-foreground">Summary</span>
            <Badge variant="secondary">{FIDELITY_LABELS[evaluation.summaryFidelity]}</Badge>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-caption text-muted-foreground">Response</span>
            <Badge variant="secondary">{RELEVANCE_LABELS[evaluation.responseRelevance]}</Badge>
          </div>
        </CardContent>
      </Card>

      <div className="flex flex-col gap-2">
        <h3 className="text-body-lg font-medium text-foreground">Priorities to fix</h3>
        <ul aria-label="Priority issues" className="flex flex-col gap-3">
          {evaluation.priorityIssues.map((issue, index) => (
            <li
              className="flex flex-col gap-1.5 rounded-[var(--radius-cards)] bg-card p-3 shadow-[0_1px_2px_rgba(0,0,0,0.08)]"
              key={index}
            >
              <Badge variant="outline">{issue.category === "summary" ? "Summary" : "Response"}</Badge>
              <p className="text-body">
                <span className="text-muted-foreground">You wrote </span>
                <span className="text-foreground">“{issue.original}”</span>
              </p>
              <p className="text-body">
                <span className="text-muted-foreground">Better </span>
                <span className="font-medium text-success">“{issue.suggested}”</span>
              </p>
              <p className="text-caption text-muted-foreground">{issue.explanation}</p>
            </li>
          ))}
        </ul>
      </div>

      <div className="flex flex-col gap-2">
        <h3 className="text-body-lg font-medium text-foreground">Useful chunks</h3>
        <ul aria-label="Useful chunks" className="flex flex-col gap-3">
          {evaluation.usefulChunks.map((chunk, index) => (
            <li
              className="flex flex-col gap-1.5 rounded-[var(--radius-cards)] bg-card p-3 shadow-[0_1px_2px_rgba(0,0,0,0.08)]"
              key={index}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium text-foreground">“{chunk.chunk}”</span>
                <Badge variant="outline">{chunk.register}</Badge>
              </div>
              <p className="text-caption text-muted-foreground">{chunk.example}</p>
            </li>
          ))}
        </ul>
      </div>

      <div className="flex items-center gap-2">
        <Button onClick={onStartNewSession} type="button" variant="outline">
          Start a new session
        </Button>
        <Tooltip>
          <TooltipTrigger render={<span className="inline-block w-fit" />}>
            <Button disabled type="button" variant="ghost">
              Speak your response (optional)
            </Button>
          </TooltipTrigger>
          <TooltipContent>Coming soon — spoken responses aren't wired up yet.</TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
}

export function ReadingToWritingPage({ disabled, disabledHint }: ReadingToWritingPageProps) {
  const session = useReadingToWritingSession();
  const texts = READING_TEXT_CATALOG.texts;

  return (
    <section aria-labelledby="reading-title" className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 p-6">
        <h2 className="text-subheading font-semibold text-foreground" id="reading-title">
          Reading to Writing
        </h2>

        {session.status === "catalog" && (
          <div className="flex flex-col gap-4">
            <p className="text-body text-muted-foreground">
              Read a short text, answer a comprehension check, pick useful chunks, then write a
              summary and a response.
            </p>
            <TextCatalog disabled={disabled} onSelect={(text) => void session.selectText(text)} texts={texts} />
            {disabled && disabledHint && (
              <p className="text-caption text-muted-foreground">{disabledHint}</p>
            )}
          </div>
        )}

        {session.status === "reading" && session.text && (
          <div className="flex flex-col gap-4">
            <ReadingTextCard text={session.text} />
            <ComprehensionCheck
              disabled={disabled}
              onSubmit={(index) => void session.submitComprehensionAnswer(index)}
              text={session.text}
            />
          </div>
        )}

        {session.status === "chunkSelection" && session.text && (
          <div className="flex flex-col gap-4">
            <ReadingTextCard text={session.text} />
            {session.comprehensionResult && (
              <ComprehensionResultBanner isCorrect={session.comprehensionResult.isCorrect} />
            )}
            <ChunkSelection
              disabled={disabled}
              onConfirm={(chunks) => void session.confirmChunks(chunks)}
              text={session.text}
            />
          </div>
        )}

        {(session.status === "production" || session.status === "evaluating") && session.text && (
          <div className="flex flex-col gap-4">
            <ReadingTextCard text={session.text} />
            <ProductionComposer
              disabled={disabled || session.status === "evaluating"}
              onSubmit={(summaryText, responseText) =>
                void session.submitProduction(summaryText, responseText)
              }
              text={session.text}
            />
            {session.status === "evaluating" && <ThinkingStatus label="Evaluating your writing" />}
          </div>
        )}

        {session.status === "feedback" && session.evaluation && (
          <FeedbackView evaluation={session.evaluation} onStartNewSession={session.reset} />
        )}

        {session.status === "error" && session.error && (
          <Alert variant="destructive">
            <AlertTitle>Reading to Writing unavailable</AlertTitle>
            <AlertDescription className="flex flex-col gap-2">
              <p>{session.error.message}</p>
              {session.error.technicalMessage !== session.error.message && (
                <details>
                  <summary className="cursor-pointer">Technical details</summary>
                  <code className="block whitespace-pre-wrap">{session.error.technicalMessage}</code>
                </details>
              )}
            </AlertDescription>
            <Button className="mt-2 w-fit" onClick={session.reset} size="sm" variant="outline">
              Try again
            </Button>
          </Alert>
        )}
      </div>
    </section>
  );
}

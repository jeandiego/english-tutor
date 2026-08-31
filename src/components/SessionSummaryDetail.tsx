import { useState } from "react";
import type { SessionSummaryPayload } from "../types/session";
import type { RepairOutcome, RepairPriority } from "../types/repair";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "./ui/collapsible";

const REPAIR_PRIORITY_LABELS: Record<RepairPriority, string> = {
  grammar: "Grammar",
  vocabulary: "Vocabulary",
  pronunciation: "Pronunciation",
  fluency: "Fluency",
  coherence: "Coherence",
  pragmatics: "Pragmatics",
};

const REPAIR_OUTCOME_LABELS: Record<RepairOutcome, string> = {
  improved: "Fixed",
  failed: "Still tricky",
  skipped: "Skipped",
};

function SummaryList({ heading, items }: { heading: string; items: string[] }) {
  if (items.length === 0) {
    return null;
  }
  return (
    <div className="flex flex-col gap-1">
      <h4 className="text-caption font-medium text-muted-foreground">{heading}</h4>
      <ul className="flex flex-col gap-0.5 text-body text-foreground">
        {items.map((item, index) => (
          <li key={index}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

export function SessionSummaryDetail({ summary }: { summary?: SessionSummaryPayload }) {
  const [expanded, setExpanded] = useState(false);

  if (!summary) {
    return null;
  }

  return (
    <Collapsible onOpenChange={setExpanded} open={expanded}>
      <CollapsibleTrigger
        aria-expanded={expanded}
        className="text-caption font-medium text-primary hover:underline"
      >
        {expanded ? "Hide summary" : "Show summary"}
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-2 flex flex-col gap-3">
        <SummaryList heading="What went well" items={summary.whatWentWell} />
        <SummaryList heading="Priorities" items={summary.priorityIssues} />
        <SummaryList
          heading="Review later"
          items={summary.reviewItems.map((item) => item.content)}
        />
        {summary.repairEvents.length > 0 && (
          <div className="flex flex-col gap-1">
            <h4 className="text-caption font-medium text-muted-foreground">
              Repair practice
            </h4>
            <ul className="flex flex-col gap-0.5 text-body text-foreground">
              {summary.repairEvents.map((event, index) => (
                <li key={index}>
                  {REPAIR_PRIORITY_LABELS[event.priority]}: {event.issue}
                  {event.outcome && <> — {REPAIR_OUTCOME_LABELS[event.outcome]}</>}
                </li>
              ))}
            </ul>
          </div>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}

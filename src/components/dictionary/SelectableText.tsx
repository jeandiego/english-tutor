import { useRef, useState, type ReactNode } from "react";
import { useDictionarySidebar } from "../../hooks/useDictionarySidebar";
import type { DictionaryContextTag } from "../../types/dictionary";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "../ui/context-menu";

type PendingSelection = {
  text: string;
  surroundingContext: string;
};

type SelectableTextProps = {
  className?: string;
  children: ReactNode;
  contextTag: DictionaryContextTag;
  sessionId?: number;
};

function truncate(text: string, max = 40): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/**
 * Wraps a block of learner-facing English text with a right-click "Explain"
 * menu. Capturing the selection on menu open (rather than on item click)
 * matters — by the time the item is clicked, the selection is still intact
 * in every tested case, but reading it as early as possible is the safest
 * point before any intervening interaction could clear it.
 */
export function SelectableText({ className, children, contextTag, sessionId }: SelectableTextProps) {
  const containerRef = useRef<HTMLParagraphElement | null>(null);
  const [pending, setPending] = useState<PendingSelection | null>(null);
  const { requestExplanation } = useDictionarySidebar();

  const handleOpenChange = (open: boolean) => {
    if (!open) {
      return;
    }
    const container = containerRef.current;
    const selection = window.getSelection();
    const text = selection?.toString().trim() ?? "";
    if (!container || !text || !selection || selection.rangeCount === 0) {
      setPending(null);
      return;
    }
    const { anchorNode, focusNode } = selection;
    if (!anchorNode || !focusNode || !container.contains(anchorNode) || !container.contains(focusNode)) {
      // Selection spans outside this block (or a stray selection elsewhere
      // in the page) — don't offer to explain a fragment we can't ground
      // in this block's own surrounding-context text.
      setPending(null);
      return;
    }
    setPending({ text, surroundingContext: container.textContent ?? text });
  };

  return (
    <ContextMenu onOpenChange={handleOpenChange}>
      <ContextMenuTrigger
        className="select-text"
        render={
          <p ref={containerRef} className={className}>
            {children}
          </p>
        }
      />
      <ContextMenuContent>
        <ContextMenuItem
          disabled={!pending}
          onClick={() => {
            if (!pending) {
              return;
            }
            requestExplanation({
              text: pending.text,
              surroundingContext: pending.surroundingContext,
              contextTag,
              sessionId,
            });
          }}
        >
          {pending ? `Explain "${truncate(pending.text)}"` : "Select text to explain"}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

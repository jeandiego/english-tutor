import { IconX } from "@tabler/icons-react";
import { CHUNK_TYPE_LABELS } from "../../chunk/labels";
import { useDictionarySidebar } from "../../hooks/useDictionarySidebar";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Sidebar, SidebarContent, SidebarHeader, SidebarTrigger } from "../ui/sidebar";

export function DictionarySidebar() {
  const { lookups, dismissLookup } = useDictionarySidebar();

  return (
    <Sidebar collapsible="offcanvas" side="right">
      <SidebarHeader className="flex flex-row items-center justify-between gap-2 border-b border-sidebar-border px-3 py-2">
        <span className="text-caption font-medium text-sidebar-foreground">Dictionary</span>
        <SidebarTrigger />
      </SidebarHeader>
      <SidebarContent className="gap-3 p-3">
        {lookups.length === 0 ? (
          <p className="text-caption text-muted-foreground">
            Right-click a word or phrase anywhere to look it up.
          </p>
        ) : (
          lookups.map((lookup) => (
            <div
              className="flex flex-col gap-1.5 rounded-[var(--radius-cards)] bg-card p-3 shadow-[0_1px_2px_rgba(0,0,0,0.08)]"
              key={lookup.key}
            >
              <div className="flex items-start justify-between gap-2">
                <span className="text-body font-medium text-foreground">{lookup.text}</span>
                <Button
                  aria-label="Dismiss"
                  className="size-6 shrink-0"
                  onClick={() => dismissLookup(lookup.key)}
                  size="icon-xs"
                  variant="ghost"
                >
                  <IconX />
                </Button>
              </div>
              {lookup.status === "pending" && (
                <p className="text-caption text-muted-foreground">Looking this up…</p>
              )}
              {lookup.status === "error" && (
                <p className="text-caption text-destructive">{lookup.errorMessage}</p>
              )}
              {lookup.status === "resolved" && lookup.entry && (
                <>
                  <Badge className="w-fit" variant="outline">
                    {CHUNK_TYPE_LABELS[lookup.entry.chunkType]}
                  </Badge>
                  <p className="text-body text-foreground">{lookup.entry.meaning}</p>
                  <ul className="flex flex-col gap-1 text-caption text-muted-foreground">
                    {lookup.entry.examples.map((example, index) => (
                      <li key={index}>“{example}”</li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          ))
        )}
      </SidebarContent>
    </Sidebar>
  );
}

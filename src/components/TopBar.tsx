import { IconSquareRoundedPlusFilled } from "@tabler/icons-react";
import {
  MAC_TRAFFIC_LIGHT_CLEARANCE_PX,
  SIDEBAR_WIDTH_PX,
  TITLEBAR_HEIGHT_PX,
} from "../lib/layout";
import { Button } from "./ui/button";
import { SidebarTrigger, useSidebar } from "./ui/sidebar";

const isMacOverlayWindow =
  typeof navigator !== "undefined" &&
  navigator.userAgent.includes("Mac") &&
  typeof window !== "undefined" &&
  "__TAURI_INTERNALS__" in window;

type TopBarProps = {
  eyebrow: string;
  title: string;
  onNewSession: () => void;
  newSessionDisabled: boolean;
};

export function TopBar({ eyebrow, title, onNewSession, newSessionDisabled }: TopBarProps) {
  const { state } = useSidebar();

  return (
    <header
      className="fixed inset-x-0 top-0 z-30 flex shrink-0 items-center border-b border-border bg-sidebar"
      data-tauri-drag-region
      style={{ height: TITLEBAR_HEIGHT_PX }}
    >
      <div
        className="flex h-full shrink-0 items-center transition-[width] duration-200 ease-linear ms-1"
        style={{
          paddingLeft: isMacOverlayWindow ? MAC_TRAFFIC_LIGHT_CLEARANCE_PX : 12,
          width: state === "expanded" ? SIDEBAR_WIDTH_PX : undefined,
        }}
      >
        <SidebarTrigger size="icon-sm" variant="ghost" className="hover:bg-transparent text-foreground/60 hover:text-foreground" />
      </div>
      <div className="flex min-w-0 flex-1 items-center gap-2 pr-3">
        <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">
          <span className="text-muted-foreground">{eyebrow}</span>
          <span className="mx-1.5 text-muted-foreground">·</span>
          {title}
        </span>
        <Button
          disabled={newSessionDisabled}
          onClick={onNewSession}
          size="sm"
          variant="default"
          className="rounded-xl text-xs shrink-0"
        >
          <IconSquareRoundedPlusFilled />
          New session
        </Button>
      </div>
    </header>
  );
}

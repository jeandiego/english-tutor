import { useQuery } from "@tanstack/react-query";
import {
  IconChartBar,
  IconClipboardCheck,
  IconHistory,
  IconListDetails,
  IconMessage,
  IconMessageCircle2,
  IconPlus,
  IconSettings,
} from "@tabler/icons-react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "../ui/sidebar";
import { Badge } from "../ui/badge";
import { Skeleton } from "../ui/skeleton";
import {
  SystemDiagnostics,
  type TranscriptionDiagnostic,
  type TutorDiagnostic,
} from "../SystemDiagnostics";
import { listRecentSessions } from "../../native/history";
import { historyKeys } from "../../queryKeys/history";
import { scenarioLabelFor } from "../../sessions/loadPacks";
import type { HealthState } from "../../types/runtime";

export type AppPage =
  | "conversation"
  | "sessions"
  | "assessment"
  | "history"
  | "progress"
  | "settings";

const NAV_ITEMS: {
  page: AppPage;
  label: string;
  icon: typeof IconMessageCircle2;
  alwaysEnabled?: boolean;
}[] = [
  { page: "conversation", label: "Conversation", icon: IconMessageCircle2, alwaysEnabled: true },
  { page: "sessions", label: "Sessions", icon: IconListDetails },
  { page: "assessment", label: "Assessment", icon: IconClipboardCheck },
  { page: "history", label: "History", icon: IconHistory },
  { page: "progress", label: "My Progress", icon: IconChartBar },
  { page: "settings", label: "Settings", icon: IconSettings },
];

const RECENT_CONVERSATIONS_LIMIT = 8;

type AppSidebarProps = {
  activePage: AppPage;
  onNavigate: (page: AppPage) => void;
  navigationDisabled: boolean;
  settingsNeedsAttention: boolean;
  healthState: HealthState;
  transcription: TranscriptionDiagnostic;
  tutor: TutorDiagnostic;
  onOpenSettings: () => void;
  onOpenSession: (sessionId: number) => void;
  estimatedLevel?: string;
};

export function AppSidebar({
  activePage,
  onNavigate,
  navigationDisabled,
  settingsNeedsAttention,
  healthState,
  transcription,
  tutor,
  onOpenSettings,
  onOpenSession,
  estimatedLevel,
}: AppSidebarProps) {
  const recentSessionsQuery = useQuery({
    queryKey: historyKeys.recentSessions(RECENT_CONVERSATIONS_LIMIT),
    queryFn: () => listRecentSessions(RECENT_CONVERSATIONS_LIMIT),
  });

  return (
    <Sidebar className="border-r-0">
      <SidebarHeader>
        <div className="flex items-center gap-2 px-2 py-1.5">
          <span className="flex size-6 items-center justify-center rounded-[4px] bg-primary text-xs font-bold text-primary-foreground">
            E
          </span>
          <span className="truncate text-body font-medium text-foreground">
            English Coach
          </span>
        </div>
        <SidebarMenu>
          {NAV_ITEMS.map((item) => (
            <SidebarMenuItem key={item.page}>
              <SidebarMenuButton
                disabled={!item.alwaysEnabled && navigationDisabled}
                isActive={activePage === item.page}
                onClick={() => onNavigate(item.page)}
                tooltip={item.label}
                aria-label={
                  item.page === "settings" && settingsNeedsAttention
                    ? "Settings, needs attention"
                    : undefined
                }
              >
                <item.icon />
                <span>{item.label}</span>
              </SidebarMenuButton>
              {item.page === "settings" && settingsNeedsAttention && (
                <SidebarMenuBadge>
                  <span
                    aria-hidden="true"
                    className="block size-1.5 rounded-full bg-destructive"
                  />
                </SidebarMenuBadge>
              )}
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Recent conversations</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  disabled={navigationDisabled}
                  onClick={() => onNavigate("sessions")}
                >
                  <IconPlus />
                  <span>New conversation</span>
                </SidebarMenuButton>
              </SidebarMenuItem>

              {recentSessionsQuery.isPending &&
                Array.from({ length: 3 }).map((_, index) => (
                  <SidebarMenuItem key={index}>
                    <div className="flex items-center gap-2 px-2 py-1.5">
                      <Skeleton className="size-4 shrink-0 rounded-full" />
                      <Skeleton className="h-3.5 w-full" />
                    </div>
                  </SidebarMenuItem>
                ))}

              {recentSessionsQuery.data?.length === 0 && (
                <SidebarMenuItem>
                  <p className="px-2 py-1.5 text-caption text-muted-foreground">
                    No conversations yet
                  </p>
                </SidebarMenuItem>
              )}

              {recentSessionsQuery.data?.map((session) => (
                <SidebarMenuItem key={session.id}>
                  <SidebarMenuButton
                    onClick={() => onOpenSession(session.id)}
                    tooltip={scenarioLabelFor(session.mode)}
                  >
                    <IconMessage />
                    <span>{scenarioLabelFor(session.mode)}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        {estimatedLevel && (
          <Badge aria-label={`Estimated level ${estimatedLevel}`} className="w-fit" variant="outline">
            {estimatedLevel} estimated
          </Badge>
        )}
        <SystemDiagnostics
          healthState={healthState}
          onOpenSettings={onOpenSettings}
          transcription={transcription}
          tutor={tutor}
        />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}

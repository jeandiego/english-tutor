import { useQuery } from "@tanstack/react-query";
import {
  IconChartBar,
  IconClipboardCheck,
  IconDatabase,
  IconHistory,
  IconListDetails,
  IconMessage,
  IconMessageCircle2,
  IconMicrophone,
  IconPencil,
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
import { conversationTitleFor } from "../../sessions/conversationTitle";
import { scenarioLabelFor } from "../../sessions/loadPacks";
import { relativeTimeFor } from "../../lib/relativeTime";
import type { SessionSummary } from "../../types/history";
import type { HealthState } from "../../types/runtime";
import type { TtsProviderId, TtsSetupState } from "../../types/tts";
import { VoiceSwitcher } from "./VoiceSwitcher";

export type AppPage =
  | "conversation"
  | "sessions"
  | "assessment"
  | "writing"
  | "history"
  | "progress"
  | "pronunciation"
  | "storage"
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
  { page: "writing", label: "Writing", icon: IconPencil },
  { page: "history", label: "History", icon: IconHistory },
  { page: "progress", label: "My Progress", icon: IconChartBar },
  { page: "pronunciation", label: "Pronunciation", icon: IconMicrophone },
  { page: "storage", label: "Storage", icon: IconDatabase },
  { page: "settings", label: "Settings", icon: IconSettings },
];

const RECENT_CONVERSATIONS_LIMIT = 8;

function recentConversationSubtitle(session: SessionSummary, title: string): string {
  const scenario = scenarioLabelFor(session.mode);
  const parts = [scenario === title ? undefined : scenario, relativeTimeFor(session.startedAt)].filter(
    (part): part is string => part !== undefined,
  );
  if (session.turnCount > 0) {
    parts.push(`${session.turnCount} ${session.turnCount === 1 ? "turn" : "turns"}`);
  }
  return parts.join(" · ");
}

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
  ttsState: TtsSetupState;
  onSelectVoice: (provider: TtsProviderId, voiceId: string) => void;
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
  ttsState,
  onSelectVoice,
}: AppSidebarProps) {
  const recentSessionsQuery = useQuery({
    queryKey: historyKeys.recentSessions(RECENT_CONVERSATIONS_LIMIT),
    queryFn: () => listRecentSessions(RECENT_CONVERSATIONS_LIMIT),
  });

  return (
    <Sidebar>
      <SidebarHeader className="mt-10!">
        <SidebarMenu>
          <VoiceSwitcher
            onOpenSettings={onOpenSettings}
            onSelectVoice={onSelectVoice}
            ttsState={ttsState}
          />
        </SidebarMenu>
        <SidebarMenu>
          {NAV_ITEMS.map((item) => (
            <SidebarMenuItem key={item.page}>
              <SidebarMenuButton
                className="rounded-lg!"
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

              {recentSessionsQuery.data?.map((session) => {
                const title = conversationTitleFor(session);
                const subtitle = recentConversationSubtitle(session, title);
                return (
                  <SidebarMenuItem key={session.id}>
                    <SidebarMenuButton
                      onClick={() => onOpenSession(session.id)}
                      size="lg"
                      tooltip={`${title} — ${subtitle}`}
                    >
                      <IconMessage />
                      <div className="flex min-w-0 flex-col gap-0.5">
                        <span className="truncate">{title}</span>
                        <span className="truncate text-caption text-muted-foreground">
                          {subtitle}
                        </span>
                      </div>
                    </SidebarMenuButton>
                    {session.status !== "completed" && (
                      <SidebarMenuBadge>
                        <span
                          aria-hidden="true"
                          className="block size-1.5 rounded-full bg-warning"
                        />
                      </SidebarMenuBadge>
                    )}
                  </SidebarMenuItem>
                );
              })}
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

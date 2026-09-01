import type { CSSProperties } from "react";
import {
  IconDatabase,
  IconHeadphones,
  IconMicrophone2,
  IconRobot,
  IconWaveSine,
} from "@tabler/icons-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "../ui/dialog";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
} from "../ui/sidebar";
import { StoragePage } from "../StoragePage";
import {
  ListeningSettingsSection,
  TranscriptionSettingsSection,
  TutorSettingsSection,
  VoiceSettingsSection,
} from "../SettingsPage";
import type {
  TranscriptionSettings,
  TranscriptionSetupState,
} from "../../types/transcription";
import type { TtsSettings, TtsSetupState } from "../../types/tts";
import type { TutorSettings, TutorSetupState } from "../../types/tutor";

export type SettingsSectionId =
  | "transcription"
  | "tutor"
  | "voice"
  | "listening"
  | "storage";

const SETTINGS_NAV_ITEMS: { id: SettingsSectionId; label: string; icon: typeof IconDatabase }[] = [
  { id: "transcription", label: "Transcription", icon: IconMicrophone2 },
  { id: "tutor", label: "Tutor", icon: IconRobot },
  { id: "voice", label: "Voice", icon: IconWaveSine },
  { id: "listening", label: "Listening", icon: IconHeadphones },
  { id: "storage", label: "Storage", icon: IconDatabase },
];

type SettingsModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  section: SettingsSectionId;
  onSectionChange: (section: SettingsSectionId) => void;
  transcriptionState: TranscriptionSetupState;
  transcriptionDraft: TranscriptionSettings;
  transcriptionDirty: boolean;
  onTranscriptionDraftChange: (settings: TranscriptionSettings) => void;
  onTranscriptionReset: () => void;
  onTranscriptionRetry: () => Promise<void>;
  onTranscriptionSave: () => Promise<void>;
  tutorState: TutorSetupState;
  tutorDraft: TutorSettings;
  tutorDirty: boolean;
  onTutorDraftChange: (settings: TutorSettings) => void;
  onTutorReset: () => void;
  onTutorRetry: () => Promise<void>;
  onTutorSave: () => Promise<void>;
  ttsState: TtsSetupState;
  ttsDraft: TtsSettings;
  ttsDirty: boolean;
  onTtsDraftChange: (settings: TtsSettings) => void;
  onTtsReset: () => void;
  onTtsRetry: () => Promise<void>;
  onTtsSave: () => Promise<void>;
};

export function SettingsModal({
  open,
  onOpenChange,
  section,
  onSectionChange,
  ...settingsProps
}: SettingsModalProps) {
  const activeItem = SETTINGS_NAV_ITEMS.find((item) => item.id === section);

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="overflow-hidden p-0 md:max-h-[560px] md:max-w-[720px] lg:max-w-[780px]">
        <DialogTitle className="sr-only">Settings</DialogTitle>
        <DialogDescription className="sr-only">
          Manage local transcription, tutor, voice, listening, and storage settings.
        </DialogDescription>
        <SidebarProvider
          className="min-h-0 items-start"
          style={{ "--sidebar-width": "160px" } as CSSProperties}
        >
          <Sidebar className="hidden md:flex" collapsible="none">
            <SidebarContent>
              <SidebarGroup>
                <SidebarGroupContent>
                  <SidebarMenu>
                    {SETTINGS_NAV_ITEMS.map((item) => (
                      <SidebarMenuItem key={item.id}>
                        <SidebarMenuButton
                          isActive={item.id === section}
                          onClick={() => onSectionChange(item.id)}
                        >
                          <item.icon />
                          <span>{item.label}</span>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    ))}
                  </SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>
            </SidebarContent>
          </Sidebar>
          <main className="flex h-[560px] flex-1 flex-col overflow-hidden">
            <header className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-4">
              <h2 className="text-body font-medium text-foreground">{activeItem?.label}</h2>
            </header>
            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              {section === "transcription" && (
                <TranscriptionSettingsSection
                  onTranscriptionDraftChange={settingsProps.onTranscriptionDraftChange}
                  onTranscriptionReset={settingsProps.onTranscriptionReset}
                  onTranscriptionRetry={settingsProps.onTranscriptionRetry}
                  onTranscriptionSave={settingsProps.onTranscriptionSave}
                  transcriptionDirty={settingsProps.transcriptionDirty}
                  transcriptionDraft={settingsProps.transcriptionDraft}
                  transcriptionState={settingsProps.transcriptionState}
                />
              )}
              {section === "tutor" && (
                <TutorSettingsSection
                  onTutorDraftChange={settingsProps.onTutorDraftChange}
                  onTutorReset={settingsProps.onTutorReset}
                  onTutorRetry={settingsProps.onTutorRetry}
                  onTutorSave={settingsProps.onTutorSave}
                  tutorDirty={settingsProps.tutorDirty}
                  tutorDraft={settingsProps.tutorDraft}
                  tutorState={settingsProps.tutorState}
                />
              )}
              {section === "voice" && (
                <VoiceSettingsSection
                  onTtsDraftChange={settingsProps.onTtsDraftChange}
                  onTtsReset={settingsProps.onTtsReset}
                  onTtsRetry={settingsProps.onTtsRetry}
                  onTtsSave={settingsProps.onTtsSave}
                  ttsDirty={settingsProps.ttsDirty}
                  ttsDraft={settingsProps.ttsDraft}
                  ttsState={settingsProps.ttsState}
                />
              )}
              {section === "listening" && <ListeningSettingsSection />}
              {section === "storage" && <StoragePage />}
            </div>
          </main>
        </SidebarProvider>
      </DialogContent>
    </Dialog>
  );
}

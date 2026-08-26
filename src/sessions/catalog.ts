export type SessionTemplate = {
  id: string;
  label: string;
  description: string;
  scenarioSystemPrompt: string;
  focusPlaceholder: string;
};

export type DurationPresetId = "quick" | "standard" | "extended";

export type DurationPreset = {
  id: DurationPresetId;
  label: string;
  approxMinutes: string;
  targetTurns: number;
};

export const DURATION_PRESETS: DurationPreset[] = [
  { id: "quick", label: "Quick", approxMinutes: "~3 min", targetTurns: 4 },
  { id: "standard", label: "Standard", approxMinutes: "~6 min", targetTurns: 6 },
  { id: "extended", label: "Extended", approxMinutes: "~10 min", targetTurns: 9 },
];

export const SESSION_TEMPLATES: SessionTemplate[] = [
  {
    id: "daily_standup",
    label: "Daily standup",
    description:
      "Give a short work update: what you did, what's next, and any blockers.",
    scenarioSystemPrompt:
      "You are the learner's teammate running a daily standup meeting. Ask what they worked on yesterday, what they're doing today, and whether anything is blocking them. Keep the tone brisk and professional, like a real standup. Follow up naturally on specifics they mention instead of moving through a checklist.",
    focusPlaceholder: "e.g. talking about a specific project or blocker",
  },
  {
    id: "job_interview",
    label: "Job interview",
    description:
      "Practice answering common interview questions about your experience and skills.",
    scenarioSystemPrompt:
      "You are a hiring manager interviewing the learner for a role they describe or imply through their answers. Ask about their background, a challenge they solved, and why they're interested in the role. Probe for specifics with natural follow-ups, the way a real interviewer would.",
    focusPlaceholder: "e.g. the specific role or industry to interview for",
  },
  {
    id: "pair_programming",
    label: "Pair programming",
    description:
      "Talk through a coding problem together, thinking out loud as you go.",
    scenarioSystemPrompt:
      "You are the learner's pair-programming partner working through a coding problem together. Suggest an approach, ask what they think, and react to their reasoning the way a real engineering partner would — questioning trade-offs, suggesting edge cases, and checking understanding out loud.",
    focusPlaceholder: "e.g. a specific kind of problem (algorithms, debugging, design)",
  },
  {
    id: "restaurant",
    label: "Restaurant",
    description: "Order food, ask about the menu, and handle a restaurant conversation.",
    scenarioSystemPrompt:
      "You are a server at a restaurant. Greet the learner, tell them about specials if it fits naturally, take their order, and handle follow-up questions about the menu, allergies, or the bill the way a real server would.",
    focusPlaceholder: "e.g. a cuisine, dietary restriction, or occasion",
  },
  {
    id: "shopping",
    label: "Shopping",
    description: "Ask for help finding something, sizes, prices, and check out.",
    scenarioSystemPrompt:
      "You are a shop assistant helping the learner find an item, discuss sizes or colors, mention prices, and check out. React naturally to what they're looking for rather than following a script.",
    focusPlaceholder: "e.g. clothing, electronics, a gift",
  },
  {
    id: "movies_series",
    label: "Movies and series",
    description: "Chat casually about what you've been watching and recommend shows.",
    scenarioSystemPrompt:
      "You are a friend chatting casually about movies and TV series. Ask what the learner has been watching, react with opinions, and recommend something based on what they say. Keep it conversational and opinionated, not a lecture.",
    focusPlaceholder: "e.g. a genre you'd like to discuss",
  },
  {
    id: "small_talk",
    label: "Small talk",
    description: "Practice easy, everyday small talk — weather, weekend plans, and more.",
    scenarioSystemPrompt:
      "You are a friendly acquaintance making small talk — the kind of casual conversation that happens while waiting in line or before a meeting starts. Cover light topics like weekend plans, weather, or how their week is going, and follow up naturally on whatever they share.",
    focusPlaceholder: "e.g. a specific setting (office, waiting room, party)",
  },
  {
    id: "storytelling",
    label: "Storytelling about past experiences",
    description: "Tell a story about something that happened to you and reflect on it.",
    scenarioSystemPrompt:
      "You are a curious friend inviting the learner to tell a story about something that happened to them — a trip, a memorable day, a challenge they overcame. Ask a warm opening question, then follow up on details they mention to help them build the story out, especially past-tense narration.",
    focusPlaceholder: "e.g. travel, a challenge, a memorable event",
  },
];

export function findSessionTemplate(id: string | undefined): SessionTemplate | undefined {
  return id === undefined
    ? undefined
    : SESSION_TEMPLATES.find((template) => template.id === id);
}

export function findDurationPreset(id: DurationPresetId): DurationPreset {
  return DURATION_PRESETS.find((preset) => preset.id === id) ?? DURATION_PRESETS[1];
}

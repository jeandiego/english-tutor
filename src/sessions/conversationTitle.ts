import type { SessionSummaryPayload } from "../types/session";
import { findScenarioPack, PACK_CATALOG } from "./loadPacks";

const MAX_TITLE_LENGTH = 60;

function truncate(text: string, maxLength: number): string {
  return text.length > maxLength ? `${text.slice(0, maxLength - 1).trimEnd()}…` : text;
}

export function conversationTitleFor(session: {
  mode?: string;
  topic?: string;
  firstUserTurn?: string;
  summary?: SessionSummaryPayload;
}): string {
  const packTitle = findScenarioPack(PACK_CATALOG.packs, session.mode)?.title;
  if (packTitle) {
    return packTitle;
  }

  if (session.topic?.trim()) {
    return truncate(session.topic.trim(), MAX_TITLE_LENGTH);
  }

  if (session.firstUserTurn?.trim()) {
    return truncate(session.firstUserTurn.trim(), MAX_TITLE_LENGTH);
  }

  const firstHighlight = session.summary?.whatWentWell[0];
  if (firstHighlight?.trim()) {
    return truncate(firstHighlight.trim(), MAX_TITLE_LENGTH);
  }

  return "Conversation";
}

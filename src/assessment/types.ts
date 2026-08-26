import type {
  AssessmentCompetency,
  AssessmentTaskCategory,
  CefrLevel,
  FollowUpIntent,
  LanguageFunction,
} from "../types/assessment";

export type {
  AssessmentCompetency,
  AssessmentTaskCategory,
  CefrLevel,
  FollowUpIntent,
  LanguageFunction,
} from "../types/assessment";

export type AssessmentTask = {
  id: string;
  category: AssessmentTaskCategory;
  cefrRange: { min: CefrLevel; max: CefrLevel };
  competencies: AssessmentCompetency[];
  requiredFunctions: LanguageFunction[];
  anchorPrompt: string;
  followUpPolicy: {
    min: number;
    max: number;
    allowedIntents: FollowUpIntent[];
  };
};

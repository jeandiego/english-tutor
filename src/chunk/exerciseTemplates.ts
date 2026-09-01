import type { ExerciseType, LexicalChunk, Modality } from "../types/chunk";

export type ExerciseTemplate = {
  exerciseType: ExerciseType;
  modality: Modality;
  instruction: string;
};

function firstExample(chunk: LexicalChunk): string {
  return chunk.examples[0] ?? chunk.text;
}

/** Five templates, one per exercise type doc 21 asks for — the practice UI
 * itself stays a single flow; only the instruction text (and, for the
 * spoken one, the input modality) varies. */
const TEMPLATES: ((chunk: LexicalChunk) => ExerciseTemplate)[] = [
  (chunk) => ({
    exerciseType: "use_in_sentence",
    modality: "written",
    instruction: `Use "${chunk.text}" in a natural sentence.`,
  }),
  (chunk) => ({
    exerciseType: "complete_response",
    modality: "written",
    instruction: `Write a short response to a colleague, naturally using "${chunk.text}".`,
  }),
  (chunk) => ({
    exerciseType: "rewrite_sentence",
    modality: "written",
    instruction: `Rewrite this in your own words, using "${chunk.text}": "${firstExample(chunk)}"`,
  }),
  (chunk) => ({
    exerciseType: "spoken_response",
    modality: "spoken",
    instruction: `Say a short response out loud, using "${chunk.text}" naturally.`,
  }),
  (chunk) => ({
    exerciseType: "mini_paragraph",
    modality: "written",
    instruction: `Write a short paragraph (2-3 sentences) that includes "${chunk.text}".`,
  }),
];

export function randomExerciseTemplate(chunk: LexicalChunk): ExerciseTemplate {
  const template = TEMPLATES[Math.floor(Math.random() * TEMPLATES.length)];
  return template(chunk);
}

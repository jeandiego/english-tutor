# Slice 06 — Corrections Without Breaking Conversation

## Objective

Turn the working voice chatbot into an English learning tool by presenting selective corrections separately from the spoken conversation.

## Core product rule

**Conversation first, coaching second.**

Do not interrupt spoken flow to explain minor errors.

The tutor's spoken `reply` should respond to meaning.

Corrections should appear visually after the turn.

## Correction policy

Update the tutor instruction so it returns corrections only when useful.

Prioritize:

- errors that affect clarity;
- repeated grammar mistakes;
- unnatural wording that matters at B2 -> C1;
- common collocation/preposition mistakes;
- mistakes that would matter in professional conversation.

Usually ignore:

- harmless slips;
- punctuation artifacts caused by STT;
- stylistic alternatives with no meaningful learning value.

Never claim to assess pronunciation from transcript text.

## UI

Create a secondary corrections area.

For each useful correction, show:

- what the user said
- a better version
- short reason
- category
- importance

Example:

```text
You said
"I've been working with React since five years."

Better
"I've been working with React for five years."

Use "for" with a duration.
```

Do not make the screen visually dominated by scores.

## Better expressions

Render optional `betterExpressions` separately.

These should favor natural spoken English, not formal thesaurus replacements.

Example:

```text
Instead of
"very difficult decision"

Try
"a tough call"
```

when appropriate to the context.

## Turn association

A correction must be associated with the exact user turn that caused it.

Do not lose that relationship when another turn starts.

## Tutor prompt quality

Add explicit protection against over-correction:

- maximum a small number of corrections per turn;
- focus on the highest-learning-value items;
- if the user's English is already natural, returning zero corrections is valid.

## Non-goals

Do not implement:

- phoneme analysis
- CEFR certification
- gamification
- daily streaks
- persistent analytics
- automated drills

## Acceptance criteria

1. Spoken conversation behavior from Slice 05 still works.
2. Correction cards appear separately.
3. Corrections are not spoken.
4. The tutor can return zero corrections.
5. Minor STT punctuation artifacts are not treated as grammar failures.
6. Corrections remain attached to their user turn.
7. The conversation is still comfortable for several consecutive turns.

## Manual tests

### Intentional mistake

Say:

`I work as software engineer since five years and I have much experience with React.`

The system should identify one or more high-value corrections without overwhelming the user.

### Natural sentence

Say:

`I've been working as a software engineer for several years, mostly with React and TypeScript.`

The system should be comfortable returning no correction.

## Stop condition

Once selective corrections improve the learning experience without making conversation annoying, stop.

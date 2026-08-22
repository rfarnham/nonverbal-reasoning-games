import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const pageSource = await readFile(
  new URL("../app/lab/subtraction-flash/page.tsx", import.meta.url),
  "utf8",
);
const stylesSource = await readFile(
  new URL(
    "../app/lab/subtraction-flash/subtraction-flash.module.css",
    import.meta.url,
  ),
  "utf8",
);

function sourceSection(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `missing source marker: ${startMarker}`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `missing source marker: ${endMarker}`);
  return source.slice(start, end);
}

test("the level selector renders the full engine curriculum as three compact tabs", () => {
  assert.match(pageSource, /SUBTRACTION_LEVELS\.map\(\(level\)\s*=>/);
  const levelSwitch = sourceSection(
    stylesSource,
    ".levelSwitch {",
    ".levelButton {",
  );
  assert.match(levelSwitch, /grid-template-columns:\s*repeat\(3,\s*1fr\)/);
  assert.match(
    stylesSource,
    /@media \(max-width: 620px\) \{[\s\S]*?\.levelSwitch\s*\{[\s\S]*?grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/,
  );
  assert.match(
    stylesSource,
    /@media \(max-width: 620px\) \{[\s\S]*?\.levelButton\s*\{[\s\S]*?min-width:\s*0/,
  );
});

test("B140 keeps Cards, Type, Draw, and Speak while honestly marking single-digit tools", () => {
  assert.match(
    pageSource,
    /function levelSupportsListening[\s\S]*return level === ["']B100["']/,
  );
  assert.match(
    pageSource,
    /function levelSupportsTrace[\s\S]*return level === ["']B100["']/,
  );
  assert.match(pageSource, /Listen · B100 only/);
  assert.match(pageSource, /Trace · B100 only/);

  const questionChoices = sourceSection(
    pageSource,
    "<legend>Question</legend>",
    "</fieldset>",
  );
  const cardsChoice = sourceSection(
    questionChoices,
    'aria-pressed={mode === "visual"}',
    "</button>",
  );
  assert.doesNotMatch(cardsChoice, /levelSupportsListening|levelSupportsTrace/);

  const answerChoices = sourceSection(
    pageSource,
    "<legend>Answer</legend>",
    "</fieldset>",
  );
  for (const mode of ["tap", "draw", "speak"]) {
    assert.match(answerChoices, new RegExp(`handleAnswerModeChange\\(\\"${mode}\\"\\)`));
  }
});

test("two-digit B140 answers use the natural answer slot in every supported input", () => {
  const liveAnswer = sourceSection(
    pageSource,
    "const liveAnswer = currentRound ? (",
    'if (sessionPhase === "playing" || sessionPhase === "settling")',
  );
  assert.match(
    liveAnswer,
    /<NumericAnswerInput[\s\S]*digitCount=\{SUBTRACTION_LEVEL_CONFIG\[activeLevel\]\.answerDigits\}/,
  );
  assert.match(
    liveAnswer,
    /<FlashHandwriting[\s\S]*digitCount=\{SUBTRACTION_LEVEL_CONFIG\[activeLevel\]\.answerDigits\}/,
  );
  assert.match(liveAnswer, /<SpeechAnswer/);

  const spokenAnswer = sourceSection(
    pageSource,
    "function SpeechAnswer(",
    "export default function SubtractionFlashPage",
  );
  assert.match(spokenAnswer, /Say the answer/);
  assert.doesNotMatch(spokenAnswer, /Say one digit|2–9/);
});

test("unsupported Listen sessions cannot reach a missing narration cue", () => {
  const beginSession = sourceSection(
    pageSource,
    "const beginSession = useCallback",
    "const handleModeChange = useCallback",
  );
  assert.match(
    beginSession,
    /!levelSupportsListening\(chosenLevel\)\s*&&\s*activeMode === ["']listen["']/,
  );
  const speakQuestion = sourceSection(
    pageSource,
    "const speakQuestion = useCallback",
    "const stopSpeaking = useCallback",
  );
  assert.match(
    speakQuestion,
    /const promptTranscript = `\$\{round\.draw\.card\.minuend\} minus \$\{round\.draw\.card\.subtrahend\}`/,
  );
});

test("horizontal cards keep an equals sign and vertical cards keep only the bar", () => {
  const problem = sourceSection(
    pageSource,
    "function ProblemWithAnswer(",
    "function newRound(",
  );
  const horizontal = sourceSection(
    problem,
    "card.orientation === \"horizontal\" ? (",
    ") : (",
  );
  const vertical = sourceSection(problem, ") : (", "</div>\n  );");
  assert.match(horizontal, /className=\{styles\.liveEquals\}[\s\S]*>/);
  assert.match(horizontal, />=</);
  assert.match(vertical, /className=\{styles\.liveVerticalRule\}/);
  assert.doesNotMatch(vertical, /liveEquals|>=</);
});

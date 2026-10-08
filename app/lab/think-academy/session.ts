import { CONTENT_VERSION, generateRound } from './engine.ts';
import { PROBLEM_TYPES, type ChallengeLevel, type ProblemType, type Round } from './types.ts';

export type Mode = 'test' | 'practice';
export interface QuestionRef { type: ProblemType; level: ChallengeLevel; seed: number; fingerprint: string }
export interface FirstAnswer { choiceId: string; correct: boolean }
export interface Session {
  version: number;
  mode: Mode;
  type: ProblemType;
  level: ChallengeLevel;
  seed: number;
  questions: QuestionRef[];
  firstAnswers: (FirstAnswer | null)[];
  completed: boolean[];
  redeemed: boolean[];
  index: number;
  stage: 'play' | 'checkpoint' | 'review' | 'results';
  reviewQueue: number[];
  reviewCursor: number;
  feedback: 'idle' | 'wrong' | 'correct';
  selected: string | null;
}
function nextSeed(seed: number) { return (Math.imul(seed, 1664525) + 1013904223) >>> 0; }
export function createSession(mode: Mode, type: ProblemType, level: ChallengeLevel, seed: number): Session {
  if (!['test', 'practice'].includes(mode) || !PROBLEM_TYPES.includes(type) || !Number.isInteger(level) || level < 0 || level > 3 || !Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) throw new Error('Choose valid settings to begin.');
  let state = seed;
  const types = mode === 'test' ? [...PROBLEM_TYPES] : Array<ProblemType>(12).fill(type);
  // A mixed test covers every source panel exactly once, in a seeded order.
  if (mode === 'test') for (let i = types.length - 1; i > 0; i--) { state = nextSeed(state); const j = state % (i + 1); [types[i], types[j]] = [types[j], types[i]]; }
  const seen = new Set<string>();
  const questions: QuestionRef[] = types.map(questionType => {
    for (let attempt = 0; attempt < 160; attempt++) {
      state = nextSeed(state);
      const round = generateRound(questionType, level, state);
      if (seen.has(round.fingerprint)) continue;
      seen.add(round.fingerprint);
      return { type: questionType, level, seed: state, fingerprint: round.fingerprint };
    }
    throw new Error('This question pool needs a fresh start. Try a new set.');
  });
  return { version: CONTENT_VERSION, mode, type, level, seed, questions, firstAnswers: questions.map(() => null), completed: questions.map(() => false), redeemed: questions.map(() => false), index: 0, stage: 'play', reviewQueue: [], reviewCursor: 0, feedback: 'idle', selected: null };
}
export function activeIndex(session: Session): number { return session.stage === 'review' ? session.reviewQueue[session.reviewCursor] : session.index; }
export function restoreRound(ref: QuestionRef): Round {
  const round = generateRound(ref.type, ref.level, ref.seed);
  if (round.fingerprint !== ref.fingerprint) throw new Error('This saved question has changed. Start a new set.');
  return round;
}
export function activeRound(session: Session): Round { return restoreRound(session.questions[activeIndex(session)]); }
export function submitAnswer(session: Session, choiceId: string): Session {
  if (!['play', 'review'].includes(session.stage) || session.feedback !== 'idle') return session;
  const round = activeRound(session);
  if (!round.choices.some(choice => choice.id === choiceId)) return session;
  const correct = choiceId === round.correctId;
  const index = activeIndex(session);
  const firstAnswers = [...session.firstAnswers];
  const completed = [...session.completed];
  const redeemed = [...session.redeemed];
  if (session.stage === 'play' && !firstAnswers[index]) firstAnswers[index] = { choiceId, correct };
  if (correct && session.stage === 'play') completed[index] = true;
  if (correct && session.stage === 'review') redeemed[index] = true;
  return { ...session, firstAnswers, completed, redeemed, selected: choiceId, feedback: correct ? 'correct' : 'wrong' };
}
export function retryQuestion(session: Session): Session {
  return session.feedback === 'wrong' ? { ...session, feedback: 'idle' } : session;
}
export function nextQuestion(session: Session): Session {
  if (session.feedback !== 'correct' || !['play', 'review'].includes(session.stage)) return session;
  const reset = { ...session, feedback: 'idle' as const, selected: null };
  if (session.stage === 'review') return session.reviewCursor + 1 < session.reviewQueue.length ? { ...reset, reviewCursor: session.reviewCursor + 1 } : { ...reset, stage: 'checkpoint', reviewQueue: [], reviewCursor: 0 };
  return session.index + 1 < session.questions.length ? { ...reset, index: session.index + 1 } : { ...reset, stage: 'checkpoint' };
}
export function outstandingMistakes(session: Session): number[] {
  return session.firstAnswers.flatMap((answer, i) => answer && !answer.correct && !session.redeemed[i] ? [i] : []);
}
export function startReview(session: Session): Session {
  if (!['checkpoint', 'results'].includes(session.stage)) return session;
  const reviewQueue = outstandingMistakes(session);
  return reviewQueue.length ? { ...session, stage: 'review', reviewQueue, reviewCursor: 0, feedback: 'idle', selected: null } : session;
}
export function finishSession(session: Session): Session {
  return session.stage === 'checkpoint' && !outstandingMistakes(session).length ? { ...session, stage: 'results' } : session;
}
export function sessionStats(session: Session) {
  const answered = session.firstAnswers.filter(Boolean).length;
  const correct = session.firstAnswers.filter(answer => answer?.correct).length;
  return { answered, correct, percent: answered ? Math.round(correct / answered * 100) : 0, solved: session.completed.filter(Boolean).length };
}

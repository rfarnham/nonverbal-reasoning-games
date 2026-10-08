import { CONTENT_VERSION } from './engine.ts';
import { PROBLEM_TYPES } from './types.ts';
import { activeIndex, restoreRound, type Session } from './session.ts';

export const SESSION_KEY = 'spatial-gym-think-academy-v1';
type StoragePort = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
export function isValidSession(value: unknown): value is Session {
  try {
    const s = value as Session;
    if (!s || s.version !== CONTENT_VERSION || !['test', 'practice'].includes(s.mode) || !PROBLEM_TYPES.includes(s.type) || !Number.isInteger(s.level) || s.level < 0 || s.level > 3 || !Number.isInteger(s.seed) || s.seed < 0 || s.seed > 0xffffffff) return false;
    const count = s.mode === 'test' ? 15 : 12;
    if (!Array.isArray(s.questions) || s.questions.length !== count || !Array.isArray(s.firstAnswers) || s.firstAnswers.length !== count || !Array.isArray(s.completed) || s.completed.length !== count || !Array.isArray(s.redeemed) || s.redeemed.length !== count) return false;
    if (!s.completed.every(v => typeof v === 'boolean') || !s.redeemed.every(v => typeof v === 'boolean')) return false;
    if (!['play', 'checkpoint', 'review', 'results'].includes(s.stage) || !['idle', 'wrong', 'correct'].includes(s.feedback) || !Number.isInteger(s.index) || s.index < 0 || s.index >= count || !Array.isArray(s.reviewQueue) || !Number.isInteger(s.reviewCursor) || s.reviewCursor < 0) return false;
    if (s.mode === 'test' && new Set(s.questions.map(q => q.type)).size !== 15) return false;
    if (new Set(s.questions.map(q => q.fingerprint)).size !== count) return false;
    const rounds = s.questions.map(ref => { if (ref.level !== s.level || (s.mode === 'practice' && ref.type !== s.type)) throw new Error(); return restoreRound(ref); });
    for (let i = 0; i < count; i++) {
      const answer = s.firstAnswers[i];
      if (answer !== null && (!answer || !rounds[i].choices.some(c => c.id === answer.choiceId) || answer.correct !== (answer.choiceId === rounds[i].correctId))) return false;
      if ((s.completed[i] || s.redeemed[i]) && answer === null) return false;
      if (answer?.correct && !s.completed[i]) return false;
      if (s.redeemed[i] && (!s.completed[i] || answer?.correct)) return false;
      if (s.stage === 'play' && ((i < s.index && !s.completed[i]) || (i > s.index && (s.completed[i] || answer !== null)))) return false;
    }
    if (s.stage !== 'play' && !s.completed.every(Boolean)) return false;
    if (s.stage === 'results' && s.firstAnswers.some((a, i) => a && !a.correct && !s.redeemed[i])) return false;
    if (new Set(s.reviewQueue).size !== s.reviewQueue.length || s.reviewQueue.some(i => !Number.isInteger(i) || i < 0 || i >= count || s.firstAnswers[i]?.correct !== false)) return false;
    if (s.stage === 'review' ? !s.reviewQueue.length || s.reviewCursor >= s.reviewQueue.length : s.reviewQueue.length !== 0 || s.reviewCursor !== 0) return false;
    const current = activeIndex(s);
    const round = rounds[current];
    if ((s.feedback !== 'idle' || s.selected !== null) && !s.firstAnswers[current]) return false;
    if (s.stage === 'play' && s.redeemed.some(Boolean)) return false;
    if (s.stage === 'review' && (s.redeemed[current] !== (s.feedback === 'correct') || s.reviewQueue.slice(0, s.reviewCursor).some(i => !s.redeemed[i]) || s.reviewQueue.slice(s.reviewCursor + 1).some(i => s.redeemed[i]))) return false;
    if (s.selected !== null && !round.choices.some(c => c.id === s.selected)) return false;
    if (s.feedback !== 'idle' && (s.selected === null || (s.feedback === 'correct') !== (s.selected === round.correctId))) return false;
    if (s.stage === 'play' && s.completed[s.index] !== (s.feedback === 'correct')) return false;
    if (['checkpoint', 'results'].includes(s.stage) && (s.feedback !== 'idle' || s.selected !== null)) return false;
    return true;
  } catch { return false; }
}
export function readSession(storage: StoragePort): { session: Session | null; notice: string } {
  try {
    const saved = storage.getItem(SESSION_KEY);
    if (!saved) return { session: null, notice: '' };
    const value: unknown = JSON.parse(saved);
    return isValidSession(value) ? { session: value, notice: '' } : { session: null, notice: 'The saved set could not be restored. You can start a fresh one.' };
  } catch { return { session: null, notice: 'Saved progress is unavailable. You can still play here.' }; }
}
export function writeSession(storage: StoragePort, session: Session): boolean {
  try { storage.setItem(SESSION_KEY, JSON.stringify(session)); return true; } catch { return false; }
}

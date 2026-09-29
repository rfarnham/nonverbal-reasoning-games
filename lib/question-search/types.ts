export interface QuestionSource {
  label: string; year: number; grade: string; question: number; language: string;
}

export interface SearchQuestion {
  id: string;
  version: string;
  prompt: string;
  originalPrompt: string;
  options: string[];
  originalOptions?: string[];
  answer: string | null;
  answerStatus: string;
  source: QuestionSource;
  image: { path: string; mime: string; width: number; height: number; hash: string; dhash: string };
  topics: string[];
  strategies: string[];
  description: string;
  structure: string;
  method: string;
  annotationStatus: string;
  evidence: string[];
  family: string;
}

export interface SearchCorpus {
  schemaVersion: 1;
  version: string;
  createdAt: string;
  questions: SearchQuestion[];
  facets: { topics: Record<string, string>; strategies: Record<string, string> };
  stats: Record<string, number>;
  semantic?: {
    dimensions: number;
    vocabulary: string[];
    idf: number[];
    components: number[][];
    vectors: number[][];
  };
}

export interface SearchManifest {
  schemaVersion: 1;
  version: string;
  count: number;
  index: { path: string; sha256: string; bytes: number };
  encryption: { name: "AES-GCM"; kdf: "PBKDF2"; hash: "SHA-256"; iterations: number; salt: string };
}

export interface SearchQuery {
  text: string;
  topics?: string[];
  strategies?: string[];
  grade?: string;
  source?: string;
  mode?: "hybrid" | "text" | "strategy" | "visual";
  excludeIds?: string[];
  excludeFamily?: string;
  imageHash?: string;
  dhash?: string;
  limit?: number;
  offset?: number;
}

export interface SearchHit {
  question: SearchQuestion;
  score: number;
  reasons: string[];
  signals: { text: number; structure: number; strategy: number; visual: number };
  ai?: { relationship: MatchRelationship; reason: string };
}

export interface SearchResponse { hits: SearchHit[]; total: number; query: SearchQuery }

export type MatchRelationship = "same_method" | "adaptation" | "related_skill" | "surface_only" | "unrelated" | "uncertain";
export interface SearchJudgment {
  queryId: string;
  candidateId: string;
  queryVersion: string;
  candidateVersion: string;
  relationship: MatchRelationship;
  grade: number | null;
  reason: string;
  reviewer: string;
  createdAt: string;
}

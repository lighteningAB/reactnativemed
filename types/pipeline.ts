export interface Demographics {
  age?: number;
  sex?: string;
}

export interface Symptom {
  name: string;
  onset?: string;
  duration?: string;
  character?: string;
  location?: string;
  severity?: string;
  worse_with?: string;
  relieved_by?: string;
}

export interface PatientData {
  demographics?: Demographics;
  symptoms: Symptom[];
  past_medical_history: string[];
  medications: string[];
  red_flags: string[];
  free_text_summary?: string;
}

export interface SnomedCandidate {
  id: string;
  term: string;
  score: number;
}

export interface DiagnosisCandidate {
  phrase: string;
  candidates: SnomedCandidate[];
}

export interface FinalDiagnosis {
  phrase: string;
  chosen_snomed_ids: string[];
  confidence: number;
  explanation: string;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}


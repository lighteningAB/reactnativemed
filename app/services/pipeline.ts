import { Platform } from 'react-native';
import { PatientData, DiagnosisCandidate, FinalDiagnosis, ChatMessage } from '../types/pipeline';

// Use 10.0.2.2 for Android Emulator, localhost for iOS/Web
const API_URL = Platform.OS === 'android' 
  ? 'http://10.0.2.2:8000' 
  : 'http://localhost:8000';

export const PipelineService = {
  async chatExtract(message: string, history: ChatMessage[]): Promise<PatientData> {
    const response = await fetch(`${API_URL}/chat/extract`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, history }),
    });
    if (!response.ok) throw new Error('Failed to extract data');
    return response.json();
  },

  async proposeDiagnoses(data: PatientData): Promise<string[]> {
    const response = await fetch(`${API_URL}/diagnose/propose`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!response.ok) throw new Error('Failed to propose diagnoses');
    return response.json();
  },

  async mapSnomed(phrases: string[]): Promise<DiagnosisCandidate[]> {
    const response = await fetch(`${API_URL}/snomed/map`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(phrases),
    });
    if (!response.ok) throw new Error('Failed to map SNOMED');
    return response.json();
  },

  async explainDiagnosis(patientData: PatientData, candidates: DiagnosisCandidate[]): Promise<FinalDiagnosis[]> {
    const response = await fetch(`${API_URL}/diagnose/explain`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ patient_data: patientData, candidates }),
    });
    if (!response.ok) throw new Error('Failed to explain diagnosis');
    return response.json();
  }
};


import React, { useState } from 'react';
import { StyleSheet, TextInput, ScrollView, TouchableOpacity, ActivityIndicator, Alert } from 'react-native';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { SafeAreaView } from 'react-native-safe-area-context';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { useClinicalPipeline } from '@/hooks/useClinicalPipeline';
import { ChatMessage, FinalDiagnosis, PatientData } from '@/types/pipeline';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

export default function ChatScreen() {
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [patientData, setPatientData] = useState<PatientData | null>(null);
  const [diagnoses, setDiagnoses] = useState<FinalDiagnosis[]>([]);
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme ?? 'light'];
  
  // Use the new on-device pipeline hook
  const { cactusLM, loading, chatExtract, proposeDiagnoses, explainAndMap } = useClinicalPipeline();

  const sendMessage = async () => {
    if (!input.trim()) return;

    const userMsg: ChatMessage = { role: 'user', content: input };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput('');
    
    // In a real chat, we might want the LLM to reply conversationally too.
    // For this pipeline, we just collect messages.
    // We could use cactusLM.complete here for conversational response if desired.
  };

  const runPipeline = async () => {
    if (messages.length === 0) {
      Alert.alert('Empty Chat', 'Please chat with the patient first.');
      return;
    }

    try {
      // Step 1: Extract Data (On-Device)
      const data = await chatExtract(messages);
      if (!data) {
        Alert.alert('Extraction Failed', 'Could not extract patient data.');
        return;
      }
      setPatientData(data);

      // Step 2: Propose Diagnoses (On-Device)
      const candidates = await proposeDiagnoses(data);
      
      // Step 3: Map & Explain (On-Device)
      const final = await explainAndMap(data, candidates);
      setDiagnoses(final);

    } catch (error) {
      console.error(error);
      Alert.alert('Pipeline Error', 'Failed to run clinical pipeline.');
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <ThemedView style={styles.header}>
        <ThemedText type="title">Clinical Assistant</ThemedText>
      </ThemedView>

      <ScrollView style={styles.chatContainer}>
        {messages.map((msg, idx) => (
          <ThemedView 
            key={idx} 
            style={[
              styles.messageBubble, 
              msg.role === 'user' ? styles.userBubble : styles.aiBubble
            ]}
          >
            <ThemedText style={msg.role === 'user' ? styles.userText : styles.aiText}>
              {msg.content}
            </ThemedText>
          </ThemedView>
        ))}
        
        {patientData && (
          <ThemedView style={styles.resultCard}>
            <ThemedText type="subtitle">Extracted Data</ThemedText>
            <ThemedText>{patientData.free_text_summary}</ThemedText>
            {patientData.symptoms && patientData.symptoms.length > 0 && patientData.symptoms.map((s, i) => (
              <ThemedText key={i}>• {s.name} ({s.location})</ThemedText>
            ))}
          </ThemedView>
        )}

        {diagnoses && diagnoses.length > 0 && (
          <ThemedView style={styles.resultCard}>
             <ThemedText type="subtitle">Differential Diagnosis</ThemedText>
             {diagnoses.map((d, i) => (
               <ThemedView key={i} style={styles.diagnosisItem}>
                 <ThemedText type="defaultSemiBold">{d.phrase} ({Math.round(d.confidence * 100)}%)</ThemedText>
                 <ThemedText style={styles.explanation}>{d.explanation}</ThemedText>
                 <ThemedText style={styles.snomed}>SNOMED: {d.chosen_snomed_ids.join(', ')}</ThemedText>
               </ThemedView>
             ))}
          </ThemedView>
        )}
      </ScrollView>

      <ThemedView style={styles.inputContainer}>
        <TextInput
          style={[styles.input, { color: theme.text, borderColor: theme.icon }]}
          value={input}
          onChangeText={setInput}
          placeholder="Type patient symptoms..."
          placeholderTextColor="#888"
        />
        <TouchableOpacity onPress={sendMessage} style={styles.sendButton}>
          <IconSymbol name="arrow.up.circle.fill" size={32} color={theme.tint} />
        </TouchableOpacity>
      </ThemedView>

      <TouchableOpacity 
        style={[styles.analyzeButton, { backgroundColor: theme.tint }]} 
        onPress={runPipeline}
        disabled={loading}
      >
        {loading ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <ThemedText style={styles.analyzeText}>Analyze & Diagnose</ThemedText>
        )}
      </TouchableOpacity>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#ccc',
  },
  chatContainer: {
    flex: 1,
    padding: 16,
  },
  messageBubble: {
    padding: 12,
    borderRadius: 16,
    marginBottom: 8,
    maxWidth: '80%',
  },
  userBubble: {
    alignSelf: 'flex-end',
    backgroundColor: '#007AFF',
  },
  aiBubble: {
    alignSelf: 'flex-start',
    backgroundColor: '#E5E5EA',
  },
  userText: {
    color: '#fff',
  },
  aiText: {
    color: '#000',
  },
  inputContainer: {
    flexDirection: 'row',
    padding: 16,
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: '#ccc',
  },
  input: {
    flex: 1,
    height: 40,
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: 16,
    marginRight: 8,
  },
  sendButton: {
    padding: 4,
  },
  analyzeButton: {
    margin: 16,
    padding: 16,
    borderRadius: 8,
    alignItems: 'center',
  },
  analyzeText: {
    color: '#fff',
    fontWeight: 'bold',
  },
  resultCard: {
    marginTop: 16,
    padding: 16,
    borderRadius: 8,
    backgroundColor: '#f0f0f0', 
    // Note: In a real app, handle dark mode for this background too
  },
  diagnosisItem: {
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#ddd',
  },
  explanation: {
    fontSize: 14,
    color: '#555',
    marginVertical: 4,
  },
  snomed: {
    fontSize: 12,
    color: '#888',
  }
});


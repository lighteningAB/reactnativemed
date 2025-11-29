;
import { useCactusLM } from 'cactus-react-native';
import React from 'react';
import { Button, StyleSheet, Text } from 'react-native';

export default function HomeScreen() {
  const cactusLM = useCactusLM();
  React.useEffect(() => {
    // Download the model if not already available
    if (!cactusLM.isDownloaded) {
      cactusLM.download();
    }
  }, [cactusLM]);

  const handleGenerate = () => {
    // Generate a completion
    cactusLM.complete({
      messages: [{ role: 'user', content: 'Hello!' }],
    });
  };

  if (cactusLM.isDownloading) {
    return (
      <Text>
        Downloading model: {Math.round(cactusLM.downloadProgress * 100)}%
      </Text>
    );
  }

  return (
    <>
      <Button onPress={handleGenerate} title="Generate" />
      <Text>{cactusLM.completion}</Text>
    </>
  );
}

const styles = StyleSheet.create({
  titleContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  stepContainer: {
    gap: 8,
    marginBottom: 8,
  },
  reactLogo: {
    height: 178,
    width: 290,
    bottom: 0,
    left: 0,
    position: 'absolute',
  },
});

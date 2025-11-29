import { Button, Text } from '@react-navigation/elements';
import { useCactusLM } from 'cactus-react-native';
import { useEffect } from 'react';

const App = () => {
  const cactusLM = useCactusLM();

  useEffect(() => {
    // Download the model if not already available
    if (!cactusLM.isDownloaded) {
      cactusLM.download();
    }
  }, []);

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
      <Button onPress={handleGenerate} >
        Generate
      </Button>
      <Text>{cactusLM.completion}</Text>
    </>
  );
};

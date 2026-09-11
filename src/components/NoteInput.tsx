import { MaterialCommunityIcons } from '@expo/vector-icons';
import {
  ExpoSpeechRecognitionModule,
  useSpeechRecognitionEvent,
} from 'expo-speech-recognition';
import { useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Alert,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { type Theme } from '../theme';

export function NoteInput({
  value,
  onChangeText,
  theme,
}: {
  value: string;
  onChangeText: (value: string) => void;
  theme: Theme;
}) {
  const [listening, setListening] = useState(false);
  const baseNote = useRef('');
  const listeningRef = useRef(false);

  useSpeechRecognitionEvent('start', () => {
    listeningRef.current = true;
    setListening(true);
    AccessibilityInfo.announceForAccessibility('Listening for note');
  });
  useSpeechRecognitionEvent('end', () => {
    listeningRef.current = false;
    setListening(false);
  });
  useSpeechRecognitionEvent('result', (event) => {
    const transcript = event.results[0]?.transcript.trim();
    if (!transcript) return;
    onChangeText([baseNote.current, transcript].filter(Boolean).join(' ').slice(0, 300));
  });
  useSpeechRecognitionEvent('error', (event) => {
    listeningRef.current = false;
    setListening(false);
    if (event.error === 'aborted') return;
    Alert.alert(
      'Couldn’t transcribe that',
      event.error === 'not-allowed'
        ? 'Microphone or speech access is off. You can enable it in Settings, or type the note instead.'
        : 'Try the microphone again, or type the note instead.',
    );
  });

  useEffect(() => () => {
    if (listeningRef.current) ExpoSpeechRecognitionModule.abort();
  }, []);

  const toggleListening = async () => {
    try {
      if (listening) {
        ExpoSpeechRecognitionModule.stop();
        return;
      }
      if (!ExpoSpeechRecognitionModule.isRecognitionAvailable()) {
        Alert.alert('Voice notes unavailable', 'Speech recognition is not available on this phone. You can still type the note.');
        return;
      }
      const permission = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
      if (!permission.granted) {
        Alert.alert('Microphone access needed', 'Allow microphone and speech access to dictate notes. You can still type the note.');
        return;
      }
      baseNote.current = value.trim();
      ExpoSpeechRecognitionModule.start({
        lang: Intl.DateTimeFormat().resolvedOptions().locale || 'en-US',
        interimResults: true,
        continuous: false,
        addsPunctuation: true,
        contextualStrings: ['pee', 'poop', 'potty', 'walk', 'meal', 'nap', 'play session', 'training', 'crate'],
      });
    } catch {
      Alert.alert('Voice notes unavailable', 'The speech recognizer could not start. You can still type the note.');
    }
  };

  return (
    <View>
      <View
        style={[
          styles.inputShell,
          {
            backgroundColor: theme.surface,
            borderColor: listening ? theme.danger : theme.border,
          },
        ]}
      >
        <TextInput
          accessibilityLabel="Note for this log"
          autoCapitalize="sentences"
          maxLength={300}
          multiline
          onChangeText={onChangeText}
          placeholder="e.g. Just after a play session"
          placeholderTextColor={theme.textMuted}
          textAlignVertical="top"
          value={value}
          style={[styles.input, { color: theme.text }]}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={listening ? 'Stop dictating note' : 'Dictate note'}
          accessibilityState={{ selected: listening }}
          onPress={toggleListening}
          style={({ pressed }) => [
            styles.micButton,
            {
              backgroundColor: listening ? theme.danger : pressed ? theme.primarySoft : theme.surfaceRaised,
              borderColor: listening ? theme.danger : theme.border,
            },
          ]}
        >
          <MaterialCommunityIcons
            name={listening ? 'stop' : 'microphone-outline'}
            color={listening ? '#FFFFFF' : theme.primary}
            size={23}
          />
        </Pressable>
      </View>
      <View style={styles.noteMeta}>
        <Text style={[styles.hint, { color: listening ? theme.danger : theme.textMuted }]}>
          {listening ? 'Listening… Tap stop when you’re done.' : 'Type a note or tap the microphone to dictate.'}
        </Text>
        <Text style={[styles.count, { color: theme.textMuted }]}>{value.length}/300</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  inputShell: {
    minHeight: 106,
    borderWidth: 1,
    borderRadius: 18,
    paddingLeft: 14,
    paddingTop: 12,
    paddingBottom: 10,
    paddingRight: 8,
    flexDirection: 'row',
    alignItems: 'flex-end',
  },
  input: { flex: 1, minHeight: 82, maxHeight: 132, padding: 0, fontSize: 16, lineHeight: 23 },
  micButton: {
    width: 48,
    height: 48,
    borderRadius: 16,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 8,
  },
  noteMeta: { flexDirection: 'row', gap: 8, marginTop: 6 },
  hint: { flex: 1, fontSize: 12, lineHeight: 17 },
  count: { fontSize: 11, lineHeight: 17, fontVariant: ['tabular-nums'] },
});

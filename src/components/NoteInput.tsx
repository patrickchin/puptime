import { MaterialCommunityIcons } from '@expo/vector-icons';
import {
  ExpoSpeechRecognitionModule,
  useSpeechRecognitionEvent,
} from 'expo-speech-recognition';
import { useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Alert,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Pressable } from './TelemetryPressable';

import { useLocalization } from '../localization-context';
import { type Theme } from '../theme';

type DictationPhase = 'idle' | 'permission' | 'starting' | 'listening' | 'finishing' | 'cancelling';

export function NoteInput({
  autoFocus = false,
  active = true,
  value,
  onChangeText,
  onBlur,
  theme,
}: {
  autoFocus?: boolean;
  active?: boolean;
  value: string;
  onChangeText: (value: string) => void;
  onBlur?: () => void;
  theme: Theme;
}) {
  const { locale, t } = useLocalization();
  const [phase, setPhaseState] = useState<DictationPhase>('idle');
  const phaseRef = useRef<DictationPhase>('idle');
  const setPhase = (next: DictationPhase) => { phaseRef.current = next; setPhaseState(next); };
  const listening = phase === 'starting' || phase === 'listening' || phase === 'finishing';
  const baseNote = useRef('');
  const valueRef = useRef(value);valueRef.current = value;
  const activeRef = useRef(active),permissionRequest = useRef(0);
  activeRef.current = active;

  useSpeechRecognitionEvent('start', () => {
    if(!activeRef.current || phaseRef.current !== 'starting'){ExpoSpeechRecognitionModule.abort();return;}
    setPhase('listening');
    AccessibilityInfo.announceForAccessibility(t('note.listeningAnnouncement'));
  });
  useSpeechRecognitionEvent('end', () => {
    setPhase('idle');
  });
  useSpeechRecognitionEvent('result', (event) => {
    if(!activeRef.current || !['starting','listening','finishing'].includes(phaseRef.current))return;
    const transcript = event.results[0]?.transcript.trim();
    if (!transcript) return;
    onChangeText([baseNote.current, transcript].filter(Boolean).join(' ').slice(0, 300));
  });
  useSpeechRecognitionEvent('error', (event) => {
    const cancelled = phaseRef.current === 'cancelling';
    // Native errors may be followed by `end`. Wait for that terminal event
    // before allowing another recognizer session to consume the old results.
    setPhase('cancelling');
    if (cancelled || event.error === 'aborted'||!activeRef.current) return;
    Alert.alert(
      t('note.transcribeErrorTitle'),
      event.error === 'not-allowed'
        ? t('note.accessOff')
        : t('note.tryAgain'),
    );
  });

  const cancelDictation = () => {
    permissionRequest.current++;
    if (phaseRef.current === 'permission') setPhase('idle');
    else if (phaseRef.current !== 'idle' && phaseRef.current !== 'cancelling') {
      setPhase('cancelling');
      ExpoSpeechRecognitionModule.abort();
    }
  };
  useEffect(()=>{if(!active)cancelDictation();},[active]);

  useEffect(() => {
    activeRef.current=active;
    return()=>{activeRef.current=false;permissionRequest.current++;ExpoSpeechRecognitionModule.abort();};
  }, []);

  const toggleListening = async () => {
    if(!activeRef.current)return;
    let request=permissionRequest.current;
    try {
      if (phaseRef.current === 'listening') {
        setPhase('finishing');
        ExpoSpeechRecognitionModule.stop();
        return;
      }
      if (phaseRef.current !== 'idle') return;
      request=++permissionRequest.current;
      if (!ExpoSpeechRecognitionModule.isRecognitionAvailable()) {
        Alert.alert(t('note.unavailableTitle'), t('note.unavailableBody'));
        return;
      }
      setPhase('permission');
      const permission = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
      if(!activeRef.current||request!==permissionRequest.current)return;
      if (!permission.granted) {
        setPhase('idle');
        Alert.alert(t('note.permissionTitle'), t('note.permissionBody'));
        return;
      }
      baseNote.current = valueRef.current.trim();
      setPhase('starting');
      ExpoSpeechRecognitionModule.start({
        lang: locale,
        interimResults: true,
        continuous: false,
        addsPunctuation: true,
        contextualStrings: ['pee', 'poop', 'potty', 'walk', 'meal', 'nap', 'play session', 'training', 'crate'],
      });
    } catch {
      if(!activeRef.current||request!==permissionRequest.current)return;
      setPhase('idle');
      Alert.alert(t('note.unavailableTitle'), t('note.startError'));
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
            borderRadius: theme.presentation.cardRadius,
            borderWidth: theme.presentation.borderWidth,
          },
        ]}
      >
        <TextInput
          testID="editor.note.input"
          accessibilityLabel={t('note.label')}
          autoFocus={autoFocus}
          editable={active}
          autoCapitalize="sentences"
          maxLength={300}
          multiline
          onBlur={onBlur}
          onChangeText={(next) => { cancelDictation(); onChangeText(next); }}
          placeholder={t('note.placeholder')}
          placeholderTextColor={theme.textMuted}
          textAlignVertical="top"
          value={value}
          style={[styles.input, { color: theme.text }]}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={listening ? t('note.stopDictating') : t('note.dictate')}
          accessibilityState={{ selected: listening }}
          disabled={!active || ['permission','starting','finishing','cancelling'].includes(phase)}
          onPress={toggleListening}
          style={({ pressed }) => [
            styles.micButton,
            {
              backgroundColor: listening ? theme.danger : pressed ? theme.primarySoft : theme.surfaceRaised,
              borderColor: listening ? theme.danger : theme.border,
              borderRadius: theme.presentation.controlRadius,
              borderWidth: theme.presentation.borderWidth,
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
        {listening ? (
          <Text style={[styles.hint, { color: theme.danger }]}>{t('note.listeningHint')}</Text>
        ) : null}
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
  count: { marginLeft: 'auto', fontSize: 11, lineHeight: 17, fontVariant: ['tabular-nums'] },
});

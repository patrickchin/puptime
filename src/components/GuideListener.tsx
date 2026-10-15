import { setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { useEffect, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { audioSeek, audioTime, guideSourceText } from '../guide-audio';
import { guideRecordings, type GuideRecording } from '../guide-recordings';
import { useLocalization } from '../localization-context';
import type { CareArticle } from '../puppy-care';
import type { Theme } from '../theme';

function RecordingPlayer({ article, recording, theme }: { article: CareArticle; recording: GuideRecording; theme: Theme }) {
  const { t } = useLocalization();
  const player = useAudioPlayer(recording.source, { updateInterval: 500 });
  const status = useAudioPlayerStatus(player);
  const [failed, setFailed] = useState(false);
  const [rate, setRate] = useState(1);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const previousVolume = useRef(1);
  const [scrub, setScrub] = useState<number | null>(null);
  const duration = status.duration || recording.duration;
  const mediaError = (status as typeof status & { error?: string }).error;
  const error = failed || !!mediaError;
  const loading = !error && (!status.isLoaded || status.isBuffering);
  const title = `${article.shortTitle}${recording.attribution ? ' · elevenlabs.io' : ''}`;
  const narrator = recording.voice.split(' - ')[0];

  useEffect(() => {
    if (error) player.pause();
  }, [error, player]);

  useEffect(() => {
    if (!loading) return;
    const timer = setTimeout(() => setFailed(true), 20_000);
    return () => clearTimeout(timer);
  }, [loading]);

  const seekTo = async (seconds: number) => {
    try { await player.seekTo(audioSeek(seconds, 0, duration)); } catch { setFailed(true); }
  };
  const seek = (delta: number) => seekTo(player.currentTime + delta);
  const play = async () => {
    try {
      if (error) {
        setFailed(false);
        player.replace(recording.source);
        if (volume !== 1) player.volume = volume;
        player.muted = muted;
        player.setPlaybackRate(1);
        setRate(1);
        return;
      }
      if (status.playing) { player.pause(); return; }
      if (Platform.OS !== 'web') {
        await setAudioModeAsync({ playsInSilentMode: true, shouldPlayInBackground: true, interruptionMode: 'doNotMix' });
      }
      if (status.didJustFinish || player.currentTime >= duration - 0.1) await player.seekTo(0);
      player.setActiveForLockScreen(true, { title, artist: `Puptime · ${narrator} · ElevenLabs`, albumTitle: 'Puppy care guides' }, { showSeekBackward: true, showSeekForward: true });
      player.play();
    } catch { setFailed(true); }
  };
  const label = error ? t('learn.audioRetry') : loading ? t('learn.audioLoading') : status.playing ? t('learn.audioPause') : t('learn.audioPlay');
  const disabled = loading || error;
  if (Platform.OS === 'web') {
    const changeVolume = (value: number) => {
      if (value > 0) previousVolume.current = value;
      player.volume = value;
      setVolume(value);
      player.muted = false;
      setMuted(false);
    };
    const silent = muted || volume === 0;
    return <section className="puptime-listener" data-testid="learn.audio" aria-label={t('learn.audioTitle')} style={{ background: theme.surface, borderColor: theme.border, color: theme.text, '--audio-accent': theme.primary } as React.CSSProperties}>
      <style>{webPlayerStyles}</style>
      <div className="puptime-listener-inner">
        <button className="puptime-listener-play" data-testid="learn.audio.play" aria-label={label} title={label} disabled={loading} aria-busy={loading} onClick={() => void play()} style={{ background: theme.primary, color: theme.onPrimary }}>
          <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="currentColor">{status.playing ? <path d="M6 4h4v16H6zm8 0h4v16h-4z" /> : <path d="m7 3 15 9-15 9z" />}</svg>
        </button>
        <div className="puptime-listener-copy">
          <div className="puptime-listener-title" title={title}>{title}</div>
          <div className="puptime-listener-credit" style={{ color: theme.textMuted }}>{loading ? t('learn.audioLoading') : t('learn.audioCredit', { voice: narrator })}</div>
        </div>
        <button className="puptime-listener-skip puptime-listener-back" data-testid="learn.audio.back" aria-label={t('learn.audioBack')} title={t('learn.audioBack')} disabled={disabled} onClick={() => void seek(-15)}>−15</button>
        <button className="puptime-listener-skip puptime-listener-forward" data-testid="learn.audio.forward" aria-label={t('learn.audioForward')} title={t('learn.audioForward')} disabled={disabled} onClick={() => void seek(15)}>+15</button>
        <input className="puptime-listener-progress" data-testid="learn.audio.seek" type="range" min="0" max={duration} step="0.1" value={scrub ?? status.currentTime} disabled={disabled} aria-label={t('learn.audioProgress')} aria-valuetext={`${audioTime(scrub ?? status.currentTime)} / ${audioTime(duration)}`} onChange={(event) => {
          const value = Number(event.currentTarget.value);
          setScrub(value);
          void seekTo(value);
        }} onPointerUp={() => setScrub(null)} onPointerCancel={() => setScrub(null)} onKeyUp={() => setScrub(null)} onBlur={() => setScrub(null)} />
        <output className="puptime-listener-time" data-testid="learn.audio.time">{audioTime(scrub ?? status.currentTime)} / {audioTime(duration)}</output>
        <select className="puptime-listener-speed" data-testid="learn.audio.speed" aria-label={t('learn.audioSpeed')} value={rate} disabled={disabled} onChange={(event) => {
          try { const speed = Number(event.currentTarget.value); player.setPlaybackRate(speed); setRate(speed); } catch { setFailed(true); }
        }}>{[0.75, 1, 1.25, 1.5].map((speed) => <option key={speed} value={speed}>{speed}×</option>)}</select>
        <div className="puptime-listener-volume">
          <button aria-label={silent ? t('learn.audioUnmute') : t('learn.audioMute')} title={silent ? t('learn.audioUnmute') : t('learn.audioMute')} onClick={() => {
            if (silent) { if (volume === 0) changeVolume(previousVolume.current); player.muted = false; setMuted(false); }
            else { player.muted = true; setMuted(true); }
          }}>
            <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4 5 9H2v6h3l6 5z" />{!silent ? <><path d="M15 8a6 6 0 0 1 0 8M18 5a10 10 0 0 1 0 14" /></> : <path d="m16 9 6 6m0-6-6 6" />}</svg>
          </button>
          <input type="range" min="0" max="1" step="0.05" value={muted ? 0 : volume} aria-label={t('learn.audioVolume')} onChange={(event) => changeVolume(Number(event.currentTarget.value))} />
        </div>
        {error && <div className="puptime-listener-error" role="alert" style={{ color: theme.danger }}>{t('learn.audioError')}</div>}
      </div>
    </section>;
  }
  return <View testID="learn.audio" style={[styles.panel, { borderColor: theme.border, backgroundColor: theme.surface, borderRadius: theme.presentation.controlRadius }]}>
    <View style={styles.row}>
      <Text accessibilityRole="header" aria-level={2} style={[styles.title, { color: theme.text }]}>{t('learn.audioTitle')}</Text>
      <Text style={[styles.meta, { color: theme.textMuted }]}>{t('learn.audioCredit', { voice: narrator })}</Text>
    </View>
    {recording.attribution && <Text style={[styles.meta, { color: theme.textMuted }]}>{title}</Text>}
    <View style={styles.row}>
      <Pressable testID="learn.audio.play" accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled: loading }} disabled={loading} onPress={() => void play()}
        style={({ pressed }) => [styles.button, { backgroundColor: theme.primary, borderColor: theme.primary, borderRadius: theme.presentation.controlRadius, opacity: loading || pressed ? 0.65 : 1 }]}>
        <Text style={[styles.buttonText, { color: theme.onPrimary }]}>{status.playing ? 'Ⅱ' : '▶'} {label}</Text>
      </Pressable>
      <Pressable testID="learn.audio.back" accessibilityRole="button" accessibilityLabel={t('learn.audioBack')} accessibilityState={{ disabled }} disabled={disabled} onPress={() => void seek(-15)} style={({ pressed }) => [styles.button, { borderColor: theme.border, borderRadius: theme.presentation.controlRadius, opacity: disabled ? 0.4 : pressed ? 0.65 : 1 }]}>
        <Text style={[styles.buttonText, { color: theme.primary }]}>−15 s</Text>
      </Pressable>
      <Pressable testID="learn.audio.forward" accessibilityRole="button" accessibilityLabel={t('learn.audioForward')} accessibilityState={{ disabled }} disabled={disabled} onPress={() => void seek(15)} style={({ pressed }) => [styles.button, { borderColor: theme.border, borderRadius: theme.presentation.controlRadius, opacity: disabled ? 0.4 : pressed ? 0.65 : 1 }]}>
        <Text style={[styles.buttonText, { color: theme.primary }]}>+15 s</Text>
      </Pressable>
      <Text testID="learn.audio.time" style={[styles.meta, { color: theme.textMuted }]}>{audioTime(status.currentTime)} / {audioTime(duration)}</Text>
    </View>
    <View accessibilityRole="progressbar" accessibilityLabel={t('learn.audioProgress')} aria-valuemin={0} aria-valuemax={duration} aria-valuenow={Math.min(status.currentTime, duration)} aria-valuetext={`${audioTime(status.currentTime)} / ${audioTime(duration)}`} style={[styles.track, { backgroundColor: theme.border }]}>
      <View style={[styles.progress, { backgroundColor: theme.primary, width: `${duration ? Math.min(100, status.currentTime / duration * 100) : 0}%` }]} />
    </View>
    <View style={styles.row}>
      <Text style={[styles.meta, { color: theme.textMuted }]}>{t('learn.audioSpeed')}</Text>
      {[0.75, 1, 1.25, 1.5].map((speed) => <Pressable key={speed} testID={`learn.audio.speed.${speed}`} accessibilityRole="button" accessibilityLabel={t('learn.audioSpeedValue', { rate: speed })} accessibilityState={{ selected: rate === speed }} aria-pressed={rate === speed} onPress={() => {
        try { player.setPlaybackRate(speed); setRate(speed); } catch { setFailed(true); }
      }} style={({ pressed }) => [styles.speed, { borderColor: rate === speed ? theme.primary : theme.border, backgroundColor: rate === speed ? theme.primarySoft : theme.surface, opacity: pressed ? 0.65 : 1 }]}>
        <Text style={[styles.buttonText, { color: rate === speed ? theme.primary : theme.text }]}>{speed}×</Text>
      </Pressable>)}
    </View>
    {error && <Text accessibilityRole="alert" style={[styles.meta, { color: theme.danger }]}>{t('learn.audioError')}</Text>}
  </View>;
}

export function GuideListener({ article, theme }: { article: CareArticle; theme: Theme }) {
  const recording = guideRecordings[article.id];
  // An edited guide must never play an older version of its care advice.
  if (!recording || recording.sourceText !== guideSourceText(article)) return null;
  return <RecordingPlayer key={article.id} article={article} recording={recording} theme={theme} />;
}

const styles = StyleSheet.create({
  panel: { marginTop: 20, borderWidth: 1, padding: 16, gap: 12 },
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  title: { fontSize: 19, lineHeight: 26, fontWeight: '700', marginRight: 'auto' },
  meta: { fontSize: 13, lineHeight: 20 },
  button: { minHeight: 48, paddingHorizontal: 14, paddingVertical: 10, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  buttonText: { fontSize: 14, lineHeight: 22, fontWeight: '600' },
  track: { height: 5, borderRadius: 3, overflow: 'hidden' },
  progress: { height: '100%' },
  speed: { minWidth: 48, minHeight: 44, borderWidth: 1, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8, justifyContent: 'center', alignItems: 'center' },
});

const webPlayerStyles = `
.puptime-listener{flex-shrink:0;border-top:1px solid;padding:14px 24px max(14px,env(safe-area-inset-bottom));font-family:Avenir Next,Avenir,system-ui,sans-serif;z-index:2}
.puptime-listener-inner{max-width:1280px;margin:0 auto;display:grid;grid-template-columns:44px minmax(130px,220px) 44px 44px minmax(140px,1fr) auto 64px 104px;align-items:center;gap:12px}
.puptime-listener button,.puptime-listener select{font:inherit;color:inherit;cursor:pointer;border:0;background:transparent;min-height:44px;border-radius:8px}
.puptime-listener button:hover:not(:disabled){opacity:.8}
.puptime-listener button:disabled,.puptime-listener input:disabled,.puptime-listener select:disabled{opacity:.45;cursor:default}
.puptime-listener button:focus-visible,.puptime-listener input:focus-visible,.puptime-listener select:focus-visible{outline:2px solid var(--audio-accent);outline-offset:3px}
.puptime-listener .puptime-listener-play{width:44px;border-radius:50%;display:grid;place-items:center}
.puptime-listener-copy{min-width:0}.puptime-listener-title{font-size:14px;line-height:21px;font-weight:650;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.puptime-listener-credit{font-size:12px;line-height:19px}.puptime-listener-skip{font-size:13px!important;font-weight:600!important}
.puptime-listener input{accent-color:var(--audio-accent);cursor:pointer;min-width:0;margin:0;min-height:24px}
.puptime-listener-progress{width:100%}.puptime-listener-time{font-size:12px;white-space:nowrap;font-variant-numeric:tabular-nums}
.puptime-listener-speed{font-size:13px!important;width:64px}.puptime-listener-volume{display:flex;align-items:center;gap:4px}.puptime-listener-volume button{width:44px;display:grid;place-items:center}.puptime-listener-volume input{width:56px}
@media(pointer:coarse){.puptime-listener-volume input{display:none}}
.puptime-listener-error{grid-column:1/-1;font-size:13px;line-height:20px}
@media(max-width:900px){.puptime-listener{padding:10px 16px max(10px,env(safe-area-inset-bottom))}.puptime-listener-inner{grid-template-columns:44px 44px 44px 1fr 52px;gap:6px}.puptime-listener-copy{order:0;grid-column:1/5;grid-row:1}.puptime-listener-play{order:1}.puptime-listener-back{order:2}.puptime-listener-forward{order:3}.puptime-listener-time{order:4;text-align:center}.puptime-listener-speed{order:5;width:52px}.puptime-listener-progress{order:6;grid-column:1/-1}.puptime-listener-volume{order:0;grid-column:5;grid-row:1;justify-content:flex-end}.puptime-listener-volume input{display:none}.puptime-listener-error{order:7}}
`;

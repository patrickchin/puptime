import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, AppState, StyleSheet, View } from 'react-native';

import { useAccountSnapshot } from '../cloud/use-account-snapshot';
import { getLocalRuntime, subscribeLocalWrites } from '../local/runtime.ios';
import { useLocalization } from '../localization-context';
import { spacing, surfaceTreatment } from '../theme';
import type { PuppyNameSettingProps } from './puppy-name-setting-props';
import { SettingsRow } from './SettingsRow';

export function PuppyNameSetting({theme,cloud}:PuppyNameSettingProps) {
  const {t}=useLocalization();
  const account=useAccountSnapshot(cloud?.controller??null);
  const remoteName=account?.local?.name;
  const [name,setName]=useState<string|null>(null),[saving,setSaving]=useState(false),[failed,setFailed]=useState(false);
  const mounted=useRef(false),sequence=useRef(0),locked=useRef(false),promptOpen=useRef(false);
  const reload=useCallback(async()=>{
    const read=++sequence.current;
    try {
      const saved=await (await getLocalRuntime()).storage.loadPuppyName();
      if(mounted.current&&read===sequence.current){setName(saved);setFailed(false);}
    } catch {if(mounted.current&&read===sequence.current)setFailed(true);}
  },[]);
  useEffect(()=>{
    mounted.current=true;void reload();
    const unsubscribe=subscribeLocalWrites(()=>void reload());
    const foreground=AppState.addEventListener('change',state=>{if(state==='active')void reload();});
    return()=>{mounted.current=false;sequence.current++;unsubscribe();foreground.remove();};
  },[reload]);
  useEffect(()=>{if(remoteName!==undefined)void reload();},[reload,remoteName]);

  function edit(draft:string) {
    if(!mounted.current||locked.current||promptOpen.current)return;
    promptOpen.current=true;
    Alert.prompt(t('puppy.name'),undefined,[
      {text:t('app.cancel'),style:'cancel',onPress:()=>{promptOpen.current=false;}},
      {text:t('notifications.saveNote'),onPress:(value?:string)=>{promptOpen.current=false;void save(value??'');}},
    ],'plain-text',draft,'default');
  }
  async function save(draft:string) {
    if(!mounted.current||locked.current)return;
    const value=draft.trim();
    const retry=()=>edit(draft);
    const buttons=[{text:t('app.cancel'),style:'cancel' as const},{text:t('puppy.retry'),onPress:retry}];
    if(!value||value.length>256){Alert.alert(t('puppy.name'),t('puppy.nameConstraint'),buttons);return;}
    locked.current=true;setSaving(true);
    try {
      await (await getLocalRuntime()).storage.savePuppyName(value);
      await reload();
    } catch {
      if(mounted.current)Alert.alert(t('puppy.saveError'),t('puppy.saveErrorBody'),buttons);
    } finally {locked.current=false;if(mounted.current)setSaving(false);}
  }
  return <View style={[styles.card,surfaceTreatment(theme),{backgroundColor:theme.surfaceRaised,borderColor:theme.border}]}>
    <SettingsRow testID="settings.puppy.name" icon="paw-outline" label={t('puppy.name')} detail={name??t(failed?'puppy.loadError':'puppy.loading')} disabled={saving||(!name&&!failed)} onPress={()=>name?edit(name):void reload()} theme={theme}/>
  </View>;
}

const styles=StyleSheet.create({card:{borderWidth:1,borderRadius:22,padding:8,marginBottom:spacing.sm}});

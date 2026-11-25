import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, StyleSheet, Text, TextInput, View } from 'react-native';
import { Pressable } from './TelemetryPressable';

import { useAccountSnapshot } from '../cloud/use-account-snapshot';
import { getLocalRuntime, subscribeLocalWrites } from '../local/runtime.native';
import { useLocalization } from '../localization-context';
import { spacing, surfaceTreatment } from '../theme';
import type { PuppyNameSettingProps } from './puppy-name-setting-props';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { SettingsRow } from './SettingsRow';
import { PuppyPhotoSetting } from './PuppyPhotoSetting.native';

export function PuppyNameSetting({theme,cloud,onShare}:PuppyNameSettingProps) {
  const {t}=useLocalization();
  const account=useAccountSnapshot(cloud?.controller??null);
  const remoteName=account?.local?.name;
  const [name,setName]=useState<string|null>(null),[saving,setSaving]=useState(false),[failed,setFailed]=useState(false);
  const [draft,setDraft]=useState<string|null>(null),[error,setError]=useState<'constraint'|'save'|null>(null);
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

  function edit(value:string) {
    if(!mounted.current||locked.current||promptOpen.current)return;
    promptOpen.current=true;setError(null);setDraft(value);
  }
  const closeEditor=()=>{if(locked.current)return;setDraft(null);setError(null);promptOpen.current=false;};
  async function save() {
    if(!mounted.current||locked.current||draft===null)return;
    const value=draft.trim();
    if(!value||value.length>256){setError('constraint');return;}
    locked.current=true;setSaving(true);setError(null);
    try {
      await (await getLocalRuntime()).storage.savePuppyName(value);
      await reload();
      if(mounted.current){setDraft(null);promptOpen.current=false;}
    } catch {if(mounted.current)setError('save');}
    finally {locked.current=false;if(mounted.current)setSaving(false);}
  }
  return <View style={[styles.card,surfaceTreatment(theme),{backgroundColor:theme.surfaceRaised,borderColor:theme.border,borderRadius:theme.presentation.cardRadius}]}>
    <PuppyPhotoSetting theme={theme}/>
    {draft===null?<Pressable testID="settings.puppy.name" accessibilityRole="button"
      accessibilityLabel={name??t(failed?'puppy.loadError':'puppy.loading')}
      accessibilityHint={name?t('puppy.editName'):undefined}
      disabled={!name&&!failed} onPress={()=>name?edit(name):void reload()}
      style={({pressed})=>[styles.nameRow,pressed&&{backgroundColor:theme.primarySoft}]}>
      <Text maxFontSizeMultiplier={2} style={[styles.title,{color:theme.text,fontFamily:theme.presentation.headingFont}]}>{name??t(failed?'puppy.loadError':'puppy.loading')}</Text>
      {name?<MaterialCommunityIcons name="pencil-outline" size={20} color={theme.primary} accessible={false}/>:null}
    </Pressable>:<View testID="settings.puppy.name.editor" style={styles.editor}>
      <TextInput maxFontSizeMultiplier={2} testID="settings.puppy.name.input" accessibilityLabel={t('puppy.name')} autoFocus
        value={draft} onChangeText={value=>{setDraft(value);setError(null);}} editable={!saving} maxLength={256} autoCapitalize="words" autoCorrect={false}
        returnKeyType="done" onSubmitEditing={()=>void save()}
        style={[styles.input,{color:theme.text,borderColor:theme.border,borderRadius:theme.presentation.controlRadius}]}/>
        {error?<View accessibilityRole="alert">
          {error==='save'?<Text style={[styles.error,{color:theme.danger}]}>{t('puppy.saveError')}</Text>:null}
          <Text testID="settings.puppy.name.error" style={[styles.error,{color:theme.danger}]}>{t(error==='constraint'?'puppy.nameConstraint':'puppy.saveErrorBody')}</Text>
        </View>:null}
        <View style={styles.actions}>
          <Pressable testID="settings.puppy.name.cancel" accessibilityRole="button" disabled={saving} accessibilityState={{disabled:saving}} onPress={closeEditor} style={styles.button}><Text style={{color:theme.primary}}>{t('app.cancel')}</Text></Pressable>
          <Pressable testID="settings.puppy.name.save" accessibilityRole="button" disabled={saving} accessibilityState={{disabled:saving,busy:saving}} onPress={()=>void save()} style={styles.button}><Text style={{color:theme.primary}}>{t(saving?'common.saving':'notifications.saveNote')}</Text></Pressable>
        </View>
    </View>}
    {onShare&&name&&draft===null?<SettingsRow theme={theme} testID="puppy.share" icon="account-multiple-plus-outline"
      label={t('pets.shareNamed',{name})} detail={t('pets.shareDetail')} onPress={onShare} wrap/>:null}
  </View>;
}

const styles=StyleSheet.create({
 card:{borderWidth:1,padding:spacing.md,gap:spacing.sm},
 nameRow:{minHeight:48,flexDirection:'row',alignItems:'center',gap:12,paddingHorizontal:8,borderRadius:12},
 editor:{gap:spacing.sm},title:{flex:1,fontSize:26,lineHeight:34,fontWeight:'700'},
 error:{fontSize:15,lineHeight:22},input:{minHeight:48,borderWidth:1,paddingHorizontal:12,paddingVertical:8,fontSize:24,fontWeight:'700'},actions:{flexDirection:'row',justifyContent:'flex-end',gap:4},
 button:{minWidth:76,minHeight:48,alignItems:'center',justifyContent:'center',paddingHorizontal:12},
});

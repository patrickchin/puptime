import { useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, Text, View } from 'react-native';
import { removePuppyPhotoFile } from '../photo-files.native';
import { choosePuppyPhoto } from '../choose-puppy-photo.native';
import { getLocalRuntime } from '../local/runtime.native';
import { useLocalization } from '../localization-context';
import { usePuppyProfile } from '../use-puppy-profile.native';
import type { Theme } from '../theme';
import { PuppyAvatar } from './PuppyAvatar';

export function PuppyPhotoSetting({theme}:{theme:Theme}) {
  const {t}=useLocalization(),{profile,photoUri,failed,reload}=usePuppyProfile();
  const [busy,setBusy]=useState(false),[error,setError]=useState(false),locked=useRef(false);
  async function change(remove=false) {
    if(locked.current)return;
    locked.current=true;setBusy(true);setError(false);
    let selected:string|null=null;
    try {
      const photo=remove?null:await choosePuppyPhoto();
      if(!remove&&photo===null)return;
      selected=photo;
      await (await getLocalRuntime()).storage.savePuppyPhoto(photo);
      selected=null;
      await reload();
    } catch {if(selected)try{removePuppyPhotoFile(selected);}catch{}setError(true);}
    finally {locked.current=false;setBusy(false);}
  }
  const button=(id:string,label:string,onPress:()=>void)=><Pressable testID={id} accessibilityRole="button" disabled={busy||!profile} accessibilityState={{disabled:busy||!profile,busy}} onPress={onPress}
    style={({pressed})=>({minHeight:48,justifyContent:'center',paddingHorizontal:8,borderRadius:12,opacity:busy?0.5:1,backgroundColor:pressed?theme.primarySoft:undefined})}><Text style={{fontSize:16,color:theme.primary,fontWeight:'600'}}>{label}</Text></Pressable>;
  return <View style={{padding:8,gap:8}}>
    <View style={{flexDirection:'row',alignItems:'center',gap:16}}>
      <PuppyAvatar uri={photoUri} size={72} theme={theme}/>
      <View style={{flex:1,gap:4}}>
        <Text style={{fontSize:16,lineHeight:22,fontWeight:'800',color:theme.text}}>{t('puppy.photo')}</Text>
        {busy?<ActivityIndicator accessibilityLabel={t('common.saving')} color={theme.primary}/>:failed?<Pressable testID="settings.puppy.photo.retry" accessibilityRole="button" onPress={()=>void reload()} style={{minHeight:48,justifyContent:'center'}}><Text style={{color:theme.primary}}>{t('puppy.retry')}</Text></Pressable>:
          button('settings.puppy.photo.choose',t(profile?.photoId?'puppy.changePhoto':'puppy.addPhoto'),()=>void change())}
      </View>
    </View>
    {profile?.photoId?button('settings.puppy.photo.remove',t('puppy.removePhoto'),()=>Alert.alert(t('puppy.removePhotoTitle'),undefined,[{text:t('app.cancel'),style:'cancel'},{text:t('puppy.removePhoto'),style:'destructive',onPress:()=>void change(true)}])):null}
    {error?<Text testID="settings.puppy.photo.error" accessibilityRole="alert" style={{fontSize:15,lineHeight:22,color:theme.danger}}>{t('puppy.photoError')}</Text>:null}
  </View>;
}

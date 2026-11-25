import { useRef, useState } from 'react';
import { ActionSheetIOS, ActivityIndicator, Alert, Platform, StyleSheet, Text, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Pressable } from './TelemetryPressable';
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
  function editPhoto() {
    if(failed){void reload();return;}
    if(!profile?.photoId){void change();return;}
    const remove=()=>Alert.alert(t('puppy.removePhotoTitle'),undefined,[
      {text:t('app.cancel'),style:'cancel'},
      {text:t('puppy.removePhoto'),style:'destructive',onPress:()=>void change(true)},
    ]);
    if(Platform.OS==='ios'){
      ActionSheetIOS.showActionSheetWithOptions({
        options:[t('puppy.changePhoto'),t('puppy.removePhoto'),t('app.cancel')],
        destructiveButtonIndex:1,cancelButtonIndex:2,userInterfaceStyle:theme.isDark?'dark':'light',
      },index=>{if(index===0)void change();if(index===1)remove();});
    }else{
      Alert.alert(t('puppy.editPhoto'),undefined,[
        {text:t('app.cancel'),style:'cancel'},
        {text:t('puppy.changePhoto'),onPress:()=>void change()},
        {text:t('puppy.removePhoto'),style:'destructive',onPress:remove},
      ]);
    }
  }
  const disabled=busy||(!profile&&!failed);
  return <View style={styles.container}>
    <Pressable testID="settings.puppy.photo.choose" accessibilityRole="button"
      accessibilityLabel={t(failed?'puppy.retry':profile?.photoId?'puppy.editPhoto':'puppy.addPhoto')}
      accessibilityState={{disabled,busy}} disabled={disabled} onPress={editPhoto}
      style={({pressed})=>[styles.target,pressed&&{opacity:0.7}]}>
      <PuppyAvatar uri={photoUri} size={80} theme={theme}/>
      <View style={[styles.badge,{backgroundColor:theme.primary,borderColor:theme.surfaceRaised}]}>
        {busy?<ActivityIndicator size="small" color={theme.onPrimary}/>:<MaterialCommunityIcons
          name={failed?'refresh':'camera-outline'} size={18} color={theme.onPrimary} accessible={false}/>}
      </View>
    </Pressable>
    {error?<Text testID="settings.puppy.photo.error" accessibilityRole="alert" style={{fontSize:15,lineHeight:22,color:theme.danger}}>{t('puppy.photoError')}</Text>:null}
  </View>;
}
const styles=StyleSheet.create({
  container:{gap:8},
  target:{width:84,height:84,justifyContent:'center'},
  badge:{position:'absolute',right:0,bottom:0,width:32,height:32,borderRadius:16,borderWidth:2,alignItems:'center',justifyContent:'center'},
});

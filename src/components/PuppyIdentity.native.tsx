import { Pressable, Text } from 'react-native';
import { useLocalization } from '../localization-context';
import { usePuppyProfile } from '../use-puppy-profile.native';
import type { Theme } from '../theme';
import { PuppyAvatar } from './PuppyAvatar';

export function PuppyIdentity({theme,onPress,showName=false}:{theme:Theme;onPress:()=>void;showName?:boolean}) {
  const {profile}=usePuppyProfile(),{t}=useLocalization();
  return <Pressable testID={showName?'nav.puppy':'header.puppy'} accessibilityRole="button" accessibilityLabel={t('puppy.openProfile',{name:profile?.name??t('account.defaultName')})} onPress={onPress}
    style={({pressed})=>({minHeight:48,minWidth:48,flexDirection:'row',alignItems:'center',gap:12,padding:4,borderRadius:24,backgroundColor:pressed?theme.primarySoft:undefined})}>
    <PuppyAvatar photo={profile?.photo} size={showName?48:40} theme={theme}/>
    {showName?<Text numberOfLines={2} style={{flex:1,fontSize:18,lineHeight:25,fontWeight:'700',color:theme.text}}>{profile?.name??t('account.defaultName')}</Text>:null}
  </Pressable>;
}

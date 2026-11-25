import {MaterialCommunityIcons} from '@expo/vector-icons';
import { Text, View } from 'react-native';
import { Pressable } from './TelemetryPressable';
import { useLocalization } from '../localization-context';
import { usePuppyProfile } from '../use-puppy-profile.native';
import type { Theme } from '../theme';
import { PuppyAvatar } from './PuppyAvatar';

export function PuppyIdentity({theme,onPress,showName=false}:{theme:Theme;onPress?:()=>void;showName?:boolean}) {
  const {profile,photoUri}=usePuppyProfile(),{t}=useLocalization();
  const style={minHeight:48,minWidth:48,flexDirection:'row' as const,alignItems:'center' as const,gap:12,padding:showName?8:4,borderRadius:theme.presentation.controlRadius};
  const content=<><PuppyAvatar uri={photoUri} size={showName?48:40} theme={theme}/>{showName?<Text numberOfLines={2} style={{flex:1,fontSize:18,lineHeight:25,fontWeight:'700',color:theme.text}}>{profile?.name??t('account.defaultName')}</Text>:null}</>;
  if(!onPress)return <View style={style}>{content}</View>;
  return <Pressable testID={showName?'nav.puppy':'header.puppy'} accessibilityRole="button" accessibilityLabel={showName?t('puppy.openProfile',{name:profile?.name??t('account.defaultName')}):t('nav.pets')} onPress={onPress}
    style={({pressed})=>[style,{backgroundColor:pressed?theme.primarySoft:undefined}]}>{content}{showName?<MaterialCommunityIcons name="chevron-right" size={23} color={theme.textMuted}
      accessible={false} accessibilityElementsHidden importantForAccessibility="no"/>:null}</Pressable>;
}

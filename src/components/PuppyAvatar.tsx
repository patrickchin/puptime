import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { Image, View } from 'react-native';
import type { Theme } from '../theme';

export function PuppyAvatar({uri,size=44,theme}:{uri?:string;size?:number;theme:Theme}) {
  const [failed,setFailed]=useState<string>();
  useEffect(()=>setFailed(undefined),[uri]);
  return <View accessible={false} style={{width:size,height:size,borderRadius:size/2,overflow:'hidden',backgroundColor:theme.primarySoft,alignItems:'center',justifyContent:'center'}}>
    {uri&&uri!==failed?<Image testID="puppy.photo.image" accessible={false} source={{uri}} resizeMode="cover" onError={()=>setFailed(uri)} style={{width:size,height:size}}/>:
      <MaterialCommunityIcons accessible={false} accessibilityElementsHidden importantForAccessibility="no" name="paw-outline" size={size*0.52} color={theme.primary}/>}
  </View>;
}

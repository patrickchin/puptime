import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { Image, View } from 'react-native';
import type { Theme } from '../theme';

export function PuppyAvatar({photo,size=44,theme}:{photo?:string;size?:number;theme:Theme}) {
  const [failed,setFailed]=useState<string>();
  useEffect(()=>setFailed(undefined),[photo]);
  return <View accessible={false} style={{width:size,height:size,borderRadius:size/2,overflow:'hidden',backgroundColor:theme.primarySoft,alignItems:'center',justifyContent:'center'}}>
    {photo&&photo!==failed?<Image testID="puppy.photo.image" accessible={false} source={{uri:photo}} resizeMode="cover" onError={()=>setFailed(photo)} style={{width:size,height:size}}/>:
      <MaterialCommunityIcons accessible={false} accessibilityElementsHidden importantForAccessibility="no" name="paw-outline" size={size*0.52} color={theme.primary}/>}
  </View>;
}

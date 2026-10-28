import {BlurView} from 'expo-blur';
import type {RefObject} from 'react';
import {StyleSheet,Text,View} from 'react-native';
import { Pressable } from './TelemetryPressable';
import type {Theme} from '../theme';

export type SpotlightRect={x:number;y:number;width:number;height:number};

// Sibling overlay: the real buttons and history keep their normal layout.
export function OnboardingSpotlight({target,blurTarget,theme,onDismiss}:{
  target:SpotlightRect;blurTarget:RefObject<View|null>;theme:Theme;onDismiss:()=>void;
}){
  const x=Math.max(0,target.x-5),y=Math.max(0,target.y-5),width=target.width+10,height=target.height+10;
  const shade=(style:object)=><View style={[styles.shade,style]} onStartShouldSetResponder={()=>true} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
    <BlurView pointerEvents="none" tint={theme.isDark?'dark':'light'} intensity={48} blurTarget={blurTarget} blurMethod="dimezisBlurViewSdk31Plus" style={StyleSheet.absoluteFill}/>
    <View pointerEvents="none" style={[StyleSheet.absoluteFill,{backgroundColor:'rgba(15,38,28,.22)'}]}/>
  </View>;
  return <View testID="onboarding.spotlight" pointerEvents="box-none" style={StyleSheet.absoluteFill} onAccessibilityEscape={onDismiss}>
    {shade({left:0,right:0,top:0,height:y})}
    {shade({left:0,top:y,width:x,height})}
    {shade({left:x+width,right:0,top:y,height})}
    {shade({left:0,right:0,top:y+height,bottom:0})}
    <View pointerEvents="none" style={[styles.outline,{left:x,top:y,width,height,borderColor:theme.primary}]}/>
    <View style={[styles.bubble,{top:y+height+16,backgroundColor:theme.primary}]}>
      <Text accessibilityRole="header" style={[styles.title,{color:theme.onPrimary}]}>Anything just happened?</Text>
      <Text style={[styles.body,{color:theme.onPrimary}]}>Tap Pee, Poop or Eat above. It saves the time for you.</Text>
      <Pressable testID="onboarding.spotlight.dismiss" accessibilityRole="button" onPress={onDismiss} style={styles.dismiss}>
        <Text style={[styles.link,{color:theme.onPrimary}]}>Nothing yet—I’ll come back</Text>
      </Pressable>
    </View>
  </View>;
}
const styles=StyleSheet.create({
  shade:{position:'absolute',overflow:'hidden'},outline:{position:'absolute',borderWidth:2,borderRadius:26},
  bubble:{position:'absolute',left:18,right:18,borderRadius:22,padding:22,gap:12},title:{fontSize:23,lineHeight:29,fontWeight:'700'},body:{fontSize:16,lineHeight:24},
  dismiss:{minHeight:48,justifyContent:'center',alignSelf:'flex-start'},link:{fontSize:15,lineHeight:22,textDecorationLine:'underline'},
});

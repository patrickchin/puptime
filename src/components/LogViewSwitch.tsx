import {MaterialCommunityIcons} from '@expo/vector-icons';
import {StyleSheet,Text} from 'react-native';
import { Pressable } from './TelemetryPressable';
import {useLocalization} from '../localization-context';
import type {Theme} from '../theme';

export function LogViewSwitch({tab,theme,onChange}:{tab:'log'|'timeline';theme:Theme;onChange:(tab:'log'|'timeline')=>void}){
 const {t}=useLocalization();
 const destination=tab==='log'?'timeline':'log';
 return <Pressable testID="nav.switch" accessibilityRole="button" accessibilityLabel={t(`nav.${destination}`)} onPress={()=>onChange(destination)}
  style={({pressed})=>[styles.button,{backgroundColor:pressed?theme.primarySoft:theme.surfaceRaised,shadowColor:theme.text}]}>
  <MaterialCommunityIcons accessible={false} name={destination==='log'?'format-list-bulleted':'timeline-clock-outline'} size={22} color={theme.primary}/>
  <Text maxFontSizeMultiplier={2} style={[styles.label,{color:theme.primary}]}>{t(`nav.${destination}`)}</Text>
 </Pressable>;
}
const styles=StyleSheet.create({
 button:{position:'absolute',right:20,bottom:16,maxWidth:'85%',minHeight:56,paddingHorizontal:20,paddingVertical:12,borderRadius:28,flexDirection:'row',gap:10,alignItems:'center',justifyContent:'center',shadowOpacity:.18,shadowRadius:8,shadowOffset:{width:0,height:3},elevation:6},
 label:{fontSize:16,lineHeight:24,fontWeight:'600',flexShrink:1},
});

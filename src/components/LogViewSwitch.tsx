import {MaterialCommunityIcons} from '@expo/vector-icons';
import {Pressable,StyleSheet,Text,View,useWindowDimensions} from 'react-native';
import {useLocalization} from '../localization-context';
import type {Theme} from '../theme';

export function LogViewSwitch({tab,theme,onChange}:{tab:'log'|'timeline';theme:Theme;onChange:(tab:'log'|'timeline')=>void}){
 const {t}=useLocalization(),{fontScale}=useWindowDimensions();
 return <View accessibilityRole="tablist" style={[styles.group,{backgroundColor:theme.surface,borderColor:theme.border,borderRadius:theme.presentation.controlRadius}]}>
  {(['log','timeline'] as const).map(item=><Pressable key={item} testID={tab===item?`nav.view.${item}`:"nav.switch"} accessibilityRole="tab" accessibilityLabel={t(`nav.${item}`)} accessibilityState={{selected:tab===item}} onPress={()=>onChange(item)}
   style={({pressed})=>[styles.tab,{backgroundColor:tab===item||pressed?theme.primarySoft:undefined,borderRadius:theme.presentation.controlRadius}]}>
   {fontScale<1.4?<MaterialCommunityIcons accessible={false} name={item==='log'?'home-outline':'timeline-clock-outline'} size={20} color={tab===item?theme.primary:theme.textMuted}/>:null}
   <Text maxFontSizeMultiplier={2} style={[styles.label,{color:tab===item?theme.primary:theme.textMuted}]}>{t(`nav.${item}`)}</Text>
  </Pressable>)}
 </View>;
}
const styles=StyleSheet.create({group:{flexDirection:'row',marginHorizontal:20,marginBottom:12,padding:4,borderWidth:1},tab:{flex:1,minHeight:48,padding:8,flexDirection:'row',gap:8,alignItems:'center',justifyContent:'center'},label:{fontSize:15,lineHeight:22,fontWeight:'600',flexShrink:1}});

import {MaterialCommunityIcons} from '@expo/vector-icons';
import {StyleSheet,Text,View,type StyleProp,type ViewStyle} from 'react-native';
import {Pressable} from './TelemetryPressable';
import {useLocalization} from '../localization-context';
import {headingStyle,type Theme} from '../theme';

export function ScreenHeader({theme,title,onBack,testID,disabled=false,style}:{theme:Theme;title:string;onBack:()=>void;testID:string;disabled?:boolean;style?:StyleProp<ViewStyle>}) {
 const {t}=useLocalization();
 return <View style={[styles.header,style]}>
  <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={t('account.back')} disabled={disabled} accessibilityState={{disabled}} onPress={onBack}
   style={({pressed})=>[styles.back,{backgroundColor:pressed?theme.primarySoft:theme.surfaceRaised,borderRadius:theme.presentation.controlRadius,opacity:disabled?0.5:1}]}>
   <MaterialCommunityIcons accessible={false} name="arrow-left" size={24} color={theme.primary} accessibilityElementsHidden importantForAccessibility="no"/>
  </Pressable>
  <Text accessibilityRole="header" maxFontSizeMultiplier={2} style={[styles.title,headingStyle(theme),{color:theme.text}]}>{title}</Text>
 </View>;
}
const styles=StyleSheet.create({header:{minHeight:48,flexDirection:'row',alignItems:'center',gap:12},back:{width:48,height:48,alignItems:'center',justifyContent:'center'},title:{flex:1,fontSize:20,lineHeight:28,fontWeight:'700'}});

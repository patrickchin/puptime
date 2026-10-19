import {MaterialCommunityIcons} from '@expo/vector-icons';
import type {ReactNode} from 'react';
import {Platform,Pressable,ScrollView,StyleSheet,Text,View,useWindowDimensions} from 'react-native';
import {Drawer} from 'react-native-drawer-layout';
import {useLocalization} from '../localization-context';
import {headingStyle,navigationIcon,type Theme} from '../theme';
import type {Tab} from './BottomNav';

export type AppTab=Tab|'notifications';
const destinations:AppTab[]=['log','timeline','insights','schedule','notifications','learn'];

export function SideNavigation({open,enabled,tab,settingsVisible,theme,onOpen,onClose,onChange,onSettings,children}:{
 open:boolean;enabled:boolean;tab:AppTab;settingsVisible:boolean;theme:Theme;
 onOpen:()=>void;onClose:()=>void;onChange:(tab:AppTab)=>void;onSettings:()=>void;children:ReactNode;
}){
 const {t}=useLocalization(),{width}=useWindowDimensions();
 if(Platform.OS!=='ios')return children;
 const item=(key:AppTab|'settings')=>{
  const selected=key==='settings'?settingsVisible:!settingsVisible&&tab===key;
  const label=key==='settings'?t('settings.title'):key==='notifications'?t('notifications.title'):t(`nav.${key}`);
  const icon=key==='settings'?'cog-outline':key==='notifications'?'bell-outline':navigationIcon(theme,key);
  return <Pressable key={key} testID={`nav.${key}`} accessibilityRole="button" accessibilityLabel={label}
   accessibilityState={{selected}} onPress={()=>{onClose();if(key==='settings')onSettings();else onChange(key);}}
   style={({pressed})=>[styles.item,{backgroundColor:selected?theme.primarySoft:pressed?theme.surface:undefined,borderRadius:theme.presentation.controlRadius}]}>
   <MaterialCommunityIcons accessible={false} name={icon as keyof typeof MaterialCommunityIcons.glyphMap} size={24} color={selected?theme.primary:theme.textMuted} accessibilityElementsHidden importantForAccessibility="no"/>
   <Text style={[styles.itemText,{color:selected?theme.primary:theme.text,fontWeight:selected?'700':'500'}]}>{label}</Text>
  </Pressable>;
 };
 return <Drawer open={enabled&&open} onOpen={onOpen} onClose={onClose} drawerPosition="left" drawerType="front"
  swipeEnabled={enabled} drawerStyle={{width:Math.min(340,width*0.84),backgroundColor:theme.background}}
  overlayAccessibilityLabel={t('nav.close')} renderDrawerContent={()=><ScrollView testID="nav.drawer" contentContainerStyle={styles.content} onAccessibilityEscape={onClose}>
   <View style={styles.brandRow}><Text style={[styles.brand,headingStyle(theme),{color:theme.text}]}>Puptime</Text>
    <Pressable testID="nav.close" accessibilityRole="button" accessibilityLabel={t('nav.close')} onPress={onClose} style={styles.close}>
     <MaterialCommunityIcons accessible={false} name="close" size={24} color={theme.text} accessibilityElementsHidden importantForAccessibility="no"/>
    </Pressable>
   </View>
   <View style={styles.items}>{destinations.map(item)}</View>
   <View style={[styles.settings,{borderTopColor:theme.border}]}>{item('settings')}</View>
  </ScrollView>}>
  {children}
 </Drawer>;
}

const styles=StyleSheet.create({
 content:{flexGrow:1,padding:16,paddingTop:20,gap:24},brandRow:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',gap:12},
 brand:{fontSize:28,lineHeight:36,fontWeight:'800'},close:{minWidth:48,minHeight:48,alignItems:'center',justifyContent:'center'},
 items:{gap:6},item:{minHeight:56,padding:14,flexDirection:'row',alignItems:'center',gap:14},itemText:{fontSize:18,flex:1},
 settings:{marginTop:'auto',borderTopWidth:1,paddingTop:16},
});

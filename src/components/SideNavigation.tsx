import {MaterialCommunityIcons} from '@expo/vector-icons';
import {useEffect,useState,type ReactNode} from 'react';
import {AccessibilityInfo,AppState,Modal,Platform,ScrollView,StyleSheet,Text,View,useWindowDimensions} from 'react-native';
import { Pressable } from './TelemetryPressable';
import {Drawer} from 'react-native-drawer-layout';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {useLocalization} from '../localization-context';
import {headingStyle,navigationIcon,type Theme} from '../theme';
import type {Tab} from './BottomNav';

export type AppTab=Tab|'notifications'|'pets';
const destinations:AppTab[]=['log','pets','timeline','insights','schedule','notifications','learn'];

export function SideNavigation({open,enabled,tab,settingsVisible,theme,onOpen,onClose,onChange,onSettings,onAccount,children}:{
 open:boolean;enabled:boolean;tab:AppTab|'account';settingsVisible:boolean;theme:Theme;
 onOpen:()=>void;onClose:()=>void;onChange:(tab:AppTab)=>void;onSettings:()=>void;onAccount?:()=>void;children:ReactNode;
}){
 const {t}=useLocalization(),{width}=useWindowDimensions(),insets=useSafeAreaInsets();
 const [reduceMotion,setReduceMotion]=useState(true);
 useEffect(()=>{
  let active=true;
  const refresh=()=>{void AccessibilityInfo.isReduceMotionEnabled().then(value=>{if(active)setReduceMotion(value);});};
  refresh();
  const subscription=AccessibilityInfo.addEventListener('reduceMotionChanged',setReduceMotion);
  const foreground=AppState.addEventListener('change',state=>{if(state==='active')refresh();});
  return()=>{active=false;subscription.remove();foreground.remove();};
 },[]);
 if(Platform.OS==='web')return children;
 const item=(key:AppTab|'settings'|'account')=>{
  const selected=key==='settings'?settingsVisible:key==='account'?!settingsVisible&&tab==='account':!settingsVisible&&tab===key;
  const label=key==='settings'?t('settings.title'):key==='account'?t('account.title'):key==='notifications'?t('notifications.title'):t(`nav.${key}`);
  const icon=key==='settings'?'cog-outline':key==='account'?'account-circle-outline':key==='notifications'?'bell-outline':key==='pets'?'paw-outline':navigationIcon(theme,key);
  return <Pressable key={key} testID={`nav.${key}`} accessibilityRole="button" accessibilityLabel={label}
   accessibilityState={{selected}} onPress={()=>{onClose();if(key==='settings')onSettings();else if(key==='account')onAccount?.();else onChange(key);}}
   style={({pressed})=>[styles.item,{backgroundColor:selected?theme.primarySoft:undefined,opacity:pressed?0.65:1,borderRadius:theme.presentation.controlRadius}]}>
   <MaterialCommunityIcons accessible={false} name={icon as keyof typeof MaterialCommunityIcons.glyphMap} size={24} color={selected?theme.primary:theme.onCanvasMuted} accessibilityElementsHidden importantForAccessibility="no"/>
   <Text maxFontSizeMultiplier={2} style={[styles.itemText,{color:selected?theme.primary:theme.onCanvas,fontWeight:selected?'700':'500'}]}>{label}</Text>
  </Pressable>;
 };
 const drawerWidth=Math.min(340,width*0.84);
 const content=()=><ScrollView testID="nav.drawer" stickyHeaderIndices={[0]} contentContainerStyle={styles.content} onAccessibilityEscape={onClose}>
   <View style={{backgroundColor:theme.canvas}}><View style={styles.brandRow}><Text maxFontSizeMultiplier={1.5} style={[styles.brand,headingStyle(theme),{color:theme.onCanvas}]}>Puptime</Text>
    <Pressable testID="nav.close" accessibilityRole="button" accessibilityLabel={t('nav.close')} onPress={onClose} style={styles.close}>
     <MaterialCommunityIcons accessible={false} name="close" size={24} color={theme.onCanvas} accessibilityElementsHidden importantForAccessibility="no"/>
    </Pressable>
   </View></View>
   <View style={styles.items}>{destinations.map(item)}</View>


   <View style={[styles.settings,{borderTopColor:theme.canvasBorder}]}>{onAccount?item('account'):null}{item('settings')}</View>
  </ScrollView>;
 return <><Drawer open={!reduceMotion&&enabled&&open} onOpen={onOpen} onClose={onClose} drawerPosition="left" drawerType="front"
  swipeEnabled={!reduceMotion&&enabled} drawerStyle={{width:drawerWidth,backgroundColor:theme.canvas}}
  overlayAccessibilityLabel={t('nav.close')} renderDrawerContent={content}>
  {children}
 </Drawer>
 {/* The maintained drawer forces spring motion; use native static presentation
     for this preference while keeping its activity child mounted. */}
 <Modal visible={reduceMotion&&enabled&&open} transparent animationType="none" onRequestClose={onClose}>
  <View style={styles.motionLayer} onAccessibilityEscape={onClose}>
   <Pressable testID="nav.backdrop" accessibilityRole="button" accessibilityLabel={t('nav.close')} onPress={onClose} style={[StyleSheet.absoluteFill,styles.backdrop]}/>
   <View testID="nav.reducedMotion" accessibilityViewIsModal style={{width:drawerWidth,backgroundColor:theme.canvas,paddingTop:insets.top,paddingBottom:insets.bottom}}>{content()}</View>
  </View>
 </Modal></>;
}

const styles=StyleSheet.create({
 motionLayer:{flex:1,flexDirection:'row'},backdrop:{backgroundColor:'rgba(0,0,0,0.5)'},
 content:{flexGrow:1,padding:16,paddingTop:20,gap:24},brandRow:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',gap:12},
 brand:{fontSize:28,lineHeight:36,fontWeight:'800'},close:{minWidth:48,minHeight:48,alignItems:'center',justifyContent:'center'},
 items:{gap:6},item:{minHeight:56,padding:14,flexDirection:'row',alignItems:'center',gap:14},itemText:{fontSize:18,flex:1},
 settings:{marginTop:'auto',borderTopWidth:1,paddingTop:16},
});

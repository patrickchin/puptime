import {MaterialCommunityIcons} from '@expo/vector-icons';
import {useEffect,useState,type ReactNode} from 'react';
import {AccessibilityInfo,AppState,Modal,Platform,Pressable,ScrollView,StyleSheet,Text,View,useWindowDimensions} from 'react-native';
import {Drawer} from 'react-native-drawer-layout';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {useLocalization} from '../localization-context';
import {headingStyle,navigationIcon,type Theme} from '../theme';
import type {Tab} from './BottomNav';
import {PuppyIdentity} from './PuppyIdentity';

export type AppTab=Tab|'notifications';
const destinations:AppTab[]=['log','timeline','insights','schedule','notifications','learn'];

export function SideNavigation({open,enabled,tab,settingsVisible,theme,onOpen,onClose,onChange,onSettings,children}:{
 open:boolean;enabled:boolean;tab:AppTab;settingsVisible:boolean;theme:Theme;
 onOpen:()=>void;onClose:()=>void;onChange:(tab:AppTab)=>void;onSettings:()=>void;children:ReactNode;
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
 const item=(key:AppTab|'settings')=>{
  const selected=key==='settings'?settingsVisible:!settingsVisible&&tab===key;
  const label=key==='settings'?t('settings.title'):key==='notifications'?t('notifications.title'):t(`nav.${key}`);
  const icon=key==='settings'?'cog-outline':key==='notifications'?'bell-outline':navigationIcon(theme,key);
  return <Pressable key={key} testID={`nav.${key}`} accessibilityRole="button" accessibilityLabel={label}
   accessibilityState={{selected}} onPress={()=>{onClose();if(key==='settings')onSettings();else onChange(key);}}
   style={({pressed})=>[styles.item,{backgroundColor:selected?theme.primarySoft:pressed?theme.surface:undefined,borderRadius:theme.presentation.controlRadius}]}>
   <MaterialCommunityIcons accessible={false} name={icon as keyof typeof MaterialCommunityIcons.glyphMap} size={24} color={selected?theme.primary:theme.textMuted} accessibilityElementsHidden importantForAccessibility="no"/>
   <Text maxFontSizeMultiplier={2} style={[styles.itemText,{color:selected?theme.primary:theme.text,fontWeight:selected?'700':'500'}]}>{label}</Text>
  </Pressable>;
 };
 const drawerWidth=Math.min(340,width*0.84);
 const content=()=><ScrollView testID="nav.drawer" stickyHeaderIndices={[0]} contentContainerStyle={styles.content} onAccessibilityEscape={onClose}>
   <View style={{backgroundColor:theme.background}}><View style={styles.brandRow}><Text maxFontSizeMultiplier={1.5} style={[styles.brand,headingStyle(theme),{color:theme.text}]}>Puptime</Text>
    <Pressable testID="nav.close" accessibilityRole="button" accessibilityLabel={t('nav.close')} onPress={onClose} style={styles.close}>
     <MaterialCommunityIcons accessible={false} name="close" size={24} color={theme.text} accessibilityElementsHidden importantForAccessibility="no"/>
    </Pressable>
   </View></View>
   <PuppyIdentity theme={theme} showName onPress={()=>{onClose();onSettings();}}/>
   <View style={styles.items}>{destinations.map(item)}</View>
   <View style={[styles.settings,{borderTopColor:theme.border}]}>{item('settings')}</View>
  </ScrollView>;
 return <><Drawer open={!reduceMotion&&enabled&&open} onOpen={onOpen} onClose={onClose} drawerPosition="left" drawerType="front"
  swipeEnabled={!reduceMotion&&enabled} drawerStyle={{width:drawerWidth,backgroundColor:theme.background}}
  overlayAccessibilityLabel={t('nav.close')} renderDrawerContent={content}>
  {children}
 </Drawer>
 {/* The maintained drawer forces spring motion; use native static presentation
     for this preference while keeping its activity child mounted. */}
 <Modal visible={reduceMotion&&enabled&&open} transparent animationType="none" onRequestClose={onClose}>
  <View style={styles.motionLayer} onAccessibilityEscape={onClose}>
   <Pressable testID="nav.backdrop" accessibilityRole="button" accessibilityLabel={t('nav.close')} onPress={onClose} style={[StyleSheet.absoluteFill,styles.backdrop]}/>
   <View testID="nav.reducedMotion" accessibilityViewIsModal style={{width:drawerWidth,backgroundColor:theme.background,paddingTop:insets.top,paddingBottom:insets.bottom}}>{content()}</View>
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

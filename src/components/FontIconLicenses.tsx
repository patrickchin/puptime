import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import {useRef,useState} from 'react';
import {AccessibilityInfo,Modal,Platform,ScrollView,StyleSheet,Text,View} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {Pressable} from './TelemetryPressable';
import {SettingsRow} from './SettingsRow';
import notices from '../font-icon-notices.json';
import androidSoftwareNotices from '../android-software-notices.json';
import {useLocalization} from '../localization-context';
import {headingStyle,spacing,type Theme} from '../theme';

export function FontIconLicenses({theme}:{theme:Theme}) {
 const {t}=useLocalization(),[visible,setVisible]=useState(false),heading=useRef<Text>(null),trigger=useRef<View>(null);
 const close=()=>setVisible(false);
 return <>
  <SettingsRow testID="settings.fontLicenses.open" buttonRef={trigger} icon="license" label={t('settings.fontLicenses')} detail={t('settings.fontLicensesDetail')} onPress={()=>setVisible(true)} theme={theme} wrap/>
  <Modal visible={visible} presentationStyle="pageSheet" animationType="none" supportedOrientations={['portrait','landscape-left','landscape-right']} onRequestClose={close}
   onShow={()=>{if(heading.current)AccessibilityInfo.sendAccessibilityEvent(heading.current,'focus');}}
   onDismiss={()=>{if(trigger.current)AccessibilityInfo.sendAccessibilityEvent(trigger.current,'focus');}}>
   <SafeAreaView testID="screen.fontLicenses" accessibilityViewIsModal onAccessibilityEscape={close} style={[styles.page,{backgroundColor:theme.background}]}>
    <View style={styles.header}>
     <Text ref={heading} accessibilityRole="header" style={[styles.title,headingStyle(theme),{color:theme.text}]}>{t('settings.fontLicenses')}</Text>
     <Pressable testID="fontLicenses.close" accessibilityRole="button" accessibilityLabel={t('settings.fontLicensesClose')} onPress={close} style={({pressed})=>[styles.close,{backgroundColor:pressed?theme.primarySoft:theme.surface,borderRadius:theme.presentation.controlRadius}]}>
      <MaterialCommunityIcons name="close" size={24} color={theme.primary} accessibilityElementsHidden importantForAccessibility="no"/>
     </Pressable>
    </View>
    <ScrollView testID="fontLicenses.body" contentContainerStyle={styles.content}>
     {[...notices,...(Platform.OS==='android'?androidSoftwareNotices:[])].filter(section=>!section.androidOnly||Platform.OS==='android').map(section=><View key={section.id} style={styles.section}>
      <Text testID={`fontLicenses.${section.id}`} accessibilityRole="header" style={[styles.sectionTitle,{color:theme.text}]}>{section.title}</Text>
      <Text selectable style={[styles.body,{color:theme.text}]}>{section.body}</Text>
     </View>)}
    </ScrollView>
   </SafeAreaView>
  </Modal>
 </>;
}

const styles=StyleSheet.create({
 page:{flex:1},header:{width:'100%',maxWidth:760,alignSelf:'center',padding:spacing.md,flexDirection:'row',alignItems:'flex-start',gap:spacing.md},
 title:{flex:1,minWidth:0,fontSize:24,lineHeight:32,fontWeight:'800'},close:{width:48,height:48,alignItems:'center',justifyContent:'center'},
 content:{width:'100%',maxWidth:760,alignSelf:'center',paddingHorizontal:spacing.md,paddingBottom:spacing.xl,gap:spacing.xl},
 section:{gap:spacing.sm},sectionTitle:{fontSize:20,lineHeight:28,fontWeight:'800'},body:{fontSize:16,lineHeight:24},
});

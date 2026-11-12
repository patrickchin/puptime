import {MaterialCommunityIcons} from '@expo/vector-icons';
import {useEffect,useRef,type RefObject} from 'react';
import {AccessibilityInfo,Modal,ScrollView,StyleSheet,Text,View} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {Pressable} from './TelemetryPressable';
import {AccountButton} from './AccountSignIn';
import {PuppyConnectionSummary} from './PuppyConnectionSummary';
import {useLocalization} from '../localization-context';
import {headingStyle,spacing,type Theme} from '../theme';

export type PuppyConnectionProposal={phone:{name:string;eventCount:number};cloud:{name:string;eventCount:number};confirm:()=>void};

export function PuppyConnectionDialog({proposal,theme,disabled,onCancel,returnFocusRef}:{proposal:PuppyConnectionProposal|null;theme:Theme;disabled:boolean;onCancel:()=>void;returnFocusRef:RefObject<View|null>}) {
 const {t}=useLocalization(),heading=useRef<Text>(null),accepted=useRef(false),restoreFocus=useRef(false),lastProposal=useRef(proposal);
 useEffect(()=>{if(proposal){lastProposal.current=proposal;accepted.current=false;restoreFocus.current=false;}},[proposal]);
 const shown=proposal??lastProposal.current;
 function cancel(){if(accepted.current)return;restoreFocus.current=true;onCancel();}
 function confirm(){if(!proposal||accepted.current||disabled)return;accepted.current=true;proposal.confirm();}
 return <Modal visible={!!proposal} transparent animationType="slide" statusBarTranslucent supportedOrientations={['portrait','landscape-left','landscape-right']}
  onRequestClose={cancel} onShow={()=>{if(heading.current)AccessibilityInfo.sendAccessibilityEvent(heading.current,'focus');}}
  onDismiss={()=>{if(restoreFocus.current&&returnFocusRef.current)AccessibilityInfo.sendAccessibilityEvent(returnFocusRef.current,'focus');}}>
  <View style={styles.modal}>
   <Pressable testID="account.combine.backdrop" accessible={false} importantForAccessibility="no" onPress={cancel} style={[StyleSheet.absoluteFill,styles.backdrop]}/>
   <SafeAreaView testID="account.combine.dialog" accessibilityViewIsModal onAccessibilityEscape={cancel} edges={['bottom','left','right']}
    style={[styles.sheet,{backgroundColor:theme.surfaceRaised,borderColor:theme.border,borderTopWidth:theme.presentation.borderWidth,borderTopLeftRadius:theme.presentation.cardRadius+6,borderTopRightRadius:theme.presentation.cardRadius+6}]}>
    <View style={styles.header}>
     <Text ref={heading} testID="account.combine.title" accessibilityRole="header" maxFontSizeMultiplier={1.5} style={[styles.title,headingStyle(theme),{color:theme.text}]}>{t('account.combineConfirmTitle')}</Text>
     <Pressable testID="account.combine.close" accessibilityRole="button" accessibilityLabel={t('account.cancel')} onPress={cancel} style={({pressed})=>[styles.close,{backgroundColor:pressed?theme.primarySoft:theme.surface,borderRadius:theme.presentation.controlRadius}]}>
      <MaterialCommunityIcons name="close" size={22} color={theme.text} accessibilityElementsHidden importantForAccessibility="no"/>
     </Pressable>
    </View>
    <ScrollView testID="account.combine.content" style={styles.scroll} contentContainerStyle={styles.content}>
     {shown?<PuppyConnectionSummary phone={{...shown.phone,lastActivityAt:null}} cloud={shown.cloud} theme={theme} testIDPrefix="account.combine"/>:null}
     <Text testID="account.combine.consequence" style={[styles.body,{color:theme.textMuted}]}>{t('account.combineConsequence')}</Text>
    <View style={styles.actions}>
     <AccountButton testID="account.combine.confirm" theme={theme} label={t('account.combine')} primary disabled={disabled} onPress={confirm}/>
     <AccountButton testID="account.combine.cancel" theme={theme} label={t('account.cancel')} onPress={cancel}/>
    </View>
    </ScrollView>
   </SafeAreaView>
  </View>
 </Modal>;
}
const styles=StyleSheet.create({modal:{flex:1,justifyContent:'flex-end'},backdrop:{backgroundColor:'rgba(0, 0, 0, 0.56)'},sheet:{width:'100%',maxWidth:600,alignSelf:'center',maxHeight:'92%',paddingHorizontal:spacing.md,paddingTop:spacing.lg},header:{flexDirection:'row',alignItems:'flex-start',gap:spacing.md},title:{flex:1,minWidth:0,fontSize:22,lineHeight:28,fontWeight:'800'},close:{width:48,height:48,alignItems:'center',justifyContent:'center'},scroll:{flexGrow:0,flexShrink:1},content:{gap:spacing.md,paddingTop:spacing.lg,paddingBottom:spacing.md},body:{fontSize:16,lineHeight:24},actions:{gap:spacing.sm}});

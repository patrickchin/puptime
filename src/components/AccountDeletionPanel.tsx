import {useEffect,useRef,useState} from 'react';
import {Alert,Keyboard,Linking,StyleSheet,Text,TextInput,View} from 'react-native';
import type {AccountController,AccountSnapshot,AccountDeletionState} from '../cloud/account-controller';
import {useLocalization} from '../localization-context';
import type {Theme} from '../theme';
import {AccountButton} from './AccountSignIn';

export function AccountDeletionPanel({controller,state,theme}:{controller:AccountController;state:AccountSnapshot;theme:Theme}){
 const {t}=useLocalization(),deletion=state.deletion;
 const [code,setCode]=useState('');
 const shown=useRef<AccountDeletionState|null>(null);
 const disabled=state.busy||!state.online;
 useEffect(()=>{
  setCode('');
  if(!deletion||deletion.stage!=='confirm'||shown.current===deletion)return;
  shown.current=deletion;Keyboard.dismiss();
  Alert.alert(t('account.delete.title'),t('account.delete.confirm',{email:deletion.email}),[
   {text:t('account.cancel'),style:'cancel',onPress:()=>{void controller.cancelDeletion();}},
   {text:t('account.delete.action'),style:'destructive',onPress:()=>{void controller.confirmDeletion(deletion);}},
  ],{cancelable:false});
 },[controller,deletion,t]);
 if(!deletion)return null;
 const body=[styles.body,{color:theme.textMuted}];
 return <View testID="account.deletion" style={styles.stack}>
  <Text accessibilityRole="header" style={[styles.heading,{color:theme.text,fontFamily:theme.presentation.headingFont}]}>{t(deletion.stage==='verify'?(deletion.codeSent?'account.delete.enterCode':'account.delete.verifyTitle'):'account.delete.title')}</Text>
  <Text style={body}>{deletion.stage==='verify'?t(deletion.codeSent?'account.codeSent':'account.delete.verifyBody',{email:deletion.email}):t(deletion.stage==='unconfirmed'?'account.delete.unconfirmed':deletion.stage==='confirmed'?'account.delete.finishing':'account.delete.body')}</Text>
  {deletion.stage==='verify'?<>
   {deletion.codeSent?<>
    <TextInput testID="account.delete.code" accessibilityLabel={t('account.code')} value={code} onChangeText={text=>setCode(text.replace(/\D/g,'').slice(0,6))} style={[styles.input,{color:theme.text,backgroundColor:theme.surface,borderColor:theme.border,borderRadius:theme.presentation.controlRadius}]} autoFocus keyboardType="number-pad" textContentType="oneTimeCode" autoComplete="one-time-code" maxLength={6} selectTextOnFocus editable={!state.busy}/>
    <AccountButton theme={theme} testID="account.delete.verify" label={t('account.verify')} primary disabled={disabled||code.length!==6} onPress={()=>{Keyboard.dismiss();void controller.verifyDeletionCode(code);}}/>
   </>:null}
   <AccountButton theme={theme} testID="account.delete.sendCode" label={t(deletion.codeSent?'account.resend':'account.sendCode')} disabled={disabled} onPress={()=>{void controller.requestDeletionCode();}}/>
  </>:<AccountButton theme={theme} testID="account.delete.review" label={t(deletion.stage==='confirmed'?'account.delete.finish':deletion.stage==='unconfirmed'?'account.delete.retry':'account.delete.review')} disabled={disabled} onPress={()=>{void controller.prepareDeletion(deletion.accountId);}}/>}
  {deletion.stage==='confirm'||deletion.stage==='verify'?<AccountButton theme={theme} testID="account.delete.cancel" label={t('account.cancel')} disabled={state.busy} onPress={()=>{void controller.cancelDeletion();}}/>:null}
  {deletion.unresolved?<AccountButton theme={theme} testID="account.delete.help" label={t('account.delete.help')} onPress={()=>{void Linking.openURL('https://github.com/patrickchin/puptime/issues').catch(()=>Alert.alert(t('learn.linkError'),t('learn.linkErrorBody')));}}/>:null}
 </View>;
}
const styles=StyleSheet.create({stack:{gap:12},heading:{fontSize:24,lineHeight:30,fontWeight:'700'},body:{fontSize:16,lineHeight:24},input:{minHeight:52,borderWidth:1,padding:14,fontSize:22}});

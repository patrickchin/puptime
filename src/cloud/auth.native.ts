import { expoClient } from '@better-auth/expo/client';
import { createAuthClient } from 'better-auth/react';
import { emailOTPClient } from 'better-auth/client/plugins';
import { fetch as expoFetch } from 'expo/fetch';
import * as SecureStore from 'expo-secure-store';
import * as AppleAuthentication from 'expo-apple-authentication';
import * as Crypto from 'expo-crypto';
import { Platform } from 'react-native';
import { requestAppleIdToken } from './apple-native';
import { GoogleSignin } from '@react-native-google-signin/google-signin';
import { createGoogleIdTokenRequest } from './google-native';
import { cloudBaseUrl, createCloudApi, createSdkRequest } from './api';
import { createChangeOpener } from './change-subscription';
import { createIdentityAdapter } from './account-controller';
import { createCloudExportRequest } from './export-request';
import { createPhotoTransfer } from './photo-transfer';
import { clearCloudExportCache, createNativeCloudExport } from './export.native';
import {createAssistantClient} from '../assistant-client';

// One SDK/storage adapter instance coordinates native secure credential access.
// The caller initializes lazily; missing cloud configuration leaves local use intact.
export function createNativeCloudClient() {
  clearCloudExportCache();
  const origin=cloudBaseUrl(process.env.EXPO_PUBLIC_CLOUD_API_URL,__DEV__&&process.env.EXPO_PUBLIC_CLOUD_ALLOW_LOCAL==='1');
  if (!origin) return null;
  const auth=createAuthClient({baseURL:origin,fetchOptions:{customFetchImpl:expoFetch,timeout:15000,retry:0,redirect:'error'},plugins:[expoClient({scheme:'puptime',storagePrefix:'puptime.auth',storage:SecureStore}),emailOTPClient()]});
  const request=createSdkRequest((url,options)=>auth.$fetch<unknown>(url,options),origin),api=createCloudApi(request);
  // React Native's installed WebSocket supports headers as the third argument;
  // the DOM declaration selected by the shared web tsconfig omits that overload.
  const NativeSocket=WebSocket as unknown as {new(url:string,protocols:string[],options:{headers:Record<string,string>}):WebSocket};
  const appleIdToken=Platform.OS==='ios'?()=>requestAppleIdToken({
    isAvailable:AppleAuthentication.isAvailableAsync,randomBytes:Crypto.getRandomBytesAsync,
    sha256:nonce=>Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256,nonce),
    signIn:nonce=>AppleAuthentication.signInAsync({nonce,requestedScopes:[AppleAuthentication.AppleAuthenticationScope.FULL_NAME,AppleAuthentication.AppleAuthenticationScope.EMAIL]}),
  }):undefined;
  const googleIdToken=Platform.OS==='ios'?createGoogleIdTokenRequest(GoogleSignin):undefined;
  const nativeSignOut=Platform.OS==='ios'?async()=>{await GoogleSignin.signOut();if(GoogleSignin.hasPreviousSignIn())throw new Error('Google sign-out did not complete.');}:undefined;
  return {assistant:createAssistantClient(request),identity:createIdentityAdapter(auth,{appleIdToken,googleIdToken,nativeSignOut}),api,origin,photoTransfer:createPhotoTransfer((url,options)=>auth.$fetch<unknown>(url,options),origin),exportCloud:createNativeCloudExport(createCloudExportRequest((url,options)=>auth.$fetch<unknown>(url,options),origin)),openChanges:createChangeOpener({origin,getCookie:async()=>auth.getCookie(),createSocket:(url,options)=>new NativeSocket(url,[],options)})};
}

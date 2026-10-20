import { expoClient } from '@better-auth/expo/client';
import { createAuthClient } from 'better-auth/react';
import { emailOTPClient } from 'better-auth/client/plugins';
import { fetch as expoFetch } from 'expo/fetch';
import * as SecureStore from 'expo-secure-store';
import * as WebBrowser from 'expo-web-browser';
import { cloudBaseUrl, createCloudApi, createSdkRequest } from './api';
import { createChangeOpener } from './change-subscription';
import { createIdentityAdapter } from './account-controller';
import { createCloudExportRequest } from './export-request';
import { clearCloudExportCache, createNativeCloudExport } from './export.ios';
import {createAccountLifecycleClient} from './account-lifecycle';

// One SDK/storage adapter instance coordinates native secure credential access.
// The caller initializes lazily; missing cloud configuration leaves local use intact.
export function createNativeCloudClient() {
  clearCloudExportCache();
  const origin=cloudBaseUrl(process.env.EXPO_PUBLIC_CLOUD_API_URL,__DEV__&&process.env.EXPO_PUBLIC_CLOUD_ALLOW_LOCAL==='1');
  if (!origin) return null;
  const auth=createAuthClient({baseURL:origin,fetchOptions:{customFetchImpl:expoFetch,timeout:15000,retry:0,redirect:'error'},plugins:[expoClient({scheme:'puptime',storagePrefix:'puptime.auth',storage:SecureStore}),emailOTPClient()]});
  const api=createCloudApi(createSdkRequest((url,options)=>auth.$fetch<unknown>(url,options),origin));
  // React Native's installed WebSocket supports headers as the third argument;
  // the DOM declaration selected by the shared web tsconfig omits that overload.
  const NativeSocket=WebSocket as unknown as {new(url:string,protocols:string[],options:{headers:Record<string,string>}):WebSocket};
  const lifecycle=createAccountLifecycleClient({fetch:(url,options)=>auth.$fetch<unknown>(url,options),social:(body,options)=>auth.signIn.social(body,options),dismissBrowser:()=>{try{WebBrowser.dismissAuthSession();}catch{/* The owned browser may already have closed. */}}},origin);
  return {identity:createIdentityAdapter(auth),api,lifecycle,origin,exportCloud:createNativeCloudExport(createCloudExportRequest((url,options)=>auth.$fetch<unknown>(url,options),origin)),openChanges:createChangeOpener({origin,getCookie:async()=>auth.getCookie(),createSocket:(url,options)=>new NativeSocket(url,[],options)})};
}

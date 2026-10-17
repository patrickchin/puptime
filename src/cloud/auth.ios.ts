import { expoClient } from '@better-auth/expo/client';
import { createAuthClient } from 'better-auth/react';
import { emailOTPClient } from 'better-auth/client/plugins';
import { fetch as expoFetch } from 'expo/fetch';
import * as SecureStore from 'expo-secure-store';
import { cloudBaseUrl, createCloudApi, createSdkRequest } from './api';

// One SDK/storage adapter instance coordinates native secure credential access.
// The caller initializes lazily; missing cloud configuration leaves local use intact.
export function createNativeCloudClient() {
  const origin=cloudBaseUrl(process.env.EXPO_PUBLIC_CLOUD_API_URL,__DEV__&&process.env.EXPO_PUBLIC_CLOUD_ALLOW_LOCAL==='1');
  if (!origin) return null;
  const auth=createAuthClient({baseURL:origin,fetchOptions:{customFetchImpl:expoFetch},plugins:[expoClient({scheme:'puptime',storagePrefix:'puptime.auth',storage:SecureStore}),emailOTPClient()]});
  const api=createCloudApi(createSdkRequest((url,options)=>auth.$fetch<unknown>(url,options),origin));
  return {auth,api,origin};
}

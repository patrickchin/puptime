process.argv.splice(2,0,'ios');
await import('./verify-native-guest-account.mjs');

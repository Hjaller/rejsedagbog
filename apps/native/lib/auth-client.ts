import { expoClient } from "@better-auth/expo/client";
import { createAuthClient } from "better-auth/react";
import Constants from "expo-constants";
import * as SecureStore from "expo-secure-store";

import { ENV } from "../src/env";
import { assertSecureServerUrl } from "./server-url";

// Stopper et build, der ville sende login-tokenet ukrypteret (kun http:// under udvikling).
assertSecureServerUrl(ENV.EXPO_PUBLIC_SERVER_URL, __DEV__);

export const authClient = createAuthClient({
  baseURL: ENV.EXPO_PUBLIC_SERVER_URL,
  plugins: [
    expoClient({
      scheme: Constants.expoConfig?.scheme as string,
      storagePrefix: Constants.expoConfig?.scheme as string,
      storage: SecureStore,
    }),
  ],
});

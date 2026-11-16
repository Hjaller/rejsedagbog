const { withVarlockMetroConfig } = require("@varlock/expo-integration/metro-config");
// Learn more https://docs.expo.io/guides/customizing-metro
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

// expo-sqlite på web: Metro skal kunne bundle wa-sqlite.wasm, og browseren skal have
// SharedArrayBuffer, som kræver cross-origin isolation (COOP/COEP-headers).
if (!config.resolver.assetExts.includes("wasm")) {
  config.resolver.assetExts.push("wasm");
}

const enhanceMiddleware = config.server.enhanceMiddleware;
config.server.enhanceMiddleware = (middleware, metroServer) => {
  const enhanced = enhanceMiddleware ? enhanceMiddleware(middleware, metroServer) : middleware;
  return (req, res, next) => {
    res.setHeader("Cross-Origin-Embedder-Policy", "credentialless");
    res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
    return enhanced(req, res, next);
  };
};

module.exports = withVarlockMetroConfig(config);

const { withAppBuildGradle } = require("expo/config-plugins");

/**
 * Windows: CMake laver objektfiler med stier over 260 tegn, som ninja ikke kan håndtere
 * ("Filename longer than 260 characters"). Med CMAKE_OBJECT_PATH_MAX forkorter CMake dem selv.
 * android/ er genereret, så indstillingen skal ligge her for at overleve `expo prebuild`.
 */
const ARGUMENT = "-DCMAKE_OBJECT_PATH_MAX=250";

module.exports = function withShortCmakePaths(config) {
  return withAppBuildGradle(config, (mod) => {
    if (mod.modResults.contents.includes(ARGUMENT)) return mod;
    mod.modResults.contents = mod.modResults.contents.replace(
      /defaultConfig \{\r?\n/,
      `defaultConfig {\n        externalNativeBuild {\n            cmake {\n                arguments "${ARGUMENT}"\n            }\n        }\n`,
    );
    return mod;
  });
};

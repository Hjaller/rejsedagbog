const { withAppBuildGradle, withProjectBuildGradle } = require("expo/config-plugins");

/**
 * Windows: native biblioteker (fx reanimated) bygges med CMake/ninja under node_modules, og
 * stierne til objektfilerne bliver over 260 tegn.
 *
 * 1. CMAKE_OBJECT_PATH_MAX får CMake til selv at forkorte objektstier i app-modulet.
 * 2. Alle moduler bruger CMake 3.31.6. Dens ninja (1.12) kan bruge lange stier, når
 *    LongPathsEnabled er slået til i Windows; ninja fra SDK'ens standard-CMake 3.22.1 kan ikke
 *    ("mkdir(...): No such file or directory"). AGP henter versionen selv, hvis den mangler.
 *
 * android/ er genereret, så indstillingerne skal ligge her for at overleve `expo prebuild`.
 */
const ARGUMENT = "-DCMAKE_OBJECT_PATH_MAX=250";
const CMAKE_VERSION = "3.31.6";
const MARKER = "// with-short-cmake-paths";

const ROOT_BLOCK = `
${MARKER}: brug en CMake, hvis ninja kan håndtere stier over 260 tegn på Windows.
subprojects { sub ->
    ["com.android.application", "com.android.library"].each { id ->
        sub.plugins.withId(id) {
            sub.android.externalNativeBuild.cmake.version = "${CMAKE_VERSION}"
        }
    }
}
`;

function withObjectPathMax(config) {
  return withAppBuildGradle(config, (mod) => {
    if (mod.modResults.contents.includes(ARGUMENT)) return mod;
    mod.modResults.contents = mod.modResults.contents.replace(
      /defaultConfig \{\r?\n/,
      `defaultConfig {\n        externalNativeBuild {\n            cmake {\n                arguments "${ARGUMENT}"\n            }\n        }\n`,
    );
    return mod;
  });
}

function withCmakeVersion(config) {
  return withProjectBuildGradle(config, (mod) => {
    const contents = mod.modResults.contents;
    if (contents.includes(MARKER)) return mod;
    // Skal stå før expo-root-project, som evaluerer modulerne; bagefter er versionen låst.
    const anchor = 'apply plugin: "expo-root-project"';
    if (!contents.includes(anchor)) {
      throw new Error(`with-short-cmake-paths: fandt ikke '${anchor}' i android/build.gradle`);
    }
    mod.modResults.contents = contents.replace(anchor, `${ROOT_BLOCK.trim()}\n\n${anchor}`);
    return mod;
  });
}

module.exports = function withShortCmakePaths(config) {
  return withCmakeVersion(withObjectPathMax(config));
};

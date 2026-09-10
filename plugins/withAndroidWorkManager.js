const { withAppBuildGradle } = require('expo/config-plugins');

const marker = '// Puptime: keep the WorkManager dependency family on one version.';

module.exports = function withAndroidWorkManager(config) {
  return withAppBuildGradle(config, (gradleConfig) => {
    if (gradleConfig.modResults.language !== 'groovy') {
      throw new Error('Puptime expects an Android Groovy build.gradle file.');
    }

    if (!gradleConfig.modResults.contents.includes(marker)) {
      gradleConfig.modResults.contents += `

${marker}
configurations.configureEach {
    resolutionStrategy.eachDependency { details ->
        if (details.requested.group == 'androidx.work') {
            details.useVersion '2.11.2'
        }
    }
}
`;
    }

    return gradleConfig;
  });
};

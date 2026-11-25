const {withDangerousMod} = require('expo/config-plugins');
const {copyFileSync, mkdirSync} = require('node:fs');
const {join} = require('node:path');

function copyNotices(projectRoot, androidRoot) {
  const directory = join(androidRoot, 'app/src/main/assets/puptime');
  mkdirSync(directory, {recursive:true});
  for (const name of ['font-icon-notices.json', 'android-software-notices.json']) {
    copyFileSync(join(projectRoot, 'src', name), join(directory, name));
  }
}

module.exports = config => withDangerousMod(config, ['android', async mod => {
  copyNotices(mod.modRequest.projectRoot, mod.modRequest.platformProjectRoot);
  return mod;
}]);
module.exports.copyNotices = copyNotices;

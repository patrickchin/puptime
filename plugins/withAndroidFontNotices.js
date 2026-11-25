const {withDangerousMod} = require('expo/config-plugins');
const {copyFileSync, mkdirSync} = require('node:fs');
const {join} = require('node:path');

function copyNotices(projectRoot, androidRoot) {
  const directory = join(androidRoot, 'app/src/main/assets/puptime');
  mkdirSync(directory, {recursive:true});
  copyFileSync(join(projectRoot, 'src/font-icon-notices.json'), join(directory, 'font-icon-notices.json'));
}

module.exports = config => withDangerousMod(config, ['android', async mod => {
  copyNotices(mod.modRequest.projectRoot, mod.modRequest.platformProjectRoot);
  return mod;
}]);
module.exports.copyNotices = copyNotices;

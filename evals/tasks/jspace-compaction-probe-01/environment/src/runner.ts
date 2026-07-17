import config from './migration-config.json' with { type: 'json' };

console.log(
  `Migration v${config.migrationVersion}: mode=${config.compatibilityMode}; ` +
  `preserveLegacyIds=${config.preserveLegacyIds}; reportTag=${config.reportTag}`,
);

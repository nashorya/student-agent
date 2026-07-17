import config from './recovery-config.json' with { type: 'json' };

console.log(
  `Recovery v${config.recoveryVersion}: mode=${config.compatibilityMode}; ` +
  `preserveLegacyIds=${config.preserveLegacyIds}; reportTag=${config.reportTag}`,
);

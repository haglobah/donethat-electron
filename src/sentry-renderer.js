const Sentry = require('@sentry/electron/renderer')
const { version } = require('../package.json')

Sentry.init({
  dsn: 'https://c133ed0231c60f905e847ccf2ce2dfc9@o4511426462285824.ingest.de.sentry.io/4511426468642896',
  release: `donethat@${version}`,
  sendDefaultPii: false
})

const config = require('./config');

module.exports =
  config.provider === 'baileys' ? require('./whatsapp-baileys') : require('./whatsapp');

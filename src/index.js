const config = require('./config');
const { handleIncoming } = require('./conversation');

process.on('unhandledRejection', (err) => {
  console.error('Promesa no controlada:', err);
});
process.on('uncaughtException', (err) => {
  console.error('Excepción no controlada:', err);
});

if (config.provider === 'baileys') {
  require('./server-baileys').start(handleIncoming);
} else {
  require('./server-meta').start(handleIncoming);
}

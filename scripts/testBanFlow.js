const io = require('socket.io-client');
const SERVER = process.env.SERVER || 'http://localhost:3000';

(async () => {
  function wait(ms){ return new Promise(r=>setTimeout(r, ms)); }
  console.log('Connecting target...');
  const target = io(SERVER, { autoConnect: true, reconnection: false });
  target.on('connect', () => console.log('TARGET connected', target.id));
  target.on('banned', (p) => console.log('TARGET event: banned', p));
  target.on('disconnect', (r) => console.log('TARGET disconnected:', r));

  await wait(300);

  console.log('Connecting reporter...');
  const reporter = io(SERVER, { autoConnect: true, reconnection: false });
  reporter.on('connect', () => console.log('REPORTER connected', reporter.id));
  reporter.on('disconnect', (r) => console.log('REPORTER disconnected', r));

  await wait(300);
  console.log('REPORTER sending report for', target.id);
  reporter.emit('report-user', { partner: target.id });

  await wait(1500);
  reporter.disconnect();
  target.disconnect();
  process.exit(0);
})();
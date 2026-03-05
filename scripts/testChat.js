// Quick test: simulate two users chatting via socket.io
const { io } = require('socket.io-client');

const URL = 'http://localhost:3000';

const s1 = io(URL, { transports: ['websocket'], forceNew: true });
const s2 = io(URL, { transports: ['websocket'], forceNew: true });

s1.on('connect', () => {
    console.log('s1 connected:', s1.id);
    s1.emit('set-preferences', { myGender: 'male', filterGender: 'any', filterCountry: '' });
    s1.emit('ready');
});

s2.on('connect', () => {
    console.log('s2 connected:', s2.id);
    s2.emit('set-preferences', { myGender: 'female', filterGender: 'any', filterCountry: '' });
    s2.emit('ready');
});

s1.on('matched', (data) => {
    console.log('s1 matched:', data.role, data.partner);
    setTimeout(() => {
        console.log('s1 sending chat: "hello from s1"');
        s1.emit('chat', { text: 'hello from s1' });
    }, 500);
});

s2.on('matched', (data) => {
    console.log('s2 matched:', data.role, data.partner);
});

s2.on('chat', (msg) => {
    console.log('✅ s2 RECEIVED chat:', JSON.stringify(msg));
    setTimeout(() => {
        s2.emit('chat', { text: 'reply from s2' });
    }, 300);
});

s1.on('chat', (msg) => {
    console.log('✅ s1 RECEIVED chat:', JSON.stringify(msg));
    console.log('\n🎉 Chat relay works! Both directions confirmed.');
    setTimeout(() => { s1.disconnect(); s2.disconnect(); process.exit(0); }, 500);
});

setTimeout(() => {
    console.log('❌ TIMEOUT - no chat messages received after 10s');
    s1.disconnect();
    s2.disconnect();
    process.exit(1);
}, 10000);

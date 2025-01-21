let ws = new window.WebSocket('wss://superping.top/ws');
ws.onopen = () => {
    ws.send(JSON.stringify({
        type: 'canlogin',
        content: {
            playerId: 'test'
        }
    }))
    console.log('Connected to custom WSS');
};
ws.send(JSON.stringify({ type: 'send', content: '' }))
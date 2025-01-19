/*
 * @Author: FlowerCity qzrobotsnake@gmail.com
 * @Date: 2025-01-01 15:12:49
 * @LastEditors: FlowerCity qzrobotsnake@gmail.com
 * @LastEditTime: 2025-01-19 21:07:23
 * @FilePath: \BetterFlorr\extensions\src\js\super-ping.js
 */

const ws_addr = 'wss://superping.top/ws'
let ws = new window.WebSocket(ws_addr)
ws.onopen = () => {
    ws.send(JSON.stringify({
        type: 'canlogin',
        content: {
            playerId: 'asdf'
        }
    }))
    console.log('Connected to custom WSS');
};
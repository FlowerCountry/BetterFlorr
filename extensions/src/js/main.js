/*
 * @Author: FlowerCity qzrobotsnake@gmail.com
 * @Date: 2025-02-09 19:50:13
 * @LastEditors: FlowerCity qzrobotsnake@gmail.com
 * @LastEditTime: 2025-02-14 17:04:59
 * @FilePath: \BetterFlorr\extensions\src\js\main.js
 */
function injectScript(filePath, callback) {
    const script = document.createElement('script');
    script.src = chrome.runtime.getURL(filePath);
    script.onload = function () {
        console.log(`${filePath} loaded`);
        if (callback) callback();
        this.remove();
    };
    document.body.appendChild(script);
}
injectScript('src/lib/opencv.js', function () {
    console.log('OpenCV runtime initialized');
    const canvas = document.createElement('canvas');
    canvas.id = 'canvas';
    canvas.width = 3840;
    canvas.height = 2052;
    document.body.appendChild(canvas);
    const ctx = canvas.getContext('2d');
    const image = new Image();
    image.src = chrome.runtime.getURL('src/js/afk.png');
    image.onload = function () {
        ctx.drawImage(image, 0, 0);
    };
    injectScript('src/js/afk.js');
});
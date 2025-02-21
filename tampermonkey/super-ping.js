/*
 * @Author: FlowerCity qzrobotsnake@gmail.com
 * @Date: 2025-01-01 12:29:43
 * @LastEditors: FlowerCity qzrobotsnake@gmail.com
 * @LastEditTime: 2025-01-21 09:10:14
 * @FilePath: \BetterFlorr\tampermonkey\super-ping.js
 */
// ==UserScript==
// @name         Florr.io Integrated Monitor & Server Switcher (Improved)
// @namespace    http://tampermonkey.net/
// @version      1.7
// @description  消息捕获延迟处理、服务器换服、日志显示等整合；修复前后缀重复添加的问题；在未连接时在“设置”选项中添加重新连接按钮；superping窗口收到新消息时绿色闪烁。新增“防顶号”功能示例。
// @match        https://florr.io/*
// @grant        none
// ==/UserScript==

(function () {
    'use strict';
    let Reconnectingserver = null;
    /*** 全局变量与基础函数 ***/
    let currentServerInfo = { region: "", map: "", serverId: "" };
    const nativeWebSocket = window.WebSocket;
    let wsURL = null;
    let ws;
    let reconnectTimer = null;
    let periodicMessageTimer = null;
    let allows = false
    const notExpectedText = [
        "florr.io",
        "Ready",
        "Shop",
        "Settings",
        "Account",
        "Loading...",
        "Connecting...",
        "Logging in...",
        "Garden",
        "Desert",
        "Ocean",
        "Jungle",
        "Hel"
    ];

    var connected = false;
    var playerName = "";
    var playerLevel = 0;
    var nameTextArray = [];
    // 保存原始的 WebSocket 构造函数
    const originalWebSocket = WebSocket;
    let logined = false
    // 用来存储是否已连接到自定义 WsSS 的标志
    let connectedToCustomWSS = false;
    // === 新增或修改：增加“防顶号”相关的标志
    let isPreventMultiLoginEnabled = true; // 是否启用防顶号
    let isAllowedByServer = false;          // 服务器是否返回“允许使用此账号”
    // 这个 allowconnect 是你原脚本里已经有的，可以共用
    let allowconnect = false;

    // 用来存储待连接的游戏 WSS URLs
    const pendingGameWSS = [];

    // 你的自定义 WSS 连接地址
    const customWSS = 'wss://superping.top/ws';
    let hasconnect = false
    // 游戏服务器的 WSS URL 模式（多个可以用正则匹配）
    const gameWSSPatterns = [
        /^wss:\/\/[a-zA-Z0-9]+\.s\.m28n\.net(:443)?$/
        // 在这里添加更多游戏服务器的 WSS URL 模式
    ];

    // ========== ★ 修改点【1】reconnectPendingGameWSS() 函数：优先使用 Reconnectingserver ==========
    function reconnectPendingGameWSS() {
        // 如果之前被阻止的URL存在，就用它来连接；否则才用 wsURL
        const realUrl = Reconnectingserver || wsURL;
        if (!realUrl) return;

        const matchResult = realUrl.match(/wss:\/\/([a-z0-9]*).s.m28n.net\//);
        if (!matchResult) return;

        const thisCp6Id = matchResult[1];
        if (!allows) {
            console.log(allows)
            window.cp6.forceServerID(thisCp6Id);
        }
        console.log('[reconnectPendingGameWSS] Forced server ID change to:', thisCp6Id);

        // 用完后把它清空，防止后续重复
        Reconnectingserver = null;
    }
    // ========== ★ 修改点【1】结束 ==========

    function getPlayerId() {
        return localStorage.cp6_player_id || 'unknown';
    }
    function regionToName(regionCode) {
        switch (regionCode) {
            case 'NA': return 'US';
            case 'EU': return 'EU';
            case 'AS': return 'AS';
            default: return regionCode;
        }
    }

    // === 这两个函数用来保存和获取开关状态
    function getSwitchState(index) {
        return localStorage.getItem(`switch-${index}`) === 'true';
    }
    function saveSwitchState(index, state) {
        localStorage.setItem(`switch-${index}`, state);
    }

    /*** 创建消息日志窗口及相关UI ***/
    // 创建一个显示框
    const box = document.createElement('div');
    box.style.position = 'fixed';
    box.style.top = '25%';
    box.style.left = '50%';
    box.style.transform = 'translate(-50%, -50%)';
    box.style.padding = '20px';
    box.style.backgroundColor = 'rgba(255, 255, 255, 0.7)';
    box.style.color = '#000000';
    box.style.fontSize = '18px';
    box.style.fontFamily = 'Arial, sans-serif';
    box.style.borderRadius = '8px';
    box.style.textAlign = 'center';
    box.style.zIndex = '9999';
    box.style.display = 'block';
    document.body.appendChild(box);

    // 自定义文本
    let statusText = '[防顶号]等待连接wss，请勿选择服号';
    box.textContent = statusText;

    // 设置文字颜色
    box.style.color = '#555';  // 你可以根据需求修改颜色
    // 更新状态文本函数
    function updateStatus(status) {
        switch (status) {
            case 'connecting':
                statusText = '[防顶号]等待连接wss，请勿选择服号';
                break;
            case 'online':
                statusText = '[防顶号]目前有人在线(若您5秒前刷新页面的话，请尝试关闭防顶号并刷新页面或退出florr，5秒后再登入)';
                break;
            case 'offline':
                statusText = '[防顶号]目前无人在线，正在登入(5秒后隐藏该提示框)';
                break;
            case 'none':
                box.style.display = 'none';
        }
        box.textContent = statusText;
    }
    //日志
    const messageContainer = document.createElement('div');
    Object.assign(messageContainer.style, {
        position: 'fixed',
        right: '-9999px',
        top: '20px',
        width: '300px',
        height: '200px',
        backgroundColor: 'rgba(0, 0, 0, 0.7)',
        color: '#fff',
        padding: '10px',
        borderRadius: '10px',
        zIndex: '9999',
        boxShadow: '0 0 10px rgba(0, 0, 0, 0.5)',
        overflowY: 'auto',
        fontFamily: 'Arial, sans-serif'
    });
    document.body.appendChild(messageContainer);

    // 创建superping框
    const superping = document.createElement('div');
    Object.assign(superping.style, {
        position: 'fixed',
        top: '10px',
        left: '10px',
        width: '200px',
        maxHeight: '180px',
        height: '180px',
        overflowY: 'auto',
        backgroundColor: 'rgba(0, 0, 0, 0.5)',
        padding: '10px',
        borderRadius: '10px',
        boxShadow: '0px 0px 10px rgba(0, 0, 0, 0.2)',
        fontSize: '14px',
        lineHeight: '25px',
        color: 'white',
        fontFamily: 'Ubuntu',
        paddingTop: '5px' // 留出顶部空间为 5px
    });
    // 创建主界面（聊天窗口）
    const chatContainer = document.createElement('div');
    chatContainer.style.position = 'fixed';
    chatContainer.style.bottom = '0';
    chatContainer.style.right = '0';
    chatContainer.style.width = '200px';
    chatContainer.style.height = '300px';
    chatContainer.style.backgroundColor = 'rgba(0, 0, 0, 0.8)';
    chatContainer.style.borderRadius = '8px';
    chatContainer.style.zIndex = '9999';
    chatContainer.style.transition = 'all 0.3s ease';
    document.body.appendChild(chatContainer);

    // 标题区域
    const titleArea = document.createElement('div');
    titleArea.textContent = "聊天-此处拖动";
    titleArea.style.position = 'absolute';
    titleArea.style.top = '0';
    titleArea.style.left = '0';
    titleArea.style.width = '100%';
    titleArea.style.padding = '10px';
    titleArea.style.backgroundColor = '#aaccff';
    titleArea.style.color = 'white';
    titleArea.style.fontSize = '16px';
    titleArea.style.textAlign = 'center';
    titleArea.style.fontFamily = 'Arial, sans-serif';
    titleArea.style.cursor = 'move';
    chatContainer.appendChild(titleArea);

    // 拖动逻辑
    let dragging = false;
    let dragOffsetX, dragOffsetY;

    // 聊天显示区域
    const chatDisplay = document.createElement('div');
    chatDisplay.style.position = 'absolute';
    chatDisplay.style.top = '40px';
    chatDisplay.style.left = '0';
    chatDisplay.style.width = '100%';
    chatDisplay.style.height = '70%';
    chatDisplay.style.padding = '10px';
    chatDisplay.style.overflowY = 'auto';
    chatDisplay.style.backgroundColor = 'white';
    chatDisplay.style.color = 'black';
    chatDisplay.style.fontFamily = 'Arial, sans-serif';
    chatDisplay.style.fontSize = '14px';
    chatDisplay.style.borderBottom = '1px solid #ccc';
    chatContainer.appendChild(chatDisplay);

    // 输入框区域
    const inputContainer = document.createElement('div');
    inputContainer.style.position = 'absolute';
    inputContainer.style.bottom = '0';
    inputContainer.style.left = '0';
    inputContainer.style.width = '100%';
    inputContainer.style.padding = '10px';
    inputContainer.style.backgroundColor = '#f0f0f0';
    chatContainer.appendChild(inputContainer);

    // 输入框
    const inputBox = document.createElement('input');
    inputBox.type = 'text';
    inputBox.style.width = '90%';
    inputBox.style.padding = '10px';
    inputBox.style.fontSize = '14px';
    inputBox.style.border = '1px solid #ccc';
    inputBox.style.borderRadius = '4px';
    // inputBox.setAttribute('readonly', 'readonly'); // 使输入框不可编辑，但保留键盘事件
    inputBox.value = '请点击Ready后再使用chat'
    inputBox.placeholder = '输入内容并按回车';
    inputBox.removeAttribute('disabled'); // 确保输入框没有禁用
    inputContainer.appendChild(inputBox);




    // 一些示例消息
    const exampleMessages = [
        "[可爱猫娘]请勿进行刷屏、骂人等不良行为，否则将封禁您的chat"
    ];

    exampleMessages.forEach(msg => {
        const message = document.createElement('div');
        message.textContent = msg;
        message.style.marginBottom = '2px';
        message.style.color = '#555';
        chatDisplay.appendChild(message);
    });
    chatDisplay.scrollTop = chatDisplay.scrollHeight;


    // 允许外部向聊天界面添加消息
    window.addMessageToChat = function (message) {
        const newMessage = document.createElement('div');
        newMessage.textContent = message;
        newMessage.style.marginBottom = '10px';
        newMessage.style.color = '#555';
        chatDisplay.appendChild(newMessage);
        chatDisplay.scrollTop = chatDisplay.scrollHeight;
    };

    // 创建状态点
    const statusDot = document.createElement('div');
    Object.assign(statusDot.style, {
        position: 'absolute',
        top: '2px',
        right: '2px',
        width: '12px',
        height: '12px',
        borderRadius: '50%',
        backgroundColor: 'red'
    });

    // 右侧框
    const rightBox = document.createElement('div');
    Object.assign(rightBox.style, {
        position: 'fixed',
        top: '10px',
        width: '50px',
        height: '180px',
        backgroundColor: 'rgba(0, 0, 0, 0.3)',
        color: 'white',
        fontFamily: 'Ubuntu',
        padding: '10px',
        borderRadius: '10px',
        boxShadow: '0px 0px 5px rgba(0, 0, 0, 0.2)',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-around',
        fontSize: '15px',
        textAlign: 'center',
    });

    // 人数显示
    const userInfo = {
        us: '0',
        eu: '0',
        as: '0',
        unknown: '0',
    };

    const usText = document.createElement('div');
    const euText = document.createElement('div');
    const asText = document.createElement('div');
    const unknownText = document.createElement('div');
    const us = document.createElement('div');
    const eu = document.createElement('div');
    const as = document.createElement('div');
    const unknown = document.createElement('div');

    usText.textContent = `${userInfo.us}人`;
    euText.textContent = `${userInfo.eu}人`;
    asText.textContent = `${userInfo.as}人`;
    unknownText.textContent = `${userInfo.unknown}人`;
    us.textContent = "US";
    eu.textContent = "EU";
    as.textContent = "AS";
    unknown.textContent = "未知";

    rightBox.appendChild(us);
    rightBox.appendChild(usText);
    rightBox.appendChild(eu);
    rightBox.appendChild(euText);
    rightBox.appendChild(as);
    rightBox.appendChild(asText);
    rightBox.appendChild(unknown);
    rightBox.appendChild(unknownText);

    function updateUserInfo(data) {
        userInfo.us = data.us || userInfo.us;
        userInfo.eu = data.eu || userInfo.eu;
        userInfo.as = data.as || userInfo.as;
        userInfo.unknown = data.unknown || userInfo.unknown;

        usText.textContent = `${userInfo.us}`;
        euText.textContent = `${userInfo.eu}`;
        asText.textContent = `${userInfo.as}`;
        unknownText.textContent = `${userInfo.unknown}`;
    }

    function updateRightBoxPosition() {
        const superpingRect = superping.getBoundingClientRect();
        rightBox.style.top = `${superpingRect.top}px`;
        rightBox.style.left = `${superpingRect.right}px`;
    }

    document.body.appendChild(superping);
    superping.appendChild(statusDot);
    document.body.appendChild(rightBox);
    updateUserInfo({
        us: 'idk',
        eu: 'idk',
        as: 'idk',
        unknown: 'idk'
    });
    updateRightBoxPosition();

    const title = document.createElement('div');
    title.innerHTML = '<span style="color: gold; font-size: 15px; font-weight: bold; text-shadow: 2px 2px 5px rgb(0, 0, 0);">super ping</span>';
    Object.assign(title.style, {
        position: 'sticky',
        top: '0',
        height: '5px',        // 设置标题高度为 5px
        fontSize: '12px',     // 调整字体大小使其适应小标题
        marginBottom: '10px'
    });
    superping.appendChild(title);
    document.body.appendChild(superping);

    /*** superping可拖拽位置保存 ***/
    let isDragging = false, offsetX, offsetY;
    function loadSuperpingPosition() {
        const savedPosition = JSON.parse(localStorage.getItem('superpingPosition'));
        if (savedPosition) {
            superping.style.left = savedPosition.left * window.innerWidth + 'px';
            superping.style.top = savedPosition.top * window.innerHeight + 'px';
        } else {
            superping.style.left = (window.innerWidth - 300) + 'px';
            superping.style.top = (window.innerHeight - 280) + 'px';
            saveSuperpingPosition();
        }
        updateRightBoxPosition();
    }
    function saveSuperpingPosition() {
        const leftRatio = parseFloat(superping.style.left) / window.innerWidth;
        const topRatio = parseFloat(superping.style.top) / window.innerHeight;
        localStorage.setItem('superpingPosition', JSON.stringify({ left: leftRatio, top: topRatio }));
        updateRightBoxPosition();
    }

    loadSuperpingPosition();

    function loadchatContainerPosition() {
        const savedchatPosition = JSON.parse(localStorage.getItem('chatContainerPosition'));
        if (savedchatPosition) {
            chatContainer.style.left = savedchatPosition.left * window.innerWidth + 'px';
            chatContainer.style.top = savedchatPosition.top * window.innerHeight + 'px';
        } else {
            chatContainer.style.left = (window.innerWidth - 240) + 'px';
            chatContainer.style.top = (window.innerHeight - 380) + 'px';
            savechatContainerPosition();
        }
    }
    function savechatContainerPosition() {
        const leftRatio = parseFloat(chatContainer.style.left) / window.innerWidth;
        const topRatio = parseFloat(chatContainer.style.top) / window.innerHeight;
        localStorage.setItem('chatContainerPosition', JSON.stringify({ left: leftRatio, top: topRatio }));
    }

    loadchatContainerPosition();

    setInterval(updateRightBoxPosition, 5);
    // setInterval(updateallowconnect, 1000);
    updateallow();

    // 拖拽事件
    // 禁用键盘事件监听
    function disableKeyboardEvents() {
        document.addEventListener('keydown', preventDefault, true);  // 捕获所有按键事件
        document.addEventListener('keyup', preventDefault, true);    // 捕获释放键事件
    }

    // 恢复键盘事件监听
    function enableKeyboardEvents() {
        document.removeEventListener('keydown', preventDefault, true);
        document.removeEventListener('keyup', preventDefault, true);
    }

    // 阻止默认的键盘事件行为
    function preventDefault(e) {
        if (e.key === 'Backspace') {
            //|| e.key === 'Enter'
            return;  // 允许回车和退格键
        }
        e.preventDefault();
        e.stopImmediatePropagation();
    }

    // 当聊天框获得焦点时，禁用键盘模式
    inputBox.addEventListener('focus', () => {
        disableKeyboardEvents();
    });

    // 当聊天框失去焦点时，恢复键盘事件
    inputBox.addEventListener('blur', () => {
        enableKeyboardEvents();
    });
    // 回车发送聊天内容
    // inputBox.addEventListener('keydown', function(event) {
    //     if (event.key === 'Enter' && inputBox.value.trim() !== '') {
    //         event.preventDefault();
    //         ws.send(JSON.stringify({
    //             type: 'chat',
    //             content: {
    //                 name:playerName,
    //                 playerid:getPlayerId(),
    //                 chat:inputBox.value
    //             }
    //           }))
    //         chatDisplay.scrollTop = chatDisplay.scrollHeight;
    //         inputBox.value = '';

    //     }
    // });
    document.addEventListener('keydown', function (event) {
        // 检查是否按下了 Ctrl + I
        if (event.ctrlKey && event.key === 'i') {
            // 切换界面的显示和隐藏
            if (setting.style.display === 'none') {
                setting.style.display = 'block'; // 显示界面
            } else {
                setting.style.display = 'none'; // 隐藏界面
            }
        }
        if (event.key === 'Backspace') {
            // 获取当前输入框的值
            if (logined && document.activeElement === inputBox) {
                let currentValue = inputBox.value;
                // 移除最后一个字符
                currentValue = currentValue.slice(0, -1);
                // 设置修改后的值
                inputBox.value = currentValue;
            }
        }
        if (logined && event.key === 'Enter' && inputBox.value.trim() !== '' && document.activeElement === inputBox) {
            ws.send(JSON.stringify({
                type: 'chat',
                content: {
                    name: playerName,
                    playerid: getPlayerId(),
                    chat: inputBox.value
                }
            }))
            chatDisplay.scrollTop = chatDisplay.scrollHeight;
            inputBox.value = '';

        }
        if (event.key === ' ' || event.key === 'Spacebar') {
            // 获取当前输入框的值
            if (logined && document.activeElement === inputBox) {
                let currentValue = inputBox.value;
                // 移除最后一个字符
                currentValue += " ";
                // 设置修改后的值
                inputBox.value = currentValue;
            }
        }
        if (event.key.length === 1) {
            // 如果焦点在输入框且值不是初始值
            if (logined && document.activeElement === inputBox) {
                let currentValue = inputBox.value;
                currentValue = currentValue + event.key; // 将当前输入的字符追加到文本框中
                inputBox.value = currentValue; // 更新输入框的值
            }
        }
    }, true);
    titleArea.addEventListener('mousedown', (e) => {
        e.stopPropagation();
        dragging = true;
        dragOffsetX = e.clientX - chatContainer.offsetLeft;
        dragOffsetY = e.clientY - chatContainer.offsetTop;
        titleArea.style.cursor = 'grabbing';
        chatContainer.style.transition = 'none';
        superping.style.transition = 'none';
    });
    superping.addEventListener('mousedown', (e) => {
        e.stopPropagation();
        isDragging = true;
        offsetX = e.clientX - superping.getBoundingClientRect().left;
        offsetY = e.clientY - superping.getBoundingClientRect().top;
        superping.style.transition = 'none';
        chatContainer.style.transition = 'none';
    });
    document.addEventListener('mousemove', (e) => {
        if (dragging) {
            chatContainer.style.transition = 'none';
            superping.style.transition = 'none';
            const newX = e.clientX - dragOffsetX;
            const newY = e.clientY - dragOffsetY;
            chatContainer.style.left = `${newX}px`;
            chatContainer.style.top = `${newY}px`;
        }
        if (isDragging) {
            chatContainer.style.transition = 'none';
            superping.style.transition = 'none';
            superping.style.left = `${e.clientX - offsetX}px`;
            superping.style.top = `${e.clientY - offsetY}px`;
        }
        updateRightBoxPosition();
    });
    document.addEventListener('mouseup', () => {
        if (isDragging) {
            saveSuperpingPosition();
            updateRightBoxPosition();
        }
        if (dragging) {
            savechatContainerPosition();
        }
        isDragging = false;
        superping.style.transition = 'all 0.3s ease';
        chatContainer.style.transition = 'all 0.3s ease';
        dragging = false;
        titleArea.style.cursor = 'move';
    });
    let messageCount = 0; // 用来记录已显示的消息数量
    function displayText(text) {
        const textElement = document.createElement('div');
        textElement.textContent = text;
        Object.assign(textElement.style, { marginBottom: '0px', fontSize: '14px', lineHeight: '20px' });
        // 创建并设置分隔线

        // 将文本和分隔线添加到 superping 中
        superping.appendChild(textElement);
        const regex = /\[.*?\]/;
        if (regex.test(text)) {
            const separator = document.createElement('hr');
            separator.style.border = 'none';
            separator.style.borderTop = '1px solid rgba(255, 255, 255, 0.3)';
            separator.style.margin = '2px 0';
            superping.appendChild(separator);
        } else {
            // 每两条消息添加一根分隔线
            messageCount++;
            if (messageCount % 2 === 0) {
                const separator = document.createElement('hr');
                separator.style.border = 'none';
                separator.style.borderTop = '1px solid rgba(255, 255, 255, 0.3)';
                separator.style.margin = '2px 0';
                superping.appendChild(separator);
            }
        }
        superping.scrollTop = superping.scrollHeight;
    }

    function flashSuperping() {
        const originalBg = 'rgba(0, 0, 0, 0.5)';
        superping.style.backgroundColor = 'rgba(43,255,163,0.5)';
        setTimeout(() => {
            superping.style.backgroundColor = originalBg;
        }, 500);
    }

    window.onresize = function () {
        const isSuperpingEnabled = getSwitchState(1);
        if (isSuperpingEnabled) loadSuperpingPosition();

        const ischatContainerEnabled = getSwitchState(3);
        if (ischatContainerEnabled) loadchatContainerPosition();
    };
    window.onresize();

    /*** 消息过滤与关键词设置 ***/
    const messageCache = new Map();
    const MESSAGE_TIMEOUT = 30 * 1000;
    const TARGET_COLOR = '#2bffa3';
    const keywords = [
        { description: "A Super", keyword: "A Super" },
        { description: "A tower", keyword: "A tower of thorns rises from the sands..." },
        { description: "You hear someone", keyword: "You hear someone whisper faintly...\"just... one more game...\"" },
        { description: "You hear lightning", keyword: "You hear lightning strikes coming from a far distance..." },
        { description: "Something mountain", keyword: "Something mountain-like appears in the distance..." },
        { description: "bright light", keyword: "There's a bright light in the horizon" },
        { description: "A big yellow spot", keyword: "A big yellow spot shows up in the distance..." },
        { description: "A buzzing noise", keyword: "A buzzing noise echoes through the sewer tunnels" },
        { description: "You sense ominous vibrations", keyword: "You sense ominous vibrations coming from a different realm..." }
    ];

    let colorFilterEnabled = true;
    const toggleButton = document.createElement('button');
    toggleButton.textContent = 'Toggle Color Filter: ON';
    Object.assign(toggleButton.style, {
        position: 'fixed',
        right: '-9999px',
        top: '240px',
        backgroundColor: '#4CAF50',
        color: '#fff',
        padding: '10px',
        fontSize: '16px',
        border: 'none',
        borderRadius: '5px',
        zIndex: '9999',
        display: 'none'
    });
    document.body.appendChild(toggleButton);
    toggleButton.addEventListener('click', () => {
        colorFilterEnabled = !colorFilterEnabled;
        toggleButton.textContent = `Toggle Color Filter: ${colorFilterEnabled ? 'ON' : 'OFF'}`;
        toggleButton.style.backgroundColor = colorFilterEnabled ? '#4CAF50' : '#f44336';
    });

    /*** 设置面板与开关按钮 ***/
    const buttonSize = 60;
    const setting = document.createElement('button');
    setting.textContent = '设置';
    Object.assign(setting.style, {
        position: 'fixed',
        bottom: '10px',
        right: '10px',
        backgroundColor: '#FFD700',
        color: '#000',
        width: `${buttonSize}px`,
        height: `${buttonSize}px`,
        border: '2px solid #DAA520',
        fontSize: `${buttonSize * 0.3}px`,
        boxShadow: '0px 4px 6px rgba(0, 0, 0, 0.1)',
        borderRadius: '5px',
        zIndex: '9999',
        overflow: 'hidden'
    });
    setting.appendChild(statusDot);
    document.body.appendChild(setting);

    const panel = document.createElement('div');
    panel.textContent = '功能设置';
    Object.assign(panel.style, {
        position: 'fixed',
        bottom: '75px',
        right: '10px',
        width: '200px',
        height: '300px',
        backgroundColor: 'white',
        border: '1px solid gray',
        borderRadius: '5px',
        boxShadow: '0 4px 6px rgba(0, 0, 0, 0.1)',
        padding: '10px',
        zIndex: '999',
        display: 'none',
        overflowY: 'auto'
    });
    document.body.appendChild(panel);

    setting.addEventListener('click', () => {
        panel.style.display = (panel.style.display === 'none') ? 'block' : 'none';
    });

    // === 注意顺序：1->superping, 2->防顶号, 3->聊天, 4->日志
    const switchNames = ["super播报", "防顶号", "聊天", "日志"];
    switchNames.forEach((name, i) => {
        const switchContainer = document.createElement('div');
        Object.assign(switchContainer.style, {
            display: 'flex',
            alignItems: 'center',
            marginBottom: '20px'
        });

        const label = document.createElement('label');
        label.textContent = name;
        label.style.marginRight = 'auto';

        const toggle = document.createElement('input');
        toggle.type = 'checkbox';
        toggle.style.marginLeft = '10px';
        toggle.checked = getSwitchState(i + 1);
        toggle.addEventListener('change', () => {
            saveSwitchState(i + 1, toggle.checked);
            updateLogInterface();
            updateSuperpingPosition();
            updatechatContainerPosition();
            // === 新增：更新“防顶号”状态
            updatePreventMultiLogin();
            updateallowconnect();
        });

        switchContainer.appendChild(label);
        switchContainer.appendChild(toggle);
        panel.appendChild(switchContainer);
    });

    // === 新增：更新“防顶号”逻辑
    function updatePreventMultiLogin() {
        isPreventMultiLoginEnabled = getSwitchState(2);
        // 如果不开启防顶号，就设 isAllowedByServer=true、allowconnect=true 以不阻止
        if (!isPreventMultiLoginEnabled) {
            isAllowedByServer = true;
            allowconnect = true;
        } else {
            // 如果开启了，先把 allowconnect = false，等待服务器检查
            if (!connected) {
                isAllowedByServer = false;
                allowconnect = false;
            }
        }
    }
    // 初始化一下
    updatePreventMultiLogin();

    // 重新连接按钮
    const reconnectButton = document.createElement('button');
    reconnectButton.textContent = '重新连接WS';
    Object.assign(reconnectButton.style, {
        marginBottom: '10px',
        width: '100%'
    });
    reconnectButton.addEventListener('click', () => {
        if (ws && (ws.readyState === nativeWebSocket.OPEN || ws.readyState === nativeWebSocket.CONNECTING)) {
            showMessage('[WebSocket] 已连接或正在连接中，无需重新连接');
        } else {
            showMessage('[WebSocket] 尝试重新连接');
            connectWebSocket(true);
        }
    });
    panel.appendChild(reconnectButton);

    /*** 功能界面更新函数 ***/
    function updateallowconnect() {
        // 如果未开启防顶号 => allowconnect=true
        // 如果开启防顶号，则需要先等待 ws 服务器返回“允许使用此账号”才会置为 true
        const isPrevent = getSwitchState(2);
        if (!isPrevent) {
            isPreventMultiLoginEnabled = false
            allowconnect = true;
            //reconnectPendingGameWSS();
        } else {
            if (!hasconnect) {
                isPreventMultiLoginEnabled = true
            }
            if (isAllowedByServer) {
                allowconnect = true;
                if (!allows) {
                    reconnectPendingGameWSS();
                }
            }
        }
    }
    function updateallow() {
        // 如果未开启防顶号 => allowconnect=true
        // 如果开启防顶号，则需要先等待 ws 服务器返回“允许使用此账号”才会置为 true
        const isPrevent = getSwitchState(2);
        if (!isPrevent) {
            console.log(allows)
            allows = true
            isPreventMultiLoginEnabled = false
            allowconnect = true;
            box.style.display = 'none'
            //isAllowedByServer = true;
            //reconnectPendingGameWSS();
        }
        else {
            console.log(allows)
            allows = false
        }
    }

    function updateLogInterface() {
        const isLogEnabled = getSwitchState(4);
        if (isLogEnabled) {
            messageContainer.style.right = '20px';
            toggleButton.style.right = '20px';
        } else {
            messageContainer.style.right = '-9999px';
            toggleButton.style.right = '-9999px';
        }
    }
    updateLogInterface();

    function updateSuperpingPosition() {
        const isSuperpingEnabled = getSwitchState(1);
        if (isSuperpingEnabled) {
            loadSuperpingPosition();
        } else {
            superping.style.left = '-9999px';
            superping.style.top = '-9999px';
        }
    }
    updateSuperpingPosition();

    function updatechatContainerPosition() {
        const ischatContainerEnabled = getSwitchState(3);
        if (ischatContainerEnabled) {
            loadchatContainerPosition();
        } else {
            chatContainer.style.left = '-9999px';
            chatContainer.style.top = '-9999px';
        }
    }
    updatechatContainerPosition();

    /*** WebSocket相关逻辑 ***/
    const maxMessages = 100; // 最大消息数量

    // 保存所有消息
    let messages = [];

    // 显示新消息的函数
    function showMessage(message) {
        const newMessage = document.createElement('div');
        newMessage.textContent = message;
        Object.assign(newMessage.style, {
            marginBottom: '10px',
            backgroundColor: '#FF9800',  // 默认背景色
            padding: '5px',
            borderRadius: '5px',
        });

        // 添加新消息
        messageContainer.appendChild(newMessage);

        // 将新消息添加到消息数组
        messages.push(newMessage);

        // 如果消息超过最大数量，删除最上面的消息
        if (messages.length > maxMessages) {
            const firstMessage = messages.shift(); // 获取并移除数组中的第一条消息
            messageContainer.removeChild(firstMessage); // 从DOM中移除最上面的消息
        }

        // 自动滚动到最底部
        messageContainer.scrollTop = messageContainer.scrollHeight;
    }

    function connectWebSocket(forceReconnect = false) {
        if (ws && ws.readyState === nativeWebSocket.OPEN && !forceReconnect) {
            showMessage('[WebSocket] 已经连接，不需要重连');
            return;
        }
        if (ws) {
            try { ws.close(); } catch (e) { }
        }
        ws = new nativeWebSocket(customWSS);
        ws.onopen = () => {
            ws.send(JSON.stringify({
                type: 'canlogin',
                content: {
                    playerId: getPlayerId()
                }
            }))
            console.log('Connected to custom WSS');
            showMessage('[WebSocket] 连接已建立');
            connectedToCustomWSS = true;
            updateServers();
            getServerId();
            reconnectPendingGameWSS();
            statusDot.style.backgroundColor = 'rgb(19, 240, 144)';
            if (reconnectTimer) clearTimeout(reconnectTimer);
            reconnectTimer = null;
            startPeriodicOnlineMessage();
        };
        ws.onerror = (error) => {
            showMessage('[WebSocket] 连接出错: ' + error);
            console.error('[WebSocket] 连接出错:', error);
            statusDot.style.backgroundColor = 'yellow';
        };
        ws.onclose = () => {
            showMessage('[WebSocket] 连接已关闭，10秒后尝试重连...');
            console.warn('[WebSocket] 连接已关闭，10秒后尝试重连...');
            statusDot.style.backgroundColor = 'red';
            stopPeriodicOnlineMessage();
            if (!reconnectTimer) reconnectTimer = setTimeout(() => connectWebSocket(), 10000);
        };
        function isValidJSON(text) {
            try {
                JSON.parse(text);
                return true;
            } catch (error) {
                return false;
            }
        }
        ws.onmessage = (event) => {
            if (isValidJSON(event.data)) {
                const message = JSON.parse(event.data);
                if (message.type === 'onlineppl') {
                    const showus = message.content.us || "0";
                    const showeu = message.content.eu || "0";
                    const showas = message.content.as || "0";
                    const showidk = message.content.idk || "0";
                    updateUserInfo({
                        us: showus + "人",
                        eu: showeu + "人",
                        as: showas + "人",
                        unknown: showidk + "人"
                    });
                }
                // === 新增：服务器返回踢号或允许/禁止登录的消息
                else if (message.type === 'preventMultiLoginStatus') {
                    // 约定服务器的返回格式： {type: 'preventMultiLoginStatus', content: {allowed: true/false, reason: 'xxx'}}
                    if (message.content.allowed) {
                        isAllowedByServer = true;
                        updateStatus('offline')
                        setTimeout(() => updateStatus('none'), 5000);
                        showMessage('[防顶号] 服务器允许使用此账号');
                        // 允许后再让游戏连接
                        if (!allows) {
                            console.log(2)
                            updateallowconnect();
                            reconnectPendingGameWSS();
                        }
                    } else {
                        if (!allows) {
                            isAllowedByServer = false;
                        }

                        updateStatus('online')
                        showMessage('[防顶号] 服务器拒绝此账号，原因：' + (message.content.reason || '未知'));
                        allowconnect = false;
                    }
                }
                else if (message.type === 'chatter') {

                    const chatmessage = `[${message.content.name}]${message.content.chat}`
                    const message2 = document.createElement('div');
                    message2.textContent = chatmessage;
                    message2.style.marginBottom = '2px';
                    message2.style.color = '#555';
                    chatDisplay.appendChild(message2);
                    chatDisplay.scrollTop = chatDisplay.scrollHeight;
                }
            }
            else {
                // 普通文本消息
                flashSuperping();
                displayText(event.data);
            }
        };
    }

    function startPeriodicOnlineMessage() {
        if (!periodicMessageTimer) {
            periodicMessageTimer = setInterval(() => {
                if (ws && ws.readyState === nativeWebSocket.OPEN) {
                    const message = getPlayerId();
                    ws.send(JSON.stringify({
                        type: 'online',
                        content: {
                            playername: playerName,
                            playerLevel: playerLevel,
                            playerId: message,
                            regin: currentServerInfo.region,
                            map: currentServerInfo.map,
                            serverIds: currentServerInfo.serverId
                        }
                    }));
                } else {
                    console.warn('[WebSocket] WebSocket 未连接');
                }
            }, 5000);
        }
    }

    function stopPeriodicOnlineMessage() {
        if (periodicMessageTimer) {
            clearInterval(periodicMessageTimer);
            periodicMessageTimer = null;
        }
    }

    connectWebSocket();

    let detectedMessages = [];
    function sendMessageToWS() {
        if (ws && ws.readyState === nativeWebSocket.OPEN) {
            const messagesToSend = detectedMessages.slice(-5);
            ws.send(JSON.stringify({ type: 'send', content: messagesToSend }));
            if (messagesToSend.length > 0) {
                const lastMessage = messagesToSend[messagesToSend.length - 1];
                showMessage(`[WebSocket] 新消息发送: ${lastMessage}`);
            }
        } else {
            showMessage('[WebSocket] WebSocket 未连接');
            console.warn('[WebSocket] WebSocket 未连接');
        }
    }

    /*** 聊天框与消息延迟处理逻辑 ***/
    let lastPressEnterTime = 0;
    let chatBoxState = null;
    let detectionEnabled = false;
    let previousChatBoxState = null;
    let pendingMessages = [];
    const CHATBOX_THRESHOLD = 500;

    function clearPendingMessages() {
        for (const msg of pendingMessages) clearTimeout(msg.timeoutId);
        pendingMessages = [];
    }

    setInterval(() => {
        const now = Date.now();
        if (now - lastPressEnterTime < CHATBOX_THRESHOLD) {
            if (chatBoxState !== 'closed') {
                chatBoxState = 'closed';
                if (previousChatBoxState === 'opened' && chatBoxState === 'closed') clearPendingMessages();
            }
            detectionEnabled = true;
        } else {
            if (chatBoxState !== 'opened') {
                chatBoxState = 'opened';
            }
            detectionEnabled = false;
        }
        if (previousChatBoxState !== chatBoxState) previousChatBoxState = chatBoxState;
    }, 1);

    const originalFillTextOffset = OffscreenCanvasRenderingContext2D.prototype.fillText;
    OffscreenCanvasRenderingContext2D.prototype.fillText = function (text, x, y, maxWidth) {
        if (text.includes("Lvl") && !playerLevel) {
            var re = /\d{1,3}/;
            let r = re.exec(text);
            if (r && r.length > 0) {
                playerLevel = Number(r[0]);
                showMessage(`[Login] Level${playerLevel} user connected.`);
                hasconnect = true
            }
        }
        originalFillTextOffset.apply(this, arguments);
    };

    const originalFillText = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function (text, x, y, maxWidth) {
        if (text == "Ready" && !connected) connected = true;
        if (!notExpectedText.includes(text) && connected && !playerName) {
            const canvas = document.getElementById("canvas");
            const ctx = canvas.getContext("2d");
            var re = /\d{1,3}/;
            let result = re.exec(ctx.font);
            if (result && result.length > 0) {
                let size = Number(result[0]);
                let data = { text: text, size: size };
                let org = nameTextArray.filter((a) => a.text == text);
                if (org.length == 0) {
                    nameTextArray.push(data);
                } else {
                    if (org[0].size < size) {
                        nameTextArray = nameTextArray.map((v) => {
                            if (v.text == text) { v.size = size; }
                            return v;
                        });
                    }
                }
                if (nameTextArray.length > 14) {
                    playerName = nameTextArray.sort((a, b) => b.size - a.size)[0].text;
                    showMessage(`[Login] Player ${playerName} connected.`);
                    inputBox.removeAttribute('readonly');
                    inputBox.value = ''
                    logined = true

                }
            }
        }
        const cleanedText = text.trim();
        const playerId = getPlayerId();

        if (cleanedText.includes("Press [ENTER]")) {
            lastPressEnterTime = Date.now();
        }

        function processMessage(fullMessage) {
            if (messageCache.has(fullMessage) && (Date.now() - messageCache.get(fullMessage) < MESSAGE_TIMEOUT)) return;
            messageCache.set(fullMessage, Date.now());
            detectedMessages.push(fullMessage);
            showMessage(`[Canvas] ${fullMessage}`);
            sendMessageToWS();
        }

        function queueMessageForLater(fullMessage) {
            const timeoutId = setTimeout(() => {
                if (detectionEnabled) processMessage(fullMessage);
                pendingMessages = pendingMessages.filter(m => m.timeoutId !== timeoutId);
            }, 1000);
            pendingMessages.push({ fullMessage, timeoutId });
        }

        if (detectionEnabled && ((colorFilterEnabled && this.fillStyle === TARGET_COLOR) || !colorFilterEnabled)) {
            for (let { description } of keywords) {
                if (cleanedText && cleanedText.includes(description)) {
                    const prefix = currentServerInfo.region && currentServerInfo.map && currentServerInfo.serverId
                        ? `${currentServerInfo.region}-${currentServerInfo.map}-${currentServerInfo.serverId}#`
                        : "未知区域-未知地图-未知服务器#";
                    const suffix = `#${playerName}`;
                    const fullMessage = prefix + cleanedText + suffix;
                    queueMessageForLater(fullMessage);
                    break;
                }
            }
        }
        originalFillText.apply(this, arguments);
    };

    /*** 服务器信息与换服逻辑 ***/
    let servers = {};
    let matrixs = ["Garden", "Desert", "Ocean", "Jungle", "Ant Hell", "Hel", "Sewers"];
    let totalServers = 7;
    let position = "-200px";

    function updateServers() {
        for (let i = 0; i < totalServers; i++) {
            fetch(`https://api.n.m28.io/endpoint/florrio-map-${i}-green/findEach/`)
                .then((response) => response.json())
                .then((data) => {
                    if (!servers[matrixs[i]]) {
                        servers[matrixs[i]] = { NA: {}, EU: {}, AS: {} };
                    }
                    servers[matrixs[i]].NA[data.servers["vultr-miami"].id] = Math.floor(Date.now() / 1000);
                    servers[matrixs[i]].EU[data.servers["vultr-frankfurt"].id] = Math.floor(Date.now() / 1000);
                    servers[matrixs[i]].AS[data.servers["vultr-tokyo"].id] = Math.floor(Date.now() / 1000);
                });
        }
        // 清理超过5分钟未更新的服务器数据
        for (const [keyMatrix, valueMatrix] of Object.entries(servers)) {
            for (const [keyRegion, valueRegion] of Object.entries(valueMatrix)) {
                for (const [keyId, valueId] of Object.entries(valueRegion)) {
                    if (Math.floor(Date.now() / 1000) - valueId > 5 * 60) {
                        delete servers[keyMatrix][keyRegion][keyId];
                    }
                }
            }
        }
    }

    updateServers();
    setInterval(() => {
        updateServers();
        getServerId();
    }, 5000);

    var container = document.createElement('div');
    Object.assign(container.style, {
        width: '500px',
        height: 'auto',
        zIndex: '9999',
        background: 'rgba(0, 0, 0, 0.5)',
        position: 'fixed',
        left: '50%',
        transform: 'translateX(-50%)',
        borderRadius: '10px',
        margin: '0 auto',
        color: 'white',
        textAlign: 'center',
        fontFamily: 'Ubuntu',
        padding: '12px',
        top: position,
        cursor: 'default',
        transition: 'all 1s ease-in-out'
    });
    document.body.appendChild(container);

    const style = document.createElement('style');
    style.textContent = `.server-id:hover { color: #aaccff !important; };`;
    document.head.appendChild(style);

    var autoToggle = true;
    var autoHide = setTimeout(function () {
        container.style.top = position;
        clearTimeout(autoHide);
    }, 3000);

    document.documentElement.addEventListener("keydown", function (e) {
        if (e.keyCode == "192") { // backquote
            autoToggle = !autoToggle;
            container.style.top = autoToggle ? position : "0px";
        }
    });

    function getServerId() {
        if (!wsURL) return;
        var thisCp6Id = wsURL.match(/wss:\/\/([a-z0-9]*).s.m28n.net\//);
        if (!thisCp6Id) return;
        thisCp6Id = thisCp6Id[1];

        let foundServer = false;
        for (const [biome, serversObj] of Object.entries(servers)) {
            for (const [region, obj] of Object.entries(serversObj)) {
                if (Object.keys(obj).includes(thisCp6Id)) {
                    currentServerInfo = { region: regionToName(region), map: biome, serverId: thisCp6Id };
                    foundServer = true;
                    break;
                }
            }
            if (foundServer) break;
        }

        let t = `Click on a server code to connect.<br>Press \` (backquote) to toggle this menu.<br><br>`;
        var thisBiome = currentServerInfo.map || "-";
        var thisServerArr = [];

        if (thisBiome !== "-") {
            for (const [b, serversObj] of Object.entries(servers)) {
                if (b === thisBiome) {
                    for (const [region, obj] of Object.entries(serversObj)) {
                        const serverLine = `<tr><td>『 ${regionToName(region)} 』</td>${Object.keys(obj)
                            .map(x => {
                                const isCurrent = (x === currentServerInfo.serverId);
                                const color = isCurrent ? "#29ffa3" : "#ababab";
                                return `<td style='min-width:50px'><span style="cursor:pointer; color:${color}" class="server-id" data-id="${x}">${x}</span></td>`;
                            })
                            .join(" - ")
                            }</tr>`;
                        thisServerArr.push(serverLine);
                    }
                }
            }
            t += `${currentServerInfo.region} - ${thisBiome}<br><table style="position: relative; margin: 0 auto;">`;
            t += thisServerArr.join("");
            t += "</table>";
        } else {
            t += "无法获取当前服务器信息,请刷新页面";
        }

        container.innerHTML = t;

        const serverIds = container.querySelectorAll('.server-id');
        serverIds.forEach(el => {
            el.addEventListener('click', () => {
                const serverId = el.getAttribute('data-id');
                if (window.cp6 && typeof window.cp6.forceServerID === 'function') {
                    window.cp6.forceServerID(serverId);
                }
            });
        });
    }

    getServerId();

    var wssArr = [];
    setInterval(() => {
        wssArr.unshift(wsURL);
        if (wssArr.length > 2) wssArr.splice(2);
        if (wssArr[wssArr.length - 1] !== wssArr[0]) {
            updateServers();
            getServerId();
            if (autoToggle) {
                container.style.top = "0px";
                var autoHide = setTimeout(function () {
                    container.style.top = position;
                    clearTimeout(autoHide);
                }, 3000);
            }
        }
    }, 1000);

    /*** 重写WebSocket构造，获取wsURL ***/
    // ========== ★ 修改点【2】拦截游戏服务器时：将被阻断的 url 存到 Reconnectingserver ==========
    window.WebSocket = function (...args) {
        updateallow();
        const url = args[0];
        // 判断是否是游戏服务器
        const isGameServer = gameWSSPatterns.some(pattern => pattern.test(url));

        // 如果是游戏服务器的wss
        if (isGameServer) {
            // === 当防顶号开关开启 且 尚未得到服务器“允许使用此账号”，就阻止连接
            if (isPreventMultiLoginEnabled && !isAllowedByServer) {
                console.log('防顶号开启：尚未得到服务器允许，阻止连接到游戏服务器:', url);
                showMessage('[防顶号] 尚未得到允许，阻止连接游戏服务器');
                // 阻止该连接 - 返回假的 WebSocket
                const fakeSocket = {
                    close: () => { },
                    send: () => { },
                    readyState: WebSocket.CLOSED,
                    onopen: null,
                    onmessage: null,
                    onclose: null,
                    onerror: null
                };
                return fakeSocket;
            }

            // === 如果 allowconnect = false，也阻止连接
            else if (!allowconnect && !allows) {
                console.log('Blocking WebSocket connection to the game server', url);
                // 记录被阻断的地址
                Reconnectingserver = url;
                const fakeSocket = {
                    close: () => { },
                    send: () => { },
                    readyState: WebSocket.CLOSED,
                    onopen: null,
                    onmessage: null,
                    onclose: null,
                    onerror: null
                };
                return fakeSocket;
            }
            else {
                // === 如果通过了上述判断，则允许连接
                allows = true
                console.log('Allowing connection to game server:', url);
                const socket = new nativeWebSocket(...args);
                wsURL = socket.url;
                return socket;
            }

        } else {
            // 非游戏服务器(包含superping本身)，直接允许连接
            console.log('Allowing connection to:', url);
            const socket = new nativeWebSocket(...args);
            wsURL = socket.url;
            return socket;
        }
    };
    // ========== ★ 修改点【2】结束 ==========

})();

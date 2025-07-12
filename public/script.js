document.addEventListener('DOMContentLoaded', () => {
    const socket = io();

    // --- CONFIGURAÇÃO (Vem do servidor, mas é útil ter no cliente para renderização) ---
    const CHIP_TYPES = {
        blue: { value: 400, class: 'chip-blue' },
        white: { value: 200, class: 'chip-white' },
        black: { value: 50, class: 'chip-black' },
        green: { value: 25, class: 'chip-green' },
        red: { value: 25, class: 'chip-red' },
    };
     const BLIND_LEVELS = [
        { small: 25, big: 50 }, { small: 50, big: 100 }, { small: 75, big: 150 },
        { small: 100, big: 200 }, { small: 150, big: 300 }, { small: 200, big: 400 },
        { small: 250, big: 500 }, { small: 300, big: 600 }, { small: 400, big: 800 },
        { small: 500, big: 1000 }, { small: 600, big: 1200 }, { small: 800, big: 1600 },
        { small: 1000, big: 2000 }
    ];

    // --- ESTADO DO JOGO (Agora é um espelho do estado do servidor) ---
    let state = {};
    // O estado da UI local armazena coisas que não precisam ser sincronizadas,
    // como qual tela está ativa ou qual jogador está sendo editado no momento.
    let localUiState = {
        activeScreen: 'home',
        activePlayerId: null,
        currentBet: {}, // Aposta não confirmada para a tela de aposta do manager
        manageChips: {} // Fichas não confirmadas para a tela de gerenciamento do manager
    };
    let audioCtx;

    // --- ELEMENTOS DO DOM ---
    const screens = {
        home: document.getElementById('home-screen'),
        order: document.getElementById('order-screen'),
        bet: document.getElementById('bet-screen'),
        manage: document.getElementById('manage-screen'),
        settings: document.getElementById('settings-screen'),
    };
    
    // --- FUNÇÕES DE COMUNICAÇÃO COM O SERVIDOR ---
    function sendPlayerAction(type, payload = {}) {
        socket.emit('playerAction', { type, payload });
    }

    function sendTimerAction(type, payload = null) {
        socket.emit('timerAction', { type, payload });
    }

    // --- LÓGICA DE ÁUDIO ---
    function playSound() {
        try {
            if (!audioCtx) {
                audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            }
            const oscillator = audioCtx.createOscillator();
            const gainNode = audioCtx.createGain();
            oscillator.connect(gainNode);
            gainNode.connect(audioCtx.destination);
            oscillator.type = 'sine';
            oscillator.frequency.setValueAtTime(880, audioCtx.currentTime);
            gainNode.gain.setValueAtTime(0.5, audioCtx.currentTime);
            gainNode.gain.exponentialRampToValueAtTime(0.00001, audioCtx.currentTime + 0.5);
            oscillator.start(audioCtx.currentTime);
            oscillator.stop(audioCtx.currentTime + 0.5);
        } catch(e) {
            console.error("Web Audio API is not supported in this browser or could not be initialized.", e);
        }
    }

    // --- LÓGICA DE CÁLCULO ---
    function calculateStack(player) {
        if (!player || !player.chips) return 0;
        return Object.entries(player.chips).reduce((sum, [type, count]) => sum + (CHIP_TYPES[type].value * count), 0);
    }
    
    function calculateRoundBetValue(player) {
        if (!player || !player.roundBet) return 0;
        return Object.entries(player.roundBet).reduce((sum, [type, count]) => sum + (CHIP_TYPES[type].value * count), 0);
    }

    function calculatePotValue() {
        if (!state.pot) return 0;
        return Object.entries(state.pot).reduce((sum, [type, count]) => sum + (CHIP_TYPES[type].value * count), 0);
    }

    function calculateTotalRoundBets() {
        if (!state.players) return 0;
        return state.players.reduce((total, player) => total + calculateRoundBetValue(player), 0);
    }

    function switchScreen(screenName) {
        localUiState.activeScreen = screenName;
        Object.keys(screens).forEach(key => {
            // Usa 'sub-screen' para a transição, mas 'screen' para a lógica geral
            const element = screens[key];
            if (element.classList.contains('sub-screen')) {
                 element.classList.toggle('active', key === screenName);
            } else {
                 element.style.display = (key === screenName) ? 'flex' : 'none';
            }
        });
    }
    
    // --- RENDERIZAÇÃO (Atualiza a UI com base no estado recebido) ---
    function renderAll() {
        if (!state.players) return; // Não renderiza se o estado ainda não chegou
        renderHomeScreen();
        renderTimer();
    }

    function renderHomeScreen() {
        const rankedPlayers = [...state.players].sort((a, b) => calculateStack(b) - calculateStack(a));
        
        const playerListEl = document.getElementById('player-list');
        playerListEl.innerHTML = '';
        rankedPlayers.forEach((player, index) => {
            const playerEl = document.createElement('div');
            playerEl.className = 'player-item';
            const roundBetValue = calculateRoundBetValue(player);
            const betDisplay = roundBetValue > 0 ? `<div class="player-current-bet"><span class="bet-label">Bet</span><br>${roundBetValue}</div>` : '';

            playerEl.innerHTML = `
                <div class="player-position">${index + 1}º</div>
                <div class="player-info">
                    <button class="player-stack" data-player-id="${player.id}">${calculateStack(player).toLocaleString('pt-BR')}</button>
                    ${betDisplay}
                </div>
                <button class="player-name" data-player-id="${player.id}">${player.name}</button>
                <button class="select-winner-btn ${player.selectedForPot ? 'selected' : ''}" data-player-id="${player.id}">+</button>
            `;
            playerListEl.appendChild(playerEl);
        });
        document.getElementById('home-pot-value').textContent = calculatePotValue().toLocaleString('pt-BR');
    }

    function renderOrderScreen() {
        if (!state.players) return;
        const playerListEl = document.getElementById('order-player-list');
        playerListEl.innerHTML = '';
        state.players.forEach(player => {
            const playerEl = document.createElement('div');
            playerEl.className = 'player-item';
            playerEl.draggable = true;
            playerEl.dataset.playerId = player.id;
            playerEl.innerHTML = `
                <span class="drag-handle">|||</span>
                <span class="player-name-order">${player.name}</span>
                <button class="remove-player-btn" data-player-id="${player.id}">✖</button>
            `;
            playerListEl.appendChild(playerEl);
        });
    }

    function renderBetScreen(playerId) {
        localUiState.activePlayerId = playerId;
        localUiState.currentBet = {}; // Limpa aposta local ao trocar de jogador

        const player = state.players.find(p => p.id === playerId);
        if (!player) return;

        document.getElementById('bet-player-name').textContent = player.name;
        
        renderBetVisuals(playerId);
        switchScreen('bet');
    }

    function renderBetVisuals(playerId) {
        const player = state.players.find(p => p.id === playerId);
        if (!player) return;

        const totalCommittedRoundBets = calculateTotalRoundBets();
        document.getElementById('bet-screen-pot-value').textContent = totalCommittedRoundBets.toLocaleString('pt-BR');
        document.getElementById('bet-screen-round-num').textContent = state.timer.round + 1;

        const highestBetInRound = Math.max(0, ...state.players.map(p => calculateRoundBetValue(p)));
        const previousBetInfoEl = document.getElementById('previous-bet-info');
        if (highestBetInRound > 0 && calculateRoundBetValue(player) < highestBetInRound) {
            previousBetInfoEl.textContent = `Aposta a cobrir: ${highestBetInRound}`;
        } else {
            previousBetInfoEl.textContent = '';
        }

        const playerRoundBetValue = calculateRoundBetValue(player);
        const currentBetChangeValue = Object.entries(localUiState.currentBet).reduce((sum, [type, count]) => sum + (CHIP_TYPES[type].value * count), 0);
        document.getElementById('bet-total-value').textContent = (playerRoundBetValue + currentBetChangeValue).toLocaleString('pt-BR');

        const visualizerEl = document.getElementById('bet-stack-visualizer');
        visualizerEl.innerHTML = '';
        
        // Combina as fichas já apostadas na rodada com a nova aposta local
        const chipsToVisualize = {...player.roundBet};
        Object.entries(localUiState.currentBet).forEach(([type, count]) => {
            chipsToVisualize[type] = (chipsToVisualize[type] || 0) + count;
        });

        Object.entries(chipsToVisualize).forEach(([type, count]) => {
            if (count > 0) {
                const config = CHIP_TYPES[type];
                const chipBtn = document.createElement('button');
                chipBtn.className = `btn chip-btn ${config.class}`;
                chipBtn.dataset.chipType = type;
                chipBtn.innerHTML = `<div class="value">${config.value}</div><div class="count">${count}</div>`;
                visualizerEl.appendChild(chipBtn);
            }
        });

        const selectorEl = document.getElementById('bet-chip-selector');
        selectorEl.innerHTML = '';
        Object.entries(player.chips).forEach(([type, count]) => {
            const chipsInBet = localUiState.currentBet[type] || 0;
            const remainingInHand = count - chipsInBet;
            
            if (remainingInHand > 0) {
                 const chipBtn = document.createElement('button');
                 chipBtn.className = `btn chip-btn ${config.class}`;
                 chipBtn.dataset.chipType = type;
                 chipBtn.innerHTML = `<div class="value">${config.value}</div><div class="count">${remainingInHand}</div>`;
                 selectorEl.appendChild(chipBtn);
            }
        });
    }
    
    function renderManageScreen(playerId) {
        localUiState.activePlayerId = playerId;
        localUiState.manageChips = {}; // Limpa ao trocar de jogador

        const player = state.players.find(p => p.id === playerId);
        if (!player) return;
        
        document.getElementById('manage-player-name').innerHTML = `${player.name} <span class="edit-icon">✎</span>`;
        
        const selectorEl = document.getElementById('manage-chip-selector');
        selectorEl.innerHTML = '';
        Object.entries(CHIP_TYPES).forEach(([type, config]) => {
             const chipBtn = document.createElement('button');
             chipBtn.className = `btn chip-btn ${config.class}`;
             chipBtn.dataset.chipType = type;
             chipBtn.innerHTML = `<div class="value">${config.value}</div><div class="count">∞</div>`;
             selectorEl.appendChild(chipBtn);
        });
        renderManageVisuals(playerId);
        switchScreen('manage');
    }

    function renderManageVisuals(playerId) {
        const player = state.players.find(p => p.id === playerId);
        if (!player) return;
        let currentStack = calculateStack(player);
        let changeValue = 0;
        
        const visualizerEl = document.getElementById('manage-stack-visualizer');
        visualizerEl.innerHTML = '';

        const tempChips = { ...player.chips };
        Object.entries(localUiState.manageChips).forEach(([type, count]) => {
            tempChips[type] = (tempChips[type] || 0) + count;
            changeValue += CHIP_TYPES[type].value * count;
        });

        Object.entries(tempChips).forEach(([type, count]) => {
            if(count > 0) {
                const config = CHIP_TYPES[type];
                const chipBtn = document.createElement('button');
                chipBtn.className = `btn chip-btn ${config.class}`;
                chipBtn.dataset.chipType = type;
                chipBtn.innerHTML = `<div class="value">${config.value}</div><div class="count">${count}</div>`;
                visualizerEl.appendChild(chipBtn);
            }
        });
        
        document.getElementById('manage-total-value').textContent = (currentStack + changeValue).toLocaleString('pt-BR');
    }

    function getNextPlayerId(currentId) {
        const currentIndex = state.players.findIndex(p => p.id === currentId);
        if (currentIndex === -1 || state.players.length === 0) return null;
        const nextIndex = (currentIndex + 1) % state.players.length;
        return state.players[nextIndex].id;
    }

    function getPrevPlayerId(currentId) {
        const currentIndex = state.players.findIndex(p => p.id === currentId);
        if (currentIndex === -1 || state.players.length === 0) return null;
        const prevIndex = (currentIndex - 1 + state.players.length) % state.players.length;
        return state.players[prevIndex].id;
    }

    // --- Lógica do Timer (Apenas Renderização) ---
    function formatTime(s) { return `${String(Math.floor(s/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`; }

    function renderTimer() {
        const timer = state.timer;
        if (!timer) return;
        const level = BLIND_LEVELS[timer.round];
        const blindsText = level ? `${level.small}/${level.big}` : 'FIM';

        document.getElementById('home-timer-display').textContent = formatTime(timer.time);
        document.getElementById('home-round-num').textContent = timer.round + 1;
        document.getElementById('home-blinds-display').textContent = blindsText;
        
        document.getElementById('settings-round-num').textContent = timer.round + 1;
        document.getElementById('settings-blinds-display').textContent = blindsText;
        
        const startPauseBtn = document.getElementById('timer-start-pause-btn');
        startPauseBtn.textContent = timer.isRunning ? 'PAUSAR' : 'INICIAR';
        startPauseBtn.classList.toggle('paused', !timer.isRunning);
        
        document.getElementById('timer-input').value = timer.duration;
        document.getElementById('timer-input').disabled = timer.isRunning;
        document.getElementById('timer-prev-level-btn').disabled = timer.isRunning;
        document.getElementById('timer-next-level-btn').disabled = timer.isRunning;
    }

    // --- MANIPULADORES DE EVENTOS ---
    let draggedItem = null;

    document.body.addEventListener('dragstart', e => {
        if (e.target.classList.contains('player-item')) {
            draggedItem = e.target;
            setTimeout(() => e.target.classList.add('dragging'), 0);
        }
    });

    document.body.addEventListener('dragend', e => {
        if (draggedItem) {
            draggedItem.classList.remove('dragging');
            draggedItem = null;
        }
    });

    document.body.addEventListener('dragover', e => {
        e.preventDefault();
        const list = document.getElementById('order-player-list');
        if (!list || !draggedItem) return;
        const afterElement = getDragAfterElement(list, e.clientY);
        if (afterElement == null) {
            list.appendChild(draggedItem);
        } else {
            list.insertBefore(draggedItem, afterElement);
        }
    });

    function getDragAfterElement(container, y) {
        const draggableElements = [...container.querySelectorAll('.player-item:not(.dragging)')];
        return draggableElements.reduce((closest, child) => {
            const box = child.getBoundingClientRect();
            const offset = y - box.top - box.height / 2;
            if (offset < 0 && offset > closest.offset) return { offset: offset, element: child };
            else return closest;
        }, { offset: Number.NEGATIVE_INFINITY }).element;
    }

    document.body.addEventListener('click', (e) => {
        const target = e.target.closest('button');
        if (!target) return;
        
        // Ações que enviam eventos para o servidor
        if (target.matches('.select-winner-btn')) {
            sendPlayerAction('toggleWinner', { playerId: parseInt(target.dataset.playerId) });
            return;
        }
        if (target.matches('#distribute-btn')) {
            sendPlayerAction('distributePot');
            return;
        }
        if (target.matches('#reset-btn')) {
            if (confirm('Tem certeza que deseja resetar o jogo? Isso removerá todos os jogadores e zerará o pote.')) {
                sendPlayerAction('resetGame');
                sendTimerAction('reset');
            }
            return;
        }
        if (target.matches('#add-player-btn')) {
            const newName = prompt("Digite o nome do novo jogador:");
            if (newName) sendPlayerAction('addPlayer', { name: newName });
            return;
        }
        if (target.matches('.remove-player-btn')) {
            sendPlayerAction('removePlayer', { playerId: parseInt(target.dataset.playerId) });
            return;
        }
        if (target.matches('#save-order-btn')) {
            const playerNodes = document.querySelectorAll('#order-player-list .player-item');
            const playerIds = Array.from(playerNodes).map(node => parseInt(node.dataset.playerId));
            sendPlayerAction('updateOrder', { playerIds });
            switchScreen('home');
            return;
        }
        if (target.matches('#end-betting-btn') || target.matches('#end-betting-btn-home')) {
            sendPlayerAction('endBettingRound');
            switchScreen('home');
            return;
        }
        if (target.matches('#manage-save-btn')) {
            const player = state.players.find(p => p.id === localUiState.activePlayerId);
            if (!player) return;
            const finalChips = { ...player.chips };
            Object.entries(localUiState.manageChips).forEach(([type, count]) => {
                finalChips[type] = Math.max(0, (finalChips[type] || 0) + count);
            });
            sendPlayerAction('updatePlayerChips', { playerId: player.id, chips: finalChips });
            switchScreen('home');
            return;
        }
        if (target.matches('.edit-icon')) {
            const player = state.players.find(p => p.id === localUiState.activePlayerId);
            if (!player) return;
            const newName = prompt('Digite o novo nome:', player.name);
            if (newName) sendPlayerAction('updatePlayerName', { playerId: player.id, name: newName });
            return;
        }
        if (target.matches('#bet-confirm-btn')) {
            sendPlayerAction('playerBet', { playerId: localUiState.activePlayerId, bet: localUiState.currentBet });
            const nextPlayerId = getNextPlayerId(localUiState.activePlayerId);
            if (nextPlayerId) renderBetScreen(nextPlayerId);
            else switchScreen('home');
            return;
        }


        // Ações da UI local (não precisam do servidor)
        if (target.matches('.player-stack')) { renderBetScreen(parseInt(target.dataset.playerId)); return; }
        if (target.matches('.player-name')) { renderManageScreen(parseInt(target.dataset.playerId)); return; }
        if (target.matches('#settings-btn')) { switchScreen('settings'); return; }
        if (target.matches('#go-to-order-btn')) { renderOrderScreen(); switchScreen('order'); return; }
        if (target.matches('#go-to-home-btn') || target.matches('.home-btn')) { switchScreen('home'); return; }

        // Navegação entre jogadores nas telas de aposta/gerenciamento
        if (target.matches('#bet-next-player')) { renderBetScreen(getNextPlayerId(localUiState.activePlayerId)); return; }
        if (target.matches('#bet-prev-player')) { renderBetScreen(getPrevPlayerId(localUiState.activePlayerId)); return; }
        if (target.matches('#manage-next-player')) { renderManageScreen(getNextPlayerId(localUiState.activePlayerId)); return; }
        if (target.matches('#manage-prev-player')) { renderManageScreen(getPrevPlayerId(localUiState.activePlayerId)); return; }

        // Lógica de manipulação de fichas (local antes de confirmar)
        if (target.closest('#bet-chip-selector')) {
            const type = target.dataset.chipType;
            const player = state.players.find(p => p.id === localUiState.activePlayerId);
            const chipsInHand = player.chips[type] || 0;
            const chipsInBet = localUiState.currentBet[type] || 0;
            if (chipsInHand > chipsInBet) { 
                localUiState.currentBet[type] = chipsInBet + 1;
                renderBetVisuals(localUiState.activePlayerId); 
            }
            return;
        }
        if (target.closest('#bet-stack-visualizer')) {
            const type = target.dataset.chipType;
            if ((localUiState.currentBet[type] || 0) > 0) {
                 localUiState.currentBet[type]--;
                 if (localUiState.currentBet[type] === 0) delete localUiState.currentBet[type];
                 renderBetVisuals(localUiState.activePlayerId);
            }
            return;
        }
        if (target.matches('#clear-bet-btn')) {
            localUiState.currentBet = {};
            renderBetVisuals(localUiState.activePlayerId);
            return;
        }
        if (target.closest('#manage-chip-selector')) {
            const type = target.dataset.chipType;
            localUiState.manageChips[type] = (localUiState.manageChips[type] || 0) + 1;
            renderManageVisuals(localUiState.activePlayerId);
            return;
        }
        if (target.closest('#manage-stack-visualizer')) {
            const type = target.dataset.chipType;
            localUiState.manageChips[type] = (localUiState.manageChips[type] || 0) - 1;
            renderManageVisuals(localUiState.activePlayerId);
            return;
        }
        
        // Ações do Timer
        if (target.matches('#timer-start-pause-btn')) { sendTimerAction('startPause'); return; }
        if (target.matches('#timer-reset-btn')) { sendTimerAction('reset'); return; }
        if (target.matches('#timer-next-level-btn')) { sendTimerAction('nextLevel'); return; }
        if (target.matches('#timer-prev-level-btn')) { sendTimerAction('prevLevel'); return; }
    });

    document.getElementById('timer-input').addEventListener('change', (e) => {
        if (!state.timer?.isRunning) {
            sendTimerAction('changeDuration', parseInt(e.target.value));
        }
    });

    // --- INICIALIZAÇÃO E OUVINTES DO SOCKET ---
    socket.on('gameStateUpdate', (newState) => {
        console.log('Estado recebido do servidor:', newState);
        state = newState;
        // Renderiza a tela principal sempre
        renderAll();
        // Se uma tela de sub-menu estiver aberta, atualize-a também para refletir as mudanças
        switch(localUiState.activeScreen) {
            case 'bet':
                renderBetVisuals(localUiState.activePlayerId);
                break;
            case 'manage':
                renderManageVisuals(localUiState.activePlayerId);
                break;
            case 'order':
                renderOrderScreen();
                break;
        }
    });
    
    socket.on('playSound', () => {
        if (!audioCtx) {
            audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        }
        playSound();
    });
});

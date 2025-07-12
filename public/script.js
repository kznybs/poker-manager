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
    const INITIAL_CHIPS = { white: 8, red: 8, green: 8, black: 8, blue: 0 };


    // --- ESTADO DO JOGO (Agora é um espelho do estado do servidor) ---
    let state = {};
    let localUiState = { // Estado que só existe neste cliente
        activeScreen: 'home',
        activePlayerId: null,
        currentBet: {},
        manageChips: {}
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
    function sendStateUpdate() {
        socket.emit('playerAction', { type: 'updateGameState', payload: state });
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

    // --- LÓGICA DE CÁLCULO (semelhante ao original) ---
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
            screens[key].classList.toggle('active', key === screenName);
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
        localUiState.currentBet = {};

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
        
        const chipsToVisualize = {...player.roundBet, ...localUiState.currentBet};
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
        Object.entries(CHIP_TYPES).forEach(([type, config]) => {
            const chipsTakenFromHand = Math.max(0, localUiState.currentBet[type] || 0);
            const remainingInHand = player.chips[type] - chipsTakenFromHand;
            
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
        localUiState.manageChips = {};

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
        if (currentIndex === -1) return null;
        const nextIndex = (currentIndex + 1) % state.players.length;
        return state.players[nextIndex].id;
    }

    function getPrevPlayerId(currentId) {
        const currentIndex = state.players.findIndex(p => p.id === currentId);
        if (currentIndex === -1) return null;
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
        if (!list) return;
        const afterElement = getDragAfterElement(list, e.clientY);
        const currentDragged = document.querySelector('.dragging');
        if(currentDragged){
            if (afterElement == null) list.appendChild(currentDragged);
            else list.insertBefore(currentDragged, afterElement);
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

    function handleEndBetting() {
        state.players.forEach(player => {
            Object.entries(player.roundBet).forEach(([type, count]) => {
                state.pot[type] = (state.pot[type] || 0) + count;
            });
            player.roundBet = { white: 0, red: 0, green: 0, black: 0, blue: 0 };
        });
        sendStateUpdate();
        switchScreen('home');
    }

    document.body.addEventListener('click', (e) => {
        const target = e.target;
        
        // Navegação Home
        if (target.closest('.player-stack')) { renderBetScreen(parseInt(target.closest('.player-stack').dataset.playerId)); return; }
        if (target.closest('.player-name')) { renderManageScreen(parseInt(target.closest('.player-name').dataset.playerId)); return; }
        if (target.closest('.select-winner-btn')) {
            const player = state.players.find(p => p.id === parseInt(target.closest('.select-winner-btn').dataset.playerId));
            player.selectedForPot = !player.selectedForPot;
            sendStateUpdate();
            return;
        }
        if (target.closest('#distribute-btn')) {
            const winners = state.players.filter(p => p.selectedForPot);
            if (winners.length > 0 && calculatePotValue() > 0) {
                if (winners.length === 1) {
                    const winner = winners[0];
                    Object.keys(state.pot).forEach(chipType => {
                        winner.chips[chipType] = (winner.chips[chipType] || 0) + state.pot[chipType];
                    });
                } else {
                    const totalPotValue = calculatePotValue();
                    const valuePerWinner = Math.floor(totalPotValue / winners.length);
                    winners.forEach(winner => {
                        let valueToDistribute = valuePerWinner;
                        const sortedChipTypes = Object.keys(CHIP_TYPES).sort((a, b) => CHIP_TYPES[b].value - CHIP_TYPES[a].value);
                        sortedChipTypes.forEach(type => {
                            const chipValue = CHIP_TYPES[type].value;
                            if (valueToDistribute >= chipValue) {
                                const numChips = Math.floor(valueToDistribute / chipValue);
                                winner.chips[type] = (winner.chips[type] || 0) + numChips;
                                valueToDistribute -= numChips * chipValue;
                            }
                        });
                    });
                }
                state.pot = { white: 0, red: 0, green: 0, black: 0, blue: 0 };
                state.players.forEach(p => p.selectedForPot = false);
                sendStateUpdate();
            }
            return;
        }
        if (target.closest('#reset-btn')) {
            if (confirm('Tem certeza que deseja limpar todos os jogadores e reiniciar o jogo?')) {
                state.players = [];
                state.pot = { white: 0, red: 0, green: 0, black: 0, blue: 0 };
                sendStateUpdate();
                sendTimerAction('reset');
            }
            return;
        }
        if (target.closest('#settings-btn')) { switchScreen('settings'); return; }
        if (target.closest('#go-to-order-btn')) { renderOrderScreen(); switchScreen('order'); return; }
        if (target.closest('#go-to-home-btn')) { switchScreen('home'); return; }

        // Tela de Ordem de Jogo
        if (target.closest('#add-player-btn')) {
            const newName = prompt("Digite o nome do novo jogador:");
            if (newName && newName.trim() !== "") {
                const newId = state.players.length > 0 ? Math.max(...state.players.map(p => p.id)) + 1 : 1;
                state.players.push({
                    id: newId,
                    name: newName,
                    chips: { ...INITIAL_CHIPS },
                    roundBet: { white: 0, red: 0, green: 0, black: 0, blue: 0 },
                    selectedForPot: false
                });
                renderOrderScreen();
                sendStateUpdate();
            }
            return;
        }
        if (target.closest('.remove-player-btn')) {
            const playerId = parseInt(target.closest('.remove-player-btn').dataset.playerId);
            const playerIndex = state.players.findIndex(p => p.id === playerId);
            if (playerIndex > -1) {
                state.players.splice(playerIndex, 1);
                renderOrderScreen();
                sendStateUpdate();
            }
            return;
        }
        if (target.closest('#save-order-btn')) {
            const playerNodes = document.querySelectorAll('#order-player-list .player-item');
            const newOrder = Array.from(playerNodes).map(node => {
                const playerId = parseInt(node.dataset.playerId);
                return state.players.find(p => p.id === playerId);
            });
            state.players = newOrder;
            sendStateUpdate();
            switchScreen('home');
            return;
        }

        // Tela de Aposta
        if (target.closest('#bet-chip-selector .chip-btn')) {
            const type = target.closest('.chip-btn').dataset.chipType;
            const player = state.players.find(p => p.id === localUiState.activePlayerId);
            const betCount = localUiState.currentBet[type] || 0;
            if (player.chips[type] > betCount) { 
                localUiState.currentBet[type] = (localUiState.currentBet[type] || 0) + 1;
                renderBetVisuals(localUiState.activePlayerId); 
            }
            return;
        }
        if (target.closest('#bet-stack-visualizer .chip-btn')) {
            const type = target.closest('.chip-btn').dataset.chipType;
            if ((localUiState.currentBet[type] || 0) > 0) {
                 localUiState.currentBet[type]--;
            } else {
                 const player = state.players.find(p => p.id === localUiState.activePlayerId);
                 if ((player.roundBet[type] || 0) > 0) {
                     player.roundBet[type]--;
                     player.chips[type]++;
                     sendStateUpdate(); // Envia o estado atualizado
                 }
            }
            renderBetVisuals(localUiState.activePlayerId);
            return;
        }
        if (target.closest('#bet-confirm-btn')) {
            const player = state.players.find(p => p.id === localUiState.activePlayerId);
            Object.entries(localUiState.currentBet).forEach(([type, count]) => {
                player.chips[type] -= count;
                player.roundBet[type] = (player.roundBet[type] || 0) + count;
            });
            sendStateUpdate();
            const nextPlayerId = getNextPlayerId(localUiState.activePlayerId);
            renderBetScreen(nextPlayerId);
            return;
        }
        if (target.closest('#clear-bet-btn')) {
            localUiState.currentBet = {};
            renderBetVisuals(localUiState.activePlayerId);
            return;
        }
        if (target.closest('#end-betting-btn') || target.closest('#end-betting-btn-home')) {
            handleEndBetting();
            return;
        }
        if (target.closest('#bet-next-player')) { renderBetScreen(getNextPlayerId(localUiState.activePlayerId)); return; }
        if (target.closest('#bet-prev-player')) { renderBetScreen(getPrevPlayerId(localUiState.activePlayerId)); return; }
        
        // Tela de Gerenciamento
        if (target.closest('#manage-player-name .edit-icon')) {
            const player = state.players.find(p => p.id === localUiState.activePlayerId);
            const newName = prompt('Digite o novo nome:', player.name);
            if (newName && newName.trim()) {
                player.name = newName.trim();
                sendStateUpdate();
            }
            return;
        }
        if (target.closest('#manage-chip-selector .chip-btn')) {
            const type = target.closest('.chip-btn').dataset.chipType;
            localUiState.manageChips[type] = (localUiState.manageChips[type] || 0) + 1;
            renderManageVisuals(localUiState.activePlayerId);
            return;
        }
        if (target.closest('#manage-stack-visualizer .chip-btn')) {
            const type = target.closest('.chip-btn').dataset.chipType;
            const player = state.players.find(p => p.id === localUiState.activePlayerId);
            if(player.chips[type] + (localUiState.manageChips[type] || 0) > 0) {
                localUiState.manageChips[type] = (localUiState.manageChips[type] || 0) - 1;
                renderManageVisuals(localUiState.activePlayerId);
            }
            return;
        }
        if (target.closest('#manage-save-btn')) {
            const player = state.players.find(p => p.id === localUiState.activePlayerId);
            Object.entries(localUiState.manageChips).forEach(([type, count]) => { player.chips[type] = Math.max(0, (player.chips[type] || 0) + count); });
            sendStateUpdate();
            switchScreen('home');
            return;
        }
        if (target.closest('#manage-next-player')) { renderManageScreen(getNextPlayerId(localUiState.activePlayerId)); return; }
        if (target.closest('#manage-prev-player')) { renderManageScreen(getPrevPlayerId(localUiState.activePlayerId)); return; }
        
        // Tela de Configurações do Timer
        if (target.closest('#timer-start-pause-btn')) { sendTimerAction('startPause'); return; }
        if (target.closest('#timer-reset-btn')) { sendTimerAction('reset'); return; }
        if (target.closest('#timer-next-level-btn')) { sendTimerAction('nextLevel'); return; }
        if (target.closest('#timer-prev-level-btn')) { sendTimerAction('prevLevel'); return; }

        // Ações genéricas de cancelar/voltar
        if(target.closest('.home-btn')) { switchScreen('home'); return; }
    });

    document.getElementById('timer-input').addEventListener('change', (e) => {
        if (!state.timer.isRunning) {
            sendTimerAction('changeDuration', parseInt(e.target.value));
        }
    });

    // --- INICIALIZAÇÃO E OUVINTES DO SOCKET ---
    socket.on('gameStateUpdate', (newState) => {
        console.log('Estado recebido do servidor:', newState);
        state = newState;
        renderAll();
        // Se uma tela de sub-menu estiver aberta, atualize-a também
        if (localUiState.activeScreen === 'bet') renderBetVisuals(localUiState.activePlayerId);
        if (localUiState.activeScreen === 'manage') renderManageVisuals(localUiState.activePlayerId);
        if (localUiState.activeScreen === 'order') renderOrderScreen();
    });
    
    socket.on('playSound', () => {
        // Initialize AudioContext on user interaction if not already
        if (!audioCtx) {
            audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        }
        playSound();
    });

});

document.addEventListener('DOMContentLoaded', () => {
    const socket = io();

    // --- CONFIG CONSTANTS ---
    const CHIP_TYPES = {
        blue: { value: 400, class: 'chip-blue' },
        white: { value: 200, class: 'chip-white' },
        black: { value: 50, class: 'chip-black' },
        green: { value: 25, class: 'chip-green' },
        red: { value: 25, class: 'chip-red' },
    };

    // --- STATE ---
    let gameState = {};
    let myPlayerId = sessionStorage.getItem('pokerPlayerId') ? parseInt(sessionStorage.getItem('pokerPlayerId')) : null;
    let currentBet = {}; // Aposta não confirmada, gerenciada localmente neste cliente

    // --- DOM ELEMENTS ---
    const selectionScreen = document.getElementById('player-selection-screen');
    const betScreen = document.getElementById('player-bet-screen');
    const playerSelectionList = document.getElementById('player-selection-list');

    // --- HELPER FUNCTIONS ---
    const calculateStack = (player) => {
        if (!player || !player.chips) return 0;
        return Object.entries(player.chips).reduce((sum, [type, count]) => sum + (CHIP_TYPES[type].value * count), 0);
    };

    const calculateBetValue = (betObject) => {
        if (!betObject) return 0;
        return Object.entries(betObject).reduce((sum, [type, count]) => sum + (CHIP_TYPES[type].value * count), 0);
    };
    
    const switchView = (view) => {
        if (view === 'bet') {
            selectionScreen.classList.remove('active');
            betScreen.classList.add('active');
        } else {
            myPlayerId = null;
            sessionStorage.removeItem('pokerPlayerId');
            selectionScreen.classList.add('active');
            betScreen.classList.remove('active');
        }
    };

    // --- RENDER FUNCTIONS ---
    function renderPlayerSelection() {
        if (!gameState.players || gameState.players.length === 0) {
            playerSelectionList.innerHTML = '<p class="loading-text">Aguardando o manager adicionar jogadores...</p>';
            return;
        }
        playerSelectionList.innerHTML = '';
        gameState.players.forEach(player => {
            const playerButton = document.createElement('button');
            // Usando as classes do manager para um visual consistente
            playerButton.className = 'player-name-order-btn'; 
            playerButton.dataset.playerId = player.id;
            playerButton.textContent = player.name;
            playerSelectionList.appendChild(playerButton);
        });
    }

    function renderBetView() {
        if (!myPlayerId || !gameState.players) return;
        const me = gameState.players.find(p => p.id === myPlayerId);
        if (!me) {
            // Se meu jogador não existe mais (foi removido pelo manager)
            switchView('selection');
            renderPlayerSelection();
            return;
        }

        document.getElementById('player-view-name').textContent = me.name;
        document.getElementById('player-view-stack').textContent = calculateStack(me).toLocaleString('pt-BR');
        document.getElementById('player-view-round-bet').textContent = calculateBetValue(me.roundBet).toLocaleString('pt-BR');

        const highestBetInRound = Math.max(0, ...gameState.players.map(p => calculateBetValue(p.roundBet)));
        const previousBetInfoEl = document.getElementById('player-view-previous-bet-info');
        if (highestBetInRound > 0 && calculateBetValue(me.roundBet) < highestBetInRound) {
            previousBetInfoEl.textContent = `Aposta a cobrir: ${highestBetInRound}`;
        } else {
            previousBetInfoEl.textContent = '';
        }

        const currentBetValue = calculateBetValue(currentBet);
        document.getElementById('player-view-bet-total-value').textContent = currentBetValue.toLocaleString('pt-BR');

        const visualizerEl = document.getElementById('player-view-bet-visualizer');
        visualizerEl.innerHTML = '';
        Object.entries(currentBet).forEach(([type, count]) => {
            if (count > 0) {
                const config = CHIP_TYPES[type];
                const chipBtn = document.createElement('button');
                chipBtn.className = `btn chip-btn ${config.class}`;
                chipBtn.dataset.chipType = type;
                chipBtn.innerHTML = `<div class="value">${config.value}</div><div class="count">${count}</div>`;
                visualizerEl.appendChild(chipBtn);
            }
        });

        const selectorEl = document.getElementById('player-view-chip-selector');
        selectorEl.innerHTML = '';
        const playerChips = me.chips;
        Object.entries(playerChips).forEach(([type, totalCount]) => {
            const countInBet = currentBet[type] || 0;
            const remainingCount = totalCount - countInBet;
            if (remainingCount > 0) {
                const config = CHIP_TYPES[type];
                const chipBtn = document.createElement('button');
                chipBtn.className = `btn chip-btn ${config.class}`;
                chipBtn.dataset.chipType = type;
                chipBtn.innerHTML = `<div class="value">${config.value}</div><div class="count">${remainingCount}</div>`;
                selectorEl.appendChild(chipBtn);
            }
        });
    }

    // --- EVENT LISTENERS ---
    playerSelectionList.addEventListener('click', e => {
        const target = e.target.closest('.player-name-order-btn');
        if (target) {
            myPlayerId = parseInt(target.dataset.playerId);
            sessionStorage.setItem('pokerPlayerId', myPlayerId); // Salva o ID na sessão
            currentBet = {};
            switchView('bet');
            renderBetView();
        }
    });
    
    document.getElementById('change-player-btn').addEventListener('click', () => {
        switchView('selection');
    });

    document.getElementById('player-view-chip-selector').addEventListener('click', e => {
        const chipBtn = e.target.closest('.chip-btn');
        if (!chipBtn) return;
        const type = chipBtn.dataset.chipType;
        const me = gameState.players.find(p => p.id === myPlayerId);
        if (!me) return;
        
        const chipsInHand = me.chips[type] || 0;
        const chipsInBet = currentBet[type] || 0;

        if (chipsInHand > chipsInBet) {
            currentBet[type] = (currentBet[type] || 0) + 1;
            renderBetView();
        }
    });

    document.getElementById('player-view-bet-visualizer').addEventListener('click', e => {
        const chipBtn = e.target.closest('.chip-btn');
        if (!chipBtn) return;
        const type = chipBtn.dataset.chipType;
        if (currentBet[type] && currentBet[type] > 0) {
            currentBet[type]--;
            if (currentBet[type] === 0) {
                delete currentBet[type];
            }
            renderBetView();
        }
    });
    
    document.getElementById('player-view-clear-bet-btn').addEventListener('click', () => {
        currentBet = {};
        renderBetView();
    });

    document.getElementById('player-view-confirm-btn').addEventListener('click', () => {
        if (Object.keys(currentBet).length > 0) {
            socket.emit('playerAction', { type: 'playerBet', payload: { playerId: myPlayerId, bet: currentBet } });
            currentBet = {};
        }
    });

    // --- SOCKET.IO LISTENERS ---
    socket.on('gameStateUpdate', (newState) => {
        gameState = newState;
        if (myPlayerId) {
            switchView('bet');
            renderBetView();
        } else {
            switchView('selection');
            renderPlayerSelection();
        }
    });
    
    // --- INIT ---
    if (myPlayerId) {
        socket.on('connect', () => {
             // Se reconectar, o estado será recebido pelo 'gameStateUpdate'
             console.log('Reconectado ao servidor.');
        });
    }
});

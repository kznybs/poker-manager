// server.js
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// Serve os arquivos estáticos da pasta 'public'
app.use(express.static(path.join(__dirname, 'public')));

// Rota para a página do Manager (principal)
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Rota para a nova página do Jogador
app.get('/player', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'player.html'));
});


// --- CONFIGURAÇÃO INICIAL DO JOGO ---
const CHIP_TYPES = {
    blue: { value: 400, class: 'chip-blue' },
    white: { value: 200, class: 'chip-white' },
    black: { value: 50, class: 'chip-black' },
    green: { value: 25, class: 'chip-green' },
    red: { value: 25, class: 'chip-red' },
};
const INITIAL_CHIPS = { white: 8, red: 8, green: 8, black: 8, blue: 0 };
const BLIND_LEVELS = [
    { small: 25, big: 50 }, { small: 50, big: 100 }, { small: 75, big: 150 },
    { small: 100, big: 200 }, { small: 150, big: 300 }, { small: 200, big: 400 },
    { small: 250, big: 500 }, { small: 300, big: 600 }, { small: 400, big: 800 },
    { small: 500, big: 1000 }, { small: 600, big: 1200 }, { small: 800, big: 1600 },
    { small: 1000, big: 2000 }
];

// --- ESTADO DO JOGO (GERENCIADO PELO SERVIDOR) ---
let gameState = {
    players: [],
    pot: { white: 0, red: 0, green: 0, black: 0, blue: 0 },
    timer: { round: 0, time: 15 * 60, isRunning: false, duration: 15, endTime: null }
};

let timerInterval = null;

// --- FUNÇÕES DE LÓGICA DO JOGO ---
const calculatePotValue = () => {
    if (!gameState.pot) return 0;
    return Object.entries(gameState.pot).reduce((sum, [type, count]) => sum + (CHIP_TYPES[type].value * count), 0);
};

// --- LÓGICA DO TIMER NO SERVIDOR ---
function levelUp() {
    if (gameState.timer.round < BLIND_LEVELS.length - 1) {
        gameState.timer.round++;
        gameState.timer.time = gameState.timer.duration * 60;
        if (gameState.timer.isRunning) {
            gameState.timer.endTime = Date.now() + gameState.timer.time * 1000;
        }
        io.emit('playSound'); // Emite evento para os clientes tocarem o som
    } else {
        gameState.timer.isRunning = false;
        clearInterval(timerInterval);
        timerInterval = null;
    }
}

function tick() {
    if (!gameState.timer.isRunning || !gameState.timer.endTime) return;

    let newTime = Math.round((gameState.timer.endTime - Date.now()) / 1000);
    if (newTime <= 0) {
        levelUp();
        newTime = gameState.timer.time; // Pega o novo tempo após o level up
    }
    
    gameState.timer.time = newTime;
    io.emit('gameStateUpdate', gameState); // Envia o estado atualizado para todos
}


// --- LÓGICA DO SOCKET.IO ---
io.on('connection', (socket) => {
    console.log('Um cliente se conectou:', socket.id);

    // Envia o estado atual do jogo para o novo cliente
    socket.emit('gameStateUpdate', gameState);

    // Ouve por ações do jogo
    socket.on('playerAction', (action) => {
        console.log('Ação recebida:', action.type, action.payload);
        
        switch(action.type) {
            case 'addPlayer': {
                const { name } = action.payload;
                if (name && name.trim() !== "") {
                    const newId = gameState.players.length > 0 ? Math.max(...gameState.players.map(p => p.id)) + 1 : 1;
                    gameState.players.push({
                        id: newId,
                        name: name,
                        chips: { ...INITIAL_CHIPS },
                        roundBet: { white: 0, red: 0, green: 0, black: 0, blue: 0 },
                        selectedForPot: false
                    });
                }
                break;
            }
            case 'removePlayer': {
                const { playerId } = action.payload;
                gameState.players = gameState.players.filter(p => p.id !== playerId);
                break;
            }
            case 'updateOrder': {
                const { playerIds } = action.payload;
                const newOrder = playerIds.map(id => gameState.players.find(p => p.id === id));
                gameState.players = newOrder.filter(p => p); // Filtra jogadores que possam ter sido removidos
                break;
            }
            case 'updatePlayerName': {
                const { playerId, name } = action.payload;
                const player = gameState.players.find(p => p.id === playerId);
                if (player && name && name.trim()) {
                    player.name = name.trim();
                }
                break;
            }
            case 'updatePlayerChips': {
                const { playerId, chips } = action.payload;
                const player = gameState.players.find(p => p.id === playerId);
                if (player) {
                    player.chips = chips;
                }
                break;
            }
             case 'playerBet': {
                const { playerId, bet } = action.payload;
                const player = gameState.players.find(p => p.id === playerId);
                if (!player) break;

                // Valida e processa a aposta
                let isValid = true;
                for (const type in bet) {
                    if ((player.chips[type] || 0) < bet[type]) {
                        isValid = false;
                        break;
                    }
                }

                if (isValid) {
                    for (const type in bet) {
                        player.chips[type] -= bet[type];
                        player.roundBet[type] = (player.roundBet[type] || 0) + bet[type];
                    }
                }
                break;
            }
            case 'endBettingRound': {
                gameState.players.forEach(player => {
                    Object.entries(player.roundBet).forEach(([type, count]) => {
                        gameState.pot[type] = (gameState.pot[type] || 0) + count;
                    });
                    player.roundBet = { white: 0, red: 0, green: 0, black: 0, blue: 0 };
                });
                break;
            }
            case 'toggleWinner': {
                const { playerId } = action.payload;
                const player = gameState.players.find(p => p.id === playerId);
                if (player) {
                    player.selectedForPot = !player.selectedForPot;
                }
                break;
            }
            case 'distributePot': {
                const winners = gameState.players.filter(p => p.selectedForPot);
                if (winners.length > 0 && calculatePotValue() > 0) {
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
                     // Adiciona as fichas restantes do pote ao primeiro vencedor para não perder nada
                    if (winners.length > 0) {
                        const remainingPotValue = totalPotValue - (valuePerWinner * winners.length);
                        // A lógica para distribuir o resto pode ser complexa, então por simplicidade vamos limpar o pote.
                        // Numa versão avançada, o resto seria distribuído.
                    }

                    gameState.pot = { white: 0, red: 0, green: 0, black: 0, blue: 0 };
                    gameState.players.forEach(p => p.selectedForPot = false);
                }
                break;
            }
            case 'resetGame': {
                gameState.players = [];
                gameState.pot = { white: 0, red: 0, green: 0, black: 0, blue: 0 };
                // A ação de reset do timer é separada
                break;
            }
        }
        
        // Transmite o novo estado para TODOS os clientes após qualquer ação
        io.emit('gameStateUpdate', gameState);
    });

    // Lógica do Timer
    socket.on('timerAction', (action) => {
        switch(action.type) {
            case 'startPause':
                gameState.timer.isRunning = !gameState.timer.isRunning;
                if (gameState.timer.isRunning) {
                    gameState.timer.endTime = Date.now() + gameState.timer.time * 1000;
                    if (!timerInterval) {
                       timerInterval = setInterval(tick, 1000);
                    }
                } else {
                    clearInterval(timerInterval);
                    timerInterval = null;
                    if (gameState.timer.endTime) {
                        gameState.timer.time = Math.max(0, Math.round((gameState.timer.endTime - Date.now()) / 1000));
                    }
                }
                break;
            case 'reset':
                 gameState.timer.round = 0;
                 gameState.timer.time = gameState.timer.duration * 60;
                 if (gameState.timer.isRunning) {
                     gameState.timer.isRunning = false;
                     clearInterval(timerInterval);
                     timerInterval = null;
                 }
                break;
            case 'nextLevel':
                if (!gameState.timer.isRunning) levelUp();
                break;
            case 'prevLevel':
                 if (!gameState.timer.isRunning && gameState.timer.round > 0) {
                    gameState.timer.round--;
                    gameState.timer.time = gameState.timer.duration * 60;
                }
                break;
            case 'changeDuration':
                if (!gameState.timer.isRunning) {
                    gameState.timer.duration = action.payload;
                    gameState.timer.time = gameState.timer.duration * 60;
                }
                break;
        }
        io.emit('gameStateUpdate', gameState);
    });


    socket.on('disconnect', () => {
        console.log('Um cliente se desconectou:', socket.id);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
});

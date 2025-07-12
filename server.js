// server.js
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// Serve os arquivos estáticos da pasta 'public'
app.use(express.static('public'));

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
    console.log('Um jogador se conectou:', socket.id);

    // Envia o estado atual do jogo para o novo jogador
    socket.emit('gameStateUpdate', gameState);

    // Ouve por ações do jogador
    socket.on('playerAction', (action) => {
        console.log('Ação recebida:', action);
        
        // Atualiza o gameState baseado na ação
        // Esta é uma implementação simplificada. A lógica real pode ser mais complexa.
        if (action.type === 'updateGameState') {
           gameState = action.payload;
        }
        
        // Transmite o novo estado para TODOS os clientes
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
                    // Salva o tempo restante
                    if (gameState.timer.endTime) {
                        gameState.timer.time = Math.round((gameState.timer.endTime - Date.now()) / 1000);
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
                if (!gameState.timer.isRunning) {
                    levelUp();
                }
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
        console.log('Um jogador se desconectou:', socket.id);
        // Opcional: Adicionar lógica para lidar com a desconexão de jogadores
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
});

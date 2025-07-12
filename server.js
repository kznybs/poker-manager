const express = require('express');
const http = require('http');
const socketIo = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

app.use(express.static('public'));

io.on('connection', (socket) => {
    console.log('🟢 Jogador conectado:', socket.id);

    socket.on('jogada', (data) => {
        io.emit('jogada', data);
    });

    socket.on('disconnect', () => {
        console.log('🔴 Jogador saiu:', socket.id);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
});
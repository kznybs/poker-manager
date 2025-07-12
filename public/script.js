const socket = io();

const mensagens = document.getElementById('mensagens');
const entrada = document.getElementById('entrada');

function enviar() {
    const jogada = entrada.value;
    socket.emit('jogada', jogada);
    entrada.value = '';
}

socket.on('jogada', (jogada) => {
    const p = document.createElement('p');
    p.textContent = jogada;
    mensagens.appendChild(p);
});
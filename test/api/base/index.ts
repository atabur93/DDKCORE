import config from 'shared/config';
import { Message } from 'shared/model/message';
import { ResponseEntity } from 'shared/model/response';
import { SocketClient } from 'shared/driver/socket/client';
import { CORE_SOCKET_CLIENT_CONFIG } from 'shared/config/socket';

export const getSocket = () => {
    const socketClient = new SocketClient(
        config.API.SOCKET.HOST,
        config.API.SOCKET.PORT,
        'ws',
        CORE_SOCKET_CLIENT_CONFIG,
    );
    return socketClient.connect();
};

export const socketRequest = <T>(message: Message<T>): Promise<Message<ResponseEntity<any>>> =>
    new Promise(resolve => {
        const socket = getSocket();
        socket.emit('message', message);
        socket.on('message', (response: Message<ResponseEntity<any>>) => {
            if (response.headers.id === message.headers.id) {
                resolve(response);
                socket.close();
            }
        });
    });

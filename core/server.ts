import Loader from 'core/loader';
import { logger } from 'shared/util/logger';

process.addListener('unhandledRejection', err => {
    logger.error(`[Core][Process][unhandledRejection] ${JSON.stringify(err)}`);
});

process.addListener('uncaughtException', err => {
    logger.error(`[Core][Process][uncaughtException] ${err.message} \n ${err.stack}`);
});

const preconfiguration: Array<Promise<any>> = [];

preconfiguration.push(Loader.start());

Promise.all(preconfiguration)
    .then(() => {})
    .catch(err => {
        logger.error('Failed to start the server CORE. \n', err);
    });
